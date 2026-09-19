import { use } from "react";
import { FiAlertCircle, FiArrowDownLeft, FiArrowUpRight, FiCheckCircle, FiPause, FiPlay, FiX } from "react-icons/fi";

import type { FileTransferRecord } from "@/types/FileTransferRecord";

import { TransferContext } from "@/contexts/TransferContext";
import { formatBytes, getFileIcon } from "@/utils/FileUtils";

import { FileProgressBar } from "./FileProgressBar";

interface TransferCardProps {
  record: FileTransferRecord;
}

export const TransferCard = ({ record }: TransferCardProps) => {
  const transferContext = use(TransferContext);
  if (!transferContext) {
    throw new Error("TransferContext is not available");
  }
  const { onAcceptFile, onPauseFile, onResumeFile, onCancelFile, isOutgoingPaused } = transferContext;

  const { fileMetadata, direction, status, timestamp, error } = record;
  const isOutgoing = direction === "outgoing";
  const isPaused = isOutgoing && (status === "paused" || isOutgoingPaused);
  const isActiveOutgoing = isOutgoing && (status === "transferring" || status === "paused");
  // eslint-disable-next-line @eslint-react/static-components
  const FileIcon = getFileIcon(fileMetadata.name);

  const formattedTime = new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      className={`flex w-full ${isOutgoing ? "justify-end" : "justify-start"} animate-in slide-in-from-bottom-2 duration-300`}
    >
      <div
        className={`relative w-full max-w-md rounded-2xl p-4 shadow-md transition-all ${
          isOutgoing
            ? "bg-primary text-primary-foreground rounded-tr-sm"
            : "bg-muted/80 text-foreground rounded-tl-sm ring-1 ring-border backdrop-blur-sm"
        }`}
      >
        <div className="flex items-start gap-3">
          <div
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl ${
              isOutgoing ? "bg-primary-foreground/20" : "bg-primary/10"
            }`}
          >
            {/* eslint-disable-next-line react-hooks/static-components, @eslint-react/static-components -- FileIcon is a stable module-level icon component; no state reset can occur */}
            <FileIcon
              aria-hidden="true"
              className={`h-6 w-6 ${isOutgoing ? "text-primary-foreground" : "text-primary"}`}
            />
          </div>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              {isOutgoing ? (
                <FiArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 text-primary-foreground/80 shrink-0" />
              ) : (
                <FiArrowDownLeft aria-hidden="true" className="h-3.5 w-3.5 text-primary shrink-0" />
              )}
              <span
                className={`text-[11px] font-medium uppercase tracking-wider ${isOutgoing ? "text-primary-foreground/80" : "text-muted-foreground"}`}
              >
                {isOutgoing ? "Sent" : "Received"}
              </span>
            </div>

            <p className="truncate font-semibold text-sm mt-0.5" title={fileMetadata.name}>
              {fileMetadata.name}
            </p>

            <p className={`text-xs mt-0.5 ${isOutgoing ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
              {formatBytes(fileMetadata.size)}
            </p>
          </div>
        </div>

        {(status === "transferring" || status === "paused") && (
          <FileProgressBar transferId={record.id} totalBytes={fileMetadata.size} isOutgoing={isOutgoing} />
        )}

        {isPaused && (
          <div
            role="status"
            className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5 text-[11px] font-semibold text-amber-500"
          >
            Paused — progress frozen
          </div>
        )}

        {isActiveOutgoing && (
          <div className="mt-3 flex items-center gap-2" role="group" aria-label="Transfer controls">
            {isPaused ? (
              <button
                type="button"
                onClick={onResumeFile}
                aria-label={`Resume sending ${fileMetadata.name}`}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-semibold text-[11px] text-primary-foreground transition-all hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 active:scale-[0.98]"
              >
                <FiPlay aria-hidden="true" className="h-3.5 w-3.5" />
                <span>Resume</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onPauseFile}
                aria-label={`Pause sending ${fileMetadata.name}`}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold text-[11px] transition-all bg-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/30 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 active:scale-[0.98]"
              >
                <FiPause aria-hidden="true" className="h-3.5 w-3.5" />
                <span>Pause</span>
              </button>
            )}
            <button
              type="button"
              onClick={onCancelFile}
              aria-label={`Cancel sending ${fileMetadata.name}`}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 font-semibold text-[11px] text-red-500 transition-all hover:bg-red-500/10 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 active:scale-[0.98]"
            >
              <FiX aria-hidden="true" className="h-3.5 w-3.5" />
              <span>Cancel</span>
            </button>
          </div>
        )}

        {status === "pending_acceptance" && !isOutgoing && (
          <div className="mt-3">
            <button
              type="button"
              onClick={onAcceptFile}
              className="w-full rounded-xl bg-primary px-4 py-2.5 font-semibold text-xs text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 active:scale-[0.98]"
            >
              Download File
            </button>
          </div>
        )}

        {status === "completed" && (
          <div
            className={`mt-2 flex items-center gap-1.5 text-xs ${isOutgoing ? "text-primary-foreground/90" : "text-evergreen-500"}`}
          >
            <FiCheckCircle aria-hidden="true" className="h-3.5 w-3.5" />
            <span className="font-medium">Transfer complete</span>
          </div>
        )}

        {status === "failed" && (
          <div role="alert" className="mt-2 flex items-center gap-1.5 text-xs text-red-500">
            <FiAlertCircle aria-hidden="true" className="h-3.5 w-3.5" />
            {/* eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- blank error should render the generic failure message */}
            <span className="font-medium">{error || "Transfer failed"}</span>
          </div>
        )}

        <p
          className={`mt-2 text-right text-[10px] ${isOutgoing ? "text-primary-foreground/70" : "text-muted-foreground"}`}
        >
          <span className="sr-only">Transfer timestamp: </span>
          {formattedTime}
        </p>
      </div>
    </div>
  );
};

TransferCard.displayName = "TransferCard";
