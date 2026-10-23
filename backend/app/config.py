import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    webhook_secret: str = ""
    database_url: str = "sqlite:///./webhooks.db"
    downstream_url: str = "http://127.0.0.1:9000/ingest"
    max_body_bytes: int = 1_000_000
    # Política de reintentos (sección 7 del diseño)
    retry_base_seconds: float = 2.0
    retry_factor: float = 2.0
    retry_cap_seconds: float = 300.0
    max_attempts: int = 6
    lock_seconds: float = 60.0
    http_timeout_seconds: float = 5.0
    poll_interval_seconds: float = 2.0
    batch_size: int = 10


def load_dotenv(path: str = ".env") -> None:
    """Carga KEY=VALUE de un .env sin sobrescribir variables ya definidas."""
    try:
        lines = open(path, encoding="utf-8").read().splitlines()
    except OSError:
        return
    for line in lines:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


def load_settings() -> Settings:
    load_dotenv()
    d = Settings()
    e = os.environ.get
    return Settings(
        webhook_secret=e("WEBHOOK_SECRET", d.webhook_secret),
        database_url=e("DATABASE_URL", d.database_url),
        downstream_url=e("DOWNSTREAM_URL", d.downstream_url),
        max_body_bytes=int(e("MAX_BODY_BYTES", d.max_body_bytes)),
        retry_base_seconds=float(e("RETRY_BASE_SECONDS", d.retry_base_seconds)),
        retry_factor=float(e("RETRY_FACTOR", d.retry_factor)),
        retry_cap_seconds=float(e("RETRY_CAP_SECONDS", d.retry_cap_seconds)),
        max_attempts=int(e("MAX_ATTEMPTS", d.max_attempts)),
        lock_seconds=float(e("LOCK_SECONDS", d.lock_seconds)),
        http_timeout_seconds=float(e("HTTP_TIMEOUT_SECONDS", d.http_timeout_seconds)),
        poll_interval_seconds=float(e("POLL_INTERVAL_SECONDS", d.poll_interval_seconds)),
        batch_size=int(e("BATCH_SIZE", d.batch_size)),
    )
