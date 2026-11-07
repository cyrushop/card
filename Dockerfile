# OPCG 卡庫 — online version for Google Cloud Run (see deploy/README.md).
FROM python:3.12-slim

# Pillow shrinks card pictures to WebP (OPCG_IMAGE_WIDTH below); everything else is standard library.
RUN pip install --no-cache-dir pillow==11.3.0

WORKDIR /srv
COPY serve.py ./
COPY app ./app
COPY bot ./bot

# Data lives in a Cloud Storage bucket mounted at /data (set in deploy/deploy.sh).
ENV OPCG_DATA=/data \
    OPCG_IMAGE_WIDTH=400 \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# --cloud listens on $PORT (Cloud Run sets it) and refuses to start unless
# ALLOWED_EMAILS (with IAP) or OPCG_PIN is set.
CMD ["python3", "-I", "serve.py", "--cloud"]
