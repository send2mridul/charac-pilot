FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libsndfile1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

RUN mkdir -p /data/uploads /data/replacements /data/voice_design /data/avatars /data/clips /data/previews

ENV CASTWEAVE_STORAGE_PATH=/data
ENV PYTHONUNBUFFERED=1
ENV WHISPER_MODEL_SIZE=tiny
ENV WHISPER_MODEL_SIZE_EN=tiny
ENV WHISPER_MODEL_SIZE_HI=small

EXPOSE 8000

CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000} --workers 1
