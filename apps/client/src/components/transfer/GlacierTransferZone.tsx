import { useCallback, useEffect, useRef, useState } from "react";
import { FiAlertTriangle, FiDownload, FiPause, FiPlay, FiUploadCloud, FiX } from "react-icons/fi";

import type { ProgressController } from "@/hooks/useProgressController";
import type { FileTransferRecord } from "@/types/FileTransferRecord";

import { useIsMobile } from "@/hooks/useIsMobile";
import { useSmoothProgress } from "@/hooks/useSmoothProgress";
import { showOpenFilePicker } from "@/lib/file-system";
import { logger } from "@/lib/logger";
import { formatBytes, formatProgressBytes, getFileBadge } from "@/utils/FileUtils";

interface ActiveTransferBarProps {
  activeTransfer: FileTransferRecord;
  selectedPeerName: string | null;
  progressController: ProgressController;
  isPaused: boolean;
  onPauseTransfer: () => void;
  onResumeTransfer: () => void;
  onCancelTransfer: () => void;
}

const GlacierActiveTransferBar = ({
  activeTransfer,
  selectedPeerName,
  progressController,
  isPaused,
  onPauseTransfer,
  onResumeTransfer,
  onCancelTransfer,
}: ActiveTransferBarProps) => {
  const isMobile = useIsMobile();
  const totalBytes = activeTransfer.fileMetadata.size;
  const isOutgoing = activeTransfer.direction === "outgoing";
  const progress = useSmoothProgress(activeTransfer.id, totalBytes, progressController);

  const [speedBytesPerSec, setSpeedBytesPerSec] = useState(0);
  const sampleRef = useRef<{ bytes: number; time: number } | null>(null);
  const speedRef = useRef(0);

  useEffect(() => {
    // Freeze the speed readout while user-paused so it doesn't decay or flicker.
    if (isPaused) return;
    const now = Date.now();
    const last = sampleRef.current;
    if (!last) {
      sampleRef.current = { bytes: progress.bytesTransferred, time: now };
      return;
    }
    const deltaTimeSec = (now - last.time) / 1000;
    // 250ms window + EMA keeps the speed readout stable instead of flickering.
    if (deltaTimeSec >= 0.25 && progress.bytesTransferred >= last.bytes) {
      const instant = (progress.bytesTransferred - last.bytes) / deltaTimeSec;
      const smoothed = speedRef.current === 0 ? instant : speedRef.current * 0.7 + instant * 0.3;
      speedRef.current = Math.max(0, Math.round(smoothed));
      sampleRef.current = { bytes: progress.bytesTransferred, time: now };
      setSpeedBytesPerSec((prev) => (prev === speedRef.current ? prev : speedRef.current));
    }
  }, [progress.bytesTransferred, activeTransfer.id, isPaused]);

  const percentage = totalBytes > 0 ? Math.min(Math.round((progress.bytesTransferred / totalBytes) * 100), 100) : 0;
  const { transferred: formattedTransferred, total: formattedTotal } = formatProgressBytes(
    progress.bytesTransferred,
    totalBytes,
  );

  const peerDisplayName = selectedPeerName ?? "Connected Peer";

  return (
    <div
      role="region"
      aria-label="Active transfer progress"
      className="w-full flex flex-col gap-4 p-5 rounded-2xl glass-elevated transition-all duration-300"
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-4 min-w-0">
          <div className="w-12 h-12 rounded-xl bg-surface-container-high text-primary flex items-center justify-center font-bold text-xs shrink-0 border border-outline-variant font-label shadow-sm">
            {getFileBadge(activeTransfer.fileMetadata.name)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs text-on-surface-variant truncate">
                {activeTransfer.direction === "outgoing" ? (
                  <>
                    Sending to <span className="text-on-surface font-medium">{peerDisplayName}</span>
                  </>
                ) : (
                  <>
                    Receiving from <span className="text-on-surface font-medium">{peerDisplayName}</span>
                  </>
                )}
              </span>
            </div>
            <h3
              className="text-base font-semibold text-on-surface font-headline truncate mt-0.5"
              title={activeTransfer.fileMetadata.name}
            >
              {activeTransfer.fileMetadata.name}
            </h3>
          </div>
        </div>

        <div className="text-right shrink-0">
          <span className="inline-block min-w-[4ch] text-right text-lg font-bold text-primary font-label tabular-nums tracking-wide">
            {percentage}%
          </span>
        </div>
      </div>

      {/* Progress Bar & Specs */}
      <div className="flex flex-col gap-1.5 pt-1">
        <div className="w-full bg-surface-container-lowest h-2 rounded-full overflow-hidden border border-outline-variant">
          <div
            className="h-full w-full origin-left rounded-full transition-transform duration-150 ease-linear will-change-transform bg-primary"
            style={{ transform: `scaleX(${percentage / 100})` }}
          />
        </div>
        <div className="flex justify-between items-center text-xs text-on-surface-variant">
          <div className="flex items-center gap-3">
            <span className="whitespace-nowrap font-mono tabular-nums text-[11px]">
              <span className="inline-block text-right" style={{ minWidth: `${formattedTotal.length}ch` }}>
                {formattedTransferred}
              </span>
              {` / ${formattedTotal}`}
            </span>
            {isPaused ? (
              <span
                role="status"
                className="inline-block font-semibold font-label text-[11px] text-amber-500 rounded-full bg-amber-500/10 border border-amber-500/30 px-2 py-0.5"
              >
                Paused — progress frozen
              </span>
            ) : (
              speedBytesPerSec > 0 && (
                <span className="inline-block min-w-[10ch] font-semibold font-label tabular-nums text-primary text-[11px]">
                  {formatBytes(speedBytesPerSec, 2, false)}/s
                </span>
              )
            )}
          </div>
        </div>
      </div>

      {/* Mobile warning when active */}
      {isMobile && (
        <div
          role="alert"
          className="flex items-start gap-2 px-3.5 py-2.5 rounded-xl bg-amber-500/10 border border-amber-500/25 text-xs text-amber-500 font-label"
        >
          <FiAlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span className="min-w-0 break-words">
            Keep this tab active. Backgrounding the browser on mobile will interrupt file transfers.
          </span>
        </div>
      )}

      {/* Sender controls: pause / resume / cancel (outgoing only) */}
      {isOutgoing && (
        <div className="flex items-center gap-2 pt-1" role="group" aria-label="Transfer controls">
          {isPaused ? (
            <button
              type="button"
              onClick={onResumeTransfer}
              aria-label={`Resume sending ${activeTransfer.fileMetadata.name}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground font-semibold text-xs font-label hover:bg-secondary transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 cursor-pointer"
            >
              <FiPlay className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Resume</span>
            </button>
          ) : (
            <button
              type="button"
              onClick={onPauseTransfer}
              aria-label={`Pause sending ${activeTransfer.fileMetadata.name}`}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-outline-variant bg-surface-container-high text-on-surface font-semibold text-xs font-label hover:border-primary/50 transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 cursor-pointer"
            >
              <FiPause className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Pause</span>
            </button>
          )}
          <button
            type="button"
            onClick={onCancelTransfer}
            aria-label={`Cancel sending ${activeTransfer.fileMetadata.name}`}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-500/30 text-red-400 font-semibold text-xs font-label hover:bg-red-500/10 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2 cursor-pointer"
          >
            <FiX className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Cancel</span>
          </button>
        </div>
      )}
    </div>
  );
};

interface GlacierTransferZoneProps {
  selectedPeerName: string | null;
  disabled?: boolean;
  isTransferInProgress?: boolean;
  isTransferPaused?: boolean;
  activeTransfer: FileTransferRecord | null;
  progressController: ProgressController;
  pendingFileRecord?: FileTransferRecord | null;
  pendingFileSenderName?: string | null;
  onPauseTransfer?: () => void;
  onResumeTransfer?: () => void;
  onCancelTransfer?: () => void;
  onAcceptFile?: () => void;
  onRejectFile?: () => void;
  onFileSelect: (file: File) => void;
}

export const GlacierTransferZone = ({
  selectedPeerName,
  disabled = false,
  isTransferInProgress = false,
  isTransferPaused = false,
  activeTransfer,
  progressController,
  pendingFileRecord = null,
  pendingFileSenderName = null,
  onPauseTransfer,
  onResumeTransfer,
  onCancelTransfer,
  onAcceptFile,
  onRejectFile,
  onFileSelect,
}: GlacierTransferZoneProps) => {
  const isMobile = useIsMobile();
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dropzoneRef = useRef<HTMLDivElement>(null);
  const wasInProgressRef = useRef(isTransferInProgress);

  useEffect(() => {
    // The Pause/Cancel controls just unmounted (cancel or completion). If
    // focus was on one of them it falls back to <body> — return it to the
    // dropzone so keyboard users stay in context.
    if (wasInProgressRef.current && !isTransferInProgress && document.activeElement === document.body) {
      dropzoneRef.current?.focus();
    }
    wasInProgressRef.current = isTransferInProgress;
  }, [isTransferInProgress]);

  const handlePickFile = useCallback(async () => {
    if (disabled || isTransferInProgress) return;
    try {
      const [handle] = await showOpenFilePicker({
        multiple: false,
      });
      if (!handle) return;
      const file = await handle.getFile();
      onFileSelect(file);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      logger.error("Failed to select file in transfer zone:", err);
    }
  }, [disabled, isTransferInProgress, onFileSelect]);

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    if (!disabled && !isTransferInProgress) {
      setIsDraggingOver(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    if (disabled || isTransferInProgress) return;

    const file = e.dataTransfer.files[0];
    if (file) {
      onFileSelect(file);
    }
  };

  return (
    <section className="relative group pb-2">
      {/* State 1: Active In-Progress Transfer */}
      {isTransferInProgress && activeTransfer ? (
        <GlacierActiveTransferBar
          key={activeTransfer.id}
          activeTransfer={activeTransfer}
          selectedPeerName={selectedPeerName}
          progressController={progressController}
          isPaused={isTransferPaused}
          onPauseTransfer={() => onPauseTransfer?.()}
          onResumeTransfer={() => onResumeTransfer?.()}
          onCancelTransfer={() => onCancelTransfer?.()}
        />
      ) : pendingFileRecord ? (
        /* State 2: Incoming file confirmation (replaces dropzone until accepted/declined) */
        <div
          role="region"
          aria-label="Incoming file confirmation"
          className="relative w-full py-6 px-4 sm:px-8 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-6 border border-outline-variant bg-surface-container/40 glass-panel"
        >
          <div className="flex items-center gap-5 text-center md:text-left flex-col md:flex-row min-w-0">
            <div className="w-12 h-12 rounded-xl bg-surface-container-high text-primary flex items-center justify-center font-bold text-xs shrink-0 border border-outline-variant font-label shadow-sm">
              {getFileBadge(pendingFileRecord.fileMetadata.name)}
            </div>
            <div className="min-w-0">
              <p className="text-xs text-on-surface-variant">
                Incoming file{pendingFileSenderName ? ` from ${pendingFileSenderName}` : ""}
              </p>
              <h3
                className="text-lg font-semibold text-on-surface font-headline truncate mt-0.5"
                title={pendingFileRecord.fileMetadata.name}
              >
                {pendingFileRecord.fileMetadata.name}
              </h3>
              <p className="text-sm text-on-surface-variant mt-1 flex items-center gap-2">
                <span className="font-mono text-[11px]">{formatBytes(pendingFileRecord.fileMetadata.size)}</span>
                <span className="text-primary text-[11px] font-label font-medium">Waiting for confirmation</span>
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {onRejectFile && (
              <button
                type="button"
                onClick={onRejectFile}
                aria-label="Decline File"
                className="px-3.5 py-2 rounded-xl hover:bg-surface-container text-xs font-medium text-on-surface-variant hover:text-on-surface transition-colors font-label cursor-pointer"
              >
                <FiX className="w-3.5 h-3.5 inline mr-1" aria-hidden="true" />
                Decline
              </button>
            )}
            {onAcceptFile && (
              <button
                type="button"
                onClick={onAcceptFile}
                aria-label="Download File"
                className="px-4 py-2 rounded-xl bg-primary hover:bg-secondary text-primary-foreground text-xs font-bold transition-colors flex items-center gap-1.5 font-label cursor-pointer shadow-sm"
              >
                <FiDownload className="w-3.5 h-3.5" aria-hidden="true" />
                Download File
              </button>
            )}
          </div>
        </div>
      ) : (
        /* State 3: Dropzone / Ready State */
        <div
          ref={dropzoneRef}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onClick={() => void handlePickFile()}
          role="button"
          tabIndex={disabled ? -1 : 0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              void handlePickFile();
            }
          }}
          aria-label={
            disabled
              ? "Connect to a peer to send files"
              : selectedPeerName
                ? `Send file to ${selectedPeerName}`
                : "Drop files here or browse to send"
          }
          className={`relative w-full py-6 px-4 sm:px-8 transition-all duration-200 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-6 cursor-pointer border ${
            isDraggingOver
              ? "border-primary bg-primary/10"
              : disabled
                ? "border-outline-variant/50 opacity-60 cursor-not-allowed bg-surface-container-low/40"
                : "border-outline-variant hover:border-primary/50 bg-surface-container/40 hover:bg-surface-container/60 glass-panel"
          }`}
        >
          <div className="flex items-center gap-5 text-center md:text-left flex-col md:flex-row">
            <div className="w-12 h-12 rounded-xl bg-surface-container-high text-primary flex items-center justify-center group-hover:scale-105 transition-transform shrink-0 border border-outline-variant">
              <FiUploadCloud className="w-6 h-6" aria-hidden="true" />
            </div>
            <div>
              <p className="text-lg font-semibold text-on-surface font-headline">
                Drop files here, or{" "}
                <span className="text-primary underline underline-offset-4 decoration-1 decoration-primary hover:text-secondary">
                  browse
                </span>
              </p>
              <p className="text-sm text-on-surface-variant mt-1">
                {selectedPeerName
                  ? `Files are sent directly to ${selectedPeerName}`
                  : disabled
                    ? "Connect to a peer below to start sharing files"
                    : "Files are sent directly to your connected peers"}
              </p>
              {isMobile && (
                <p className="text-xs text-amber-500/90 flex items-start gap-1.5 font-label mt-2">
                  <FiAlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" aria-hidden="true" />
                  <span className="min-w-0 break-words">On mobile, keep this browser tab active during transfers.</span>
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={disabled}
              onClick={(e) => {
                e.stopPropagation();
                void handlePickFile();
              }}
              aria-label="Send File"
              className="px-4 py-2 rounded-xl bg-primary text-primary-foreground font-semibold text-xs font-label hover:bg-secondary transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm cursor-pointer"
            >
              Send File
            </button>
          </div>
        </div>
      )}
    </section>
  );
};

GlacierTransferZone.displayName = "GlacierTransferZone";
export default GlacierTransferZone;
