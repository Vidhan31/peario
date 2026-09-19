import { describe, expect, it } from "vitest";

import { APP_CACHE_VERSION, shouldBypassServiceWorker } from "../swUtils";

describe("Service Worker bypass and cache policy", () => {
  it("defines versioned cache identifier", () => {
    expect(APP_CACHE_VERSION).toBe("peario-v1.0.0");
  });

  it("bypasses socket.io connections (polling and websocket)", () => {
    expect(shouldBypassServiceWorker("https://signal.peario.app/socket.io/?EIO=4&transport=polling")).toBe(true);
    expect(shouldBypassServiceWorker("wss://signal.peario.app/socket.io/?EIO=4&transport=websocket")).toBe(true);
    expect(shouldBypassServiceWorker("/socket.io/")).toBe(true);
  });

  it("bypasses /api/turn-credentials proxy endpoint", () => {
    expect(shouldBypassServiceWorker("https://signal.peario.app/api/turn-credentials?roomId=TEST01")).toBe(true);
    expect(shouldBypassServiceWorker("/api/turn-credentials")).toBe(true);
  });

  it("bypasses all Metered hosts", () => {
    expect(shouldBypassServiceWorker("https://pear.metered.live/api/v1/turn/credentials?apiKey=secret")).toBe(true);
    expect(shouldBypassServiceWorker("https://relay.metered.live:443/")).toBe(true);
  });

  it("does not bypass standard static assets and application routes", () => {
    expect(shouldBypassServiceWorker("https://peario.app/assets/index-abc.js")).toBe(false);
    expect(shouldBypassServiceWorker("https://peario.app/favicon.ico")).toBe(false);
    expect(shouldBypassServiceWorker("/room/ROOM01")).toBe(false);
    expect(shouldBypassServiceWorker("https://peario.app/")).toBe(false);
  });
});
