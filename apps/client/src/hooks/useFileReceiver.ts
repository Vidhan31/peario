import type { PeerId } from "@peario/shared";

import { useCallback, useRef, useState } from "react";

import type { ProgressController } from "@/hooks/useProgressController";
import type { IncomingTransferSession } from "@/lib/webrtc/FileTransferEngine";
import type { FileTransferRecord } from "@/types/FileTransferRecord";

import { showSaveFilePicker } from "@/lib/file-system";
import { fileLogger } from "@/lib/logger";

interface UseFileReceiverOptions {
  peerId: PeerId | null;
  progressController: ProgressController;
  onIncomingRecord: (record: FileTransferRecord) => void;
  onRecordTransferring: (recordId: string | null) => void;
  onRecordCompleted: (recordId: string | null) => void;
  onRecordFailed: (recordId: string | null, error: unknown) => void;
  onError: (title: string, message: string) => void;
}

/**
 * Assembles incoming file chunks and streams them to disk via the File System
 * Access API. Owns the pending incoming session until it is accepted.
 */
export function useFileReceiver({
  peerId,
  progressController,
  onIncomingRecord,
  onRecordTransferring,
  onRecordCompleted,
  onRecordFailed,
  onError,
}: UseFileReceiverOptions) {
  const [isReceivingInProgress, setIsReceivingInProgress] = useState(false);

  const activeIncomingSessionRef = useRef<IncomingTransferSession | null>(null);
  const activeIncomingRecordIdRef = useRef<string | null>(null);

  // React Compiler v1 cannot compile try...finally. Manual useCallback prevents effect loops upstream.
  const registerIncomingSession = useCallback(
    (session: IncomingTransferSession, sessionPeerId: PeerId) => {
      activeIncomingSessionRef.current = session;

      const recordId = `file-${crypto.randomUUID()}`;
      activeIncomingRecordIdRef.current = recordId;

      onIncomingRecord({
        id: recordId,
        peerId: sessionPeerId,
        fileMetadata: session.metadata,
        direction: "incoming",
        status: "pending_acceptance",
        timestamp: Date.now(),
      });
    },
    [onIncomingRecord],
  );

  const clearSession = useCallback(() => {
    activeIncomingSessionRef.current = null;
    activeIncomingRecordIdRef.current = null;
  }, []);

  const rejectFile = useCallback((reason?: string) => {
    const session = activeIncomingSessionRef.current;
    const recordId = activeIncomingRecordIdRef.current;
    try {
      session?.reject(reason ?? "Receiver declined");
    } catch (error) {
      fileLogger.debug("[FileTransfer] rejectFile: session reject failed", error);
    }
    activeIncomingSessionRef.current = null;
    activeIncomingRecordIdRef.current = null;
    return recordId;
  }, []);

  const acceptFile = useCallback(async () => {
    const session = activeIncomingSessionRef.current;
    const recordId = activeIncomingRecordIdRef.current;
    if (!session || !peerId) return;

    try {
      const fileHandle = await showSaveFilePicker({
        suggestedName: session.metadata.name,
      }).catch(() => {
        fileLogger.debug("File save dialog cancelled");
        return null;
      });

      if (!fileHandle) {
        return;
      }

      const writable = await fileHandle.createWritable(
        session.metadata.size > 0 ? { size: session.metadata.size } : undefined,
      );

      fileLogger.debug("[FileTransfer] acceptFile: starting receive");
      setIsReceivingInProgress(true);

      onRecordTransferring(recordId);

      const swKeepAlive = setInterval(() => {
        try {
          if (typeof navigator !== "undefined" && "serviceWorker" in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({ type: "ping" });
          }
        } catch {
          // Ignore
        }
      }, 5000);

      try {
        await session.accept(writable, {
          onProgress: (progress) => {
            if (recordId) {
              progressController.emit(recordId, {
                bytesTransferred: progress.bytesTransferred,
                bytesBuffered: 0,
                timestamp: progress.timestamp,
              });
            }
          },
        });
      } finally {
        clearInterval(swKeepAlive);
      }

      fileLogger.debug("[FileTransfer] session.accept completed");

      onRecordCompleted(recordId);
      if (recordId) progressController.clear(recordId);
      activeIncomingSessionRef.current = null;
      activeIncomingRecordIdRef.current = null;
    } catch (error) {
      fileLogger.error("[FileTransfer] Error receiving file:", error);
      onError("Receive Failed", `Failed to receive file: ${error instanceof Error ? error.message : "Unknown error"}`);
      onRecordFailed(recordId, error);
      if (recordId) progressController.clear(recordId);
    } finally {
      fileLogger.debug("[FileTransfer] acceptFile: finished, resetting isReceivingInProgress");
      setIsReceivingInProgress(false);
    }
  }, [peerId, progressController, onRecordTransferring, onRecordCompleted, onRecordFailed, onError]);

  return { registerIncomingSession, acceptFile, rejectFile, isReceivingInProgress, clearSession };
}
