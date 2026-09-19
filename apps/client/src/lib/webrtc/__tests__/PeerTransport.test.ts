import type { PeerId } from "@peario/shared";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeRTCDataChannel } from "@/test/fakes";

import { PeerTransport } from "../PeerTransport";

describe("PeerTransport", () => {
  const peerId = "01920000-0000-7000-8000-000000000001" as PeerId;
  let ctrlChannel: FakeRTCDataChannel;
  let dataChannel: FakeRTCDataChannel;

  beforeEach(() => {
    ctrlChannel = new FakeRTCDataChannel("file-ctrl");
    dataChannel = new FakeRTCDataChannel("file-data");
  });

  describe("Dedicated Channels", () => {
    it("parses and delivers typed file control messages", () => {
      const transport = new PeerTransport(peerId, {
        ctrlChannel: ctrlChannel as unknown as RTCDataChannel,
        dataChannel: dataChannel as unknown as RTCDataChannel,
      });

      const onCtrl = vi.fn();
      transport.onFileControl(onCtrl);

      ctrlChannel.triggerMessage(
        JSON.stringify({
          kind: "file-offer",
          metadata: { name: "test.pdf", size: 1024, type: "application/pdf" },
        }),
      );
      expect(onCtrl).toHaveBeenLastCalledWith({
        kind: "file-offer",
        metadata: { name: "test.pdf", size: 1024, type: "application/pdf" },
      });

      ctrlChannel.triggerMessage(JSON.stringify({ kind: "receiver-ready" }));
      expect(onCtrl).toHaveBeenLastCalledWith({ kind: "receiver-ready" });

      ctrlChannel.triggerMessage(JSON.stringify({ kind: "pause" }));
      expect(onCtrl).toHaveBeenLastCalledWith({ kind: "pause" });

      ctrlChannel.triggerMessage(JSON.stringify({ kind: "resume" }));
      expect(onCtrl).toHaveBeenLastCalledWith({ kind: "resume" });
    });

    it("delivers binary chunks to onFileData", () => {
      const transport = new PeerTransport(peerId, {
        ctrlChannel: ctrlChannel as unknown as RTCDataChannel,
        dataChannel: dataChannel as unknown as RTCDataChannel,
      });

      const onData = vi.fn();
      transport.onFileData(onData);

      const buffer = new Uint8Array([1, 2, 3, 4]).buffer;
      dataChannel.triggerMessage(buffer);

      expect(onData).toHaveBeenCalledTimes(1);
      expect(onData).toHaveBeenCalledWith(buffer);
    });

    it("sends control payloads correctly", () => {
      const transport = new PeerTransport(peerId, {
        ctrlChannel: ctrlChannel as unknown as RTCDataChannel,
        dataChannel: dataChannel as unknown as RTCDataChannel,
      });

      transport.sendFileControl({ kind: "receiver-ready" });
      expect(ctrlChannel.sentMessages.length).toBe(1);
      expect(JSON.parse(ctrlChannel.sentMessages[0] as string)).toEqual({ kind: "receiver-ready" });
    });
  });

  describe("Legacy Single Channel Fallback", () => {
    it("handles legacy string commands on unified file channel", () => {
      const legacyFileChannel = new FakeRTCDataChannel("file");
      const transport = new PeerTransport(peerId, {
        ctrlChannel: legacyFileChannel as unknown as RTCDataChannel,
        dataChannel: legacyFileChannel as unknown as RTCDataChannel,
      });

      const onCtrl = vi.fn();
      const onData = vi.fn();
      transport.onFileControl(onCtrl);
      transport.onFileData(onData);

      legacyFileChannel.triggerMessage(
        `file-metadata:${JSON.stringify({ name: "legacy.mp4", size: 5000, type: "video/mp4" })}`,
      );
      expect(onCtrl).toHaveBeenLastCalledWith({
        kind: "file-offer",
        metadata: { name: "legacy.mp4", size: 5000, type: "video/mp4" },
      });

      legacyFileChannel.triggerMessage("receiver-ready");
      expect(onCtrl).toHaveBeenLastCalledWith({ kind: "receiver-ready" });

      legacyFileChannel.triggerMessage("pause");
      expect(onCtrl).toHaveBeenLastCalledWith({ kind: "pause" });

      legacyFileChannel.triggerMessage("resume");
      expect(onCtrl).toHaveBeenLastCalledWith({ kind: "resume" });

      const buffer = new Uint8Array([9, 8, 7]).buffer;
      legacyFileChannel.triggerMessage(buffer);
      expect(onData).toHaveBeenCalledWith(buffer);
    });
  });
});
