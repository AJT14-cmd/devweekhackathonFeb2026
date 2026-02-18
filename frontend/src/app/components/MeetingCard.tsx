import { useEffect, useRef, useState } from 'react';
import { Calendar, Clock, FileAudio, Trash2, AlertCircle, Loader2 } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader } from './ui/card';
import { Button } from './ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog';
import { API_BASE_URL, authFetch } from '../lib/api';

interface Meeting {
  id: string;
  title: string;
  uploadDate: string;
  duration: string;
  fileName: string;
  processed: boolean;
  summary?: string;
  error?: string;
  audioUrl?: string;
}

interface MeetingCardProps {
  meeting: Meeting;
  onSelect: (meetingId: string) => void;
  onDelete: (meetingId: string) => void;
  onDurationLoaded?: (meetingId: string, durationStr: string) => void;
  authToken?: string;
}

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function MeetingCard({ meeting, onSelect, onDelete, onDurationLoaded, authToken }: MeetingCardProps) {
  const [resolvedDuration, setResolvedDuration] = useState<string | null>(null);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const resolvedRef = useRef(false);

  const needsDuration = meeting.audioUrl && (meeting.duration === '0:00' || meeting.duration === '0:0');
  const audioUrl = meeting.audioUrl;
  const durationLoading = needsDuration && resolvedDuration === null;
  const displayDuration = (meeting.duration !== '0:00' && meeting.duration !== '0:0') ? meeting.duration : (resolvedDuration ?? meeting.duration);

  useEffect(() => {
    if (!needsDuration || !audioUrl || !onDurationLoaded || resolvedRef.current || !authToken) return;
    resolvedRef.current = true;
    const url = audioUrl.startsWith('http') ? audioUrl : `${API_BASE_URL || ''}${audioUrl}`;
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const fetchPromise = authFetch(url, authToken, { method: 'GET' });
    fetchPromise
      .then((res) => res.arrayBuffer())
      .then((buffer) => ctx.decodeAudioData(buffer))
      .then((decoded) => {
        if (decoded.duration != null && Number.isFinite(decoded.duration)) {
          const str = formatDuration(decoded.duration);
          setResolvedDuration(str);
          onDurationLoaded(meeting.id, str);
        }
      })
      .catch(() => {})
      .finally(() => ctx.close());
  }, [needsDuration, audioUrl, meeting.id, onDurationLoaded, authToken]);

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setShowDeleteDialog(true);
  };

  const handleConfirmDelete = () => {
    onDelete(meeting.id);
    setShowDeleteDialog(false);
  };

  return (
    <Card
      onClick={() => onSelect(meeting.id)}
      className="hover:shadow-lg transition-shadow cursor-pointer group"
    >
      <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
        <div className="flex items-start gap-3 flex-1">
          <div className="p-2 bg-primary/10 rounded-lg">
            <FileAudio className="w-5 h-5 text-primary" />
          </div>
          <div className="flex-1 space-y-1">
            <h3 className="text-lg font-semibold text-card-foreground">{meeting.title}</h3>
            <p className="text-sm text-muted-foreground">{meeting.fileName}</p>
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={handleDeleteClick}
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </CardHeader>

      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete recording?</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete &quot;{meeting.title}&quot;? This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmDelete} className="bg-destructive text-white hover:bg-destructive/90 hover:text-white">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <Calendar className="w-4 h-4" />
            <span>{format(new Date(meeting.uploadDate), 'MMM d, yyyy')}</span>
          </div>
          <div className="flex items-center gap-1 min-w-[3rem]">
            <Clock className="w-4 h-4 shrink-0" />
            {durationLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" aria-label="Loading duration" />
            ) : (
              <span>{displayDuration}</span>
            )}
          </div>
        </div>

        {meeting.processed && meeting.summary && (
          <p className="text-sm text-muted-foreground line-clamp-2">{meeting.summary}</p>
        )}

        {!meeting.processed && !meeting.error && (
          <div className="flex items-center gap-2 text-sm text-primary">
            <div className="w-2 h-2 bg-primary rounded-full animate-pulse" />
            Processing with AI...
          </div>
        )}

        {meeting.error && (
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {meeting.error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}