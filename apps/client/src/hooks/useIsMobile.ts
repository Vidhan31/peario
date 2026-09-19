import { useSyncExternalStore } from "react";

function getIsMobileSnapshot(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }
  const isMobileUA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
  const isCoarsePointer = window.matchMedia("(pointer: coarse) and (max-width: 1024px)").matches;
  return isMobileUA || isCoarsePointer;
}

function getServerSnapshot(): boolean {
  return false;
}

function noop(): void {
  // SSR fallback
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") {
    return noop;
  }
  window.addEventListener("resize", callback);
  const mql = window.matchMedia("(pointer: coarse) and (max-width: 1024px)");
  mql.addEventListener("change", callback);

  return () => {
    window.removeEventListener("resize", callback);
    mql.removeEventListener("change", callback);
  };
}

export function useIsMobile(): boolean {
  return useSyncExternalStore(subscribe, getIsMobileSnapshot, getServerSnapshot);
}
