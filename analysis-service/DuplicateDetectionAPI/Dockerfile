# Stage 1: Build dependencies
FROM --platform=linux/amd64 python:3.9-slim AS builder

WORKDIR /build

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
  build-essential \
  curl \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir pip-tools wheel

COPY analysis-service/DuplicateDetectionAPI/requirements.txt .

# Build main requirements
RUN pip wheel --no-cache-dir --no-deps --wheel-dir /build/wheels -r requirements.txt

# Build spaCy model
RUN pip wheel --no-cache-dir --no-deps --wheel-dir /build/wheels \
  en-core-web-md==3.5.0 --find-links https://github.com/explosion/spacy-models/releases/download/en_core_web_md-3.5.0/en_core_web_md-3.5.0.tar.gz

# Stage 2: Runtime
FROM --platform=linux/amd64 python:3.9-slim

ENV PYTHONUNBUFFERED=1 \
  PYTHONDONTWRITEBYTECODE=1 \
  PORT=8000

RUN adduser --system --group app

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
  tini \
  curl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=builder /build/wheels /wheels

# Install packages in specific order
RUN pip install --no-cache-dir /wheels/pydantic*.whl && \
  pip install --no-cache-dir /wheels/spacy*.whl && \
  pip install --no-cache-dir /wheels/en_core_web_md*.whl && \
  pip install --no-cache-dir $(find /wheels -not -name "pydantic*.whl" -not -name "spacy*.whl" -not -name "en_core_web_md*.whl" -name "*.whl") && \
  rm -rf /wheels

COPY analysis-service/DuplicateDetectionAPI/api.py /app/

RUN chown -R app:app /app \
  && chmod -R 755 /app

USER app

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:${PORT}/healthz || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--limit-concurrency", "100"]

EXPOSE 8000
