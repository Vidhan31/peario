import type { Socket } from "socket.io";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetTrustedProxyWarningForTesting,
  checkTrustedProxiesConfig,
  getNetworkPrefix,
  getPeerIPFromSocket,
  isTrustedProxy,
  resolveIPFromHeaders,
} from "../utils/ip";
import { logger } from "../utils/logger";

function createMockSocket(address: string, headers: Record<string, string | string[]> = {}, id = "sock-123"): Socket {
  return {
    id,
    handshake: {
      address,
    },
    request: {
      headers,
    },
  } as unknown as Socket;
}

describe("ip utilities and proxy trust boundaries", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    _resetTrustedProxyWarningForTesting();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    _resetTrustedProxyWarningForTesting();
  });

  describe("isTrustedProxy", () => {
    it("returns false when TRUSTED_PROXIES is unset", () => {
      delete process.env.TRUSTED_PROXIES;
      expect(isTrustedProxy("127.0.0.1")).toBe(false);
    });

    it("matches exact IPv4 address", () => {
      process.env.TRUSTED_PROXIES = "127.0.0.1, 10.0.0.1";
      expect(isTrustedProxy("127.0.0.1")).toBe(true);
      expect(isTrustedProxy("10.0.0.1")).toBe(true);
      expect(isTrustedProxy("192.168.1.1")).toBe(false);
    });

    it("matches IPv4 CIDR blocks", () => {
      process.env.TRUSTED_PROXIES = "10.0.0.0/8, 172.16.0.0/12";
      expect(isTrustedProxy("10.254.1.2")).toBe(true);
      expect(isTrustedProxy("172.20.10.5")).toBe(true);
      expect(isTrustedProxy("192.168.1.1")).toBe(false);
    });

    it("matches IPv4-mapped IPv6 addresses for trusted IPv4", () => {
      process.env.TRUSTED_PROXIES = "127.0.0.1";
      expect(isTrustedProxy("::ffff:127.0.0.1")).toBe(true);
    });
  });

  describe("resolveIPFromHeaders trust matrix", () => {
    it("strictly ignores all forwarded headers when direct remote address is untrusted", () => {
      process.env.TRUSTED_PROXIES = "127.0.0.1";
      const headers = {
        "cf-connecting-ip": "203.0.113.1",
        "x-forwarded-for": "203.0.113.2, 10.0.0.1",
        forwarded: "for=203.0.113.3",
        "fastly-client-ip": "203.0.113.4",
      };

      const result = resolveIPFromHeaders("198.51.100.99", (name) => headers[name as keyof typeof headers]);
      expect(result.trusted).toBe(false);
      expect(result.ip).toBe("198.51.100.99");
    });

    it("takes leftmost IP from comma-separated x-forwarded-for when trusted", () => {
      process.env.TRUSTED_PROXIES = "127.0.0.1";
      const headers = {
        "x-forwarded-for": "203.0.113.195, 70.41.3.18, 150.172.238.178",
      };

      const result = resolveIPFromHeaders("127.0.0.1", (name) => headers[name as keyof typeof headers]);
      expect(result.trusted).toBe(true);
      expect(result.ip).toBe("203.0.113.195");
    });

    it("normalizes IPv4-mapped IPv6 address from direct connection and headers", () => {
      process.env.TRUSTED_PROXIES = "127.0.0.1";
      const headers = {
        "cf-connecting-ip": "::ffff:198.51.100.42",
      };

      const result = resolveIPFromHeaders("::ffff:127.0.0.1", (name) => headers[name as keyof typeof headers]);
      expect(result.trusted).toBe(true);
      expect(result.ip).toBe("198.51.100.42");
    });

    it("falls back to unresolved when IP format is completely invalid", () => {
      const result = resolveIPFromHeaders("invalid-addr", () => null);
      expect(result.ip).toBe("unresolved");
      expect(result.trusted).toBe(false);
    });
  });

  describe("getPeerIPFromSocket", () => {
    it("ignores forwarded headers when direct remote address is untrusted", () => {
      process.env.TRUSTED_PROXIES = "127.0.0.1";
      const socket = createMockSocket("203.0.113.10", {
        "x-forwarded-for": "198.51.100.25",
        "cf-connecting-ip": "198.51.100.30",
        forwarded: "for=198.51.100.35",
      });

      expect(getPeerIPFromSocket(socket)).toBe("203.0.113.10");
    });

    it("respects cf-connecting-ip from trusted proxy", () => {
      process.env.TRUSTED_PROXIES = "127.0.0.1";
      const socket = createMockSocket("127.0.0.1", {
        "cf-connecting-ip": "198.51.100.42",
        "x-forwarded-for": "198.51.100.99",
      });

      expect(getPeerIPFromSocket(socket)).toBe("198.51.100.42");
    });

    it("respects x-forwarded-for from trusted proxy", () => {
      process.env.TRUSTED_PROXIES = "127.0.0.1";
      const socket = createMockSocket("127.0.0.1", {
        "x-forwarded-for": "198.51.100.50, 10.0.0.1",
      });

      expect(getPeerIPFromSocket(socket)).toBe("198.51.100.50");
    });

    it("respects forwarded header with for= parameter from trusted proxy", () => {
      process.env.TRUSTED_PROXIES = "127.0.0.1";
      const socket = createMockSocket("127.0.0.1", {
        forwarded: 'for="198.51.100.60";proto=https',
      });

      expect(getPeerIPFromSocket(socket)).toBe("198.51.100.60");
    });

    it("respects fastly-client-ip from trusted proxy", () => {
      process.env.TRUSTED_PROXIES = "127.0.0.1";
      const socket = createMockSocket("127.0.0.1", {
        "fastly-client-ip": "198.51.100.70",
      });

      expect(getPeerIPFromSocket(socket)).toBe("198.51.100.70");
    });

    it("returns unresolved fallback when address cannot be resolved", () => {
      const socket = createMockSocket("not-an-ip", {}, "socket-abc");
      expect(getPeerIPFromSocket(socket)).toBe("unresolved:socket-abc");
    });
  });

  describe("getNetworkPrefix", () => {
    it("extracts /24 prefix for IPv4", () => {
      const socket = createMockSocket("192.168.1.45");
      expect(getNetworkPrefix(socket)).toBe("192.168.1");
    });

    it("does not group unresolvable sockets into local room prefix", () => {
      const socket1 = createMockSocket("invalid-ip", {}, "socket-1");
      const socket2 = createMockSocket("invalid-ip", {}, "socket-2");

      expect(getNetworkPrefix(socket1)).toBe("unresolved:socket-1");
      expect(getNetworkPrefix(socket2)).toBe("unresolved:socket-2");
      expect(getNetworkPrefix(socket1)).not.toBe(getNetworkPrefix(socket2));
    });
  });

  describe("checkTrustedProxiesConfig", () => {
    it("logs warning in production when TRUSTED_PROXIES is missing", () => {
      process.env.NODE_ENV = "production";
      delete process.env.TRUSTED_PROXIES;
      const warnSpy = vi
        .spyOn(logger, "warn")
        .mockImplementation(() => undefined as unknown as ReturnType<typeof logger.warn>);

      checkTrustedProxiesConfig();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("TRUSTED_PROXIES is not set in production!"));

      // Subsequent call should not log again (once only)
      warnSpy.mockClear();
      checkTrustedProxiesConfig();
      expect(warnSpy).not.toHaveBeenCalled();

      warnSpy.mockRestore();
    });
  });
});
