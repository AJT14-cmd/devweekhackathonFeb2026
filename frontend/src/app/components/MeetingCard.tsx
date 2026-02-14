import { Calendar, Clock, FileAudio, Trash2, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';
import { Card, CardContent, CardHeader } from './ui/card';
import { Button } from './ui/button';

interface Meeting {
  id: string;
  title: string;
  uploadDate: string;
  duration: string;
  fileName: string;
  processed: boolean;
  summary?: string;
  error?: string;
}

interface MeetingCardProps {
  meeting: Meeting;
  onSelect: (meetingId: string) => void;
  onDelete: (meetingId: string) => void;
}

export function MeetingCard({ meeting, onSelect, onDelete }: MeetingCardProps) {
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Delete "${meeting.title}"?`)) {
      onDelete(meeting.id);
    }
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
          onClick={handleDelete}
          className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="w-4 h-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <div className="flex items-center gap-1">
            <Calendar className="w-4 h-4" />
            <span>{format(new Date(meeting.uploadDate), 'MMM d, yyyy')}</span>
          </div>
          <div className="flex items-center gap-1">
            <Clock className="w-4 h-4" />
            <span>{meeting.duration}</span>
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