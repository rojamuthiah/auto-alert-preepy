"""
MongoDB async client using Motor.
Provides collection accessors used throughout the app.
"""
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from config import get_settings
from logger import get_logger

log = get_logger("db")
settings = get_settings()

_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None


async def connect_db() -> None:
    global _client, _db
    log.info("connecting_to_mongodb", url=settings.mongo_url, db=settings.mongo_db)
    _client = AsyncIOMotorClient(settings.mongo_url)
    _db = _client[settings.mongo_db]
    # Create indexes
    await _db.plans.create_index("chat_id")
    await _db.plans.create_index("hidden")
    await _db.chats.create_index("created_at")
    await _db.traces.create_index([("type", 1), ("created_at", -1)])
    await _db.model_usage.create_index([("provider", 1), ("model", 1)], unique=True)
    await _db.workflows.create_index([("enabled", 1), ("next_run_at", 1)])
    await _db.workflow_runs.create_index([("workflow_id", 1), ("run_at", -1)])
    await _db.workflow_matches.create_index([("workflow_id", 1), ("job_key", 1)], unique=True)
    await _db.job_alerts.create_index([("workflow_id", 1), ("job_key", 1)], unique=True)
    await _db.job_alerts.create_index([("created_at", -1)])
    log.info("mongodb_connected")


async def close_db() -> None:
    global _client
    if _client:
        _client.close()
        log.info("mongodb_disconnected")


def get_db() -> AsyncIOMotorDatabase:
    if _db is None:
        raise RuntimeError("Database not initialised. Call connect_db() first.")
    return _db


# --- Collection shortcuts ---

def chats_col():
    return get_db()["chats"]


def plans_col():
    return get_db()["plans"]


def traces_col():
    return get_db()["traces"]


def settings_col():
    return get_db()["settings"]


def profiles_col():
    return get_db()["profiles"]


def model_usage_col():
    return get_db()["model_usage"]


def workflows_col():
    return get_db()["workflows"]


def workflow_matches_col():
    return get_db()["workflow_matches"]


def workflow_runs_col():
    return get_db()["workflow_runs"]


def job_alerts_col():
    return get_db()["job_alerts"]
