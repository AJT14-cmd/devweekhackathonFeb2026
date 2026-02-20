# Backend: Flask + MongoDB client + ffmpeg for MP3 conversion
FROM python:3.12-slim

# ffmpeg for audio download (WebM -> MP3)
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Generate Foxit meeting report template (requires python-docx)
RUN python scripts/create_meeting_template.py 2>/dev/null || true

RUN tr -d '\r' < /app/docker-entrypoint.sh > /tmp/ep && mv /tmp/ep /app/docker-entrypoint.sh \
    && chmod +x /app/docker-entrypoint.sh

ENV FLASK_APP=app.py
EXPOSE 5000

ENTRYPOINT ["/bin/sh", "/app/docker-entrypoint.sh"]
CMD ["python", "app.py"]
