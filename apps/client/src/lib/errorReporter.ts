import type { ClientErrorReport } from "@peario/shared";

export interface ErrorReporterConfig {
  sampleRate: number;
  maxReportsPerWindow: number;
  windowMs: number;
  endpoint: string;
}

const DEFAULT_CONFIG: ErrorReporterConfig = {
  sampleRate: 1.0,
  maxReportsPerWindow: 5,
  windowMs: 30000,
  endpoint: "/api/client-errors",
};

let currentConfig: ErrorReporterConfig = { ...DEFAULT_CONFIG };
let sentTimestamps: number[] = [];

export function configureErrorReporter(config: Partial<ErrorReporterConfig>): void {
  currentConfig = { ...currentConfig, ...config };
}

export function _resetErrorReporterForTesting(): void {
  currentConfig = { ...DEFAULT_CONFIG };
  sentTimestamps = [];
}

export function shouldSample(sampleRate: number, randomFn: () => number = Math.random): boolean {
  if (sampleRate >= 1.0) return true;
  if (sampleRate <= 0.0) return false;
  return randomFn() < sampleRate;
}

export function checkRateCap(
  now: number = Date.now(),
  maxReports = currentConfig.maxReportsPerWindow,
  windowMs = currentConfig.windowMs,
): boolean {
  const windowStart = now - windowMs;
  sentTimestamps = sentTimestamps.filter((t) => t > windowStart);
  if (sentTimestamps.length >= maxReports) {
    return false;
  }
  sentTimestamps.push(now);
  return true;
}

export async function reportClientError(
  report: ClientErrorReport,
  overrideConfig?: Partial<ErrorReporterConfig>,
): Promise<boolean> {
  const config = overrideConfig ? { ...currentConfig, ...overrideConfig } : currentConfig;

  if (!shouldSample(config.sampleRate)) {
    return false;
  }

  if (!checkRateCap(Date.now(), config.maxReportsPerWindow, config.windowMs)) {
    return false;
  }

  const payload = JSON.stringify(report);

  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      const blob = new Blob([payload], { type: "application/json" });
      const queued = navigator.sendBeacon(config.endpoint, blob);
      if (queued) return true;
    }

    if (typeof fetch === "function") {
      await fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
      });
      return true;
    }
  } catch {
    // Suppress network reporting errors to avoid error loops
  }

  return false;
}
