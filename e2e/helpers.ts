import { test as baseTest, type Browser, type BrowserContext, expect, type Page } from "@playwright/test";
import { execSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";

export const chromiumLaunchArgs = [
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
  "--ignore-certificate-errors",
  "--enable-precise-memory-info",
  "--allow-loopback-in-peer-connection",
  "--disable-features=WebRtcHideLocalIpsWithMdns",
];

export const firefoxUserPrefs = {
  "media.navigator.permission.disabled": true,
  "media.navigator.streams.fake": true,
  "media.peerconnection.ice.loopback": true,
  "media.peerconnection.ice.obfuscate_host_addresses": false,
  "browser.cache.memory.enable": false,
  "browser.cache.disk.enable": false,
};

export interface PearioTestOptions {
  senderBrowserName: "chromium" | "firefox";
  receiverBrowserName: "chromium" | "firefox";
}

export interface PearioTestFixtures {
  senderBrowser: Browser;
  receiverBrowser: Browser;
  browser: Browser;
}

export const browserLaunchRssMap = new WeakMap<Browser, number>();

export const test = baseTest.extend<{ browser: Browser }, PearioTestOptions & Omit<PearioTestFixtures, "browser">>({
  senderBrowserName: ["chromium", { option: true, scope: "worker" }],
  receiverBrowserName: ["chromium", { option: true, scope: "worker" }],

  senderBrowser: [
    async ({ playwright, senderBrowserName }, use) => {
      const browser =
        senderBrowserName === "firefox"
          ? await playwright.firefox.launch({ firefoxUserPrefs })
          : await playwright.chromium.launch({ args: chromiumLaunchArgs });
      const launchRss = getProcessRssBytes(senderBrowserName);
      browserLaunchRssMap.set(browser, launchRss);
      await use(browser);
      await browser.close();
    },
    { scope: "worker" },
  ],

  receiverBrowser: [
    async ({ playwright, senderBrowserName, receiverBrowserName, senderBrowser }, use) => {
      if (senderBrowserName === receiverBrowserName) {
        await use(senderBrowser);
      } else {
        const browser =
          receiverBrowserName === "firefox"
            ? await playwright.firefox.launch({ firefoxUserPrefs })
            : await playwright.chromium.launch({ args: chromiumLaunchArgs });
        const launchRss = getProcessRssBytes(receiverBrowserName);
        browserLaunchRssMap.set(browser, launchRss);
        await use(browser);
        await browser.close();
      }
    },
    { scope: "worker" },
  ],

  browser: async ({ senderBrowser }, use) => {
    await use(senderBrowser);
  },
});

export { expect };

export interface PeerSession {
  context: BrowserContext;
  page: Page;
  name: string;
  browser: Browser;
  browserName: "chromium" | "firefox";
  launchRssBytes: number;
  setupRssBytes: number;
}

let peerIdCounter = 0;

/**
 * Initializes a browser context for a peer with:
 * - Mocked showOpenFilePicker that reads from a hidden input (#playwright-file-input)
 * - Display name submission
 * - Active ServiceWorker readiness check
 */
export async function setupPeer(browser: Browser, baseName: string): Promise<PeerSession> {
  const context = await browser.newContext({
    baseURL: "https://127.0.0.1:5137",
    acceptDownloads: true,
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 800 },
  });

  await context.addInitScript(() => {
    const ensureInput = () => {
      let input = document.getElementById("playwright-file-input") as HTMLInputElement | null;
      if (!input) {
        input = document.createElement("input");
        input.type = "file";
        input.id = "playwright-file-input";
        input.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;";
        (document.body || document.documentElement).appendChild(input);
      }
      return input;
    };

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", ensureInput);
    } else {
      ensureInput();
    }

    window.showOpenFilePicker = async function () {
      const input = ensureInput();
      if (!input.files || input.files.length === 0) {
        throw new DOMException("The user aborted a request.", "AbortError");
      }
      const file = input.files[0];
      return [
        {
          kind: "file" as const,
          name: file.name,
          getFile: async () => file,
        } as unknown as FileSystemFileHandle,
      ];
    };
  });

  const page = await context.newPage();
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning" || msg.text().includes("Pear:")) {
      console.log(`[${baseName} ${msg.type()}]`, msg.text());
    }
  });
  await page.goto("/");

  await page.evaluate(async () => {
    if (!navigator.serviceWorker) return;
    await navigator.serviceWorker.ready;
    if (!navigator.serviceWorker.controller) {
      await new Promise<void>((resolve) => {
        navigator.serviceWorker.addEventListener("controllerchange", () => resolve(), { once: true });
        setTimeout(resolve, 500);
      });
    }
  });

  const isControlled = await page.evaluate(() => !!navigator.serviceWorker?.controller);
  if (!isControlled) {
    await page.reload();
    await page.evaluate(async () => {
      if (!navigator.serviceWorker) return;
      await navigator.serviceWorker.ready;
    });
  }

  const name = `${baseName}-${Date.now().toString(36).slice(-4)}-${++peerIdCounter}`;
  const nameInput = page.getByRole("textbox", { name: "Display name" });
  await expect(nameInput).toBeVisible({ timeout: 15000 });
  await nameInput.fill(name);
  await page.getByRole("button", { name: "Start session" }).click();

  // Ensure peer is authenticated and connected to signaling server before proceeding
  await expect(page.getByText("Connected as")).toBeVisible({ timeout: 20000 });
  await expect(page.locator('[aria-label="Connecting"]')).toHaveCount(0, { timeout: 20000 });

  const browserType = (browser.browserType().name() as "chromium" | "firefox") || "chromium";
  const launchRssBytes = browserLaunchRssMap.get(browser) ?? getProcessRssBytes(browserType);
  const setupRssBytes = getProcessRssBytes(browserType);

  return { context, page, name, browser, browserName: browserType, launchRssBytes, setupRssBytes };
}

