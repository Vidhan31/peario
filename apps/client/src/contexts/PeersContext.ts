import type { Peer, PeerId } from "@peario/shared";

import { createContext } from "react";

export interface PeersContextState {
  localPeer: Peer;
  peers: Peer[];
  selectedPeerId: PeerId | null;
  setSelectedPeerId: (id: PeerId | null) => void;
}

export const PeersContext = createContext<PeersContextState | null>(null);
