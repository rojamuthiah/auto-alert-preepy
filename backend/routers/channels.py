"""Locally configured delivery channels for job plan notifications."""
from __future__ import annotations

import asyncio
import re
import smtplib
from email.message import EmailMessage
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from db.mongo import settings_col
from logger import get_logger

router = APIRouter(prefix="/channels", tags=["channels"])
log = get_logger("router.channels")
SETTINGS_ID = "global"


class EmailChannelInput(BaseModel):
    smtp_host: str = Field(min_length=1, max_length=255)
    smtp_port: int = Field(ge=1, le=65535)
    security: Literal["starttls", "ssl", "none"] = "starttls"
    username: str = Field(min_length=1, max_length=255)
    password: str = ""
    from_name: str = Field(default="Prep Studio", max_length=100)
    from_email: str = Field(min_length=3, max_length=254)
    recipient_email: str = Field(min_length=3, max_length=254)
    enabled: bool = True
    notify_plan_updates: bool = False


class WhatsAppChannelInput(BaseModel):
    phone_number_id: str = Field(min_length=1, max_length=100)
    access_token: str = ""
    recipient_phone: str = Field(min_length=8, max_length=20)
    graph_version: str = Field(default="v26.0", pattern=r"^v\d+\.0$", max_length=10)
    notification_template: str = Field(default="", max_length=100)
    template_language: str = Field(default="en_US", max_length=20)
    enabled: bool = True
    notify_plan_updates: bool = False


class ChannelEnabledInput(BaseModel):
    enabled: bool


def _valid_email(value: str) -> bool:
    return bool(re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value.strip()))


def _valid_phone(value: str) -> bool:
    return bool(re.fullmatch(r"\+?[1-9]\d{7,14}", value.strip()))


def _safe_email(config: dict | None) -> dict:
    config = config or {}
    configured = bool(config.get("smtp_host") and config.get("from_email") and config.get("recipient_email") and config.get("password"))
    return {
        "configured": configured,
        "smtp_host": config.get("smtp_host", ""),
        "smtp_port": config.get("smtp_port", 587),
        "security": config.get("security", "starttls"),
        "username": config.get("username", ""),
        "from_name": config.get("from_name", "Prep Studio"),
        "from_email": config.get("from_email", ""),
        "recipient_email": config.get("recipient_email", ""),
        "enabled": bool(config.get("enabled", False)),
        "notify_plan_updates": bool(config.get("notify_plan_updates", False)),
    }


def _safe_whatsapp(config: dict | None) -> dict:
    config = config or {}
    configured = bool(config.get("phone_number_id") and config.get("access_token") and config.get("recipient_phone"))
    return {
        "configured": configured,
        "phone_number_id": config.get("phone_number_id", ""),
        "recipient_phone": config.get("recipient_phone", ""),
        "graph_version": config.get("graph_version", "v26.0"),
        "notification_template": config.get("notification_template", ""),
        "template_language": config.get("template_language", "en_US"),
        "enabled": bool(config.get("enabled", False)),
        "notify_plan_updates": bool(config.get("notify_plan_updates", False)),
    }


async def _channel_config() -> dict:
    doc = await settings_col().find_one({"_id": SETTINGS_ID}, {"channels": 1}) or {}
    return doc.get("channels", {})


async def get_channel_status() -> dict:
    channels = await _channel_config()
    return {
        "email": _safe_email(channels.get("email")),
        "whatsapp": _safe_whatsapp(channels.get("whatsapp")),
    }


@router.get("")
async def get_channels() -> dict:
    channels = await _channel_config()
    return {"email": _safe_email(channels.get("email")), "whatsapp": _safe_whatsapp(channels.get("whatsapp"))}


