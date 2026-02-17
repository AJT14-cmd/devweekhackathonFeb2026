import { useState, useRef, useCallback } from 'react'
import { io } from 'socket.io-client'

const SAMPLE_RATE = 16000
const BUFFER_SIZE = 4096
// Use same origin in dev so Vite proxy (→ localhost:5000) is used
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL ?? ''

function isSocketClosedError(msg: string): boolean {
  const m = (msg || '').toLowerCase()
  return m.includes('already closed') || (m.includes('socket') && m.includes('closed'))
}

function float32ToInt16(float32Array: Float32Array): Int16Array {
  const int16Array = new Int16Array(float32Array.length)
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]))
    int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return int16Array
}

function downsample(
  input: Float32Array,
  sourceRate: number,
  targetRate: number = SAMPLE_RATE
): Float32Array {
  if (sourceRate === targetRate) return input
  const ratio = sourceRate / targetRate
  const outputLength = Math.round(input.length / ratio)
  const output = new Float32Array(outputLength)
  for (let i = 0; i < outputLength; i++) {
    const srcIndex = i * ratio
    const idx = Math.floor(srcIndex)
    const frac = srcIndex - idx
    output[i] =
      idx + 1 < input.length
        ? input[idx] * (1 - frac) + input[idx + 1] * frac
        : input[idx]
  }
  return output
}

