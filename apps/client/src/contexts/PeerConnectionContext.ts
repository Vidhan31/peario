import { createContext } from "react";

import type { PeerConnectionType } from "../types/PeerConnectionTypes";

export const PeerConnectionContext = createContext<PeerConnectionType | null>(null);
