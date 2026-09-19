import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  _resetIceServersForTesting,
  DEFAULT_ICE_SERVERS,
  fetchIceServers,
  RTCIceServerListSchema,
  RTCIceServerSchema,
} from "../iceServers";

describe("iceServers validation schemas", () => {
  it("validates DEFAULT_ICE_SERVERS with RTCIceServerListSchema", () => {
    const result = RTCIceServerListSchema.safeParse(DEFAULT_ICE_SERVERS);
    expect(result.success).toBe(true);
  });

  it("validates valid Metered TURN server response", () => {
    const meteredServers = [
      {
        urls: "stun:relay.metered.ca:80",
      },
      {
        urls: ["turn:relay.metered.ca:80", "turn:relay.metered.ca:443?transport=tcp"],
        username: "user123",
        credential: "secretpassword",
        credentialType: "password",
      },
    ];

    const result = RTCIceServerListSchema.safeParse(meteredServers);
    expect(result.success).toBe(true);
  });

  it("rejects invalid ICE server entries", () => {
    expect(RTCIceServerSchema.safeParse({}).success).toBe(false);
    expect(RTCIceServerSchema.safeParse({ urls: "" }).success).toBe(false);
    expect(RTCIceServerSchema.safeParse({ urls: [] }).success).toBe(false);
    expect(
      RTCIceServerSchema.safeParse({
        urls: "stun:example.com",
        credentialType: "invalid-type",
      }).success,
    ).toBe(false);
  });
});

describe("fetchIceServers client switch and fallback", () => {
  const originalFetch = globalThis.fetch;
  const storage = new Map<string, string>();
  const mockSessionStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, val: string) => {
      storage.set(key, String(val));
    },
    removeItem: (key: string) => {
      storage.delete(key);
    },
    clear: () => {
      storage.clear();
    },
    key: (index: number) => Array.from(storage.keys())[index] ?? null,
    length: 0,
  };

  beforeEach(() => {
    storage.clear();
    storage.set("pear_turn_enabled", "true");
    vi.stubGlobal("sessionStorage", mockSessionStorage);
    vi.stubGlobal("window", {
      location: { origin: "http://localhost:5137", pathname: "/", search: "" },
      history: { replaceState: vi.fn() },
    });
    _resetIceServersForTesting();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    storage.clear();
    vi.unstubAllGlobals();
    _resetIceServersForTesting();
  });

  it("fetches credentials from server proxy on 200 response and caches result", async () => {
    const mockServers = [
      { urls: "stun:relay.metered.ca:80" },
      {
        urls: "turn:relay.metered.ca:80",
        username: "ephemeral-user",
        credential: "ephemeral-password",
      },
    ];

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockServers),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const servers = await fetchIceServers({ roomId: "ROOM01" });
    expect(servers).toEqual(mockServers);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Second call should return cached list without another fetch
    const cached = await fetchIceServers();
    expect(cached).toEqual(mockServers);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("falls back to DEFAULT_ICE_SERVERS when server proxy returns 500 error", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ error: "Internal Server Error" }),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const servers = await fetchIceServers();
    expect(servers).toEqual(DEFAULT_ICE_SERVERS);
    expect(servers.length).toBe(DEFAULT_ICE_SERVERS.length);
  });

  it("falls back to DEFAULT_ICE_SERVERS when server proxy network request times out or rejects", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("Network connection failed"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const servers = await fetchIceServers();
    expect(servers).toEqual(DEFAULT_ICE_SERVERS);
  });
});
