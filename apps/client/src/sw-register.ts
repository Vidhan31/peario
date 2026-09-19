import { webrtcLogger } from "./lib/logger";

export function registerServiceWorker(): void {
  if (typeof window === "undefined" || typeof navigator === "undefined") return;
  if (!("serviceWorker" in navigator)) return;

  void navigator.serviceWorker.register("/sw.js").catch((error: unknown) => {
    webrtcLogger.warn("Service worker registration failed:", error);
  });
}
