"""AI-backed workflow execution using MCP tools and provider-aware failure handling."""
from __future__ import annotations

import asyncio
import hashlib
import json
import re
from datetime import datetime, timedelta, timezone
from html.parser import HTMLParser
from urllib.parse import urljoin, urlparse

import httpx
from bson import ObjectId
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_mcp_adapters.client import MultiServerMCPClient
from langgraph.prebuilt import create_react_agent
from pymongo.errors import DuplicateKeyError

from config import get_settings
from db.mongo import get_db, job_alerts_col, plans_col, traces_col, workflow_matches_col, workflow_runs_col, workflows_col
from logger import get_logger
from providers.llm_factory import normalize_model
from providers.model_router import ModelUsageCallback, create_model, get_model_candidates
from routers.channels import send_workflow_notification

log = get_logger("workflow_runner")
FREQUENCY_DAYS = {"every_2_hours": 2/24, "every_3_hours": 3/24, "every_6_hours": 6/24, "every_12_hours": 12/24, "every_24_hours": 1}
ROLE_STOP_WORDS = {"and", "or", "the", "of", "in", "at", "with", "for", "a", "an", "to"}


class _CareersHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.text_parts: list[str] = []
        self.links: list[dict[str, str]] = []
        self._link: dict[str, str] | None = None
        self._script_type = ""
        self.json_ld: list[str] = []
        self._script_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = dict(attrs)
        if tag == "a":
            self._link = {"href": attr.get("href") or "", "text": ""}
        if tag == "script":
            self._script_type = (attr.get("type") or "").lower()
            self._script_parts = []

    def handle_data(self, data: str) -> None:
        text = " ".join(data.split())
        if not text:
            return
        self.text_parts.append(text)
        if self._link is not None:
            self._link["text"] += f" {text}"
        if "ld+json" in self._script_type:
            self._script_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag == "a" and self._link is not None:
            self._link["text"] = " ".join(self._link["text"].split())
            self.links.append(self._link)
            self._link = None
        if tag == "script" and "ld+json" in self._script_type:
            self.json_ld.append("".join(self._script_parts))
            self._script_type = ""


def _tokens(value: str) -> set[str]:
    return {part for part in re.findall(r"[a-z0-9+#.]+", value.lower()) if part not in ROLE_STOP_WORDS}


def _matches_role(title: str, roles: list[str]) -> str | None:
    title_tokens = _tokens(title)
    for role in roles:
        wanted = _tokens(role)
        if not wanted:
            continue
        if wanted.issubset(title_tokens) or len(wanted & title_tokens) / len(wanted) >= 0.6:
            return role
    return None


def _job_experience(text: str) -> tuple[int, int | None] | None:
    value = text.lower()
    match = re.search(r"(\d+)\s*(?:-|to)\s*(\d+)\s*(?:years?|yrs?)", value)
    if match:
        return int(match.group(1)), int(match.group(2))
    match = re.search(r"(\d+)\s*\+\s*(?:years?|yrs?)", value)
    if match:
        return int(match.group(1)), None
    match = re.search(r"(?:minimum|min\.?|at least)\s*(\d+)\s*(?:years?|yrs?)", value)
    if match:
        return int(match.group(1)), None
    return None


def _experience_fits(requirement: str | int, job_experience: tuple[int, int | None] | None) -> bool:
    if requirement == "any" or job_experience is None:
        return True
    ranges = {"fresher": (0, 1), "1-3": (1, 3), "3-5": (3, 5), "5+": (5, None)}
    if isinstance(requirement, int):
        years = requirement
        job_min, job_max = job_experience
        return job_min <= years and (job_max is None or job_max >= years)
    selected = ranges.get(requirement)
    if not selected:
        return True
    job_min, job_max = job_experience
    selected_min, selected_max = selected
    return (selected_max is None or job_min <= selected_max) and (job_max is None or job_max >= selected_min)


