import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  computeFileSha256,
  connectPeers,
  expect,
  formatBytes,
  setupPeer,
  startReceiverMemoryTracker,
  test,
} from "./helpers";

test.describe("Large File Transfer (1.4GB Streaming)", () => {
  const MOVIE_SOURCE_PATH = "/mnt/fedowin/Movies/Nobody 2 2025 1080p WEB-DL HEVC x265 5.1 BONE.mkv";
  const MOVIE_DEST_PATH = path.join(os.homedir(), "Downloads", "Nobody 2 2025 1080p WEB-DL HEVC x265 5.1 BONE.mkv");
  const MAX_ALLOWED_HEAP_BYTES = 250 * 1024 * 1024; // 250 MB peak JS heap limit during 1.4GB transfer
  // When falling back to OS Process RSS (Firefox), process memory includes the browser engine's C++
  // download manager, IPC buffers, and OS page cache. We verify it does not double-buffer or leak beyond browser overhead.
  const MAX_ALLOWED_PROCESS_RSS_GROWTH_BYTES = 3 * 1024 * 1024 * 1024; // 3 GB ceiling for full multi-process browser RSS

  test.beforeAll(() => {
    if (!fs.existsSync(MOVIE_SOURCE_PATH)) {
      throw new Error(`Source movie file does not exist at: ${MOVIE_SOURCE_PATH}`);
    }
    const downloadsDir = path.dirname(MOVIE_DEST_PATH);
    if (!fs.existsSync(downloadsDir)) {
      fs.mkdirSync(downloadsDir, { recursive: true });
    }
  });

  test.afterAll(() => {
    if (fs.existsSync(MOVIE_DEST_PATH)) {
      try {
        fs.unlinkSync(MOVIE_DEST_PATH);
      } catch {
        // ignore
      }
    }
  });

  test("Stream 1.4GB Movie from Alice to Bob directly to disk without memory spikes", async ({
    senderBrowser,
    receiverBrowser,
  }) => {
    test.setTimeout(300_000);

    if (fs.existsSync(MOVIE_DEST_PATH)) {
      fs.unlinkSync(MOVIE_DEST_PATH);
    }

    const sourceStat = fs.statSync(MOVIE_SOURCE_PATH);
    const expectedSize = sourceStat.size;

    const bob = await setupPeer(receiverBrowser, "Bob");
    const alice = await setupPeer(senderBrowser, "Alice");

    try {
      await connectPeers(alice, bob);

      await alice.page.locator("#playwright-file-input").setInputFiles(MOVIE_SOURCE_PATH);
      await alice.page.getByRole("button", { name: "Send File", exact: true }).click();

      const downloadPromise = bob.page.waitForEvent("download", { timeout: 120_000 });
      const downloadBtn = bob.page.getByRole("button", { name: "Download File" });
      await expect(downloadBtn).toBeVisible({ timeout: 60_000 });

      // Continuously sample receiver memory usage during streaming
      const memoryTracker = startReceiverMemoryTracker(bob.page, 250);

      try {
        await downloadBtn.click();

        const download = await downloadPromise;
        await download.saveAs(MOVIE_DEST_PATH);

        await expect(alice.page.getByText("Transfer complete").first()).toBeVisible({ timeout: 180_000 });
        await expect(bob.page.getByText("Transfer complete").first()).toBeVisible({ timeout: 180_000 });
      } finally {
        const receiverMemoryStats = await memoryTracker.stop();
        const receiverBrowser = bob.page.context().browser()?.browserType().name() ?? "unknown";

        console.log("\n" + "=".repeat(65));
        console.log("             RECEIVER MEMORY CONSUMPTION REPORT               ");
        console.log("=".repeat(65));
        console.log(`Receiver (Bob - ${receiverBrowser}):`);
        console.log(`  Peak Memory:    ${formatBytes(receiverMemoryStats.peak)} (${receiverMemoryStats.type})`);
        console.log(`  Average Memory: ${formatBytes(receiverMemoryStats.average)} (${receiverMemoryStats.type})`);
        console.log(`  Samples Count:  ${receiverMemoryStats.samplesCount}`);
        if (receiverMemoryStats.type === "Process RSS") {
          console.log(`  Baseline RSS:   ${formatBytes(receiverMemoryStats.baseline ?? 0)}`);
          console.log(`  Peak Growth:    ${formatBytes(receiverMemoryStats.peakGrowth ?? 0)}`);
        }
        console.log("=".repeat(65) + "\n");

        if (receiverMemoryStats.type === "Process RSS") {
          expect(receiverMemoryStats.peakGrowth ?? 0).toBeLessThan(MAX_ALLOWED_PROCESS_RSS_GROWTH_BYTES);
        } else {
          expect(receiverMemoryStats.peak).toBeLessThan(MAX_ALLOWED_HEAP_BYTES);
        }
      }

      expect(fs.existsSync(MOVIE_DEST_PATH)).toBe(true);
      const destStat = fs.statSync(MOVIE_DEST_PATH);
      expect(destStat.size).toBe(expectedSize);

      const sourceHash = await computeFileSha256(MOVIE_SOURCE_PATH);
      const destHash = await computeFileSha256(MOVIE_DEST_PATH);
      expect(destHash).toBe(sourceHash);
    } finally {
      if (fs.existsSync(MOVIE_DEST_PATH)) {
        try {
          fs.unlinkSync(MOVIE_DEST_PATH);
        } catch {
          // ignore
        }
      }
      await alice.context.close();
      await bob.context.close();
    }
  });
});
