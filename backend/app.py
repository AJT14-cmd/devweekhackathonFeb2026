"""
Flask-SocketIO server for real-time AI meeting transcription.
Streams client audio to Deepgram and forwards transcripts back.
REST API: MongoDB (meetings + users), GridFS (audio). Auth via JWT (backend-issued).
Recordings are stored as WebM; download can be converted to MP3 on request.
"""
import io
import os
import re
import subprocess
import uuid
from datetime import datetime
from flask import Flask, request, jsonify, g, send_file
from flask_cors import CORS
from flask_socketio import SocketIO
from dotenv import load_dotenv
import bcrypt
import jwt as pyjwt

# Load .env from backend directory so DEEPGRAM_API_KEY is found regardless of cwd
_backend_dir = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(_backend_dir, ".env"))
load_dotenv()  # Also load from current working directory (e.g. root .env)

from deepgram_stream import DeepgramStream
from deepgram_file import transcribe_audio
from summarize import summarize_transcript

# Startup check: verify You.com API key is loaded
try:
    from youcom import _get_api_key
    _yk = _get_api_key()
    print(f"[startup] You.com API key: {'configured' if _yk else 'NOT FOUND (check backend/.env)'}", flush=True)
except Exception as e:
    print(f"[startup] You.com check failed: {e}", flush=True)
from auth import require_auth
from mongodb_client import get_meetings_collection, get_fs, get_users_collection

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret-change-in-production")
CORS(app)  # Allow browser at localhost:5173 to call API at localhost:5000
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="threading")

# Per-connection Deepgram stream (keyed by session id)
streams = {}

# Local uploads directory (optional backup; primary storage is GridFS)
UPLOADS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)


def _doc_to_meeting_json(doc, audio_url=None):
    """Convert MongoDB doc to API response (camelCase)."""
    upload_date = doc.get("upload_date")
    if isinstance(upload_date, datetime):
        upload_date = upload_date.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    elif upload_date and "T" not in str(upload_date):
        upload_date = str(upload_date).replace(" ", "T") + ("Z" if "Z" not in str(upload_date) else "")
    return {
        "id": str(doc.get("id", doc.get("_id", ""))),
        "title": doc.get("title") or "",
        "uploadDate": upload_date or "",
        "duration": doc.get("duration") or "0:00",
        "fileName": doc.get("file_name") or "",
        "wordCount": doc.get("word_count") or 0,
        "transcript": doc.get("transcript") or "",
        "summary": doc.get("summary") or "",
        "keyInsights": doc.get("key_insights") or [],
        "researchInsights": doc.get("research_insights") or [],
        "summarySource": doc.get("summary_source") or "",
        "decisions": doc.get("decisions") or [],
        "actionItems": doc.get("action_items") or [],
        "processed": doc.get("processed") or False,
        "audioUrl": audio_url,
        "error": doc.get("error"),
    }


def _create_audio_url(meeting_id, has_audio):
    """Return backend URL for streaming audio from GridFS (auth required)."""
    if not has_audio:
        return None
    return f"/meetings/{meeting_id}/audio"


# ──────────────────── Auth (no require_auth) ────────────────────

JWT_SECRET = os.getenv("JWT_SECRET") or app.config["SECRET_KEY"]
JWT_ALGORITHM = "HS256"
JWT_EXPIRY_SECONDS = 7 * 24 * 3600  # 7 days


def _db_error_message(e: Exception, action: str) -> str:
    """Turn a database exception into a user-facing message."""
    err = str(e).lower()
    if "connection" in err or "timeout" in err or "server selection" in err or "nodename nor servname" in err:
        return (
            f"{action}: cannot connect to MongoDB. "
            "Check MONGODB_URI in backend/.env and ensure MongoDB is running (local or Atlas)."
        )
    if "authentication" in err or "auth failed" in err:
        return f"{action}: MongoDB authentication failed. Check username/password in MONGODB_URI."
    if "not found" in err or "ns not found" in err:
        return f"{action}: database or collection not found. Check MONGODB_DB_NAME."
    return f"{action}: database error. Please try again."


