import { describe, expect, it } from "vitest";

import { formatBytes, formatProgressBytes, getFileBadge, getFileExtension, getFileIcon, Pausable } from "../FileUtils";

describe("FileUtils & Transfer Flow Primitives", () => {
  describe("Pausable Flow Controller", () => {
    it("starts unpaused and resolves waitTillResumed immediately", async () => {
      const gate = new Pausable();
      expect(gate.isPaused()).toBe(false);

      let resolved = false;
      await gate.waitTillResumed().then(() => {
        resolved = true;
      });
      expect(resolved).toBe(true);
    });

    it("freezes execution when paused and unblocks on resume", async () => {
      const gate = new Pausable();
      gate.pause();
      expect(gate.isPaused()).toBe(true);

      let resumed = false;
      const waitPromise = gate.waitTillResumed().then(() => {
        resumed = true;
      });

      // Still paused after tick
      await new Promise((r) => setTimeout(r, 10));
      expect(resumed).toBe(false);

      gate.resume();
      expect(gate.isPaused()).toBe(false);

      await waitPromise;
      expect(resumed).toBe(true);
    });

    it("is idempotent when calling pause() repeatedly", async () => {
      const gate = new Pausable();
      gate.pause();
      const firstPromise = gate.waitTillResumed();
      gate.pause();
      const secondPromise = gate.waitTillResumed();

      // The same underlying wait promise should be returned
      expect(firstPromise).toBe(secondPromise);

      gate.resume();
      await firstPromise;
      expect(gate.isPaused()).toBe(false);
    });

    it("is safe and no-op when calling resume() while not paused", () => {
      const gate = new Pausable();
      expect(() => gate.resume()).not.toThrow();
      expect(gate.isPaused()).toBe(false);
    });

    it("allows multiple independent pause and resume cycles", async () => {
      const gate = new Pausable();

      gate.pause();
      let step1 = false;
      const p1 = gate.waitTillResumed().then(() => {
        step1 = true;
      });
      gate.resume();
      await p1;
      expect(step1).toBe(true);

      gate.pause();
      let step2 = false;
      const p2 = gate.waitTillResumed().then(() => {
        step2 = true;
      });
      gate.resume();
      await p2;
      expect(step2).toBe(true);
    });
  });

  describe("formatBytes", () => {
    it("formats standard byte sizes accurately", () => {
      expect(formatBytes(0)).toBe("0 B");
      expect(formatBytes(1024)).toBe("1 KB");
      expect(formatBytes(1024 * 1024 * 1.5)).toBe("1.5 MB");
      expect(formatBytes(1024 * 1024 * 1024 * 2)).toBe("2 GB");
      expect(formatBytes(1024 ** 4 * 3)).toBe("3 TB");
    });

    it("handles boundary, non-finite, and negative values safely", () => {
      expect(formatBytes(-500)).toBe("0 B");
      expect(formatBytes(Number.NaN)).toBe("0 B");
      expect(formatBytes(Number.POSITIVE_INFINITY)).toBe("0 B");
      expect(formatBytes(1023)).toBe("1023 B");
    });

    it("respects precision and trimZeros options", () => {
      expect(formatBytes(1024 * 1024 * 1.5, 2, false)).toBe("1.50 MB");
      expect(formatBytes(1024 * 1024 * 2, 2, false)).toBe("2.00 MB");
      expect(formatBytes(1024 * 1024 * 1.5, 2, true)).toBe("1.5 MB");
    });
  });

  describe("formatProgressBytes", () => {
    const gb = 1024 ** 3;

    it("formats progress in the total's unit with fixed decimals to prevent UI jumping", () => {
      const full = formatProgressBytes(gb * 1.35, gb * 1.35);
      expect(full.transferred).toBe("1.35 GB");
      expect(full.total).toBe("1.35 GB");

      const partial = formatProgressBytes(250 * 1024 ** 2, gb * 1.35);
      expect(partial.total).toBe("1.35 GB");
      expect(partial.transferred).toBe("0.24 GB");
    });

    it("clamps transferred bytes between 0 and total", () => {
      const overflow = formatProgressBytes(gb * 2, gb);
      expect(overflow.transferred).toBe("1.00 GB");
      expect(overflow.total).toBe("1.00 GB");

      const negative = formatProgressBytes(-500, gb);
      expect(negative.transferred).toBe("0.00 GB");
    });

    it("handles 0 or invalid total bytes gracefully", () => {
      const zeroTotal = formatProgressBytes(500, 0);
      expect(zeroTotal.total).toBe("0 B");

      const nanTotal = formatProgressBytes(500, Number.NaN);
      expect(nanTotal.total).toBe("0 B");
    });
  });

  describe("getFileExtension & getFileBadge", () => {
    it("extracts extension in lowercase", () => {
      expect(getFileExtension("archive.ZIP")).toBe("zip");
      expect(getFileExtension("test.tar.gz")).toBe("gz");
      expect(getFileExtension("README")).toBe("");
      expect(getFileExtension(".env")).toBe("env");
    });

    it("generates uppercase badges up to 4 characters", () => {
      expect(getFileBadge("project.zip")).toBe("ZIP");
      expect(getFileBadge("report.pdf")).toBe("PDF");
      expect(getFileBadge("data.tar")).toBe("TAR");
      expect(getFileBadge("photo.jpeg")).toBe("JPEG");
      expect(getFileBadge("script.typescript")).toBe("TYPE");
      expect(getFileBadge("unknown_file")).toBe("FILE");
    });
  });

  describe("getFileIcon", () => {
    it("returns correct react-icons for various file extensions", () => {
      const imgIcon = getFileIcon("picture.png");
      expect(imgIcon).toBeDefined();

      const vidIcon = getFileIcon("movie.mkv");
      expect(vidIcon).toBeDefined();

      const audioIcon = getFileIcon("song.flac");
      expect(audioIcon).toBeDefined();

      const pdfIcon = getFileIcon("doc.pdf");
      expect(pdfIcon).toBeDefined();

      const codeIcon = getFileIcon("app.tsx");
      expect(codeIcon).toBeDefined();

      const defaultIcon = getFileIcon("mystery_binary");
      expect(defaultIcon).toBeDefined();
    });
  });
});
