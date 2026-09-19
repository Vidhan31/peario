import type { Peer, PeerServer, PeerSocket } from "../types";

import { recordRecentSelfIdentify } from "../routes/turn";
import { formatValidationError, PeerIdSchema, SelfIdentifyDataSchema, validatePayload } from "../types";
import { hashRoomId } from "../utils/hash";
import { getNetworkPrefix, getPeerIPFromSocket } from "../utils/ip";
import { identityLogger } from "../utils/logger";
import { getAuthenticatedPeer, registerPeer } from "../utils/peer";

/**
 * Unambiguous alphanumeric alphabet (excludes '0', 'O', '1', 'I').
 * Exactly 32 characters, providing uniform distribution across byte values (256 % 32 === 0).
 */
export const UNAMBIGUOUS_ROOM_CHARS = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";

/**
 * Cryptographically generates a secure, unambiguous room ID
 */
export function generateRoomId(length = 6): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let id = "";
  for (let i = 0; i < length; i++) {
    const byte = bytes[i];
    if (byte !== undefined) {
      id += UNAMBIGUOUS_ROOM_CHARS.charAt(byte % UNAMBIGUOUS_ROOM_CHARS.length);
    }
  }
  return id;
}

export function handleSelfIdentify(socket: PeerSocket, data: unknown): void {
  const validation = validatePayload(SelfIdentifyDataSchema, data);
  if (!validation.success) {
    const errorMessage = formatValidationError(validation.error);
    identityLogger.warn(`Invalid self-identify payload from ${socket.id}: ${errorMessage}`);
    socket.emit("identity-error", { message: errorMessage });
    socket.disconnect(true);
    return;
  }
  const validatedData = validation.data;

  const uuidResult = PeerIdSchema.safeParse(Bun.randomUUIDv7());
  if (!uuidResult.success) {
    identityLogger.error(`Failed to generate valid UUID for socket ${socket.id}`);
    socket.emit("identity-error", { message: "Internal server error: UUID generation failed" });
    socket.disconnect(true);
    return;
  }

  const personalRoomId = generateRoomId(6);
  const peer: Peer = {
    id: uuidResult.data,
    timestamp: new Date().toISOString(),
    personalRoomId,
    name: validatedData.name,
  };

  // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty custom room id means "no room given" and must fall back to the network default
  const assignedRoom = validatedData.customRoomId || getNetworkPrefix(socket);

  socket.data = { ...socket.data, ...peer, roomId: assignedRoom };
  registerPeer(peer, socket.id);

  const peerIP = getPeerIPFromSocket(socket);
  if (peerIP) {
    recordRecentSelfIdentify(peerIP);
  }

  void socket.join(assignedRoom);
  socket.emit("identity-confirmed", peer);

  identityLogger.info(`Peer ${peer.name} (${peer.id}) joined room: ${hashRoomId(assignedRoom)}`);
  identityLogger.trace(`Peer details:`, {
    peerId: peer.id,
    socketId: socket.id,
    name: peer.name,
    roomHash: hashRoomId(assignedRoom),
    personalRoomHash: peer.personalRoomId ? hashRoomId(peer.personalRoomId) : undefined,
  });
}

export async function handleIdentifyPeers(io: PeerServer, socket: PeerSocket): Promise<void> {
  const trustedPeer = getAuthenticatedPeer(socket);
  if (!trustedPeer) {
    identityLogger.warn(`Unauthenticated socket ${socket.id} tried to identify peers`);
    return;
  }

  const { roomId } = socket.data;
  if (!roomId) return;

  try {
    const roomSockets = await io.in(roomId).fetchSockets();
    const otherPeers: Peer[] = [];

    for (const remoteSocket of roomSockets) {
      if (remoteSocket.id === socket.id) continue;
      const remotePeer = getAuthenticatedPeer(remoteSocket as unknown as PeerSocket);
      if (remotePeer) {
        otherPeers.push(remotePeer);
      }
    }

    socket.emit("peers-identified", otherPeers);
    socket.to(roomId).emit("new-peer-joined", trustedPeer);
    identityLogger.debug(`Sent ${otherPeers.length} peers to ${trustedPeer.name} in room: ${hashRoomId(roomId)}`);
  } catch (error) {
    identityLogger.warn(`Failed to fetch sockets for room ${hashRoomId(roomId)} (socket: ${socket.id}):`, error);
    socket.emit("peers-identified", []);
  }
}
