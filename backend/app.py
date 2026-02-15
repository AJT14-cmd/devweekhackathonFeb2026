"""
Flask-SocketIO server for real-time AI meeting transcription.
Streams client audio to Deepgram and forwards transcripts back.
REST API for meetings: in-memory store (no Supabase).
"""
import os
import uuid
from datetime import datetime
from flask import Flask, request, jsonify, send_from_directory
from flask_socketio import SocketIO
from dotenv import load_dotenv

load_dotenv()

from deepgram_stream import DeepgramStream

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret-change-in-production")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# Per-connection Deepgram stream (keyed by session id)
streams = {}

# In-memory meetings store (no Supabase)
meetings_store = {}

# Directory for saved audio files (created on first use)
UPLOADS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)


def _meeting_to_json(m):
    return {
        "id": m["id"],
        "title": m["title"],
        "uploadDate": m["uploadDate"],
        "duration": m.get("duration", "0:00"),
        "fileName": m.get("fileName", ""),
        "wordCount": m.get("wordCount", 0),
        "transcript": m.get("transcript", ""),
        "summary": m.get("summary", ""),
        "keyInsights": m.get("keyInsights", []),
        "decisions": m.get("decisions", []),
        "actionItems": m.get("actionItems", []),
        "processed": m.get("processed", False),
        "audioUrl": m.get("audioUrl"),
        "error": m.get("error"),
    }


# ──────────────────── REST routes ────────────────────

@app.route("/health")
def health():
    return jsonify({"ok": True})


@app.route("/meetings", methods=["GET"])
def list_meetings():
    return jsonify({"meetings": [_meeting_to_json(m) for m in meetings_store.values()]})


@app.route("/meetings", methods=["POST"])
def create_meeting():
    # Only treat as JSON when Content-Type is explicitly application/json.
    # Otherwise we expect form data (and optionally an audio file).
    content_type = (request.content_type or "").lower()
    if "application/json" in content_type:
        data = request.get_json(silent=True) or {}
        title = data.get("title", "Untitled")
        transcript_text = (data.get("transcript") or "").strip()
        audio = None
    else:
        title = request.form.get("title", "Untitled")
        audio = request.files.get("audio")
        transcript_text = (request.form.get("transcript") or "").strip()
        duration_form = (request.form.get("duration") or "").strip()
        if audio:
            fn = getattr(audio, 'filename', None)
            print(f"[create_meeting] received audio file: filename={fn}")
        else:
            print("[create_meeting] no audio file in request; content_type=%r" % content_type)

    meeting_id = str(uuid.uuid4())
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
    audio_url = None
    file_name = "(live recording)"
    if audio:
        file_name = audio.filename or "recording.webm"
        ext = os.path.splitext(file_name)[1] or ".webm"
        safe_name = meeting_id + ext
        path = os.path.join(UPLOADS_DIR, safe_name)
        try:
            audio.save(path)
            audio_url = "/uploads/" + safe_name
            print(f"[create_meeting] saved audio to {path}, audioUrl={audio_url}")
        except Exception as e:
            print(f"[create_meeting] failed to save audio: {e}")

    meeting = {
        "id": meeting_id,
        "title": title,
        "uploadDate": now,
        "duration": duration_form if duration_form else "0:00",
        "fileName": file_name,
        "wordCount": len(transcript_text.split()) if transcript_text else 0,
        "transcript": transcript_text,
        "summary": transcript_text[:200] + "..." if len(transcript_text) > 200 else transcript_text if transcript_text else "",
        "keyInsights": [],
        "decisions": [],
        "actionItems": [],
        "processed": bool(transcript_text),
        "audioUrl": audio_url,
    }
    meetings_store[meeting_id] = meeting
    return jsonify({"meeting": _meeting_to_json(meeting)}), 201


@app.route("/meetings/<meeting_id>", methods=["GET"])
def get_meeting(meeting_id):
    if meeting_id not in meetings_store:
        return jsonify({"error": "Not found"}), 404
    return jsonify({"meeting": _meeting_to_json(meetings_store[meeting_id])})


@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    return send_from_directory(UPLOADS_DIR, filename)


@app.route("/meetings/<meeting_id>", methods=["DELETE"])
def delete_meeting(meeting_id):
    if meeting_id not in meetings_store:
        return jsonify({"error": "Not found"}), 404
    m = meetings_store[meeting_id]
    audio_url = m.get("audioUrl")
    if audio_url and audio_url.startswith("/uploads/"):
        try:
            path = os.path.join(UPLOADS_DIR, os.path.basename(audio_url))
            if os.path.isfile(path):
                os.remove(path)
        except OSError as e:
            print(f"Could not delete audio file: {e}")
    del meetings_store[meeting_id]
    return jsonify({"ok": True})


@app.route("/meetings/<meeting_id>/process", methods=["POST"])
def process_meeting(meeting_id):
    if meeting_id not in meetings_store:
        return jsonify({"error": "Not found"}), 404
    m = meetings_store[meeting_id]
    m["processed"] = True
    m["summary"] = m.get("summary") or "Summary (stub – add Deepgram file API to generate)."
    m["transcript"] = m.get("transcript") or "(Transcript from Deepgram file processing.)"
    m["keyInsights"] = m.get("keyInsights") or []
    m["decisions"] = m.get("decisions") or []
    m["actionItems"] = m.get("actionItems") or []
    m["wordCount"] = len(m["transcript"].split())
    return jsonify({"meeting": _meeting_to_json(m)})


# ──────────────────── SocketIO events ────────────────────

@socketio.on("connect")
def handle_connect():
    sid = request.sid
    print(f"Client connected: {sid}")
    try:
        streams[sid] = DeepgramStream(socketio, sid)
    except ValueError as e:
        print(f"DeepgramStream init failed: {e}")
        socketio.emit("transcript", {"error": str(e)}, room=sid)


@socketio.on("audio_chunk")
def handle_audio_chunk(data):
    sid = request.sid
    stream = streams.get(sid)
    if stream and data is not None:
        stream.send_audio(data)


@socketio.on("disconnect")
def handle_disconnect():
    sid = request.sid
    print(f"Client disconnected: {sid}")
    stream = streams.pop(sid, None)
    if stream:
        stream.close()


if __name__ == "__main__":
    socketio.run(app, host="0.0.0.0", port=5000, debug=False)
