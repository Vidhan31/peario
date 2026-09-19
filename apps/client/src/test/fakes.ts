import type { Socket } from "socket.io-client";

import { type Mock, vi } from "vitest";

/**
 * Type-narrowing assertion helper that replaces unsafe non-null index assertions
 */
export function assertDefined<T>(val: T, message = "Expected value to be defined"): asserts val is NonNullable<T> {
  if (val === undefined || val === null) {
    throw new Error(message);
  }
}

export class FakeRTCDataChannel extends EventTarget implements Partial<RTCDataChannel> {
  public label: string;
  public readyState: RTCDataChannelState = "open";
  public bufferedAmount = 0;
  public bufferedAmountLowThreshold = 16384;
  public binaryType: BinaryType = "arraybuffer";
  public id = 0;
  public maxPacketLifeTime: number | null = null;
  public maxRetransmits: number | null = null;
  public negotiated = false;
  public ordered = true;
  public protocol = "";

  public sentMessages: (string | ArrayBuffer | ArrayBufferView | Blob)[] = [];

  public close = vi.fn((): void => {
    this.readyState = "closed";
    const ev = new Event("close");
    this.dispatchEvent(ev);
    this.onclose?.call(this as unknown as RTCDataChannel, ev);
  });

  public onopen: ((this: RTCDataChannel, ev: Event) => void) | null = null;
  public onclose: ((this: RTCDataChannel, ev: Event) => void) | null = null;
  public onerror: ((this: RTCDataChannel, ev: Event) => void) | null = null;
  public onmessage: ((this: RTCDataChannel, ev: MessageEvent) => void) | null = null;
  public onbufferedamountlow: ((this: RTCDataChannel, ev: Event) => void) | null = null;

  constructor(label: string) {
    super();
    this.label = label;
  }

  public send = vi.fn((data: string | ArrayBuffer | ArrayBufferView | Blob): void => {
    this.sentMessages.push(data);
  });

  public trigger(type: string, data?: unknown): void {
    if (type === "message") {
      this.triggerMessage(data);
    } else {
      const ev = new Event(type);
      this.dispatchEvent(ev);
      if (type === "open") this.onopen?.call(this as unknown as RTCDataChannel, ev);
      if (type === "close") this.onclose?.call(this as unknown as RTCDataChannel, ev);
      if (type === "bufferedamountlow") this.onbufferedamountlow?.call(this as unknown as RTCDataChannel, ev);
    }
  }

  public triggerMessage(data: unknown): void {
    const ev =
      typeof MessageEvent !== "undefined"
        ? new MessageEvent("message", { data })
        : (Object.assign(new Event("message"), { data }) as MessageEvent);
    this.dispatchEvent(ev);
    this.onmessage?.call(this as unknown as RTCDataChannel, ev);
  }
}

export class FakeRTCPeerConnection extends EventTarget implements Partial<RTCPeerConnection> {
  public connectionState: RTCPeerConnectionState = "new";
  public signalingState: RTCSignalingState = "stable";
  public iceConnectionState: RTCIceConnectionState = "new";
  public iceGatheringState: RTCIceGatheringState = "new";

  public localDescription: RTCSessionDescription | null = null;
  public remoteDescription: RTCSessionDescription | null = null;

  public channels = new Map<string, FakeRTCDataChannel>();

  public onicecandidate: ((this: RTCPeerConnection, ev: RTCPeerConnectionIceEvent) => void) | null = null;
  public onconnectionstatechange: ((this: RTCPeerConnection, ev: Event) => void) | null = null;
  public ondatachannel: ((this: RTCPeerConnection, ev: RTCDataChannelEvent) => void) | null = null;
  public onsignalingstatechange: ((this: RTCPeerConnection, ev: Event) => void) | null = null;

