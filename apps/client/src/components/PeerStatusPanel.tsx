import type { Peer } from "@peario/shared";

import { use, useMemo } from "react";

import { PeerConnectionContext } from "../contexts/PeerConnectionContext";
import { PeersContext } from "../contexts/PeersContext";
import { ConnectedPeersList } from "./ConnectedPeersList";
import { JoinRoomForm } from "./JoinRoomForm";
import { RoomShareCard } from "./RoomShareCard";

const PeerStatusPanel: React.FC = () => {
  const peersContext = use(PeersContext);
  if (!peersContext) {
    throw new Error("PeersContext is not available");
  }
  const { peers, selectedPeerId, setSelectedPeerId } = peersContext;

  const peerManagerContext = use(PeerConnectionContext);
  if (!peerManagerContext) {
    throw new Error("PeerConnectionContext is not available");
  }
  const { connectionStates, relayStatuses, remotePeers, initiateConnection, connectToRoom } = peerManagerContext;

  const nearbyPeers = useMemo(() => {
    return [...peers].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [peers]);

  const roomPeers = useMemo(() => {
    const nearbyIds = new Set(peers.map((p) => p.id));
    const remote = Array.from(remotePeers.values()).filter((p) => !nearbyIds.has(p.id));
    return remote.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [peers, remotePeers]);

  const displayPeers = useMemo(() => [...nearbyPeers, ...roomPeers], [nearbyPeers, roomPeers]);

  const selectedPeer = displayPeers.find((p) => p.id === selectedPeerId) ?? null;

  const handlePeerSelect = (peer: Peer) => {
    setSelectedPeerId(peer.id);
  };

  const handleConnect = () => {
    if (selectedPeer) {
      void initiateConnection(selectedPeer);
    }
  };

  return (
    <div className="space-y-6">
      <RoomShareCard personalRoomId={peersContext.localPeer.personalRoomId} />

      <JoinRoomForm onJoin={connectToRoom} />

      <ConnectedPeersList
        nearbyPeers={nearbyPeers}
        roomPeers={roomPeers}
        selectedPeerId={selectedPeerId}
        selectedPeer={selectedPeer}
        connectionStates={connectionStates}
        relayStatuses={relayStatuses}
        onSelectPeer={handlePeerSelect}
        onRequestConnection={handleConnect}
      />
    </div>
  );
};

PeerStatusPanel.displayName = "PeerStatusPanel";

export default PeerStatusPanel;
