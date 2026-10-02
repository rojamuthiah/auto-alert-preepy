from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    mongo_url: str = "mongodb://localhost:27017"
    mongo_db: str = "prep_studio"
    mcp_server_port: int = 8001
    api_port: int = 8000
    log_level: str = "INFO"
    log_dir: str = "logs"
    openai_api_key: str = ""
    gemini_api_key: str = ""
    claude_api_key: str = ""
    langfuse_public_key: str = ""
    langfuse_secret_key: str = ""
    langfuse_base_url: str = ""

    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


@lru_cache()
def get_settings() -> Settings:
    return Settings()
