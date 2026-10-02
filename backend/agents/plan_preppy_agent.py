"""
Plan Preppy Agent — LangGraph ReAct agent that generates job tracking plans.
Streams events: text tokens, tool calls, tool results (like Claude Code).
"""
from __future__ import annotations

import asyncio
import json
import sys
import os
from datetime import datetime, timezone
from typing import AsyncIterator, Any

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from langchain_core.messages import (
    AIMessage,
    BaseMessage,
    HumanMessage,
    SystemMessage,
    ToolMessage,
)
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent

from config import get_settings
from logger import get_agent_logger, get_logger
from providers.llm_factory import DEFAULT_MODELS
from providers.model_router import ModelUsageCallback, create_model, get_model_candidates
from db.mongo import settings_col

settings = get_settings()
log = get_logger("plan_preppy_agent")
agent_log = get_agent_logger("plan_preppy")

AGENT_NAME = "Plan Preppy"

SYSTEM_PROMPT = """You are Plan Preppy, a job search planning assistant inside Prep Studio.

Help users build and manage structured job tracking plans, and answer job-search questions related to those plans. Reply naturally to greetings such as "Hi" without trying to create a plan. Create a plan only when the user asks for one or clearly gives a target they want organized. Use the existing plan tools to answer questions about, or edit, plans in this chat.

FIRST: Always call `get_profile`. Use any available career or job-targeting details from the profile, including summary, resume text, skills, experience, projects, education, desired roles, preferred locations, and job preferences. Do not require every field. If the profile is entirely blank, ask the user to add profile details or share their target role and location in chat. If they share background or skills in chat, call `update_profile` to save the relevant details, then proceed with the plan.

When generating plans, ALWAYS incorporate the user's saved profile summary, skills, work experience, projects, preferred locations, job preference, and additional preferences.
If the user tells you a new job-search constraint, call `update_preferences` to remember it in additional preferences before continuing.

When the user asks for companies or roles to apply for:
1. Use the `web_search` tool extensively. Search the web to find relevant companies, determine their tier/priority based on market standing, and **most importantly, search to find their exact careers/jobs page URL**. Do not hallucinate URLs. If a search call returns an error, retry once with a shorter query before concluding that web search is unavailable.
2. Generate a concise plan name (e.g. "Backend Roles 2025") and a slug key (e.g. "backend-roles-2025")
3. Build rows with exactly these fields:
   - company: company name
   - tier: T1 / T2 / T3 / T4 / T5  (T1 = top tier, T5 = entry)
   - priority: High / Medium / Low
   - remarks: short note (hiring trend, role focus, etc.)
   - careers_page: exact URL found through search; use "-" if it cannot be verified
   - Include supporting search results as sources with title, url, and snippet
4. Call `create_plan` with rows, sources, and current chat_id.
5. After creation, show the plan as a markdown table and tell the user they can edit it below and move it to Job Plans. Explain any "-" careers page is unverified and can be completed later.

## Rules
- Never show internal plan IDs or database keys in user-facing responses. Refer to plans by their names.
- Before editing an existing plan, call list_chat_plans and use the returned plan ID. Do not invent IDs or combine an ID with a plan key.
- Max 200 rows per plan. If user wants more, tell them to create a second plan.
- When user asks to add rows, use append_rows tool.
- When user wants to update name/key, use update_plan tool.
- When user says "add to job plans", call promote_plan tool.
- Lead with the table, then add brief commentary.
"""


