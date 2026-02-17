import { useState, useEffect } from 'react';
import { MeetingCard } from './components/MeetingCard';
import { MeetingDetail } from './components/MeetingDetail';
import { UploadModal } from './components/UploadModal';
import { SignIn } from './components/SignIn';
import { useAudioStream } from './hooks/useAudioStream';
import { useAuth } from './contexts/AuthContext';
import { Plus, Mic2, Loader2, LogOut, HelpCircle, Save, RotateCcw } from 'lucide-react';
import { API_BASE_URL, authFetch } from './lib/api';
import { Button } from './components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './components/ui/card';
import { Alert, AlertDescription, AlertTitle } from './components/ui/alert';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './components/ui/dialog';

interface Meeting {
  id: string;
  title: string;
  uploadDate: string;
  duration: string;
  fileName: string;
  wordCount: number;
  transcript: string;
  summary: string;
  keyInsights: string[];
  decisions: string[];
  actionItems: Array<{ text: string; assignee?: string }>;
  processed: boolean;
  audioUrl?: string;
  error?: string;
}

export default function App() {
  const { user, token, loading: authLoading, signOut } = useAuth();

  // If auth is still loading, show spinner
  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-primary animate-spin" />
      </div>
    );
  }

  // If not signed in, show sign-in page
  if (!user || !token) {
    return <SignIn />;
  }

  return <AuthenticatedApp user={user} token={token} onSignOut={signOut} />;
}

/* ──────────── Authenticated app (only renders when signed in) ──────────── */

interface AuthAppProps {
  user: { id: string; email: string };
  token: string;
  onSignOut: () => Promise<void>;
}