@app.route("/auth/register", methods=["POST"])
def auth_register():
    """Register with email + password. Returns JWT and user."""
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Invalid request: send JSON with email and password"}), 400
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not email:
        return jsonify({"error": "Email is required"}), 400
    if not password:
        return jsonify({"error": "Password is required"}), 400
    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    try:
        users = get_users_collection()
        if users.find_one({"email": email}):
            return jsonify({"error": "An account with this email already exists"}), 409

        user_id = str(uuid.uuid4())
        hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
        users.insert_one({"_id": user_id, "email": email, "password_hash": hashed})
    except Exception as e:
        print(f"[auth_register] database error: {e}")
        return jsonify({"error": _db_error_message(e, "Registration failed")}), 500

    token = pyjwt.encode(
        {"sub": user_id, "email": email, "exp": datetime.utcnow().timestamp() + JWT_EXPIRY_SECONDS},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )
    if hasattr(token, "decode"):
        token = token.decode("utf-8")
    return jsonify({
        "token": token,
        "user": {"id": user_id, "email": email},
    }), 201


@app.route("/auth/login", methods=["POST"])
def auth_login():
    """Login with email + password. Returns JWT and user."""
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Invalid request: send JSON with email and password"}), 400
    email = (data.get("email") or "").strip().lower()
    password = data.get("password") or ""
    if not email:
        return jsonify({"error": "Email is required"}), 400
    if not password:
        return jsonify({"error": "Password is required"}), 400

    try:
        users = get_users_collection()
        user = users.find_one({"email": email})
    except Exception as e:
        print(f"[auth_login] database error: {e}")
        return jsonify({"error": _db_error_message(e, "Login failed")}), 500

    if not user:
        return jsonify({"error": "No account found with this email"}), 401

    try:
        ok = bcrypt.checkpw(password.encode("utf-8"), (user.get("password_hash") or "").encode("utf-8"))
    except Exception as e:
        print(f"[auth_login] password check error: {e}")
        return jsonify({"error": "Invalid password"}), 401
    if not ok:
        return jsonify({"error": "Incorrect password"}), 401

    user_id = user["_id"]
    token = pyjwt.encode(
        {"sub": user_id, "email": user.get("email"), "exp": datetime.utcnow().timestamp() + JWT_EXPIRY_SECONDS},
        JWT_SECRET,
        algorithm=JWT_ALGORITHM,
    )
    if hasattr(token, "decode"):
        token = token.decode("utf-8")
    return jsonify({
        "token": token,
        "user": {"id": user_id, "email": user.get("email")},
    })


# ──────────────────── REST routes ────────────────────

@app.route("/health")
def health():
    youcom_configured = False
    try:
        from youcom import _get_api_key
        youcom_configured = bool(_get_api_key())
    except Exception:
        pass
    return jsonify({
        "ok": True,
        "youcom_configured": youcom_configured,
    })


@app.route("/meetings", methods=["GET"])
@require_auth
def list_meetings():
    user_id = g.user_id
    try:
        coll = get_meetings_collection()
        cursor = coll.find({"user_id": user_id}).sort("upload_date", -1)
        meetings = []
        for doc in cursor:
            doc["id"] = doc.get("id") or str(doc.get("_id", ""))
            audio_url = _create_audio_url(doc["id"], doc.get("audio_file_id") is not None)
            meetings.append(_doc_to_meeting_json(doc, audio_url))
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
    audio_file_id = None

    if audio:
        file_name = audio.filename or "recording.webm"
        ext = os.path.splitext(file_name)[1] or ".webm"
        file_bytes = audio.read()
        content_type_audio = audio.content_type or "audio/webm"

        # Optional: save local backup
        local_path = os.path.join(UPLOADS_DIR, meeting_id + ext)
        try:
            with open(local_path, "wb") as f:
                f.write(file_bytes)
            print(f"[create_meeting] saved audio to server: {local_path}")
        except Exception as e:
            print(f"[create_meeting] failed to save local copy: {e}")

        # Store in GridFS
        try:
            fs = get_fs()
            gf = fs.put(file_bytes, filename=file_name, content_type=content_type_audio, metadata={"user_id": user_id, "meeting_id": meeting_id})
            audio_file_id = gf
            print(f"[create_meeting] uploaded audio to GridFS: meeting_id={meeting_id}")
        except Exception as e:
            print(f"[create_meeting] failed to upload audio to GridFS: {e}")
            return jsonify({"error": "Failed to upload audio"}), 500

    word_count = len(transcript_text.split()) if transcript_text else 0
    summary = ""
    summary_source = ""
    key_insights = []
    research_insights = []
    decisions = []
    action_items = []
    if transcript_text and len(transcript_text.strip()) >= 50:
        _dbg("H2", "create_meeting calling summarize_transcript", transcript_len=len(transcript_text))
        summarized = summarize_transcript(transcript_text)
        _dbg("H2", "create_meeting summarize returned", has_result=bool(summarized))
        if summarized:
            summary = summarized.get("summary") or ""
            key_insights = summarized.get("key_insights") or []
            research_insights = summarized.get("research_insights") or []
            decisions = summarized.get("decisions") or []
            action_items = summarized.get("action_items") or []
            summary_source = summarized.get("summary_source") or ""
    if not summary:
        summary = "Summary will be generated when you process this meeting." if transcript_text else ""

    now = datetime.utcnow()
    meeting_doc = {
        "id": meeting_id,
        "user_id": user_id,
        "title": title,
        "upload_date": now,
        "duration": duration_form or "0:00",
        "file_name": file_name,
        "word_count": word_count,
        "transcript": transcript_text,
        "summary": summary,
        "key_insights": key_insights,
        "research_insights": research_insights,
        "decisions": decisions,
        "action_items": action_items,
        "summary_source": summary_source,
        "processed": bool(transcript_text),
        "audio_file_id": audio_file_id,
        "error": None,
    }

    try:
        get_meetings_collection().insert_one(meeting_doc)
    except Exception as e:
        print(f"[create_meeting] failed to insert meeting: {e}")
        if audio_file_id:
            try:
                get_fs().delete(audio_file_id)
            except Exception as rm_err:
                print(f"[create_meeting] failed to cleanup GridFS: {rm_err}")
        return jsonify({"error": "Failed to save meeting"}), 500

    audio_url = _create_audio_url(meeting_id, audio_file_id is not None)
    meeting_json = _doc_to_meeting_json(meeting_doc, audio_url)
    meeting_json["uploadDate"] = now.strftime("%Y-%m-%dT%H:%M:%S.000Z")
    return jsonify({"meeting": meeting_json}), 201


