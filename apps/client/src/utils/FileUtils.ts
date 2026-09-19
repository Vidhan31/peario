import type { IconType } from "react-icons";

import {
  FaFile,
  FaFileAudio,
  FaFileCode,
  FaFileExcel,
  FaFileImage,
  FaFilePdf,
  FaFilePowerpoint,
  FaFileVideo,
  FaFileWord,
  FaFileZipper,
} from "react-icons/fa6";

export function getFileExtension(filename: string): string {
  const lastDotIndex = filename.lastIndexOf(".");
  return lastDotIndex === -1 ? "" : filename.slice(lastDotIndex + 1).toLowerCase();
}

export function getFileBadge(filename: string): string {
  const ext = getFileExtension(filename);
  if (!ext) return "FILE";
  if (ext.length <= 4) return ext.toUpperCase();
  return ext.slice(0, 4).toUpperCase();
}

export function getFileIcon(filename: string): IconType {
  const extension = getFileExtension(filename);

  if (["jpg", "jpeg", "png", "gif", "bmp", "svg", "webp", "ico", "tiff", "tif"].includes(extension)) {
    return FaFileImage;
  }

  if (["mp4", "avi", "mov", "wmv", "flv", "webm", "mkv", "m4v", "3gp", "ogv"].includes(extension)) {
    return FaFileVideo;
  }

  if (["mp3", "wav", "flac", "aac", "ogg", "wma", "m4a", "opus", "amr"].includes(extension)) {
    return FaFileAudio;
  }

  if (extension === "pdf") {
    return FaFilePdf;
  }

  if (["doc", "docx", "rtf", "odt"].includes(extension)) {
    return FaFileWord;
  }

  if (["xls", "xlsx", "csv", "ods"].includes(extension)) {
    return FaFileExcel;
  }

  if (["ppt", "pptx", "odp"].includes(extension)) {
    return FaFilePowerpoint;
  }

  if (["zip", "rar", "7z", "tar", "gz", "bz2", "xz", "iso", "dmg"].includes(extension)) {
    return FaFileZipper;
  }

  if (
    [
      "js",
      "jsx",
      "ts",
      "tsx",
      "html",
      "css",
      "scss",
      "sass",
      "less",
      "json",
      "xml",
      "yaml",
      "yml",
      "py",
      "java",
      "cpp",
      "c",
      "h",
      "cs",
      "php",
      "rb",
      "go",
      "rs",
      "swift",
      "kt",
      "dart",
      "sh",
      "bash",
      "zsh",
      "ps1",
      "bat",
      "cmd",
      "sql",
      "md",
      "markdown",
    ].includes(extension)
  ) {
    return FaFileCode;
  }

  return FaFile;
}

export function formatBytes(bytes: number, precision = 2, trimZeros = true): string {
  const units = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

  if (!Number.isFinite(bytes) || bytes < 0) {
    return "0 B";
  }

  if (bytes === 0) {
    return "0 B";
  }

  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const unitIndex = Math.max(0, Math.min(i, units.length - 1));
  const value = bytes / 1024 ** unitIndex;
  const fixed = value.toFixed(precision);
  return `${trimZeros ? fixed.replace(/\.?0+$/, "") : fixed} ${units[unitIndex]}`;
}

/**
 * Stable-width readout for progress bars. Both values share the total's unit
 * and keep fixed decimals, so the text never grows or shrinks mid-transfer
 * (e.g. "0.23 GB / 1.35 GB" instead of "238.41 MB / 1.35 GB").
 */
export function formatProgressBytes(
  transferred: number,
  total: number,
  precision = 2,
): { transferred: string; total: string } {
  const units = ["B", "KB", "MB", "GB", "TB", "PB", "EB", "ZB", "YB"];

  if (!Number.isFinite(total) || total <= 0) {
    return {
      transferred: formatBytes(transferred, precision, false),
      total: formatBytes(0, precision, false),
    };
  }

  const i = Math.floor(Math.log(total) / Math.log(1024));
  const unitIndex = Math.max(0, Math.min(i, units.length - 1));
  const divisor = 1024 ** unitIndex;
  const unit = units[unitIndex];
  const format = (value: number) => {
    const safe = Number.isFinite(value) ? Math.max(0, Math.min(value, total)) : 0;
    return `${(safe / divisor).toFixed(precision)} ${unit}`;
  };

  return { transferred: format(transferred), total: format(total) };
}

export class Pausable {
  private paused = false;
  private resumePromise: Promise<void> | null = null;
  private resumeResolve: (() => void) | null = null;

  public pause() {
    if (!this.paused) {
      this.paused = true;
      this.resumePromise = new Promise((resolve) => {
        this.resumeResolve = resolve;
      });
    }
  }

  public resume() {
    if (this.paused) {
      this.paused = false;
      if (this.resumeResolve) {
        this.resumeResolve();
        this.resumePromise = null;
        this.resumeResolve = null;
      }
    }
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public waitTillResumed(): Promise<void> {
    return this.resumePromise ?? Promise.resolve();
  }
}
