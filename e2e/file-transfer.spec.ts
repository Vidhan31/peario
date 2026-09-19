import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { computeFileSha256, connectPeers, createTestFile, expect, setupPeer, test } from "./helpers";

test.describe("File Transfers & Streaming Invariants", () => {
  const FILE_SIZE_5MB = 5 * 1024 * 1024;

  test("Alice streams 5MB file to Bob with byte-identical sha256 verification", async ({
    senderBrowser,
    receiverBrowser,
  }) => {
    const bob = await setupPeer(receiverBrowser, "Bob");
    const alice = await setupPeer(senderBrowser, "Alice");

    const testFilePath = path.join(os.tmpdir(), `test-5mb-${Date.now()}.bin`);
    const receivedFilePath = path.join(os.tmpdir(), `received-5mb-${Date.now()}.bin`);

    try {
      await connectPeers(alice, bob);

      const originalSha256 = await createTestFile(testFilePath, FILE_SIZE_5MB);

      await alice.page.locator("#playwright-file-input").setInputFiles(testFilePath);
      await alice.page.getByRole("button", { name: "Send File", exact: true }).click();

      const downloadPromise = bob.page.waitForEvent("download", { timeout: 60000 });
      const downloadButton = bob.page.getByRole("button", { name: "Download File" });
      await expect(downloadButton).toBeVisible({ timeout: 30000 });
      await downloadButton.click();

      const download = await downloadPromise;
      await download.saveAs(receivedFilePath);

      await expect(alice.page.getByText("Transfer complete").first()).toBeVisible({ timeout: 45000 });
      await expect(bob.page.getByText("Transfer complete").first()).toBeVisible({ timeout: 45000 });

      expect(fs.existsSync(receivedFilePath)).toBe(true);
      const stat = fs.statSync(receivedFilePath);
      expect(stat.size).toBe(FILE_SIZE_5MB);

      const receivedSha256 = await computeFileSha256(receivedFilePath);
      expect(receivedSha256).toBe(originalSha256);
    } finally {
      if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
      if (fs.existsSync(receivedFilePath)) fs.unlinkSync(receivedFilePath);
      await alice.context.close();
      await bob.context.close();
    }
  });

  test("Edge case: 0-byte file streams and completes cleanly without stalling", async ({
    senderBrowser,
    receiverBrowser,
  }) => {
    const bob = await setupPeer(receiverBrowser, "Bob");
    const alice = await setupPeer(senderBrowser, "Alice");

    const testFilePath = path.join(os.tmpdir(), `test-0byte-${Date.now()}.txt`);
    const receivedFilePath = path.join(os.tmpdir(), `received-0byte-${Date.now()}.txt`);

    try {
      await connectPeers(alice, bob);

      fs.writeFileSync(testFilePath, "");
      const originalSha256 = await computeFileSha256(testFilePath);

      await alice.page.locator("#playwright-file-input").setInputFiles(testFilePath);
      await alice.page.getByRole("button", { name: "Send File", exact: true }).click();

      const downloadPromise = bob.page.waitForEvent("download", { timeout: 30000 });
      const downloadButton = bob.page.getByRole("button", { name: "Download File" });
      await expect(downloadButton).toBeVisible({ timeout: 20000 });
      await downloadButton.click();

      const download = await downloadPromise;
      await download.saveAs(receivedFilePath);

      await expect(alice.page.getByText("Transfer complete").first()).toBeVisible({ timeout: 30000 });
      await expect(bob.page.getByText("Transfer complete").first()).toBeVisible({ timeout: 30000 });

      expect(fs.existsSync(receivedFilePath)).toBe(true);
      const stat = fs.statSync(receivedFilePath);
      expect(stat.size).toBe(0);

      const receivedSha256 = await computeFileSha256(receivedFilePath);
      expect(receivedSha256).toBe(originalSha256);
    } finally {
      if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
      if (fs.existsSync(receivedFilePath)) fs.unlinkSync(receivedFilePath);
      await alice.context.close();
      await bob.context.close();
    }
  });

  test("Stress: same 5MB file five times back-to-back", async ({ senderBrowser, receiverBrowser }) => {
    test.setTimeout(300_000);

    const bob = await setupPeer(receiverBrowser, "Bob");
    const alice = await setupPeer(senderBrowser, "Alice");

    const testFilePath = path.join(os.tmpdir(), `test-stress-5mb-${Date.now()}.bin`);
    const receivedPaths: string[] = [];

    try {
      await connectPeers(alice, bob);

      const originalSha256 = await createTestFile(testFilePath, FILE_SIZE_5MB);

      for (let i = 0; i < 5; i++) {
        const receivedFilePath = path.join(os.tmpdir(), `received-stress-5mb-${i}-${Date.now()}.bin`);
        receivedPaths.push(receivedFilePath);

        await alice.page.locator("#playwright-file-input").setInputFiles(testFilePath);
        await alice.page.getByRole("button", { name: "Send File", exact: true }).click();

        const downloadPromise = bob.page.waitForEvent("download", { timeout: 60000 });
        const downloadButton = bob.page.getByRole("button", { name: "Download File" });
        await expect(downloadButton).toBeVisible({ timeout: 30000 });
        await downloadButton.click();

        const download = await downloadPromise;
        await download.saveAs(receivedFilePath);

        await expect(alice.page.getByText("Transfer complete").nth(i)).toBeVisible({ timeout: 45000 });
        await expect(bob.page.getByText("Transfer complete").nth(i)).toBeVisible({ timeout: 45000 });

        expect(fs.existsSync(receivedFilePath)).toBe(true);
        expect(fs.statSync(receivedFilePath).size).toBe(FILE_SIZE_5MB);
        expect(await computeFileSha256(receivedFilePath)).toBe(originalSha256);
      }
    } finally {
      if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
      for (const receivedFilePath of receivedPaths) {
        if (fs.existsSync(receivedFilePath)) fs.unlinkSync(receivedFilePath);
      }
      await alice.context.close();
      await bob.context.close();
    }
  });
});
