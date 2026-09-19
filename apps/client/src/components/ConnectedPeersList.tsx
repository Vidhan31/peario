import type { Peer, PeerId } from "@peario/shared";

import { FiHash, FiRadio, FiUsers, FiWifi } from "react-icons/fi";

import type { CandidatePairType } from "../lib/webrtc/stats";

interface ConnectedPeersListProps {
  nearbyPeers: Peer[];
  roomPeers: Peer[];
  selectedPeerId: PeerId | null;
  selectedPeer: Peer | null;
  connectionStates: Map<PeerId, RTCPeerConnectionState>;
  relayStatuses?: Map<PeerId, CandidatePairType>;
  onSelectPeer: (peer: Peer) => void;
  onRequestConnection: () => void;
}

export const ConnectedPeersList = ({
  nearbyPeers,
  roomPeers,
  selectedPeerId,
  selectedPeer,
  connectionStates,
  relayStatuses,
  onSelectPeer,
  onRequestConnection,
}: ConnectedPeersListProps) => {
  const hasAnyPeers = nearbyPeers.length > 0 || roomPeers.length > 0;

  const renderPeerItem = (peer: Peer) => {
    const isSelected = selectedPeerId === peer.id;
    const status = connectionStates.get(peer.id);
    const isConnected = status === "connected";
    const relayStatus = relayStatuses?.get(peer.id);
    const peerDisplayName = peer.name || peer.id.substring(0, 8);

    return (
      <li key={peer.id}>
        <button
          type="button"
          onClick={() => {
            onSelectPeer(peer);
          }}
          aria-pressed={isSelected}
          className={`group w-full rounded-xl p-3 text-left transition-all ${
            isSelected
              ? "bg-primary shadow-lg shadow-primary/20"
              : "bg-muted/50 hover:bg-muted text-muted-foreground hover:text-foreground"
          }`}
        >
          <div className="flex items-center justify-between mb-1">
            <p className={`font-semibold ${isSelected ? "text-primary-foreground" : "text-foreground"}`}>
              {peerDisplayName}
            </p>
            {isConnected && (
              <div className="flex items-center gap-1.5">
                {relayStatus && relayStatus !== "unknown" && (
                  <span
                    aria-label={`Connection mode: ${relayStatus}`}
                    className={`text-[9px] uppercase font-bold px-1.5 py-0.5 rounded ${
                      isSelected
                        ? "bg-white/20 text-white"
                        : relayStatus === "relay"
                          ? "bg-amber-500/10 text-amber-500"
                          : "bg-blue-500/10 text-blue-500"
                    }`}
                  >
                    {relayStatus}
                  </span>
                )}
                <FiWifi
                  size={14}
                  aria-hidden="true"
                  className={isSelected ? "text-primary-foreground/80" : "text-green-500"}
                />
              </div>
            )}
          </div>
          <div className="flex items-center justify-between">
            <p className={`text-xs ${isSelected ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
              {new Date(peer.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
            </p>
            {status && (
              <span
                aria-label={`Connection status: ${status}`}
                className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${
                  isSelected
                    ? "bg-white/20 text-white"
                    : status === "connected"
                      ? "bg-green-500/10 text-green-500"
                      : "bg-red-500/10 text-red-500"
                }`}
              >
                {status}
              </span>
            )}
          </div>
        </button>
      </li>
    );
  };

  return (
    <div className="rounded-2xl border border-border bg-muted/40 p-5 backdrop-blur-sm flex-1 flex flex-col min-h-0">
      <div className="flex-1 overflow-y-auto space-y-6 pr-1 -mr-1">
        <div>
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2 text-primary">
              <FiUsers aria-hidden="true" />
              <h2 className="font-semibold text-sm uppercase tracking-wider">Nearby Peers</h2>
            </div>
            <div className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
              <FiRadio aria-hidden="true" className="animate-pulse text-green-500" />
              <span>Scanning</span>
            </div>
          </div>

          <ul className="space-y-2">
            {nearbyPeers.map(renderPeerItem)}
            {nearbyPeers.length === 0 && hasAnyPeers && (
              <div className="flex flex-col items-center justify-center py-4 text-center opacity-60">
                <p className="text-xs font-medium text-muted-foreground">No nearby peers found</p>
              </div>
            )}
          </ul>
        </div>

        {roomPeers.length > 0 && (
          <div className="animate-in fade-in slide-in-from-top-2">
            <div className="mb-4 flex items-center gap-2 text-primary">
              <FiHash aria-hidden="true" />
              <h2 className="font-semibold text-sm uppercase tracking-wider">Room Peers</h2>
            </div>
            <ul className="space-y-2">{roomPeers.map(renderPeerItem)}</ul>
          </div>
        )}

        {!hasAnyPeers && (
          <div className="flex flex-col items-center justify-center py-8 text-center px-2">
            <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted/50 text-muted-foreground">
              <FiUsers size={24} aria-hidden="true" />
            </div>
            <p className="text-sm font-semibold text-foreground">No peers found</p>
            <p className="text-xs text-muted-foreground mt-1 max-w-xs">
              Share your Room ID or join a room above to connect with other peers.
            </p>
          </div>
        )}
      </div>

      {selectedPeer && connectionStates.get(selectedPeer.id) !== "connected" && (
        <div className="mt-4 animate-in slide-in-from-bottom-2 fade-in">
          <button
            type="button"
            onClick={() => {
              onRequestConnection();
            }}
            className="w-full rounded-lg bg-green-500 px-4 py-3 font-semibold text-white shadow-lg shadow-green-500/20 transition-all hover:bg-green-600 active:scale-[0.98]"
          >
            Connect
          </button>
        </div>
      )}
    </div>
  );
};

ConnectedPeersList.displayName = "ConnectedPeersList";
