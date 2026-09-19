export const APP_CACHE_VERSION = "peario-v1.0.0";

export function shouldBypassServiceWorker(url: string | URL): boolean {
  try {
    const parsed = typeof url === "string" ? new URL(url, "https://peario.app") : url;
    const pathname = parsed.pathname;
    const hostname = parsed.hostname;

    if (pathname.includes("/socket.io/")) {
      return true;
    }
    if (pathname.includes("/api/turn-credentials")) {
      return true;
    }
    if (hostname.includes("metered.live")) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}
