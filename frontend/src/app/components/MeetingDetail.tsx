import { useState, useCallback, useEffect } from 'react';
import { ArrowLeft, Calendar, Clock, Hash, FileText, CheckCircle, ListTodo, Pencil, Check, X, ExternalLink } from 'lucide-react';
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
  summarySource?: string;
  researchInsights?: Array<{ insight: string; url: string; title: string }>;
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
  /** Called when the user saves a new title. */
  onTitleChange?: (newTitle: string) => void;
  /** Called when the user saves a new file name. */
  onFileNameChange?: (newFileName: string) => void;
  /** Auth token and API base for download-as-MP3 (optional). */
  authToken?: string;
  apiBaseUrl?: string;
}

export function MeetingDetail({ meeting, onBack, onTitleChange, onFileNameChange, authToken, apiBaseUrl }: MeetingDetailProps) {
  const [resolvedDuration, setResolvedDuration] = useState<string | null>(null);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitleValue, setEditTitleValue] = useState('');
  const onDurationLoaded = useCallback((durationSeconds: number) => {
    setResolvedDuration(formatDuration(durationSeconds));
  }, []);
  const displayDuration = resolvedDuration ?? meeting.duration;

  useEffect(() => {
    setEditTitleValue('');
    setIsEditingTitle(false);
  }, [meeting.id, meeting.title]);

  const startEditingTitle = () => {
    setEditTitleValue('');
    setIsEditingTitle(true);
  };
  const saveTitle = () => {
    const trimmed = editTitleValue.trim();
    if (trimmed && trimmed !== meeting.title) {
      onTitleChange?.(trimmed);
    }
    setIsEditingTitle(false);
  };
  const cancelEditingTitle = () => {
    setEditTitleValue('');
    setIsEditingTitle(false);
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <Button variant="ghost" onClick={onBack} className="gap-2 text-muted-foreground hover:text-foreground -ml-2">
        <ArrowLeft className="w-5 h-5" />
        Back to Meetings
      </Button>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 flex-wrap">
            {isEditingTitle ? (
              <>
                <input
                  type="text"
                  value={editTitleValue}
                  onChange={(e) => setEditTitleValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveTitle();
                    if (e.key === 'Escape') cancelEditingTitle();
                  }}
                  placeholder={meeting.title}
                  className="text-3xl font-semibold bg-transparent border-b-2 border-primary focus:outline-none focus:border-primary flex-1 min-w-[12rem] placeholder:text-muted-foreground placeholder:opacity-60"
                  autoFocus
                />
                <Button variant="ghost" size="icon" onClick={saveTitle} className="shrink-0" title="Save title">
                  <Check className="w-5 h-5 text-green-600" />
                </Button>
                <Button variant="ghost" size="icon" onClick={cancelEditingTitle} className="shrink-0" title="Cancel">
                  <X className="w-5 h-5 text-muted-foreground" />
                </Button>
              </>
            ) : (
              <>
                <CardTitle className="text-3xl">{meeting.title}</CardTitle>
                {onTitleChange && (
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={startEditingTitle}
                    className="shrink-0 text-muted-foreground hover:text-foreground"
                    title="Edit title"
                  >
                    <Pencil className="w-5 h-5" />
                  </Button>
                )}
              </>
            )}
          </div>
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
              downloadAsMp3Url={authToken && apiBaseUrl !== undefined ? `${apiBaseUrl}/meetings/${meeting.id}/audio/download?format=mp3` : undefined}
              authToken={authToken}
              apiBaseUrl={apiBaseUrl}
              onFileNameChange={onFileNameChange}
            />
          )}
        </CardContent>
      </Card>

      {/* Summary: overview + key insights & points in one card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl flex items-center gap-2 flex-wrap">
            <FileText className="w-5 h-5 text-primary" />
            Summary
            {meeting.summarySource === 'youcom' && (
              <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-primary/20 text-primary">You.com AI</span>
            )}
            {meeting.summarySource === 'fallback' && (
              <span className="text-xs font-normal px-2 py-0.5 rounded-full bg-muted text-muted-foreground">Local fallback</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Overview paragraph */}
          <div>
            <p className="text-card-foreground leading-relaxed">
              {meeting.summary || ''}
            </p>
          </div>
          {/* Research & citations from You.com (live web data) */}
          {meeting.researchInsights && meeting.researchInsights.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Research & citations</h4>
              <p className="text-xs text-muted-foreground mb-2">Live insights from You.com Search</p>
              <ul className="space-y-2">
                {meeting.researchInsights.map((r, index) => (
                  <li key={index} className="flex gap-3 text-card-foreground">
                    <ExternalLink className="flex-shrink-0 w-5 h-5 text-primary mt-0.5" />
                    <div>
                      <p className="leading-relaxed">{r.insight}</p>
                      {r.url && (
                        <a
                          href={r.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-primary hover:underline mt-0.5 inline-block"
                        >
                          {r.title || 'View source'}
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* Key insights as bullet list */}
          {meeting.keyInsights && meeting.keyInsights.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Key insights</h4>
              <ul className="space-y-2">
                {meeting.keyInsights.map((insight, index) => (
                  <li key={index} className="flex gap-3 text-card-foreground">
                    <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/15 text-primary flex items-center justify-center text-xs font-medium mt-0.5">
                      {index + 1}
                    </span>
                    <span className="leading-relaxed">{insight}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* Decisions in same card */}
          {meeting.decisions && meeting.decisions.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Decisions</h4>
              <ul className="space-y-2">
                {meeting.decisions.map((decision, index) => (
                  <li key={index} className="flex gap-3 text-card-foreground">
                    <CheckCircle className="flex-shrink-0 w-5 h-5 text-green-600 mt-0.5" />
                    <span className="leading-relaxed">{decision}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {/* Action items in same card */}
          {meeting.actionItems && meeting.actionItems.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Action items</h4>
              <ul className="space-y-2">
                {meeting.actionItems.map((item, index) => (
                  <li key={index} className="flex gap-3 text-card-foreground">
                    <ListTodo className="flex-shrink-0 w-5 h-5 text-primary mt-0.5" />
                    <span className="leading-relaxed">
                      {item.text}
                      {item.assignee && <span className="text-muted-foreground text-sm ml-1">(→ {item.assignee})</span>}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Full Transcript */}
      <Card>
        <CardHeader>
          <CardTitle className="text-xl">Full Transcript</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-card-foreground leading-relaxed whitespace-pre-line">
            {meeting.transcript || 'No transcript available.'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