  public createDataChannel = vi.fn((label: string, dataChannelDict?: RTCDataChannelInit): RTCDataChannel => {
    const channel = new FakeRTCDataChannel(label);
    if (dataChannelDict?.ordered !== undefined) {
      channel.ordered = dataChannelDict.ordered;
    }
    this.channels.set(label, channel);
    return channel as unknown as RTCDataChannel;
  }) as unknown as Mock & RTCPeerConnection["createDataChannel"];

  public createOffer = vi.fn(async (_options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit> => {
    this.signalingState = "have-local-offer";
    return { type: "offer", sdp: "v=0\r\no=local" };
  }) as unknown as Mock & RTCPeerConnection["createOffer"];

  public createAnswer = vi.fn(async (_options?: RTCAnswerOptions): Promise<RTCSessionDescriptionInit> => {
    this.signalingState = "stable";
    return { type: "answer", sdp: "v=0\r\no=remote" };
  }) as unknown as Mock & RTCPeerConnection["createAnswer"];

  public setLocalDescription = vi.fn(async (_desc?: RTCLocalSessionDescriptionInit): Promise<void> => {
    this.signalingState = "stable";
  }) as unknown as Mock & RTCPeerConnection["setLocalDescription"];

  public setRemoteDescription = vi.fn(async (desc: RTCSessionDescriptionInit): Promise<void> => {
    if (desc.type === "offer") {
      this.signalingState = "have-remote-offer";
    } else if (desc.type === "answer") {
      this.signalingState = "stable";
    }
  }) as unknown as Mock & RTCPeerConnection["setRemoteDescription"];

  public addIceCandidate = vi.fn(async (_candidate?: RTCIceCandidateInit | null): Promise<void> => {
    // candidate handled
  }) as unknown as Mock & RTCPeerConnection["addIceCandidate"];

  public close = vi.fn((): void => {
    this.connectionState = "closed";
    this.signalingState = "closed";
    const ev = new Event("connectionstatechange");
    this.dispatchEvent(ev);
    this.onconnectionstatechange?.call(this as unknown as RTCPeerConnection, ev);
  });

  public triggerDataChannel(channel: FakeRTCDataChannel | RTCDataChannel): void {
    const ev = new Event("datachannel") as RTCDataChannelEvent;
    Object.defineProperty(ev, "channel", { value: channel, configurable: true });
    this.dispatchEvent(ev);
    this.ondatachannel?.call(this as unknown as RTCPeerConnection, ev);
  }

  public triggerConnectionStateChange(state: RTCPeerConnectionState): void {
    this.connectionState = state;
    const ev = new Event("connectionstatechange");
    this.dispatchEvent(ev);
    this.onconnectionstatechange?.call(this as unknown as RTCPeerConnection, ev);
  }
}

export type FakeSocketListener = (...args: unknown[]) => void | Promise<void>;

export class FakeSocket {
  public id = "fake-socket-id";
  public listeners = new Map<string, FakeSocketListener[]>();
  public emitted: { event: string; data: unknown }[] = [];

  on(event: string, fn: FakeSocketListener): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)?.push(fn);
    return this;
  }

  off(event: string, fn: FakeSocketListener): this {
    const list = this.listeners.get(event);
    if (list) {
      this.listeners.set(
        event,
        list.filter((l) => l !== fn),
      );
    }
    return this;
  }

  emit(event: string, data: unknown): this {
    this.emitted.push({ event, data });
    return this;
  }

  async trigger(event: string, data?: unknown): Promise<void> {
    const list = this.listeners.get(event);
    if (list) {
      for (const fn of [...list]) {
        await fn(data);
      }
    }
  }

  asSocket(): Socket {
    return this as unknown as Socket;
  }
}

export interface TestFileSystemHandle {
  getFile: () => Promise<File>;
}

export interface TestPerformanceMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

export interface TestWindow extends Window {
  showOpenFilePicker?: () => Promise<TestFileSystemHandle[]>;
  performance: Performance & {
    memory?: TestPerformanceMemory;
  };
}
