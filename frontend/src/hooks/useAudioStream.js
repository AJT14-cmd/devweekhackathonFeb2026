import { useState, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';

const SAMPLE_RATE = 16000;
const BUFFER_SIZE = 4096;
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:5000';

/**
 * Convert Float32Array to Int16 PCM (linear16).
 */
function float32ToInt16(float32Array) {
  const int16Array = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16Array;
}

/**
 * Downsample from sourceRate to SAMPLE_RATE (16000).
 */
function downsample(input, sourceRate, targetRate = SAMPLE_RATE) {
  if (sourceRate === targetRate) return input;
  const ratio = sourceRate / targetRate;
  const outputLength = Math.round(input.length / ratio);
  const output = new Float32Array(outputLength);
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio;
    const idx = Math.floor(srcIndex);
    const frac = srcIndex - idx;
    output[i] =
      idx + 1 < input.length
        ? input[idx] * (1 - frac) + input[idx + 1] * frac
        : input[idx];
  }
  return output;
}

/**
 * Reusable hook for streaming microphone audio to the backend and receiving transcripts.
 * @returns {{ startRecording: () => Promise<void>, stopRecording: () => void, transcript: string, isRecording: boolean, error: string | null }}
 */
export function useAudioStream() {
  const [transcript, setTranscript] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState(null);

  const socketRef = useRef(null);
  const streamRef = useRef(null);
  const contextRef = useRef(null);
  const processorRef = useRef(null);
  const sourceRef = useRef(null);

  const stopRecording = useCallback(() => {
    if (processorRef.current && sourceRef.current) {
      try {
        sourceRef.current.disconnect();
        processorRef.current.disconnect();
      } catch (_) {}
      processorRef.current = null;
      sourceRef.current = null;
    }
    if (contextRef.current) {
      contextRef.current.close().catch(() => {});
      contextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.off('transcript');
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    setIsRecording(false);
  }, []);

  const startRecording = useCallback(async () => {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;

      const socket = io(SOCKET_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
      });
      socketRef.current = socket;

      socket.on('connect_error', (err) => {
        setError(err.message || 'Connection failed');
        stopRecording();
      });

      socket.on('transcript', (data) => {
        if (data && data.error) {
          setError(data.error);
          return;
        }
        if (data && data.is_final === true) {
          const text =
            data.channel?.alternatives?.[0]?.transcript?.trim?.() || '';
          if (text) {
            setTranscript((prev) => (prev ? `${prev} ${text}` : text));
          }
        }
      });

      const sampleRate = SAMPLE_RATE;
      const audioContext = new (window.AudioContext || window.webkitAudioContext)({
        sampleRate,
      });
      contextRef.current = audioContext;

      const source = audioContext.createMediaStreamSource(stream);
      sourceRef.current = source;

      const inputRate = audioContext.sampleRate;
      const processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        if (!socketRef.current?.connected) return;
        const input = e.inputBuffer.getChannelData(0);
        const downsampled =
          inputRate !== SAMPLE_RATE
            ? downsample(input, inputRate, SAMPLE_RATE)
            : input;
        const int16 = float32ToInt16(
          downsampled instanceof Float32Array ? downsampled : new Float32Array(downsampled)
        );
        socketRef.current.emit('audio_chunk', int16.buffer);
      };

      source.connect(processor);
      processor.connect(audioContext.destination);
      setIsRecording(true);
    } catch (err) {
      setError(err.message || 'Failed to start recording');
      stopRecording();
    }
  }, [stopRecording]);

  return {
    startRecording,
    stopRecording,
    transcript,
    isRecording,
    error,
  };
}
