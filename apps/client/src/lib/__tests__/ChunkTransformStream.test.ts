import { describe, expect, it } from "vitest";

import { createChunkTransformStream } from "../ChunkTransformStream";

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

describe("createChunkTransformStream", () => {
  it("chunks a large buffer into exact fixed-size slices", async () => {
    const chunkSize = 16;
    const stream = createChunkTransformStream(chunkSize);

    // 40 bytes input -> 16 + 16 + 8 byte chunks
    const data = new Uint8Array(40);
    for (let i = 0; i < 40; i++) data[i] = i;

    const chunks = await pipeAndCollect(stream, [data]);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.byteLength).toBe(16);
    expect(chunks[1]?.byteLength).toBe(16);
    expect(chunks[2]?.byteLength).toBe(8);

    // Verify concatenated data matches original
    const totalBytes = chunks.reduce((acc, c) => acc + c.byteLength, 0);
    expect(totalBytes).toBe(40);
    expect(chunks[0]?.[0]).toBe(0);
    expect(chunks[1]?.[0]).toBe(16);
    expect(chunks[2]?.[0]).toBe(32);
  });

  it("passes chunks smaller than chunkSize through as a single slice", async () => {
    const chunkSize = 64;
    const stream = createChunkTransformStream(chunkSize);

    const smallData = new Uint8Array([1, 2, 3, 4, 5]);
    const chunks = await pipeAndCollect(stream, [smallData]);

    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.byteLength).toBe(5);
    expect(Array.from(chunks[0] ?? [])).toEqual([1, 2, 3, 4, 5]);
  });

  it("handles 0-byte buffer without producing chunks", async () => {
    const stream = createChunkTransformStream(16);
    const chunks = await pipeAndCollect(stream, [new Uint8Array(0)]);
    expect(chunks).toHaveLength(0);
  });

  it("passes multiple chunks smaller than chunkSize through without coalescing", async () => {
    const chunkSize = 16;
    const stream = createChunkTransformStream(chunkSize);

    const chunkA = new Uint8Array([1, 2, 3]);
    const chunkB = new Uint8Array([4, 5, 6, 7]);
    const chunkC = new Uint8Array([8, 9]);

    const chunks = await pipeAndCollect(stream, [chunkA, chunkB, chunkC]);

    expect(chunks).toHaveLength(3);
    expect(chunks[0]?.byteLength).toBe(3);
    expect(chunks[1]?.byteLength).toBe(4);
    expect(chunks[2]?.byteLength).toBe(2);
    expect(Array.from(chunks[0] ?? [])).toEqual([1, 2, 3]);
    expect(Array.from(chunks[1] ?? [])).toEqual([4, 5, 6, 7]);
    expect(Array.from(chunks[2] ?? [])).toEqual([8, 9]);
  });

  it("slices uneven multi-chunk inputs independently without cross-chunk buffering", async () => {
    const chunkSize = 10;
    const stream = createChunkTransformStream(chunkSize);

    // Chunk 1: 25 bytes -> slices into 10 + 10 + 5
    // Chunk 2: 7 bytes  -> passes through as 7
    const chunk1 = new Uint8Array(25);
    for (let i = 0; i < 25; i++) chunk1[i] = i;
    const chunk2 = new Uint8Array([100, 101, 102, 103, 104, 105, 106]);

    const chunks = await pipeAndCollect(stream, [chunk1, chunk2]);

    expect(chunks).toHaveLength(4);
    expect(chunks[0]?.byteLength).toBe(10);
    expect(chunks[1]?.byteLength).toBe(10);
    expect(chunks[2]?.byteLength).toBe(5);
    expect(chunks[3]?.byteLength).toBe(7);
  });
});
