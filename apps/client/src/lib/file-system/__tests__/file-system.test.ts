import { describe, expect, it, vi } from "vitest";

import { ABORT, CLOSE, ERROR, PULL, WRITE } from "@/lib/file-system/protocol";
import { buildDownloadHeaders, encodeDownloadFileName, showSaveFilePicker } from "@/lib/file-system/saveFilePicker";

describe("file-system protocol", () => {
  it("keeps wire constants in sync with public/sw.js", () => {
    expect(WRITE).toBe(0);
    expect(PULL).toBe(0);
    expect(ERROR).toBe(1);
    expect(ABORT).toBe(1);
    expect(CLOSE).toBe(2);
  });
});

describe("download filename encoding", () => {
  it("encodes RFC5987 unsafe characters", () => {
    expect(encodeDownloadFileName("my file (1).png")).toBe("my%20file%20%281%29.png");
    expect(encodeDownloadFileName("a*b")).toBe("a%2Ab");
  });

  it("sets content-length only for positive finite sizes", () => {
    const withSize = buildDownloadHeaders("f.bin", 123);
    expect(withSize["content-length"]).toBe("123");
    expect(buildDownloadHeaders("f.bin")["content-length"]).toBeUndefined();
    expect(buildDownloadHeaders("f.bin", 0)["content-length"]).toBeUndefined();
  });

  it("always sets X-Content-Type-Options: nosniff", () => {
    expect(buildDownloadHeaders("f.bin")["x-content-type-options"]).toBe("nosniff");
    expect(buildDownloadHeaders("f.bin", 123)["x-content-type-options"]).toBe("nosniff");
  });
});

describe("save handle", () => {
  it("defaults the name and rejects getFile", async () => {
    const handle = await showSaveFilePicker({});
    expect(handle.name).toBe("download");
    await expect(handle.getFile()).rejects.toMatchObject({ name: "NotFoundError" });
  });

  it("uses suggestedName when provided", async () => {
    const handle = await showSaveFilePicker({ suggestedName: "photo.png" });
    expect(handle.name).toBe("photo.png");
  });
});

describe("open picker native delegation", () => {
  it("delegates to window.showOpenFilePicker when present (e2e stub path)", async () => {
    const file = new File(["hi"], "hi.txt");
    const stub = vi.fn(async () => [{ kind: "file", name: file.name, getFile: async () => file }]);
    vi.stubGlobal("showOpenFilePicker", stub);
    try {
      const { showOpenFilePicker } = await import("@/lib/file-system/openFilePicker");
      const handles = await showOpenFilePicker({ multiple: false });
      expect(stub).toHaveBeenCalledOnce();
      expect(handles).toHaveLength(1);
      await expect(handles[0]?.getFile()).resolves.toBe(file);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
