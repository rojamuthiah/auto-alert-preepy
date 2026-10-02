"""Workflow CRUD, scheduling metadata, and manual trigger endpoints."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from bson import ObjectId
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from db.mongo import job_alerts_col, plans_col, traces_col, workflow_matches_col, workflow_runs_col, workflows_col
from logger import get_logger
from providers.llm_factory import PROVIDER_MODELS, normalize_model
from routers.channels import get_channel_status
from workflow_runner import execute_workflow

log = get_logger("router.workflows")
router = APIRouter(prefix="/workflows", tags=["workflows"])

ALLOWED_FREQUENCIES = [
    "every_2_hours",
    "every_3_hours",
    "every_6_hours",
    "every_12_hours",
    "every_24_hours",
]


class WorkflowCreateBody(BaseModel):
    plan_id: str = Field(min_length=1)
    name: str = Field(default="", max_length=80)
    channel: Literal["email", "whatsapp"] = "email"
    target_roles: list[str] = Field(default_factory=list)
    experience: int = Field(default=3, ge=0, le=40)
    frequency: str = "every_12_hours"
    provider: str = "gemini"
    model: str | None = None
    initial_start_time: str | None = None


class WorkflowUpdateBody(BaseModel):
    name: str | None = None
    channel: Literal["email", "whatsapp"] | None = None
    target_roles: list[str] | None = None
    experience: int | None = None
    frequency: str | None = None
    provider: str | None = None
    model: str | None = None
    initial_start_time: str | None = None


def _parse_datetime(value: str | None) -> datetime:
    if value is None:
        return datetime.now(timezone.utc)
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


async def _workflow_response(doc: dict) -> dict:
    plan = await plans_col().find_one({"_id": ObjectId(doc["plan_id"])}) if doc.get("plan_id") else None
    provider = str(doc.get("provider", "gemini")).lower().strip() or "gemini"
    model = normalize_model(provider, doc.get("model"))
    return {
        "id": str(doc["_id"]),
        "plan_id": str(doc["plan_id"]),
        "plan_name": plan.get("name") if plan else doc.get("plan_name"),
        "name": doc.get("name"),
        "channel": doc.get("channel", "email"),
        "target_roles": doc.get("target_roles", []),
        "experience": doc.get("experience", 0),
        "frequency": doc.get("frequency", "every_12_hours"),
        "provider": provider,
        "model": model,
        "enabled": bool(doc.get("enabled", True)),
        "status": doc.get("status", "active"),
        "companies": doc.get("companies", []),
        "initial_start_time": doc.get("initial_start_time"),
        "next_run_at": doc.get("next_run_at"),
        "last_run_at": doc.get("last_run_at"),
        "last_error": doc.get("last_error"),
        "run_count": doc.get("run_count", 0),
        "notification_count": doc.get("notification_count", 0),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }


@router.get("")
async def list_workflows() -> list[dict]:
    cursor = workflows_col().find({}).sort("created_at", -1).limit(200)
    docs = await cursor.to_list(length=200)
    return [await _workflow_response(doc) for doc in docs]


@router.get("/{workflow_id}")
async def get_workflow(workflow_id: str) -> dict:
    doc = await workflows_col().find_one({"_id": ObjectId(workflow_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Workflow not found.")
    return await _workflow_response(doc)


@router.get("/{workflow_id}/runs")
async def get_workflow_runs(workflow_id: str) -> dict:
    doc = await workflows_col().find_one({"_id": ObjectId(workflow_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Workflow not found.")

    cursor = workflow_runs_col().find({"workflow_id": ObjectId(workflow_id)}).sort("run_at", -1).limit(25)
    runs = await cursor.to_list(length=25)

    if not runs:
        fallback = workflow_matches_col().find({"workflow_id": ObjectId(workflow_id)}).sort("created_at", -1).limit(25)
        fallback_runs = await fallback.to_list(length=25)
        aggregated: dict[str, dict] = {}
        for item in fallback_runs:
            run_id = item.get("run_id") or str(item.get("_id"))
            existing = aggregated.setdefault(run_id, {
                "run_id": run_id,
                "run_at": item.get("run_at") or item.get("created_at"),
                "jobs_fetched": 0,
                "notifications_sent": 0,
                "status": "completed",
                "errors": [],
            })
            existing["jobs_fetched"] += 1
            if item.get("delivered"):
                existing["notifications_sent"] += 1
        runs = [{
            "_id": ObjectId(),
            "run_id": summary["run_id"],
            "run_at": summary["run_at"],
            "jobs_fetched": summary["jobs_fetched"],
            "notifications_sent": summary["notifications_sent"],
            "status": summary["status"],
            "errors": summary["errors"],
        } for summary in aggregated.values()]

    return {
        "workflow_id": workflow_id,
        "runs": [{
            "id": str(item["_id"]),
            "run_id": item.get("run_id"),
            "run_at": item.get("run_at") or item.get("created_at"),
            "jobs_fetched": int(item.get("jobs_fetched") or item.get("new_matches") or 0),
            "notifications_sent": int(item.get("notifications_sent") or 0),
            "status": item.get("status") or "completed",
            "errors": item.get("errors") or [],
            "provider": item.get("provider"),
            "model": item.get("model"),
        } for item in runs],
    }


@router.get("/alerts")
async def list_job_alerts(limit: int = 25) -> list[dict]:
    cursor = job_alerts_col().find({}).sort("created_at", -1).limit(limit)
    docs = await cursor.to_list(length=limit)
    return [{
        "id": str(doc["_id"]),
        "workflow_id": str(doc.get("workflow_id", "")),
        "job_key": doc.get("job_key"),
        "company": doc.get("company"),
        "title": doc.get("title"),
        "target_role": doc.get("target_role"),
        "experience": doc.get("experience"),
        "url": doc.get("url"),
        "created_at": doc.get("created_at"),
        "delivered": bool(doc.get("delivered", False)),
        "delivered_at": doc.get("delivered_at"),
    } for doc in docs]


@router.post("")
async def create_workflow(body: WorkflowCreateBody) -> dict:
    plan = await plans_col().find_one({"_id": ObjectId(body.plan_id)})
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found.")

    target_roles = []
    for value in body.target_roles:
        role = value.strip()
        if role:
            target_roles.append(role)
    if not target_roles:
        raise HTTPException(status_code=422, detail="Choose at least one target role.")

    if body.frequency not in ALLOWED_FREQUENCIES:
        raise HTTPException(status_code=422, detail="Choose a supported frequency.")

    provider = body.provider.lower().strip()
    if provider not in PROVIDER_MODELS:
        raise HTTPException(status_code=422, detail=f"Unsupported provider '{body.provider}'.")
    selected_model = normalize_model(provider, body.model or PROVIDER_MODELS[provider][0])
    if selected_model not in PROVIDER_MODELS[provider]:
        raise HTTPException(status_code=422, detail=f"Model '{selected_model}' is not available for {provider}.")

    channel_state = await get_channel_status()
    enabled_channels = [name for name, info in channel_state.items() if info.get("enabled") and info.get("configured")]
    selected_channel = body.channel if body.channel in enabled_channels else (enabled_channels[0] if enabled_channels else None)
    if not selected_channel:
        raise HTTPException(status_code=400, detail="Enable an email or WhatsApp channel before creating a workflow.")

    now = datetime.now(timezone.utc)
    start_time = _parse_datetime(body.initial_start_time)
    if start_time < now:
        start_time = now

    companies = sorted({row.get("company", "").strip() for row in plan.get("rows", []) if row.get("company", "").strip()})
    workflow = {
        "plan_id": ObjectId(body.plan_id),
        "plan_name": plan.get("name"),
        "name": (body.name or plan.get("name") or "Workflow").strip()[:80],
        "channel": selected_channel,
        "target_roles": target_roles,
        "experience": int(body.experience),
        "frequency": body.frequency,
        "provider": provider,
        "model": selected_model,
        "companies": companies,
        "initial_start_time": start_time,
        "next_run_at": start_time,
        "enabled": True,
        "status": "active",
        "last_run_at": None,
        "last_error": None,
        "run_count": 0,
        "notification_count": 0,
        "created_at": now,
        "updated_at": now,
    }
    result = await workflows_col().insert_one(workflow)
    workflow["_id"] = result.inserted_id
    await traces_col().insert_one({
        "type": "workflow",
        "source": "workflow:created",
        "payload": {"workflow_id": str(result.inserted_id), "plan_id": body.plan_id, "channel": selected_channel, "target_roles": target_roles},
        "created_at": now,
    })
    log.info("workflow_created", workflow_id=str(result.inserted_id), channel=selected_channel, roles=target_roles)
    return await _workflow_response(workflow)


@router.patch("/{workflow_id}/trigger")
async def trigger_workflow(workflow_id: str) -> dict:
    doc = await workflows_col().find_one({"_id": ObjectId(workflow_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Workflow not found.")
    result = await execute_workflow(workflow_id, force=True)
    return {"ok": True, "workflow_id": workflow_id, "result": result}


@router.patch("/{workflow_id}")
async def update_workflow(workflow_id: str, body: WorkflowUpdateBody) -> dict:
    doc = await workflows_col().find_one({"_id": ObjectId(workflow_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Workflow not found.")

    update: dict = {"updated_at": datetime.now(timezone.utc)}

    if body.name is not None:
        update["name"] = body.name.strip()[:80] or doc.get("name", "Workflow")

    if body.target_roles is not None:
        values = []
        for value in body.target_roles:
            role = str(value).strip()
            if role:
                values.append(role)
        if not values:
            raise HTTPException(status_code=422, detail="Choose at least one target role.")
        update["target_roles"] = values

    if body.experience is not None:
        update["experience"] = int(body.experience)

    if body.frequency is not None:
        if body.frequency not in ALLOWED_FREQUENCIES:
            raise HTTPException(status_code=422, detail="Choose a supported frequency.")
        update["frequency"] = body.frequency

    if body.provider is not None or body.model is not None:
        provider = (body.provider or doc.get("provider", "gemini")).lower().strip()
        if provider not in PROVIDER_MODELS:
            raise HTTPException(status_code=422, detail=f"Unsupported provider '{provider}'.")
        selected_model = normalize_model(provider, body.model or doc.get("model") or PROVIDER_MODELS[provider][0])
        if selected_model not in PROVIDER_MODELS[provider]:
            raise HTTPException(status_code=422, detail=f"Model '{selected_model}' is not available for {provider}.")
        update["provider"] = provider
        update["model"] = selected_model

    if body.channel is not None:
        channel_state = await get_channel_status()
        enabled_channels = [name for name, info in channel_state.items() if info.get("enabled") and info.get("configured")]
        selected_channel = body.channel if body.channel in enabled_channels else (enabled_channels[0] if enabled_channels else None)
        if not selected_channel:
            raise HTTPException(status_code=400, detail="Enable an email or WhatsApp channel before updating the workflow.")
        update["channel"] = selected_channel

    if body.initial_start_time is not None:
        start_time = _parse_datetime(body.initial_start_time)
        update["initial_start_time"] = start_time
        if start_time >= datetime.now(timezone.utc):
            update["next_run_at"] = start_time

    if not update.keys() - {"updated_at"}:
        return await _workflow_response(doc)

    await workflows_col().update_one({"_id": ObjectId(workflow_id)}, {"$set": update})
    refreshed = await workflows_col().find_one({"_id": ObjectId(workflow_id)})
    if not refreshed:
        raise HTTPException(status_code=404, detail="Workflow not found.")
    return await _workflow_response(refreshed)


@router.patch("/{workflow_id}/toggle")
async def toggle_workflow(workflow_id: str, enabled: bool = True) -> dict:
    doc = await workflows_col().find_one({"_id": ObjectId(workflow_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Workflow not found.")
    status = "active" if enabled else "paused"
    await workflows_col().update_one({"_id": ObjectId(workflow_id)}, {"$set": {"enabled": enabled, "status": status, "updated_at": datetime.now(timezone.utc)}})
    return {"ok": True, "enabled": enabled, "status": status}


@router.delete("/{workflow_id}")
async def delete_workflow(workflow_id: str) -> dict:
    result = await workflows_col().delete_one({"_id": ObjectId(workflow_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Workflow not found.")
    return {"ok": True, "deleted": True}
