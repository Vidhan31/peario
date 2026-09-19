import type { Server as BunServer } from "bun";

import { Server as Engine } from "@socket.io/bun-engine";
import path from "node:path";
import { Server } from "socket.io";

import type { ClientToServerEvents, InterServerEvents, PeerSocket, ServerToClientEvents, SocketData } from "./types";

import { handleConnectionRequest, handleConnectToRoom } from "./handlers/connection";
import { handleDisconnect } from "./handlers/disconnect";
import { handleIdentifyPeers, handleSelfIdentify } from "./handlers/identity";
import { handleAnswer, handleIceCandidate, handleOffer } from "./handlers/signaling";
import { handleClientErrorRequest } from "./routes/clientErrors";
import { handleTurnCredentialsRequest } from "./routes/turn";
import { checkTrustedProxiesConfig, resolveIPFromHeaders } from "./utils/ip";
import {
  checkConnectionAllowed,
  registerActiveSocket,
  unregisterActiveSocket,
  withRateLimit,
  withRateLimitIO,
} from "./utils/limiter";
import { logger, rateLimitLogger, socketLogger } from "./utils/logger";

type PartialSocketData = Partial<SocketData>;

const bunEnv = typeof Bun !== "undefined" ? Bun.env : process.env;
const isProduction = bunEnv.NODE_ENV === "production";
const PORT = Number(bunEnv.PORT) || 8080;

checkTrustedProxiesConfig();
logger.info("Starting in memory-only mode. Single instance expectation: state is non-distributed (no Redis).");

const ALLOWED_ORIGINS: string[] = bunEnv.ALLOWED_ORIGINS
  ? bunEnv.ALLOWED_ORIGINS.split(",")
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0)
  : isProduction
    ? []
    : ["https://localhost:5137", "https://127.0.0.1:5137", "http://localhost:5137", "http://127.0.0.1:5137"];

if (isProduction && ALLOWED_ORIGINS.length === 0) {
  logger.warn(
    "No ALLOWED_ORIGINS configured in production environment. Cross-origin signaling requests will be rejected.",
  );
}

export function isOriginAllowed(origin: string | undefined, isProd = isProduction, allowed = ALLOWED_ORIGINS): boolean {
  if (!isProd) {
    return true;
  }
  if (!origin) {
    return false;
  }
  return allowed.includes(origin);
}

let isDraining = false;

export function _resetDrainForTesting(): void {
  isDraining = false;
}

export function allowRequestHandler(
  req: Request,
  server: BunServer<unknown>,
  isProd = isProduction,
  allowed = ALLOWED_ORIGINS,
): void {
  if (isDraining) {
    throw new Error("Server is shutting down");
  }
  if (!isProd) {
    return;
  }
  const origin = req.headers.get("origin");
  if (origin && isOriginAllowed(origin, isProd, allowed)) {
    return;
  }
  const directIP = server.requestIP(req)?.address;
  const ip = directIP ?? req.headers.get("x-bun-client-ip") ?? req.headers.get("x-forwarded-for") ?? "unknown";
  logger.warn(`Rejected connection from unauthorized origin: ${origin ?? "none"} (IP: ${ip})`);
  throw new Error("Unauthorized origin");
}

export const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, PartialSocketData>({
  pingInterval: 25000,
  pingTimeout: 60000,
  // Raising maxHttpBufferSize stalls heartbeats and risks memory
  maxHttpBufferSize: 1e6,
  transports: ["websocket", "polling"],
});

const engine = new Engine({
  path: "/socket.io/",
  pingInterval: 25000,
  pingTimeout: 60000,
  // Raising maxHttpBufferSize stalls heartbeats and risks memory
  maxHttpBufferSize: 1e6,
  cors: {
    origin: isProduction ? ALLOWED_ORIGINS : true,
    methods: ["GET", "POST", "OPTIONS"],
    credentials: true,
  },
  allowRequest: (req: Request, server: BunServer<unknown>) => {
    allowRequestHandler(req, server);
    return Promise.resolve();
  },
});

io.bind(engine);

