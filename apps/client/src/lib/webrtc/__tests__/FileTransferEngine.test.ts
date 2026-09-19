import type { FileControlMessage, FileMetadata, PeerId } from "@peario/shared";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { assertDefined, FakeRTCDataChannel } from "@/test/fakes";

import type { PeerTransport } from "../PeerTransport";

import { BACKPRESSURE_PAUSE_THRESHOLD, FileTransferEngine, type IncomingTransferSession } from "../FileTransferEngine";

class MockTransport {
  public sentControls: FileControlMessage[] = [];
  public sentChunks: (ArrayBuffer | ArrayBufferView)[] = [];
  public dataBufferedAmount = 0;
  private ctrlListeners = new Set<(ctrl: FileControlMessage) => void>();
  private dataListeners = new Set<(data: ArrayBuffer) => void>();

  public dataChannel: FakeRTCDataChannel;

  constructor() {
    this.dataChannel = new FakeRTCDataChannel("file-data");
    this.dataChannel.send = vi.fn((chunk: string | ArrayBuffer | ArrayBufferView | Blob) => {
      if (chunk instanceof ArrayBuffer || ArrayBuffer.isView(chunk)) {
        this.sentChunks.push(chunk);
        const buffer: ArrayBuffer =
          chunk instanceof ArrayBuffer
            ? chunk
            : (chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer);
        for (const listener of this.dataListeners) {
          listener(buffer);
        }
      }
    });
  }

  public get rawFileDataChannel(): RTCDataChannel {
    return this.dataChannel as unknown as RTCDataChannel;
  }

  onFileControl(handler: (ctrl: FileControlMessage) => void) {
    this.ctrlListeners.add(handler);
    return () => this.ctrlListeners.delete(handler);
  }

  onFileData(handler: (data: ArrayBuffer) => void) {
    this.dataListeners.add(handler);
    return () => this.dataListeners.delete(handler);
  }

  sendFileOffer(metadata: FileMetadata) {
    this.sendFileControl({ kind: "file-offer", metadata });
  }

  sendFileControl(control: FileControlMessage) {
    this.sentControls.push(control);
    queueMicrotask(() => {
      this.triggerControl(control);
    });
  }

  triggerControl(control: FileControlMessage) {
    for (const listener of this.ctrlListeners) {
      listener(control);
    }
  }

  triggerData(data: ArrayBuffer) {
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }
}

