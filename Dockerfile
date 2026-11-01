# Imagen de la demo pública: panel + API + worker + destino simulado en un contenedor.
# docker build -t integrador-demo .
# docker run --rm -p 8080:8080 -e WEBHOOK_SECRET=... -e ADMIN_TOKEN=... integrador-demo

FROM node:22-slim AS panel
WORKDIR /panel
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DEMO_MODE=true \
    STATIC_DIR=/app/static \
    DATABASE_URL=sqlite:////tmp/webhooks.db \
    DOWNSTREAM_URL=http://127.0.0.1:9000/ingest \
    RETRY_BASE_SECONDS=1 \
    RETRY_CAP_SECONDS=10 \
    MAX_ATTEMPTS=4 \
    POLL_INTERVAL_SECONDS=0.5 \
    HTTP_TIMEOUT_SECONDS=2 \
    PORT=8080
WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./
COPY --from=panel /panel/dist ./static
RUN useradd --create-home --uid 10001 demo
USER demo
EXPOSE 8080
CMD ["bash", "scripts/start_demo.sh"]