@router.patch("/{channel}/enabled")
async def set_channel_enabled(channel: Literal["email", "whatsapp"], body: ChannelEnabledInput) -> dict:
    channels = await _channel_config()
    config = channels.get(channel, {})
    safe = _safe_email(config) if channel == "email" else _safe_whatsapp(config)
    if not safe["configured"]:
        raise HTTPException(status_code=400, detail=f"Add the {channel} channel before changing its status.")
    await settings_col().update_one({"_id": SETTINGS_ID}, {"$set": {f"channels.{channel}.enabled": body.enabled}}, upsert=True)
    log.info("channel_status_changed", channel=channel, enabled=body.enabled)
    return {"ok": True, "enabled": body.enabled}


@router.put("/email")
async def save_email_channel(body: EmailChannelInput) -> dict:
    if not _valid_email(body.from_email) or not _valid_email(body.recipient_email):
        raise HTTPException(status_code=422, detail="Enter valid sender and recipient email addresses.")
    existing = (await _channel_config()).get("email", {})
    password = body.password.strip() or existing.get("password", "")
    if not password:
        raise HTTPException(status_code=422, detail="Enter your SMTP password or app password.")
    config = body.model_dump(exclude={"password"})
    config["password"] = password
    config["smtp_host"] = body.smtp_host.strip()
    config["username"] = body.username.strip()
    config["from_email"] = body.from_email.strip()
    config["recipient_email"] = body.recipient_email.strip()
    await settings_col().update_one({"_id": SETTINGS_ID}, {"$set": {"channels.email": config}}, upsert=True)
    log.info("channel_saved", channel="email", enabled=body.enabled)
    return {"ok": True, "email": _safe_email(config)}


@router.put("/whatsapp")
async def save_whatsapp_channel(body: WhatsAppChannelInput) -> dict:
    if not _valid_phone(body.recipient_phone):
        raise HTTPException(status_code=422, detail="Enter the recipient phone number in international format, for example +919876543210.")
    existing = (await _channel_config()).get("whatsapp", {})
    access_token = body.access_token.strip() or existing.get("access_token", "")
    if not access_token:
        raise HTTPException(status_code=422, detail="Enter a Meta WhatsApp Cloud API access token.")
    config = body.model_dump(exclude={"access_token"})
    config["access_token"] = access_token
    config["phone_number_id"] = body.phone_number_id.strip()
    config["recipient_phone"] = body.recipient_phone.strip().lstrip("+")
    await settings_col().update_one({"_id": SETTINGS_ID}, {"$set": {"channels.whatsapp": config}}, upsert=True)
    log.info("channel_saved", channel="whatsapp", enabled=body.enabled)
    return {"ok": True, "whatsapp": _safe_whatsapp(config)}


def _send_email(config: dict, subject: str, body: str) -> None:
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = f"{config.get('from_name', 'Prep Studio')} <{config['from_email']}>"
    message["To"] = config["recipient_email"]
    message.set_content(body)
    host, port = config["smtp_host"], int(config["smtp_port"])
    timeout = 20
    if config.get("security") == "ssl":
        with smtplib.SMTP_SSL(host, port, timeout=timeout) as server:
            server.login(config["username"], config["password"])
            server.send_message(message)
    else:
        with smtplib.SMTP(host, port, timeout=timeout) as server:
            server.ehlo()
            if config.get("security", "starttls") == "starttls":
                server.starttls()
                server.ehlo()
            server.login(config["username"], config["password"])
            server.send_message(message)


async def _send_whatsapp(config: dict, *, template: str, language: str, message_body: str | None = None) -> None:
    version = config.get("graph_version", "v26.0")
    url = f"https://graph.facebook.com/{version}/{config['phone_number_id']}/messages"
    payload: dict = {"messaging_product": "whatsapp", "to": config["recipient_phone"], "type": "template", "template": {"name": template, "language": {"code": language}}}
    if message_body is not None:
        payload["template"]["components"] = [{"type": "body", "parameters": [{"type": "text", "text": message_body[:1024]}]}]
    async with httpx.AsyncClient(timeout=25) as client:
        response = await client.post(url, headers={"Authorization": f"Bearer {config['access_token']}"}, json=payload)
    if response.is_error:
        try:
            detail = response.json().get("error", {}).get("message", "WhatsApp Cloud API rejected the test message.")
        except Exception:
            detail = "WhatsApp Cloud API rejected the test message."
        raise HTTPException(status_code=502, detail=detail)


