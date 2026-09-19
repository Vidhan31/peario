import { useCallback, useMemo, useRef } from "react";

import type { SenderProgress } from "../types/TransferProgress";

export type ProgressListener = (progress: SenderProgress) => void;

export interface ProgressController {
  subscribe: (messageId: string, listener: ProgressListener) => () => void;
  emit: (messageId: string, progress: SenderProgress) => void;
  clear: (messageId: string) => void;
}

/** Coalesce progress bursts to ~10fps; trailing flush keeps the bar accurate. */
export const PROGRESS_EMIT_INTERVAL_MS = 100;

export function useProgressController(): ProgressController {
  const listenersRef = useRef<Map<string, Set<ProgressListener>>>(new Map());
  const lastEmitRef = useRef<Map<string, number>>(new Map());
  const pendingRef = useRef<Map<string, { timeout: ReturnType<typeof setTimeout>; progress: SenderProgress }>>(
    new Map(),
  );

  const subscribe = useCallback((messageId: string, listener: ProgressListener) => {
    const listeners = listenersRef.current.get(messageId) ?? new Set();
    listeners.add(listener);
    listenersRef.current.set(messageId, listeners);

    return () => {
      const currentListeners = listenersRef.current.get(messageId);
      if (currentListeners) {
        currentListeners.delete(listener);
        if (currentListeners.size === 0) {
          listenersRef.current.delete(messageId);
        }
      }
    };
  }, []);

  const flush = useCallback((messageId: string) => {
    const pending = pendingRef.current.get(messageId);
    if (!pending) return;
    pendingRef.current.delete(messageId);
    lastEmitRef.current.set(messageId, Date.now());
    const listeners = listenersRef.current.get(messageId);
    if (listeners) {
      for (const listener of listeners) {
        listener(pending.progress);
      }
    }
  }, []);

  const emit = useCallback(
    (messageId: string, progress: SenderProgress) => {
      const listeners = listenersRef.current.get(messageId);
      if (!listeners || listeners.size === 0) return;

      const now = Date.now();
      const last = lastEmitRef.current.get(messageId) ?? 0;

      // Coalesce per-chunk bursts to ~10fps to avoid excessive React renders while guaranteeing trailing flush.
      if (now - last >= PROGRESS_EMIT_INTERVAL_MS) {
        const pending = pendingRef.current.get(messageId);
        if (pending) {
          clearTimeout(pending.timeout);
          pendingRef.current.delete(messageId);
        }
        lastEmitRef.current.set(messageId, now);
        for (const listener of listeners) {
          listener(progress);
        }
        return;
      }

      const existing = pendingRef.current.get(messageId);
      if (existing) {
        existing.progress = progress;
        return;
      }
      const delay = PROGRESS_EMIT_INTERVAL_MS - (now - last);
      const timeout = setTimeout(() => {
        flush(messageId);
      }, delay);
      pendingRef.current.set(messageId, { timeout, progress });
    },
    [flush],
  );

  const clear = useCallback((messageId: string) => {
    const pending = pendingRef.current.get(messageId);
    if (pending) {
      clearTimeout(pending.timeout);
      pendingRef.current.delete(messageId);
    }
    lastEmitRef.current.delete(messageId);
    listenersRef.current.delete(messageId);
  }, []);

  return useMemo(() => ({ subscribe, emit, clear }), [subscribe, emit, clear]);
}