function AuthenticatedApp({ user, token, onSignOut }: AuthAppProps) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [backendError, setBackendError] = useState<string | null>(null);
  const [isSavingRecording, setIsSavingRecording] = useState(false);
  const [recordingTitle, setRecordingTitle] = useState('');
  const [showRecordingNameInput, setShowRecordingNameInput] = useState(false);
  const { startRecording, stopRecording, transcript, isRecording, error: transcriptError, recordedAudio, hasPendingRecording, clearRecordedAudio, finalizeRecording, resetRecording } = useAudioStream();

  const canSave = Boolean(transcript?.trim() && (recordedAudio || hasPendingRecording));

  useEffect(() => {
    if (!recordedAudio && !hasPendingRecording) setShowRecordingNameInput(false);
  }, [recordedAudio, hasPendingRecording]);

  useEffect(() => {
    const healthCheck = async () => {
      try {
        const response = await authFetch(`${API_BASE_URL || ''}/health`, token);
        const data = await response.json();
        if (!data.ok) setBackendError('Backend health check failed.');
      } catch {
        setBackendError('Backend not reachable. Start it with: cd backend && python app.py');
      } finally {
        setIsLoading(false);
      }
    };
    healthCheck();
  }, [token]);

  useEffect(() => {
    fetchMeetings();
  }, []);

  const fetchMeetings = async () => {
    try {
      const response = await authFetch(`${API_BASE_URL || ''}/meetings`, token);
      if (!response.ok) throw new Error('Failed to fetch meetings');
      const data = await response.json();
      setMeetings(data.meetings || []);
    } catch (error) {
      console.error('Error fetching meetings:', error);
    }
  };

  const formatDuration = (seconds: number): string => {
      const m = Math.floor(seconds / 60);
      const s = Math.floor(seconds % 60);
      return `${m}:${s.toString().padStart(2, '0')}`;
    };

  const handleSaveRecording = async () => {
    if (!canSave) return;
    if (!showRecordingNameInput) {
      setShowRecordingNameInput(true);
      return;
    }
    const blob = recordedAudio ?? (hasPendingRecording ? await finalizeRecording() : null)
    if (!blob) return;
    setIsSavingRecording(true);
    try {
      let durationStr = '0:00';
      try {
        const arrayBuffer = await blob.arrayBuffer();
        const audioContext = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
        durationStr = formatDuration(decoded.duration);
        audioContext.close();
      } catch (_) {
        // keep 0:00 if we can't decode
      }
      const title = recordingTitle.trim() || `Live recording ${new Date().toLocaleString()}`;
      const formData = new FormData();
      formData.append('title', title);
      formData.append('transcript', transcript);
      formData.append('duration', durationStr);
      formData.append('audio', blob, 'recording.webm');
      const response = await authFetch(`${API_BASE_URL || ''}/meetings`, token, {
        method: 'POST',
        body: formData,
      });
      if (!response.ok) throw new Error('Failed to save recording');
      const data = await response.json();
      setMeetings((prev) => [data.meeting, ...prev]);
      clearRecordedAudio();
      setRecordingTitle('');
    } catch (error) {
      console.error('Error saving recording:', error);
    } finally {
      setIsSavingRecording(false);
    }
  };

  const handleUpload = async (file: File, title: string) => {
    const formData = new FormData();
    formData.append('title', title);
    formData.append('audio', file);

    const response = await authFetch(`${API_BASE_URL || ''}/meetings`, token, {
      method: 'POST',
      body: formData,
    });
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
      throw new Error(errorData.error || `Upload failed (${response.status})`);
    }
    const data = await response.json();
    const newMeeting = data.meeting;
    setMeetings(prev => [newMeeting, ...prev]);

    // Trigger AI processing in background
    authFetch(`${API_BASE_URL || ''}/meetings/${newMeeting.id}/process`, token, { method: 'POST' })
      .then(async (res) => {
        if (!res.ok) {
          const ed = await res.json().catch(() => ({ error: 'Processing failed' }));
          const msg = ed.detail ? `${ed.error || 'Processing failed'}: ${ed.detail}` : (ed.error || 'Processing failed');
          console.error('[process]', res.status, ed);
          setMeetings(prev => prev.map(m =>
            m.id === newMeeting.id ? { ...m, processed: false, error: msg } : m
          ));
          return;
        }
        const { meeting: pm } = await res.json();
        setMeetings(prev => prev.map(m => m.id === pm.id ? pm : m));
      })
      .catch((err) => {
        console.error('[process]', err);
        const msg = err instanceof Error ? err.message : 'Failed to process audio with AI';
        setMeetings(prev => prev.map(m =>
          m.id === newMeeting.id ? { ...m, processed: false, error: `Network/processing error: ${msg}` } : m
        ));
      });
  };

  const handleDeleteMeeting = async (meetingId: string) => {
    try {
      const response = await authFetch(`${API_BASE_URL || ''}/meetings/${meetingId}`, token, { method: 'DELETE' });
      if (!response.ok) throw new Error('Failed to delete meeting');
      setMeetings(prev => prev.filter(m => m.id !== meetingId));
      if (selectedMeetingId === meetingId) setSelectedMeetingId(null);
    } catch (error) {
      console.error('Delete error:', error);
    }
  };

  const handleSelectMeeting = async (meetingId: string) => {
    try {
      const response = await authFetch(`${API_BASE_URL || ''}/meetings/${meetingId}`, token);
      if (!response.ok) throw new Error('Failed to fetch meeting details');
      const { meeting } = await response.json();
      setMeetings(prev => prev.map(m => m.id === meeting.id ? meeting : m));
      setSelectedMeetingId(meetingId);
    } catch (error) {
      console.error('Error fetching meeting details:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-primary animate-spin" />
      </div>
    );
  }

  const selectedMeeting = selectedMeetingId
    ? meetings.find(m => m.id === selectedMeetingId)
    : null;

  return (
    <div className="min-h-screen bg-background relative">
      {backendError && (
        <Alert variant="destructive" className="rounded-none">
          <AlertTitle>Backend unavailable</AlertTitle>
          <AlertDescription>
            {backendError} — The backend may not be deployed yet. Check console for details.
          </AlertDescription>
        </Alert>
      )}

      {/* Header */}
      <header className="bg-card border-b border-border/60">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center">
              <Mic2 className="w-5 h-5 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-lg font-semibold text-foreground leading-tight">Meeting Insights</h1>
              <p className="text-sm text-muted-foreground">Welcome back, {user.email}</p>
            </div>
          </div>
          <button
            onClick={onSignOut}
            className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm"
          >
            <LogOut className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {selectedMeeting ? (
          <MeetingDetail
            meeting={selectedMeeting}
            onBack={() => setSelectedMeetingId(null)}
            authToken={token}
            apiBaseUrl={API_BASE_URL}
          />
        ) : (
          <>
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-2xl font-bold text-foreground mb-0.5">Your Meetings</h2>
                <p className="text-muted-foreground text-sm">
                  {meetings.length} {meetings.length === 1 ? 'recording' : 'recordings'} total
                </p>
              </div>
              <Button onClick={() => setShowUploadModal(true)} size="lg" className="rounded-lg px-6 shadow-sm">
                <Plus className="w-5 h-5" />
                Upload Meeting
              </Button>
            </div>

            {meetings.length === 0 ? (
              <div className="rounded-2xl bg-[#eeeafd]/40 py-24 flex flex-col items-center justify-center">
                <div className="w-16 h-16 bg-[#ddd6fe] rounded-full flex items-center justify-center mb-5">
                  <Mic2 className="w-7 h-7 text-primary" />
                </div>
                <h3 className="text-xl font-semibold text-foreground mb-2">No meetings yet</h3>
                <p className="text-muted-foreground mb-6 text-sm">
                  Upload your first meeting recording to get started
                </p>
                <Button onClick={() => setShowUploadModal(true)} size="lg" className="rounded-lg px-6">
                  <Plus className="w-5 h-5" />
                  Upload Meeting
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {meetings.map((meeting) => (
                  <MeetingCard
                    key={meeting.id}
                    meeting={meeting}
                    onSelect={handleSelectMeeting}
                    onDelete={handleDeleteMeeting}
                    onDurationLoaded={(meetingId, durationStr) => {
                      setMeetings((prev) =>
                        prev.map((m) => (m.id === meetingId ? { ...m, duration: durationStr } : m))
                      );
                    }}
                    authToken={token}
                  />
                ))}
              </div>
            )}

            {/* Live Transcript */}
            <Card className="mt-10">
              <CardHeader>
                <CardTitle className="text-lg">Live Transcript</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Start recording to capture audio and live transcript. Stop when done, then save to add the recording (with audio) to your meetings.
                </p>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  {!isRecording ? (
                    <Button type="button" onClick={startRecording} className="bg-green-600 hover:bg-green-700 rounded-lg">
                      <Mic2 className="w-4 h-4" />
                      {hasPendingRecording ? 'Continue recording' : 'Start recording'}
                    </Button>
                  ) : (
                    <Button type="button" onClick={stopRecording} variant="destructive" className="rounded-lg">
                      Stop recording
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleSaveRecording}
                    disabled={!canSave || isSavingRecording || showRecordingNameInput}
                    className="rounded-lg"
                    title={!canSave ? 'Record something first, then save.' : showRecordingNameInput ? 'Use the popup to name and save.' : 'Save this recording (transcript + audio) to your meetings.'}
                  >
                    {isSavingRecording ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    Save recording
                  </Button>
                  {(isRecording || hasPendingRecording || transcript) && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        resetRecording();
                        setShowRecordingNameInput(false);
                      }}
                      className="rounded-lg text-muted-foreground hover:text-destructive"
                      title="Clear transcript and audio (start over)"
                    >
                      <RotateCcw className="w-4 h-4" />
                      Reset
                    </Button>
                  )}
                </div>
                {!showRecordingNameInput && (recordedAudio || hasPendingRecording) && (
                  <p className="text-sm text-muted-foreground">
                    {hasPendingRecording
                      ? 'Recording paused. Start again to continue, or Save to finish, or Reset to clear.'
                      : 'Audio captured. Click Save recording to name and save.'}
                  </p>
                )}

                <Dialog open={showRecordingNameInput} onOpenChange={setShowRecordingNameInput}>
                  <DialogContent className="sm:max-w-md">
                    <DialogHeader>
                      <DialogTitle>Name your recording</DialogTitle>
                      <DialogDescription>
                        Enter a name for this recording, then save to add it to your meetings.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-4 py-2">
                      <label htmlFor="recording-name" className="text-sm font-medium text-foreground sr-only">
                        Recording name
                      </label>
                      <input
                        id="recording-name"
                        type="text"
                        value={recordingTitle}
                        onChange={(e) => setRecordingTitle(e.target.value)}
                        placeholder={`Live recording ${new Date().toLocaleString()}`}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                      />
                    </div>
                    <DialogFooter className="gap-2 sm:gap-0">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => setShowRecordingNameInput(false)}
                      >
                        Cancel
                      </Button>
                      <Button
                        type="button"
                        onClick={handleSaveRecording}
                        disabled={isSavingRecording}
                      >
                        {isSavingRecording ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        Save recording
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                {transcriptError && !/already closed|socket.*closed/i.test(transcriptError) && (
                  <Alert variant="destructive">
                    <AlertDescription>{transcriptError}</AlertDescription>
                  </Alert>
                )}
                <div className="min-h-[4rem] rounded-lg bg-muted p-3 text-foreground text-sm">
                  {transcript ? transcript : (isRecording ? 'Listening\u2026' : <span className="opacity-50">Start recording to see the transcript here.</span>)}
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </main>

      {showUploadModal && (
        <UploadModal
          onClose={() => setShowUploadModal(false)}
          onUpload={handleUpload}
        />
      )}

      <button
        className="fixed bottom-6 right-6 w-12 h-12 bg-foreground text-background rounded-full flex items-center justify-center shadow-lg hover:opacity-90 transition-opacity z-50"
        aria-label="Help"
      >
        <HelpCircle className="w-5 h-5" />
      </button>
    </div>
  );
}
