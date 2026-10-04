# BeeGuard Lab on a Hugging Face Docker Space: one process serves the API and the built site.
FROM python:3.12-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends libxrender1 libxext6 libexpat1 \
 && rm -rf /var/lib/apt/lists/*

RUN useradd -m -u 1000 user
WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=user . /app
USER user

ENV PYTHONUTF8=1 \
    PYTHONPATH=/app \
    WEB_DIST=/app/apps/web/dist \
    HOME=/home/user

EXPOSE 7860
CMD ["uvicorn", "space_app:app", "--host", "0.0.0.0", "--port", "7860", "--proxy-headers"]
