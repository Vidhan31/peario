import type { Server as BunServer } from "bun";
import type { IncomingHttpHeaders } from "node:http";
import type { Socket } from "socket.io";

import { isIP } from "node:net";

import { logger } from "./logger";

function getTrustedProxiesEnv(): string {
  if (typeof process !== "undefined" && process.env.TRUSTED_PROXIES) {
    return process.env.TRUSTED_PROXIES;
  }
  if (typeof Bun !== "undefined" && Bun.env.TRUSTED_PROXIES) {
    return Bun.env.TRUSTED_PROXIES;
  }
  return "";
}

let hasLoggedTrustedProxyWarning = false;

export function checkTrustedProxiesConfig(): void {
  const isProd =
    (typeof process !== "undefined" && process.env.NODE_ENV === "production") ||
    (typeof Bun !== "undefined" && Bun.env.NODE_ENV === "production");
  const rawTrusted = getTrustedProxiesEnv();
  if (isProd && (!rawTrusted || rawTrusted.trim() === "")) {
    if (!hasLoggedTrustedProxyWarning) {
      hasLoggedTrustedProxyWarning = true;
      logger.warn(
        "TRUSTED_PROXIES is not set in production! Reverse proxy headers will be ignored and client IPs will fall back to direct socket addresses.",
      );
    }
  }
}

export function _resetTrustedProxyWarningForTesting(): void {
  hasLoggedTrustedProxyWarning = false;
}

/**
 * Checks if an IPv4 address falls within a given CIDR block (e.g. "10.0.0.0/8" or "192.168.1.0/24")
 */
function isIPv4InCIDR(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split("/");
  if (!range || !bitsStr) return false;
  const bits = parseInt(bitsStr, 10);
  if (isNaN(bits) || bits < 0 || bits > 32) return false;

  const ipOctets = ip.split(".").map((o) => parseInt(o, 10));
  const rangeOctets = range.split(".").map((o) => parseInt(o, 10));
  if (ipOctets.length !== 4 || rangeOctets.length !== 4) return false;
  if (ipOctets.some((o) => isNaN(o) || o < 0 || o > 255)) return false;
  if (rangeOctets.some((o) => isNaN(o) || o < 0 || o > 255)) return false;

  const ip0 = ipOctets[0] ?? 0;
  const ip1 = ipOctets[1] ?? 0;
  const ip2 = ipOctets[2] ?? 0;
  const ip3 = ipOctets[3] ?? 0;
  const range0 = rangeOctets[0] ?? 0;
  const range1 = rangeOctets[1] ?? 0;
  const range2 = rangeOctets[2] ?? 0;
  const range3 = rangeOctets[3] ?? 0;

  const ipNum = ((ip0 << 24) | (ip1 << 16) | (ip2 << 8) | ip3) >>> 0;
  const rangeNum = ((range0 << 24) | (range1 << 16) | (range2 << 8) | range3) >>> 0;

  if (bits === 0) return true;
  const mask = (~0 << (32 - bits)) >>> 0;
  return (ipNum & mask) === (rangeNum & mask);
}

/**
 * Checks if a given direct IP address matches any of the configured TRUSTED_PROXIES entries.
 */
