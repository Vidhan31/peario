/**
 * Returns a transform stream that breaks down `Uint8Array` data into fixed-size chunks.
 */
export function createChunkTransformStream(chunkSize = 128 * 1024): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
      for (let offset = 0; offset < chunk.length; offset += chunkSize) {
        const end = offset + chunkSize;
        const chunkData = chunk.subarray(offset, end);
        controller.enqueue(chunkData);
      }
    },
  });
}
