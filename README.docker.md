# Running with Docker (another machine / no local Python or Node)

You only need **Docker** and **Docker Compose** installed. No need for Python, Node, MongoDB, or ffmpeg on the host.

## Quick start

1. **Clone the repo** and go to the project root.

2. **Create a `.env` file** at the project root (copy from `.env.example`):
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and set at least:
   - `DEEPGRAM_API_KEY` – get one at [console.deepgram.com](https://console.deepgram.com)

3. **Start everything:**
   ```bash
   docker compose up --build
   ```

4. **Open in the browser:** [http://localhost:5173](http://localhost:5173)  
   - Frontend: port 5173  
   - Backend API: port 5000  
   - MongoDB: port 27017 (only for other tools; the app talks to it inside Docker)

## What runs

| Service   | Image / build | Purpose                          |
|----------|----------------|----------------------------------|
| `mongo`  | `mongo:7`      | MongoDB (data in volume)         |
| `backend`| `backend/Dockerfile` | Flask + ffmpeg, connects to `mongo` |
| `frontend` | `frontend/Dockerfile` | Vite dev server, talks to backend at localhost:5000 |

The browser runs on your machine, so `VITE_API_URL=http://localhost:5000` is correct: the app in the browser calls your host’s port 5000, which Docker maps to the backend container.

## Optional env vars (in root `.env`)

- `SECRET_KEY` – Flask/JWT secret (default: `dev-secret-change-in-production`)
- `JWT_SECRET` – JWT signing (default: use `SECRET_KEY`)

## Without Docker

You can still run without Docker: install Python 3, Node.js, MongoDB (or use Atlas), and ffmpeg; then use `backend/.env` and `frontend/.env` as described in the root `.env.example`.
