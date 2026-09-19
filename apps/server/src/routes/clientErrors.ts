import type { Server as BunServer } from "bun";

import { ClientErrorReportSchema, validatePayload } from "@peario/shared";
import { RateLimiterMemory } from "rate-limiter-flexible";

import { getPeerIPFromRequest } from "../utils/ip";
import { logger } from "../utils/logger";

const clientErrorLimiter = new RateLimiterMemory({
  keyPrefix: "client_errors",
  points: 20,
  duration: 60,
});

export function _resetClientErrorLimiterForTesting(): void {
  const limiterWithStorage = clientErrorLimiter as unknown as {
    _memoryStorage?: { _storage?: Record<string, unknown> };
  };
  if (limiterWithStorage._memoryStorage) {
    limiterWithStorage._memoryStorage._storage = {};
  }
}

export interface ClientErrorRouteOptions {
  isProduction: boolean;
  allowedOrigins: string[];
  isOriginAllowedFn: (origin: string | undefined, isProd: boolean, allowed: string[]) => boolean;
}

export async function handleClientErrorRequest(
  req: Request,
  server: BunServer<unknown>,
  options: ClientErrorRouteOptions,
): Promise<Response> {
  const origin = req.headers.get("origin") ?? undefined;
  if (!options.isOriginAllowedFn(origin, options.isProduction, options.allowedOrigins)) {
    return new Response(JSON.stringify({ error: "Unauthorized origin" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  const corsHeaders: Record<string, string> = {};
  if (origin) {
    corsHeaders["Access-Control-Allow-Origin"] = origin;
    corsHeaders["Access-Control-Allow-Credentials"] = "true";
  }

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        ...corsHeaders,
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Request-Id",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const clientIP = getPeerIPFromRequest(req, server);
  try {
    await clientErrorLimiter.consume(clientIP, 1);
  } catch {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Malformed JSON payload" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const validation = validatePayload(ClientErrorReportSchema, body);
  if (!validation.success) {
    return new Response(JSON.stringify({ error: "Invalid error report payload" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const report = validation.data;
  const requestId = req.headers.get("x-request-id");
  const reqIdStr = requestId ? ` [requestId: ${requestId}]` : "";

  logger.warn(
    `Client reported error${reqIdStr}: event=${report.eventType}, reason="${report.reason ?? "none"}", isRelay=${String(report.isRelay ?? "unknown")}, peerId=${report.peerId ?? "none"}`,
  );

  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}
