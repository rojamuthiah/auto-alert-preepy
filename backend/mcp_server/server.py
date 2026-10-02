"""
MCP HTTP Server for Prep Studio — Plans Tools.
Runs on port 8001 (configurable).
"""
import sys
import os
import html
import json
import re
import xml.etree.ElementTree as ET

# Ensure backend root is on path when run standalone
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import asyncio
from datetime import datetime, timezone, timedelta
from typing import Any, Optional

from bson import ObjectId
from fastmcp import FastMCP
from motor.motor_asyncio import AsyncIOMotorClient

from config import get_settings
from logger import get_logger
from providers.llm_factory import PROVIDER_MODELS

settings = get_settings()
log = get_logger("mcp_server")

# ---------------------------------------------------------------------------
# Standalone Motor client for MCP server (runs in separate process/port)
# ---------------------------------------------------------------------------
_client: AsyncIOMotorClient | None = None


def _get_db():
    global _client
    if _client is None:
        _client = AsyncIOMotorClient(settings.mongo_url)
    return _client[settings.mongo_db]


def _plans():
    return _get_db()["plans"]


def _traces():
    return _get_db()["traces"]


def _profiles():
    return _get_db()["profiles"]


def _model_usage():
    return _get_db()["model_usage"]


def _plan_filter(plan_id: str) -> dict:
    """Accept an ObjectId, or recover an ObjectId prefix mistakenly joined to a slug."""
    raw = str(plan_id).strip()
    if ObjectId.is_valid(raw):
        return {"_id": ObjectId(raw)}
    # The agent has occasionally combined the opaque database ID and plan key,
    # e.g. `<24-hex-id>-chennai-product-companies`. Recover only the valid ID
    # prefix; never query Mongo with an invalid ObjectId.
    match = re.match(r"^([0-9a-fA-F]{24})(?:[-_:].*)$", raw)
    if match:
        return {"_id": ObjectId(match.group(1))}
    # A plan key is also a safe human-readable selector for agent initiated edits.
    return {"key": raw}


MAX_ROWS = 200

# ---------------------------------------------------------------------------
# FastMCP app
# ---------------------------------------------------------------------------
mcp = FastMCP("prep-studio-plans")


def _serialize(doc: dict) -> dict:
    """Convert ObjectId fields to strings for JSON serialisation."""
    doc = dict(doc)
    if "_id" in doc:
        doc["id"] = str(doc.pop("_id"))
    if "chat_id" in doc:
        doc["chat_id"] = str(doc["chat_id"])
    if "created_at" in doc and isinstance(doc["created_at"], datetime):
        doc["created_at"] = doc["created_at"].isoformat()
    return doc


async def _log_trace(action: str, payload: dict) -> None:
    try:
        await _traces().insert_one(
            {
                "type": "plan_tool",
                "source": f"mcp:{action}",
                "payload": payload,
                "created_at": datetime.now(timezone.utc),
            }
        )
    except Exception as e:
        log.warning("trace_write_failed", error=str(e))


# ---------------------------------------------------------------------------
# Tool 1: create_plan
# ---------------------------------------------------------------------------
@mcp.tool()
async def create_plan(
    chat_id: str,
    name: str,
    key: str,
    provider: str,
    rows: list[dict],
    sources: list[dict] | None = None,
) -> dict:
    """
    Create a new job tracking plan linked to a chat.
    Plan is hidden=true until promoted by user.
    Max 200 rows enforced.
    """
    if len(rows) > MAX_ROWS:
        raise ValueError(f"Plan cannot exceed {MAX_ROWS} rows. Got {len(rows)}.")

    doc = {
        "chat_id": ObjectId(chat_id),
        "name": name,
        "key": key,
        "provider": provider,
        "hidden": True,
        "rows": rows,
        "sources": sources or [],
        "created_at": datetime.now(timezone.utc),
    }
    result = await _plans().insert_one(doc)
    doc["_id"] = result.inserted_id

    log.info("plan_created", plan_id=str(result.inserted_id), name=name)
    await _log_trace("create_plan", {"plan_id": str(result.inserted_id), "name": name})

    return _serialize(doc)


