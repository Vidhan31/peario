import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { computeFileSha256, connectPeers, createTestFile, expect, setupPeer, test } from "./helpers";

test.describe("Sequential transfers in one session", () => {
  const FILE_SIZE = 32 * 1024 * 1024;

  test("Alice sends two files back-to-back, both complete", async ({ senderBrowser, receiverBrowser }) => {
    const bob = await setupPeer(receiverBrowser, "Bob");
    const alice = await setupPeer(senderBrowser, "Alice");

    // Same filename twice: exercises the service-worker download URL reuse path.
    const sharedName = `seq-shared-${Date.now()}.bin`;
    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), "seq-a-"));
    const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), "seq-b-"));
    const testFile1 = path.join(dir1, sharedName);
    const testFile2 = path.join(dir2, sharedName);
    const received1 = path.join(os.tmpdir(), `seq1-recv-${Date.now()}.bin`);
    const received2 = path.join(os.tmpdir(), `seq2-recv-${Date.now()}.bin`);

    try {
      await connectPeers(alice, bob);
      const sha1 = await createTestFile(testFile1, FILE_SIZE);
      const sha2 = await createTestFile(testFile2, FILE_SIZE);

      await alice.page.locator("#playwright-file-input").setInputFiles(testFile1);
      await alice.page.getByRole("button", { name: "Send File", exact: true }).click();

      let downloadPromise = bob.page.waitForEvent("download", { timeout: 60000 });
      await expect(bob.page.getByRole("button", { name: "Download File" })).toBeVisible({ timeout: 30000 });
      await bob.page.getByRole("button", { name: "Download File" }).click();
      let download = await downloadPromise;
      await download.saveAs(received1);

      await expect(alice.page.getByText("Transfer complete").first()).toBeVisible({ timeout: 45000 });
      await expect(bob.page.getByText("Transfer complete").first()).toBeVisible({ timeout: 45000 });
      expect(await computeFileSha256(received1)).toBe(sha1);

      await alice.page.locator("#playwright-file-input").setInputFiles(testFile2);
      await alice.page.getByRole("button", { name: "Send File", exact: true }).click();

      downloadPromise = bob.page.waitForEvent("download", { timeout: 60000 });
      await expect(bob.page.getByRole("button", { name: "Download File" })).toBeVisible({ timeout: 30000 });
      await bob.page.getByRole("button", { name: "Download File" }).click();
      download = await downloadPromise;
      await download.saveAs(received2);

      await expect(alice.page.getByText("Transfer complete").nth(1)).toBeVisible({ timeout: 45000 });
      await expect(bob.page.getByText("Transfer complete").nth(1)).toBeVisible({ timeout: 45000 });
      expect(await computeFileSha256(received2)).toBe(sha2);
    } finally {
      for (const f of [testFile1, testFile2, received1, received2]) {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
      for (const d of [dir1, dir2]) {
        try {
          fs.rmdirSync(d);
        } catch {
          // Ignore cleanup errors.
        }
      }
      await alice.context.close();
      await bob.context.close();
    }
  });
});
