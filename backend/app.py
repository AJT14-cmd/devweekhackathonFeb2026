"""
Flask-SocketIO server for real-time AI meeting transcription.
Streams client audio to Deepgram and forwards transcripts back.
"""
import eventlet
eventlet.monkey_patch()

import os
from flask import Flask, request
from flask_socketio import SocketIO
from dotenv import load_dotenv

load_dotenv()

from deepgram_stream import DeepgramStream

app = Flask(__name__)
app.config["SECRET_KEY"] = os.getenv("SECRET_KEY", "dev-secret-change-in-production")
socketio = SocketIO(app, cors_allowed_origins="*", async_mode="eventlet")

# Per-connection Deepgram stream (keyed by session id)
streams = {}


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