def _json_ld_jobs(parser: _CareersHTMLParser, page_url: str) -> list[dict]:
    found: list[dict] = []

    def visit(value: object) -> None:
        if isinstance(value, list):
            for child in value:
                visit(child)
        elif isinstance(value, dict):
            kind = value.get("@type", "")
            if kind == "JobPosting" or isinstance(kind, list) and "JobPosting" in kind:
                title = str(value.get("title") or value.get("name") or "").strip()
                description = re.sub(r"<[^>]+>", " ", str(value.get("description") or ""))
                url = str(value.get("url") or value.get("sameAs") or page_url)
                found.append({"title": title, "url": urljoin(page_url, url), "details": description})
            for child in value.values():
                if isinstance(child, (dict, list)):
                    visit(child)

    for raw in parser.json_ld:
        try:
            visit(json.loads(raw))
        except (ValueError, TypeError):
            continue
    return found


async def find_matching_openings(company: dict, roles: list[str], experience: str) -> list[dict]:
    start_url = str(company.get("careers_page", "")).strip()
    if not start_url.startswith(("https://", "http://")):
        return []
    headers = {"User-Agent": "Mozilla/5.0 (compatible; PrepStudioJobAlerts/1.0)"}
    seen_pages: set[str] = set()
    to_visit = [start_url]
    results: dict[str, dict] = {}
    base_host = urlparse(start_url).hostname or ""
    async with httpx.AsyncClient(timeout=18, follow_redirects=True, headers=headers) as client:
        while to_visit and len(seen_pages) < 5:
            page_url = to_visit.pop(0)
            if page_url in seen_pages:
                continue
            seen_pages.add(page_url)
            try:
                response = await client.get(page_url)
                response.raise_for_status()
                if "html" not in response.headers.get("content-type", "").lower():
                    continue
            except (httpx.HTTPError, ValueError) as exc:
                log.info("workflow_careers_fetch_failed", company=company.get("company"), url=page_url, error=str(exc))
                continue

            parser = _CareersHTMLParser()
            parser.feed(response.text)
            page_jobs = _json_ld_jobs(parser, str(response.url))
            for link in parser.links:
                href = urljoin(str(response.url), link["href"])
                parsed = urlparse(href)
                if parsed.scheme not in {"https", "http"}:
                    continue
                link_text = link["text"].strip()
                role = _matches_role(link_text, roles)
                path = (parsed.path + " " + link_text).lower()
                looks_like_job = bool(re.search(r"/jobs?/|/positions?/|/openings?/|jobid=|requisition", path))
                if role and looks_like_job:
                    page_jobs.append({"title": link_text, "url": href, "details": ""})

                same_host = parsed.hostname == base_host
                is_ats = any(marker in (parsed.hostname or "").lower() for marker in ("workday", "greenhouse", "lever", "smartrecruiters", "ashby", "myworkdayjobs"))
                looks_like_listing = bool(re.search(r"career|job|opening|position", path))
                if href not in seen_pages and len(seen_pages) + len(to_visit) < 5 and (same_host or is_ats) and looks_like_listing:
                    if href != start_url:
                        to_visit.append(href)

            all_page_text = " ".join(parser.text_parts)
            for posting in page_jobs:
                title = posting.get("title", "")
                matched_role = _matches_role(title, roles)
                if not matched_role:
                    continue
                details = f"{title} {posting.get('details', '')} {all_page_text[:6000]}"
                job_experience = _job_experience(details)
                if not _experience_fits(experience, job_experience):
                    continue
                url = posting.get("url") or str(response.url)
                fingerprint = hashlib.sha256(f"{company.get('company')}|{title}|{url}".lower().encode()).hexdigest()
                results[fingerprint] = {
                    "job_key": fingerprint,
                    "company": company.get("company", "Company"),
                    "title": title,
                    "target_role": matched_role,
                    "experience": f"{job_experience[0]}+ years" if job_experience and job_experience[1] is None else f"{job_experience[0]}–{job_experience[1]} years" if job_experience else "Not specified in posting",
                    "url": url,
                }
    return list(results.values())


