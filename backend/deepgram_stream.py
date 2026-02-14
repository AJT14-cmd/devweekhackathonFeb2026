"""
Deepgram real-time streaming client.
Maintains a WebSocket to Deepgram, forwards audio and emits transcripts.
"""
import json
import os
import threading

import websocket


DEEPGRAM_WS_URL = "wss://api.deepgram.com/v1/listen"


class DeepgramStream:
    """Streams audio to Deepgram over WebSocket and forwards transcripts via SocketIO."""

    def __init__(self, socketio, sid):
        self.socketio = socketio
        self.sid = sid
        self._ws = None
        self._closed = False
        self._thread = None
        self._api_key = os.getenv("DEEPGRAM_API_KEY", "").strip()
        if not self._api_key:
            raise ValueError("DEEPGRAM_API_KEY must be set in .env")
        self._send_lock = threading.Lock()
        self._connect_and_start_receiver()

    def _build_url(self):
        params = [
            "encoding=linear16",
            "sample_rate=16000",
            "punctuate=true",
            "interim_results=true",
            "diarize=true",
        ]
        return f"{DEEPGRAM_WS_URL}?{'&'.join(params)}"

    def _connect_and_start_receiver(self):
        url = self._build_url()
        headers = {"Authorization": f"Token {self._api_key}"}
        self._ws = websocket.WebSocketApp(
            url,
            header=headers,
            on_message=self._on_message,
            on_error=self._on_error,
            on_close=self._on_close,
            on_open=self._on_open,
        )
        self._thread = threading.Thread(target=self._run_ws, daemon=True)
        self._thread.start()

    def _run_ws(self):
        self._ws.run_forever()

    def _on_open(self, ws):
        pass

    def _on_message(self, ws, message):
        if self._closed:
            return
        try:
            data = json.loads(message)
            if isinstance(data, dict):
                self.socketio.emit("transcript", data, room=self.sid)
        except (json.JSONDecodeError, TypeError):
            pass

    def _on_error(self, ws, error):
        if not self._closed:
            try:
                self.socketio.emit("transcript", {"error": str(error)}, room=self.sid)
            except Exception:
                pass

    def _on_close(self, ws, close_status_code, close_msg):
        pass

    def send_audio(self, data):
        if self._closed or self._ws is None:
            return
        try:
            if isinstance(data, (bytes, bytearray)):
                payload = data
            elif hasattr(data, "tobytes"):
                payload = data.tobytes()
            else:
                payload = bytes(data)
            if payload:
                with self._send_lock:
                    self._ws.send(payload, opcode=websocket.ABNF.OPCODE_BINARY)
        except Exception as e:
            if not self._closed:
                try:
                    self.socketio.emit("transcript", {"error": str(e)}, room=self.sid)
                except Exception:
                    pass

    def close(self):
        self._closed = True
        if self._ws:
            try:
                self._ws.close()
            except Exception:
                pass
            self._ws = None
