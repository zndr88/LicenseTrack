# ── Stage 1: Build the React frontend ────────────────────────────────────────
FROM node:22-alpine AS frontend-build

WORKDIR /app/frontend

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/ ./

# Build the stable web client.
RUN npm run build


# ── Stage 2: Python runtime ───────────────────────────────────────────────────
FROM python:3.12-slim AS runtime

WORKDIR /app

# Install production dependencies before copying source so the layer is cached.
COPY backend/requirements-runtime.txt ./
RUN pip install --no-cache-dir -r requirements-runtime.txt

# Copy backend source
COPY backend/ ./

# Copy compiled frontend assets from stage 1
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Create persistent data directories
RUN mkdir -p /data/storage /data/backups

# Run as non-root
RUN useradd -m -u 1000 appuser && \
    chown -R appuser:appuser /app /data
USER appuser

EXPOSE 8000

CMD ["python", "run_server.py"]
