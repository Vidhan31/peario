import { beforeEach, describe, expect, it, vi } from "vitest";

import { handleConnectToRoom } from "../handlers/connection";
import { _resetClientErrorLimiterForTesting } from "../routes/clientErrors";
import serverConfig from "../server";
import { PeerIdSchema, type PeerServer, type PeerSocket } from "../types";
import { hashRoomId } from "../utils/hash";
import { _resetLimitersForTesting } from "../utils/limiter";
import { connectionLogger, logger } from "../utils/logger";
import { registerPeer } from "../utils/peer";

describe("C5 - Observability & Abuse Protection", () => {
  const dummyServer = {
    requestIP: () => ({ address: "192.168.1.123" }),
  } as unknown as Parameters<typeof serverConfig.fetch>[1];

  beforeEach(() => {
    _resetLimitersForTesting();
    _resetClientErrorLimiterForTesting();
  });

  describe("hashRoomId", () => {
    it("produces deterministic, 8-character hex hash", () => {
      const hash1 = hashRoomId("ROOM99");
      const hash2 = hashRoomId("ROOM99");
      const hash3 = hashRoomId("ROOM10");

      expect(hash1).toHaveLength(8);
      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(hash3);
      expect(/^[0-9a-f]{8}$/.test(hash1)).toBe(true);
    });
  });

  describe("POST /api/client-errors", () => {
    it("accepts valid client error reports and returns 204 No Content", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockReturnValue(undefined);

      const req = new Request("http://localhost:8080/api/client-errors", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-request-id": "req-err-1",
        },
        body: JSON.stringify({
          eventType: "connect_error",
          reason: "WebSocket connection timeout",
          isRelay: false,
        }),
      });

      const res = await serverConfig.fetch(req, dummyServer);
      expect(res.status).toBe(204);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining("Client reported error [requestId: req-err-1]: event=connect_error"),
      );

      warnSpy.mockRestore();
    });

    it("rejects malformed payloads with 400", async () => {
      const req = new Request("http://localhost:8080/api/client-errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: "invalid_event_type",
        }),
      });

      const res = await serverConfig.fetch(req, dummyServer);
      expect(res.status).toBe(400);
      const data = (await res.json()) as { error: string };
      expect(data.error).toBe("Invalid error report payload");
    });

    it("rate limits excessive error reports per IP with 429", async () => {
      for (let i = 0; i < 20; i++) {
        const req = new Request("http://localhost:8080/api/client-errors", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            eventType: "disconnect",
            reason: "ping timeout",
          }),
        });
        const res = await serverConfig.fetch(req, dummyServer);
        expect(res.status).toBe(204);
      }

      // 21st request should be rate limited
      const excessReq = new Request("http://localhost:8080/api/client-errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: "disconnect",
          reason: "ping timeout",
        }),
      });
      const excessRes = await serverConfig.fetch(excessReq, dummyServer);
      expect(excessRes.status).toBe(429);
      const data = (await excessRes.json()) as { error: string };
      expect(data.error).toBe("Rate limit exceeded");
    });
  });

  describe("Room abuse throttling", () => {
    it("throttles repeated join attempts targeting the same room", async () => {
      const warnSpy = vi.spyOn(connectionLogger, "warn").mockReturnValue(undefined);
      const emittedEvents: { event: string; data: unknown }[] = [];

      const authenticatedPeer = {
        id: PeerIdSchema.parse("01920000-0000-7000-8000-000000000001"),
        name: "Alice",
        timestamp: new Date().toISOString(),
        roomId: "192.168.1",
      };

      const mockSocket = {
        id: "socket-alice",
        data: authenticatedPeer,
        handshake: { address: "127.0.0.1" },
        emit: vi.fn((event: string, data: unknown) => {
          emittedEvents.push({ event, data });
          return true;
        }),
      } as unknown as PeerSocket;

      registerPeer(authenticatedPeer, mockSocket.id);

      const mockIO = {
        to: vi.fn().mockReturnValue({ emit: vi.fn() }),
      } as unknown as PeerServer;

      const targetRoom = "ROOM88";

      // Room join points are 15
      for (let i = 0; i < 15; i++) {
        await handleConnectToRoom(mockIO, mockSocket, targetRoom);
      }

      // 16th join to the same room should be throttled
      await handleConnectToRoom(mockIO, mockSocket, targetRoom);

      expect(mockSocket.emit).toHaveBeenCalledWith(
        "rate-limited",
        expect.objectContaining({
          event: "connectToRoom",
          retryAfterMs: expect.any(Number),
        }),
      );
      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Room join rate limit reached for room ${hashRoomId(targetRoom)}`),
      );

      warnSpy.mockRestore();
    });
  });
});
