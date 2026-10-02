"""
Structured async logger for Prep Studio.
Writes JSON logs to rotating files + pretty console output.
"""
import logging
import logging.handlers
import os
import sys
from pathlib import Path
import structlog
from config import get_settings

settings = get_settings()

_LOG_DIR = Path(settings.log_dir)
_LOG_DIR.mkdir(parents=True, exist_ok=True)


def _setup_stdlib_logging() -> None:
    root = logging.getLogger()
    root.setLevel(getattr(logging, settings.log_level.upper(), logging.INFO))

    # --- rotating file handler (JSON) ---
    file_handler = logging.handlers.RotatingFileHandler(
        filename=_LOG_DIR / "prep_studio.log",
        maxBytes=10 * 1024 * 1024,  # 10 MB
        backupCount=5,
        encoding="utf-8",
    )
    file_handler.setFormatter(logging.Formatter("%(message)s"))

    # --- console handler (pretty) ---
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(logging.Formatter("%(message)s"))

    root.addHandler(file_handler)
    root.addHandler(console_handler)


def configure_logging() -> None:
    _setup_stdlib_logging()

    shared_processors = [
        structlog.contextvars.merge_contextvars,
        structlog.stdlib.add_logger_name,
        structlog.stdlib.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.StackInfoRenderer(),
    ]

    structlog.configure(
        processors=shared_processors
        + [
            structlog.stdlib.ProcessorFormatter.wrap_for_formatter,
        ],
        logger_factory=structlog.stdlib.LoggerFactory(),
        wrapper_class=structlog.stdlib.BoundLogger,
        cache_logger_on_first_use=True,
    )

    formatter = structlog.stdlib.ProcessorFormatter(
        processors=[
            structlog.stdlib.ProcessorFormatter.remove_processors_meta,
            structlog.processors.JSONRenderer(),
        ],
        foreign_pre_chain=shared_processors,
    )

    for handler in logging.getLogger().handlers:
        handler.setFormatter(formatter)


def get_logger(name: str = "prep_studio") -> structlog.BoundLogger:
    return structlog.get_logger(name)


# Agent-specific trace log — separate file
def get_agent_logger(agent_name: str) -> structlog.BoundLogger:
    """Returns a logger that also writes to agents/<agent_name>.log"""
    agent_log_dir = _LOG_DIR / "agents"
    agent_log_dir.mkdir(parents=True, exist_ok=True)

    agent_file_handler = logging.handlers.RotatingFileHandler(
        filename=agent_log_dir / f"{agent_name}.log",
        maxBytes=5 * 1024 * 1024,
        backupCount=3,
        encoding="utf-8",
    )
    agent_file_handler.setFormatter(logging.Formatter("%(message)s"))

    logger = logging.getLogger(agent_name)
    logger.addHandler(agent_file_handler)
    logger.setLevel(logging.DEBUG)

    return structlog.get_logger(agent_name)