/**
 * Connects two peers via WebRTC using the UI (Peers -> Connect button — no accept step needed)
 */
export async function connectPeers(peerA: PeerSession, peerB: PeerSession): Promise<void> {
  await expect(peerA.page.getByText("Connected as")).toBeVisible({ timeout: 20000 });
  await expect(peerB.page.getByText("Connected as")).toBeVisible({ timeout: 20000 });

  const peerRow = peerB.page.locator("li", { hasText: peerA.name });
  await expect(peerRow).toBeVisible({ timeout: 20000 });

  const connectBtn = peerRow.getByRole("button", { name: /Connect/ });
  await expect(connectBtn).toBeVisible({ timeout: 10000 });
  await connectBtn.click();

  const sendBtnA = peerA.page.getByRole("button", { name: "Send File", exact: true });
  const sendBtnB = peerB.page.getByRole("button", { name: "Send File", exact: true });

  try {
    await expect(sendBtnA).toBeEnabled({ timeout: 10000 });
    await expect(sendBtnB).toBeEnabled({ timeout: 10000 });
  } catch {
    if (await connectBtn.isVisible()) {
      await connectBtn.click();
    }
    await expect(sendBtnA).toBeEnabled({ timeout: 25000 });
    await expect(sendBtnB).toBeEnabled({ timeout: 25000 });
  }
}

/**
 * Creates a test file of specified size by streaming chunks directly to disk (preventing memory spikes in Node.js)
 */
export async function createTestFile(filePath: string, sizeBytes: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const writeStream = fs.createWriteStream(filePath);
    const hash = crypto.createHash("sha256");
    const chunkSize = 64 * 1024;
    const chunk = Buffer.alloc(chunkSize, 0x42); // 'B'
    let bytesWritten = 0;

    function write() {
      let ok = true;
      while (bytesWritten < sizeBytes && ok) {
        const remaining = sizeBytes - bytesWritten;
        const currentChunk = remaining < chunkSize ? chunk.subarray(0, remaining) : chunk;
        bytesWritten += currentChunk.length;
        hash.update(currentChunk);
        ok = writeStream.write(currentChunk);
      }
      if (bytesWritten >= sizeBytes) {
        writeStream.end(() => resolve(hash.digest("hex")));
      } else {
        writeStream.once("drain", write);
      }
    }

    writeStream.on("error", reject);
    write();
  });
}

