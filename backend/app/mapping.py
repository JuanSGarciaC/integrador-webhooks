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
