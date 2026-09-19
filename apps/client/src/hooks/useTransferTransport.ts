import type { PeerId } from "@peario/shared";

import { useEffect, useState } from "react";

import { CHANNEL_LABELS, TIMEOUTS_MS } from "@/constants/index.ts";
import { fileLogger } from "@/lib/logger";
import { FileTransferEngine, type IncomingTransferSession } from "@/lib/webrtc/FileTransferEngine";
import { PeerTransport } from "@/lib/webrtc/PeerTransport";

export type ChannelGetter = (peerId: PeerId, label: string) => RTCDataChannel | null;
export type ChannelWaiter = (peerId: PeerId, label: string, timeoutMs?: number) => Promise<RTCDataChannel>;

interface UseTransferTransportOptions {
  peerId: PeerId | null;
  connectionState: RTCPeerConnectionState | undefined;
  getDataChannel: ChannelGetter;
  waitForChannel: ChannelWaiter | undefined;
  onIncomingOffer: (session: IncomingTransferSession) => void;
  onError: (error: unknown) => void;
}

/**
 * Owns the WebRTC data-channel transport and FileTransferEngine lifecycle for
 * the selected peer. Creates both once the peer connection is established and
 * tears them down on disconnect, peer change, or unmount.
 */
export function useTransferTransport({
  peerId,
  connectionState,
  getDataChannel,
  waitForChannel,
  onIncomingOffer,
  onError,
}: UseTransferTransportOptions): FileTransferEngine | null {
  const [engine, setEngine] = useState<FileTransferEngine | null>(null);

  useEffect(() => {
    if (connectionState !== "connected" || !peerId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect, @eslint-react/set-state-in-effect -- intentional reset when disconnected; mirrors previous ref-based teardown
      setEngine(null);
      return;
    }

    let cancelled = false;
    let cleanup: (() => void) | undefined;
    const activePeerId = peerId;

    async function initTransport() {
      try {
        const getChan = async (label: string) => {
          if (waitForChannel) {
            return await waitForChannel(activePeerId, label, TIMEOUTS_MS.CHANNEL_WAIT);
          }
          return getDataChannel(activePeerId, label);
        };

        const ctrlChannel = await getChan(CHANNEL_LABELS.CTRL).catch(() => getChan(CHANNEL_LABELS.LEGACY));
        const dataChannel = await getChan(CHANNEL_LABELS.DATA).catch(() => getChan(CHANNEL_LABELS.LEGACY));

        if (cancelled || !ctrlChannel || !dataChannel) {
          return;
        }

        const transport = new PeerTransport(activePeerId, { ctrlChannel, dataChannel });
        const nextEngine = new FileTransferEngine(activePeerId, transport);
        const unsubscribeOffer = nextEngine.onIncomingOffer(onIncomingOffer);

        cleanup = () => {
          unsubscribeOffer();
          transport.destroy();
          nextEngine.destroy();
        };

        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- cancelled is set by the unmount cleanup, which can run while the awaits above are pending
        if (cancelled) {
          cleanup();
          return;
        }

        setEngine(nextEngine);
      } catch (err) {
        fileLogger.error(`[FileTransfer] Failed to initialize transport for peer ${activePeerId}:`, err);
        onError(err);
      }
    }

    void initTransport();

    return () => {
      cancelled = true;
      cleanup?.();
      setEngine(null);
    };
  }, [peerId, connectionState, getDataChannel, waitForChannel, onIncomingOffer, onError]);

  return engine;
}
