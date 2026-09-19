import {
  formatValidationError,
  type Peer,
  type PeerId,
  PeerLeftDataSchema,
  PeerSchema,
  validatePayload,
} from "@peario/shared";
import { type ReactNode, use, useEffect, useMemo, useState } from "react";
import { z } from "zod";

import { useSocketStatus } from "../hooks/useSocketStatus";
import { socketLogger } from "../lib/logger";
import { socket, socketService } from "../lib/SocketService";
import { PeersContext } from "./PeersContext";

const PeersIdentifiedSchema = z.array(PeerSchema);

export const PeersProvider = ({ children, userName }: { children: ReactNode; userName: string }) => {
  const localPeer = use(socketService.getIdentity(userName));
  const [peers, setPeers] = useState<Peer[]>([]);
  const [selectedPeerId, setSelectedPeerId] = useState<PeerId | null>(null);
  const isConnected = useSocketStatus();

  useEffect(() => {
    if (!isConnected) {
      return;
    }

    const handleNewPeer = (data: unknown) => {
      const validation = validatePayload(PeerSchema, data);
      if (!validation.success) {
        socketLogger.error(`Invalid new-peer-joined payload: ${formatValidationError(validation.error)}`);
        return;
      }
      const newPeer = validation.data;

      if (newPeer.id !== localPeer.id) {
        setPeers((prevPeers) => {
          const existingPeer = prevPeers.find((peer) => peer.id === newPeer.id);
          if (existingPeer) {
            return prevPeers.map((peer) => (peer.id === newPeer.id ? { ...peer, ...newPeer } : peer));
          }
          return [...prevPeers, newPeer];
        });
      }
    };

    const handlePeerLeft = (data: unknown) => {
      const validation = validatePayload(PeerLeftDataSchema, data);
      if (!validation.success) {
        socketLogger.error(`Invalid peer-left payload: ${formatValidationError(validation.error)}`);
        return;
      }
      const leftPeer = validation.data;

      setPeers((prevPeers) => {
        return prevPeers.filter((peer) => peer.id !== leftPeer.id);
      });
      setSelectedPeerId((prevId) => (prevId === leftPeer.id ? null : prevId));
    };

    const handlePeersIdentified = (data: unknown) => {
      const validation = validatePayload(PeersIdentifiedSchema, data);
      if (!validation.success) {
        socketLogger.error(`Invalid peers-identified payload: ${formatValidationError(validation.error)}`);
        return;
      }
      const identifiedPeers = validation.data;

      setPeers(() => {
        return identifiedPeers.filter((peer) => peer.id !== localPeer.id);
      });
    };

    socket.on("peers-identified", handlePeersIdentified);
    socket.on("new-peer-joined", handleNewPeer);
    socket.on("peer-left", handlePeerLeft);

    socket.emit("identify-peers");

    return () => {
      socket.off("peers-identified", handlePeersIdentified);
      socket.off("new-peer-joined", handleNewPeer);
      socket.off("peer-left", handlePeerLeft);
    };
  }, [isConnected, localPeer]);

  const contextValue = useMemo(
    () => ({ localPeer, peers, selectedPeerId, setSelectedPeerId }),
    [localPeer, peers, selectedPeerId],
  );

  return <PeersContext value={contextValue}>{children}</PeersContext>;
};
