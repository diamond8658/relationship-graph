# psycopg2-binary ships prebuilt wheels, so no build-essential/libpq-dev
# needed here — keeps the image lean, unlike the plain psycopg2 package.
FROM python:3.11-slim

WORKDIR /app

# Separate layer for deps so `docker build` cache hits on every code-only
# change instead of reinstalling everything each time.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Run as a non-root user — no reason this process needs root inside the
# container, and it's one less thing to think about if this image is ever
# compromised.
RUN useradd --create-home appuser
USER appuser

EXPOSE 8000

# Lets Docker/Dockge show real health status instead of just "container is
# running" (which uvicorn crash-looping could still report as "up").
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health', timeout=2)" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
