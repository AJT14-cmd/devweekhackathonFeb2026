"""
Deepgram pre-recorded (file) transcription.
POST audio bytes to /v1/listen and return transcript text.
"""
import json
import os
import sys
import traceback
import urllib.error
import urllib.request

DEEPGRAM_API_KEY = os.getenv("DEEPGRAM_API_KEY", "").strip()
DEEPGRAM_LISTEN_URL = "https://api.deepgram.com/v1/listen"


def _log(msg: str) -> None:
    print(f"[deepgram_file] {msg}", flush=True)


def transcribe_audio(audio_bytes: bytes, content_type: str = "audio/webm") -> tuple[str, float | None]:
    """
    Send audio to Deepgram pre-recorded API.
    Returns (transcript_text, duration_seconds).
    Raises on API error; returns ("", None) if no transcript in response.
    """
    size_mb = len(audio_bytes) / (1024 * 1024)
    _log(f"Starting transcription: size={size_mb:.2f} MB, content_type={content_type}")

    if not DEEPGRAM_API_KEY:
        _log("ERROR: DEEPGRAM_API_KEY is not set")
        raise ValueError("DEEPGRAM_API_KEY must be set for file transcription")

    url = f"{DEEPGRAM_LISTEN_URL}?smart_format=true&punctuate=true&diarize=true"
    req = urllib.request.Request(
        url,
        data=audio_bytes,
        method="POST",
        headers={
            "Authorization": f"Token {DEEPGRAM_API_KEY}",
            "Content-Type": content_type or "audio/webm",
        },
    )
    try:
        _log("Calling Deepgram API (timeout=900s)...")
        with urllib.request.urlopen(req, timeout=900) as resp:
            raw = resp.read().decode()
            data = json.loads(raw)
        _log("Deepgram API responded successfully")
    except urllib.error.HTTPError as e:
        body = ""
        try:
            if e.fp:
                body = e.fp.read().decode(errors="replace")
        except Exception:
            body = "<could not read body>"
        _log(f"Deepgram API HTTP error: status={e.code}, body={body[:500]}")
        traceback.print_exc(file=sys.stderr)
        raise RuntimeError(f"Deepgram API error {e.code}: {body}") from e
    except urllib.error.URLError as e:
        _log(f"Deepgram API URL/network error: {e.reason}")
        traceback.print_exc(file=sys.stderr)
        raise RuntimeError(f"Deepgram request failed: {e.reason}") from e
    except Exception as e:
        _log(f"Deepgram request failed: {type(e).__name__}: {e}")
        traceback.print_exc(file=sys.stderr)
        raise

    results = data.get("results") or {}
    channels = results.get("channels") or []
    if not channels:
        _log("WARNING: Deepgram response has no channels")
        return ("", None)
    ch = channels[0]
    if not isinstance(ch, dict):
        _log(f"WARNING: Unexpected channel type: {type(ch)}")
        return ("", None)
    alternatives = ch.get("alternatives") or []
    if not alternatives:
        _log("WARNING: Deepgram response has no alternatives")
        return ("", None)
    transcript = (alternatives[0].get("transcript") or "").strip()
    duration_sec = results.get("duration") or data.get("metadata", {}).get("duration")
    if duration_sec is not None:
        try:
            duration_sec = float(duration_sec)
        except (TypeError, ValueError):
            duration_sec = None
    _log(f"Transcript length={len(transcript)} chars" + (f", duration={duration_sec}s" if duration_sec is not None else ""))
    if not transcript:
        _log("WARNING: Transcript is empty (audio may be silent or unsupported)")
    return (transcript, duration_sec)
