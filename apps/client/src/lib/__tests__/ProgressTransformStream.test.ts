import { describe, expect, it, vi } from "vitest";

import { createProgressTransformStream } from "../ProgressTransformStream";

async function pipeAndCollect(
  transformStream: TransformStream<Uint8Array, Uint8Array>,
  inputChunks: Uint8Array[],
): Promise<Uint8Array[]> {
  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of inputChunks) {
        controller.enqueue(chunk);
      }
      controller.close();
    },
  });

  const reader = source.pipeThrough(transformStream).getReader();
  const output: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    output.push(value);
  }
  return output;
}

describe("createProgressTransformStream", () => {
  it("accumulates processed bytes across chunks and calls onProgress monotonically", async () => {
    const progressReports: number[] = [];
    const onProgress = vi.fn((bytes: number) => {
      progressReports.push(bytes);
    });

    const stream = createProgressTransformStream(onProgress);
    const chunk1 = new Uint8Array(100);
    const chunk2 = new Uint8Array(250);
    const chunk3 = new Uint8Array(50);

    const chunks = await pipeAndCollect(stream, [chunk1, chunk2, chunk3]);

    expect(chunks).toHaveLength(3);
    expect(progressReports).toEqual([100, 350, 400]);
    expect(onProgress).toHaveBeenCalledTimes(3);
  });

  it("passes byte contents through transparently without mutation", async () => {
    const onProgress = vi.fn();
    const stream = createProgressTransformStream(onProgress);

    const originalData = new Uint8Array([10, 20, 30, 40]);
    const chunks = await pipeAndCollect(stream, [originalData]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toBe(originalData);
  });
});