@app.route("/meetings/<meeting_id>/audio")
@require_auth
def get_meeting_audio(meeting_id):
    """Stream audio file from GridFS. Requires auth."""
    user_id = g.user_id
    try:
        doc = get_meetings_collection().find_one({"id": meeting_id, "user_id": user_id})
        if not doc:
            return jsonify({"error": "Not found"}), 404
        fid = doc.get("audio_file_id")
        if not fid:
            return jsonify({"error": "No audio"}), 404
        fs = get_fs()
        out = fs.get(fid)
        data = io.BytesIO(out.read())
        mimetype = out.content_type or "audio/webm"
        download_name = doc.get("file_name") or "audio.webm"
        return send_file(data, mimetype=mimetype, as_attachment=False, download_name=download_name)
    except Exception as e:
        print(f"[get_meeting_audio] error: {e}")
        return jsonify({"error": "Failed to stream audio"}), 500


def _safe_filename(name: str, default: str = "recording") -> str:
    """Strip invalid chars for a download filename; ensure we end with .mp3 when used for MP3."""
    s = re.sub(r'[^\w\s\-\.]', '', (name or "").strip()) or default
    return s[:200]


@app.route("/meetings/<meeting_id>/audio/download")
@require_auth
def get_meeting_audio_download(meeting_id):
    """Download audio; optional ?format=mp3 converts WebM to MP3 (requires ffmpeg)."""
    user_id = g.user_id
    fmt = (request.args.get("format") or "").strip().lower()
    if fmt not in ("mp3", ""):
        return jsonify({"error": "Unsupported format. Use format=mp3 or omit for original (WebM)."}), 400

    try:
        doc = get_meetings_collection().find_one({"id": meeting_id, "user_id": user_id})
        if not doc:
            return jsonify({"error": "Not found"}), 404
        fid = doc.get("audio_file_id")
        if not fid:
            return jsonify({"error": "No audio"}), 404

        fs = get_fs()
        out = fs.get(fid)
        webm_bytes = out.read()
        file_name = doc.get("file_name") or "audio.webm"
        base_name = _safe_filename(os.path.splitext(file_name)[0], "recording")

        if fmt == "mp3":
            # Convert WebM to MP3 via ffmpeg (pipe stdin -> stdout)
            try:
                proc = subprocess.Popen(
                    [
                        "ffmpeg", "-y", "-i", "pipe:0",
                        "-acodec", "libmp3lame", "-q:a", "2",
                        "-f", "mp3", "pipe:1",
                    ],
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                )
                mp3_bytes, err = proc.communicate(input=webm_bytes, timeout=120)
                if proc.returncode != 0:
                    print(f"[audio/download] ffmpeg error: {err.decode(errors='replace')}")
                    return jsonify({"error": "Conversion to MP3 failed. Is ffmpeg installed?"}), 503
            except FileNotFoundError:
                return jsonify({"error": "MP3 conversion requires ffmpeg to be installed on the server."}), 503
            except subprocess.TimeoutExpired:
                proc.kill()
                return jsonify({"error": "Conversion timed out."}), 503

            return send_file(
                io.BytesIO(mp3_bytes),
                mimetype="audio/mpeg",
                as_attachment=True,
                download_name=f"{base_name}.mp3",
            )
        else:
            # Original WebM as attachment
            return send_file(
                io.BytesIO(webm_bytes),
                mimetype=out.content_type or "audio/webm",
                as_attachment=True,
                download_name=file_name if file_name.endswith(".webm") else f"{base_name}.webm",
            )
    except Exception as e:
        print(f"[get_meeting_audio_download] error: {e}")
        return jsonify({"error": "Failed to prepare download"}), 500


