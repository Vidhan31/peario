import { describe, expect, it } from "vitest";

import { FakeRTCDataChannel } from "@/test/fakes";
import { Pausable } from "@/utils/FileUtils";

import { createDataChannelWritableStream, sendStreamOverDataChannel } from "../WriteableDataChannelStream";

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

describe("WriteableDataChannelStream & WebRTC Flow Control", () => {
  it("rejects immediately if dataChannel is not open", () => {
    const fakeDc = new FakeRTCDataChannel("file-data");
    fakeDc.readyState = "connecting";

    expect(() => createDataChannelWritableStream(fakeDc as unknown as RTCDataChannel)).toThrowError(
      /DataChannel not open/,
    );
  });

  it("pipes stream chunks over RTCDataChannel", async () => {
    const fakeDc = new FakeRTCDataChannel("file-data");
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.enqueue(new Uint8Array([4, 5]));
        controller.close();
      },
    });

    await sendStreamOverDataChannel(stream, fakeDc as unknown as RTCDataChannel);

    expect(fakeDc.sentMessages).toHaveLength(2);
    expect(fakeDc.sentMessages[0]).toEqual(new Uint8Array([1, 2, 3]));
    expect(fakeDc.sentMessages[1]).toEqual(new Uint8Array([4, 5]));
  });

  it("applies backpressure when bufferedAmount exceeds maxBufferedBytes and drains on bufferedamountlow", async () => {
    const fakeDc = new FakeRTCDataChannel("file-data");
    const maxBuffered = 100;
    const stream = createDataChannelWritableStream(fakeDc as unknown as RTCDataChannel, {
      maxBufferedBytes: maxBuffered,
      lowThresholdBytes: 20,
    });
    const writer = stream.getWriter();

    // Chunk 1: fits within budget
    await writer.write(new Uint8Array(80));
    expect(fakeDc.sentMessages).toHaveLength(1);

    // Simulate buffer holding 80 bytes
    fakeDc.bufferedAmount = 80;

    // Chunk 2: 80 + 30 = 110 > 100 -> must wait for buffer to drain
    let write2Resolved = false;
    const write2Promise = writer.write(new Uint8Array(30)).then(() => {
      write2Resolved = true;
    });

    // Verify it is blocked waiting for buffer low
    await flushMicrotasks();
    expect(write2Resolved).toBe(false);

    // Buffer drains below threshold
    fakeDc.bufferedAmount = 10;
    fakeDc.trigger("bufferedamountlow");

    await write2Promise;
    expect(write2Resolved).toBe(true);
    expect(fakeDc.sentMessages).toHaveLength(2);
  });

  it("pauses chunk dispatch when a Pausable gate is active and resumes when unblocked", async () => {
    const fakeDc = new FakeRTCDataChannel("file-data");
    const pauseGate = new Pausable();

    const stream = createDataChannelWritableStream(fakeDc as unknown as RTCDataChannel, {
      pausable: pauseGate,
    });
    const writer = stream.getWriter();

    // Pause the gate before writing
    pauseGate.pause();

    let writeDone = false;
    const writePromise = writer.write(new Uint8Array([10, 20])).then(() => {
      writeDone = true;
    });

    await flushMicrotasks();
    expect(writeDone).toBe(false);
    expect(fakeDc.sentMessages).toHaveLength(0);

    // Resume the gate -> write proceeds immediately
    pauseGate.resume();
    await writePromise;

    expect(writeDone).toBe(true);
    expect(fakeDc.sentMessages).toHaveLength(1);
  });

  it("aborts writes immediately when AbortSignal triggers", async () => {
    const fakeDc = new FakeRTCDataChannel("file-data");
    const abortController = new AbortController();

    const stream = createDataChannelWritableStream(fakeDc as unknown as RTCDataChannel, {
      signal: abortController.signal,
    });
    const writer = stream.getWriter();

    abortController.abort();

    await expect(writer.write(new Uint8Array([1, 2, 3]))).rejects.toThrow();
  });

  it("throws error if DataChannel closes while waiting for buffer to drain", async () => {
    const fakeDc = new FakeRTCDataChannel("file-data");
    const stream = createDataChannelWritableStream(fakeDc as unknown as RTCDataChannel, {
      maxBufferedBytes: 50,
      lowThresholdBytes: 10,
    });
    const writer = stream.getWriter();

    fakeDc.bufferedAmount = 60; // Exceeds 50

    const writePromise = writer.write(new Uint8Array(20));
    await flushMicrotasks();

    // Channel closes while waiting
    fakeDc.readyState = "closed";
    fakeDc.trigger("close");

    await expect(writePromise).rejects.toThrow(/DataChannel (is not open|closed)/);
  });

  it("throws error if DataChannel errors while waiting for buffer to drain", async () => {
    const fakeDc = new FakeRTCDataChannel("file-data");
    const stream = createDataChannelWritableStream(fakeDc as unknown as RTCDataChannel, {
      maxBufferedBytes: 50,
      lowThresholdBytes: 10,
    });
    const writer = stream.getWriter();

    fakeDc.bufferedAmount = 60;

    const writePromise = writer.write(new Uint8Array(20));
    await flushMicrotasks();

    fakeDc.trigger("error");

    await expect(writePromise).rejects.toThrow(/DataChannel (is not open|closed)/);
  });
});
