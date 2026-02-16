"""
Flask-SocketIO server for real-time AI meeting transcription.
Streams client audio to Deepgram and forwards transcripts back.
REST API for meetings: Supabase (database + storage for audio).
"""
import os
import uuid
from datetime import datetime
from flask import Flask, request, jsonify, g, send_from_directory
from flask_socketio import SocketIO
from dotenv import load_dotenv

load_dotenv()

from deepgram_stream import DeepgramStream
from auth import require_auth
from supabase_client import supabase

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret-change-in-production")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# Per-connection Deepgram stream (keyed by session id)
streams = {}

STORAGE_BUCKET = "meeting-audio"
SIGNED_URL_EXPIRY = 3600  # 1 hour

# Local uploads directory (backup + visibility on server)
UPLOADS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)


def _row_to_meeting_json(row, audio_url=None):
    """Convert Supabase row (snake_case) to API response (camelCase)."""
    return {
        "id": str(row["id"]),
        "title": row["title"] or "",
        "uploadDate": (row["upload_date"] or "").replace(" ", "T") if row.get("upload_date") else "",
        "duration": row.get("duration") or "0:00",
        "fileName": row.get("file_name") or "",
        "wordCount": row.get("word_count") or 0,
        "transcript": row.get("transcript") or "",
        "summary": row.get("summary") or "",
        "keyInsights": row.get("key_insights") or [],
        "decisions": row.get("decisions") or [],
        "actionItems": row.get("action_items") or [],
        "processed": row.get("processed") or False,
        "audioUrl": audio_url,
        "error": row.get("error"),
    }


def _create_audio_url(audio_path, meeting_id, file_name):
    """Create audio URL: prefer Supabase signed URL, fallback to local /uploads/."""
    if not audio_path:
        return None
    signed_url = None
    try:
        result = supabase.storage.from_(STORAGE_BUCKET).create_signed_url(
            audio_path, SIGNED_URL_EXPIRY
        )
        if isinstance(result, str):
            signed_url = result
        elif isinstance(result, dict):
            signed_url = result.get("signedUrl") or result.get("signed_url") or result.get("signedURL")
    except Exception as e:
        print(f"[_create_audio_url] signed URL failed for {audio_path}: {e}")

    if signed_url:
        return signed_url
    # Fallback to local server copy
    ext = os.path.splitext(file_name or "")[1] or ".webm"
    local_name = str(meeting_id) + ext
    local_path = os.path.join(UPLOADS_DIR, local_name)
    if os.path.isfile(local_path):
        return "/uploads/" + local_name
    return None


# ──────────────────── REST routes ────────────────────

@app.route("/health")
def health():
    return jsonify({"ok": True})


@app.route("/meetings", methods=["GET"])
@require_auth
def list_meetings():
    user_id = g.user_id
    try:
        resp = supabase.table("meetings").select("*").eq("user_id", user_id).order("upload_date", desc=True).execute()
        rows = resp.data or []
        meetings = []
        for row in rows:
            audio_path = row.get("audio_path")
            signed_url = _create_audio_url(audio_path, row["id"], row.get("file_name")) if audio_path else None
            meetings.append(_row_to_meeting_json(row, signed_url))
        return jsonify({"meetings": meetings})
    except Exception as e:
        print(f"[list_meetings] error: {e}")
        return jsonify({"error": "Failed to fetch meetings"}), 500


@app.route("/meetings", methods=["POST"])
@require_auth
def create_meeting():
    user_id = g.user_id
    content_type = (request.content_type or "").lower()
    if "application/json" in content_type:
        data = request.get_json(silent=True) or {}
        title = data.get("title", "Untitled")
        transcript_text = (data.get("transcript") or "").strip()
        audio = None
        duration_form = ""
    else:
        title = request.form.get("title", "Untitled")
        audio = request.files.get("audio")
        transcript_text = (request.form.get("transcript") or "").strip()
        duration_form = (request.form.get("duration") or "").strip()
        if audio:
            print(f"[create_meeting] received audio file: filename={getattr(audio, 'filename', None)}")
        else:
            print("[create_meeting] no audio file in request; content_type=%r" % content_type)

    meeting_id = str(uuid.uuid4())
    file_name = "(live recording)"
    audio_path = None

    if audio:
        file_name = audio.filename or "recording.webm"
        ext = os.path.splitext(file_name)[1] or ".webm"
        storage_path = f"{user_id}/{meeting_id}{ext}"
        file_bytes = audio.read()

        # Save to local server (backup + visibility)
        local_path = os.path.join(UPLOADS_DIR, meeting_id + ext)
        try:
            with open(local_path, "wb") as f:
                f.write(file_bytes)
            print(f"[create_meeting] saved audio to server: {local_path}")
        except Exception as e:
            print(f"[create_meeting] failed to save local copy: {e}")

        # Upload to Supabase Storage
        try:
            supabase.storage.from_(STORAGE_BUCKET).upload(
                storage_path,
                file_bytes,
                {"content-type": audio.content_type or "audio/webm"},
            )
            audio_path = storage_path
            print(f"[create_meeting] uploaded audio to Supabase: {storage_path}")
        except Exception as e:
            print(f"[create_meeting] failed to upload audio to Supabase: {e}")
            return jsonify({"error": "Failed to upload audio"}), 500

    word_count = len(transcript_text.split()) if transcript_text else 0
    summary = transcript_text[:200] + "..." if len(transcript_text) > 200 else (transcript_text if transcript_text else "")

    meeting_row = {
        "id": meeting_id,
        "user_id": user_id,
        "title": title,
        "duration": duration_form or "0:00",
        "file_name": file_name,
        "word_count": word_count,
        "transcript": transcript_text,
        "summary": summary,
        "key_insights": [],
        "decisions": [],
        "action_items": [],
        "processed": bool(transcript_text),
        "audio_path": audio_path,
    }

    try:
        supabase.table("meetings").insert(meeting_row).execute()
    except Exception as e:
        print(f"[create_meeting] failed to insert meeting: {e}")
        if audio_path:
            try:
                supabase.storage.from_(STORAGE_BUCKET).remove([audio_path])
            except Exception as rm_err:
                print(f"[create_meeting] failed to cleanup storage: {rm_err}")
        return jsonify({"error": "Failed to save meeting"}), 500

    signed_url = _create_audio_url(audio_path, meeting_id, file_name) if audio_path else None
    meeting_json = _row_to_meeting_json(meeting_row, signed_url)
    meeting_json["uploadDate"] = datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.000Z")
    return jsonify({"meeting": meeting_json}), 201


