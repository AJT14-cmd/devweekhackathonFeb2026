import { Play, Pause, Volume2, Download, Pencil, Check, X } from "lucide-react";
import { useState, useRef, useEffect } from "react";

interface AudioPlayerProps {
  audioUrl: string;
  fileName: string;
  /** Called when the real audio duration is known (from decode or element). Use for metadata display. */
  onDurationLoaded?: (durationSeconds: number) => void;
  /** Optional: URL to request for download (e.g. /meetings/:id/audio/download?format=mp3). Requires authToken. */
  downloadAsMp3Url?: string;
  /** Auth token for playback and download (backend requires Bearer token for /meetings/:id/audio). */
  authToken?: string;
  /** Base URL for relative audioUrl (e.g. http://localhost:5000). Required when authToken is set and audioUrl is relative. */
  apiBaseUrl?: string;
  /** Called when the user saves a new file name (e.g. to persist to the meeting). */
  onFileNameChange?: (newFileName: string) => void;
}

function safeDuration(d: number): number {
  if (typeof d !== 'number' || !Number.isFinite(d) || d < 0) return 0;
  return d;
}

export function AudioPlayer({ audioUrl, fileName, onDurationLoaded, downloadAsMp3Url, authToken, apiBaseUrl, onFileNameChange }: AudioPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [isEditingFileName, setIsEditingFileName] = useState(false);
  const [editFileNameValue, setEditFileNameValue] = useState(fileName);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditFileNameValue(fileName);
  }, [fileName]);

  useEffect(() => {
    if (isEditingFileName) editInputRef.current?.focus();
  }, [isEditingFileName]);
  const [playbackSrc, setPlaybackSrc] = useState<string | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);

  // Backend requires auth: fetch with token and use blob URL so <audio> can play. Otherwise use audioUrl directly.
  useEffect(() => {
    if (!audioUrl) {
      setPlaybackSrc(null);
      setPlaybackError(null);
      return;
    }
    setPlaybackError(null);
    const needsAuth = authToken && (audioUrl.startsWith('/') || (apiBaseUrl && !audioUrl.startsWith('http')));
    if (!needsAuth) {
      setPlaybackSrc(audioUrl);
      return;
    }
    const fullUrl = audioUrl.startsWith('http') ? audioUrl : `${apiBaseUrl || ''}${audioUrl}`;
    let revoked = false;
    fetch(fullUrl, { headers: { Authorization: `Bearer ${authToken}` } })
      .then(async (res) => {
        if (!res.ok) {
          const text = await res.text();
          let detail = text;
          try {
            const j = JSON.parse(text);
            detail = j.detail || j.error || text;
          } catch {
            detail = text || res.statusText;
          }
          throw new Error(`${res.status}: ${detail}`);
        }
        return res.blob();
      })
      .then((blob) => {
        if (!revoked) setPlaybackSrc(URL.createObjectURL(blob));
      })
      .catch((e) => {
        if (!revoked) setPlaybackError(e instanceof Error ? e.message : 'Failed to load audio');
      });
    return () => {
      revoked = true;
      setPlaybackSrc((prev) => {
        if (prev && prev.startsWith('blob:')) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, [audioUrl, authToken, apiBaseUrl]);

  // Get real duration when playback source is ready (decode for WebM where <audio> often reports NaN).
  useEffect(() => {
    if (!playbackSrc || playbackError) return;
    let cancelled = false;
    setDuration(0);
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    fetch(playbackSrc)
      .then((res) => res.arrayBuffer())
      .then((buffer) => ctx.decodeAudioData(buffer))
      .then((decoded) => {
        if (!cancelled && decoded.duration != null && Number.isFinite(decoded.duration)) {
          setDuration(decoded.duration);
          onDurationLoaded?.(decoded.duration);
        }
      })
      .catch(() => {})
      .finally(() => ctx.close());
    return () => {
      cancelled = true;
    };
  }, [playbackSrc, playbackError, onDurationLoaded]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    setCurrentTime(0);

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleDuration = () => {
      const d = safeDuration(audio.duration);
      if (d > 0) {
        setDuration(d);
        onDurationLoaded?.(d);
      }
    };
    const handleEnded = () => {
      setIsPlaying(false);
      setCurrentTime(audio.currentTime);
    };

    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleDuration);
    audio.addEventListener('durationchange', handleDuration);
    audio.addEventListener('ended', handleEnded);

    return () => {
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleDuration);
      audio.removeEventListener('durationchange', handleDuration);
      audio.removeEventListener('ended', handleEnded);
    };
  }, [playbackSrc]);

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play();
    }
    setIsPlaying(!isPlaying);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const audio = audioRef.current;
    if (!audio) return;

    const time = parseFloat(e.target.value);
    audio.currentTime = time;
    setCurrentTime(time);
  };

  const formatTime = (time: number) => {
    const t = Math.max(0, Number.isFinite(time) ? time : 0);
    const minutes = Math.floor(t / 60);
    const seconds = Math.floor(t % 60);
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleDownloadMp3 = async () => {
    if (!downloadAsMp3Url || !authToken) return;
    setDownloading(true);
    try {
      const res = await fetch(downloadAsMp3Url, {
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (!res.ok) throw new Error(res.statusText);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (fileName.replace(/\.[^.]+$/, '') || 'recording') + '.mp3';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Download failed:', e);
    } finally {
      setDownloading(false);
    }
  };

  const saveFileName = () => {
    const trimmed = editFileNameValue.trim();
    if (trimmed && trimmed !== fileName) onFileNameChange?.(trimmed);
    setIsEditingFileName(false);
  };
  const cancelEditFileName = () => {
    setEditFileNameValue(fileName);
    setIsEditingFileName(false);
  };

  const safeD = safeDuration(duration);
  const maxForBar = safeD > 0 ? safeD : 1;
  const progressPercent = maxForBar > 0 ? Math.min(100, (currentTime / maxForBar) * 100) : 0;

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      {playbackError && (
        <p className="text-sm text-red-600 mb-2">{playbackError}</p>
      )}
      <audio ref={audioRef} src={playbackSrc || undefined} />
      
      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={togglePlay}
          className="p-3 bg-blue-500 text-white rounded-full hover:bg-blue-600 transition-colors"
        >
          {isPlaying ? <Pause className="w-6 h-6" /> : <Play className="w-6 h-6" />}
        </button>
        
        <div className="flex-1">
          {isEditingFileName ? (
            <div className="flex items-center gap-2 mb-1">
              <input
                ref={editInputRef}
                type="text"
                value={editFileNameValue}
                onChange={(e) => setEditFileNameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveFileName();
                  if (e.key === 'Escape') cancelEditFileName();
                }}
                className="text-sm text-gray-800 border border-gray-300 rounded px-2 py-1 flex-1 min-w-0"
              />
              <button type="button" onClick={saveFileName} className="p-1 text-green-600 hover:bg-gray-100 rounded" title="Save name">
                <Check className="w-4 h-4" />
              </button>
              <button type="button" onClick={cancelEditFileName} className="p-1 text-gray-500 hover:bg-gray-100 rounded" title="Cancel">
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <p className="text-sm text-gray-600 mb-1">{fileName}</p>
          )}
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">{formatTime(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={maxForBar}
              step={0.1}
              value={currentTime}
              onChange={handleSeek}
              className="flex-1 h-1 bg-gray-200 rounded-lg appearance-none cursor-pointer"
              style={{
                background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${progressPercent}%, #e5e7eb ${progressPercent}%, #e5e7eb 100%)`
              }}
            />
            <span className="text-xs text-gray-500">{formatTime(safeD)}</span>
          </div>
        </div>
        
        <Volume2 className="w-5 h-5 text-gray-500" />
        {downloadAsMp3Url && authToken && (
          <button
            type="button"
            onClick={handleDownloadMp3}
            disabled={downloading}
            className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            title="Download as MP3"
          >
            <Download className="w-4 h-4" />
          </button>
        )}
        {onFileNameChange && (
          <button
            type="button"
            onClick={() => setIsEditingFileName(true)}
            className="p-2 border border-gray-300 rounded-lg hover:bg-gray-50"
            title="Edit file name"
          >
            <Pencil className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}