@router.post("/{channel}/test")
async def test_channel(channel: Literal["email", "whatsapp"]) -> dict:
    config = (await _channel_config()).get(channel, {})
    if channel == "email":
        if not _safe_email(config)["configured"]:
            raise HTTPException(status_code=400, detail="Save a complete email connection before sending a test.")
        try:
            await asyncio.wait_for(asyncio.to_thread(_send_email, config, "Prep Studio channel test", "Your email channel is connected. Prep Studio can send job plan updates to this address."), timeout=30)
        except (smtplib.SMTPException, OSError, TimeoutError) as exc:
            log.warning("channel_test_failed", channel=channel, error=str(exc))
            if isinstance(exc, PermissionError) or getattr(exc, "winerror", None) == 10013:
                raise HTTPException(
                    status_code=502,
                    detail="Windows or your network is blocking outbound SMTP. Allow the Prep Studio backend's Python executable to connect to smtp.gmail.com on TCP port 587 (or 465), then retry.",
                ) from exc
            raise HTTPException(status_code=502, detail=f"Email test failed: {exc}") from exc
    else:
        if not _safe_whatsapp(config)["configured"]:
            raise HTTPException(status_code=400, detail="Save a complete WhatsApp Cloud API connection before sending a test.")
        await _send_whatsapp(config, template="hello_world", language="en_US")
    log.info("channel_test_sent", channel=channel)
    message = f"Test email sent to {config['recipient_email']}." if channel == "email" else "Test sent through WhatsApp."
    return {"ok": True, "message": message}


@router.delete("/{channel}")
async def remove_channel(channel: Literal["email", "whatsapp"]) -> dict:
    await settings_col().update_one({"_id": SETTINGS_ID}, {"$unset": {f"channels.{channel}": ""}})
    log.info("channel_removed", channel=channel)
    return {"ok": True}


async def notify_plan_update(subject: str, body: str) -> None:
    """Deliver an opted-in plan update without making plan operations fail on mail errors."""
    channels = await _channel_config()
    email_config = channels.get("email", {})
    if email_config.get("enabled") and email_config.get("notify_plan_updates") and _safe_email(email_config)["configured"]:
        try:
            await asyncio.wait_for(asyncio.to_thread(_send_email, email_config, subject, body), timeout=30)
            log.info("channel_notification_sent", channel="email", event="plan_update")
        except Exception as exc:
            log.warning("channel_notification_failed", channel="email", event="plan_update", error=str(exc))

    wa_config = channels.get("whatsapp", {})
    template = wa_config.get("notification_template", "").strip()
    if wa_config.get("enabled") and wa_config.get("notify_plan_updates") and template and _safe_whatsapp(wa_config)["configured"]:
        try:
            await _send_whatsapp(wa_config, template=template, language=wa_config.get("template_language", "en_US"), message_body=body)
            log.info("channel_notification_sent", channel="whatsapp", event="plan_update")
        except Exception as exc:
            log.warning("channel_notification_failed", channel="whatsapp", event="plan_update", error=str(exc))


async def send_workflow_notification(channel: Literal["email", "whatsapp"], subject: str, body: str) -> None:
    """Send a workflow alert through the selected enabled channel."""
    channels = await _channel_config()
    config = channels.get(channel, {})
    if not config.get("enabled"):
        raise RuntimeError(f"The {channel} channel is disabled.")
    if channel == "email":
        safe = _safe_email(config)
        if not safe["configured"]:
            raise RuntimeError("The email channel is not configured.")
        await asyncio.wait_for(asyncio.to_thread(_send_email, config, subject, body), timeout=30)
        return
    safe = _safe_whatsapp(config)
    if not safe["configured"]:
        raise RuntimeError("The WhatsApp channel is not configured.")
    template = config.get("notification_template", "").strip() or "hello_world"
    await _send_whatsapp(config, template=template, language=config.get("template_language", "en_US"), message_body=body)