def _next_run(frequency: str, now: datetime) -> datetime:
    value = FREQUENCY_DAYS.get(frequency, 1)
    if value < 1:
        return now + timedelta(hours=value * 24)
    if isinstance(value, float):
        return now + timedelta(hours=value * 24)
    return now + timedelta(days=value)


async def _run_ai_workflow_agent(workflow: dict, plan: dict, run_id: str, now: datetime) -> list[dict]:
    provider = str(workflow.get("provider", "gemini")).lower().strip() or "gemini"
    model = normalize_model(provider, workflow.get("model"))
    prompt = (
        "You are the job search agent for this workflow. Search the exact company career pages "
        "for roles that match the workflow requirements. Return strict JSON only with a top-level "
        "'jobs' array and optional 'notes' string. Each job object requires: company, title, "
        "url, target_role, experience. Use the MCP web_search tool as needed. "
        f"Target roles: {workflow.get('target_roles', [])}. Experience: {workflow.get('experience', 'any')}. "
        f"Companies to check: {[row.get('company') for row in plan.get('rows', [])]}. "
        "If no jobs match, return {'jobs': []}. If the model is exhausted or unavailable, "
        "return {'error': 'MODEL_UNAVAILABLE'} and stop."
    )

    try:
        candidates = await get_model_candidates(provider, model)
    except Exception as exc:  # pragma: no cover - provider failure path
        raise RuntimeError(f"AI model unavailable: {exc}") from exc

    settings = get_settings()
    mcp_url = f"http://localhost:{settings.mcp_server_port}/mcp"
    async with MultiServerMCPClient({"prep-studio-jobs": {"url": mcp_url, "transport": "streamable_http"}}) as mcp_client:
        tools = await mcp_client.get_tools()
        search_tool = next((tool for tool in tools if getattr(tool, "name", "") == "web_search"), None)
        if search_tool is None:
            raise RuntimeError("MCP web_search tool is not available on the configured server.")

        selected = candidates[0]
        llm = await create_model(selected)
        agent = create_react_agent(
            llm.bind_tools([search_tool]).with_config({
                "callbacks": [ModelUsageCallback(selected["provider"], selected["model"])],
                "metadata": {"provider": selected["provider"], "model": selected["model"]},
            }),
            [search_tool],
        )
        state = await agent.ainvoke({
            "messages": [
                SystemMessage(content="You are a careful job-searching AI agent. Use the search tool to find exact career pages and return JSON only."),
                HumanMessage(content=prompt),
            ]
        })

    messages = state.get("messages", []) if isinstance(state, dict) else []
    last_message = messages[-1] if messages else None
    raw_content = getattr(last_message, "content", "") if last_message else ""
    if isinstance(raw_content, list):
        raw_content = "\n".join(str(part.get("text", part)) for part in raw_content if isinstance(part, dict))
    raw_content = str(raw_content).strip()
    if not raw_content:
        raise RuntimeError("AI agent returned no usable job-search result.")

    try:
        payload = json.loads(raw_content)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", raw_content, flags=re.S)
        if not match:
            raise RuntimeError("AI agent response was not valid JSON.")
        payload = json.loads(match.group(0))

    if isinstance(payload, dict) and payload.get("error"):
        raise RuntimeError(str(payload.get("error")))

    jobs = payload.get("jobs", []) if isinstance(payload, dict) else []
    if not isinstance(jobs, list):
        raise RuntimeError("AI agent returned an invalid jobs payload.")

    normalized = []
    for job in jobs:
        if not isinstance(job, dict):
            continue
        title = str(job.get("title") or "").strip()
        url = str(job.get("url") or "").strip()
        company = str(job.get("company") or "").strip()
        target_role = str(job.get("target_role") or workflow.get("target_roles", ["role"])[0]).strip()
        if not title or not url or not company:
            continue
        fingerprint = hashlib.sha256(f"{company}|{title}|{url}".lower().encode()).hexdigest()
        normalized.append({
            "job_key": fingerprint,
            "company": company,
            "title": title,
            "target_role": target_role,
            "experience": str(job.get("experience") or workflow.get("experience", "any")),
            "url": url,
            "run_id": run_id,
            "created_at": now,
        })
    return normalized


