import hashlib
import hmac

from app.security import verify_signature

SECRET = "s3cret"
BODY = b'{"zen": "hola"}'


def sign(body: bytes = BODY, secret: str = SECRET) -> str:
    return "sha256=" + hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def test_firma_valida():
    assert verify_signature(SECRET, BODY, sign())


def test_firma_invalida():
    assert not verify_signature(SECRET, BODY, sign(secret="otro"))


def test_firma_ausente():
    assert not verify_signature(SECRET, BODY, None)
    assert not verify_signature(SECRET, BODY, "")


def test_firma_sin_prefijo_rechazada():
    assert not verify_signature(SECRET, BODY, sign().removeprefix("sha256="))


def test_firma_hex_en_mayusculas_se_acepta():
    sig = sign()
    assert verify_signature(SECRET, BODY, "sha256=" + sig[7:].upper())


def test_cuerpo_alterado():
    assert not verify_signature(SECRET, BODY + b" ", sign())


def test_secreto_vacio_rechaza_todo():
    assert not verify_signature("", BODY, sign(secret=""))