describe("FileTransferEngine", () => {
  const peerId = "01920000-0000-7000-8000-000000000001" as PeerId;
  let mockTransport: MockTransport;
  let engine: FileTransferEngine;

  async function flushMicrotasks(): Promise<void> {
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
    }
  }

  beforeEach(() => {
    mockTransport = new MockTransport();
    engine = new FileTransferEngine(peerId, mockTransport as unknown as PeerTransport);
  });

  it("handles incoming file offer and allows rejection", () => {
    let capturedSession: IncomingTransferSession | null = null;
    engine.onIncomingOffer((session) => {
      capturedSession = session;
    });

    const metadata: FileMetadata = {
      name: "doc.txt",
      size: 100,
      type: "text/plain",
    };

    mockTransport.triggerControl({ kind: "file-offer", metadata });

    const session = capturedSession as IncomingTransferSession | null;
    expect(session).not.toBeNull();
    assertDefined(session);
    expect(session.metadata).toEqual(metadata);

    session.reject("User declined");
    const cancelMsg = mockTransport.sentControls.find((c) => c.kind === "cancel");
    expect(cancelMsg).toBeDefined();
    assertDefined(cancelMsg);
    if (cancelMsg.kind === "cancel") {
      expect(cancelMsg.reason).toBe("User declined");
    }
  });

  it("streams file end-to-end to a destination stream", async () => {
    const fileBytes = new Uint8Array([10, 20, 30, 40, 50]);
    const file = new File([fileBytes], "sample.bin", { type: "application/octet-stream" });

    let transferCompleted = false;
    const receivedChunks: Uint8Array[] = [];

    const destination = new WritableStream<Uint8Array>({
      write(chunk) {
        receivedChunks.push(chunk);
      },
      close() {
        transferCompleted = true;
      },
    });

    let receivePromise: Promise<void> | undefined;
    engine.onIncomingOffer((session) => {
      receivePromise = session.accept(destination);
    });

    await engine.sendFile(file, { timeoutMs: 5000 });
    await receivePromise;

    expect(transferCompleted).toBe(true);
    const combinedLength = receivedChunks.reduce((acc, curr) => acc + curr.byteLength, 0);
    expect(combinedLength).toBe(fileBytes.length);
  });

  it("aborts the sender when the receiver's disk write fails (cancel, not pause)", async () => {
    const fileBytes = new Uint8Array([10, 20, 30, 40, 50]);
    const file = new File([fileBytes], "cancelled.bin", { type: "application/octet-stream" });

    // Simulates the browser cancelling the download mid-stream:
    // writer.write() throws, e.g. "Download cancelled".
    const destination = new WritableStream<Uint8Array>({
      write() {
        throw new Error("Download cancelled");
      },
    });

    let receivePromise: Promise<void> | undefined;
    engine.onIncomingOffer((session) => {
      receivePromise = session.accept(destination);
    });

    // Sender must reject (so its UI resets and resends are possible),
    // not hang forever waiting for a resume that never comes.
    await expect(engine.sendFile(file, { timeoutMs: 5000 })).rejects.toThrow(/Receiver cancelled/);
    await expect(receivePromise).rejects.toThrow(/Download cancelled/);

    // Receiver must signal cancel so the sender aborts, never a bare pause.
    const cancelMsg = mockTransport.sentControls.find((c) => c.kind === "cancel");
    expect(cancelMsg).toBeDefined();
    expect(mockTransport.sentControls.filter((c) => c.kind === "pause")).toHaveLength(0);
  });

  it("respects AbortSignal when sending", async () => {
    const fileBytes = new Uint8Array([1, 2, 3]);
    const file = new File([fileBytes], "abort.bin", { type: "application/octet-stream" });

    const controller = new AbortController();
    controller.abort();

    await expect(engine.sendFile(file, { signal: controller.signal })).rejects.toThrow("Aborted");
  });

  it("times out if receiver never accepts", async () => {
    const fileBytes = new Uint8Array([1, 2, 3]);
    const file = new File([fileBytes], "timeout.bin", { type: "application/octet-stream" });

    await expect(engine.sendFile(file, { timeoutMs: 20 })).rejects.toThrow(/Timeout/);
  });

  it("waits indefinitely for receiver accept by default (no timeout)", async () => {
    vi.useFakeTimers();
    try {
      const fileBytes = new Uint8Array([1, 2, 3]);
      const file = new File([fileBytes], "patient.bin", { type: "application/octet-stream" });

      let capturedSession: IncomingTransferSession | null = null;
      engine.onIncomingOffer((session) => {
        capturedSession = session;
      });

      const receivedChunks: Uint8Array[] = [];
      const destination = new WritableStream<Uint8Array>({
        write(chunk) {
          receivedChunks.push(chunk);
        },
      });

      let settled = false;
      const sendPromise = engine.sendFile(file).then(() => {
        settled = true;
      });

      // Past the old 60s accept timeout: still waiting, not failed.
      await vi.advanceTimersByTimeAsync(120_000);
      expect(settled).toBe(false);

      const session = capturedSession as IncomingTransferSession | null;
      expect(session).not.toBeNull();
      assertDefined(session);
      const receivePromise = session.accept(destination);
      await sendPromise;
      await receivePromise;

      expect(settled).toBe(true);
      const combinedLength = receivedChunks.reduce((acc, curr) => acc + curr.byteLength, 0);
      expect(combinedLength).toBe(fileBytes.length);
    } finally {
      vi.useRealTimers();
    }
  });

  it("handles 0-byte file transfer correctly", async () => {
    const file = new File([], "empty.txt", { type: "text/plain" });

    let transferCompleted = false;
    const destination = new WritableStream<Uint8Array>({
      write() {
        // Intentional no-op: discard chunks, completion is signaled via close().
      },
      close() {
        transferCompleted = true;
      },
    });

    let receivePromise: Promise<void> | undefined;
    engine.onIncomingOffer((session) => {
      receivePromise = session.accept(destination);
    });

    await engine.sendFile(file, { timeoutMs: 5000 });
    await receivePromise;

    expect(transferCompleted).toBe(true);
  });

  it("handles rapid multi-chunk writes with serialized queue without deadlocking", async () => {
    const totalChunks = 50;
    const chunkSize = 1024;
    const totalBytes = totalChunks * chunkSize;
    const data = new Uint8Array(totalBytes);
    for (let i = 0; i < totalBytes; i++) {
      data[i] = i % 256;
    }
    const file = new File([data], "large.bin", { type: "application/octet-stream" });

    let transferCompleted = false;
    let concurrentWrites = 0;
    let maxConcurrentWrites = 0;
    const receivedChunks: Uint8Array[] = [];

    const destination = new WritableStream<Uint8Array>({
      async write(chunk) {
        concurrentWrites++;
        maxConcurrentWrites = Math.max(maxConcurrentWrites, concurrentWrites);
        await new Promise((r) => setTimeout(r, 1));
        receivedChunks.push(chunk);
        concurrentWrites--;
      },
      close() {
        transferCompleted = true;
      },
    });

    let receivePromise: Promise<void> | undefined;
    engine.onIncomingOffer((session) => {
      receivePromise = session.accept(destination);
    });

    await engine.sendFile(file, { timeoutMs: 5000 });
    await receivePromise;

    expect(transferCompleted).toBe(true);
    expect(maxConcurrentWrites).toBe(1);
    const combinedLength = receivedChunks.reduce((acc, curr) => acc + curr.byteLength, 0);
    expect(combinedLength).toBe(totalBytes);
  });

  it("pauses sender when receiver write queue hits high watermark and resumes at low watermark", async () => {
    const chunkSize = 128 * 1024;
    const totalChunks = 40;
    const totalBytes = totalChunks * chunkSize;
    const data = new Uint8Array(totalBytes);
    for (let i = 0; i < totalBytes; i++) {
      data[i] = (i * 7) % 256;
    }
    const file = new File([data], "backpressure.bin", { type: "application/octet-stream" });

    let releaseWrites!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrites = resolve;
    });

    const receivedChunks: Uint8Array[] = [];
    let transferCompleted = false;

    const destination = new WritableStream<Uint8Array>({
      async write(chunk) {
        await writeGate;
        receivedChunks.push(chunk);
      },
      close() {
        transferCompleted = true;
      },
    });

    let receivePromise: Promise<void> | undefined;
    engine.onIncomingOffer((session) => {
      receivePromise = session.accept(destination);
    });

    const sendPromise = engine.sendFile(file, { timeoutMs: 5000 });

    await vi.waitFor(
      () => {
        expect(mockTransport.sentControls.some((c) => c.kind === "pause")).toBe(true);
      },
      { timeout: 1000 },
    );

    const chunksSentAtPause = mockTransport.sentChunks.length;
    expect(chunksSentAtPause).toBeGreaterThanOrEqual(BACKPRESSURE_PAUSE_THRESHOLD);
    expect(chunksSentAtPause).toBeLessThan(totalChunks);

    await flushMicrotasks();
    expect(mockTransport.sentChunks.length).toBe(chunksSentAtPause);

    releaseWrites();

    await vi.waitFor(
      () => {
        expect(mockTransport.sentControls.some((c) => c.kind === "resume")).toBe(true);
      },
      { timeout: 1000 },
    );

    await sendPromise;
    await receivePromise;

    expect(transferCompleted).toBe(true);
    const combinedLength = receivedChunks.reduce((acc, curr) => acc + curr.byteLength, 0);
    expect(combinedLength).toBe(totalBytes);

    const reconstructed = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of receivedChunks) {
      reconstructed.set(chunk, offset);
      offset += chunk.byteLength;
    }
    expect(reconstructed.byteLength).toBe(data.byteLength);
    expect(Buffer.from(reconstructed.buffer).equals(Buffer.from(data.buffer))).toBe(true);
  });

  it("does not flap pause and resume during transfer", async () => {
    const chunkSize = 128 * 1024;
    const totalChunks = 40;
    const totalBytes = totalChunks * chunkSize;
    const data = new Uint8Array(totalBytes);
    for (let i = 0; i < totalBytes; i++) {
      data[i] = i % 256;
    }
    const file = new File([data], "noflap.bin", { type: "application/octet-stream" });

    let releaseWrites!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrites = resolve;
    });

    const destination = new WritableStream<Uint8Array>({
      async write() {
        await writeGate;
      },
    });

    let receivePromise: Promise<void> | undefined;
    engine.onIncomingOffer((session) => {
      receivePromise = session.accept(destination);
    });

    const sendPromise = engine.sendFile(file, { timeoutMs: 5000 });

    await vi.waitFor(() => {
      expect(mockTransport.sentControls.some((c) => c.kind === "pause")).toBe(true);
    });

    releaseWrites();

    await sendPromise;
    await receivePromise;

    const pauses = mockTransport.sentControls.filter((c) => c.kind === "pause");
    const resumes = mockTransport.sentControls.filter((c) => c.kind === "resume");
    expect(pauses).toHaveLength(1);
    expect(resumes).toHaveLength(1);
  });

  it("freezes a sender-paused transfer and completes byte-identical after resume", async () => {
    const chunkSize = 128 * 1024;
    const totalChunks = 40;
    const totalBytes = totalChunks * chunkSize;
    const data = new Uint8Array(totalBytes);
    for (let i = 0; i < totalBytes; i++) {
      data[i] = (i * 13) % 256;
    }
    const file = new File([data], "user-pause.bin", { type: "application/octet-stream" });

    // Hold receiver writes so the sender is still mid-stream when we pause.
    let releaseWrites!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrites = resolve;
    });

    const receivedChunks: Uint8Array[] = [];
    let transferCompleted = false;
    const destination = new WritableStream<Uint8Array>({
      async write(chunk) {
        await writeGate;
        receivedChunks.push(chunk);
      },
      close() {
        transferCompleted = true;
      },
    });

    let receivePromise: Promise<void> | undefined;
    engine.onIncomingOffer((session) => {
      receivePromise = session.accept(destination);
    });

    const sendPromise = engine.sendFile(file, { timeoutMs: 5000 });

    await vi.waitFor(() => {
      expect(mockTransport.sentChunks.length).toBeGreaterThan(0);
    });

    engine.pauseSending();
    expect(engine.isUserPaused).toBe(true);

    const chunksAtPause = mockTransport.sentChunks.length;
    await flushMicrotasks();
    // No chunks flow while user-paused; nothing is buffered in memory.
    expect(mockTransport.sentChunks.length).toBe(chunksAtPause);

    // Releasing the receiver must NOT unblock a user-paused transfer: the
    // receiver-driven resume only releases the backpressure gate.
    releaseWrites();
    await flushMicrotasks();
    expect(mockTransport.sentChunks.length).toBe(chunksAtPause);
    expect(engine.isUserPaused).toBe(true);

    engine.resumeSending();
    expect(engine.isUserPaused).toBe(false);

    await sendPromise;
    await receivePromise;

    expect(transferCompleted).toBe(true);
    const combinedLength = receivedChunks.reduce((acc, curr) => acc + curr.byteLength, 0);
    expect(combinedLength).toBe(totalBytes);

    const reconstructed = new Uint8Array(totalBytes);
    let offset = 0;
    for (const chunk of receivedChunks) {
      reconstructed.set(chunk, offset);
      offset += chunk.byteLength;
    }
    expect(Buffer.from(reconstructed.buffer).equals(Buffer.from(data.buffer))).toBe(true);
  });

  it("keeps a user-paused transfer frozen when receiver backpressure resumes", async () => {
    const chunkSize = 128 * 1024;
    const totalChunks = 40;
    const totalBytes = totalChunks * chunkSize;
    const data = new Uint8Array(totalBytes);
    const file = new File([data], "dual-gate.bin", { type: "application/octet-stream" });

    let releaseWrites!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrites = resolve;
    });

    const destination = new WritableStream<Uint8Array>({
      async write() {
        await writeGate;
      },
    });

    let receivePromise: Promise<void> | undefined;
    engine.onIncomingOffer((session) => {
      receivePromise = session.accept(destination);
    });

    const sendPromise = engine.sendFile(file, { timeoutMs: 5000 });

    await vi.waitFor(() => {
      expect(mockTransport.sentChunks.length).toBeGreaterThan(0);
    });

    engine.pauseSending();
    const chunksAtPause = mockTransport.sentChunks.length;

    // A receiver-driven resume must only release the backpressure gate, never
    // the user gate.
    mockTransport.triggerControl({ kind: "resume" });
    await flushMicrotasks();
    expect(mockTransport.sentChunks.length).toBe(chunksAtPause);
    expect(engine.isUserPaused).toBe(true);

    releaseWrites();
    engine.resumeSending();
    await sendPromise;
    await receivePromise;
  });

  it("aborts a user-paused transfer when the receiver cancels mid-stream", async () => {
    const chunkSize = 128 * 1024;
    const totalChunks = 40;
    const totalBytes = totalChunks * chunkSize;
    const data = new Uint8Array(totalBytes);
    const file = new File([data], "pause-then-cancel.bin", { type: "application/octet-stream" });

    let releaseWrites!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      releaseWrites = resolve;
    });

    const destination = new WritableStream<Uint8Array>({
      async write() {
        await writeGate;
      },
    });

    let receivePromise: Promise<void> | undefined;
    engine.onIncomingOffer((session) => {
      receivePromise = session.accept(destination);
    });

    const sendPromise = engine.sendFile(file, { timeoutMs: 5000 });

    await vi.waitFor(() => {
      expect(mockTransport.sentChunks.length).toBeGreaterThan(0);
    });

    engine.pauseSending();
    releaseWrites();
    mockTransport.triggerControl({ kind: "cancel", reason: "Receiver aborted" });

    // Must reject (not hang on the user gate) with the receiver's reason.
    await expect(sendPromise).rejects.toThrow(/Receiver cancelled/);
    await expect(receivePromise).rejects.toThrow();
  });

  it("resets backpressure state if transfer fails while paused, allowing next transfer to run cleanly", async () => {
    const chunkSize = 128 * 1024;
    const totalChunks = 40;
    const data = new Uint8Array(totalChunks * chunkSize);
    const file1 = new File([data], "failed-transfer.bin", { type: "application/octet-stream" });

    const abortController = new AbortController();
    const destination1 = new WritableStream<Uint8Array>({
      async write() {
        await new Promise((_, reject) => {
          if (abortController.signal.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
          }
          abortController.signal.addEventListener("abort", () => {
            reject(new DOMException("Aborted", "AbortError"));
          });
        });
      },
    });

    let receivePromise1: Promise<void> | undefined;
    const unsubOffer1 = engine.onIncomingOffer((session) => {
      receivePromise1 = session.accept(destination1, { signal: abortController.signal });
    });

    const sendPromise1 = engine.sendFile(file1, { timeoutMs: 5000 });

    await vi.waitFor(() => {
      expect(mockTransport.sentControls.some((c) => c.kind === "pause")).toBe(true);
    });

    abortController.abort();

    await expect(receivePromise1).rejects.toThrow();
    await expect(sendPromise1).rejects.toThrow();

    unsubOffer1();

    const file2Bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const file2 = new File([file2Bytes], "clean-transfer.bin", { type: "application/octet-stream" });
    const receivedChunks2: Uint8Array[] = [];

    const destination2 = new WritableStream<Uint8Array>({
      write(chunk) {
        receivedChunks2.push(chunk);
      },
    });

    let receivePromise2: Promise<void> | undefined;
    engine.onIncomingOffer((session) => {
      receivePromise2 = session.accept(destination2);
    });

    await engine.sendFile(file2, { timeoutMs: 5000 });
    await receivePromise2;

    const totalReceived2 = receivedChunks2.reduce((acc, c) => acc + c.byteLength, 0);
    expect(totalReceived2).toBe(file2Bytes.length);
  });

  it("aborts transfer and cleans up when dataChannel closes mid-stream", async () => {
    const chunkSize = 128 * 1024;
    const totalChunks = 10;
    const data = new Uint8Array(totalChunks * chunkSize);
    const file = new File([data], "dc-abrupt-close.bin", { type: "application/octet-stream" });

    let writeCount = 0;
    const destination = new WritableStream<Uint8Array>({
      write() {
        writeCount++;
        if (writeCount === 2) {
          // Simulate abrupt DataChannel close and notify receiver
          mockTransport.dataChannel.close();
          mockTransport.triggerControl({ kind: "error", message: "DataChannel connection dropped" });
        }
      },
    });

    let receivePromise: Promise<void> | undefined;
    engine.onIncomingOffer((session) => {
      receivePromise = session.accept(destination);
    });

    const sendPromise = engine.sendFile(file, { timeoutMs: 5000 });

    await expect(sendPromise).rejects.toThrow();
    await expect(receivePromise).rejects.toThrow();
    expect(engine.isUserPaused).toBe(false);
  });

  it("fails the sender visibly when backpressure never resumes (stalled receiver)", async () => {
    const chunkSize = 128 * 1024;
    const totalChunks = 40;
    const totalBytes = totalChunks * chunkSize;
    const data = new Uint8Array(totalBytes);
    const file = new File([data], "stalled.bin", { type: "application/octet-stream" });

    // Receiver disk leg never drains: writes block forever and no resume comes.
    const destination = new WritableStream<Uint8Array>({
      write() {
        return new Promise<never>(() => undefined);
      },
    });

    let receivePromise: Promise<void> | undefined;
    engine.onIncomingOffer((session) => {
      receivePromise = session.accept(destination);
    });

    await expect(engine.sendFile(file, { timeoutMs: 5000, stallTimeoutMs: 300 })).rejects.toThrow(/stalled/);

    // The sender must have told the receiver to abort so both sides reset.
    expect(mockTransport.sentControls.some((c) => c.kind === "error")).toBe(true);
    // The receiver's writer.abort() races a timeout behind its wedged write.
    await expect(receivePromise).rejects.toThrow();
  }, 15_000);

  it("cancels instead of hanging when the download sink errors while paused", async () => {
    // Multiple chunks: the first lands, the sink reports a full buffer, and
    // writer.ready rejects instead of draining (browser blocked the download).
    const fileBytes = new Uint8Array(3 * 128 * 1024);
    const file = new File([fileBytes], "blocked-download.bin", { type: "application/octet-stream" });

    // Simulates the browser blocking the download: the first write lands, the
    // sink reports a full buffer, and writer.ready rejects instead of draining.
    const readyError = new Error("Download blocked");
    const fakeWriter = {
      desiredSize: 0,
      // Getter so the rejection is created (and handled) exactly when the
      // engine attaches, avoiding unhandled-rejection noise.
      get ready(): Promise<void> {
        return Promise.reject(readyError);
      },
      write: async () => undefined,
      close: async () => undefined,
      abort: async () => undefined,
      releaseLock: () => undefined,
    };
    const destination = {
      getWriter: () => fakeWriter,
    } as unknown as WritableStream<Uint8Array>;

    let receiveOutcome: Promise<string> | undefined;
    engine.onIncomingOffer((session) => {
      // Attach handlers synchronously at creation: the receiver fails fast
      // (microtasks), and handlers attached a macrotask later would flag
      // unhandled rejections even though the assertions still pass.
      receiveOutcome = session.accept(destination).then(
        () => "resolved",
        (err: unknown) => (err instanceof Error ? err.message : String(err)),
      );
    });

    const sendPromise = engine.sendFile(file, { timeoutMs: 5000, stallTimeoutMs: 5000 });
    const sendOutcome = sendPromise.then(
      () => "resolved",
      (err: unknown) => (err instanceof Error ? err.message : String(err)),
    );

    await vi.waitFor(() => expect(receiveOutcome).toBeDefined());
    await expect(receiveOutcome).resolves.toMatch(/Download blocked/);

    const kinds = mockTransport.sentControls.map((c) => c.kind);
    expect(kinds).toContain("pause");
    expect(kinds).toContain("cancel");
    expect(kinds).not.toContain("resume");

    // The sender must settle (reject via the cancel, or resolve if its chunks
    // won the race) — never hang forever on the pause.
    await expect(sendOutcome).resolves.toMatch(/resolved|cancelled/i);
  });
});
