import { formatValidationError, RateLimitedDataSchema, validatePayload } from "@peario/shared";
import { use, useEffect } from "react";

import { ToastContext } from "../contexts/ToastContext";
import { socketLogger } from "../lib/logger";
import { socket } from "../lib/SocketService";

export function useRateLimitHandler() {
  const context = use(ToastContext);

  useEffect(() => {
    if (!context) return;

    const handleRateLimited = (rawData: unknown) => {
      const validation = validatePayload(RateLimitedDataSchema, rawData);
      if (!validation.success) {
        socketLogger.error(`Invalid rate-limited payload: ${formatValidationError(validation.error)}`);
        return;
      }
      const data = validation.data;

      const retrySeconds = Math.ceil(data.retryAfterMs / 1000);
      context.addToast({
        type: "warning",
        title: "Rate Limited",
        message: `${data.message} Retry in ${retrySeconds}s.`,
        duration: Math.min(data.retryAfterMs, 10000),
      });
    };

    socket.on("rate-limited", handleRateLimited);

    return () => {
      socket.off("rate-limited", handleRateLimited);
    };
  }, [context]);
}
