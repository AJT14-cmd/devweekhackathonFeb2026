# Insightly

AI meeting transcription and analysis: live recording, file upload, transcription (Deepgram), AI summaries (You.com), and PDF reports (Foxit). Built with React, Flask, MongoDB, and Docker.

---

## Quick Start (Docker)

**Prerequisites:** Docker and Docker Compose

```bash
# 1. Clone and enter project
git clone <repo-url>
cd devweekhackathonFeb2026

# 2. Configure (optional — works with defaults)
cp .env.example .env
# Edit .env: set DEEPGRAM_API_KEY for live transcription

# 3. Run
docker compose up --build
```

Open **http://localhost:5173** — sign up, then record or upload meetings.

---

## Configuration

Copy `.env.example` to `.env` at the project root and edit as needed.

| Variable | Required | Purpose |
|----------|----------|---------|
| `MONGODB_URI` | Yes* | MongoDB connection. Default `mongodb://mongo:27017` works with Docker. Use `mongodb+srv://...` for [Atlas](https://www.mongodb.com/atlas). |
| `DEEPGRAM_API_KEY` | Yes** | [Deepgram](https://console.deepgram.com) — live mic + file transcription |
| `YOUCOM_API_KEY` | No | [You.com](https://you.com/platform) — AI summaries (insights, decisions, action items) |
| `FOXIT_CLIENT_ID` / `FOXIT_CLIENT_SECRET` | No | [Foxit](https://developers.foxit.com) — PDF meeting report generation |
| `VITE_API_URL` / `VITE_SOCKET_URL` | Production | Backend URL reachable from browser (default: `http://localhost:5000`) |

\* Docker default works out of the box. For Atlas: set `MONGODB_URI` and run `docker compose up --build backend frontend` (omit mongo).  
\** App runs without it, but live mic and file transcription won’t work.

---

## Deployment Options

### Option A: Docker (recommended)

```bash
docker compose up --build
```

Runs MongoDB, backend (port 5000), and frontend (port 5173). All config via root `.env`.

**MongoDB Atlas:** Set `MONGODB_URI` in `.env`, then:

```bash
docker compose up --build --scale mongo=0
```

### Option B: Local (no Docker)

**Prerequisites:** Python 3.10+, Node.js 18+, MongoDB, ffmpeg

1. **MongoDB** — Local or [Atlas](https://www.mongodb.com/atlas)
2. **Backend:**
   ```bash
   cd backend
   cp .env.example .env   # Set MONGODB_URI, DEEPGRAM_API_KEY
   python -m venv .venv
   .venv\Scripts\activate   # Windows
   pip install -r requirements.txt
   python app.py            # → http://localhost:5000
   ```
3. **Frontend** (new terminal):
   ```bash
   cd frontend
   cp .env.example .env     # Usually empty for local proxy
   npm install
   npm run dev              # → http://localhost:5173
   ```

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "DEEPGRAM_API_KEY must be set" | Add key to root `.env` (Docker) or `backend/.env` (local). Restart. |
| MongoDB connection errors | Check `MONGODB_URI`. Ensure MongoDB is running (local or Atlas reachable). |
| Socket/API connection failed | Backend must be on port 5000. For remote hosts, set `VITE_API_URL` and `VITE_SOCKET_URL` in root `.env`. |
| Microphone permission denied | Use HTTPS or localhost — browsers block `getUserMedia` on plain HTTP. |
| MP3 download fails | ffmpeg required. Docker image includes it. |
| PDF report 503 | Set `FOXIT_CLIENT_ID` and `FOXIT_CLIENT_SECRET`. Check `/health` for `foxit_configured: true`. |

---

## Project Structure

```
├── backend/          # Flask, Socket.IO, REST API, Deepgram, Foxit, You.com
├── frontend/         # React (Vite), Socket.IO client, Web Audio API
├── docker-compose.yml
├── .env.example      # Copy to .env for Docker config
└── README.md
```

---

## Tech Stack

- **Frontend:** React (Vite), Tailwind, Radix UI, Socket.IO, Web Audio API
- **Backend:** Flask, Flask-SocketIO, MongoDB, GridFS, JWT auth
- **APIs:** Deepgram (transcription), You.com (summaries), Foxit (PDF reports)
- **Audio:** WebM storage; ffmpeg for MP3 export