@app.route("/meetings/<meeting_id>", methods=["GET"])
@require_auth
def get_meeting(meeting_id):
    user_id = g.user_id
    try:
        doc = get_meetings_collection().find_one({"id": meeting_id, "user_id": user_id})
        if not doc:
            return jsonify({"error": "Not found"}), 404
        doc["id"] = doc.get("id") or str(doc.get("_id", ""))
        audio_url = _create_audio_url(meeting_id, doc.get("audio_file_id") is not None)
        return jsonify({"meeting": _doc_to_meeting_json(doc, audio_url)})
    except Exception as e:
        print(f"[get_meeting] error: {e}")
        return jsonify({"error": "Failed to fetch meeting"}), 500


@app.route("/meetings/<meeting_id>", methods=["PATCH"])
@require_auth
def update_meeting(meeting_id):
    user_id = g.user_id
    data = request.get_json(silent=True) or {}
    updates = {}
    if "title" in data:
        updates["title"] = str(data.get("title") or "").strip() or "Untitled"
    if "file_name" in data:
        updates["file_name"] = str(data.get("file_name") or "").strip()
    if not updates:
        return jsonify({"error": "Send JSON with 'title' and/or 'file_name'"}), 400
    try:
        coll = get_meetings_collection()
        result = coll.update_one(
            {"id": meeting_id, "user_id": user_id},
            {"$set": updates},
        )
        if result.matched_count == 0:
            return jsonify({"error": "Not found"}), 404
        doc = coll.find_one({"id": meeting_id, "user_id": user_id})
        doc["id"] = doc.get("id") or str(doc.get("_id", ""))
        audio_url = _create_audio_url(meeting_id, doc.get("audio_file_id") is not None)
        return jsonify({"meeting": _doc_to_meeting_json(doc, audio_url)})
    except Exception as e:
        print(f"[update_meeting] error: {e}")
        return jsonify({"error": "Failed to update meeting"}), 500


@app.route("/meetings/<meeting_id>", methods=["DELETE"])
@require_auth
def delete_meeting(meeting_id):
    user_id = g.user_id
    try:
        doc = get_meetings_collection().find_one({"id": meeting_id, "user_id": user_id})
        if not doc:
            return jsonify({"error": "Not found"}), 404
        fid = doc.get("audio_file_id")
        get_meetings_collection().delete_one({"id": meeting_id, "user_id": user_id})
        if fid:
            try:
                get_fs().delete(fid)
            except Exception as e:
                print(f"[delete_meeting] failed to delete audio from GridFS: {e}")
        file_name = doc.get("file_name") or ""
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


# Placeholder text we replace when we have audio to transcribe
TRANSCRIPT_STUB = "(Transcript from Deepgram file processing.)"
SUMMARY_STUB = "Summary (stub – add Deepgram file API to generate)."


def _process_log(msg: str) -> None:
    print(f"[process_meeting] {msg}", flush=True)


# #region agent log
def _dbg(hid: str, msg: str, **data):
    try:
        import json
        p = os.path.join(_backend_dir, "..", "debug-c21db1.log")
        with open(p, "a", encoding="utf-8") as f:
            f.write(json.dumps({"sessionId":"c21db1","hypothesisId":hid,"location":"app.py","message":msg,"data":data,"timestamp":__import__("time").time()*1000}) + "\n")
    except Exception:
        pass
