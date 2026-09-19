// Minimal file-system types owned by Peario.
// Only the polyfill paths we use are modeled here.

export interface OpenFilePickerOptions {
  multiple?: boolean;
}

export interface SaveFilePickerOptions {
  suggestedName?: string;
}

export interface CreateWritableOptions {
  size?: number;
}

export interface PickedFileHandle {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
}

export interface SaveFileHandle {
  readonly kind: "file";
  readonly name: string;
  /** Save handles are write-only; reading the saved file is not supported. */
  getFile(): Promise<never>;
  createWritable(options?: CreateWritableOptions): Promise<WritableStream<Uint8Array>>;
}
