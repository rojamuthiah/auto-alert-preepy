"""
FastAPI router for Chats.
POST /chats/{chat_id}/message streams Plan Preppy agent response as SSE.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, HTTPException
from fastapi.responses import Response, StreamingResponse
from sse_starlette.sse import EventSourceResponse

from db.mongo import chats_col, profiles_col, traces_col
from models.chat import ChatCreate, ChatDoc, ChatMessageRequest, ChatSummary, ChatTitleUpdate, Message
from agents.plan_preppy_agent import run_plan_preppy
from providers.llm_factory import PROVIDER_MODELS
from providers.llm_factory import get_llm_from_db
from logger import get_logger

log = get_logger("router.chats")
router = APIRouter(prefix="/chats", tags=["chats"])


def missing_profile_fields(profile: dict) -> list[str]:
    missing = []
    if not profile.get("skills"):
        missing.append("at least one skill")
    if not profile.get("job_preference"):
        missing.append("a work preference")
    if not profile.get("preferred_locations"):
        missing.append("at least one preferred location")
    return missing


# ---------------------------------------------------------------------------
# POST /chats  — create new chat
# ---------------------------------------------------------------------------
@router.post("", status_code=201)
async def create_chat(body: ChatCreate) -> dict:
    if body.model not in PROVIDER_MODELS.get(body.provider, ()):
        raise HTTPException(status_code=422, detail=f"Model '{body.model}' is not supported for {body.provider}.")
    profile = await profiles_col().find_one({"_id": "global"}) or {}
    missing = missing_profile_fields(profile)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Complete your profile before starting a conversation: {', '.join(missing)}. Open Profile, fill the required fields, save, then return to chat.",
        )
    try:
        await get_llm_from_db(body.provider, model=body.model)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    doc = {
        "title": body.title,
        "provider": body.provider,
        "model": body.model,
        "messages": [],
        "created_at": datetime.now(timezone.utc),
        "updated_at": datetime.now(timezone.utc),
    }
    result = await chats_col().insert_one(doc)
    log.info("chat_created", chat_id=str(result.inserted_id), title=body.title)
    return {"chat_id": str(result.inserted_id), "title": body.title, "provider": body.provider, "model": body.model}


# ---------------------------------------------------------------------------
# GET /chats  — list all chats (sidebar)
# ---------------------------------------------------------------------------
@router.get("")
async def list_chats() -> list[dict]:
    cursor = chats_col().find({}, {"messages": 0}).sort([("updated_at", -1), ("created_at", -1)])
    docs = await cursor.to_list(length=None)
    return [ChatSummary.from_mongo(d).model_dump() for d in docs]


# ---------------------------------------------------------------------------
# GET /chats/{chat_id}  — get chat with full history
# ---------------------------------------------------------------------------
@router.get("/{chat_id}")
async def get_chat(chat_id: str) -> dict:
    doc = await chats_col().find_one({"_id": ObjectId(chat_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Chat not found")
    return ChatDoc.from_mongo(doc).model_dump()


# ---------------------------------------------------------------------------
# PATCH /chats/{chat_id} — rename a conversation
# ---------------------------------------------------------------------------
@router.patch("/{chat_id}")
async def rename_chat(chat_id: str, body: ChatTitleUpdate) -> dict:
    title = body.title.strip()
    if not title:
        raise HTTPException(status_code=422, detail="Conversation name cannot be empty.")
    result = await chats_col().update_one(
        {"_id": ObjectId(chat_id)},
        {"$set": {"title": title, "updated_at": datetime.now(timezone.utc)}},
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Conversation not found.")
    log.info("chat_renamed", chat_id=chat_id)
    return {"id": chat_id, "title": title}


# ---------------------------------------------------------------------------
# DELETE /chats/{chat_id}
# ---------------------------------------------------------------------------
@router.delete("/{chat_id}", status_code=204, response_class=Response)
async def delete_chat(chat_id: str) -> Response:
    result = await chats_col().delete_one({"_id": ObjectId(chat_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Chat not found")
    log.info("chat_deleted", chat_id=chat_id)
    return Response(status_code=204)


# ---------------------------------------------------------------------------
# POST /chats/{chat_id}/message  — send message, stream Plan Preppy response
# ---------------------------------------------------------------------------
@router.post("/{chat_id}/message")
async def send_message(chat_id: str, body: ChatMessageRequest) -> StreamingResponse:
    """
    Appends user message, invokes Plan Preppy agent, streams SSE events.

    SSE event format (same stream, different types):
      data: {"type": "text",       "content": "...token..."}
      data: {"type": "tool_start", "tool_name": "...", "tool_id": "...", "inputs": {...}}
      data: {"type": "tool_end",   "tool_name": "...", "tool_id": "...", "output": {...}}
      data: {"type": "done",       "content": "...full response..."}
      data: {"type": "error",      "message": "..."}
    """
    # 1. Verify chat exists
    chat = await chats_col().find_one({"_id": ObjectId(chat_id)})
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    profile = await profiles_col().find_one({"_id": "global"}) or {}
    missing = missing_profile_fields(profile)
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Complete your profile before chatting: {', '.join(missing)}. Open Profile, fill the required fields, save, then return to chat.",
        )

    # 2. Append user message to DB
    user_msg = {
        "role": "user",
        "content": body.content,
        "created_at": datetime.now(timezone.utc),
    }
    await chats_col().update_one(
        {"_id": ObjectId(chat_id)},
        {"$push": {"messages": user_msg}, "$set": {"updated_at": user_msg["created_at"]}},
    )

    provider = chat.get("provider", "gemini")
    model = chat.get("model")
    # Existing conversations may still reference Gemini 3 models created before
    # the available models were restricted to those supported by this adapter.
    if provider == "gemini" and model not in PROVIDER_MODELS["gemini"]:
        model = PROVIDER_MODELS["gemini"][0]
        await chats_col().update_one(
            {"_id": ObjectId(chat_id)},
            {"$set": {"model": model, "updated_at": datetime.now(timezone.utc)}},
        )

    # Build history (exclude the message we just added for history, pass all including it)
    history = [
        {"role": m["role"], "content": m["content"]}
        for m in chat.get("messages", [])
    ]
    history.append({"role": "user", "content": body.content})

    async def event_generator():
        full_response = ""
        response_metadata: dict = {}
        plan_message = "I’ve prepared the plan below. Review the companies, edit any details, then move it to Job Plans."
        async for sse_line in run_plan_preppy(
            chat_id=chat_id,
            messages=history,
            provider=provider,
            model=model,
        ):
            # sse_line is already "data: {...}\n\n"
            yield sse_line

            # Capture full response from done event
            try:
                payload = json.loads(sse_line.removeprefix("data: ").strip())
                if payload.get("type") == "plan" and payload.get("plan"):
                    plan = payload["plan"]
                    response_metadata = {
                        "is_plan": True,
                        "plan_id": plan.get("id"),
                        "plan": plan,
                        "sources": plan.get("sources", []),
                    }
                    full_response = plan_message
                elif payload.get("type") == "done":
                    full_response = plan_message if response_metadata.get("is_plan") else payload.get("content", "")
                    if payload.get("is_plan") and payload.get("plan"):
                        plan = payload["plan"]
                        response_metadata = {
                            "is_plan": True,
                            "plan_id": plan.get("id"),
                            "plan": plan,
                            "sources": plan.get("sources", []),
                        }
                        full_response = plan_message
            except Exception:
                pass

        # 3. Persist assistant reply to DB
        if full_response:
            assistant_msg = {
                "role": "assistant",
                "content": full_response,
                "metadata": response_metadata,
                "created_at": datetime.now(timezone.utc),
            }
            await chats_col().update_one(
                {"_id": ObjectId(chat_id)},
                {"$push": {"messages": assistant_msg}, "$set": {"updated_at": assistant_msg["created_at"]}},
            )

        # 4. Write conversation trace
        await traces_col().insert_one(
            {
                "type": "conversation",
                "source": "plan_preppy_agent",
                "payload": {
                    "chat_id": chat_id,
                    "user_message": body.content,
                    "assistant_response_length": len(full_response),
                    "is_plan": bool(response_metadata.get("is_plan")),
                    "plan_id": response_metadata.get("plan_id"),
                },
                "created_at": datetime.now(timezone.utc),
            }
        )

        log.info(
            "message_complete",
            chat_id=chat_id,
            response_length=len(full_response),
        )

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
