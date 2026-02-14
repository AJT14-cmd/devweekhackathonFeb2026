import { Upload, FileAudio } from "lucide-react";
import { useCallback } from "react";

interface AudioUploaderProps {
  onFileSelect: (file: File) => void;
  isProcessing: boolean;
}

export function AudioUploader({ onFileSelect, isProcessing }: AudioUploaderProps) {
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    
    const files = e.dataTransfer.files;
    if (files && files[0]) {
      const file = files[0];
      if (file.type.startsWith('audio/')) {
        onFileSelect(file);
      }
    }
  }, [onFileSelect]);

  const handleFileInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files[0]) {
      onFileSelect(files[0]);
    }
  }, [onFileSelect]);

  return (
    <div
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="border-2 border-dashed border-gray-300 rounded-lg p-12 text-center hover:border-blue-400 transition-colors cursor-pointer"
    >
      <input
        type="file"
        id="audio-upload"
        accept="audio/*"
        onChange={handleFileInput}
        className="hidden"
        disabled={isProcessing}
      />
      <label htmlFor="audio-upload" className="cursor-pointer block">
        <div className="flex flex-col items-center gap-4">
          <div className="p-4 bg-blue-50 rounded-full">
            <Upload className="w-12 h-12 text-blue-500" />
          </div>
          <div>
            <p className="text-lg text-gray-700 mb-2">
              {isProcessing ? 'Processing...' : 'Drop your audio file here or click to browse'}
            </p>
            <p className="text-sm text-gray-500">
              Supports MP3, WAV, M4A, and other audio formats
            </p>
          </div>
        </div>
      </label>
    </div>
  );
}
