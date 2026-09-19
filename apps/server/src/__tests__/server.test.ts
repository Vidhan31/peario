import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PeerServer, PeerSocket } from "../types";

import { handleIdentifyPeers, handleSelfIdentify } from "../handlers/identity";
import {
  _clearRecentSelfIdentificationsForTesting,
  _resetTurnLimiterForTesting,
  recordRecentSelfIdentify,
} from "../routes/turn";
import serverConfig, {
  _resetDrainForTesting,
  allowRequestHandler,
  gracefulDrain,
  io,
  isOriginAllowed,
  registerSocketHandler,
} from "../server";
import { identityLogger, logger } from "../utils/logger";

describe("Server Error Boundaries & Socket Handlers", () => {
  afterEach(() => {
    _resetDrainForTesting();
  });

  it("registerSocketHandler catches synchronous errors and logs them without crashing", () => {
    const errorSpy = vi.spyOn(logger, "error").mockReturnValue(undefined);
    const listeners: Record<string, (...args: unknown[]) => void> = {};

    const mockSocket = {
      id: "test-socket-1",
      on: (event: string, fn: (...args: unknown[]) => void) => {
        listeners[event] = fn;
      },
    } as unknown as PeerSocket;

    const throwingHandler = () => {
      throw new Error("Simulated synchronous crash");
    };

    registerSocketHandler(mockSocket, "offer", throwingHandler);

    expect(listeners["offer"]).toBeDefined();
    expect(() => listeners["offer"]?.({})).not.toThrow();

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Synchronous error in socket handler for event "offer" (socket ID: test-socket-1):'),
      expect.any(Error),
    );

    errorSpy.mockRestore();
  });

  it("registerSocketHandler catches asynchronous promise rejections and logs them without crashing", async () => {
    const errorSpy = vi.spyOn(logger, "error").mockReturnValue(undefined);
    const listeners: Record<string, (...args: unknown[]) => void> = {};

    const mockSocket = {
      id: "test-socket-2",
      on: (event: string, fn: (...args: unknown[]) => void) => {
        listeners[event] = fn;
      },
    } as unknown as PeerSocket;

    const rejectingHandler = async () => {
      await Promise.resolve();
      throw new Error("Simulated async rejection");
    };

    registerSocketHandler(mockSocket, "answer", rejectingHandler);

    expect(listeners["answer"]).toBeDefined();
    listeners["answer"]?.({});
    await vi.waitFor(() => {
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Unhandled error in socket handler for event "answer" (socket ID: test-socket-2):'),
        expect.any(Error),
      );
    });

    errorSpy.mockRestore();
  });

  it("handleSelfIdentify rejects malformed payloads and does not throw", async () => {
    const warnSpy = vi.spyOn(identityLogger, "warn").mockReturnValue(undefined);
    const emittedEvents: { event: string; data: unknown }[] = [];
    const disconnectSpy = vi.fn();

    const mockSocket = {
      id: "test-socket-3",
      data: {},
      handshake: { address: "127.0.0.1" },
      disconnect: disconnectSpy,
      emit: (event: string, data: unknown) => {
        emittedEvents.push({ event, data });
        return true;
      },
    } as unknown as PeerSocket;

    await handleSelfIdentify(mockSocket, { name: "" });

    expect(emittedEvents).toContainEqual({
      event: "identity-error",
      data: { message: expect.stringContaining("Validation error:") },
    });
    expect(disconnectSpy).toHaveBeenCalledWith(true);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("Invalid self-identify payload from test-socket-3:"));

    warnSpy.mockRestore();
  });

  it("handleIdentifyPeers rejects socket without confirmed identity", async () => {
    const warnSpy = vi.spyOn(identityLogger, "warn").mockReturnValue(undefined);
    const emittedEvents: { event: string; data: unknown }[] = [];

    const mockSocket = {
      id: "test-socket-4",
      data: {}, // no id or name
      handshake: { address: "127.0.0.1" },
      emit: (event: string, data: unknown) => {
        emittedEvents.push({ event, data });
        return true;
      },
    } as unknown as PeerSocket;

    const mockIO = {} as unknown as PeerServer;

    await handleIdentifyPeers(mockIO, mockSocket);

    expect(emittedEvents).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith("Unauthenticated socket test-socket-4 tried to identify peers");

    warnSpy.mockRestore();
  });

  it("GET /ready returns 200 with uptime and version", async () => {
    const dummyServer = {} as Parameters<typeof serverConfig.fetch>[1];
    const req = new Request("http://localhost:8080/ready");
    const res = await serverConfig.fetch(req, dummyServer);

    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; uptime: number; version: string };
    expect(body.ok).toBe(true);
    expect(typeof body.uptime).toBe("number");
    expect(body.version).toBeDefined();
  });

  it("evaluates origins correctly in dev vs prod allowlist", () => {
    // In development mode: allows any origin
    expect(isOriginAllowed("https://untrusted-domain.com", false, [])).toBe(true);
    expect(isOriginAllowed(undefined, false, [])).toBe(true);

    // In production mode: respects allowlist
    const prodAllowed = ["https://peario.app", "https://beta.peario.app"];
    expect(isOriginAllowed("https://peario.app", true, prodAllowed)).toBe(true);
    expect(isOriginAllowed("https://untrusted-domain.com", true, prodAllowed)).toBe(false);
    expect(isOriginAllowed(undefined, true, prodAllowed)).toBe(false);

    const dummyServer = {
      requestIP: () => ({ address: "203.0.113.5" }),
    } as unknown as Parameters<typeof allowRequestHandler>[1];

    // Dev mode allows request without error
    const devReq = new Request("http://localhost:8080/socket.io/", {
      headers: { origin: "https://random-dev.org" },
    });
    expect(() => allowRequestHandler(devReq, dummyServer, false, prodAllowed)).not.toThrow();

    // Prod mode allows valid origin
    const prodValidReq = new Request("http://localhost:8080/socket.io/", {
      headers: { origin: "https://peario.app" },
    });
    expect(() => allowRequestHandler(prodValidReq, dummyServer, true, prodAllowed)).not.toThrow();

    // Prod mode rejects untrusted origin and logs at warn
    const warnSpy = vi.spyOn(logger, "warn").mockReturnValue(undefined);
    const prodBadReq = new Request("http://localhost:8080/socket.io/", {
      headers: { origin: "https://evil.com" },
    });
    expect(() => allowRequestHandler(prodBadReq, dummyServer, true, prodAllowed)).toThrow("Unauthorized origin");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("Rejected connection from unauthorized origin: https://evil.com (IP: 203.0.113.5)"),
    );
    warnSpy.mockRestore();
  });

  it("handles graceful drain by stopping requests, notifying sockets, and exiting cleanly", async () => {
    const exitSpy = vi.fn();
    const infoSpy = vi.spyOn(logger, "info").mockReturnValue(undefined);

    const disconnectedSockets: string[] = [];
    const emittedEvents: { socketId: string; event: string; data: unknown }[] = [];

    const fakeSocket = {
      id: "drain-socket-1",
      emit: (event: string, data: unknown) => {
        emittedEvents.push({ socketId: "drain-socket-1", event, data });
      },
      disconnect: () => {
        disconnectedSockets.push("drain-socket-1");
      },
    } as unknown as PeerSocket;

    io.sockets.sockets.set(fakeSocket.id, fakeSocket);

    try {
      await gracefulDrain("SIGTERM", exitSpy);

      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("Starting graceful connection drain"));
      expect(infoSpy).toHaveBeenCalledWith(expect.stringContaining("Graceful drain finished"));
      expect(exitSpy).toHaveBeenCalledWith(0);

      expect(emittedEvents).toContainEqual({
        socketId: "drain-socket-1",
        event: "identity-error",
        data: { message: "Server is restarting" },
      });
      expect(disconnectedSockets).toContain("drain-socket-1");

      // Subsequent fetch requests should return 503 during drain
      const dummyServer = {} as Parameters<typeof serverConfig.fetch>[1];
      const postDrainRes = await serverConfig.fetch(new Request("http://localhost:8080/health"), dummyServer);
      expect(postDrainRes.status).toBe(503);
    } finally {
      io.sockets.sockets.delete(fakeSocket.id);
      infoSpy.mockRestore();
    }
  });

  describe("staging only /debug-ip route", () => {
    const dummyServer = {
      requestIP: () => ({ address: "192.168.1.50" }),
    } as unknown as Parameters<typeof serverConfig.fetch>[1];

    it("returns 401 when x-debug-token header is missing or incorrect in development", async () => {
      process.env.DEBUG_IP_TOKEN = "secret-debug-key";
      const req = new Request("http://localhost:8080/debug-ip");
      const res = await serverConfig.fetch(req, dummyServer);
      expect(res.status).toBe(401);
      delete process.env.DEBUG_IP_TOKEN;
    });

    it("returns direct address, parsed IP, trust status, and forwarded headers when authorized", async () => {
      process.env.DEBUG_IP_TOKEN = "secret-debug-key";
      process.env.TRUSTED_PROXIES = "192.168.1.50";

      const req = new Request("http://localhost:8080/debug-ip", {
        headers: {
          "x-debug-token": "secret-debug-key",
          "x-forwarded-for": "203.0.113.88, 10.0.0.1",
        },
      });

      const res = await serverConfig.fetch(req, dummyServer);
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        directAddress: string;
        parsedIP: string;
        trusted: boolean;
        headers: Record<string, string | null>;
      };

      expect(body.directAddress).toBe("192.168.1.50");
      expect(body.parsedIP).toBe("203.0.113.88");
      expect(body.trusted).toBe(true);
      expect(body.headers["x-forwarded-for"]).toBe("203.0.113.88, 10.0.0.1");

      delete process.env.DEBUG_IP_TOKEN;
      delete process.env.TRUSTED_PROXIES;
    });
  });

  describe("GET /api/turn-credentials proxy", () => {
    const originalFetch = globalThis.fetch;
    const dummyServer = {
      requestIP: () => ({ address: "192.168.1.100" }),
    } as unknown as Parameters<typeof serverConfig.fetch>[1];

    beforeEach(() => {
      _resetTurnLimiterForTesting();
      _clearRecentSelfIdentificationsForTesting();
      process.env.METERED_APP_NAME = "pear-test";
      process.env.METERED_SECRET_KEY = "super-secret-metered-key-999";
    });

    afterEach(() => {
      globalThis.fetch = originalFetch;
      _resetTurnLimiterForTesting();
      _clearRecentSelfIdentificationsForTesting();
      delete process.env.METERED_APP_NAME;
      delete process.env.METERED_SECRET_KEY;
    });

    it("rejects requests without room context or recent self-identify with 403", async () => {
      const req = new Request("http://localhost:8080/api/turn-credentials");
      const res = await serverConfig.fetch(req, dummyServer);
      expect(res.status).toBe(403);
      const data = (await res.json()) as { error: string };
      expect(data.error).toContain("Room context or recent self-identification required");
    });

    it("fetches Metered credentials, returns 200 with no-store, and NEVER leaks the secret key", async () => {
      recordRecentSelfIdentify("192.168.1.100");

      const mockMeteredServers = [
        { urls: "stun:relay.metered.ca:80" },
        {
          urls: "turn:relay.metered.ca:80",
          username: "ephemeral-metered-user",
          credential: "ephemeral-password-456",
        },
      ];

      const fetchSpy = vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockMeteredServers),
      });
      globalThis.fetch = fetchSpy as unknown as typeof fetch;

      const req = new Request("http://localhost:8080/api/turn-credentials?roomId=TEST01");
      const res = await serverConfig.fetch(req, dummyServer);

      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe("no-store");

      const responseText = await res.text();
      expect(responseText).not.toContain("super-secret-metered-key-999");
      expect(responseText).toContain("ephemeral-metered-user");

      const parsedJson = JSON.parse(responseText) as typeof mockMeteredServers;
      expect(parsedJson).toEqual(mockMeteredServers);
    });

    it("returns 502 with tiny JSON and logs status code only when Metered fails or sends bad payload", async () => {
      recordRecentSelfIdentify("192.168.1.100");

      const warnSpy = vi.spyOn(logger, "warn").mockReturnValue(undefined);
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: () => Promise.resolve({}),
      }) as unknown as typeof fetch;

      const req = new Request("http://localhost:8080/api/turn-credentials?roomId=TEST01");
      const res = await serverConfig.fetch(req, dummyServer);

      expect(res.status).toBe(502);
      const errorJson = (await res.json()) as { error: string };
      expect(errorJson.error).toBeDefined();

      expect(warnSpy).toHaveBeenCalledWith("Metered TURN request failed with status: 503");
      warnSpy.mockRestore();
    });
  });
});
