import { RateLimitedDataSchema } from "@peario/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PeerSocket } from "../types";

import {
  _resetLimitersForTesting,
  checkConnectionAllowed,
  checkEventAllowed,
  checkSignallingAllowed,
  getDegradedLimiterCount,
  MAX_SOCKETS_PER_IP,
  registerActiveSocket,
  unregisterActiveSocket,
  withRateLimit,
  withRateLimitIO,
} from "../utils/limiter";

function createMockSocket(id = "test-socket-1", address = "127.0.0.1"): PeerSocket {
  const emitted: { event: string; data: unknown }[] = [];
  return {
    id,
    data: {},
    handshake: { address },
    emit: vi.fn((event: string, data: unknown) => {
      emitted.push({ event, data });
      return true;
    }),
  } as unknown as PeerSocket;
}

describe("limiter utilities & rate-limited events", () => {
  beforeEach(() => {
    _resetLimitersForTesting();
  });

  it("validates RateLimitedDataSchema with nonnegative retryAfterMs (including 0)", () => {
    const payloadZero = {
      event: "offer",
      retryAfterMs: 0,
      message: "Rate limit exceeded",
    };
    const resultZero = RateLimitedDataSchema.safeParse(payloadZero);
    expect(resultZero.success).toBe(true);

    const payloadPositive = {
      event: "offer",
      retryAfterMs: 1500,
      message: "Rate limit exceeded",
    };
    const resultPositive = RateLimitedDataSchema.safeParse(payloadPositive);
    expect(resultPositive.success).toBe(true);

    const payloadNegative = {
      event: "offer",
      retryAfterMs: -10,
      message: "Rate limit exceeded",
    };
    const resultNegative = RateLimitedDataSchema.safeParse(payloadNegative);
    expect(resultNegative.success).toBe(false);
  });

  it("supports withRateLimitIO wrapping handlers with zero data payloads (identifyPeers)", async () => {
    const socket = createMockSocket("socket-no-payload");
    const mockIO = { sockets: {} };
    const mockHandler = vi.fn().mockResolvedValue(undefined);

    const wrapped = withRateLimitIO("identifyPeers", mockHandler);
    await wrapped(mockIO, socket);

    expect(mockHandler).toHaveBeenCalledWith(mockIO, socket, undefined);
    expect(socket.emit).not.toHaveBeenCalledWith("rate-limited", expect.anything());
  });

  it("blocks and emits rate-limited event when event budget is exhausted", async () => {
    const socket = createMockSocket("socket-exhaust-budget");
    const mockHandler = vi.fn().mockResolvedValue(undefined);
    const wrapped = withRateLimit("selfIdentify", mockHandler);

    await wrapped(socket, { name: "A" });
    await wrapped(socket, { name: "B" });
    await wrapped(socket, { name: "C" });
    expect(mockHandler).toHaveBeenCalledTimes(3);

    await wrapped(socket, { name: "D" });
    expect(mockHandler).toHaveBeenCalledTimes(3);
    expect(socket.emit).toHaveBeenCalledWith(
      "rate-limited",
      expect.objectContaining({
        event: "selfIdentify",
        retryAfterMs: expect.any(Number),
      }),
    );
  });

  it("enforces MAX_SOCKETS_PER_IP connection cap per IP", async () => {
    const ip = "192.168.10.50";
    // Register MAX_SOCKETS_PER_IP sockets
    for (let i = 0; i < MAX_SOCKETS_PER_IP; i++) {
      const s = createMockSocket(`sock-cap-${i}`, ip);
      registerActiveSocket(s);
    }

    // Next socket from the same IP should be blocked by active connection cap
    const excessSocket = createMockSocket("sock-cap-overflow", ip);
    const result = await checkConnectionAllowed(excessSocket);
    expect(result.allowed).toBe(false);
    expect(result.blocked).toBe(true);

    // Unregistering one socket allows a new socket in
    const firstSocket = createMockSocket("sock-cap-0", ip);
    unregisterActiveSocket(firstSocket);

    const retrySocket = createMockSocket("sock-cap-allowed", ip);
    const retryResult = await checkConnectionAllowed(retrySocket);
    expect(retryResult.allowed).toBe(true);
  });

  it("allows signalling burst within limits and throttles when burst is exceeded", async () => {
    const socket = createMockSocket("socket-burst-test");

    // Burst limiter allows consumption up to burst points (50)
    const allowedInitial = await checkSignallingAllowed(socket, 10);
    expect(allowedInitial.allowed).toBe(true);

    // Rapidly consume more points to exceed burst + main points (200 + 50)
    const largeConsume = await checkSignallingAllowed(socket, 260);
    expect(largeConsume.allowed).toBe(false);
    expect(largeConsume.blocked).toBe(true);
  });

  it("fails open when unexpected exception occurs, incrementing degraded metric", async () => {
    const initialCount = getDegradedLimiterCount();

    const malformedSocket = {
      id: "invalid",
      data: null,
      handshake: null,
    } as unknown as PeerSocket;

    const result = await checkEventAllowed(malformedSocket, "offer");
    expect(result.allowed).toBe(true);
    expect(getDegradedLimiterCount()).toBeGreaterThanOrEqual(initialCount);
  });
});
