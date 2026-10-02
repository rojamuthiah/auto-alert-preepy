"""
FastAPI router for Traces.
"""
from __future__ import annotations
from bson import ObjectId
from fastapi import APIRouter, Query
from db.mongo import model_usage_col, settings_col, traces_col
from models.chat import TraceDoc
from logger import get_logger
from config import get_settings

log = get_logger("router.traces")
router = APIRouter(prefix="/traces", tags=["traces"])

VALID_TYPES = {"conversation", "workflow", "preppy", "plan_tool", "overall", "model_usage"}


@router.get("")
async def list_traces(
    type: str | None = Query(default=None),
    workflow_id: str | None = Query(default=None),
    run_id: str | None = Query(default=None),
    limit: int = Query(default=50, le=200),
) -> list[dict]:
    query: dict = {}
    filters: list[dict] = []

    if type and type in VALID_TYPES:
        filters.append({"type": type})

    if workflow_id:
        normalized = workflow_id.strip()
        workflow_filter = {"$or": [
            {"workflow_id": normalized},
            {"payload.workflow_id": normalized},
        ]}
        if ObjectId.is_valid(normalized):
            workflow_filter["$or"].append({"workflow_id": ObjectId(normalized)})
            workflow_filter["$or"].append({"payload.workflow_id": ObjectId(normalized)})
        filters.append(workflow_filter)

    if run_id:
        normalized_run = run_id.strip()
        run_filter = {"$or": [
            {"run_id": normalized_run},
            {"payload.run_id": normalized_run},
        ]}
        filters.append(run_filter)

    if filters:
        query["$and"] = filters

    cursor = traces_col().find(query).sort("created_at", -1).limit(limit)
    docs = await cursor.to_list(length=limit)
    return [TraceDoc.from_mongo(d).model_dump() for d in docs]


# Register the static path before /{trace_id}, otherwise "overview" is parsed as an ID.
@router.get("/overview")
async def traces_overview() -> dict:
    grouped = await traces_col().aggregate([{"$group": {"_id": "$type", "count": {"$sum": 1}}}]).to_list(length=20)
    counts = {item["_id"]: item["count"] for item in grouped if item.get("_id")}
    usage_docs = await model_usage_col().find({}).to_list(length=100)
    usage = {
        "models": len(usage_docs),
        "requests": sum(int(item.get("request_count", 0)) for item in usage_docs),
        "successes": sum(int(item.get("success_count", 0)) for item in usage_docs),
        "errors": sum(int(item.get("error_count", 0)) for item in usage_docs),
        "input_tokens": sum(int(item.get("input_tokens", 0)) for item in usage_docs),
        "output_tokens": sum(int(item.get("output_tokens", 0)) for item in usage_docs),
    }
    langfuse = get_settings()
    langfuse_doc = (await settings_col().find_one({"_id": "global"}) or {}).get("langfuse", {})
    public_key = langfuse_doc.get("public_key") or langfuse.langfuse_public_key
    secret_key = langfuse_doc.get("secret_key") or langfuse.langfuse_secret_key
    last = await traces_col().find_one({}, sort=[("created_at", -1)])
    return {
        "total": sum(counts.values()),
        "counts_by_type": counts,
        "model_usage": usage,
        "last_activity": last.get("created_at") if last else None,
        "langfuse_configured": bool(public_key and secret_key),
        "langfuse_base_url": langfuse_doc.get("base_url") or langfuse.langfuse_base_url or None,
    }


@router.get("/{trace_id}")
async def get_trace(trace_id: str) -> dict:
    from bson import ObjectId
    from fastapi import HTTPException
    doc = await traces_col().find_one({"_id": ObjectId(trace_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Trace not found")
    return TraceDoc.from_mongo(doc).model_dump()
