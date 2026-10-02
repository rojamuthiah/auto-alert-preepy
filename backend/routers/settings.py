"""
FastAPI router for Settings (provider API keys, Gmail, theme).
In this phase: provider keys only.
"""
from __future__ import annotations
from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel
from db.mongo import settings_col
from logger import get_logger
from config import get_settings
from providers.llm_factory import get_supported_model_registry

log = get_logger("router.settings")
router = APIRouter(prefix="/settings", tags=["settings"])

SETTINGS_ID = "global"


class ProviderKeys(BaseModel):
    openai_api_key: Optional[str] = None
    gemini_api_key: Optional[str] = None
    claude_api_key: Optional[str] = None


class ThemeSettings(BaseModel):
    theme: str = "dark"


class LangfuseSettings(BaseModel):
    public_key: Optional[str] = None
    secret_key: Optional[str] = None
    base_url: Optional[str] = None


@router.get("")
async def get_settings_doc() -> dict:
    env = get_settings()
    doc = await settings_col().find_one({"_id": SETTINGS_ID})
    registry = get_supported_model_registry()
    if not doc:
        return {
            "providers": {
                "openai": {"configured": bool(env.openai_api_key)},
                "gemini": {"configured": bool(env.gemini_api_key)},
                "claude": {"configured": bool(env.claude_api_key)},
            },
            "models": registry,
            "langfuse": {"configured": bool(env.langfuse_public_key and env.langfuse_secret_key), "base_url": env.langfuse_base_url or ""},
            "theme": "dark",
            "gmail": {},
            "channels": {"email": {"configured": False}, "whatsapp": {"configured": False}},
        }
    providers = doc.get("providers", {})
    safe_providers = {
        name: {"configured": bool(value.get("api_key"))}
        for name, value in providers.items()
        if isinstance(value, dict)
    }
    for name, key in (("openai", env.openai_api_key), ("gemini", env.gemini_api_key), ("claude", env.claude_api_key)):
        safe_providers.setdefault(name, {"configured": bool(key)})
        if key:
            safe_providers[name]["configured"] = True
    doc.pop("_id", None)
    doc["providers"] = safe_providers
    doc["models"] = registry
    langfuse = doc.get("langfuse", {})
    doc["langfuse"] = {
        "configured": bool(langfuse.get("public_key") and langfuse.get("secret_key")) or bool(env.langfuse_public_key and env.langfuse_secret_key),
        "base_url": langfuse.get("base_url") or env.langfuse_base_url or "",
    }
    channels = doc.get("channels", {})
    email = channels.get("email", {})
    whatsapp = channels.get("whatsapp", {})
    doc["channels"] = {
        "email": {"configured": bool(email.get("smtp_host") and email.get("password")), "enabled": bool(email.get("enabled"))},
        "whatsapp": {"configured": bool(whatsapp.get("phone_number_id") and whatsapp.get("access_token")), "enabled": bool(whatsapp.get("enabled"))},
    }
    return doc


@router.get("/models")
async def get_model_registry() -> dict:
    return get_supported_model_registry()


@router.patch("/providers")
async def update_provider_keys(body: ProviderKeys) -> dict:
    updates: dict = {}
    if body.openai_api_key is not None:
        updates["providers.openai.api_key"] = body.openai_api_key
    if body.gemini_api_key is not None:
        updates["providers.gemini.api_key"] = body.gemini_api_key
    if body.claude_api_key is not None:
        updates["providers.claude.api_key"] = body.claude_api_key

    await settings_col().update_one(
        {"_id": SETTINGS_ID},
        {"$set": updates},
        upsert=True,
    )
    log.info("provider_keys_updated", keys=list(updates.keys()))
    return {"ok": True}


@router.patch("/langfuse")
async def update_langfuse_settings(body: LangfuseSettings) -> dict:
    updates: dict = {}
    if body.public_key is not None:
        updates["langfuse.public_key"] = body.public_key.strip()
    if body.secret_key is not None:
        updates["langfuse.secret_key"] = body.secret_key.strip()
    if body.base_url is not None:
        updates["langfuse.base_url"] = body.base_url.strip().rstrip("/")
    if not updates:
        return {"ok": True}
    await settings_col().update_one({"_id": SETTINGS_ID}, {"$set": updates}, upsert=True)
    log.info("langfuse_settings_updated", fields=list(updates.keys()))
    return {"ok": True}


@router.patch("/theme")
async def update_theme(body: ThemeSettings) -> dict:
    await settings_col().update_one(
        {"_id": SETTINGS_ID},
        {"$set": {"theme": body.theme}},
        upsert=True,
    )
    return {"ok": True, "theme": body.theme}
