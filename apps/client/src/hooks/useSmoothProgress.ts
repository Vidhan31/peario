import { useEffect, useRef, useState } from "react";

import type { ProgressController } from "@/hooks/useProgressController";
import type { SenderProgress } from "@/types/TransferProgress";

/**
 * Subscribes to transfer progress and batches updates through
 * requestAnimationFrame so React renders at most once per paint.
 * Skips state updates when the rounded percentage and byte count are
 * unchanged, eliminating text flicker and layout thrash.
 */
export function useSmoothProgress(
  transferId: string,
  totalBytes: number,
  progressController: ProgressController,
): SenderProgress {
  const [progress, setProgress] = useState<SenderProgress>(() => ({
    bytesTransferred: 0,
    bytesBuffered: 0,
    timestamp: Date.now(),
  }));

  const latestRef = useRef<SenderProgress | null>(null);
  const rafRef = useRef<number>(0);
  const lastRenderedRef = useRef<{ bytes: number; percentage: number }>({ bytes: 0, percentage: 0 });

  useEffect(() => {
    lastRenderedRef.current = { bytes: 0, percentage: 0 };
    latestRef.current = null;

    const flush = () => {
      rafRef.current = 0;
      const latest = latestRef.current;
      if (!latest) return;
      latestRef.current = null;

      const percentage = totalBytes > 0 ? Math.min(Math.round((latest.bytesTransferred / totalBytes) * 100), 100) : 0;
      const last = lastRenderedRef.current;
      if (latest.bytesTransferred === last.bytes && percentage === last.percentage) return;

      lastRenderedRef.current = { bytes: latest.bytesTransferred, percentage };
      setProgress(latest);
    };

    const unsubscribe = progressController.subscribe(transferId, (next) => {
      latestRef.current = next;
      if (rafRef.current === 0) {
        rafRef.current = requestAnimationFrame(flush);
      }
    });

    return () => {
      unsubscribe();
      if (rafRef.current !== 0) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
      latestRef.current = null;
    };
  }, [transferId, totalBytes, progressController]);

  return progress;
}