def _research_request(messages: list[dict]) -> str | None:
    """Find the active company/job research request, including retry follow-ups."""
    user_texts = [str(msg.get("content", "")).strip() for msg in messages if msg.get("role") == "user"]
    if not user_texts:
        return None
    research_terms = ("company", "companies", "role", "roles", "job", "jobs", "career", "careers", "apply", "hiring")
    explicit_terms = ("find", "search", "recommend", "create", "build", "make", "plan", "target", "list")
    edit_terms = ("edit", "change", "remove", "delete", "rename", "update", "append")
    last_text = user_texts[-1]
    last_lower = last_text.lower()
    if any(term in last_lower for term in research_terms) and (
        any(term in last_lower for term in explicit_terms)
        or not any(term in last_lower for term in edit_terms)
    ):
        return last_text

    retry_terms = ("retry", "try again", "again", "now", "still", "restored", "working")
    if any(term in last_lower for term in retry_terms):
        for previous in reversed(user_texts[:-1]):
            previous_lower = previous.lower()
            if any(term in previous_lower for term in research_terms) and any(term in previous_lower for term in explicit_terms):
                return previous
    return None


def _tool_text(value: Any) -> str:
    if hasattr(value, "content"):
        value = value.content
    if isinstance(value, list):
        return "\n".join(
            item.get("text", "") if isinstance(item, dict) else getattr(item, "text", str(item))
            for item in value
        )
    if isinstance(value, str):
        return value
    return json.dumps(value, default=str)


class StreamEvent:
    """Typed SSE event payloads."""

    @staticmethod
    def text(content: str) -> dict:
        return {"type": "text", "content": content}

    @staticmethod
    def tool_start(tool_name: str, tool_id: str, inputs: dict) -> dict:
        return {
            "type": "tool_start",
            "tool_name": tool_name,
            "tool_id": tool_id,
            "inputs": inputs,
        }

    @staticmethod
    def tool_end(tool_name: str, tool_id: str, output: Any) -> dict:
        return {
            "type": "tool_end",
            "tool_name": tool_name,
            "tool_id": tool_id,
            "output": output,
        }

    @staticmethod
    def error(message: str) -> dict:
        return {"type": "error", "message": message}

    @staticmethod
    def done(full_response: str) -> dict:
        return {"type": "done", "content": full_response}

    @staticmethod
    def plan(plan: dict) -> dict:
        return {"type": "plan", "is_plan": True, "plan": plan}


