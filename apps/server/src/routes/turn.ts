import type { Server as BunServer } from "bun";

import { RoomIdSchema, RTCIceServerListSchema } from "@peario/shared";
import { RateLimiterMemory, RateLimiterRes } from "rate-limiter-flexible";

import type { PeerServer } from "../types";

import { logger } from "../utils/logger";
import { getPeerInfoByPersonalRoomId } from "../utils/peer";

const bunEnv = typeof Bun !== "undefined" ? Bun.env : process.env;

// In-memory record of recent self-identifications (IP -> timestamp)
const recentSelfIdentifications = new Map<string, number>();

export function recordRecentSelfIdentify(ip: string): void {
  recentSelfIdentifications.set(ip, Date.now());
}

export function hasRecentSelfIdentify(ip: string, maxAgeMs = 3600000): boolean {
  const ts = recentSelfIdentifications.get(ip);
  if (!ts) return false;
  if (Date.now() - ts > maxAgeMs) {
    recentSelfIdentifications.delete(ip);
    return false;
  }
  return true;
}

export function _clearRecentSelfIdentificationsForTesting(): void {
  recentSelfIdentifications.clear();
}

// 10 requests per hour per IP
const turnLimiter = new RateLimiterMemory({
  keyPrefix: "turn_credentials",
  points: 10,
  duration: 3600,
});

export function _resetTurnLimiterForTesting(): void {
  // @ts-expect-error -- internal property access for test isolation
  turnLimiter._points = 10;
}

export interface TurnRouteOptions {
  isProduction?: boolean;
  allowedOrigins?: string[];
  isOriginAllowedFn?: (origin: string | undefined, isProd: boolean, allowed: string[]) => boolean;
  io?: PeerServer;
}

