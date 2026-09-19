import type { Socket, Server as SocketIOServer } from "socket.io";

import {
  type ClientToServerEvents,
  type InterServerEvents,
  PeerIdSchema,
  PeerSchema,
  type ServerToClientEvents,
} from "@peario/shared";
import { z } from "zod";

export * from "@peario/shared";

/**
 * Socket data schema - peer data with room assignment (server specific)
 */
export const SocketDataSchema = PeerSchema.extend({
  roomId: z.string().min(1),
}).strict();

export type SocketData = z.infer<typeof SocketDataSchema>;

export type PartialSocketData = Partial<SocketData>;

export type AuthenticatedSocketData = SocketData;

export type PeerSocket = Socket<ClientToServerEvents, ServerToClientEvents, InterServerEvents, PartialSocketData>;

export type PeerServer = SocketIOServer<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  PartialSocketData
>;

export function isAuthenticated(data: PartialSocketData): data is AuthenticatedSocketData {
  return (
    PeerIdSchema.safeParse(data.id).success &&
    typeof data.name === "string" &&
    typeof data.timestamp === "string" &&
    typeof data.roomId === "string"
  );
}
