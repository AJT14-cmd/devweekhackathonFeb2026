# MongoDB backend

The backend uses **MongoDB** for the `meetings` collection and **GridFS** (same database) for audio files.

## Setup

1. Install dependencies: `pip install -r requirements.txt`
2. Set `MONGODB_URI` in `.env` (e.g. `mongodb://localhost:27017` or a MongoDB Atlas URI).
3. Optional: `MONGODB_DB_NAME` (default: `meeting_transcription`).

No schema migration is required: the app creates the `meetings` collection and GridFS bucket `meeting_audio` on first use.

## Auth

Authentication is handled by the **backend** (MongoDB `users` collection + JWT). The frontend calls `POST /auth/register` and `POST /auth/login`; the backend issues JWTs and verifies them on protected routes. Set `JWT_SECRET` (or `SECRET_KEY`) in `.env`.

## Audio

Recordings are stored as **WebM** in GridFS. To allow users to **download as MP3**, install **ffmpeg** on the server. The route `GET /meetings/:id/audio/download?format=mp3` converts on the fly; without ffmpeg it returns 503.
