import type { Pausable } from "../utils/FileUtils";

/**
 * Creates a WritableStream that sends chunks over an RTCDataChannel with backpressure handling.
 * Returns a WritableStream that can be used with .pipeTo() for streaming data over WebRTC.
 */
export function createDataChannelWritableStream(
  fileDataChannel: RTCDataChannel,
  opts: {
    maxBufferedBytes?: number;
    lowThresholdBytes?: number;
    pausable?: Pausable;
    pausables?: Pausable[];
    signal?: AbortSignal;
  } = {},
): WritableStream<Uint8Array> {
  if (fileDataChannel.readyState !== "open") {
    throw new Error(`DataChannel not open (state: ${fileDataChannel.readyState})`);
  }

  const maxBuffered = opts.maxBufferedBytes ?? 256 * 1024;
  const lowThreshold = opts.lowThresholdBytes ?? 64 * 1024;
  const signal = opts.signal;

  fileDataChannel.binaryType = "arraybuffer";
  fileDataChannel.bufferedAmountLowThreshold = lowThreshold;

  return new WritableStream<Uint8Array>({
    async write(chunk: Uint8Array) {
      throwIfAborted(signal);
      // Wait on every pause gate (backpressure + user). A gate that is not
      // paused resolves immediately, so this adds no overhead or buffering
      // when idle — chunks are simply not pulled while any gate is paused.
      const gates: Pausable[] = [...(opts.pausables ?? []), ...(opts.pausable ? [opts.pausable] : [])];
      while (gates.some((gate) => gate.isPaused())) {
        await abortable(Promise.all(gates.map((gate) => gate.waitTillResumed())), signal);
      }
      throwIfAborted(signal);

      const targetThreshold = Math.min(lowThreshold, Math.max(0, maxBuffered - chunk.byteLength));
      if (fileDataChannel.bufferedAmountLowThreshold !== targetThreshold) {
        fileDataChannel.bufferedAmountLowThreshold = targetThreshold;
      }

      while (fileDataChannel.bufferedAmount + chunk.byteLength > maxBuffered) {
        await abortable(waitForBufferedAmountLow(fileDataChannel, signal), signal);
        throwIfAborted(signal);
        if (fileDataChannel.readyState !== "open") {
          throw new Error("DataChannel closed while waiting for buffer to drain");
        }
      }
      // @ts-expect-error Reason: payload is typed as unknown but is expected to be a Uint8Array at runtime
      fileDataChannel.send(chunk);
    },
    abort() {
      // pipeTo() calls this when its signal aborts. Pending write() calls
      // observe the same signal via abortable(), so nothing else to unblock here.
    },
  });
}

export async function sendStreamOverDataChannel(
  source: ReadableStream<Uint8Array>,
  fileDataChannel: RTCDataChannel,
  opts: {
    maxBufferedBytes?: number;
    lowThresholdBytes?: number;
    pausable?: Pausable;
    pausables?: Pausable[];
    signal?: AbortSignal;
  } = {},
): Promise<void> {
  const writableStream = createDataChannelWritableStream(fileDataChannel, opts);
  await source.pipeTo(writableStream, opts.signal ? { signal: opts.signal } : {});
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw abortReason(signal);
  }
}

function abortReason(signal: AbortSignal): Error {
  const reason: unknown = signal.reason;
  return reason instanceof Error ? reason : new DOMException("Aborted", "AbortError");
}

function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(abortReason(signal));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(abortReason(signal));
    };
    const cleanup = () => {
      signal.removeEventListener("abort", onAbort);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (err: unknown) => {
        cleanup();
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

function waitForBufferedAmountLow(dc: RTCDataChannel, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (dc.readyState !== "open") {
      reject(new Error("DataChannel is not open"));
      return;
    }
    if (dc.bufferedAmount <= dc.bufferedAmountLowThreshold) {
      resolve();
      return;
    }
    const onLow = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new Error("DataChannel closed"));
    };
    const abortSignal: AbortSignal | undefined = signal;
    const onAbort = () => {
      cleanup();
      reject(abortSignal ? abortReason(abortSignal) : new DOMException("Aborted", "AbortError"));
    };
    function cleanup() {
      dc.removeEventListener("bufferedamountlow", onLow);
      dc.removeEventListener("close", onClose);
      dc.removeEventListener("error", onClose);
      abortSignal?.removeEventListener("abort", onAbort);
    }
    dc.addEventListener("bufferedamountlow", onLow, { once: true });
    dc.addEventListener("close", onClose, { once: true });
    dc.addEventListener("error", onClose, { once: true });
    abortSignal?.addEventListener("abort", onAbort, { once: true });
  });
}