/**
 * Computes SHA-256 of a file using Node streams to avoid buffering the file into memory
 */
export async function computeFileSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath, { highWaterMark: 1024 * 1024 });
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export interface DetailedMemoryMeasurement {
  bytes: number;
  api: "measureUserAgentSpecificMemory" | "performance.memory" | "unavailable";
  crossOriginIsolated: boolean;
  breakdown?: {
    bytes: number;
    types: string[];
    attribution: string[];
  }[];
}

/**
 * Attempts to measure memory usage on the page.
 * Evaluates performance.measureUserAgentSpecificMemory() first (standard API, requires crossOriginIsolated in Chromium),
 * then falls back to non-standard performance.memory.usedJSHeapSize (Chromium),
 * or identifies that the browser (e.g. Firefox) does not expose in-page memory measurement APIs.
 */
export async function measureDetailedMemory(page: Page): Promise<DetailedMemoryMeasurement> {
  return page.evaluate(async () => {
    const perf = window.performance as unknown as {
      measureUserAgentSpecificMemory?: () => Promise<{
        bytes: number;
        breakdown?: { bytes: number; types: string[]; attribution: string[] }[];
      }>;
      memory?: { usedJSHeapSize?: number };
    };

    const crossOriginIsolated = typeof window.crossOriginIsolated === "boolean" ? window.crossOriginIsolated : false;

    // 1. Check for standard cross-origin isolated memory measurement API
    if (typeof perf.measureUserAgentSpecificMemory === "function") {
      try {
        const result = await perf.measureUserAgentSpecificMemory();
        if (result && typeof result.bytes === "number") {
          return {
            bytes: result.bytes,
            api: "measureUserAgentSpecificMemory" as const,
            crossOriginIsolated,
            breakdown: result.breakdown,
          };
        }
      } catch (err) {
        console.warn("performance.measureUserAgentSpecificMemory failed:", err);
      }
    }

    // 2. Fall back to non-standard Chromium performance.memory
    if (perf.memory && typeof perf.memory.usedJSHeapSize === "number") {
      return {
        bytes: perf.memory.usedJSHeapSize,
        api: "performance.memory" as const,
        crossOriginIsolated,
      };
    }

    // 3. Neither API is supported in this engine (e.g. Firefox)
    return {
      bytes: 0,
      api: "unavailable" as const,
      crossOriginIsolated,
    };
  });
}

/**
 * Measures current memory usage on the page in bytes using performance.measureUserAgentSpecificMemory()
 * with fallback to performance.memory.
 */
export async function measureMemory(page: Page): Promise<number> {
  const result = await measureDetailedMemory(page);
  return result.bytes;
}

export function getProcessRssBytes(browserName: string): number {
  try {
    const out = execSync("ps -eo pid,ppid,rss,comm").toString().trim().split("\n");
    const pmap = new Map<number, { ppid: number; rss: number; comm: string }>();
    for (let i = 1; i < out.length; i++) {
      const parts = out[i].trim().split(/\s+/);
      const pid = Number.parseInt(parts[0], 10);
      const ppid = Number.parseInt(parts[1], 10);
      const rss = Number.parseInt(parts[2], 10);
      const comm = parts[3] || "";
      pmap.set(pid, { ppid, rss, comm });
    }

    // Find all descendants of the current process (Playwright test worker)
    const descendants = new Set<number>();
    function addDescendants(p: number) {
      for (const [pid, info] of pmap.entries()) {
        if (info.ppid === p && !descendants.has(pid)) {
          descendants.add(pid);
          addDescendants(pid);
        }
      }
    }
    addDescendants(process.pid);

    const filter = browserName === "firefox" ? "firefox" : "chrome";
    let totalRssKb = 0;
    for (const pid of descendants) {
      const info = pmap.get(pid);
      if (info?.comm.toLowerCase().includes(filter)) {
        totalRssKb += info.rss;
      }
    }

    // Fallback if processes were spawned outside direct process hierarchy
    if (totalRssKb === 0) {
      for (const info of pmap.values()) {
        if (info.comm.toLowerCase().includes(filter)) {
          totalRssKb += info.rss;
        }
      }
    }

    return totalRssKb * 1024;
  } catch {
    return 0;
  }
}

