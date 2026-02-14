import { useAudioStream } from './hooks/useAudioStream'
import './App.css'

function App() {
  const {
    startRecording,
    stopRecording,
    transcript,
    isRecording,
    error,
  } = useAudioStream()

  return (
    <div className="app">
      <header className="header">
        <h1>AI Meeting Transcription</h1>
        <p className="subtitle">Real-time speech-to-text via Deepgram</p>
      </header>

      <main className="main">
        <div className="controls">
          {!isRecording ? (
            <button
              type="button"
              className="btn btn-start"
              onClick={startRecording}
              aria-label="Start recording"
            >
              Start recording
            </button>
          ) : (
            <button
              type="button"
              className="btn btn-stop"
              onClick={stopRecording}
              aria-label="Stop recording"
            >
              Stop recording
            </button>
          )}
        </div>

        {error && (
          <div className="error" role="alert">
            {error}
          </div>
        )}

        <section className="transcript-section" aria-label="Transcript">
          <h2>Transcript</h2>
          <div className="transcript-box">
            {transcript ? (
              <p className="transcript-text">{transcript}</p>
            ) : (
              <p className="transcript-placeholder">
                {isRecording
                  ? 'Listening…'
                  : 'Start recording to see the transcript here.'}
              </p>
            )}
          </div>
        </section>
      </main>
    </div>
  )
}

export default App