export function isTrustedProxy(directIP: string, trustedProxiesRaw = getTrustedProxiesEnv()): boolean {
  if (!directIP || !trustedProxiesRaw) return false;

  const unwrappedDirect = directIP.startsWith("::ffff:") ? directIP.slice(7) : directIP;
  const entries = trustedProxiesRaw
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);

  for (const entry of entries) {
    if (entry.includes("/")) {
      if (isIPv4InCIDR(unwrappedDirect, entry)) {
        return true;
      }
    } else {
      const unwrappedEntry = entry.startsWith("::ffff:") ? entry.slice(7) : entry;
      if (unwrappedDirect === unwrappedEntry) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Normalizes IP address by trimming and unwrapping IPv4-mapped IPv6 addresses (::ffff:1.2.3.4 -> 1.2.3.4).
 */
function normalizeIP(ipStr: string | null | undefined): string | null {
  if (!ipStr) return null;
  const trimmed = ipStr.trim();
  if (trimmed.length === 0) return null;

  // If contains a list of comma-separated IPs (common in XFF), take leftmost
  const candidate = trimmed.split(",")[0]?.trim();
  if (!candidate) return null;

  // Unwrap IPv4-mapped IPv6
  const unwrapped = candidate.startsWith("::ffff:") ? candidate.slice(7) : candidate;
  if (isIP(unwrapped)) {
    return unwrapped;
  }
  return null;
}

/**
 * Parses Forwarded header (RFC 7239), extracting the 'for' parameter of the leftmost entry.
 */
function parseForwardedHeader(forwardedStr: string | null | undefined): string | null {
  if (!forwardedStr) return null;
  const firstEntry = forwardedStr.split(",")[0]?.trim();
  if (!firstEntry) return null;

  const forMatch = /for=(?:"?\[?([a-fA-F0-9:.]+)\]?"?)/i.exec(firstEntry);
  if (forMatch?.[1]) {
    return forMatch[1];
  }
  return null;
}

export interface ResolvedIP {
  ip: string;
  trusted: boolean;
}

/**
 * Resolves client IP given direct connection address and header lookup function.
 * If directAddress is a trusted proxy, parses forwarded headers in precedence order.
 * Otherwise, falls back to directAddress, ignoring forwarded headers to avoid spoofing.
 */
export function resolveIPFromHeaders(
  directAddress: string,
  getHeader: (name: string) => string | string[] | null | undefined,
  trustedProxiesRaw = getTrustedProxiesEnv(),
): ResolvedIP {
  const unwrappedDirect = directAddress.startsWith("::ffff:") ? directAddress.slice(7) : directAddress;
  const trusted = isTrustedProxy(unwrappedDirect, trustedProxiesRaw);

  const getHeaderStr = (name: string): string | null => {
    const val = getHeader(name);
    if (typeof val === "string") {
      const trimmed = val.trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    if (Array.isArray(val) && typeof val[0] === "string") {
      const trimmed = val[0].trim();
      return trimmed.length > 0 ? trimmed : null;
    }
    return null;
  };

  if (trusted) {
    // Priority: CF-Connecting-IP, then leftmost X-Forwarded-For, then Forwarded, then Fastly-Client-IP
    const cfIP = normalizeIP(getHeaderStr("cf-connecting-ip"));
    if (cfIP) return { ip: cfIP, trusted };

    const xff = normalizeIP(getHeaderStr("x-forwarded-for"));
    if (xff) return { ip: xff, trusted };

    const forwardedRaw = getHeaderStr("forwarded");
    if (forwardedRaw) {
      const forwardedTarget = parseForwardedHeader(forwardedRaw);
      const forwardedIP = normalizeIP(forwardedTarget);
      if (forwardedIP) return { ip: forwardedIP, trusted };
    }

    const fastly = normalizeIP(getHeaderStr("fastly-client-ip"));
    if (fastly) return { ip: fastly, trusted };
  }

  if (unwrappedDirect && isIP(unwrappedDirect)) {
    return { ip: unwrappedDirect, trusted };
  }
  if (directAddress && isIP(directAddress)) {
    return { ip: directAddress, trusted };
  }

  return { ip: "unresolved", trusted };
}

export function getPeerIPFromSocket(socket: Socket): string {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- handshake is null for malformed sockets; fail-open contract pinned by limiter.test.ts
  const handshakeAddress = typeof socket.handshake?.address === "string" ? socket.handshake.address.trim() : "";
  const reqHeaders = (socket.request as { headers?: IncomingHttpHeaders } | undefined)?.headers;

  const result = resolveIPFromHeaders(handshakeAddress, (name) => reqHeaders?.[name]);
  if (result.ip !== "unresolved") {
    return result.ip;
  }

  return `unresolved:${socket.id}`;
}

export function getPeerIPFromRequest(req: Request, server: BunServer<unknown>): string {
  const directAddress = server.requestIP(req)?.address ?? "127.0.0.1";
  const result = resolveIPFromHeaders(directAddress, (name) => req.headers.get(name));
  return result.ip !== "unresolved" ? result.ip : directAddress;
}

export function getNetworkPrefix(socket: Socket): string {
  const ip = getPeerIPFromSocket(socket);

  if (ip.startsWith("unresolved:")) {
    return ip;
  }

  // Loopback / localhost connections belong to the same local peer room
  if (ip === "127.0.0.1" || ip === "::1" || ip === "localhost") {
    return "127.0.0";
  }

  if (ip.includes(".")) {
    return ip.split(".").slice(0, 3).join(".");
  }

  if (ip.includes(":")) {
    return ip.split(":").slice(0, 3).join(":");
  }

  return `unresolved:${socket.id}`;
}
