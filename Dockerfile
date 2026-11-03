# OPCG 卡庫 — online version for Google Cloud Run (see deploy/README.md).
# Standard library only: no packages to install.
FROM python:3.12-slim

WORKDIR /srv
COPY serve.py ./
COPY app ./app
COPY bot ./bot

# Data lives in a Cloud Storage bucket mounted at /data (set in deploy/deploy.sh).
ENV OPCG_DATA=/data \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# --cloud listens on $PORT (Cloud Run sets it) and refuses to start unless
# ALLOWED_EMAILS (with IAP) or OPCG_PIN is set.
CMD ["python3", "-I", "serve.py", "--cloud"]
