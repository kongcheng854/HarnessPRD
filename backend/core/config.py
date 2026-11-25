from pathlib import Path
from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

CORE_DIR = Path(__file__).resolve().parent


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=CORE_DIR.parent / ".env", env_file_encoding="utf-8")
    anthropic_api_key: SecretStr = SecretStr("")
    openai_api_key: SecretStr = SecretStr("")
    default_llm_provider: Literal["anthropic", "openai"] = "anthropic"
    default_llm_model: str = "claude-sonnet-4-20250514"
    cors_origins: str = "http://localhost:5173"
    host: str = "0.0.0.0"
    port: int = 8000
    session_db_path: Path = CORE_DIR.parent / "sessions.sqlite3"
    log_llm_metrics: bool = True
    log_level: Literal["DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"] = "INFO"


settings = Settings()
