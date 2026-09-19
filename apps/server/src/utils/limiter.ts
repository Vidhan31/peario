import { BurstyRateLimiter, RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";

import type { PeerSocket, RateLimitedData } from "../types";

import { getPeerIPFromSocket } from "./ip";
import { rateLimitLogger } from "./logger";

const bunEnv = typeof Bun !== "undefined" ? Bun.env : process.env;
const isProduction = bunEnv.NODE_ENV === "production";

const RATE_LIMIT_CONFIG = {
  connection: {
    points: isProduction ? 10 : 200,
    duration: 60,
    blockDuration: isProduction ? 60 * 5 : 1,
  },

  signalling: {
    points: 200,
    duration: 60,
    burstPoints: 50,
    burstDuration: 10,
  },

  events: {
    iceCandidate: { points: 50, duration: 1 },
    offer: { points: 10, duration: 60 },
    answer: { points: 10, duration: 60 },
    connectionRequest: { points: 20, duration: 60 },
    connectionResponse: { points: 30, duration: 60 },
    selfIdentify: { points: 3, duration: 60 },
    identifyPeers: { points: 10, duration: 60 },
  },
} as const;

/**
 * SCALING GAP NOTE:
 * Rate limit counters (connectionLimiter, signallingLimiter, eventLimiters) and
 * activeSocketsPerIP live entirely in process memory.
 * If multiple server instances were deployed without a shared store (e.g. Redis),
 * each instance would allow full quota independently and presence Maps would diverge.
 * This is accepted for single-instance operation.
 */

const connectionLimiter = new RateLimiterMemory({
  keyPrefix: "connection",
  points: RATE_LIMIT_CONFIG.connection.points,
  duration: RATE_LIMIT_CONFIG.connection.duration,
  blockDuration: RATE_LIMIT_CONFIG.connection.blockDuration,
});

const activeSocketsPerIP = new Map<string, Set<string>>();
export const MAX_SOCKETS_PER_IP = 20;

const roomJoinLimiter = new RateLimiterMemory({
  keyPrefix: "room_join",
  points: 15,
  duration: 60,
  blockDuration: 60,
});

export function _resetLimitersForTesting(): void {
  activeSocketsPerIP.clear();
  const limiterWithStorage = roomJoinLimiter as unknown as {
    _memoryStorage?: { _storage?: Record<string, unknown> };
  };
  if (limiterWithStorage._memoryStorage) {
    limiterWithStorage._memoryStorage._storage = {};
  }
}

const signallingLimiter = new BurstyRateLimiter(
  new RateLimiterMemory({
    keyPrefix: "signalling",
    points: RATE_LIMIT_CONFIG.signalling.points,
    duration: RATE_LIMIT_CONFIG.signalling.duration,
  }),
  new RateLimiterMemory({
    keyPrefix: "signalling_burst",
    points: RATE_LIMIT_CONFIG.signalling.burstPoints,
    duration: RATE_LIMIT_CONFIG.signalling.burstDuration,
  }),
);

const eventLimiters = {
  iceCandidate: new RateLimiterMemory({
    keyPrefix: "ice_candidate",
    points: RATE_LIMIT_CONFIG.events.iceCandidate.points,
    duration: RATE_LIMIT_CONFIG.events.iceCandidate.duration,
  }),
  offer: new RateLimiterMemory({
    keyPrefix: "offer",
    points: RATE_LIMIT_CONFIG.events.offer.points,
    duration: RATE_LIMIT_CONFIG.events.offer.duration,
  }),
  answer: new RateLimiterMemory({
    keyPrefix: "answer",
    points: RATE_LIMIT_CONFIG.events.answer.points,
    duration: RATE_LIMIT_CONFIG.events.answer.duration,
  }),
  connectionRequest: new RateLimiterMemory({
    keyPrefix: "connection_request",
    points: RATE_LIMIT_CONFIG.events.connectionRequest.points,
    duration: RATE_LIMIT_CONFIG.events.connectionRequest.duration,
  }),
  connectionResponse: new RateLimiterMemory({
    keyPrefix: "connection_response",
    points: RATE_LIMIT_CONFIG.events.connectionResponse.points,
    duration: RATE_LIMIT_CONFIG.events.connectionResponse.duration,
  }),
  selfIdentify: new RateLimiterMemory({
    keyPrefix: "self_identify",
    points: RATE_LIMIT_CONFIG.events.selfIdentify.points,
    duration: RATE_LIMIT_CONFIG.events.selfIdentify.duration,
  }),
  identifyPeers: new RateLimiterMemory({
    keyPrefix: "identify_peers",
    points: RATE_LIMIT_CONFIG.events.identifyPeers.points,
    duration: RATE_LIMIT_CONFIG.events.identifyPeers.duration,
  }),
} as const;

export type SignallingEventType = keyof typeof eventLimiters;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetMs: number;
  blocked?: boolean;
}

let degradedLimiterEventCount = 0;
export function getDegradedLimiterCount(): number {
  return degradedLimiterEventCount;
}

function getRateLimitKey(socket: PeerSocket): string {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- socket.data is null for malformed sockets; fail-open contract pinned by limiter.test.ts
  if (socket.data?.id) {
    return `peer:${socket.data.id}`;
  }
  return `socket:${socket.id}`;
}

function getIPKey(socket: PeerSocket): string {
  return getPeerIPFromSocket(socket) || socket.id;
}

function createRateLimitResult(res: RateLimiterRes): RateLimitResult {
  return {
    allowed: true,
    remaining: Math.max(0, Math.floor(res.remainingPoints)),
    resetMs: Math.max(0, Math.ceil(res.msBeforeNext)),
  };
}

