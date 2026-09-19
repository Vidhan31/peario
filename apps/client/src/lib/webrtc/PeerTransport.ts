import type { PeerId } from "@peario/shared";

import {
  type FileControlMessage,
  FileControlMessageSchema,
  type FileMetadata,
  formatValidationError,
  validatePayload,
} from "@peario/shared";

import { dataChannelLogger } from "../logger";

export interface TransportChannels {
  ctrlChannel: RTCDataChannel;
  dataChannel: RTCDataChannel;
}

export type FileControlHandler = (control: FileControlMessage) => void;
export type FileDataHandler = (chunk: ArrayBuffer) => void;

export class PeerTransport {
  public readonly peerId: PeerId;
  private readonly ctrlChannel: RTCDataChannel;
  private readonly dataChannel: RTCDataChannel;
  private readonly isSingleChannelFallback: boolean;

  private readonly ctrlHandlers = new Set<FileControlHandler>();
  private readonly dataHandlers = new Set<FileDataHandler>();

  private isDestroyed = false;

  constructor(peerId: PeerId, channels: TransportChannels) {
    this.peerId = peerId;
    this.ctrlChannel = channels.ctrlChannel;
    this.dataChannel = channels.dataChannel;

    this.isSingleChannelFallback = this.ctrlChannel === this.dataChannel;

    this.bindListeners();
  }

  public get rawFileDataChannel(): RTCDataChannel {
    return this.dataChannel;
  }

  private bindListeners() {
    this.ctrlChannel.binaryType = "arraybuffer";
    this.dataChannel.binaryType = "arraybuffer";

    if (this.isSingleChannelFallback) {
      this.ctrlChannel.addEventListener("message", this.handleUnifiedFileMessage);
    } else {
      this.ctrlChannel.addEventListener("message", this.handleCtrlMessage);
      this.dataChannel.addEventListener("message", this.handleDataMessage);
    }
  }

  private unbindListeners() {
    if (this.isSingleChannelFallback) {
      this.ctrlChannel.removeEventListener("message", this.handleUnifiedFileMessage);
    } else {
      this.ctrlChannel.removeEventListener("message", this.handleCtrlMessage);
      this.dataChannel.removeEventListener("message", this.handleDataMessage);
    }
  }

  private handleCtrlMessage = (event: MessageEvent) => {
    if (typeof event.data !== "string") {
      dataChannelLogger.warn(`Received non-string ctrl data on ctrl channel from peer ${this.peerId}`);
      return;
    }

    try {
      const raw: unknown = JSON.parse(event.data);
      const validation = validatePayload(FileControlMessageSchema, raw);
      if (!validation.success) {
        dataChannelLogger.warn(
          `Invalid file-ctrl message schema from peer ${this.peerId}: ${formatValidationError(validation.error)}`,
        );
        return;
      }
      for (const handler of this.ctrlHandlers) {
        handler(validation.data);
      }
    } catch (err) {
      dataChannelLogger.error(`Error parsing ctrl message from peer ${this.peerId}:`, err);
    }
  };

  private handleDataMessage = (event: MessageEvent) => {
    if (event.data instanceof ArrayBuffer) {
      for (const handler of this.dataHandlers) {
        handler(event.data);
      }
    } else if (ArrayBuffer.isView(event.data)) {
      const buffer = event.data.buffer.slice(
        event.data.byteOffset,
        event.data.byteOffset + event.data.byteLength,
      ) as ArrayBuffer;
      for (const handler of this.dataHandlers) {
        handler(buffer);
      }
    } else {
      dataChannelLogger.warn(`Received non-binary data on data channel from peer ${this.peerId}`);
    }
  };

  private handleUnifiedFileMessage = (event: MessageEvent) => {
    if (typeof event.data === "string") {
      const msg = event.data;
      if (msg === "pause") {
        for (const handler of this.ctrlHandlers) {
          handler({ kind: "pause" });
        }
      } else if (msg === "resume") {
        for (const handler of this.ctrlHandlers) {
          handler({ kind: "resume" });
        }
      } else if (msg === "receiver-ready") {
        for (const handler of this.ctrlHandlers) {
          handler({ kind: "receiver-ready" });
        }
      } else if (msg.startsWith("file-metadata:")) {
        try {
          const raw: unknown = JSON.parse(msg.substring("file-metadata:".length));
          const ctrlMsg: FileControlMessage = {
            kind: "file-offer",
            metadata: raw as FileMetadata,
          };
          for (const handler of this.ctrlHandlers) {
            handler(ctrlMsg);
          }
        } catch (err) {
          dataChannelLogger.error(`Error parsing legacy metadata from peer ${this.peerId}:`, err);
        }
      } else {
        try {
          const raw: unknown = JSON.parse(msg);
          const validation = validatePayload(FileControlMessageSchema, raw);
          if (validation.success) {
            for (const handler of this.ctrlHandlers) {
              handler(validation.data);
            }
          }
        } catch {
          dataChannelLogger.warn(`Unrecognized string message on unified channel: ${msg}`);
        }
      }
    } else {
      this.handleDataMessage(event);
    }
  };

  public onFileControl = (handler: FileControlHandler): (() => void) => {
    this.ctrlHandlers.add(handler);
    return () => this.ctrlHandlers.delete(handler);
  };

  public onFileData = (handler: FileDataHandler): (() => void) => {
    this.dataHandlers.add(handler);
    return () => this.dataHandlers.delete(handler);
  };

  public sendFileOffer = (metadata: FileMetadata): void => {
    this.sendFileControl({ kind: "file-offer", metadata });
  };

  public sendFileControl = (control: FileControlMessage): void => {
    if (this.ctrlChannel.readyState !== "open") {
      throw new Error(`File ctrl channel not open (state: ${this.ctrlChannel.readyState})`);
    }
    const validation = validatePayload(FileControlMessageSchema, control);
    if (!validation.success) {
      throw new Error(`Invalid FileControlMessage: ${formatValidationError(validation.error)}`);
    }

    if (!this.isSingleChannelFallback) {
      this.ctrlChannel.send(JSON.stringify(validation.data));
    } else {
      if (control.kind === "file-offer") {
        this.ctrlChannel.send(`file-metadata:${JSON.stringify(control.metadata)}`);
      } else if (control.kind === "receiver-ready") {
        this.ctrlChannel.send("receiver-ready");
      } else if (control.kind === "pause") {
        this.ctrlChannel.send("pause");
      } else if (control.kind === "resume") {
        this.ctrlChannel.send("resume");
      } else {
        // cancel/error have no legacy string form; send JSON (the unified
        // handler parses JSON control messages). Dropping them would leave
        // the remote peer stuck mid-transfer.
        this.ctrlChannel.send(JSON.stringify(validation.data));
      }
    }
  };

  public sendDataChunk = (chunk: ArrayBufferView | ArrayBuffer): void => {
    if (this.dataChannel.readyState !== "open") {
      throw new Error(`File data channel not open (state: ${this.dataChannel.readyState})`);
    }
    this.dataChannel.send(chunk as ArrayBuffer);
  };

  public get dataBufferedAmount(): number {
    return this.dataChannel.bufferedAmount;
  }

  public destroy = (): void => {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    this.unbindListeners();
    this.ctrlHandlers.clear();
    this.dataHandlers.clear();
  };
}
