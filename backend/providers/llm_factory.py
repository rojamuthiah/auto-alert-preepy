"""
LLM Provider Factory — returns a LangChain chat model based on provider name.
API keys are read from settings (DB takes precedence over .env).
"""
from __future__ import annotations
from functools import lru_cache
from langchain_core.language_models import BaseChatModel
from config import get_settings
from logger import get_logger

log = get_logger("llm_factory")
settings = get_settings()
PROVIDER_MODELS = {
    # The current LangChain 0.x Gemini adapter drops Gemini 3 thought
    # signatures on tool calls. Keep tool-using agents on the compatible 2.5 API.
    "gemini": ("gemini-2.5-flash",),
    "openai": ("gpt-5.2", "gpt-5-mini", "gpt-4.1"),
    "claude": ("claude-sonnet-5", "claude-haiku-4-5"),
}
DEFAULT_MODELS = {provider: models[0] for provider, models in PROVIDER_MODELS.items()}


def get_supported_model_registry() -> dict[str, dict[str, str | list[str]]]:
    return {
        provider: {
            "default_model": DEFAULT_MODELS[provider],
            "models": list(models),
        }
        for provider, models in PROVIDER_MODELS.items()
    }


def normalize_model(provider: str, model: str | None) -> str:
    provider_name = (provider or "").lower().strip()
    if provider_name not in PROVIDER_MODELS:
        return str(model or "").strip()
    selected = (model or "").strip()
    if not selected or selected.lower() == provider_name:
        return DEFAULT_MODELS[provider_name]
    if selected not in PROVIDER_MODELS[provider_name]:
        return DEFAULT_MODELS[provider_name]
    return selected


async def get_llm(provider: str, api_key: str | None = None, model: str | None = None) -> BaseChatModel:
    """
    Returns the appropriate LangChain LLM instance.
    api_key: override key (from settings DB). Falls back to .env.
    """
    provider = provider.lower().strip()
    if provider not in PROVIDER_MODELS:
        raise ValueError(f"Unknown provider '{provider}'. Supported: {', '.join(PROVIDER_MODELS)}")
    selected_model = normalize_model(provider, model)
    if selected_model not in PROVIDER_MODELS[provider]:
        raise ValueError(f"Model '{selected_model}' is not supported for {provider}.")

    if provider == "openai":
        from langchain_openai import ChatOpenAI
        key = api_key or settings.openai_api_key
        if not key:
            raise ValueError("OpenAI API key not configured. Add it in Settings.")
        log.info("llm_selected", provider="openai", model=selected_model)
        return ChatOpenAI(model=selected_model, api_key=key, streaming=True)

    if provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI
        key = api_key or settings.gemini_api_key
        if not key:
            raise ValueError("Gemini API key not configured. Add it in Settings.")
        log.info("llm_selected", provider="gemini", model=selected_model)
        return ChatGoogleGenerativeAI(
            model=selected_model, google_api_key=key, timeout=180, max_retries=1
        )

    from langchain_anthropic import ChatAnthropic
    key = api_key or settings.claude_api_key
    if not key:
        raise ValueError("Claude API key not configured. Add it in LLM settings.")
    log.info("llm_selected", provider="claude", model=selected_model)
    return ChatAnthropic(model=selected_model, api_key=key, timeout=180, max_retries=1)


async def get_llm_from_db(provider: str, model: str | None = None) -> BaseChatModel:
    """Fetches the API key from the settings collection, then returns LLM."""
    from db.mongo import settings_col
    doc = await settings_col().find_one({"_id": "global"})
    api_key = None
    if doc and "providers" in doc:
        api_key = doc["providers"].get(provider, {}).get("api_key")
    return await get_llm(provider, api_key=api_key, model=model)
