import { RTCIceServerListSchema, RTCIceServerSchema } from "@peario/shared";

import { QUERY_PARAMS, STORAGE_KEYS } from "../constants/index.ts";
import { webrtcLogger } from "./logger";

export { RTCIceServerListSchema, RTCIceServerSchema };

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

function envString(key: string): string | undefined {
  const value: unknown = import.meta.env[key];
  return typeof value === "string" && value !== "" ? value : undefined;
}

const TURN_SECRET_CODE = envString("VITE_TURN_SECRET") ?? "pearvee";
const STORAGE_KEY = STORAGE_KEYS.TURN_ENABLED;

let cachedIceServers: RTCIceServer[] = DEFAULT_ICE_SERVERS;
let fetchPromise: Promise<RTCIceServer[]> | null = null;

export function _resetIceServersForTesting(): void {
  cachedIceServers = DEFAULT_ICE_SERVERS;
  fetchPromise = null;
}

export function checkAndActivateTurnFromUrl(): boolean {
  if (typeof window === "undefined") return false;

  try {
    const params = new URLSearchParams(window.location.search);
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- first non-empty param wins; an empty ?turn= must not shadow ?relay=/secret-code
    const turnParam = params.get(QUERY_PARAMS.TURN) || params.get(QUERY_PARAMS.RELAY) || params.get(QUERY_PARAMS.CODE);

    if (turnParam === TURN_SECRET_CODE) {
      if (typeof sessionStorage !== "undefined") {
        sessionStorage.setItem(STORAGE_KEY, "true");
      }
      webrtcLogger.info("🚀 Metered TURN servers unlocked and activated for this session.");

      // Clean up secret parameter from URL bar while preserving other params (e.g. ?room=...)
      params.delete(QUERY_PARAMS.TURN);
      params.delete(QUERY_PARAMS.RELAY);
      params.delete(QUERY_PARAMS.CODE);
      const remainingQuery = params.toString();
      const newUrl = window.location.pathname + (remainingQuery ? `?${remainingQuery}` : "");
      window.history.replaceState({}, document.title, newUrl);
      return true;
    }
  } catch (err) {
    webrtcLogger.error("Failed to parse URL for TURN secret:", err);
  }

  return isTurnEnabled();
}

export function isTurnEnabled(): boolean {
  if (typeof window === "undefined" || typeof sessionStorage === "undefined") return false;
  return sessionStorage.getItem(STORAGE_KEY) === "true";
}

function getTurnProxyEndpoint(): string {
  const serverUrl = envString("VITE_SIGNALING_SERVER_URL");
  if (serverUrl) {
    return `${serverUrl.replace(/\/+$/, "")}/api/turn-credentials`;
  }
  return "/api/turn-credentials";
}

export async function fetchIceServers(context?: { roomId?: string; socketId?: string }): Promise<RTCIceServer[]> {
  checkAndActivateTurnFromUrl();

  if (!isTurnEnabled()) {
    webrtcLogger.debug("TURN is disabled for this session. Using default STUN servers (direct P2P).");
    return DEFAULT_ICE_SERVERS;
  }

  if (cachedIceServers !== DEFAULT_ICE_SERVERS) {
    return cachedIceServers;
  }

  if (fetchPromise) {
    return fetchPromise;
  }

  fetchPromise = (async () => {
    // 1. Try server TURN proxy endpoint first with 5s abort timeout
    try {
      webrtcLogger.info("Fetching TURN credentials from server proxy...");
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, 5000);

      const baseUrl = getTurnProxyEndpoint();
      const url = new URL(baseUrl, typeof window !== "undefined" ? window.location.origin : "http://localhost:8080");
      if (context?.roomId) {
        url.searchParams.set("roomId", context.roomId);
      }
      if (context?.socketId) {
        url.searchParams.set("socketId", context.socketId);
      }

      const res = await fetch(url.toString(), {
        signal: controller.signal,
        headers: { Accept: "application/json" },
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const rawData: unknown = await res.json();
        const validation = RTCIceServerListSchema.safeParse(rawData);
        if (validation.success && validation.data.length > 0) {
          webrtcLogger.info(
            `Successfully fetched and validated ${validation.data.length} ICE servers from server proxy.`,
          );
          cachedIceServers = validation.data as RTCIceServer[];
          return cachedIceServers;
        }
      }
      webrtcLogger.warn(`Server TURN proxy returned status ${res.status}, evaluating fallback...`);
    } catch (serverErr) {
      webrtcLogger.warn("Failed to fetch TURN credentials from server proxy:", serverErr);
    }

    // 2. Keep existing env reads working until the flip
    const appName = envString("VITE_METERED_APP_NAME");
    const apiKey = envString("VITE_METERED_API_KEY");

    if (appName && apiKey) {
      try {
        webrtcLogger.info(`Fetching Metered TURN servers directly (${appName})...`);
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          controller.abort();
        }, 5000);

        const res = await fetch(`https://${appName}.metered.live/api/v1/turn/credentials?apiKey=${apiKey}`, {
          signal: controller.signal,
        });
        clearTimeout(timeoutId);

        if (res.ok) {
          const rawData: unknown = await res.json();
          const validation = RTCIceServerListSchema.safeParse(rawData);

          if (validation.success && validation.data.length > 0) {
            webrtcLogger.info(
              `Successfully fetched and validated ${validation.data.length} ICE servers from Metered direct.`,
            );
            cachedIceServers = validation.data as RTCIceServer[];
            return cachedIceServers;
          }
        }
      } catch (directErr) {
        webrtcLogger.warn("Failed to fetch direct Metered ICE servers:", directErr);
      }
    }

    // 3. Fall back to DEFAULT_ICE_SERVERS on any error
    webrtcLogger.info("Falling back to default STUN servers.");
    return DEFAULT_ICE_SERVERS;
  })();

  return fetchPromise;
}

export function getCachedIceServers(): RTCIceServer[] {
  return isTurnEnabled() ? cachedIceServers : DEFAULT_ICE_SERVERS;
}
