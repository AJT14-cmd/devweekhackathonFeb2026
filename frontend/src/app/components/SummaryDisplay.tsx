import { FileText, Clock, Hash } from "lucide-react";

interface SummaryData {
  transcript: string;
  summary: string;
  keyPoints: string[];
  duration: string;
  wordCount: number;
}

interface SummaryDisplayProps {
  summary: SummaryData;
}

export function SummaryDisplay({ summary }: SummaryDisplayProps) {
  return (
    <div className="space-y-6">
      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-blue-50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <Clock className="w-4 h-4 text-blue-600" />
            <span className="text-sm text-gray-600">Duration</span>
          </div>
          <p className="text-xl text-gray-900">{summary.duration}</p>
        </div>
        <div className="bg-purple-50 rounded-lg p-4">
          <div className="flex items-center gap-2 mb-1">
            <Hash className="w-4 h-4 text-purple-600" />
            <span className="text-sm text-gray-600">Words</span>
          </div>
          <p className="text-xl text-gray-900">{summary.wordCount}</p>
        </div>
      </div>

      {/* Summary */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="flex items-center gap-2 mb-4">
          <FileText className="w-5 h-5 text-blue-600" />
          <h3 className="text-lg text-gray-900">Summary</h3>
        </div>
        <p className="text-gray-700 leading-relaxed">{summary.summary}</p>
      </div>

      {/* Key Points */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg text-gray-900 mb-4">Key Points</h3>
        <ul className="space-y-3">
          {summary.keyPoints.map((point, index) => (
            <li key={index} className="flex gap-3">
              <span className="flex-shrink-0 w-6 h-6 bg-blue-100 text-blue-600 rounded-full flex items-center justify-center text-sm">
                {index + 1}
              </span>
              <span className="text-gray-700">{point}</span>
            </li>
          ))}
        </ul>
      </div>

      {/* Full Transcript */}
      <div className="bg-white rounded-lg shadow-md p-6">
        <h3 className="text-lg text-gray-900 mb-4">Full Transcript</h3>
        <div className="prose max-w-none">
          <p className="text-gray-700 leading-relaxed whitespace-pre-line">
            {summary.transcript}
          </p>
        </div>
      </div>
    </div>
  );
}
