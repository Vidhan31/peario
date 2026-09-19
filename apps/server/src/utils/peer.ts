import type { AuthenticatedSocketData, Peer, PeerId, PeerSocket } from "../types";

import { isAuthenticated } from "../types";

interface PeerInfo {
  peer: Peer;
  socketId: string;
}

const peerIdToInfo = new Map<PeerId, PeerInfo>();
const personalRoomIdToInfo = new Map<string, PeerInfo>();

export function registerPeer(peer: Peer, socketId: string): void {
  const info: PeerInfo = { peer, socketId };
  peerIdToInfo.set(peer.id, info);
  if (peer.personalRoomId) {
    personalRoomIdToInfo.set(peer.personalRoomId, info);
  }
}

export function unregisterPeer(peerId: PeerId, personalRoomId?: string): void {
  peerIdToInfo.delete(peerId);
  if (personalRoomId) {
    personalRoomIdToInfo.delete(personalRoomId);
  }
}

export function getSocketIdByPeerId(peerId: PeerId): string | undefined {
  return peerIdToInfo.get(peerId)?.socketId;
}

export function getPeerInfoByPersonalRoomId(personalRoomId: string): PeerInfo | undefined {
  return personalRoomIdToInfo.get(personalRoomId);
}

export function extractPeerFromSocketData(data: AuthenticatedSocketData): Peer {
  return {
    id: data.id,
    name: data.name,
    timestamp: data.timestamp,
    personalRoomId: data.personalRoomId,
  };
}

export function getAuthenticatedPeer(socket: PeerSocket): Peer | null {
  if (!isAuthenticated(socket.data)) {
    return null;
  }
  return extractPeerFromSocketData(socket.data);
}
