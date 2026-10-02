"""
Pydantic models for Plans and Plan Rows.
These are shared between the MCP server, API routers, and agent.
"""
from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field
from bson import ObjectId


class PlanRow(BaseModel):
    company: str
    tier: str = Field(..., pattern=r"^T[1-5]$", description="T1–T5 company tier")
    priority: str = Field(..., pattern=r"^(High|Medium|Low)$")
    remarks: str = ""
    careers_page: str = ""


class PlanCreate(BaseModel):
    chat_id: str
    name: str
    key: str
    provider: str = "gemini"
    rows: list[PlanRow] = Field(default_factory=list, max_length=200)
    sources: list[dict] = Field(default_factory=list)


class PlanUpdate(BaseModel):
    name: Optional[str] = None
    key: Optional[str] = None
    rows: Optional[list[PlanRow]] = Field(default=None, max_length=200)


class PlanRowAppend(BaseModel):
    plan_id: str
    rows: list[PlanRow] = Field(..., min_length=1, max_length=200)


class PlanDoc(BaseModel):
    """Serialisable plan document returned from DB."""
    id: str
    chat_id: str
    name: str
    key: str
    provider: str
    hidden: bool
    rows: list[PlanRow]
    sources: list[dict] = Field(default_factory=list)
    created_at: datetime

    @classmethod
    def from_mongo(cls, doc: dict) -> "PlanDoc":
        doc["id"] = str(doc.pop("_id"))
        doc["chat_id"] = str(doc["chat_id"])
        return cls(**doc)


class PlanSummary(BaseModel):
    """Lightweight plan for list responses (no rows)."""
    id: str
    chat_id: str
    name: str
    key: str
    provider: str
    hidden: bool
    row_count: int
    created_at: datetime

    @classmethod
    def from_mongo(cls, doc: dict) -> "PlanSummary":
        doc["id"] = str(doc.pop("_id"))
        doc["chat_id"] = str(doc["chat_id"])
        doc["row_count"] = len(doc.get("rows", []))
        doc.pop("rows", None)
        return cls(**doc)
