# Stage 1: Build dependencies
FROM --platform=linux/amd64 python:3.9-slim AS builder

WORKDIR /build

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
  build-essential \
  curl \
  && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir pip-tools wheel

COPY processing-service/NERAPI/requirements.txt .

# First build spaCy and other requirements
RUN pip wheel --no-cache-dir --no-deps --wheel-dir /build/wheels -r requirements.txt

# Then build the tako model
RUN pip wheel --no-cache-dir --no-deps --wheel-dir /build/wheels \
  "https://huggingface.co/TakoData/en_tako_query_analyzer/resolve/main/en_tako_query_analyzer-any-py3-none-any.whl"

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

# Install spaCy first
RUN pip install --no-cache-dir $(find /wheels -name "spacy*.whl") && \
  # Then install the tako model
  pip install --no-cache-dir $(find /wheels -name "en_tako_query_analyzer*.whl") && \
  # Finally install everything else
  pip install --no-cache-dir $(find /wheels -not -name "spacy*.whl" -not -name "en_tako_query_analyzer*.whl" -name "*.whl") && \
  rm -rf /wheels

COPY processing-service/NERAPI/*.py /app/

RUN chown -R app:app /app \
  && chmod -R 755 /app

USER app

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:${PORT}/healthz || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2", "--limit-concurrency", "100"]