export function useAudioStream() {
  const [transcript, setTranscript] = useState('')
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [recordedAudio, setRecordedAudio] = useState<Blob | null>(null)
  const [hasPendingRecording, setHasPendingRecording] = useState(false)

  const socketRef = useRef<ReturnType<typeof io> | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const recordedChunksRef = useRef<Blob[]>([])
  const finalizeResolveRef = useRef<((blob: Blob | null) => void) | null>(null)
  const isResettingRef = useRef(false)

  const doCleanup = useCallback(() => {
    if (processorRef.current && sourceRef.current) {
      try {
        sourceRef.current.disconnect()
        processorRef.current.disconnect()
      } catch (_) {}
      processorRef.current = null
      sourceRef.current = null
    }
    if (contextRef.current) {
      contextRef.current.close().catch(() => {})
      contextRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (socketRef.current) {
      socketRef.current.off('transcript')
      socketRef.current.disconnect()
      socketRef.current = null
    }
    mediaRecorderRef.current = null
    setIsRecording(false)
    setHasPendingRecording(false)
  }, [])

  const clearRecordedAudio = useCallback(() => {
    setRecordedAudio(null)
    setTranscript('')
    setHasPendingRecording(false)
  }, [])

  const onRecordingStop = useCallback(() => {
    const chunks = recordedChunksRef.current
    const mr = mediaRecorderRef.current
    const blob = mr && chunks.length
      ? new Blob(chunks, { type: mr.mimeType || 'audio/webm' })
      : null
    if (isResettingRef.current) {
      setTranscript('')
      setRecordedAudio(null)
      recordedChunksRef.current = []
    } else if (finalizeResolveRef.current) {
      finalizeResolveRef.current(blob)
      if (blob) setRecordedAudio(blob)
    }
    recordedChunksRef.current = []
    mediaRecorderRef.current = null
    doCleanup()
    finalizeResolveRef.current = null
    isResettingRef.current = false
  }, [doCleanup])

  const stopRecording = useCallback(() => {
    const mediaRecorder = mediaRecorderRef.current
    if (mediaRecorder?.state === 'recording') {
      mediaRecorder.pause()
      if (sourceRef.current && processorRef.current) {
        try {
          sourceRef.current.disconnect()
        } catch (_) {}
      }
      if (socketRef.current) {
        socketRef.current.off('transcript')
        socketRef.current.disconnect()
        socketRef.current = null
      }
      setIsRecording(false)
      setHasPendingRecording(recordedChunksRef.current.length > 0)
    }
  }, [])

  const finalizeRecording = useCallback((): Promise<Blob | null> => {
    const mediaRecorder = mediaRecorderRef.current
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      return Promise.resolve(null)
    }
    return new Promise((resolve) => {
      finalizeResolveRef.current = resolve
      mediaRecorder.onstop = onRecordingStop
      try {
        mediaRecorder.requestData()
      } catch (_) {}
      mediaRecorder.stop()
    })
  }, [onRecordingStop])

  const resetRecording = useCallback(() => {
    const mediaRecorder = mediaRecorderRef.current
    if (!mediaRecorder || mediaRecorder.state === 'inactive') {
      setTranscript('')
      setRecordedAudio(null)
      recordedChunksRef.current = []
      doCleanup()
      return
    }
    isResettingRef.current = true
    mediaRecorder.onstop = onRecordingStop
    try {
      mediaRecorder.requestData()
    } catch (_) {}
    mediaRecorder.stop()
  }, [doCleanup, onRecordingStop])

  const startRecording = useCallback(async () => {
    setError(null)
    const mediaRecorder = mediaRecorderRef.current
    if (mediaRecorder?.state === 'paused') {
      mediaRecorder.resume()
      const socket = io(SOCKET_URL || undefined, {
        transports: ['websocket', 'polling'],
        reconnection: true,
      })
      socketRef.current = socket
      socket.on('connect_error', (err: Error) => {
        const msg = err.message || 'Connection failed'
        if (!isSocketClosedError(msg)) setError(msg)
        stopRecording()
      })
      socket.on('transcript', (data: { error?: string; is_final?: boolean; channel?: { alternatives?: Array<{ transcript?: string }> } }) => {
        if (data?.error) {
          if (!isSocketClosedError(data.error)) setError(data.error)
          return
        }
        if (data?.is_final === true) {
          const text = data.channel?.alternatives?.[0]?.transcript?.trim?.() ?? ''
          if (text) {
            setTranscript((prev) => (prev ? `${prev} ${text}` : text))
          }
        }
      })
      if (sourceRef.current && processorRef.current) {
        sourceRef.current.connect(processorRef.current)
      }
      setIsRecording(true)
      return
    }

    try {
      setTranscript('')
      setRecordedAudio(null)
      recordedChunksRef.current = []
      setHasPendingRecording(false)

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm'
      const newRecorder = new MediaRecorder(stream)
      mediaRecorderRef.current = newRecorder
      newRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) recordedChunksRef.current.push(e.data)
      }
      newRecorder.start(250)

      const socket = io(SOCKET_URL || undefined, {
        transports: ['websocket', 'polling'],
        reconnection: true,
      })
      socketRef.current = socket

      socket.on('connect_error', (err: Error) => {
        const msg = err.message || 'Connection failed'
        if (!isSocketClosedError(msg)) setError(msg)
        stopRecording()
      })

      socket.on('transcript', (data: { error?: string; is_final?: boolean; channel?: { alternatives?: Array<{ transcript?: string }> } }) => {
        if (data?.error) {
          if (!isSocketClosedError(data.error)) setError(data.error)
          return
        }
        if (data?.is_final === true) {
          const text = data.channel?.alternatives?.[0]?.transcript?.trim?.() ?? ''
          if (text) {
            setTranscript((prev) => (prev ? `${prev} ${text}` : text))
          }
        }
      })

      // Use default sample rate so it matches the MediaStream (avoids "different sample-rate" error)
      const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      contextRef.current = audioContext

      const source = audioContext.createMediaStreamSource(stream)
      sourceRef.current = source

      const inputRate = audioContext.sampleRate
      const processor = audioContext.createScriptProcessor(BUFFER_SIZE, 1, 1)
      processorRef.current = processor

      processor.onaudioprocess = (e: AudioProcessingEvent) => {
        if (!socketRef.current?.connected) return
        const input = e.inputBuffer.getChannelData(0)
        const downsampled =
          inputRate !== SAMPLE_RATE
            ? downsample(input, inputRate, SAMPLE_RATE)
            : input
        const int16 = float32ToInt16(
          downsampled instanceof Float32Array ? downsampled : new Float32Array(downsampled)
        )
        socketRef.current.emit('audio_chunk', int16.buffer)
      }

      source.connect(processor)
      processor.connect(audioContext.destination)
      setIsRecording(true)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start recording'
      if (!isSocketClosedError(msg)) setError(msg)
      doCleanup()
    }
  }, [stopRecording, doCleanup])

  return {
    startRecording,
    stopRecording,
    transcript,
    isRecording,
    error,
    recordedAudio,
    hasPendingRecording,
    clearRecordedAudio,
    finalizeRecording,
    resetRecording,
  }
}