function createBlockedResult(res: RateLimiterRes): RateLimitResult {
  return {
    allowed: false,
    remaining: 0,
    resetMs: Math.max(0, Math.ceil(res.msBeforeNext)),
    blocked: true,
  };
}

export async function checkConnectionAllowed(socket: PeerSocket): Promise<RateLimitResult> {
  const ip = getIPKey(socket);

  const activeSockets = activeSocketsPerIP.get(ip);
  if (activeSockets && activeSockets.size >= MAX_SOCKETS_PER_IP) {
    return {
      allowed: false,
      remaining: 0,
      resetMs: 0,
      blocked: true,
    };
  }

  try {
    const res = await connectionLimiter.consume(ip);
    return createRateLimitResult(res);
  } catch (rejRes) {
    if (rejRes instanceof RateLimiterRes) {
      return createBlockedResult(rejRes);
    }
    // Fail-open for system exceptions with error log and metric bump
    degradedLimiterEventCount++;
    rateLimitLogger.error(
      `Connection rate limiter error (degraded service metric: ${degradedLimiterEventCount}):`,
      rejRes,
    );
    return { allowed: true, remaining: 0, resetMs: 0 };
  }
}

export function registerActiveSocket(socket: PeerSocket): void {
  const ip = getIPKey(socket);

  let sockets = activeSocketsPerIP.get(ip);
  if (!sockets) {
    sockets = new Set();
    activeSocketsPerIP.set(ip, sockets);
  }
  sockets.add(socket.id);
}

export function unregisterActiveSocket(socket: PeerSocket): void {
  const ip = getIPKey(socket);

  const sockets = activeSocketsPerIP.get(ip);
  if (sockets) {
    sockets.delete(socket.id);
    if (sockets.size === 0) {
      activeSocketsPerIP.delete(ip);
    }
  }
}

export async function checkSignallingAllowed(socket: PeerSocket, pointsToConsume = 1): Promise<RateLimitResult> {
  const key = getRateLimitKey(socket);

  try {
    const res = await signallingLimiter.consume(key, pointsToConsume);
    return createRateLimitResult(res);
  } catch (rejRes) {
    if (rejRes instanceof RateLimiterRes) {
      return createBlockedResult(rejRes);
    }
    degradedLimiterEventCount++;
    rateLimitLogger.error(
      `Signalling rate limiter error (degraded service metric: ${degradedLimiterEventCount}):`,
      rejRes,
    );
    return { allowed: true, remaining: 0, resetMs: 0 };
  }
}

export async function checkEventAllowed(
  socket: PeerSocket,
  eventType: SignallingEventType,
  pointsToConsume = 1,
): Promise<RateLimitResult> {
  const key = getRateLimitKey(socket);
  const limiter = eventLimiters[eventType];

  try {
    const res = await limiter.consume(key, pointsToConsume);
    return createRateLimitResult(res);
  } catch (rejRes) {
    if (rejRes instanceof RateLimiterRes) {
      return createBlockedResult(rejRes);
    }
    degradedLimiterEventCount++;
    rateLimitLogger.error(
      `Event rate limiter error for ${eventType} (degraded service metric: ${degradedLimiterEventCount}):`,
      rejRes,
    );
    return { allowed: true, remaining: 0, resetMs: 0 };
  }
}

export async function checkEventRateLimit(
  socket: PeerSocket,
  eventType: SignallingEventType,
): Promise<RateLimitResult> {
  const signallingResult = await checkSignallingAllowed(socket);
  if (!signallingResult.allowed) {
    return signallingResult;
  }

  return checkEventAllowed(socket, eventType);
}

export function emitRateLimitError(socket: PeerSocket, eventType: string, result: RateLimitResult): void {
  const retryAfterMs = Math.max(0, Math.ceil(result.resetMs));
  rateLimitLogger.warn(`Rate limited: socket ${socket.id}, event: ${eventType}, retry in ${retryAfterMs}ms`);
  const rateLimitedData: RateLimitedData = {
    event: eventType,
    retryAfterMs,
    message: "Too many requests. Please slow down.",
  };
  socket.emit("rate-limited", rateLimitedData);
}

export function withRateLimit<T>(
  eventType: SignallingEventType,
  handler: (socket: PeerSocket, data: T) => void | Promise<void>,
): (socket: PeerSocket, data: T) => Promise<void> {
  return async (socket: PeerSocket, data: T) => {
    const result = await checkEventRateLimit(socket, eventType);

    if (!result.allowed) {
      emitRateLimitError(socket, eventType, result);
      return;
    }

    await handler(socket, data);
  };
}

export function withRateLimitIO<TIO, TData = void>(
  eventType: SignallingEventType,
  handler: (io: TIO, socket: PeerSocket, data?: TData) => void | Promise<void>,
): (io: TIO, socket: PeerSocket, data?: TData) => Promise<void> {
  return async (io: TIO, socket: PeerSocket, data?: TData) => {
    const result = await checkEventRateLimit(socket, eventType);

    if (!result.allowed) {
      emitRateLimitError(socket, eventType, result);
      return;
    }

    await handler(io, socket, data);
  };
}

export async function checkRoomJoinAllowed(roomId: string): Promise<{ allowed: boolean; retryAfterMs: number }> {
  try {
    await roomJoinLimiter.consume(`room:${roomId}`, 1);
    return { allowed: true, retryAfterMs: 0 };
  } catch (rej: unknown) {
    if (rej && typeof rej === "object" && "msBeforeNext" in rej) {
      return { allowed: false, retryAfterMs: (rej as RateLimiterRes).msBeforeNext };
    }
    return { allowed: false, retryAfterMs: 60000 };
  }
}
