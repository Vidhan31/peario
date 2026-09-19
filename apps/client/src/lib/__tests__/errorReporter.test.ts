import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetErrorReporterForTesting, checkRateCap, reportClientError, shouldSample } from "../errorReporter";

describe("C5 - Client Error Reporter", () => {
  const originalNavigator = globalThis.navigator;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    _resetErrorReporterForTesting();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.defineProperty(globalThis, "navigator", {
      value: originalNavigator,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "fetch", {
      value: originalFetch,
      configurable: true,
      writable: true,
    });
  });

  describe("Sampling", () => {
    it("always returns true when sampleRate is 1.0", () => {
      expect(shouldSample(1.0)).toBe(true);
    });

    it("always returns false when sampleRate is 0.0", () => {
      expect(shouldSample(0.0)).toBe(false);
    });

    it("evaluates randomFn threshold correctly", () => {
      expect(shouldSample(0.5, () => 0.49)).toBe(true);
      expect(shouldSample(0.5, () => 0.51)).toBe(false);
    });
  });

  describe("Rate cap", () => {
    it("permits up to maxReportsPerWindow within sliding window", () => {
      const now = 1000000;
      const maxReports = 3;
      const windowMs = 30000;

      expect(checkRateCap(now, maxReports, windowMs)).toBe(true);
      expect(checkRateCap(now + 100, maxReports, windowMs)).toBe(true);
      expect(checkRateCap(now + 200, maxReports, windowMs)).toBe(true);
      // 4th report within same window should be capped
      expect(checkRateCap(now + 300, maxReports, windowMs)).toBe(false);

      // After window passes, new report should be permitted
      expect(checkRateCap(now + windowMs + 10, maxReports, windowMs)).toBe(true);
    });
  });

  describe("reportClientError", () => {
    it("dispatches error beacon via navigator.sendBeacon when available", async () => {
      const sendBeaconMock = vi.fn().mockReturnValue(true);
      Object.defineProperty(globalThis, "navigator", {
        value: { sendBeacon: sendBeaconMock },
        configurable: true,
        writable: true,
      });

      const sent = await reportClientError({
        eventType: "connect_error",
        reason: "Connection refused",
      });

      expect(sent).toBe(true);
      expect(sendBeaconMock).toHaveBeenCalledWith("/api/client-errors", expect.any(Blob));
    });

    it("falls back to fetch when sendBeacon is not available", async () => {
      Object.defineProperty(globalThis, "navigator", {
        value: {},
        configurable: true,
        writable: true,
      });
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      Object.defineProperty(globalThis, "fetch", {
        value: fetchMock,
        configurable: true,
        writable: true,
      });

      const sent = await reportClientError({
        eventType: "icecandidateerror",
        reason: "STUN server unreachable",
        isRelay: false,
      });

      expect(sent).toBe(true);
      expect(fetchMock).toHaveBeenCalledWith("/api/client-errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventType: "icecandidateerror",
          reason: "STUN server unreachable",
          isRelay: false,
        }),
        keepalive: true,
      });
    });

    it("drops report when rate capped", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      Object.defineProperty(globalThis, "fetch", {
        value: fetchMock,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, "navigator", {
        value: {},
        configurable: true,
        writable: true,
      });

      const config = { maxReportsPerWindow: 2, windowMs: 60000 };

      expect(await reportClientError({ eventType: "disconnect" }, config)).toBe(true);
      expect(await reportClientError({ eventType: "disconnect" }, config)).toBe(true);
      expect(await reportClientError({ eventType: "disconnect" }, config)).toBe(false);

      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("drops report when not sampled", async () => {
      const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
      Object.defineProperty(globalThis, "fetch", {
        value: fetchMock,
        configurable: true,
        writable: true,
      });
      Object.defineProperty(globalThis, "navigator", {
        value: {},
        configurable: true,
        writable: true,
      });

      const sent = await reportClientError({ eventType: "disconnect" }, { sampleRate: 0.0 });
      expect(sent).toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