io.use((socket: PeerSocket, next) => {
  const reqHeaders = (socket.request as { headers?: Record<string, string | undefined> } | undefined)?.headers;
  // Bun engine does not automatically set socket.handshake.address; extract from internal header if present
  if (!socket.handshake.address) {
    const raw = reqHeaders?.["x-bun-client-ip"];
    if (typeof raw === "string" && raw.length > 0) {
      socket.handshake.address = raw;
    }
  }

  const requestId = reqHeaders?.["x-request-id"];
  const reqIdStr = requestId ? ` [requestId: ${requestId}]` : "";

  checkConnectionAllowed(socket)
    .then((result) => {
      if (!result.allowed) {
        rateLimitLogger.warn(
          `Connection rate limited for socket ${socket.id}${reqIdStr}, retry in ${result.resetMs}ms`,
        );
        next(new Error("Too many connections. Please try again later."));
        return;
      }

      registerActiveSocket(socket);
      const origin = socket.handshake.headers.origin ?? "none";
      const transport = socket.conn.transport.name;
      socketLogger.debug(`Socket connected: ${socket.id} [transport: ${transport}, origin: ${origin}]${reqIdStr}`);
      next();
    })
    .catch((err: unknown) => {
      logger.error(`Error in connection rate limiting middleware for socket ${socket.id}${reqIdStr}:`, err);
      next(new Error("Internal error checking connection allowance."));
    });
});

export const rateLimitedHandlers = {
  selfIdentify: withRateLimit("selfIdentify", handleSelfIdentify),
  identifyPeers: withRateLimitIO("identifyPeers", handleIdentifyPeers),
  connectionRequest: withRateLimitIO("connectionRequest", handleConnectionRequest),
  connectToRoom: withRateLimitIO("connectionRequest", handleConnectToRoom),
  offer: withRateLimitIO("offer", handleOffer),
  answer: withRateLimitIO("answer", handleAnswer),
  iceCandidate: withRateLimitIO("iceCandidate", handleIceCandidate),
};

export interface SocketHandlerMap {
  "self-identify": [data: unknown];
  "identify-peers": [];
  "connection-request": [data: unknown];
  "connect-to-room": [data: unknown];
  offer: [data: unknown];
  answer: [data: unknown];
  "ice-candidate": [data: unknown];
  disconnect: [reason?: string, description?: unknown];
  [key: string]: unknown[];
}

export function registerSocketHandler<K extends string>(
  socket: PeerSocket,
  eventName: K,
  handler: (...args: K extends keyof SocketHandlerMap ? SocketHandlerMap[K] : unknown[]) => void | Promise<void>,
): void {
  socket.on(eventName as Parameters<PeerSocket["on"]>[0], (...args: unknown[]) => {
    try {
      const result = handler(...(args as Parameters<typeof handler>));
      if (result && typeof result.catch === "function") {
        void result.catch((err: unknown) => {
          logger.error(`Unhandled error in socket handler for event "${eventName}" (socket ID: ${socket.id}):`, err);
        });
      }
    } catch (err: unknown) {
      logger.error(`Synchronous error in socket handler for event "${eventName}" (socket ID: ${socket.id}):`, err);
    }
  });
}

io.on("connection", (socket: PeerSocket) => {
  socketLogger.trace(`New connection from socket: ${socket.id}`);

  registerSocketHandler(socket, "self-identify", (data) => {
    return rateLimitedHandlers.selfIdentify(socket, data);
  });

  registerSocketHandler(socket, "identify-peers", () => {
    return rateLimitedHandlers.identifyPeers(io, socket);
  });

  registerSocketHandler(socket, "connection-request", (data) => {
    return rateLimitedHandlers.connectionRequest(io, socket, data);
  });

  registerSocketHandler(socket, "connect-to-room", (data) => {
    return rateLimitedHandlers.connectToRoom(io, socket, data);
  });

  registerSocketHandler(socket, "offer", (data) => {
    return rateLimitedHandlers.offer(io, socket, data);
  });

  registerSocketHandler(socket, "answer", (data) => {
    return rateLimitedHandlers.answer(io, socket, data);
  });

  registerSocketHandler(socket, "ice-candidate", (data) => {
    return rateLimitedHandlers.iceCandidate(io, socket, data);
  });

  registerSocketHandler(socket, "disconnect", () => {
    unregisterActiveSocket(socket);
    handleDisconnect(socket);
  });
});

export async function gracefulDrain(
  signal = "SIGTERM",
  exitFn: (code: number) => void = (code) => process.exit(code),
): Promise<void> {
  if (isDraining) {
    return;
  }
  isDraining = true;
  logger.info(`Received ${signal}. Starting graceful connection drain...`);

  const timeoutTimer = setTimeout(() => {
    logger.warn("Graceful drain timed out after 25s. Forcing exit.");
    exitFn(0);
  }, 25000);

  if (typeof timeoutTimer.unref === "function") {
    timeoutTimer.unref();
  }

  try {
    for (const socket of io.sockets.sockets.values()) {
      try {
        socket.emit("identity-error", { message: "Server is restarting" });
        socket.disconnect(true);
      } catch (err: unknown) {
        logger.error(`Error disconnecting socket ${socket.id} during shutdown:`, err);
      }
    }

    engine.close();
    await io.close();
    logger.info("Graceful drain finished. All connections closed.");
  } catch (err: unknown) {
    logger.error("Error during graceful shutdown drain:", err);
  } finally {
    clearTimeout(timeoutTimer);
    exitFn(0);
  }
}

