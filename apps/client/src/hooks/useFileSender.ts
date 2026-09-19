import type { PeerId } from "@peario/shared";

import { useCallback, useRef, useState } from "react";

import type { ProgressController } from "@/hooks/useProgressController";
import type { FileTransferEngine } from "@/lib/webrtc/FileTransferEngine";
import type { FileMetadata } from "@/types/FileMetadata";
import type { FileTransferRecord } from "@/types/FileTransferRecord";

import { fileLogger } from "@/lib/logger";

interface UseFileSenderOptions {
  engine: FileTransferEngine | null;
  peerId: PeerId | null;
  progressController: ProgressController;
  onRecordAdded: (record: FileTransferRecord) => void;
  onRecordCompleted: (recordId: string) => void;
  onRecordFailed: (recordId: string, error: unknown) => void;
  onRecordPaused: (recordId: string) => void;
  onRecordResumed: (recordId: string) => void;
  onRecordRemoved: (recordId: string) => void;
  onError: (title: string, message: string) => void;
}

/**
 * Sends outgoing files through the transfer engine with backpressure-aware
 * progress emission. Tracks whether a send is currently in flight and exposes
 * sender-side pause / resume / cancel controls for the website UI.
 *
 * Pause is purely local: it engages the engine's user gate and freezes the
 * chunk pipeline. The receiver simply idles (no chunks arrive) and needs no
 * UI change. Cancel aborts the pipeline, notifies the receiver via the
 * existing `cancel` control message, and removes the record.
 */
export function useFileSender({
  engine,
  peerId,
  progressController,
  onRecordAdded,
  onRecordCompleted,
  onRecordFailed,
  onRecordPaused,
  onRecordResumed,
  onRecordRemoved,
  onError,
}: UseFileSenderOptions) {
  const [isSendingInProgress, setIsSendingInProgress] = useState(false);
  const [isOutgoingPaused, setIsOutgoingPaused] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const activeRecordIdRef = useRef<string | null>(null);

  // React Compiler v1 cannot compile try...finally. Manual useCallback prevents re-rendering transfer subtree on each commit.
  const sendFile = useCallback(
    async (file: File) => {
      if (!peerId) return;

      if (!engine) {
        fileLogger.error("[FileTransfer] Engine not initialized");
        onError("Transfer Error", "Peer connection not ready for file transfer.");
        return;
      }

      const metadata: FileMetadata = {
        name: file.name,
        size: file.size,
        type: file.type || "application/octet-stream",
      };

      const recordId = `file-${crypto.randomUUID()}`;
      onRecordAdded({
        id: recordId,
        peerId,
        fileMetadata: metadata,
        direction: "outgoing",
        status: "transferring",
        timestamp: Date.now(),
      });
      setIsSendingInProgress(true);
      setIsOutgoingPaused(false);

      const abortController = new AbortController();
      abortRef.current = abortController;
      activeRecordIdRef.current = recordId;

      try {
        await engine.sendFile(file, {
          signal: abortController.signal,
          onProgress: (progress) => {
            progressController.emit(recordId, {
              bytesTransferred: progress.bytesTransferred,
              bytesBuffered: progress.bytesBuffered,
              timestamp: progress.timestamp,
            });
          },
        });

        onRecordCompleted(recordId);
        progressController.clear(recordId);
      } catch (error) {
        // User-initiated cancel removes the card instead of showing a failure.
        if (abortController.signal.aborted) {
          fileLogger.debug(`[FileTransfer] Send cancelled by user: ${file.name}`);
          progressController.clear(recordId);
          onRecordRemoved(recordId);
          return;
        }
        fileLogger.error(`[FileTransfer] Error sending file to peer ${peerId}:`, error);
        onError(
          "Transfer Failed",
          `Failed to send "${file.name}": ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        onRecordFailed(recordId, error);
        progressController.clear(recordId);
      } finally {
        abortRef.current = null;
        activeRecordIdRef.current = null;
        setIsSendingInProgress(false);
        setIsOutgoingPaused(false);
      }
    },
    [engine, peerId, progressController, onRecordAdded, onRecordCompleted, onRecordFailed, onRecordRemoved, onError],
  );

  const pauseSending = useCallback(() => {
    const recordId = activeRecordIdRef.current;
    if (!recordId || !engine || isOutgoingPaused) return;
    engine.pauseSending();
    setIsOutgoingPaused(true);
    onRecordPaused(recordId);
  }, [engine, isOutgoingPaused, onRecordPaused]);

  const resumeSending = useCallback(() => {
    const recordId = activeRecordIdRef.current;
    if (!recordId || !engine || !isOutgoingPaused) return;
    engine.resumeSending();
    setIsOutgoingPaused(false);
    onRecordResumed(recordId);
  }, [engine, isOutgoingPaused, onRecordResumed]);

  const cancelSending = useCallback(() => {
    if (!abortRef.current || !activeRecordIdRef.current) return;
    // Aborting the signal makes the engine send `cancel` to the receiver and
    // reject; the catch block above then clears progress and removes the card.
    abortRef.current.abort(new DOMException("Cancelled by user", "AbortError"));
  }, []);

  return { sendFile, isSendingInProgress, isOutgoingPaused, pauseSending, resumeSending, cancelSending };
}