# ---------------------------------------------------------------------------
# Tool 2: get_plan
# ---------------------------------------------------------------------------
@mcp.tool()
async def get_plan(plan_id: str) -> dict:
    """Fetch a plan by its ID including all rows."""
    doc = await _plans().find_one(_plan_filter(plan_id))
    if not doc:
        raise ValueError(f"Plan {plan_id} not found.")
    log.info("plan_fetched", plan_id=plan_id)
    return _serialize(doc)


# ---------------------------------------------------------------------------
# Tool 3: list_plans  (hidden=false only)
# ---------------------------------------------------------------------------
@mcp.tool()
async def list_plans() -> list[dict]:
    """List all promoted (visible) plans. Does NOT include hidden plans."""
    cursor = _plans().find(
        {"hidden": False},
        {"rows": 0},  # exclude rows for brevity
    ).sort("created_at", -1)
    docs = await cursor.to_list(length=500)
    return [_serialize(d) for d in docs]


# ---------------------------------------------------------------------------
# Tool 4: list_chat_plans
# ---------------------------------------------------------------------------
@mcp.tool()
async def list_chat_plans(chat_id: str) -> list[dict]:
    """List all plans (hidden or visible) belonging to a specific chat."""
    cursor = _plans().find(
        {"chat_id": ObjectId(chat_id)},
        {"rows": 0},
    ).sort("created_at", -1)
    docs = await cursor.to_list(length=200)
    return [_serialize(d) for d in docs]


# ---------------------------------------------------------------------------
# Tool 5: update_plan
# ---------------------------------------------------------------------------
@mcp.tool()
async def update_plan(
    plan_id: str,
    name: Optional[str] = None,
    key: Optional[str] = None,
    rows: Optional[list[dict]] = None,
) -> dict:
    """
    Partially update a plan. Provide only the fields to change.
    If rows is provided, it replaces all existing rows (max 200).
    """
    updates: dict[str, Any] = {}
    if name is not None:
        updates["name"] = name
    if key is not None:
        updates["key"] = key
    if rows is not None:
        if len(rows) > MAX_ROWS:
            raise ValueError(f"Rows exceed {MAX_ROWS} limit.")
        updates["rows"] = rows

    if not updates:
        raise ValueError("No fields provided to update.")

    plan_filter = _plan_filter(plan_id)
    result = await _plans().find_one_and_update(
        plan_filter,
        {"$set": updates},
        return_document=True,
    )
    if not result:
        raise ValueError("Plan not found. Use list_chat_plans to retrieve the plan's current ID or key, then retry.")

    actual_plan_id = str(result.get("_id", ""))
    log.info("plan_updated", plan_id=actual_plan_id, fields=list(updates.keys()))
    await _log_trace("update_plan", {"plan_id": actual_plan_id, "fields": list(updates.keys())})
    return _serialize(result)


# ---------------------------------------------------------------------------
# Tool 6: promote_plan
# ---------------------------------------------------------------------------
@mcp.tool()
async def promote_plan(plan_id: str) -> dict:
    """
    Promote a plan to Job Plans (set hidden=false).
    After this the plan will appear in the Job Plans page.
    """
    result = await _plans().find_one_and_update(
        _plan_filter(plan_id),
        {"$set": {"hidden": False}},
        return_document=True,
    )
    if not result:
        raise ValueError(f"Plan {plan_id} not found.")

    actual_plan_id = str(result["_id"])
    log.info("plan_promoted", plan_id=actual_plan_id)
    await _log_trace("promote_plan", {"plan_id": actual_plan_id})
    return {"ok": True, "plan_id": actual_plan_id}


# ---------------------------------------------------------------------------
# Tool 7: delete_plan
# ---------------------------------------------------------------------------
@mcp.tool()
async def delete_plan(plan_id: str) -> dict:
    """Permanently delete a plan and all its rows."""
    result = await _plans().delete_one(_plan_filter(plan_id))
    if result.deleted_count == 0:
        raise ValueError(f"Plan {plan_id} not found.")

    log.info("plan_deleted", plan_id=plan_id)
    await _log_trace("delete_plan", {"plan_id": plan_id})
    return {"ok": True}


