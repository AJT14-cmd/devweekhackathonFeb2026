import { Calendar, Clock, FileAudio, Trash2, AlertCircle } from 'lucide-react';
import { format } from 'date-fns';

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
    <div
      onClick={() => onSelect(meeting.id)}
      className="bg-white rounded-lg shadow-md p-6 hover:shadow-lg transition-shadow cursor-pointer group"
    >
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-start gap-3 flex-1">
          <div className="p-2 bg-blue-50 rounded-lg">
            <FileAudio className="w-5 h-5 text-blue-500" />
          </div>
          <div className="flex-1">
            <h3 className="text-lg text-gray-900 mb-1">{meeting.title}</h3>
            <p className="text-sm text-gray-500">{meeting.fileName}</p>
          </div>
        </div>
        <button
          onClick={handleDelete}
          className="opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-red-50 rounded-lg"
        >
          <Trash2 className="w-4 h-4 text-red-500" />
        </button>
      </div>

      <div className="flex items-center gap-4 text-sm text-gray-600">
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
        <p className="mt-3 text-sm text-gray-600 line-clamp-2">{meeting.summary}</p>
      )}

      {!meeting.processed && !meeting.error && (
        <div className="mt-3 flex items-center gap-2 text-sm text-blue-600">
          <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
          Processing with AI...
        </div>
      )}

      {meeting.error && (
        <div className="mt-3 flex items-center gap-2 text-sm text-red-600">
          <AlertCircle className="w-4 h-4" />
          {meeting.error}
        </div>
      )}
    </div>
  );
}