"""Usage-aware model routing and fallback state shared by the API and MCP tools."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from langchain_core.callbacks import AsyncCallbackHandler

from config import get_settings
from db.mongo import model_usage_col, settings_col, traces_col
from logger import get_logger
from providers.llm_factory import DEFAULT_MODELS, PROVIDER_MODELS, get_llm

log = get_logger("model_router")
PROVIDER_ORDER = ("gemini", "openai", "claude")
EXHAUSTED_COOLDOWN = timedelta(minutes=15)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def classify_model_error(error: BaseException) -> str:
    status = getattr(error, "status_code", None) or getattr(error, "status", None)
    message = str(error).lower()
    if status == 429 or any(marker in message for marker in ("resource_exhausted", "insufficient_quota", "quota exceeded", "rate limit", "rate_limit")):
        return "exhausted"
    if status in (401, 403) or any(marker in message for marker in ("invalid api key", "authentication_error", "unauthorized")):
        return "invalid_key"
    if isinstance(status, int) and status >= 500:
        return "temporary_error"
    return "error"


async def _configured_keys() -> dict[str, str]:
    env = get_settings()
    fallback_keys = {
        "openai": env.openai_api_key,
        "gemini": env.gemini_api_key,
        "claude": env.claude_api_key,
    }
    doc = await settings_col().find_one({"_id": "global"}) or {}
    providers = doc.get("providers", {})
    return {
        provider: (providers.get(provider, {}).get("api_key") or fallback_keys.get(provider) or "")
        for provider in PROVIDER_MODELS
    }


async def model_availability() -> list[dict[str, Any]]:
    keys = await _configured_keys()
    docs = await model_usage_col().find({}).to_list(length=100)
    usage = {(doc.get("provider"), doc.get("model")): doc for doc in docs}
    now = _now()
    result = []
    for provider in PROVIDER_ORDER:
        for model in PROVIDER_MODELS[provider]:
            doc = usage.get((provider, model), {})
            cooldown_until = doc.get("cooldown_until")
            cooling = bool(cooldown_until and cooldown_until > now)
            result.append({
                "provider": provider,
                "model": model,
                "configured": bool(keys.get(provider)),
                "available": bool(keys.get(provider)) and not cooling,
                "status": "not_configured" if not keys.get(provider) else doc.get("status", "available") if not cooling else "exhausted",
                "cooldown_until": cooldown_until,
                "request_count": int(doc.get("request_count", 0)),
                "success_count": int(doc.get("success_count", 0)),
                "error_count": int(doc.get("error_count", 0)),
                "rate_limit_count": int(doc.get("rate_limit_count", 0)),
                "input_tokens": int(doc.get("input_tokens", 0)),
                "output_tokens": int(doc.get("output_tokens", 0)),
                "last_used": doc.get("last_used"),
                "last_error": doc.get("last_error", ""),
            })
    return result


async def get_model_candidates(primary_provider: str, primary_model: str) -> list[dict[str, Any]]:
    if primary_provider not in PROVIDER_MODELS or primary_model not in PROVIDER_MODELS[primary_provider]:
        raise ValueError("The selected provider/model is not supported.")
    keys = await _configured_keys()
    availability = await model_availability()
    by_key = {(item["provider"], item["model"]): item for item in availability}
    order = [(primary_provider, primary_model)]
    order.extend((primary_provider, model) for model in PROVIDER_MODELS[primary_provider] if model != primary_model)
    for provider in PROVIDER_ORDER:
        if provider == primary_provider:
            continue
        order.append((provider, DEFAULT_MODELS[provider]))
        order.extend((provider, model) for model in PROVIDER_MODELS[provider] if model != DEFAULT_MODELS[provider])
    candidates = []
    for provider, model in order:
        if not keys.get(provider) or not by_key[(provider, model)]["available"]:
            continue
        candidates.append({"provider": provider, "model": model, "api_key": keys[provider]})
    if not candidates:
        raise ValueError("No configured models are currently available. Check provider keys or wait for model cooldowns to expire.")
    selected = candidates[0]
    if (selected["provider"], selected["model"]) != (primary_provider, primary_model):
        await _trace_route("model_rerouted", {
            "requested_provider": primary_provider,
            "requested_model": primary_model,
            "active_provider": selected["provider"],
            "active_model": selected["model"],
            "reason": "selected model is cooling down or not configured",
        })
        log.warning("model_rerouted", requested_provider=primary_provider, requested_model=primary_model, active_provider=selected["provider"], active_model=selected["model"])
    return candidates


async def _trace_route(event: str, payload: dict[str, Any]) -> None:
    try:
        await traces_col().insert_one({"type": "model_usage", "source": event, "payload": payload, "created_at": _now()})
    except Exception as exc:
        log.warning("model_usage_trace_failed", error=str(exc))


async def _record_attempt(provider: str, model: str) -> None:
    now = _now()
    await model_usage_col().update_one(
        {"provider": provider, "model": model},
        {"$inc": {"request_count": 1}, "$set": {"status": "in_flight", "last_used": now, "updated_at": now}},
        upsert=True,
    )
    await _trace_route("model_request_started", {"provider": provider, "model": model})


async def _record_success(provider: str, model: str, input_tokens: int = 0, output_tokens: int = 0) -> None:
    now = _now()
    await model_usage_col().update_one(
        {"provider": provider, "model": model},
        {"$inc": {"success_count": 1, "input_tokens": input_tokens, "output_tokens": output_tokens}, "$set": {"status": "available", "last_success": now, "updated_at": now}, "$unset": {"cooldown_until": "", "last_error": ""}},
        upsert=True,
    )
    await _trace_route("model_request_succeeded", {"provider": provider, "model": model, "input_tokens": input_tokens, "output_tokens": output_tokens})


async def _record_error(provider: str, model: str, error: BaseException) -> None:
    state = classify_model_error(error)
    now = _now()
    updates: dict[str, Any] = {"status": state, "last_error": str(error)[:300], "last_error_at": now, "updated_at": now}
    if state in {"exhausted", "invalid_key"}:
        updates["cooldown_until"] = now + EXHAUSTED_COOLDOWN
    await model_usage_col().update_one(
        {"provider": provider, "model": model},
        {"$inc": {"error_count": 1, "rate_limit_count": 1 if state == "exhausted" else 0}, "$set": updates},
        upsert=True,
    )
    await _trace_route("model_request_failed", {"provider": provider, "model": model, "state": state, "error": str(error)[:300]})
    log.warning("model_request_failed", provider=provider, model=model, status=state, error=str(error)[:300])


class ModelUsageCallback(AsyncCallbackHandler):
    """Record request health and token usage for one concrete provider/model."""

    def __init__(self, provider: str, model: str):
        self.provider = provider
        self.model = model

    async def on_chat_model_start(self, serialized: dict[str, Any], messages: list[list[Any]], **kwargs: Any) -> None:
        await _record_attempt(self.provider, self.model)

    async def on_llm_end(self, response: Any, **kwargs: Any) -> None:
        usage = getattr(response, "llm_output", None) or {}
        token_usage = usage.get("token_usage", {}) if isinstance(usage, dict) else {}
        if not token_usage:
            generations = getattr(response, "generations", [])
            message = generations[0][0].message if generations and generations[0] else None
            token_usage = getattr(message, "usage_metadata", None) or {}
        input_tokens = int(token_usage.get("prompt_tokens", token_usage.get("input_tokens", 0)) or 0)
        output_tokens = int(token_usage.get("completion_tokens", token_usage.get("output_tokens", 0)) or 0)
        await _record_success(self.provider, self.model, input_tokens, output_tokens)

    async def on_llm_error(self, error: BaseException, **kwargs: Any) -> None:
        await _record_error(self.provider, self.model, error)


async def create_model(candidate: dict[str, Any]):
    return await get_llm(candidate["provider"], api_key=candidate["api_key"], model=candidate["model"])
