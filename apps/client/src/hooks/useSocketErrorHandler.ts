import { use, useEffect, useRef } from "react";

import { TOAST_DURATIONS_MS } from "../constants/index.ts";
import { ToastContext } from "../contexts/ToastContext";
import { socketService } from "../lib/SocketService";

export function useSocketErrorHandler() {
  const context = use(ToastContext);
  const hasShownInitialErrorRef = useRef(false);
  const reconnectToastIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (!context) return;

    const unsubscribeError = socketService.onConnectionError((error) => {
      const isInitialConnection = !socketService.socket.connected && !hasShownInitialErrorRef.current;

      if (isInitialConnection) {
        hasShownInitialErrorRef.current = true;
        context.addToast({
          type: "error",
          title: "Connection Failed",
          message: "Unable to reach the signaling server. Please check your internet connection and try again.",
          duration: TOAST_DURATIONS_MS.CONNECTION_FAILED,
        });
      } else if (error.message.includes("Failed to reconnect")) {
        context.addToast({
          type: "error",
          title: "Connection Lost",
          message: "Unable to reconnect to the signaling server. Please refresh the page.",
          duration: TOAST_DURATIONS_MS.CONNECTION_LOST,
        });
      }
    });

    const unsubscribeReconnect = socketService.onReconnectAttempt((attemptNumber) => {
      if (attemptNumber === 1 && !reconnectToastIdRef.current) {
        reconnectToastIdRef.current = context.addToast({
          type: "warning",
          title: "Connection Lost",
          message: "Attempting to reconnect to the signaling server...",
          duration: TOAST_DURATIONS_MS.RECONNECTING,
        });
      }
    });

    const handleReconnect = () => {
      if (reconnectToastIdRef.current) {
        context.removeToast(reconnectToastIdRef.current);
        reconnectToastIdRef.current = null;
      }
      context.addToast({
        type: "success",
        title: "Reconnected",
        message: "Successfully reconnected to the signaling server.",
        duration: TOAST_DURATIONS_MS.RECONNECTED,
      });
    };

    socketService.socket.on("connect", handleReconnect);

    return () => {
      unsubscribeError();
      unsubscribeReconnect();
      socketService.socket.off("connect", handleReconnect);
    };
  }, [context]);
}
