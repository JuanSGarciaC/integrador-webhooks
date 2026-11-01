"""Autorización de /api/*: un rol admin por token Bearer; visitante anónimo solo en demo."""
import hmac
from typing import Callable

from fastapi import HTTPException, Request

from app.config import Settings

_DENIED = HTTPException(401, "token ausente o inválido", headers={"WWW-Authenticate": "Bearer"})


def _bearer(request: Request) -> str | None:
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    return token.strip() if scheme.lower() == "bearer" else None


def is_admin(settings: Settings, request: Request) -> bool:
    token = _bearer(request)
    if not settings.admin_token or not token:  # compare_digest("", "") sería True
        return False
    return hmac.compare_digest(token.encode(), settings.admin_token.encode())


def reader(settings: Settings) -> Callable[[Request], None]:
    """Lectura: admin, o anónimo en demo. Un token presente pero inválido nunca degrada a anónimo."""
    def dep(request: Request) -> None:
        if is_admin(settings, request):
            return
        if settings.demo_mode and "authorization" not in request.headers:
            return
        raise _DENIED
    return dep


def admin(settings: Settings) -> Callable[[Request], None]:
    def dep(request: Request) -> None:
        if not is_admin(settings, request):
            raise _DENIED
    return dep
