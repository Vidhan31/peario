import type { Peer, PeerId } from "@peario/shared";

import { useMemo } from "react";
import { FiMonitor, FiSmartphone, FiUsers } from "react-icons/fi";

interface GlacierPeerTabsProps {
  nearbyPeers: Peer[];
  roomPeers: Peer[];
  connectedPeers: Peer[];
  selectedPeerId: PeerId | null;
  connectionStates: Map<PeerId, RTCPeerConnectionState>;
  onSelectPeer: (peer: Peer) => void;
  onRequestConnection: (peer: Peer) => void;
}

export const GlacierPeerTabs = ({
  nearbyPeers,
  roomPeers,
  connectedPeers,
  selectedPeerId,
  connectionStates,
  onSelectPeer,
  onRequestConnection,
}: GlacierPeerTabsProps) => {
  const roomPeerIds = useMemo(() => new Set(roomPeers.map((p) => p.id)), [roomPeers]);

  const mergedPeers = useMemo(() => {
    const map = new Map<PeerId, Peer>();
    for (const p of nearbyPeers) {
      map.set(p.id, p);
    }
    for (const p of roomPeers) {
      if (!map.has(p.id)) {
        map.set(p.id, p);
      }
    }
    for (const p of connectedPeers) {
      if (!map.has(p.id)) {
        map.set(p.id, p);
      }
    }
    return Array.from(map.values()).sort((a, b) => {
      const aRank = connectionStates.get(a.id) === "connected" ? 0 : 1;
      const bRank = connectionStates.get(b.id) === "connected" ? 0 : 1;
      if (aRank !== bRank) return aRank - bRank;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
  }, [nearbyPeers, roomPeers, connectedPeers, connectionStates]);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between h-9 px-1">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-on-surface-variant font-label flex items-center gap-2">
          <FiUsers className="w-3.5 h-3.5" aria-hidden="true" />
          Peers ({mergedPeers.length})
        </h2>
      </div>

      <ul className="flex flex-col gap-1 pt-1">
        {mergedPeers.length > 0 ? (
          mergedPeers.map((peer) => {
            const displayName = peer.name || peer.id.substring(0, 8);
            const connectionState = connectionStates.get(peer.id);
            const isConnected = connectionState === "connected";
            const isConnecting = connectionState === "connecting";
            const isSelected = peer.id === selectedPeerId;
            const isViaRoom = roomPeerIds.has(peer.id);
            const subtitle = isConnected
              ? "Connected"
              : isConnecting
                ? "Connecting…"
                : isViaRoom
                  ? "Via room code"
                  : "Nearby";

            return (
              <li
                key={peer.id}
                className="flex items-center justify-between p-3 rounded-xl hover:bg-surface-container/60 transition-colors group"
              >
                <button
                  type="button"
                  onClick={() => {
                    onSelectPeer(peer);
                  }}
                  className="flex items-center gap-3 text-left focus:outline-none flex-1 min-w-0 cursor-pointer"
                >
                  <div className="w-9 h-9 rounded-lg bg-surface-container-high text-primary flex items-center justify-center shrink-0 border border-outline-variant">
                    {isConnected ? (
                      <FiMonitor className="w-4 h-4 text-primary" aria-hidden="true" />
                    ) : (
                      <FiSmartphone className="w-4 h-4 text-primary" aria-hidden="true" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-on-surface font-headline truncate">{displayName}</div>
                    <div
                      className={`text-[11px] font-medium font-label truncate ${
                        isConnected ? "text-primary" : "text-on-surface-variant"
                      }`}
                    >
                      {subtitle}
                    </div>
                  </div>
                </button>

                {isConnected ? (
                  isSelected ? (
                    <span className="px-3.5 py-1.5 rounded-lg border border-primary/40 bg-primary/10 text-primary text-xs font-semibold font-label flex items-center gap-1.5 shrink-0">
                      ✓ Active
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => onSelectPeer(peer)}
                      className="px-3 py-1.5 rounded-lg border border-outline-variant hover:border-primary/50 text-on-surface-variant hover:text-on-surface text-xs font-medium transition-colors font-label cursor-pointer shrink-0"
                    >
                      Make Active
                    </button>
                  )
                ) : (
                  <button
                    type="button"
                    disabled={isConnecting}
                    onClick={() => {
                      onSelectPeer(peer);
                      onRequestConnection(peer);
                    }}
                    aria-label={`Connect to ${displayName}`}
                    className="px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors font-label shrink-0 bg-primary hover:bg-secondary text-primary-foreground cursor-pointer disabled:cursor-not-allowed disabled:opacity-70"
                  >
                    {isConnecting ? "Connecting..." : "Connect"}
                  </button>
                )}
              </li>
            );
          })
        ) : (
          <div className="py-8 text-center text-xs text-on-surface-variant">
            No peers found. Stay on this network or join a room code to discover devices.
          </div>
        )}
      </ul>
    </section>
  );
};

GlacierPeerTabs.displayName = "GlacierPeerTabs";
export default GlacierPeerTabs;
