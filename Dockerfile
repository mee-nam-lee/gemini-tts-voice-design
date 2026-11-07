FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
# Install from public PyPI (the local uv.lock points at an internal mirror unreachable from Cloud Build).
ENV UV_INDEX_URL=https://pypi.org/simple PYTHONUNBUFFERED=1
COPY pyproject.toml ./
RUN uv pip install --system --no-cache -r pyproject.toml
COPY app ./app
COPY static ./static
COPY data ./data
ENV PORT=8080
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