async def run_plan_preppy(
    chat_id: str,
    messages: list[dict],
    provider: str = "gemini",
    model: str | None = None,
) -> AsyncIterator[str]:
    """
    Run Plan Preppy agent and stream SSE-formatted events.
    Each yielded value is a complete SSE line: "data: {...}\\n\\n"

    Event types (styled like Claude Code):
      text       — partial assistant token
      tool_start — agent is calling an MCP tool
      tool_end   — tool returned a result
      done       — final full assistant message
      error      — something went wrong
    """
    agent_log.info(
        "agent_run_start",
        agent=AGENT_NAME,
        chat_id=chat_id,
        provider=provider,
        model=model,
        message_count=len(messages),
    )

    def _sse(payload: dict) -> str:
        return f"data: {json.dumps(payload)}\n\n"

    try:
        candidates = await get_model_candidates(provider, model or DEFAULT_MODELS.get(provider, ""))
    except ValueError as e:
        yield _sse(StreamEvent.error(str(e)))
        return

    # Build LangChain message history
    lc_messages: list[BaseMessage] = [SystemMessage(
        content=f"{SYSTEM_PROMPT}\n\nCurrent chat_id: {chat_id}\nSelected provider: {provider}\nSelected model: {model or 'provider default'}"
    )]
    for msg in messages:
        role = msg.get("role", "user")
        content = msg.get("content", "")
        if role == "user":
            lc_messages.append(HumanMessage(content=content))
        elif role == "assistant":
            lc_messages.append(AIMessage(content=content))

    # Connect to MCP server
    mcp_url = f"http://localhost:{settings.mcp_server_port}/mcp"

    try:
        mcp_client = MultiServerMCPClient(
            {"prep-studio-plans": {"url": mcp_url, "transport": "streamable_http"}}
        )
        tools = await mcp_client.get_tools()

        # A prior assistant apology can otherwise cause the model to repeat the
        # failure without invoking the search tool again. Fetch current sources
        # before the model turn whenever the user is asking for company research.
        research_request = _research_request(messages)
        if research_request:
            search_tool = next((tool for tool in tools if tool.name.endswith("web_search")), None)
            if search_tool:
                query = f"{research_request[:180]} company jobs careers page"
                agent_log.info("plan_research_started", chat_id=chat_id, query=query)
                yield _sse(StreamEvent.tool_start("web_search", "plan-research", {"query": query}))
                try:
                    result_text = _tool_text(await search_tool.ainvoke({"query": query}))
                except Exception as search_error:
                    result_text = json.dumps({"query": query, "error": str(search_error)})
                try:
                    result_data = json.loads(result_text)
                except (TypeError, json.JSONDecodeError):
                    result_data = {"raw_result": result_text}
                if result_data.get("error") or not result_data.get("results"):
                    retry_query = f"{research_request[:100]} company careers jobs"
                    agent_log.warning("plan_research_retry", chat_id=chat_id, query=retry_query, error=result_data.get("error"))
                    yield _sse(StreamEvent.tool_start("web_search", "plan-research-retry", {"query": retry_query}))
                    try:
                        retry_text = _tool_text(await search_tool.ainvoke({"query": retry_query}))
                    except Exception as search_error:
                        retry_text = json.dumps({"query": retry_query, "error": str(search_error)})
                    try:
                        retry_data = json.loads(retry_text)
                    except (TypeError, json.JSONDecodeError):
                        retry_data = {"raw_result": retry_text}
                    if retry_data.get("results"):
                        result_data = retry_data
                    else:
                        result_data = {"query": retry_query, "error": retry_data.get("error", result_data.get("error", "No results returned."))}
                yield _sse(StreamEvent.tool_end("web_search", "plan-research", result_data))
                agent_log.info(
                    "plan_research_completed",
                    chat_id=chat_id,
                    result_count=len(result_data.get("results", [])),
                    failed=bool(result_data.get("error")),
                )
                if result_data.get("results"):
                    lc_messages[0] = SystemMessage(
                        content=f"{lc_messages[0].content}\n\nFresh web search results for this plan request (use these sources in the plan and source list):\n{json.dumps(result_data, ensure_ascii=False)}"
                    )
            else:
                agent_log.error("plan_research_tool_missing", chat_id=chat_id)
        model_routes = []
        for candidate in candidates:
            llm = await create_model(candidate)
            bound = llm.bind_tools(tools)
            bound = bound.with_config({"callbacks": [ModelUsageCallback(candidate["provider"], candidate["model"])], "metadata": {"provider": candidate["provider"], "model": candidate["model"]}})
            model_routes.append(bound)
        routed_llm = model_routes[0] if len(model_routes) == 1 else model_routes[0].with_fallbacks(model_routes[1:], exceptions_to_handle=(Exception,))
        agent = create_react_agent(routed_llm, tools)

        callbacks = []
        langfuse_doc = await settings_col().find_one({"_id": "global"}) or {}
        langfuse_settings = langfuse_doc.get("langfuse", {})
        langfuse_public_key = langfuse_settings.get("public_key") or settings.langfuse_public_key
        langfuse_secret_key = langfuse_settings.get("secret_key") or settings.langfuse_secret_key
        if langfuse_public_key and langfuse_secret_key:
            try:
                from langfuse import Langfuse
                from langfuse.langchain import CallbackHandler
                Langfuse(
                    public_key=langfuse_public_key,
                    secret_key=langfuse_secret_key,
                    base_url=langfuse_settings.get("base_url") or settings.langfuse_base_url or None,
                )
                # Bind the handler to the exact configured Langfuse project.
                callbacks.append(CallbackHandler(public_key=langfuse_public_key))
            except Exception as exc:
                log.warning("langfuse_initialization_failed", error=str(exc))

        full_response_parts: list[str] = []
        created_plan: dict | None = None
        pending_tool_calls: dict[str, dict] = {}  # tool_call_id → {name, inputs}

        # Stream events from LangGraph
        async for event in agent.astream_events(
            {"messages": lc_messages},
            version="v2",
            config={
                "callbacks": callbacks,
                "metadata": {
                    "langfuse_session_id": chat_id,
                    "langfuse_tags": ["conversation", f"requested-provider:{provider}"],
                    "provider": provider,
                    "model": model or DEFAULT_MODELS.get(provider, ""),
                },
            },
        ):
            kind = event.get("event", "")
            data = event.get("data", {})

            # ── Text token streaming ──────────────────────────────────
            if kind == "on_chat_model_stream":
                chunk = data.get("chunk")
                if chunk and hasattr(chunk, "content") and chunk.content:
                    token = chunk.content
                    full_response_parts.append(token)
                    yield _sse(StreamEvent.text(token))
                    agent_log.debug("token", agent=AGENT_NAME, token=token[:50])

            # ── Tool call start ───────────────────────────────────────
            elif kind == "on_tool_start":
                tool_name = event.get("name", "unknown_tool")
                run_id = event.get("run_id", "")
                inputs = data.get("input", {})
                pending_tool_calls[run_id] = {"name": tool_name, "inputs": inputs}

                agent_log.info(
                    "tool_call_start",
                    agent=AGENT_NAME,
                    tool=tool_name,
                    inputs=inputs,
                )
                yield _sse(StreamEvent.tool_start(tool_name, run_id, inputs))

            # ── Tool call end ─────────────────────────────────────────
            elif kind == "on_tool_end":
                run_id = event.get("run_id", "")
                tool_info = pending_tool_calls.pop(run_id, {})
                tool_name = tool_info.get("name", event.get("name", "unknown_tool"))
                output = data.get("output")

                # Serialize output safely
                if hasattr(output, "content"):
                    out_str = output.content
                else:
                    try:
                        out_str = json.loads(str(output)) if output else {}
                    except Exception:
                        out_str = str(output)

                # MCP tool results may wrap JSON in a text content block.
                if isinstance(out_str, list):
                    text_parts = [item.get("text", "") if isinstance(item, dict) else getattr(item, "text", "") for item in out_str]
                    combined = "".join(part for part in text_parts if part)
                    try:
                        out_str = json.loads(combined)
                    except Exception:
                        out_str = combined or out_str
                elif isinstance(out_str, str):
                    try:
                        out_str = json.loads(out_str)
                    except Exception:
                        pass

                agent_log.info(
                    "tool_call_end",
                    agent=AGENT_NAME,
                    tool=tool_name,
                    output_preview=str(out_str)[:200],
                )
                yield _sse(StreamEvent.tool_end(tool_name, run_id, out_str))
                if "create_plan" in tool_name and isinstance(out_str, dict):
                    created_plan = out_str
                    yield _sse(StreamEvent.plan(created_plan))
                elif "update_plan" in tool_name and isinstance(out_str, dict) and isinstance(out_str.get("rows"), list):
                    created_plan = out_str
                    yield _sse(StreamEvent.plan(created_plan))

    except Exception as exc:
        agent_log.exception("agent_error", agent=AGENT_NAME, error=str(exc))
        error_text = str(exc)
        if "429" in error_text or "quota" in error_text.lower() or "resource_exhausted" in error_text.lower():
            message = "Gemini is temporarily rate-limited. Wait about a minute and retry, or add another provider in LLM settings so Prep Studio can route around the quota."
        else:
            message = f"Agent error: {error_text}"
        yield _sse(StreamEvent.error(message))
        return

    full_response = "".join(full_response_parts)
    agent_log.info(
        "agent_run_complete",
        agent=AGENT_NAME,
        chat_id=chat_id,
        response_length=len(full_response),
    )
    done_event = StreamEvent.done(full_response)
    if created_plan:
        done_event.update({"is_plan": True, "plan": created_plan})
    yield _sse(done_event)
