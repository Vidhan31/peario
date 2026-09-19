import { createHash } from "node:crypto";

/**
 * Hashes a roomId for safe visible logging without exposing raw room IDs in logs.
 * Truncated to 8 hex characters for compact readability.
 */
export function hashRoomId(roomId: string): string {
  return createHash("sha256").update(roomId).digest("hex").slice(0, 8);
}
