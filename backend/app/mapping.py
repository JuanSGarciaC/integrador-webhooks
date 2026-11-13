SUPPORTED = {"push", "issues", "pull_request", "ping"}


class UnsupportedEvent(ValueError):
    pass


def _summary(event_type: str, p: dict) -> tuple[str, str | None]:
    if event_type == "push":
        ts = (p.get("head_commit") or {}).get("timestamp")
        return f"{len(p.get('commits') or [])} commit(s) a {p.get('ref')}", ts
    if event_type == "issues":
        i = p.get("issue") or {}
        return f"issue #{i.get('number')} {p.get('action')}: {i.get('title')}", i.get("created_at")
    if event_type == "pull_request":
        pr = p.get("pull_request") or {}
        return f"PR #{pr.get('number')} {p.get('action')}: {pr.get('title')}", pr.get("updated_at")
    return f"ping: {p.get('zen')}", None


def normalize(event_id: str, event_type: str, payload: dict, received_at: str) -> dict:
    """Formato común hacia el destino. No incluye el payload completo."""
    if event_type not in SUPPORTED:
        raise UnsupportedEvent(event_type)
    summary, occurred = _summary(event_type, payload)
    repo = payload.get("repository") or {}
    sender = payload.get("sender") or {}
    return {
        "event_id": event_id,
        "source": "github",
        "type": event_type,
        "repository": repo.get("full_name"),
        "actor": sender.get("login"),
        "summary": summary,
        "occurred_at": occurred or received_at,
    }


TRIAJE = "triaje"  # valor de DOWNSTREAM_FORMAT para entregar a triaje-solicitudes


def accepts(fmt: str, event_type: str, payload: dict) -> bool:
    """Qué se guarda para entregar. Triaje solo clasifica solicitudes: issues recién abiertos."""
    if fmt != TRIAJE:
        return event_type in SUPPORTED
    return event_type == "issues" and payload.get("action") == "opened" and isinstance(payload.get("issue"), dict)


def to_triaje(payload: dict) -> dict:
    """Cuerpo de POST /api/requests de triaje, dentro de sus límites (asunto 3-200, cuerpo 10-4000,
    solicitante 2-120). Lo que queda por debajo del mínimo se rellena: si no, triaje respondería 422
    y el evento acabaría en fallidos sin arreglo posible. Tolera tipos inesperados en el payload."""
    issue = payload.get("issue")
    issue = issue if isinstance(issue, dict) else {}
    sender = payload.get("sender")
    login = sender.get("login") if isinstance(sender, dict) else None
    title = str(issue.get("title") or "").strip()
    if len(title) < 3:
        title = f"Issue #{issue.get('number')}: {title}".strip()
    body = str(issue.get("body") or "").strip()
    if len(body) < 10:
        body = f"{body} (sin descripción)".strip()
    return {
        "subject": title[:200],
        "body": body[:4000],
        "requester": login[:120] if isinstance(login, str) and len(login) >= 2 else "github",
    }


def outbound(fmt: str, event_id: str, event_type: str, payload: dict, received_at: str) -> dict:
    """Lo que el worker envía al destino; el detalle del panel muestra lo mismo.
    Un evento que triaje no acepta (guardado antes de cambiar de formato) conserva el resumen."""
    if fmt == TRIAJE and accepts(fmt, event_type, payload):
        return to_triaje(payload)
    return normalize(event_id, event_type, payload, received_at)
