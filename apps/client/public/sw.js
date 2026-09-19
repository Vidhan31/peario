// Wire protocol (WRITE/PULL/ERROR/ABORT/CLOSE/PING) must stay in sync with
// apps/client/src/lib/file-system/protocol.ts (vendored, no import possible here).
// Want to remove this postMessage hack, tell them u want transferable streams:
// https://bugs.webkit.org/show_bug.cgi?id=215485

const WRITE = 0;
const PULL = 0;
const ERROR = 1;
const ABORT = 1;
const CLOSE = 2;
const PING = 3;

const CACHE_VERSION = "peario-v1.0.0";
const CURRENT_CACHES = [CACHE_VERSION];

/** @implements {UnderlyingSource} */
class MessagePortSource {
  /** @type {ReadableStreamController<any>} controller */
  controller;

  /**
   * @param {MessagePort} port
   * @param {number} [expectedSize]
   */
  constructor(port, expectedSize = 0) {
    this.port = port;
    this.expectedSize = expectedSize;
    this.bytesReceived = 0;
    this.isClosed = false;
    this.port.onmessage = (evt) => this.onMessage(evt.data);
  }

  /**
   * @param {ReadableStreamController<any>} controller
   */
  start(controller) {
    this.controller = controller;
  }

  pull() {
    if (!this.isClosed) {
      try {
        this.port.postMessage({ type: PULL });
      } catch {
        // Port may be closed
      }
    }
  }

  /** @param {Error} reason */
  cancel(reason) {
    // Firefox can notify a cancel event, chrome can't
    // https://bugs.chromium.org/p/chromium/issues/detail?id=638494
    this.isClosed = true;
    const errMsg = reason?.message || (typeof reason === "string" ? reason : "Download cancelled");
    try {
      this.port.postMessage({ type: ERROR, reason: errMsg });
    } catch {
      // Ignore
    }
    try {
      this.port.close();
    } catch {
      // Ignore
    }
  }

  /** @param {{ type: number; chunk: Uint8Array; reason: any; }} message */
  onMessage(message) {
    if (this.isClosed) return;

    if (message.type === WRITE) {
      const chunkSize = message.chunk?.byteLength || 0;
      this.bytesReceived += chunkSize;
      this.controller.enqueue(message.chunk);

      // If expected size is reached, complete the stream and unblock sink's pending write
      if (this.expectedSize > 0 && this.bytesReceived >= this.expectedSize) {
        this.isClosed = true;
        try {
          this.controller.close();
        } catch {
          // Already closed
        }
        try {
          // Unblock MessagePortSink._readyPromise waiting for PULL
          this.port.postMessage({ type: PULL });
        } catch {
          // Ignore
        }
      }
    }
    if (message.type === ABORT) {
      this.isClosed = true;
      try {
        this.controller.error(message.reason);
      } catch {
        // Already errored/closed
      }
      try {
        this.port.close();
      } catch {
        // Ignore
      }
    }
    if (message.type === CLOSE) {
      this.isClosed = true;
      try {
        this.controller.close();
      } catch {
        // Already closed
      }
      try {
        this.port.close();
      } catch {
        // Ignore
      }
    }
  }
}

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => !CURRENT_CACHES.includes(cacheName))
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

const map = new Map();

// This should be called once per download
// Each event has a dataChannel that the data will be piped through
globalThis.addEventListener("message", (evt) => {
  const data = evt.data;
  if (data?.type === "ping" || data === 0) {
    if (typeof evt.waitUntil === "function") {
      evt.waitUntil(Promise.resolve());
    }
    return;
  }
  if (data && data.url && data.readablePort) {
    let size = 0;
    if (data.size !== undefined && data.size !== null) {
      size = Number(data.size);
    } else if (data.headers) {
      const cl = data.headers["content-length"] || data.headers["Content-Length"];
      if (cl) size = Number(cl);
    }

    data.rs = new ReadableStream(
      new MessagePortSource(evt.data.readablePort, size),
      new CountQueuingStrategy({ highWaterMark: 4 }),
    );
    map.set(data.url, data);
    // Drop the entry if the download navigation never happens (e.g. the
    // browser blocked it). Without this a repeat download of the same URL
    // could resolve against a dead stream and stall at 0%.
    setTimeout(() => {
      if (map.get(data.url) === data) {
        map.delete(data.url);
      }
    }, 120_000);
  }
});

globalThis.addEventListener("fetch", (evt) => {
  const url = evt.request.url;

  // Bypass Socket.IO, TURN proxy credentials, and Metered hosts (never respondWith)
  try {
    const parsed = new URL(url, self.location ? self.location.origin : "https://peario.app");
    if (
      parsed.pathname.includes("/socket.io/") ||
      parsed.pathname.includes("/api/turn-credentials") ||
      parsed.hostname.includes("metered.live")
    ) {
      return;
    }
  } catch {
    // Continue to internal map lookup
  }

  const data = map.get(url);
  if (!data) return;
  map.delete(url);

  // Create headers object, merging existing headers with Content-Length if size is available
  const headers = new Headers(data.headers || {});

  // Add Content-Length header if size is provided in the data or headers
  if (data.size !== undefined && data.size !== null) {
    headers.set("Content-Length", String(data.size));
  } else if (headers.has("content-length")) {
    const contentLength = headers.get("content-length");
    if (contentLength) {
      headers.set("Content-Length", contentLength);
    }
  }

  // Always enforce nosniff on download responses.
  headers.set("X-Content-Type-Options", "nosniff");

  evt.respondWith(
    new Response(data.rs, {
      headers: headers,
    }),
  );
});
