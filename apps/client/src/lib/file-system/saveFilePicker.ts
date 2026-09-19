// Streams downloads through the service worker via MessageChannel with backpressure from PULL replies.

import type { CreateWritableOptions, SaveFileHandle, SaveFilePickerOptions } from "./types";

import { ABORT, CLOSE, ERROR, PULL, WRITE } from "./protocol";

const ENCODED_EXTRA_CHARS: Record<string, string> = { "'": "%27", "(": "%28", ")": "%29" };

export function encodeDownloadFileName(name: string): string {
  return encodeURIComponent(name)
    .replace(/['()]/g, (char) => ENCODED_EXTRA_CHARS[char] ?? char)
    .replace(/\*/g, "%2A");
}

export function buildDownloadHeaders(fileName: string, size?: number): Record<string, string> {
  const headers: Record<string, string> = {
    "content-disposition": `attachment; filename*=UTF-8''${fileName}`,
    "content-type": "application/octet-stream; charset=utf-8",
    "x-content-type-options": "nosniff",
  };
  if (typeof size === "number" && Number.isFinite(size) && size > 0) {
    headers["content-length"] = String(Math.floor(size));
  }
  return headers;
}

function isOldSafari(): boolean {
  if (typeof window === "undefined") return false;
  const he = (window as unknown as { HTMLElement?: unknown }).HTMLElement;
  if (typeof he !== "function") return false;
  try {
    return /constructor/i.test(Function.prototype.toString.call(he));
  } catch {
    return false;
  }
}

async function getActiveServiceWorker(): Promise<ServiceWorker | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration?.active) return registration.active;
    const ready = await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 3000)),
    ]);
    return ready?.active ?? null;
  } catch {
    return null;
  }
}

/** Sink that forwards each chunk over a MessagePort with per-write backpressure. */
class MessagePortSink implements UnderlyingSink<Uint8Array> {
  private port: MessagePort;
  private controller: WritableStreamDefaultController | null = null;
  private readyPromise: Promise<void> = Promise.resolve();
  private resolveReady: () => void = () => undefined;
  private rejectReady: (reason?: unknown) => void = () => undefined;

  constructor(port: MessagePort) {
    this.port = port;
    this.port.onmessage = (event: MessageEvent) => {
      this.onMessage(event.data as { type: number; reason?: unknown });
    };
    this.resetReady();
  }

  start(controller: WritableStreamDefaultController): Promise<void> {
    this.controller = controller;
    return this.readyPromise;
  }

  write(chunk: Uint8Array): Promise<void> {
    this.port.postMessage({ type: WRITE, chunk }, [chunk.buffer as ArrayBuffer]);
    this.resetReady();
    return this.readyPromise;
  }

  close(): void {
    try {
      this.port.postMessage({ type: CLOSE });
    } catch {
      // Port may already be closed.
    }
    try {
      this.port.close();
    } catch {
      // Ignore.
    }
  }

  abort(reason?: unknown): void {
    try {
      this.port.postMessage({ type: ABORT, reason });
    } catch {
      // Port may already be closed.
    }
    try {
      this.port.close();
    } catch {
      // Ignore.
    }
  }

  private onMessage(message: { type: number; reason?: unknown }): void {
    if (message.type === PULL) this.resolveReady();
    if (message.type === ERROR) this.onError(message.reason);
  }

  private onError(reason?: unknown): void {
    try {
      this.controller?.error(reason);
    } catch {
      // Already errored or closed.
    }
    this.rejectReady(reason);
    try {
      this.port.close();
    } catch {
      // Ignore.
    }
  }

  private resetReady(): void {
    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.resolveReady = () => {
        resolve();
      };
      this.rejectReady = (reason?: unknown) => {
        if (reason instanceof Error) {
          reject(reason);
        } else if (typeof reason === "string" && reason.length > 0) {
          reject(new Error(reason));
        } else {
          reject(new Error("Download failed"));
        }
      };
    });
    // Catch handler is attached by rejectReady consumers via pipeTo; mark handled
    // here so an early worker error cannot trigger an unhandled rejection.
    this.readyPromise.catch(() => undefined);
  }
}

/** Normalize arbitrary File System write values to Uint8Array. */
function createNormalizeTransform(): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      if (chunk instanceof Uint8Array) {
        controller.enqueue(chunk);
        return;
      }
      const response = new Response(chunk);
      const reader = response.body?.getReader();
      if (!reader) {
        controller.enqueue(new Uint8Array());
        return;
      }
      const pump = (): Promise<void> =>
        reader.read().then((result) => {
          if (result.done) return;
          controller.enqueue(result.value);
          return pump();
        });
      return pump();
    },
  });
}

class DownloadSaveHandle implements SaveFileHandle {
  readonly kind = "file" as const;
  readonly name: string;

  constructor(name?: string) {
    this.name = name && name.length > 0 ? name : "download";
  }

  getFile(): Promise<never> {
    return Promise.reject(
      new DOMException(
        "A requested file or directory could not be found at the time an operation was processed.",
        "NotFoundError",
      ),
    );
  }

  async createWritable(options: CreateWritableOptions = {}): Promise<WritableStream<Uint8Array>> {
    if (typeof document === "undefined") {
      throw new Error("createWritable requires a browser environment");
    }
    const stream = new TransformStream<Uint8Array, Uint8Array>();
    const active = await getActiveServiceWorker();

    if (isOldSafari() || !active) {
      throw new Error(
        "Peario requires a service worker to stream files directly to disk. " +
          "Your browser did not activate the service worker. " +
          "Try reloading the page. If this persists, check that your browser supports service workers and that the page is served over HTTPS.",
      );
    }

    const channel = new MessageChannel();
    const remoteWritable = new WritableStream<Uint8Array>(new MessagePortSink(channel.port2));
    const fileName = encodeDownloadFileName(this.name);
    const headers = buildDownloadHeaders(fileName, options.size);

    const registration = await navigator.serviceWorker.getRegistration();
    const scope = registration?.scope ?? `${location.origin}/`;

    // Unique download URL per transfer prevents service worker collision and stalled retries on repeat filenames.
    const nonce = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}`;
    const downloadUrl = `${scope}${fileName}?download=${encodeURIComponent(nonce)}`;

    const keepAlive = setTimeout(() => {
      try {
        active.postMessage(0);
      } catch {
        // Worker may be gone.
      }
    }, 10_000);

    void stream.readable
      .pipeThrough(createNormalizeTransform())
      .pipeTo(remoteWritable)
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(keepAlive);
      });

    active.postMessage({ url: downloadUrl, headers, readablePort: channel.port1 }, [channel.port1]);

    const iframe = document.createElement("iframe");
    iframe.hidden = true;
    iframe.src = downloadUrl;
    document.body.appendChild(iframe);
    setTimeout(() => {
      try {
        iframe.remove();
      } catch {
        // Ignore.
      }
    }, 60_000);

    return stream.writable;
  }
}

export function showSaveFilePicker(options: SaveFilePickerOptions = {}): Promise<SaveFileHandle> {
  return Promise.resolve(new DownloadSaveHandle(options.suggestedName));
}
