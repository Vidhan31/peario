import type { PeerId } from "@peario/shared";

import { use, useMemo } from "react";

import { PeerConnectionContext } from "@/contexts/PeerConnectionContext";
import { TransferContext } from "@/contexts/TransferContext";
import { useFileTransfer } from "@/hooks/useFileTransfer";

import { MessageListErrorBoundary } from "../error/MessageListErrorBoundary";
import { TransferActionBar } from "./TransferActionBar";
import { TransferHeader } from "./TransferHeader";
import { TransferList } from "./TransferList";

interface TransferPanelProps {
  peerId: PeerId;
  peerName: string;
}

export const TransferPanel = ({ peerId, peerName }: TransferPanelProps) => {
  const peerManagerContext = use(PeerConnectionContext);
  if (!peerManagerContext) {
    throw new Error("PeerConnectionContext is not available");
  }
  const { connectionStates } = peerManagerContext;

  const connectionState = peerId ? connectionStates.get(peerId) : undefined;
  const {
    transfers,
    sendFile,
    acceptFile,
    hasPendingFile,
    isTransferInProgress,
    isOutgoingPaused,
    pauseSending,
    resumeSending,
    cancelSending,
    progressController,
  } = useFileTransfer(peerId);

  const transferContextValue = useMemo(
    () => ({
      progressController,
      onAcceptFile: acceptFile,
      onPauseFile: pauseSending,
      onResumeFile: resumeSending,
      onCancelFile: cancelSending,
      isOutgoingPaused,
    }),
    [progressController, acceptFile, pauseSending, resumeSending, cancelSending, isOutgoingPaused],
  );

  const isConnected = connectionState === "connected";
  const disabled = !isConnected || hasPendingFile;

  return (
    <TransferContext value={transferContextValue}>
      <div className="flex h-full w-full flex-col overflow-hidden lg:border lg:border-border lg:bg-muted/40 lg:shadow-xl lg:backdrop-blur-md transition-all bg-background">
        <TransferHeader peerName={peerName} />
        <MessageListErrorBoundary resetKeys={[peerId, transfers.length]}>
          <TransferList records={transfers} />
        </MessageListErrorBoundary>
        <TransferActionBar
          onFileSelect={(file) => {
            void sendFile(file);
          }}
          disabled={disabled}
          isTransferInProgress={isTransferInProgress}
          isTransferPaused={isOutgoingPaused}
        />
      </div>
    </TransferContext>
  );
};

TransferPanel.displayName = "TransferPanel";
export default TransferPanel;
