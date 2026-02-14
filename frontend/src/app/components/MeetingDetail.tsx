import { ArrowLeft, Calendar, Clock, Hash, FileText, Lightbulb, CheckCircle, ListTodo } from 'lucide-react';
import { format } from 'date-fns';
import { AudioPlayer } from './AudioPlayer';

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
  audioUrl?: string;
}

interface MeetingDetailProps {
  meeting: Meeting;
  onBack: () => void;
}

export function MeetingDetail({ meeting, onBack }: MeetingDetailProps) {
  return (
    <div className="max-w-4xl mx-auto">
      <button
        onClick={onBack}
        className="flex items-center gap-2 text-gray-600 hover:text-gray-900 mb-6"
      >
        <ArrowLeft className="w-5 h-5" />
        Back to Meetings
      </button>

      <div className="bg-white rounded-lg shadow-md p-8 mb-6">
        <h1 className="text-3xl text-gray-900 mb-4">{meeting.title}</h1>
        
        <div className="flex flex-wrap gap-4 text-sm text-gray-600 mb-6">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4" />
            <span>{format(new Date(meeting.uploadDate), 'MMMM d, yyyy')}</span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4" />
            <span>{meeting.duration}</span>
          </div>
          <div className="flex items-center gap-2">
            <Hash className="w-4 h-4" />
            <span>{meeting.wordCount} words</span>
          </div>
        </div>

        {meeting.audioUrl && (
          <AudioPlayer audioUrl={meeting.audioUrl} fileName={meeting.fileName} />
        )}
      </div>

      {/* Summary */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="w-5 h-5 text-blue-600" />
          <h2 className="text-xl text-gray-900">Summary</h2>
        </div>
        <p className="text-gray-700 leading-relaxed">{meeting.summary}</p>
      </div>

      {/* Key Insights */}
      {meeting.keyInsights && meeting.keyInsights.length > 0 && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <Lightbulb className="w-5 h-5 text-yellow-600" />
            <h2 className="text-xl text-gray-900">Key Insights</h2>
          </div>
          <ul className="space-y-3">
            {meeting.keyInsights.map((insight, index) => (
              <li key={index} className="flex gap-3">
                <span className="flex-shrink-0 w-6 h-6 bg-yellow-100 text-yellow-700 rounded-full flex items-center justify-center text-sm font-medium">
                  {index + 1}
                </span>
                <span className="text-gray-700">{insight}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Decisions */}
      {meeting.decisions && meeting.decisions.length > 0 && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <CheckCircle className="w-5 h-5 text-green-600" />
            <h2 className="text-xl text-gray-900">Decisions Made</h2>
          </div>
          <ul className="space-y-3">
            {meeting.decisions.map((decision, index) => (
              <li key={index} className="flex gap-3">
                <CheckCircle className="flex-shrink-0 w-5 h-5 text-green-500 mt-0.5" />
                <span className="text-gray-700">{decision}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Action Items */}
      {meeting.actionItems && meeting.actionItems.length > 0 && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <div className="flex items-center gap-2 mb-4">
            <ListTodo className="w-5 h-5 text-purple-600" />
            <h2 className="text-xl text-gray-900">Action Items</h2>
          </div>
          <ul className="space-y-3">
            {meeting.actionItems.map((item, index) => (
              <li key={index} className="flex gap-3 items-start">
                <input
                  type="checkbox"
                  className="mt-1 w-5 h-5 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                />
                <div className="flex-1">
                  <p className="text-gray-700">{item.text}</p>
                  {item.assignee && (
                    <p className="text-sm text-gray-500 mt-1">Assigned to: {item.assignee}</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Full Transcript */}
      {meeting.transcript && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-xl text-gray-900 mb-4">Full Transcript</h2>
          <div className="prose max-w-none">
            <p className="text-gray-700 leading-relaxed whitespace-pre-line">
              {meeting.transcript}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
