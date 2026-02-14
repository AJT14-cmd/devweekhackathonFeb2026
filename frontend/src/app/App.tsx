import { useState, useEffect } from 'react';
import { MeetingCard } from './components/MeetingCard';
import { MeetingDetail } from './components/MeetingDetail';
import { UploadModal } from './components/UploadModal';
import { useAudioStream } from './hooks/useAudioStream';
import { Plus, Mic2, Loader2 } from 'lucide-react';
import { API_BASE_URL } from './lib/api';

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
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [selectedMeetingId, setSelectedMeetingId] = useState<string | null>(null);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [backendError, setBackendError] = useState<string | null>(null);
  const { startRecording, stopRecording, transcript, isRecording, error: transcriptError } = useAudioStream();

  useEffect(() => {
    const healthCheck = async () => {
      try {
        const response = await fetch(`${API_BASE_URL || ''}/health`);
        const data = await response.json();
        if (!data.ok) setBackendError('Backend health check failed.');
      } catch (error) {
        console.error('Backend health check failed:', error);
        setBackendError('Backend not reachable. Start it with: cd backend && python app.py');
      } finally {
        setIsLoading(false);
      }
    };
    healthCheck();
  }, []);

  useEffect(() => {
    fetchMeetings();
  }, []);

  const fetchMeetings = async () => {
    try {
      const response = await fetch(`${API_BASE_URL || ''}/meetings`);

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Fetch meetings error response:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData
        });
        throw new Error(errorData.error || `Failed to fetch meetings (${response.status})`);
      }

      const data = await response.json();
      setMeetings(data.meetings || []);
    } catch (error) {
      console.error('Error fetching meetings:', error);
    }
  };

  const handleUpload = async (file: File, title: string) => {
    const formData = new FormData();
    formData.append('title', title);
    formData.append('audio', file);

    try {
      const response = await fetch(`${API_BASE_URL || ''}/meetings`, {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
        console.error('Upload error response:', {
          status: response.status,
          statusText: response.statusText,
          error: errorData
        });
        throw new Error(errorData.error || `Upload failed (${response.status})`);
      }

      const data = await response.json();
      const newMeeting = data.meeting;

      // Add meeting to list
      setMeetings(prev => [newMeeting, ...prev]);

      // Trigger AI processing with Deepgram
      console.log('Starting Deepgram AI processing for meeting:', newMeeting.id);
      
      // Start processing in background
      fetch(`${API_BASE_URL || ''}/meetings/${newMeeting.id}/process`, {
        method: 'POST',
      })
        .then(async (processResponse) => {
          if (!processResponse.ok) {
            const errorData = await processResponse.json().catch(() => ({ error: 'Unknown error' }));
            console.error('Processing error:', errorData);
            // Update meeting with error status
            setMeetings(prev => prev.map(m => 
              m.id === newMeeting.id 
                ? { ...m, processed: false, error: errorData.error || 'Processing failed' }
                : m
            ));
            return;
          }

          const { meeting: processedMeeting } = await processResponse.json();
          console.log('AI processing completed successfully:', processedMeeting);
          
          // Update meeting with AI results
          setMeetings(prev => prev.map(m => 
            m.id === processedMeeting.id ? processedMeeting : m
          ));
        })
        .catch((error) => {
          console.error('Processing error:', error);
          setMeetings(prev => prev.map(m => 
            m.id === newMeeting.id 
              ? { ...m, processed: false, error: 'Failed to process audio with AI' }
              : m
          ));
        });

    } catch (error) {
      console.error('Upload error:', error);
      throw error;
    }
  };

  const handleDeleteMeeting = async (meetingId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL || ''}/meetings/${meetingId}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete meeting');
      }

      setMeetings(prev => prev.filter(m => m.id !== meetingId));
      if (selectedMeetingId === meetingId) {
        setSelectedMeetingId(null);
      }
    } catch (error) {
      console.error('Delete error:', error);
    }
  };

  const handleSelectMeeting = async (meetingId: string) => {
    try {
      const response = await fetch(`${API_BASE_URL || ''}/meetings/${meetingId}`);

      if (!response.ok) {
        throw new Error('Failed to fetch meeting details');
      }

      const { meeting } = await response.json();
      
      // Update the meeting in the list with the audio URL
      setMeetings(prev => prev.map(m => m.id === meeting.id ? meeting : m));
      setSelectedMeetingId(meetingId);
    } catch (error) {
      console.error('Error fetching meeting details:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
      </div>
    );
  }

  const selectedMeeting = selectedMeetingId 
    ? meetings.find(m => m.id === selectedMeetingId)
    : null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50">
      {/* Backend Error Banner */}
      {backendError && (
        <div className="bg-red-500 text-white px-4 py-3 text-center">
          <p className="text-sm">⚠️ {backendError} - The backend may not be deployed yet. Check console for details.</p>
        </div>
      )}
      
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-500 rounded-lg">
              <Mic2 className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-xl text-gray-900">Meeting Insights</h1>
              <p className="text-sm text-gray-600">Local backend (no Supabase)</p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-8">
        {selectedMeeting ? (
          <MeetingDetail 
            meeting={selectedMeeting} 
            onBack={() => setSelectedMeetingId(null)} 
          />
        ) : (
          <>
            {/* Actions */}
            <div className="flex items-center justify-between mb-8">
              <div>
                <h2 className="text-2xl text-gray-900 mb-1">Your Meetings</h2>
                <p className="text-gray-600">
                  {meetings.length} {meetings.length === 1 ? 'recording' : 'recordings'} total
                </p>
              </div>
              <button
                onClick={() => setShowUploadModal(true)}
                className="flex items-center gap-2 px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors shadow-md hover:shadow-lg"
              >
                <Plus className="w-5 h-5" />
                Upload Meeting
              </button>
            </div>

            {/* Live transcript (Flask backend on port 5000 via Vite proxy) */}
            <section className="mb-8 rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
              <h2 className="text-lg font-semibold text-gray-900 mb-3">Live transcript</h2>
              <p className="text-sm text-gray-600 mb-3">Real-time speech-to-text via the local backend (Deepgram).</p>
              <div className="flex flex-wrap items-center gap-3 mb-3">
                {!isRecording ? (
                  <button
                    type="button"
                    onClick={startRecording}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                  >
                    <Mic2 className="w-4 h-4" />
                    Start recording
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
                  >
                    Stop recording
                  </button>
                )}
              </div>
              {transcriptError && (
                <p className="text-sm text-red-600 mb-2" role="alert">{transcriptError}</p>
              )}
              <div className="min-h-[4rem] rounded-lg bg-gray-50 p-3 text-gray-700">
                {transcript ? transcript : (isRecording ? 'Listening…' : 'Start recording to see the transcript here.')}
              </div>
            </section>

            {/* Meetings Grid */}
            {meetings.length === 0 ? (
              <div className="text-center py-16">
                <div className="inline-flex items-center justify-center w-16 h-16 bg-blue-100 rounded-full mb-4">
                  <Mic2 className="w-8 h-8 text-blue-500" />
                </div>
                <h3 className="text-xl text-gray-900 mb-2">No meetings yet</h3>
                <p className="text-gray-600 mb-6">
                  Upload your first meeting recording to get started
                </p>
                <button
                  onClick={() => setShowUploadModal(true)}
                  className="inline-flex items-center gap-2 px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors"
                >
                  <Plus className="w-5 h-5" />
                  Upload Meeting
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {meetings.map((meeting) => (
                  <MeetingCard
                    key={meeting.id}
                    meeting={meeting}
                    onSelect={handleSelectMeeting}
                    onDelete={handleDeleteMeeting}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </main>

      {/* Upload Modal */}
      {showUploadModal && (
        <UploadModal
          onClose={() => setShowUploadModal(false)}
          onUpload={handleUpload}
        />
      )}
    </div>
  );
}