# ---------------------------------------------------------------------------
# Tool 8: append_rows
# ---------------------------------------------------------------------------
@mcp.tool()
async def append_rows(plan_id: str, rows: list[dict]) -> dict:
    """
    Append rows to an existing plan.
    Enforces the 200-row cap across existing + new rows.
    """
    plan_filter = _plan_filter(plan_id)
    plan = await _plans().find_one(plan_filter, {"rows": 1})
    if not plan:
        raise ValueError(f"Plan {plan_id} not found.")

    existing_count = len(plan.get("rows", []))
    if existing_count + len(rows) > MAX_ROWS:
        allowed = MAX_ROWS - existing_count
        raise ValueError(
            f"Cannot append {len(rows)} rows. Plan has {existing_count} rows; "
            f"only {allowed} more allowed (max {MAX_ROWS})."
        )

    result = await _plans().find_one_and_update(
        plan_filter,
        {"$push": {"rows": {"$each": rows}}},
        return_document=True,
    )

    log.info("rows_appended", plan_id=plan_id, count=len(rows))
    await _log_trace("append_rows", {"plan_id": plan_id, "count": len(rows)})
    return _serialize(result)


# ---------------------------------------------------------------------------
# Tool 9: get_profile
# ---------------------------------------------------------------------------
@mcp.tool()
async def get_profile() -> dict:
    """Fetch the user's global profile and preferences."""
    doc = await _profiles().find_one({"_id": "global"})
    if not doc:
        return {"id": "global", "profile_summary": "", "skills": [], "additional_preferences": []}
    return _serialize(doc)


# ---------------------------------------------------------------------------
# Model routing observability tools
# ---------------------------------------------------------------------------
@mcp.tool()
async def list_model_availability() -> list[dict]:
    """List enabled models and health/usage state without exposing provider API keys."""
    settings_doc = await _get_db()["settings"].find_one({"_id": "global"}) or {}
    configured = {
        name: bool((settings_doc.get("providers", {}).get(name) or {}).get("api_key"))
        for name in PROVIDER_MODELS
    }
    env_keys = {
        "openai": bool(settings.openai_api_key),
        "gemini": bool(settings.gemini_api_key),
        "claude": bool(settings.claude_api_key),
    }
    docs = await _model_usage().find({}).to_list(length=100)
    usage = {(doc.get("provider"), doc.get("model")): doc for doc in docs}
    now = datetime.now(timezone.utc)
    rows = []
    for provider, models in PROVIDER_MODELS.items():
        for model in models:
            doc = usage.get((provider, model), {})
            cooldown = doc.get("cooldown_until")
            cooling = bool(cooldown and cooldown > now)
            is_configured = configured[provider] or env_keys[provider]
            rows.append({
                "provider": provider, "model": model, "configured": is_configured,
                "available": is_configured and not cooling,
                "status": "not_configured" if not is_configured else "exhausted" if cooling else doc.get("status", "available"),
                "cooldown_until": cooldown.isoformat() if cooldown else None,
                "request_count": doc.get("request_count", 0), "success_count": doc.get("success_count", 0),
                "error_count": doc.get("error_count", 0), "rate_limit_count": doc.get("rate_limit_count", 0),
                "input_tokens": doc.get("input_tokens", 0), "output_tokens": doc.get("output_tokens", 0),
                "last_used": doc.get("last_used").isoformat() if doc.get("last_used") else None,
                "last_error": doc.get("last_error", ""),
            })
    return rows


@mcp.tool()
async def get_model_usage(provider: str, model: str) -> dict:
    """Get request, token, error, and cooldown information for one provider model."""
    row = next((item for item in await list_model_availability() if item["provider"] == provider and item["model"] == model), None)
    if row is None:
        raise ValueError(f"Unknown provider/model: {provider}/{model}")
    return row


@mcp.tool()
async def mark_model_exhausted(provider: str, model: str, reason: str = "provider quota/rate limit") -> dict:
    """Manually cool down a model so routing will avoid it temporarily."""
    if provider not in PROVIDER_MODELS or model not in PROVIDER_MODELS[provider]:
        raise ValueError(f"Unknown provider/model: {provider}/{model}")
    now = datetime.now(timezone.utc)
    until = now + timedelta(minutes=15)
    await _model_usage().update_one(
        {"provider": provider, "model": model},
        {"$inc": {"rate_limit_count": 1}, "$set": {"provider": provider, "model": model, "status": "exhausted", "cooldown_until": until, "last_error": reason[:300], "updated_at": now}},
        upsert=True,
    )
    await _log_trace("model_exhausted", {"provider": provider, "model": model, "reason": reason[:300], "cooldown_until": until.isoformat()})
    return {"ok": True, "provider": provider, "model": model, "cooldown_until": until.isoformat()}


