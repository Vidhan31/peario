import type { ConnectionRequest, PeerServer, PeerSocket } from "../types";

import { ConnectionRequestIncomingSchema, ConnectToRoomSchema, formatValidationError, validatePayload } from "../types";
import { hashRoomId } from "../utils/hash";
import { checkRoomJoinAllowed } from "../utils/limiter";
import { connectionLogger } from "../utils/logger";
import { getAuthenticatedPeer, getPeerInfoByPersonalRoomId, getSocketIdByPeerId } from "../utils/peer";

export function handleConnectionRequest(io: PeerServer, socket: PeerSocket, data: unknown): void {
  const trustedFrom = getAuthenticatedPeer(socket);
  if (!trustedFrom) {
    connectionLogger.warn(`Unauthenticated socket ${socket.id} tried to send connection request`);
    return;
  }

  const validation = validatePayload(ConnectionRequestIncomingSchema, data);
  if (!validation.success) {
    connectionLogger.warn(
      `Invalid connection request payload from ${socket.id}: ${formatValidationError(validation.error)}`,
    );
    return;
  }
  const request = validation.data;

  const targetSocketId = getSocketIdByPeerId(request.to.id);
  if (!targetSocketId) {
    connectionLogger.debug(`Target peer ${request.to.id} not found in mapping`);
    return;
  }

  const trustedRequest: ConnectionRequest = {
    from: trustedFrom,
    to: request.to,
    isRoomConnection: request.isRoomConnection,
  };

  connectionLogger.info(`Connection request: ${trustedFrom.name} → ${request.to.name}`);
  connectionLogger.trace(`Request details:`, {
    fromId: trustedFrom.id,
    toId: request.to.id,
    isRoomConnection: request.isRoomConnection,
  });
  io.to(targetSocketId).emit("connection-request", trustedRequest);
}

export async function handleConnectToRoom(io: PeerServer, socket: PeerSocket, data: unknown): Promise<void> {
  const trustedFrom = getAuthenticatedPeer(socket);
  if (!trustedFrom) {
    connectionLogger.warn(`Unauthenticated socket ${socket.id} tried to connect to room`);
    return;
  }

  const validation = validatePayload(ConnectToRoomSchema, data);
  if (!validation.success) {
    connectionLogger.warn(
      `Invalid connect-to-room payload from ${socket.id}: ${formatValidationError(validation.error)}`,
    );
    return;
  }
  const targetRoomId = validation.data;
  const roomHash = hashRoomId(targetRoomId);

  const roomAllowed = await checkRoomJoinAllowed(targetRoomId);
  if (!roomAllowed.allowed) {
    connectionLogger.warn(`Room join rate limit reached for room ${roomHash} (socket ${socket.id})`);
    socket.emit("rate-limited", {
      event: "connectToRoom",
      retryAfterMs: roomAllowed.retryAfterMs,
      message: "Too many room join attempts. Please slow down.",
    });
    return;
  }

  const targetInfo = getPeerInfoByPersonalRoomId(targetRoomId);

  if (!targetInfo) {
    connectionLogger.debug(`Target room ${roomHash} not found`);
    return;
  }

  const request: ConnectionRequest = {
    from: trustedFrom,
    to: targetInfo.peer,
    isRoomConnection: true,
  };

  connectionLogger.info(`Room connection: ${trustedFrom.name} → Room ${roomHash} (${targetInfo.peer.name})`);
  connectionLogger.trace(`Room request details:`, {
    fromId: trustedFrom.id,
    targetRoomHash: roomHash,
    targetPeerId: targetInfo.peer.id,
  });
  io.to(targetInfo.socketId).emit("connection-request", request);
}
