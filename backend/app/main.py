"""ASGI: uvicorn app.main:app"""
import logging

from app.api import create_app
from app.config import check_demo_settings, load_settings
from app.database import init_db, make_engine, make_session_factory
from app.worker import utc_now

logging.basicConfig(level=logging.INFO, format="%(message)s")

settings = load_settings()
check_demo_settings(settings)
_engine = make_engine(settings.database_url)
init_db(_engine)
app = create_app(settings, make_session_factory(_engine), utc_now)
