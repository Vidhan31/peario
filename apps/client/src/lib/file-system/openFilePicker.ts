// Open picker with native-first delegation and input fallback.

import type { OpenFilePickerOptions, PickedFileHandle } from "./types";

type NativeOpenPicker = (options?: { multiple?: boolean }) => Promise<PickedFileHandle[]>;

function getNativePicker(): NativeOpenPicker | null {
  const candidate = (globalThis as unknown as { showOpenFilePicker?: unknown }).showOpenFilePicker;
  return typeof candidate === "function" ? (candidate as NativeOpenPicker) : null;
}

/**
 * Show a file picker and return handles with `getFile`.
 * Delegates to the browser picker when present (this keeps the Playwright
 * stub in e2e working), otherwise falls back to a hidden input element.
 * Cancel via input returns an empty array. Native cancel throws AbortError
 * and propagates to the caller.
 */
export async function showOpenFilePicker(options: OpenFilePickerOptions = {}): Promise<PickedFileHandle[]> {
  const native = getNativePicker();
  if (native) {
    return native({ multiple: options.multiple ?? false });
  }

  if (typeof document === "undefined") {
    throw new Error("showOpenFilePicker requires a browser environment");
  }

  const input = document.createElement("input");
  input.type = "file";
  input.multiple = options.multiple ?? false;

  // Keep the input off screen (iOS Safari needs it in the DOM to fire change).
  input.style.position = "fixed";
  input.style.top = "-100000px";
  input.style.left = "-100000px";
  document.body.appendChild(input);

  try {
    await new Promise<void>((resolve) => {
      input.addEventListener("change", () => resolve(), { once: true });
      input.click();
    });

    const files = input.files ? Array.from(input.files) : [];
    return files.map((file): PickedFileHandle => ({
      kind: "file",
      name: file.name,
      getFile: () => Promise.resolve(file),
    }));
  } finally {
    input.remove();
  }
}
