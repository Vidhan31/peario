import type { Peer } from "@peario/shared";

import { use, useCallback, useEffect, useMemo, useRef } from "react";
import { FiAlertTriangle, FiShield } from "react-icons/fi";

import { PeerConnectionContext } from "../contexts/PeerConnectionContext";
import { PeersContext } from "../contexts/PeersContext";
import { ToastContext } from "../contexts/ToastContext";
import { useFileTransfer } from "../hooks/useFileTransfer";
import { useIsMobile } from "../hooks/useIsMobile";
import { useRateLimitHandler } from "../hooks/useRateLimitHandler";
import { useSocketStatus } from "../hooks/useSocketStatus";
import GlacierPeerTabs from "./GlacierPeerTabs";
import GlacierRoomPanel from "./GlacierRoomPanel";
import PearLogo from "./PearLogo";
import { ThemeToggle } from "./theme/ThemeToggle";
import GlacierTransferHistory from "./transfer/GlacierTransferHistory";
import GlacierTransferZone from "./transfer/GlacierTransferZone";

interface PearProps {
  initialRoomId?: string | null;
}

export const Pear = ({ initialRoomId }: PearProps) => {
  useRateLimitHandler();
  const isSocketConnected = useSocketStatus();
  const isMobile = useIsMobile();

  const toastContext = use(ToastContext);

  const peersContext = use(PeersContext);
  if (!peersContext) {
    throw new Error("PeersContext is not available");
  }
  const { selectedPeerId, setSelectedPeerId, localPeer, peers } = peersContext;

  const peerManagerContext = use(PeerConnectionContext);
  if (!peerManagerContext) {
    throw new Error("PeerConnectionContext is not available");
  }
  const { connectionStates, connectToRoom, remotePeers, initiateConnection } = peerManagerContext;

  const hasJoinedRoomRef = useRef(false);
  useEffect(() => {
    if (initialRoomId && !hasJoinedRoomRef.current) {
      hasJoinedRoomRef.current = true;
      window.history.replaceState({}, document.title, window.location.pathname);
      connectToRoom(initialRoomId);
    }
  }, [initialRoomId, connectToRoom]);

  const connectedPeerIds = useMemo(() => {
    return Array.from(connectionStates.entries())
      .filter(([, state]) => state === "connected")
      .map(([peerId]) => peerId);
  }, [connectionStates]);

  useEffect(() => {
    if (!selectedPeerId && connectedPeerIds.length > 0) {
      const firstConnected = connectedPeerIds[0];
      if (firstConnected) {
        setSelectedPeerId(firstConnected);
      }
    }
  }, [selectedPeerId, connectedPeerIds, setSelectedPeerId]);

  const nearbyPeers = useMemo(() => {
    return [...peers].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [peers]);

  const roomPeers = useMemo(() => {
    const nearbyIds = new Set(peers.map((p) => p.id));
    const remote = Array.from(remotePeers.values()).filter((p) => !nearbyIds.has(p.id));
    return remote.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [peers, remotePeers]);

  const connectedPeers = useMemo(() => {
    const map = new Map<string, Peer>();
    for (const p of peers) {
      if (connectionStates.get(p.id) === "connected") {
        map.set(p.id, p);
      }
    }
    for (const p of remotePeers.values()) {
      if (connectionStates.get(p.id) === "connected") {
        map.set(p.id, p);
      }
    }
    return Array.from(map.values());
  }, [peers, remotePeers, connectionStates]);

  const selectedPeer = useMemo(() => {
    if (!selectedPeerId) return null;
    return peers.find((p) => p.id === selectedPeerId) ?? remotePeers.get(selectedPeerId) ?? null;
  }, [selectedPeerId, peers, remotePeers]);

  const selectedPeerName = selectedPeer?.name ?? (selectedPeerId ? selectedPeerId.substring(0, 8) : null);
  const isSelectedPeerConnected = selectedPeerId ? connectionStates.get(selectedPeerId) === "connected" : false;

  const {
    transfers,
    sendFile,
    acceptFile,
    rejectFile,
    isTransferInProgress,
    isOutgoingPaused,
    pauseSending,
    resumeSending,
    cancelSending,
    progressController,
  } = useFileTransfer(selectedPeerId);

  const activeTransfer = useMemo(
    () => transfers.find((t) => t.status === "transferring" || t.status === "paused") ?? null,
    [transfers],
  );

  const pendingFileRecord = useMemo(
    () => transfers.find((t) => t.status === "pending_acceptance" && t.direction === "incoming") ?? null,
    [transfers],
  );

  const getPeerName = useCallback(
    (id: string) => {
      const peer =
        peers.find((p) => p.id === id) ?? remotePeers.get(id as unknown as Parameters<typeof remotePeers.get>[0]);
      return peer?.name ?? id.substring(0, 8);
    },
    [peers, remotePeers],
  );

  // Mobile background warning listener
  useEffect(() => {
    if (!isMobile || !toastContext) return;

    let wasHiddenDuringTransfer = false;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        if (activeTransfer) {
          wasHiddenDuringTransfer = true;
        }
      } else if (wasHiddenDuringTransfer) {
        wasHiddenDuringTransfer = false;
        toastContext.addToast({
          type: "warning",
          title: "Browser was in background",
          message: "Keep this tab open while transferring. Mobile browsers stop background connections.",
        });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [isMobile, activeTransfer, toastContext]);

  return (
    <div className="min-h-screen antialiased flex flex-col justify-between px-4 sm:px-8 lg:px-16 py-6 lg:py-10 selection:bg-primary selection:text-background relative bg-background text-foreground">
      {/* Disconnected State Banner */}
      {!isSocketConnected && (
        <div
          role="alert"
          className="mb-4 rounded-xl bg-red-500/10 border border-red-500/20 px-4 py-2.5 text-center text-xs sm:text-sm font-medium text-red-400 flex items-center justify-center gap-2 z-50 shrink-0"
        >
          <FiAlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span>Disconnected from signaling server. Reconnecting...</span>
        </div>
      )}

      {/* Main Flow Container */}
      <div className="w-full max-w-7xl mx-auto flex flex-col gap-8 lg:gap-10 relative z-0">
        {/* Header Bar without hard divider */}
        <header className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-2">
          <div className="flex items-center gap-3.5">
            <PearLogo className="w-10 h-10 object-contain" />
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-on-surface font-headline">PearIO</h1>
              <div className="px-2.5 py-0.5 rounded-full bg-surface-container-high border border-outline-variant text-xs text-on-surface-variant font-label">
                Connected as <span className="font-semibold text-primary">{localPeer.name || "Anonymous"}</span>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-3 justify-end">
            <ThemeToggle />
          </div>
        </header>

        {/* Top Action Zone: Active Transfer, Incoming File Confirmation, or Dropzone */}
        <GlacierTransferZone
          selectedPeerName={selectedPeerName}
          disabled={!isSelectedPeerConnected}
          isTransferInProgress={isTransferInProgress}
          isTransferPaused={isOutgoingPaused}
          activeTransfer={activeTransfer}
          progressController={progressController}
          pendingFileRecord={pendingFileRecord}
          pendingFileSenderName={pendingFileRecord ? getPeerName(pendingFileRecord.peerId) : null}
          onPauseTransfer={pauseSending}
          onResumeTransfer={resumeSending}
          onCancelTransfer={cancelSending}
          onAcceptFile={() => {
            void acceptFile();
          }}
          onRejectFile={rejectFile}
          onFileSelect={(file: File) => {
            void sendFile(file);
          }}
        />

        {/* Mid-Section: Peers + Room Code */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-start">
          <div className="lg:col-span-7">
            <GlacierPeerTabs
              nearbyPeers={nearbyPeers}
              roomPeers={roomPeers}
              connectedPeers={connectedPeers}
              selectedPeerId={selectedPeerId}
              connectionStates={connectionStates}
              onSelectPeer={(peer: Peer) => setSelectedPeerId(peer.id)}
              onRequestConnection={(peer: Peer) => {
                void initiateConnection(peer);
              }}
            />
          </div>

          <div className="lg:col-span-5">
            <GlacierRoomPanel
              personalRoomId={localPeer.personalRoomId}
              onJoinRoom={(roomId: string) => connectToRoom(roomId)}
            />
          </div>
        </div>

        {/* Bottom: Transfer History */}
        <GlacierTransferHistory records={transfers} getPeerName={getPeerName} />
      </div>

      {/* Footer / Architecture & Privacy Info */}
      <footer className="pt-10 pb-6 text-center max-w-2xl mx-auto flex flex-col items-center gap-2">
        <div className="flex items-center gap-2 text-xs font-medium text-on-surface-variant font-label">
          <FiShield className="w-3.5 h-3.5 text-primary shrink-0" aria-hidden="true" />
          <span>Direct browser-to-browser · No size limits · Zero server storage</span>
        </div>
        <p className="text-xs text-on-surface-variant/80 font-body leading-relaxed">
          The signaling server only discovers peers and negotiates the connection. It handles no data once linked. File
          transfers run entirely between devices.
        </p>
      </footer>
    </div>
  );
};

export default Pear;
