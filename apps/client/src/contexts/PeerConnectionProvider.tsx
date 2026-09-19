import { type ReactNode } from "react";

import type { PeerConnectionType } from "../types/PeerConnectionTypes";

import { usePeerManager } from "../hooks/usePeerManager";
import { PeerConnectionContext } from "./PeerConnectionContext";

export const PeerConnectionProvider = ({ children }: { children: ReactNode }) => {
  const peerConnection: PeerConnectionType = usePeerManager();

  return <PeerConnectionContext value={peerConnection}>{children}</PeerConnectionContext>;
};
