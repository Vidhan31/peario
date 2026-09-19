import { showOpenFilePicker } from "@/lib/file-system";
import { logger } from "@/lib/logger";

interface FileSelectorProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
}

const FileSelector = ({ onFileSelect, disabled = false }: FileSelectorProps) => {
  const handleFileInputChange = async () => {
    try {
      const [handle] = await showOpenFilePicker({
        multiple: false,
      });

      if (!handle) {
        return;
      }

      const file = await handle.getFile();
      onFileSelect(file);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      logger.error("Failed to select file:", err);
    }
  };

  return (
    <div className="flex flex-col items-center space-y-2">
      <button
        onClick={() => {
          void handleFileInputChange();
        }}
        disabled={disabled}
        type="button"
        aria-label={disabled ? "Connect first to share files" : "Select file to share"}
        className="rounded-xl p-4 text-center transition-all hover:bg-muted/50 focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        <div className="flex flex-col items-center space-y-2">
          <svg
            aria-hidden="true"
            className="h-8 w-8 text-muted-foreground"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
            />
          </svg>

          <div>
            <p className="font-medium text-foreground text-sm">
              {disabled ? "Connect first to share files" : "Click to select file or drag and drop"}
            </p>
            <p className="mt-1 text-muted-foreground text-xs">Select a file to share its metadata</p>
          </div>
        </div>
      </button>
    </div>
  );
};

export default FileSelector;
