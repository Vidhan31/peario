type ProgressCallback = (bytesProcessed: number) => void;

/**
 * Returns a transform stream that tracks the number of bytes processed and reports progress.
 * Can be used for both sending and receiving files to track progress.
 */
export function createProgressTransformStream(onProgress: ProgressCallback): TransformStream<Uint8Array, Uint8Array> {
  let bytesProcessed = 0;

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk: Uint8Array, controller: TransformStreamDefaultController<Uint8Array>) {
      bytesProcessed += chunk.byteLength;
      onProgress(bytesProcessed);
      controller.enqueue(chunk);
    },
  });
}
