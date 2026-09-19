import type { Peer, PeerId } from "@peario/shared";

import type { CandidatePairType } from "../lib/webrtc/stats";

export interface PeerConnectionType {
  getPeerConnection: (peerId: PeerId) => Readonly<RTCPeerConnection> | null;
  getDataChannel: (peerId: PeerId, label: string) => RTCDataChannel | null;
  waitForChannel?: (peerId: PeerId, label: string, timeoutMs?: number) => Promise<RTCDataChannel>;
  closePeerConnection: (peerId: PeerId) => void;
  initiateConnection: (peer: Peer) => Promise<void>;
  connectionStates: Map<PeerId, RTCPeerConnectionState>;
  relayStatuses: Map<PeerId, CandidatePairType>;
  remotePeers: Map<PeerId, Peer>;
  sendConnectionRequest: (peer: Peer) => Promise<void> | void;
  connectToRoom: (roomId: string) => void;
}
