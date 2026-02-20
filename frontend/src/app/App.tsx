import { useState, useEffect, useCallback } from 'react';
import { MeetingCard } from './components/MeetingCard';
import { MeetingDetail } from './components/MeetingDetail';
import { UploadModal } from './components/UploadModal';
import { SignIn } from './components/SignIn';
import { useAudioStream } from './hooks/useAudioStream';
import { useAuth } from './contexts/AuthContext';
import { Plus, Mic2, Loader2, LogOut, Save, RotateCcw, Home, FolderOpen, FileText } from 'lucide-react';
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
  summarySource?: string;
  researchInsights?: Array<{ insight: string; url: string; title: string }>;
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
  const [activeView, setActiveView] = useState<'home' | 'meetings' | 'transcripts'>('home');
  const [returnToView, setReturnToView] = useState<'home' | 'meetings' | 'transcripts'>('home');
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

  const fetchMeetings = useCallback(async () => {
    try {
      const response = await authFetch(`${API_BASE_URL || ''}/meetings`, token);
      if (response.status === 401) {
        await onSignOut();
        return;
      }
      if (!response.ok) throw new Error('Failed to fetch meetings');
      const data = await response.json();
      setMeetings(data.meetings || []);
    } catch (error) {
      console.error('Error fetching meetings:', error);
    }
  }, [token, onSignOut]);

  useEffect(() => {
    fetchMeetings();
  }, [fetchMeetings]);

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

  const handleMeetingTitleChange = async (meetingId: string, newTitle: string) => {
    setMeetings(prev => prev.map(m => (m.id === meetingId ? { ...m, title: newTitle } : m)));
    try {
      const response = await authFetch(`${API_BASE_URL || ''}/meetings/${meetingId}`, token, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
      if (!response.ok) throw new Error('Failed to update title');
      const { meeting } = await response.json();
      if (meeting?.title === newTitle) {
        setMeetings(prev => prev.map(m => (m.id === meetingId ? { ...m, ...meeting } : m)));
      }
    } catch (error) {
      console.error('Error updating title:', error);
    }
  };

  const handleMeetingFileNameChange = async (meetingId: string, newFileName: string) => {
    setMeetings(prev => prev.map(m => (m.id === meetingId ? { ...m, fileName: newFileName } : m)));
    try {
      const response = await authFetch(`${API_BASE_URL || ''}/meetings/${meetingId}`, token, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_name: newFileName }),
      });
      if (!response.ok) throw new Error('Failed to update file name');
      const { meeting } = await response.json();
      if (meeting?.fileName !== undefined) {
        setMeetings(prev => prev.map(m => (m.id === meetingId ? { ...m, fileName: meeting.fileName } : m)));
      }
    } catch (error) {
      console.error('Error updating file name:', error);
    }
  };

  const handleSelectMeeting = async (meetingId: string) => {
    try {
      const response = await authFetch(`${API_BASE_URL || ''}/meetings/${meetingId}`, token);
      if (!response.ok) throw new Error('Failed to fetch meeting details');
      const { meeting } = await response.json();
      setMeetings(prev => prev.map(m => m.id === meeting.id ? { ...meeting, title: m.title } : m));
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

  const navItems: { id: 'home' | 'meetings' | 'transcripts'; label: string; icon: React.ReactNode }[] = [
    { id: 'home', label: 'Home', icon: <Home className="w-5 h-5" /> },
    { id: 'meetings', label: 'Meetings', icon: <FolderOpen className="w-5 h-5" /> },
    { id: 'transcripts', label: 'Transcripts', icon: <FileText className="w-5 h-5" /> },
  ];

  return (
    <div className="min-h-screen bg-background relative flex">
      {backendError && (
        <Alert variant="destructive" className="rounded-none absolute top-0 left-0 right-0 z-10">
          <AlertTitle>Backend unavailable</AlertTitle>
          <AlertDescription>
            {backendError} — The backend may not be deployed yet. Check console for details.
          </AlertDescription>
        </Alert>
      )}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="bg-card border-b border-border/60 shrink-0">
          <div className="px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-9 h-9 bg-primary rounded-lg flex items-center justify-center shrink-0">
                <Mic2 className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="font-semibold text-foreground">Meeting Insights</span>
            </div>
            <p className="text-sm text-muted-foreground">Welcome back, {user.email}</p>
          </div>
        </header>

        <main className="flex-1 max-w-5xl w-full mx-auto px-6 py-8">
          {activeView === 'meetings' && selectedMeeting ? (
            <MeetingDetail
              meeting={selectedMeeting}
              onBack={() => {
              setSelectedMeetingId(null);
              setActiveView(returnToView);
            }}
              onTitleChange={(newTitle) => handleMeetingTitleChange(selectedMeeting.id, newTitle)}
              onFileNameChange={(newFileName) => handleMeetingFileNameChange(selectedMeeting.id, newFileName)}
              authToken={token}
              apiBaseUrl={API_BASE_URL}
            />
          ) : activeView === 'home' ? (
            <>
              <h2 className="text-2xl font-bold text-foreground mb-2">Home</h2>
              <p className="text-muted-foreground text-sm mb-6">
                Your meetings and quick record.
              </p>

              <div className="mb-10">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-foreground">Your Meetings</h3>
                  <Button onClick={() => setShowUploadModal(true)} size="sm" className="rounded-lg">
                    <Plus className="w-4 h-4" />
                    Upload
                  </Button>
                </div>
                {meetings.length === 0 ? (
                  <div className="rounded-xl bg-muted/50 py-12 flex flex-col items-center justify-center text-center">
                    <p className="text-sm text-muted-foreground mb-3">No meetings yet</p>
                    <Button onClick={() => setShowUploadModal(true)} variant="outline" size="sm" className="rounded-lg">
                      <Plus className="w-4 h-4" />
                      Upload Meeting
                    </Button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {meetings.map((meeting) => (
                      <MeetingCard
                        key={meeting.id}
                        meeting={meeting}
                        onSelect={(id) => {
                          setReturnToView(activeView);
                          setSelectedMeetingId(id);
                          setActiveView('meetings');
                          handleSelectMeeting(id);
                        }}
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
              </div>

              <Card>
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
          ) : activeView === 'transcripts' ? (
            <>
              <h2 className="text-2xl font-bold text-foreground mb-2">Transcripts</h2>
              <p className="text-muted-foreground text-sm mb-8">
                Browse transcripts from your meetings.
              </p>
              {meetings.length === 0 ? (
                <div className="rounded-xl bg-muted/50 py-12 flex flex-col items-center justify-center text-center">
                  <FileText className="w-12 h-12 text-muted-foreground mb-3" />
                  <p className="text-muted-foreground">No transcripts yet. Record or upload a meeting to see transcripts here.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {meetings.map((meeting) => (
                    <Card
                      key={meeting.id}
                      className="cursor-pointer hover:shadow-md transition-shadow"
                      onClick={() => {
                        setReturnToView(activeView);
                        setSelectedMeetingId(meeting.id);
                        setActiveView('meetings');
                        handleSelectMeeting(meeting.id);
                      }}
                    >
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base">{meeting.title}</CardTitle>
                        <p className="text-xs text-muted-foreground">
                          {new Date(meeting.uploadDate).toLocaleDateString()} · {meeting.wordCount} words
                        </p>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <p className="text-sm text-muted-foreground line-clamp-3 whitespace-pre-line">
                          {meeting.transcript || 'No transcript.'}
                        </p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </>
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
                      onSelect={(id) => {
                        setReturnToView(activeView);
                        setSelectedMeetingId(id);
                        setActiveView('meetings');
                        handleSelectMeeting(id);
                      }}
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
            </>
          )}
        </main>
      </div>

      {/* Right sidebar: fixed overlay, only in the right margin so it never covers main content */}
      <div
        className="sidebar-right-zone fixed top-0 right-0 bottom-0 z-40 flex justify-end group min-w-0"
        aria-label="Navigation"
      >
        <div className="w-4 h-full border-l border-border/60 bg-card/95 backdrop-blur-sm flex flex-col transition-[width] duration-200 ease-out overflow-hidden shadow-[0_0_24px_rgba(0,0,0,0.06)] group-hover:shadow-[0_0_32px_rgba(0,0,0,0.08)] [--sidebar-expanded:min(16rem,max(0px,calc((100vw-64rem)/2)))] group-hover:w-[var(--sidebar-expanded)]">
          <aside className="min-w-0 w-full h-full flex flex-col pt-4 flex-shrink-0">
            <nav className="p-2 flex flex-col gap-0.5">
            {navItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  setActiveView(item.id);
                  if (item.id !== 'meetings') setSelectedMeetingId(null);
                }}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-left text-sm font-medium transition-colors whitespace-nowrap ${
                  activeView === item.id
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
              </button>
            ))}
          </nav>
          <div className="mt-auto p-2 border-t border-border/60">
            <button
              onClick={onSignOut}
              className="flex items-center gap-3 w-full px-3 py-2.5 rounded-lg text-sm text-muted-foreground hover:bg-muted hover:text-foreground transition-colors whitespace-nowrap"
            >
              <LogOut className="w-5 h-5 shrink-0" />
              <span>Sign Out</span>
            </button>
          </div>
        </aside>
        </div>
      </div>

      {showUploadModal && (
        <UploadModal
          onClose={() => setShowUploadModal(false)}
          onUpload={handleUpload}
        />
      )}

    </div>
  );
}