export interface MemoryDeltaReport {
  browserName: "chromium" | "firefox";
  launchRssBytes: number;
  setupRssBytes: number;
  endRssBytes: number;
  deltaFromSetupBytes: number;
  deltaFromLaunchBytes: number;
  jsHeapBytes: number;
}

/**
 * Measures the browser process memory delta from post-setup to the current point,
 * along with in-page memory measurements.
 */
export async function measurePeerMemoryDelta(peer: PeerSession): Promise<MemoryDeltaReport> {
  const endRssBytes = getProcessRssBytes(peer.browserName);
  const jsHeapBytes = await measureMemory(peer.page);
  const deltaFromSetupBytes = Math.max(0, endRssBytes - peer.setupRssBytes);
  const deltaFromLaunchBytes = Math.max(0, endRssBytes - peer.launchRssBytes);

  return {
    browserName: peer.browserName,
    launchRssBytes: peer.launchRssBytes,
    setupRssBytes: peer.setupRssBytes,
    endRssBytes,
    deltaFromSetupBytes,
    deltaFromLaunchBytes,
    jsHeapBytes,
  };
}

/**
 * Snapshots the memory baseline immediately before the file transfer starts,
 * ensuring all peers are connected and in steady-state.
 */
export function recordPreTransferBaseline(peer: PeerSession): void {
  peer.setupRssBytes = getProcessRssBytes(peer.browserName);
}

export interface PeerMemoryMetrics {
  peak: number;
  average: number;
  samplesCount: number;
  type: "UserAgentSpecificMemory" | "JS Heap" | "Process RSS";
  baseline?: number;
  peakGrowth?: number;
}

export interface DualMemoryStats {
  sender: PeerMemoryMetrics;
  receiver: PeerMemoryMetrics;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 MB";
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function startReceiverMemoryTracker(receiverPage: Page, sampleIntervalMs = 250) {
  const samples: number[] = [];
  const receiverBrowser = receiverPage.context().browser()?.browserType().name() ?? "unknown";
  const baselineRss = receiverBrowser === "firefox" ? getProcessRssBytes(receiverBrowser) : 0;
  let memoryType: "UserAgentSpecificMemory" | "JS Heap" | "Process RSS" = "JS Heap";

  let active = true;

  const trackingPromise = (async () => {
    while (active) {
      try {
        if (!receiverPage.isClosed()) {
          const detailed = await measureDetailedMemory(receiverPage);
          if (detailed.bytes > 0) {
            samples.push(detailed.bytes);
            memoryType = detailed.api === "measureUserAgentSpecificMemory" ? "UserAgentSpecificMemory" : "JS Heap";
          } else {
            const rss = getProcessRssBytes(receiverBrowser);
            if (rss > 0) {
              samples.push(rss);
              memoryType = "Process RSS";
            }
          }
        }
      } catch {
        // Page may be busy or closed
      }

      await new Promise((resolve) => setTimeout(resolve, sampleIntervalMs));
    }
  })();

  const computeMetrics = (
    sampleList: number[],
    type: "UserAgentSpecificMemory" | "JS Heap" | "Process RSS",
  ): PeerMemoryMetrics => {
    if (sampleList.length === 0) {
      return { peak: 0, average: 0, samplesCount: 0, type, baseline: baselineRss, peakGrowth: 0 };
    }
    const peak = Math.max(...sampleList);
    const average = Math.round(sampleList.reduce((a, b) => a + b, 0) / sampleList.length);
    const peakGrowth = type === "Process RSS" ? Math.max(0, peak - baselineRss) : undefined;
    return { peak, average, samplesCount: sampleList.length, type, baseline: baselineRss, peakGrowth };
  };

  return {
    async stop(): Promise<PeerMemoryMetrics> {
      active = false;
      await trackingPromise;
      return computeMetrics(samples, memoryType);
    },
  };
}

export const startMemoryTracker = startReceiverMemoryTracker;
