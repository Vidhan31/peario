import type { PeerId } from "@peario/shared";

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { IncomingTransferSession } from "../lib/webrtc/FileTransferEngine";
import type { FileTransferRecord } from "../types/FileTransferRecord";

import { PeerConnectionContext } from "../contexts/PeerConnectionContext";
import { ToastContext } from "../contexts/ToastContext";
import { fileLogger } from "../lib/logger";
import { useFileReceiver } from "./useFileReceiver";
import { useFileSender } from "./useFileSender";
import { useProgressController } from "./useProgressController";
import { useTransferTransport } from "./useTransferTransport";

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

/**
 * Drops unaccepted incoming offers from one peer. Returns the SAME array
 * reference when nothing matches so setState bails out instead of minting a
 * new identity (same render-loop rationale as failStuckOutgoingRecords).
 */
export function removePendingIncomingForPeer(prev: FileTransferRecord[], peerId: PeerId | null): FileTransferRecord[] {
  if (!peerId) return prev;
  const hasPending = prev.some(
    (rec) => rec.direction === "incoming" && rec.status === "pending_acceptance" && rec.peerId === peerId,
  );
  if (!hasPending) return prev;
  return prev.filter(
    (rec) => !(rec.direction === "incoming" && rec.status === "pending_acceptance" && rec.peerId === peerId),
  );
}

/**
 * Marks stuck outgoing records failed on disconnect. Returns the SAME array
 * reference when nothing matches so setState bails out instead of minting a
 * new identity: a new array every effect run would re-render Pear and its
 * whole subtree even when nothing changed (self-sustaining render loop when
 * combined with unstable effect deps).
 */
export function failStuckOutgoingRecords(prev: FileTransferRecord[]): FileTransferRecord[] {
  const stuckIds = new Set(
    prev
      .filter((rec) => rec.direction === "outgoing" && (rec.status === "transferring" || rec.status === "paused"))
      .map((rec) => rec.id),
  );
  if (stuckIds.size === 0) return prev;
  return prev.map((rec) =>
    stuckIds.has(rec.id) ? { ...rec, status: "failed" as const, error: "Peer disconnected" } : rec,
  );
}

