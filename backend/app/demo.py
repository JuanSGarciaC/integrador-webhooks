"""Demo pública: escenarios del simulador (el destino simulado los interpreta por `repository`)."""
import json
from typing import Literal

Scenario = Literal["ok", "recover", "rate_limit", "timeout", "rejected"]


def build_payload(scenario: str) -> bytes:
    """Payload `push` ficticio: sin datos de personas reales."""
    return json.dumps({
        "ref": "refs/heads/main",
        "commits": [{}],
        "repository": {"full_name": f"demo/{scenario}"},
        "sender": {"login": "visitante-demo"},
    }).encode()
