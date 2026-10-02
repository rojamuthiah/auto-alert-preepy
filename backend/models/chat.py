"""
Pydantic models for Chats and Messages.
"""
from __future__ import annotations
from datetime import datetime
from typing import Literal
from pydantic import BaseModel, Field


class Message(BaseModel):
    role: Literal["user", "assistant", "tool"]
    content: str
    metadata: dict = Field(default_factory=dict)
    created_at: datetime = Field(default_factory=datetime.utcnow)


class ChatCreate(BaseModel):
    title: str = "New Chat"
    provider: Literal["gemini", "openai", "claude"] = "gemini"
    model: str = "gemini-2.5-flash"


class ChatTitleUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=100)


class ChatDoc(BaseModel):
    id: str
    title: str
    messages: list[Message] = []
    created_at: datetime
    provider: str = "gemini"
    model: str = "gemini-2.5-flash"

    @classmethod
    def from_mongo(cls, doc: dict) -> "ChatDoc":
        doc["id"] = str(doc.pop("_id"))
        return cls(**doc)


class ChatSummary(BaseModel):
    """Lightweight chat for sidebar list."""
    id: str
    title: str
    created_at: datetime
    updated_at: datetime | None = None
    provider: str = "gemini"
    model: str = "gemini-2.5-flash"

    @classmethod
    def from_mongo(cls, doc: dict) -> "ChatSummary":
        doc["id"] = str(doc.pop("_id"))
        return cls(**doc)


class ChatMessageRequest(BaseModel):
    content: str


class TraceDoc(BaseModel):
    """A single trace/log event."""
    id: str
    type: str          # conversation | workflow | preppy | overall
    source: str        # agent name or router name
    payload: dict
    created_at: datetime

    @classmethod
    def from_mongo(cls, doc: dict) -> "TraceDoc":
        doc["id"] = str(doc.pop("_id"))
        return cls(**doc)