export function useFileTransfer(selectedPeerId: PeerId | null) {
  const [transfers, setTransfers] = useState<FileTransferRecord[]>([]);

  const progressController = useProgressController();
  const toastContext = use(ToastContext);
  // NOTE: ref-backed stable callbacks, not useEffectEvent, on purpose.
  // notifyError and notifyInfo run from click handlers and are passed to
  // other hooks, while Effect Events may only be called from Effects in the
  // same component and must not be passed down.
  const toastContextRef = useRef(toastContext);
  useEffect(() => {
    toastContextRef.current = toastContext;
  }, [toastContext]);

  const peerManagerContext = use(PeerConnectionContext);
  if (!peerManagerContext) {
    throw new Error("PeerConnectionContext is not available");
  }
  const { getDataChannel, waitForChannel, connectionStates } = peerManagerContext;
  const selectedPeerConnectionState = selectedPeerId ? connectionStates.get(selectedPeerId) : undefined;

  const hasPendingFile = useMemo(
    () => transfers.some((t) => t.status === "pending_acceptance" && t.direction === "incoming"),
    [transfers],
  );

  // Mirror for the transport control listener below, which runs outside render.
  const hasPendingRef = useRef(false);
  useEffect(() => {
    hasPendingRef.current = hasPendingFile;
  }, [hasPendingFile]);

  const notifyError = useCallback((title: string, message: string) => {
    toastContextRef.current?.addToast({ type: "error", title, message });
  }, []);

  const notifyInfo = useCallback((title: string, message: string) => {
    toastContextRef.current?.addToast({ type: "info", title, message });
  }, []);

  const addRecord = useCallback((record: FileTransferRecord) => {
    setTransfers((prev) => [...prev, record]);
  }, []);

  const addIncomingRecord = useCallback((record: FileTransferRecord) => {
    setTransfers((prev) => {
      const hasPending = prev.some((t) => t.status === "pending_acceptance" && t.direction === "incoming");
      if (!hasPending) {
        return [...prev, record];
      }
      return prev;
    });
  }, []);

  const markTransferring = useCallback((recordId: string | null) => {
    if (!recordId) return;
    setTransfers((prev) => prev.map((rec) => (rec.id === recordId ? { ...rec, status: "transferring" } : rec)));
  }, []);

  const markPaused = useCallback((recordId: string | null) => {
    if (!recordId) return;
    setTransfers((prev) => prev.map((rec) => (rec.id === recordId ? { ...rec, status: "paused" } : rec)));
  }, []);

  const removeRecord = useCallback((recordId: string | null) => {
    if (!recordId) return;
    setTransfers((prev) => prev.filter((rec) => rec.id !== recordId));
  }, []);

  const markCompleted = useCallback((recordId: string | null) => {
    if (!recordId) return;
    setTransfers((prev) => prev.map((rec) => (rec.id === recordId ? { ...rec, status: "completed" } : rec)));
  }, []);

  const markFailed = useCallback((recordId: string | null, error: unknown) => {
    if (!recordId) return;
    setTransfers((prev) =>
      prev.map((rec) =>
        rec.id === recordId ? { ...rec, status: "failed", error: toErrorMessage(error, "Transfer failed") } : rec,
      ),
    );
  }, []);

  const {
    registerIncomingSession,
    acceptFile,
    rejectFile: rejectReceiverFile,
    isReceivingInProgress,
    clearSession,
  } = useFileReceiver({
    peerId: selectedPeerId,
    progressController,
    onIncomingRecord: addIncomingRecord,
    onRecordTransferring: markTransferring,
    onRecordCompleted: markCompleted,
    onRecordFailed: markFailed,
    onError: notifyError,
  });

  useEffect(() => {
    if (selectedPeerConnectionState !== "connected") {
      clearSession();
      // Never leave records bound to the torn-down transport: fail stuck
      // outgoing transfers visibly (the in-flight sendFile settles to the same
      // failed state; this is idempotent), and drop unaccepted offers —
      // accepting one later would signal a sender that is no longer listening
      // and wedge the UI at 0%. Both helpers return the same array reference
      // when nothing matches so setState bails out instead of re-rendering.
      // eslint-disable-next-line react-hooks/set-state-in-effect, @eslint-react/set-state-in-effect -- intentional reset when disconnected; mirrors transport teardown
      setTransfers((prev) => failStuckOutgoingRecords(removePendingIncomingForPeer(prev, selectedPeerId)));
    }
  }, [selectedPeerConnectionState, clearSession, selectedPeerId]);

  const handleIncomingOffer = useCallback(
    (session: IncomingTransferSession) => {
      if (!selectedPeerId) return;
      registerIncomingSession(session, selectedPeerId);
    },
    [registerIncomingSession, selectedPeerId],
  );

  const handleTransportError = useCallback(
    (error: unknown) => {
      fileLogger.error(`[FileTransfer] Transport error for peer ${selectedPeerId}:`, error);
      notifyError("Connection Error", "Failed to establish file transfer channel.");
    },
    [notifyError, selectedPeerId],
  );

  const engine = useTransferTransport({
    peerId: selectedPeerId,
    connectionState: selectedPeerConnectionState,
    getDataChannel,
    waitForChannel,
    onIncomingOffer: handleIncomingOffer,
    onError: handleTransportError,
  });

  const { sendFile, isSendingInProgress, isOutgoingPaused, pauseSending, resumeSending, cancelSending } = useFileSender(
    {
      engine,
      peerId: selectedPeerId,
      progressController,
      onRecordAdded: addRecord,
      onRecordCompleted: markCompleted,
      onRecordFailed: markFailed,
      onRecordPaused: markPaused,
      onRecordResumed: markTransferring,
      onRecordRemoved: removeRecord,
      onError: notifyError,
    },
  );

  const isTransferInProgress = isSendingInProgress || isReceivingInProgress;

  // The sender waits indefinitely for accept now, but it can still go away
  // first (user cancel, error, disconnect). Its cancel/error arrives on the
  // same control channel; dismiss the unaccepted offer so the Download button
  // goes away and the dropzone restores. Mid-transfer cancel/error is owned
  // by the receiver session, which is why this only touches pending offers.
  useEffect(() => {
    if (!engine || !selectedPeerId) return;
    const peerId = selectedPeerId;
    return engine.transport.onFileControl((ctrl) => {
      if (ctrl.kind !== "cancel" && ctrl.kind !== "error") return;
      if (!hasPendingRef.current) return;
      hasPendingRef.current = false;
      clearSession();
      setTransfers((prev) => removePendingIncomingForPeer(prev, peerId));
      if (ctrl.kind === "cancel") {
        notifyInfo(
          "Offer withdrawn",
          ctrl.reason ? `The sender withdrew the file offer: ${ctrl.reason}.` : "The sender withdrew the file offer.",
        );
      } else {
        notifyInfo("Offer failed", `The sender reported an error: ${ctrl.message}.`);
      }
    });
  }, [engine, selectedPeerId, clearSession, notifyInfo]);

  const activeOutgoingRecord = useMemo(
    () =>
      transfers.find((t) => t.direction === "outgoing" && (t.status === "transferring" || t.status === "paused")) ??
      null,
    [transfers],
  );

  const handlePauseSending = useCallback(() => {
    const name = activeOutgoingRecord?.fileMetadata.name;
    pauseSending();
    notifyInfo("Transfer paused", name ? `"${name}" paused — progress frozen.` : "Transfer paused.");
  }, [activeOutgoingRecord, pauseSending, notifyInfo]);

  const handleResumeSending = useCallback(() => {
    const name = activeOutgoingRecord?.fileMetadata.name;
    resumeSending();
    notifyInfo("Transfer resumed", name ? `"${name}" resumed.` : "Transfer resumed.");
  }, [activeOutgoingRecord, resumeSending, notifyInfo]);

  const handleCancelSending = useCallback(() => {
    const name = activeOutgoingRecord?.fileMetadata.name;
    cancelSending();
    notifyInfo("Transfer cancelled", name ? `"${name}" cancelled and removed.` : "Transfer cancelled.");
  }, [activeOutgoingRecord, cancelSending, notifyInfo]);

  const rejectFile = useCallback(() => {
    const recordId = rejectReceiverFile("Receiver declined the file offer.");
    if (recordId) {
      removeRecord(recordId);
    } else {
      setTransfers((prev) => removePendingIncomingForPeer(prev, selectedPeerId));
    }
    notifyInfo("Offer declined", "The incoming file offer was declined.");
  }, [rejectReceiverFile, removeRecord, selectedPeerId, notifyInfo]);

  return {
    transfers,
    sendFile,
    acceptFile,
    rejectFile,
    hasPendingFile,
    isTransferInProgress,
    isOutgoingPaused,
    pauseSending: handlePauseSending,
    resumeSending: handleResumeSending,
    cancelSending: handleCancelSending,
    progressController,
  };
}
