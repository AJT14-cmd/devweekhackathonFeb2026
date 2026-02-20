# Insightly

Real-time meeting transcription: browser microphone → Flask → Deepgram WebSocket → live transcript in the React UI. Recordings and users are stored in MongoDB; audio files in GridFS. Auth is JWT-based (backend-issued).

---

## How to run on a new machine

You can run **with Docker** (recommended) or **without Docker**.

### Option A: With Docker

**You need:** Docker and Docker Compose.

1. Clone the repo and go to the project root.
2. Start everything:
   ```bash
   docker compose up --build
   ```
3. Open [http://localhost:5173](http://localhost:5173).

The stack runs MongoDB, the backend, and the frontend. All env vars have defaults in `docker-compose.yml`. Add a `.env` file at the project root to override (e.g. `DEEPGRAM_API_KEY` for live transcription, or `MONGODB_URI` for Atlas).

**Using MongoDB Atlas:** Create a `.env` with `MONGODB_URI=mongodb+srv://...`, then run:
```bash
docker compose up --build backend frontend
```

**Docker env and `.env`:**
- All variables are defined in `docker-compose.yml` with defaults. You don’t need a `.env` file to run.
- Override any value by creating a `.env` at the project root. Compose substitutes those into the YAML.
- Inside the containers, `.env` is created automatically from the compose environment (see `backend/docker-entrypoint.sh` and `frontend/docker-entrypoint.sh`).

**Variables in `docker-compose.yml`:**

| Variable | Default | Purpose |
|----------|---------|---------|
| `MONGODB_URI` | `mongodb://mongo:27017` | MongoDB connection; set to Atlas URI to use Atlas. |
| `MONGODB_DB_NAME` | (empty) | Database name; backend falls back to `meeting_transcription` when empty. |
| `SECRET_KEY` | `dev-secret-change-in-production` | Flask/JWT secret. |
| `JWT_SECRET` | (empty) | JWT signing; uses SECRET_KEY when empty. |
| `DEEPGRAM_API_KEY` | (empty) | Live transcription; set to enable mic. |
| `FOXIT_CLIENT_ID` | (empty) | Foxit API client ID for PDF report generation. |
| `FOXIT_CLIENT_SECRET` | (empty) | Foxit API client secret for PDF report generation. |
| `VITE_API_URL` | `http://localhost:5000` | Backend URL (browser). |
| `VITE_SOCKET_URL` | `http://localhost:5000` | Socket.IO URL (browser). |

### Option B: Without Docker

**You need:** Python 3.10+, Node.js 18+, MongoDB (local or Atlas), ffmpeg (for “Download as MP3”).

1. **MongoDB:** Install and start locally, or use [MongoDB Atlas](https://www.mongodb.com/atlas) and get a connection string.
2. **Backend:**
   ```bash
   cd backend
   python -m venv .venv
   source .venv/bin/activate   # Windows: .venv\Scripts\activate
   pip install -r requirements.txt
   ```
   Create `backend/.env` from `backend/.env.example` (set `MONGODB_URI`, `SECRET_KEY`, optional `DEEPGRAM_API_KEY`), then:
   ```bash
   python app.py
   ```
   Runs at http://localhost:5000.
3. **Frontend** (new terminal):
   ```bash
   cd frontend
   npm install
   npm run dev
   ```
   Runs at http://localhost:5173. Create `frontend/.env` from `frontend/.env.example` if needed (often empty for local proxy).
4. Open http://localhost:5173, sign up or log in, then record or upload meetings.

**Summary:**

| Method | Command / steps |
|--------|------------------|
| **Docker** | `docker compose up --build` → open http://localhost:5173 |
| **No Docker** | Start MongoDB → backend: `python app.py` → frontend: `npm run dev` → open http://localhost:5173 |

---

## Folder structure

```
devweekhackathonFeb2026/
├── backend/
│   ├── app.py              # Flask-SocketIO, REST API (meetings, auth), GridFS
│   ├── auth.py             # JWT verification
│   ├── deepgram_stream.py  # WebSocket to Deepgram, live transcript
│   ├── foxit_report.py     # Foxit Document Gen + PDF Services for meeting report PDFs
│   ├── mongodb_client.py   # MongoDB + GridFS
│   ├── templates/          # Word template for Foxit PDF report (meeting_report.docx)
│   ├── requirements.txt
│   ├── Dockerfile
│   └── docker-entrypoint.sh
├── frontend/
│   ├── src/
│   │   ├── app/            # React app, AuthContext, api, components
│   │   └── main.tsx
│   ├── package.json
│   ├── vite.config.js
│   ├── Dockerfile
│   └── docker-entrypoint.sh
├── docker-compose.yml
├── .env.example             # Copy to .env for Docker overrides (e.g. DEEPGRAM_API_KEY)
└── README.md
```

---

## Troubleshooting

- **"DEEPGRAM_API_KEY must be set"** — Add `DEEPGRAM_API_KEY=...` to `backend/.env` (or root `.env` for Docker) and restart.
- **"Registration failed: database error" / MongoDB connection** — Check `MONGODB_URI` and that MongoDB is running (or Atlas reachable). See backend logs.
- **Connection failed / socket never connects** — Ensure backend is on port 5000. For a different host, set `VITE_SOCKET_URL` and `VITE_API_URL` in `frontend/.env`.
- **Microphone permission denied** — Use HTTPS or `localhost`; some browsers block `getUserMedia` on plain HTTP.
- **404 on /auth/login or /auth/register** — With Vite dev, ensure `vite.config.js` proxies `/auth` (and `/meetings`, etc.) to the backend.
- **MP3 download fails** — Backend needs ffmpeg installed (Docker image includes it).
- **PDF report download fails or shows 503** — Set `FOXIT_CLIENT_ID` and `FOXIT_CLIENT_SECRET` in `.env` (or `backend/.env`). Get credentials from the [Foxit Developer Portal](https://developers.foxit.com/).

---

## Foxit PDF Report

Meeting reports can be exported as polished PDFs using **Foxit Document Generation** and **Foxit PDF Services** APIs. When viewing a meeting, click **Download Meeting Report (PDF)** to generate a PDF containing the summary, key insights, decisions, action items, and a transcript excerpt.

**Setup:** Add `FOXIT_CLIENT_ID` and `FOXIT_CLIENT_SECRET` to your `.env` (or `backend/.env`). Create an account and obtain credentials from the [Foxit Developer Portal](https://developers.foxit.com/). The health endpoint (`GET /health`) returns `foxit_configured: true` when credentials are set.

---

## Tech summary

- **Frontend:** React (Vite), Socket.IO client, Web Audio API, sign up / log in (backend JWT), meetings list and detail, audio playback, download as MP3, download meeting report as PDF.
- **Backend:** Flask, Flask-SocketIO, MongoDB (meetings + users), GridFS (audio), JWT auth, Deepgram WebSocket for live transcription, Foxit Document Generation + PDF Services for meeting report PDFs. Recordings stored as WebM; MP3 conversion on download via ffmpeg.
- **Auth:** Backend issues JWTs on register/login; frontend sends Bearer token; no Supabase.
