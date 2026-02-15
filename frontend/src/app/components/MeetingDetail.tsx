import { useState, useCallback } from 'react';
import { ArrowLeft, Calendar, Clock, Hash, FileText, Lightbulb, CheckCircle, ListTodo } from 'lucide-react';
import { format } from 'date-fns';
import { AudioPlayer } from './AudioPlayer';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';

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

function formatDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

interface MeetingDetailProps {
  meeting: Meeting;
  onBack: () => void;
}

export function MeetingDetail({ meeting, onBack }: MeetingDetailProps) {
  const [resolvedDuration, setResolvedDuration] = useState<string | null>(null);
  const onDurationLoaded = useCallback((durationSeconds: number) => {
    setResolvedDuration(formatDuration(durationSeconds));
  }, []);
  const displayDuration = resolvedDuration ?? meeting.duration;

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Button variant="ghost" onClick={onBack} className="gap-2 text-muted-foreground hover:text-foreground -ml-2">
        <ArrowLeft className="w-5 h-5" />
        Back to Meetings
      </Button>

      <Card>
        <CardHeader>
          <CardTitle className="text-3xl">{meeting.title}</CardTitle>
          <div className="flex flex-wrap gap-4 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Calendar className="w-4 h-4" />
              <span>{format(new Date(meeting.uploadDate), "MMMM d, yyyy 'at' h:mm a")}</span>
            </div>
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4" />
              <span>{displayDuration}</span>
            </div>
            <div className="flex items-center gap-2">
              <Hash className="w-4 h-4" />
              <span>{meeting.wordCount} words</span>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {meeting.audioUrl && (
            <AudioPlayer
              audioUrl={meeting.audioUrl}
              fileName={meeting.fileName}
              onDurationLoaded={onDurationLoaded}
            />
          )}
        </CardContent>
      </Card>

      {/* Summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2">
            <FileText className="w-5 h-5 text-primary" />
            Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-card-foreground leading-relaxed">{meeting.summary}</p>
        </CardContent>
      </Card>

      {/* Key Insights */}
      {meeting.keyInsights && meeting.keyInsights.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-amber-500" />
              Key Insights
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {meeting.keyInsights.map((insight, index) => (
                <li key={index} className="flex gap-3">
                  <span className="flex-shrink-0 w-6 h-6 bg-primary/10 text-primary rounded-full flex items-center justify-center text-sm font-medium">
                    {index + 1}
                  </span>
                  <span className="text-card-foreground">{insight}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Decisions */}
      {meeting.decisions && meeting.decisions.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-600" />
              Decisions Made
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {meeting.decisions.map((decision, index) => (
                <li key={index} className="flex gap-3">
                  <CheckCircle className="flex-shrink-0 w-5 h-5 text-green-500 mt-0.5" />
                  <span className="text-card-foreground">{decision}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Action Items */}
      {meeting.actionItems && meeting.actionItems.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl flex items-center gap-2">
              <ListTodo className="w-5 h-5 text-primary" />
              Action Items
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3">
              {meeting.actionItems.map((item, index) => (
                <li key={index} className="flex gap-3 items-start">
                  <input
                    type="checkbox"
                    className="mt-1 w-5 h-5 rounded border-input text-primary focus:ring-ring"
                  />
                  <div className="flex-1">
                    <p className="text-card-foreground">{item.text}</p>
                    {item.assignee && (
                      <p className="text-sm text-muted-foreground mt-1">Assigned to: {item.assignee}</p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Full Transcript */}
      {meeting.transcript && (
        <Card>
          <CardHeader>
            <CardTitle className="text-xl">Full Transcript</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-card-foreground leading-relaxed whitespace-pre-line">
              {meeting.transcript}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