export async function handleTurnCredentialsRequest(
  req: Request,
  server: BunServer<unknown>,
  options: TurnRouteOptions = {},
): Promise<Response> {
  const isProduction = options.isProduction ?? bunEnv.NODE_ENV === "production";
  const allowedOrigins = options.allowedOrigins ?? [];
  const origin = req.headers.get("origin");

  const corsHeaders: Record<string, string> = {
    "Cache-Control": "no-store",
    "Content-Type": "application/json",
  };

  const isOriginValid = options.isOriginAllowedFn
    ? options.isOriginAllowedFn(origin ?? undefined, isProduction, allowedOrigins)
    : !isProduction || (origin !== null && allowedOrigins.includes(origin));

  if (origin && isOriginValid) {
    corsHeaders["Access-Control-Allow-Origin"] = origin;
    corsHeaders["Access-Control-Allow-Credentials"] = "true";
    corsHeaders["Access-Control-Allow-Methods"] = "GET, OPTIONS";
    corsHeaders["Access-Control-Allow-Headers"] = "Content-Type, X-Request-Id, Authorization";
  } else if (!isProduction && !origin) {
    corsHeaders["Access-Control-Allow-Origin"] = "*";
  }

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: corsHeaders,
    });
  }

  // 1. Extract client IP
  const directIP = server.requestIP(req)?.address;
  const ip =
    directIP ??
    req.headers.get("x-bun-client-ip") ??
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "127.0.0.1";

  // 2. Validate room context or recent self-identify
  let url: URL;
  try {
    url = new URL(req.url);
  } catch {
    return new Response(JSON.stringify({ error: "Malformed URL" }), {
      status: 400,
      headers: corsHeaders,
    });
  }

  const queryRoomId = url.searchParams.get("roomId") ?? req.headers.get("x-room-id");
  const querySocketId = url.searchParams.get("socketId") ?? req.headers.get("x-socket-id");

  let isAuthorized = false;

  if (queryRoomId && RoomIdSchema.safeParse(queryRoomId).success) {
    const roomInAdapter = options.io?.sockets.adapter.rooms.has(queryRoomId);
    const peerInPersonalRoom = getPeerInfoByPersonalRoomId(queryRoomId);
    if (roomInAdapter || peerInPersonalRoom || !isProduction) {
      isAuthorized = true;
    }
  }

  if (!isAuthorized && querySocketId && options.io) {
    const targetSocket = options.io.sockets.sockets.get(querySocketId);
    if (targetSocket?.data.name || targetSocket?.data.id) {
      isAuthorized = true;
    }
  }

  if (!isAuthorized) {
    if (hasRecentSelfIdentify(ip)) {
      isAuthorized = true;
    } else if (options.io) {
      for (const s of options.io.sockets.sockets.values()) {
        const sHeaders = (s.request as { headers?: Record<string, string | undefined> } | undefined)?.headers;
        const sIP =
          s.handshake.address ||
          (typeof sHeaders?.["x-bun-client-ip"] === "string" ? sHeaders["x-bun-client-ip"] : undefined);
        if (sIP === ip && (s.data.id || s.data.name)) {
          isAuthorized = true;
          break;
        }
      }
    }
  }

  if (!isAuthorized) {
    return new Response(JSON.stringify({ error: "Room context or recent self-identification required" }), {
      status: 403,
      headers: corsHeaders,
    });
  }

  // 3. Rate limiting per IP (10 requests/hour)
  try {
    await turnLimiter.consume(ip);
  } catch (rejRes) {
    if (rejRes instanceof RateLimiterRes) {
      const retrySec = Math.ceil(rejRes.msBeforeNext / 1000);
      return new Response(JSON.stringify({ error: "Too many TURN requests" }), {
        status: 429,
        headers: {
          ...corsHeaders,
          "Retry-After": String(retrySec),
        },
      });
    }
  }

  // 4. Read server secrets from environment
  const appName = bunEnv.METERED_APP_NAME;
  const secretKey = bunEnv.METERED_SECRET_KEY;

  if (!appName || !secretKey) {
    return new Response(JSON.stringify({ error: "TURN relay service not configured" }), {
      status: 503,
      headers: corsHeaders,
    });
  }

  // 5. Call Metered API for expiring credentials
  const today = new Date().toISOString().slice(0, 10);
  const label = queryRoomId ? `room-${queryRoomId}` : `pear-${today}`;
  const expiryInSeconds = 14400;

  try {
    let meteredRes = await fetch(
      `https://${appName}.metered.live/api/v1/turn/credential?secretKey=${encodeURIComponent(secretKey)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ expiryInSeconds, label }),
        signal: AbortSignal.timeout(5000),
      },
    );

    if (!meteredRes.ok && (meteredRes.status === 404 || meteredRes.status === 405)) {
      meteredRes = await fetch(
        `https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${encodeURIComponent(secretKey)}`,
        {
          method: "GET",
          signal: AbortSignal.timeout(5000),
        },
      );
    }

    if (!meteredRes.ok) {
      // Log status code ONLY (never secrets or body)
      logger.warn(`Metered TURN request failed with status: ${meteredRes.status}`);
      return new Response(JSON.stringify({ error: "Failed to obtain TURN credentials" }), {
        status: 502,
        headers: corsHeaders,
      });
    }

    const rawPayload: unknown = await meteredRes.json();
    const serverList = Array.isArray(rawPayload)
      ? rawPayload
      : typeof rawPayload === "object" &&
          rawPayload !== null &&
          "iceServers" in rawPayload &&
          Array.isArray(rawPayload.iceServers)
        ? rawPayload.iceServers
        : null;

    const parsed = RTCIceServerListSchema.safeParse(serverList);
    if (!parsed.success || parsed.data.length === 0) {
      logger.warn("Metered TURN payload validation failed against RTCIceServerListSchema");
      return new Response(JSON.stringify({ error: "Invalid TURN server list" }), {
        status: 502,
        headers: corsHeaders,
      });
    }

    return new Response(JSON.stringify(parsed.data), {
      status: 200,
      headers: corsHeaders,
    });
  } catch {
    logger.warn("Metered TURN request encountered a network or timeout failure");
    return new Response(JSON.stringify({ error: "TURN gateway failure" }), {
      status: 502,
      headers: corsHeaders,
    });
  }
}
