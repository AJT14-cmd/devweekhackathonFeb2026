# Backend: Flask + MongoDB client + ffmpeg for MP3 conversion
FROM python:3.12-slim

# ffmpeg for audio download (WebM -> MP3)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Load .env from /app (optional; prefer docker-compose env)
ENV FLASK_APP=app.py
EXPOSE 5000

CMD ["python", "app.py"]