# ---------------------------------------------------------------------------
# Tool 10: update_profile
# ---------------------------------------------------------------------------
@mcp.tool()
async def update_profile(text_resume: Optional[str] = None, skills: Optional[list[str]] = None,
                         profile_summary: Optional[str] = None) -> dict:
    """Update profile summary (or legacy resume text) and skills from the chat."""
    updates: dict = {}
    if text_resume is not None:
        updates["profile_summary"] = text_resume
    if profile_summary is not None:
        updates["profile_summary"] = profile_summary
    if skills is not None:
        updates["skills"] = skills

    if not updates:
        raise ValueError("Must provide either text_resume or skills.")

    result = await _profiles().find_one_and_update(
        {"_id": "global"},
        {"$set": updates},
        upsert=True,
        return_document=True,
    )
    log.info("profile_updated", fields=list(updates.keys()))
    await _log_trace("update_profile", {"fields": list(updates.keys())})
    return _serialize(result)


# ---------------------------------------------------------------------------
# Tool 11: update_preferences
# ---------------------------------------------------------------------------
@mcp.tool()
async def update_preferences(preferences: list[str]) -> dict:
    """Update or append user's overarching job preferences."""
    result = await _profiles().find_one_and_update(
        {"_id": "global"},
        {"$set": {"additional_preferences": preferences}},
        upsert=True,
        return_document=True,
    )
    log.info("preferences_updated", count=len(preferences))
    await _log_trace("update_preferences", {"count": len(preferences)})
    return _serialize(result)


# ---------------------------------------------------------------------------
# Tool 12: web_search
# ---------------------------------------------------------------------------
@mcp.tool()
async def web_search(query: str) -> str:
    """
    Search the web for information using DuckDuckGo.
    Crucial for finding exact company careers pages or job market stats.
    """
    def search_duckduckgo() -> list[dict]:
        from duckduckgo_search import DDGS

        # Keep a compatible generic browser profile across duckduckgo-search
        # and primp versions; newer randomized profiles can be rejected.
        class CompatibleDDGS(DDGS):
            _impersonates = ("chrome",)

        return [
            {"title": item.get("title", ""), "url": item.get("href", ""),
             "snippet": item.get("body", ""), "source": "DuckDuckGo"}
            for item in CompatibleDDGS(timeout=15).text(query, max_results=5)
            if item.get("href")
        ]

    def search_bing_rss() -> list[dict]:
        # DuckDuckGo temporarily rate-limits automated requests (HTTP 202).
        # Bing's RSS endpoint provides a keyless fallback for this local app.
        import httpx

        response = httpx.get(
            "https://www.bing.com/search",
            params={"q": query, "format": "rss"},
            headers={"User-Agent": "Mozilla/5.0 PrepStudio/1.0"},
            timeout=15,
            follow_redirects=True,
        )
        response.raise_for_status()
        root = ET.fromstring(response.content)
        sources = []
        for item in root.findall(".//item")[:5]:
            title = item.findtext("title", default="")
            url = item.findtext("link", default="")
            snippet = item.findtext("description", default="")
            if url:
                sources.append({
                    "title": html.unescape(title), "url": url,
                    "snippet": html.unescape(snippet), "source": "Bing",
                })
        return sources

    errors = []
    for provider, search in (("DuckDuckGo", search_duckduckgo), ("Bing", search_bing_rss)):
        try:
            sources = await asyncio.to_thread(search)
            if not sources:
                errors.append(f"{provider} returned no results")
                continue
            log.info("web_search_performed", query=query, provider=provider, result_count=len(sources))
            await _log_trace("web_search", {"query": query, "provider": provider, "sources": sources})
            return json.dumps({"query": query, "provider": provider, "results": sources})
        except Exception as e:
            error = str(e)
            errors.append(f"{provider}: {error}")
            log.warning("web_search_provider_failed", query=query, provider=provider, error=error)

    error_message = "; ".join(errors)
    log.error("web_search_failed", query=query, error=error_message)
    return json.dumps({"query": query, "error": error_message or "No search results available"})


# ---------------------------------------------------------------------------
# Entry point — run as standalone HTTP server
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    log.info("starting_mcp_server", port=settings.mcp_server_port, transport="http")
    mcp.run(transport="http", host="0.0.0.0", port=settings.mcp_server_port, path="/mcp")
