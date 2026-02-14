"""
Flask-SocketIO server for real-time AI meeting transcription.
Streams client audio to Deepgram and forwards transcripts back.
Also serves REST API for meetings (no Supabase).
"""
import eventlet
eventlet.monkey_patch()

import os
import uuid
from datetime import datetime
from flask import Flask, request, jsonify
from flask_socketio import SocketIO
from dotenv import load_dotenv

load_dotenv()

from deepgram_stream import DeepgramStream

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret-change-in-production")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

# Per-connection Deepgram stream (keyed by session id)
streams = {}

# In-memory meetings store (local backend, no Supabase)
meetings_store = {}


def meeting_to_json(m):
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


@app.route("/health")
def health():
    return jsonify({"ok": True})


@app.route("/meetings", methods=["GET"])
def list_meetings():
    return jsonify({"meetings": [meeting_to_json(m) for m in meetings_store.values()]})


@app.route("/meetings", methods=["POST"])
def create_meeting():
    title = request.form.get("title", "Untitled")
    audio = request.files.get("audio")
    meeting_id = str(uuid.uuid4())
    now = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
    meeting = {
        "id": meeting_id,
        "title": title,
        "uploadDate": now,
        "duration": "0:00",
        "fileName": audio.filename if audio else "",
        "wordCount": 0,
        "transcript": "",
        "summary": "",
        "keyInsights": [],
        "decisions": [],
        "actionItems": [],
        "processed": False,
    }
    meetings_store[meeting_id] = meeting
    return jsonify({"meeting": meeting_to_json(meeting)})


@app.route("/meetings/<meeting_id>", methods=["GET"])
def get_meeting(meeting_id):
    if meeting_id not in meetings_store:
        return jsonify({"error": "Not found"}), 404
    return jsonify({"meeting": meeting_to_json(meetings_store[meeting_id])})


@app.route("/meetings/<meeting_id>", methods=["DELETE"])
def delete_meeting(meeting_id):
    if meeting_id not in meetings_store:
        return jsonify({"error": "Not found"}), 404
    del meetings_store[meeting_id]
    return jsonify({"ok": True})


@app.route("/meetings/<meeting_id>/process", methods=["POST"])
def process_meeting(meeting_id):
    if meeting_id not in meetings_store:
        return jsonify({"error": "Not found"}), 404
    m = meetings_store[meeting_id]
    m["processed"] = True
    m["summary"] = m.get("summary") or "Summary (process stub – add Deepgram file API to generate)."
    m["transcript"] = m.get("transcript") or "(Transcript would come from Deepgram file processing.)"
    m["keyInsights"] = m.get("keyInsights") or []
    m["decisions"] = m.get("decisions") or []
    m["actionItems"] = m.get("actionItems") or []
    m["wordCount"] = len(m["transcript"].split())
    return jsonify({"meeting": meeting_to_json(m)})


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