# #endregion

@app.route("/meetings/<meeting_id>/process", methods=["POST"])
@require_auth
def process_meeting(meeting_id):
    user_id = g.user_id
    try:
        _dbg("H2", "process_meeting called", meeting_id=meeting_id)
        _process_log(f"Processing meeting_id={meeting_id}")
        doc = get_meetings_collection().find_one({"id": meeting_id, "user_id": user_id})
        if not doc:
            _process_log("Meeting not found")
            return jsonify({"error": "Not found"}), 404

        transcript = (doc.get("transcript") or "").strip()
        summary = (doc.get("summary") or "").strip()
        audio_file_id = doc.get("audio_file_id")
        needs_transcription = audio_file_id and (not transcript or transcript == TRANSCRIPT_STUB)

        if needs_transcription:
            _process_log(f"Meeting has audio_file_id, fetching from GridFS...")
            try:
                fs = get_fs()
                out = fs.get(audio_file_id)
                audio_bytes = out.read()
                content_type = (out.content_type or "audio/webm").split(";")[0].strip()
                _process_log(f"Loaded audio: {len(audio_bytes)} bytes, content_type={content_type}")
                transcript = transcribe_audio(audio_bytes, content_type)
                if transcript:
                    _process_log(f"Transcription done: {len(transcript)} chars")
                else:
                    _process_log("Transcription returned empty; keeping stub")
                    transcript = TRANSCRIPT_STUB
                    summary = SUMMARY_STUB
            except ValueError as e:
                _process_log(f"Deepgram not configured: {e}")
                transcript = transcript or TRANSCRIPT_STUB
                summary = summary or SUMMARY_STUB
            except Exception as e:
                err_msg = str(e)
                _process_log(f"Deepgram file transcription failed: {err_msg}")
                import traceback
                traceback.print_exc()
                return jsonify({
                    "error": "Transcription failed",
                    "detail": err_msg,
                }), 502

        if not transcript:
            transcript = TRANSCRIPT_STUB
        if not summary:
            summary = SUMMARY_STUB

        # Run summarization for any real transcript (new or existing) to get key insights/decisions/actions
        key_insights = doc.get("key_insights") or []
        research_insights = doc.get("research_insights") or []
        decisions = doc.get("decisions") or []
        action_items = doc.get("action_items") or []
        summary_source = doc.get("summary_source") or ""
        if transcript and transcript != TRANSCRIPT_STUB and len(transcript.strip()) >= 50:
            _dbg("H3", "calling summarize_transcript", transcript_len=len(transcript), is_stub=transcript == TRANSCRIPT_STUB)
            summarized = summarize_transcript(transcript)
            _dbg("H3", "summarize_transcript returned", has_result=bool(summarized))
            if summarized:
                summary = summarized.get("summary") or summary or (transcript[:500] + "..." if len(transcript) > 500 else transcript)
                key_insights = summarized.get("key_insights") or []
                research_insights = summarized.get("research_insights") or []
                decisions = summarized.get("decisions") or []
                action_items = summarized.get("action_items") or []
                summary_source = summarized.get("summary_source") or ""
            elif not summary or summary == SUMMARY_STUB:
                summary = transcript[:500] + "..." if len(transcript) > 500 else transcript
        else:
            _dbg("H3", "skipped summarize branch", transcript_len=len(transcript), is_stub=transcript == TRANSCRIPT_STUB)

        update_data = {
            "processed": True,
            "summary": summary,
            "transcript": transcript,
            "key_insights": key_insights,
            "research_insights": research_insights,
            "decisions": decisions,
            "action_items": action_items,
            "summary_source": summary_source,
            "word_count": len(transcript.split()),
        }
        get_meetings_collection().update_one(
            {"id": meeting_id, "user_id": user_id},
            {"$set": update_data},
        )
        updated = {**doc, **update_data}
        updated["id"] = updated.get("id") or str(updated.get("_id", ""))
        audio_url = _create_audio_url(meeting_id, doc.get("audio_file_id") is not None)
        _process_log("Done")
        return jsonify({"meeting": _doc_to_meeting_json(updated, audio_url)})
    except Exception as e:
        import traceback
        _process_log(f"Error: {e}")
        traceback.print_exc()
        return jsonify({
            "error": "Failed to process meeting",
            "detail": str(e),
        }), 500


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
    socketio.run(app, host="0.0.0.0", port=5000, debug=False, allow_unsafe_werkzeug=True)
