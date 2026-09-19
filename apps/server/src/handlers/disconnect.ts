import type { PeerSocket } from "../types";

import { isAuthenticated } from "../types";
import { socketLogger } from "../utils/logger";
import { unregisterPeer } from "../utils/peer";

export function handleDisconnect(socket: PeerSocket): void {
  if (!isAuthenticated(socket.data)) {
    socketLogger.trace(`Unidentified socket ${socket.id} disconnected, no cleanup needed`);
    return;
  }

  const { roomId, id, personalRoomId, name } = socket.data;

  unregisterPeer(id, personalRoomId);

  socketLogger.info(`Peer disconnected: ${name} (${id})`);
  socketLogger.trace(`Peer left room: ${roomId}`);

  socket.to(roomId).emit("peer-left", {
    id,
    timestamp: new Date().toISOString(),
  });
}
