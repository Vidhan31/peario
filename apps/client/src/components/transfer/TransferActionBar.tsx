import { FiPaperclip } from "react-icons/fi";

import { showOpenFilePicker } from "@/lib/file-system";
import { logger } from "@/lib/logger";

interface TransferActionBarProps {
  onFileSelect: (file: File) => void;
  disabled?: boolean;
  isTransferInProgress?: boolean;
  isTransferPaused?: boolean;
}

export const TransferActionBar = ({
  onFileSelect,
  disabled = false,
  isTransferInProgress = false,
  isTransferPaused = false,
}: TransferActionBarProps) => {
  const isFilePickerDisabled = disabled || isTransferInProgress;

  const handleFileSelect = async () => {
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
      logger.error("Failed to select file in action bar:", err);
    }
  };

  return (
    <div className="border-t border-border bg-muted/20 p-4 backdrop-blur-md">
      <div className="flex items-center justify-between gap-4 max-w-2xl mx-auto">
        <div className="flex-1 text-sm text-muted-foreground truncate" role="status" aria-live="polite">
          {isTransferPaused ? (
            <span className="flex items-center gap-2 text-amber-500 font-medium">
              <span className="block h-2 w-2 rounded-full bg-amber-500" aria-hidden="true" />
              <span className="sr-only">Transfer paused: </span>
              Transfer paused — resume or cancel to continue.
            </span>
          ) : isTransferInProgress ? (
            <span className="flex items-center gap-2 text-primary font-medium animate-pulse">
              <span className="block h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
              <span className="sr-only">Transfer active: </span>
              Transfer in progress...
            </span>
          ) : disabled ? (
            <span>Waiting for peer connection...</span>
          ) : (
            <span>Ready to send files peer-to-peer.</span>
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            void handleFileSelect();
          }}
          disabled={isFilePickerDisabled}
          aria-label="Send file"
          className="group flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 font-semibold text-sm text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 hover:scale-[1.02] active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-muted disabled:shadow-none disabled:text-muted-foreground"
        >
          <FiPaperclip size={18} aria-hidden="true" className="transition-transform group-hover:rotate-12" />
          <span>Send File</span>
        </button>
      </div>
    </div>
  );
};

TransferActionBar.displayName = "TransferActionBar";