async def execute_workflow(workflow_id: str, *, force: bool = False) -> dict:
    oid = ObjectId(workflow_id)
    workflow = await workflows_col().find_one({"_id": oid})
    if not workflow:
        raise ValueError("Workflow not found.")
    if not force and not workflow.get("enabled", True):
        raise ValueError("This workflow is paused.")

    now = datetime.now(timezone.utc)
    run_id = hashlib.sha256(f"{workflow_id}:{now.isoformat()}:{workflow.get('run_count',0)}".encode()).hexdigest()[:24]
    await workflows_col().update_one({"_id": oid}, {"$set": {"status": "running", "last_started_at": now, "last_error": None}})

    plan = await plans_col().find_one({"_id": ObjectId(workflow["plan_id"])})
    if not plan:
        await workflows_col().update_one({"_id": oid}, {"$set": {"status": "error", "last_error": "Linked plan was deleted."}})
        await workflow_runs_col().insert_one({
            "workflow_id": oid,
            "run_id": run_id,
            "provider": workflow.get("provider", "gemini"),
            "model": workflow.get("model") or workflow.get("provider", "gemini"),
            "run_at": now,
            "completed_at": now,
            "companies_scanned": 0,
            "jobs_fetched": 0,
            "new_matches": 0,
            "notifications_sent": 0,
            "errors": ["Linked plan was deleted."],
            "status": "failed",
            "created_at": now,
        })
        await traces_col().insert_one({
            "type": "workflow",
            "source": "workflow:failed",
            "workflow_id": oid,
            "run_id": run_id,
            "payload": {"workflow_id": workflow_id, "run_id": run_id, "error": "Linked plan was deleted.", "status": "failed"},
            "created_at": now,
        })
        raise ValueError("Linked plan was deleted.")

    try:
        matches = await _run_ai_workflow_agent(workflow, plan, run_id, now)
    except Exception as exc:
        finished = datetime.now(timezone.utc)
        failure = str(exc)[:300]
        status = "active" if workflow.get("enabled", True) else "paused"
        await workflows_col().update_one({"_id": oid}, {
            "$set": {"status": status, "last_run_at": finished, "next_run_at": _next_run(workflow.get("frequency", "every_12_hours"), finished), "last_error": failure, "provider": workflow.get("provider", "gemini"), "model": workflow.get("model") or workflow.get("provider", "gemini")},
            "$inc": {"run_count": 1},
        })
        await workflow_runs_col().insert_one({
            "workflow_id": oid,
            "run_id": run_id,
            "provider": workflow.get("provider", "gemini"),
            "model": workflow.get("model") or workflow.get("provider", "gemini"),
            "run_at": now,
            "completed_at": finished,
            "companies_scanned": len(plan.get("rows", [])),
            "jobs_fetched": 0,
            "new_matches": 0,
            "notifications_sent": 0,
            "errors": [failure],
            "status": "failed",
            "created_at": finished,
        })
        await traces_col().insert_one({
            "type": "workflow",
            "source": "workflow:failed",
            "workflow_id": oid,
            "run_id": run_id,
            "payload": {"workflow_id": workflow_id, "run_id": run_id, "provider": workflow.get("provider", "gemini"), "model": workflow.get("model") or workflow.get("provider", "gemini"), "status": "failed", "error": failure},
            "created_at": finished,
        })
        return {"workflow_id": workflow_id, "run_id": run_id, "status": "failed", "errors": [failure], "jobs_fetched": 0, "notifications_sent": 0}

    notified = 0
    delivery_errors: list[str] = []
    for match in matches:
        try:
            await workflow_matches_col().insert_one({
                "workflow_id": oid,
                "run_id": run_id,
                "job_key": match["job_key"],
                "job": match,
                "created_at": now,
                "run_at": now,
                "delivered": False,
            })
        except DuplicateKeyError:
            continue

        await job_alerts_col().update_one(
            {"workflow_id": oid, "job_key": match["job_key"]},
            {"$set": {
                "workflow_id": oid,
                "run_id": run_id,
                "job_key": match["job_key"],
                "company": match.get("company"),
                "title": match.get("title"),
                "target_role": match.get("target_role"),
                "experience": match.get("experience"),
                "url": match.get("url"),
                "job": match,
                "created_at": now,
                "run_at": now,
                "delivered": False,
            }},
            upsert=True,
        )

        text = (
            f"New opening found at {match['company']} for {match['target_role']}: {match['title']}\n"
            f"Experience: {match['experience']}\nCareer link: {match['url']}"
        )
        try:
            await send_workflow_notification(workflow["channel"], f"New {match['target_role']} opening at {match['company']}", text)
            delivered_at = datetime.now(timezone.utc)
            await workflow_matches_col().update_one({"workflow_id": oid, "job_key": match["job_key"]}, {"$set": {"delivered": True, "delivered_at": delivered_at, "run_at": now}})
            await job_alerts_col().update_one({"workflow_id": oid, "job_key": match["job_key"]}, {"$set": {"delivered": True, "delivered_at": delivered_at, "run_at": now}})
            notified += 1
        except Exception as exc:
            delivery_errors.append(f"{match['company']} · {match['title']}: {exc}")

    finished = datetime.now(timezone.utc)
    next_run = _next_run(workflow.get("frequency", "every_12_hours"), finished)
    status = "active" if workflow.get("enabled", True) else "paused"
    last_error = "; ".join(delivery_errors[:5])
    await workflows_col().update_one({"_id": oid}, {
        "$set": {"status": status, "last_run_at": finished, "next_run_at": next_run, "last_error": last_error or None, "provider": workflow.get("provider", "gemini"), "model": workflow.get("model") or workflow.get("provider", "gemini")},
        "$inc": {"run_count": 1, "notification_count": notified},
    })
    await workflow_runs_col().insert_one({
        "workflow_id": oid,
        "run_id": run_id,
        "provider": workflow.get("provider", "gemini"),
        "model": workflow.get("model") or workflow.get("provider", "gemini"),
        "run_at": now,
        "completed_at": finished,
        "companies_scanned": len(plan.get("rows", [])),
        "jobs_fetched": len(matches),
        "new_matches": len(matches),
        "notifications_sent": notified,
        "errors": delivery_errors,
        "status": "completed",
        "created_at": finished,
    })
    await traces_col().insert_one({
        "type": "workflow",
        "source": "workflow:completed",
        "workflow_id": oid,
        "run_id": run_id,
        "payload": {"workflow_id": workflow_id, "run_id": run_id, "plan_name": plan.get("name"), "provider": workflow.get("provider", "gemini"), "model": workflow.get("model") or workflow.get("provider", "gemini"), "companies_scanned": len(plan.get("rows", [])), "new_matches": len(matches), "notifications_sent": notified, "errors": len(delivery_errors)},
        "created_at": finished,
    })
    return {"workflow_id": workflow_id, "run_id": run_id, "status": "completed", "jobs_fetched": len(matches), "notifications_sent": notified, "errors": delivery_errors, "next_run_at": next_run.isoformat()}


async def workflow_scheduler() -> None:
    """Poll due jobs; the DB persists due times so restarts don't lose schedules."""
    await workflows_col().update_many({"status": "running"}, {"$set": {"status": "active", "next_run_at": datetime.now(timezone.utc)}})
    while True:
        now = datetime.now(timezone.utc)
        due = await workflows_col().find({"enabled": True, "status": {"$ne": "running"}, "next_run_at": {"$lte": now}}).to_list(length=20)
        for workflow in due:
            try:
                await execute_workflow(str(workflow["_id"]))
            except Exception as exc:
                log.exception("workflow_run_failed", workflow_id=str(workflow["_id"]), error=str(exc))
        await asyncio.sleep(30)
