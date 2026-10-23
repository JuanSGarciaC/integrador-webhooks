import hashlib
import hmac

PREFIX = "sha256="


def verify_signature(secret: str, body: bytes, header: str | None) -> bool:
    """Valida X-Hub-Signature-256 sobre el cuerpo crudo, en tiempo constante."""
    if not secret or not header or not header.startswith(PREFIX):
        return False
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    received = header[len(PREFIX):].lower()
    return hmac.compare_digest(expected, received)
