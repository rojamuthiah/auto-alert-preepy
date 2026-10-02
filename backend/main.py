"""
Prep Studio — FastAPI Application Entry Point.
Starts on port 8000. MCP server runs separately on port 8001.
"""
from __future__ import annotations

import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from config import get_settings
from db.mongo import connect_db, close_db
from logger import configure_logging, get_logger
from routers import chats, plans, traces, settings as settings_router, profiles, channels, workflows

configure_logging()
log = get_logger("main")
cfg = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    log.info("prep_studio_starting", port=cfg.api_port)
    await connect_db()
    yield
    await close_db()
    log.info("prep_studio_stopped")


app = FastAPI(
    title="Prep Studio API",
    description="Open-source job preparation platform",
    version="0.1.0",
    lifespan=lifespan,
)

# CORS — allow frontend dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(chats.router)
app.include_router(plans.router)
app.include_router(traces.router)
app.include_router(settings_router.router)
app.include_router(profiles.router)
app.include_router(channels.router)
app.include_router(workflows.router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "prep-studio-api"}


if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=cfg.api_port,
        reload=True,
        log_level=cfg.log_level.lower(),
    )
