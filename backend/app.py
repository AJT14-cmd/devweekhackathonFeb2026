"""
Flask-SocketIO server for real-time AI meeting transcription.
Streams client audio to Deepgram and forwards transcripts back.
REST API for meetings backed by Supabase Postgres + Storage.
"""
import os
import uuid as _uuid
from flask import Flask, request, jsonify, g
from flask_socketio import SocketIO
from dotenv import load_dotenv

load_dotenv()

from deepgram_stream import DeepgramStream
from supabase_client import supabase
from auth import require_auth

import jwt as pyjwt

SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET", "")

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret-change-in-production")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# Per-connection Deepgram stream (keyed by session id)
streams = {}

STORAGE_BUCKET = "meeting-audio"


# ──────────────────── helpers ────────────────────

def _row_to_json(row: dict) -> dict:
    """Map a Supabase DB row (snake_case) to the JSON shape the frontend expects."""
    return {
        "id": row["id"],
        "title": row["title"],
        "uploadDate": row.get("upload_date", ""),
        "duration": row.get("duration", "0:00"),
        "fileName": row.get("file_name", ""),
        "wordCount": row.get("word_count", 0),
        "transcript": row.get("transcript", ""),
        "summary": row.get("summary", ""),
        "keyInsights": row.get("key_insights", []),
        "decisions": row.get("decisions", []),
        "actionItems": row.get("action_items", []),
        "processed": row.get("processed", False),
        "audioUrl": None,  # populated on single-meeting fetch
        "error": row.get("error"),
    }


# ──────────────────── routes ────────────────────

@app.route("/health")
def health():
    return jsonify({"ok": True})


@app.route("/meetings", methods=["GET"])
@require_auth
def list_meetings():
    result = (
        supabase.table("meetings")
        .select("*")
        .eq("user_id", g.user_id)
        .order("created_at", desc=True)
        .execute()
    )
    meetings = [_row_to_json(r) for r in result.data]
    return jsonify({"meetings": meetings})


@app.route("/meetings", methods=["POST"])
@require_auth
def create_meeting():
    title = request.form.get("title", "Untitled")
    audio = request.files.get("audio")

    audio_path = None
    file_name = ""

    if audio:
        file_name = audio.filename or "audio"
        ext = os.path.splitext(file_name)[1] or ".webm"
        storage_name = f"{g.user_id}/{_uuid.uuid4()}{ext}"
        file_bytes = audio.read()
        supabase.storage.from_(STORAGE_BUCKET).upload(
            storage_name,
            file_bytes,
            {"content-type": audio.content_type or "audio/webm"},
        )
        audio_path = storage_name

    # Insert row into meetings table
    row = {
        "user_id": g.user_id,
        "title": title,
        "file_name": file_name,
        "audio_path": audio_path,
    }
    result = supabase.table("meetings").insert(row).execute()
    meeting = result.data[0]
    return jsonify({"meeting": _row_to_json(meeting)}), 201


@app.route("/meetings/<meeting_id>", methods=["GET"])
@require_auth
def get_meeting(meeting_id):
    result = (
        supabase.table("meetings")
        .select("*")
        .eq("id", meeting_id)
        .eq("user_id", g.user_id)
        .maybe_single()
        .execute()
    )
    if not result.data:
        return jsonify({"error": "Not found"}), 404

    meeting_json = _row_to_json(result.data)

    # Generate a signed URL for audio playback if audio exists
    audio_path = result.data.get("audio_path")
    if audio_path:
        signed = supabase.storage.from_(STORAGE_BUCKET).create_signed_url(audio_path, 3600)
        meeting_json["audioUrl"] = signed.get("signedURL") or signed.get("signedUrl")

    return jsonify({"meeting": meeting_json})


@app.route("/meetings/<meeting_id>", methods=["DELETE"])
@require_auth
def delete_meeting(meeting_id):
    # Fetch first to get audio_path
    result = (
        supabase.table("meetings")
        .select("audio_path")
        .eq("id", meeting_id)
        .eq("user_id", g.user_id)
        .maybe_single()
        .execute()
    )
    if not result.data:
        return jsonify({"error": "Not found"}), 404

    # Delete audio from storage
    audio_path = result.data.get("audio_path")
    if audio_path:
        try:
            supabase.storage.from_(STORAGE_BUCKET).remove([audio_path])
        except Exception as e:
            print(f"Storage delete warning: {e}")

    # Delete row
    supabase.table("meetings").delete().eq("id", meeting_id).eq("user_id", g.user_id).execute()
    return jsonify({"ok": True})


@app.route("/meetings/<meeting_id>/process", methods=["POST"])
@require_auth
def process_meeting(meeting_id):
    result = (
        supabase.table("meetings")
        .select("*")
        .eq("id", meeting_id)
        .eq("user_id", g.user_id)
        .maybe_single()
        .execute()
    )
    if not result.data:
        return jsonify({"error": "Not found"}), 404

    m = result.data

    updates = {
        "processed": True,
        "summary": m.get("summary") or "Summary (stub – add Deepgram file API to generate).",
        "transcript": m.get("transcript") or "(Transcript from Deepgram file processing.)",
        "key_insights": m.get("key_insights") or [],
        "decisions": m.get("decisions") or [],
        "action_items": m.get("action_items") or [],
    }
    updates["word_count"] = len(updates["transcript"].split())

    updated = (
        supabase.table("meetings")
        .update(updates)
        .eq("id", meeting_id)
        .eq("user_id", g.user_id)
        .execute()
    )
    return jsonify({"meeting": _row_to_json(updated.data[0])})


# ──────────────────── SocketIO events ────────────────────

@socketio.on("connect")
def handle_connect():
    sid = request.sid

    # Optionally verify JWT from handshake auth
    token = request.args.get("token") or (request.headers.get("Authorization") or "").replace("Bearer ", "")
    if token and SUPABASE_JWT_SECRET:
        try:
            pyjwt.decode(token, SUPABASE_JWT_SECRET, algorithms=["HS256"], audience="authenticated")
        except pyjwt.InvalidTokenError:
            print(f"SocketIO auth failed for {sid}")
            return False  # reject connection

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