if (typeof process !== "undefined" && typeof process.on === "function") {
  process.on("SIGTERM", () => {
    void gracefulDrain("SIGTERM");
  });
  process.on("SIGINT", () => {
    void gracefulDrain("SIGINT");
  });
}

const currentDir =
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- import.meta.dirname is absent on older Node runtimes; the fallbacks keep local dev working there
  import.meta.dirname ??
  (import.meta as unknown as { dir?: string }).dir ??
  path.dirname(new URL(import.meta.url).pathname);
// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty env path means "unset" and must fall back to the local dev cert
const certPath = bunEnv.TLS_CERT_PATH || path.resolve(currentDir, "../../../.certs/cert.pem");
// eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty env path means "unset" and must fall back to the local dev key
const keyPath = bunEnv.TLS_KEY_PATH || path.resolve(currentDir, "../../../.certs/dev.pem");

let tlsConfig: { cert: unknown; key: unknown } | undefined = undefined;

if (typeof Bun !== "undefined") {
  if (!isProduction) {
    const certFile = Bun.file(certPath);
    const keyFile = Bun.file(keyPath);
    if (certFile.size > 0 && keyFile.size > 0) {
      tlsConfig = {
        cert: certFile,
        key: keyFile,
      };
      logger.debug("Loaded local TLS certificates from .certs");
    }
  } else {
    logger.info("Proxy TLS is expected in production; local cert loading skipped.");
  }
}

const engineHandler = engine.handler();

export default {
  port: PORT,
  hostname: isProduction ? "0.0.0.0" : undefined,
  tls: tlsConfig,
  fetch: async (req: Request, server: BunServer<unknown>) => {
    if (isDraining) {
      return new Response("Service Unavailable: Server is shutting down", { status: 503 });
    }

    let url: URL;
    try {
      url = new URL(req.url);
    } catch {
      return new Response("Bad Request: Malformed URL", { status: 400 });
    }

    if (url.pathname === "/" || url.pathname === "/health") {
      return new Response("OK", { status: 200 });
    }

    if (url.pathname === "/ready") {
      const uptime = process.uptime();
      const version = bunEnv.GIT_SHA ?? "unknown";
      return Response.json(
        {
          ok: true,
          uptime,
          version,
        },
        { status: 200 },
      );
    }

    if (url.pathname === "/debug-ip") {
      if (isProduction) {
        return new Response("Not Found", { status: 404 });
      }

      const debugToken =
        bunEnv.DEBUG_IP_TOKEN ?? (typeof process !== "undefined" ? process.env.DEBUG_IP_TOKEN : undefined);
      const reqToken = req.headers.get("x-debug-token");
      if (!debugToken || reqToken !== debugToken) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      }

      const directAddress = server.requestIP(req)?.address ?? "127.0.0.1";
      const result = resolveIPFromHeaders(directAddress, (name) => req.headers.get(name));

      return new Response(
        JSON.stringify({
          directAddress,
          parsedIP: result.ip,
          trusted: result.trusted,
          headers: {
            "cf-connecting-ip": req.headers.get("cf-connecting-ip"),
            "x-forwarded-for": req.headers.get("x-forwarded-for"),
            forwarded: req.headers.get("forwarded"),
            "fastly-client-ip": req.headers.get("fastly-client-ip"),
          },
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (url.pathname === "/api/turn-credentials") {
      return handleTurnCredentialsRequest(req, server, {
        isProduction,
        allowedOrigins: ALLOWED_ORIGINS,
        isOriginAllowedFn: isOriginAllowed,
        io,
      });
    }

    if (url.pathname === "/api/client-errors") {
      return handleClientErrorRequest(req, server, {
        isProduction,
        allowedOrigins: ALLOWED_ORIGINS,
        isOriginAllowedFn: isOriginAllowed,
      });
    }

    const requestId = req.headers.get("x-request-id");
    const reqIdStr = requestId ? ` [requestId: ${requestId}]` : "";

    const directClientIP = server.requestIP(req)?.address;
    if (directClientIP) {
      req.headers.set("x-bun-client-ip", directClientIP);
    }

    try {
      const response = await engineHandler.fetch(req, server);
      if (requestId) {
        response.headers.set("x-request-id", requestId);
      }
      return response;
    } catch (error: unknown) {
      logger.error(`Engine handler fetch error${reqIdStr}:`, error);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
  websocket: engineHandler.websocket,
};
