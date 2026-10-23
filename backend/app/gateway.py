"""Pasarela para exponer por un túnel SOLO POST /webhooks/github.

  python -m app.gateway      (escucha en 127.0.0.1:8001 y reenvía a http://127.0.0.1:8000)

El túnel apunta a esta pasarela; /api/* y /docs quedan accesibles solo en local.
"""
import os

import httpx
from fastapi import FastAPI, Request, Response

FORWARD_HEADERS = ("content-type", "x-github-event", "x-github-delivery", "x-hub-signature-256")


def create_gateway(upstream: str, client: httpx.Client) -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.post("/webhooks/github")
    async def forward(request: Request):
        body = await request.body()
        headers = {h: request.headers[h] for h in FORWARD_HEADERS if h in request.headers}
        try:
            r = client.post(f"{upstream}/webhooks/github", content=body, headers=headers, timeout=10)
        except httpx.HTTPError:
            return Response(status_code=502)
        return Response(r.content, status_code=r.status_code, media_type="application/json")

    return app


if __name__ == "__main__":
    import uvicorn

    api = os.environ.get("GATEWAY_UPSTREAM", "http://127.0.0.1:8000")
    uvicorn.run(create_gateway(api, httpx.Client()), host="127.0.0.1", port=8001, log_level="warning")
