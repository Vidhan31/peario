import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { computeFileSha256, connectPeers, createTestFile, expect, setupPeer, test } from "./helpers";

test.describe("Sender transfer controls (pause / resume / cancel)", () => {
  const FILE_SIZE_20MB = 20 * 1024 * 1024;

  test("Alice pauses mid-transfer, progress freezes, resume completes byte-identical", async ({
    senderBrowser,
    receiverBrowser,
  }) => {
    const bob = await setupPeer(receiverBrowser, "Bob");
    const alice = await setupPeer(senderBrowser, "Alice");

    const testFilePath = path.join(os.tmpdir(), `test-controls-pause-${Date.now()}.bin`);
    const receivedFilePath = path.join(os.tmpdir(), `received-controls-pause-${Date.now()}.bin`);

    try {
      await connectPeers(alice, bob);

      const originalSha256 = await createTestFile(testFilePath, FILE_SIZE_20MB);

      await alice.page.locator("#playwright-file-input").setInputFiles(testFilePath);
      await alice.page.getByRole("button", { name: "Send File", exact: true }).click();

      // Pause mid-stream
      const pauseButton = alice.page.getByRole("button", { name: /Pause sending/ });
      await expect(pauseButton).toBeVisible({ timeout: 20000 });
      await pauseButton.click();

      const frozenBadge = alice.page.getByText("Paused — progress frozen", { exact: true });
      await expect(frozenBadge).toBeVisible({ timeout: 10000 });

      // Resume button should now be available
      const resumeButton = alice.page.getByRole("button", { name: /Resume sending/ });
      await expect(resumeButton).toBeVisible({ timeout: 10000 });

      // Start receiver download
      const downloadPromise = bob.page.waitForEvent("download", { timeout: 90000 });
      await bob.page.getByRole("button", { name: "Download File" }).click();

      // Resume sending
      await resumeButton.click();
      await expect(frozenBadge).toHaveCount(0, { timeout: 10000 });

      const download = await downloadPromise;
      await download.saveAs(receivedFilePath);

      await expect(alice.page.getByText("Transfer complete").first()).toBeVisible({ timeout: 60000 });
      await expect(bob.page.getByText("Transfer complete").first()).toBeVisible({ timeout: 60000 });

      const receivedSha256 = await computeFileSha256(receivedFilePath);
      expect(receivedSha256).toBe(originalSha256);
    } finally {
      if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
      if (fs.existsSync(receivedFilePath)) fs.unlinkSync(receivedFilePath);
      await alice.context.close();
      await bob.context.close();
    }
  });

  test("Alice cancels mid-transfer, card is removed and Bob sees cancellation", async ({
    senderBrowser,
    receiverBrowser,
  }) => {
    const bob = await setupPeer(receiverBrowser, "Bob");
    const alice = await setupPeer(senderBrowser, "Alice");

    const testFilePath = path.join(os.tmpdir(), `test-controls-cancel-${Date.now()}.bin`);

    try {
      await connectPeers(alice, bob);

      await createTestFile(testFilePath, FILE_SIZE_20MB);

      await alice.page.locator("#playwright-file-input").setInputFiles(testFilePath);
      await alice.page.getByRole("button", { name: "Send File", exact: true }).click();

      const cancelButton = alice.page.getByRole("button", { name: /Cancel sending/ });
      await expect(cancelButton).toBeVisible({ timeout: 20000 });

      // Bob accepts so both sides are active, then Alice cancels
      await bob.page.getByRole("button", { name: "Download File" }).click();
      await cancelButton.click();

      // Sender card is reset: cancellation feedback shows
      await expect(alice.page.getByText("Transfer cancelled").first()).toBeVisible({ timeout: 15000 });
      await expect(cancelButton).toHaveCount(0, { timeout: 10000 });

      // Receiver receives cancellation notice instead of hanging
      await expect(bob.page.getByText(/Sender cancelled transfer/).first()).toBeVisible({ timeout: 15000 });

      // Sender is ready to send again
      await expect(alice.page.getByRole("button", { name: "Send File", exact: true })).toBeEnabled({
        timeout: 15000,
      });
    } finally {
      if (fs.existsSync(testFilePath)) fs.unlinkSync(testFilePath);
      await alice.context.close();
      await bob.context.close();
    }
  });
});