@app.route("/meetings/<meeting_id>", methods=["GET"])
@require_auth
def get_meeting(meeting_id):
    user_id = g.user_id
    try:
        resp = supabase.table("meetings").select("*").eq("id", meeting_id).eq("user_id", user_id).execute()
        rows = resp.data or []
        if not rows:
            return jsonify({"error": "Not found"}), 404
        row = rows[0]
        signed_url = _create_audio_url(row.get("audio_path"), row["id"], row.get("file_name")) if row.get("audio_path") else None
        return jsonify({"meeting": _row_to_meeting_json(row, signed_url)})
    except Exception as e:
        print(f"[get_meeting] error: {e}")
        return jsonify({"error": "Failed to fetch meeting"}), 500


@app.route("/uploads/<path:filename>")
def serve_upload(filename):
    """Serve locally saved audio files (backup copy)."""
    return send_from_directory(UPLOADS_DIR, filename)


@app.route("/meetings/<meeting_id>", methods=["DELETE"])
@require_auth
def delete_meeting(meeting_id):
    user_id = g.user_id
    try:
        resp = supabase.table("meetings").select("audio_path", "file_name").eq("id", meeting_id).eq("user_id", user_id).execute()
        rows = resp.data or []
        if not rows:
            return jsonify({"error": "Not found"}), 404
        row = rows[0]
        audio_path = row.get("audio_path")
        file_name = row.get("file_name") or ""
        supabase.table("meetings").delete().eq("id", meeting_id).eq("user_id", user_id).execute()
        if audio_path:
            try:
                supabase.storage.from_(STORAGE_BUCKET).remove([audio_path])
            except Exception as e:
                print(f"[delete_meeting] failed to delete audio from storage: {e}")
        # Delete local backup
        ext = os.path.splitext(file_name)[1] or ".webm"
        local_path = os.path.join(UPLOADS_DIR, meeting_id + ext)
        if os.path.isfile(local_path):
            try:
                os.remove(local_path)
            except OSError as e:
                print(f"[delete_meeting] failed to delete local audio: {e}")
        return jsonify({"ok": True})
    except Exception as e:
        print(f"[delete_meeting] error: {e}")
        return jsonify({"error": "Failed to delete meeting"}), 500


@app.route("/meetings/<meeting_id>/process", methods=["POST"])
@require_auth
def process_meeting(meeting_id):
    user_id = g.user_id
    try:
        resp = supabase.table("meetings").select("*").eq("id", meeting_id).eq("user_id", user_id).execute()
        rows = resp.data or []
        if not rows:
            return jsonify({"error": "Not found"}), 404
        row = rows[0]
        transcript = row.get("transcript") or "(Transcript from Deepgram file processing.)"
        update_data = {
            "processed": True,
            "summary": row.get("summary") or "Summary (stub – add Deepgram file API to generate).",
            "transcript": transcript,
            "key_insights": row.get("key_insights") or [],
            "decisions": row.get("decisions") or [],
            "action_items": row.get("action_items") or [],
            "word_count": len(transcript.split()),
        }
        supabase.table("meetings").update(update_data).eq("id", meeting_id).eq("user_id", user_id).execute()
        signed_url = _create_audio_url(row.get("audio_path"), row["id"], row.get("file_name")) if row.get("audio_path") else None
        updated = {**row, **update_data}
        return jsonify({"meeting": _row_to_meeting_json(updated, signed_url)})
    except Exception as e:
        print(f"[process_meeting] error: {e}")
        return jsonify({"error": "Failed to process meeting"}), 500


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
