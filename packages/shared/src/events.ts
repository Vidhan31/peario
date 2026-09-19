import type {
  Answer,
  AnswerIncoming,
  ConnectionRequest,
  ConnectionRequestIncoming,
  IceCandidateForPeer,
  IceCandidateIncoming,
  Offer,
  OfferIncoming,
  Peer,
  PeerLeftData,
  RateLimitedData,
  SelfIdentifyData,
} from "./schemas";

/** Incoming types don't include 'from' field - server adds it from authenticated socket data */
export interface ClientToServerEvents {
  "self-identify": (data: SelfIdentifyData) => void;
  "identify-peers": () => void;
  "connection-request": (data: ConnectionRequestIncoming) => void;
  "connect-to-room": (data: string) => void;
  offer: (data: OfferIncoming) => void;
  answer: (data: AnswerIncoming) => void;
  "ice-candidate": (data: IceCandidateIncoming) => void;
}

export interface ServerToClientEvents {
  "identity-error": (data: { message: string }) => void;
  "identity-confirmed": (peer: Peer) => void;
  "peers-identified": (peers: Peer[]) => void;
  "new-peer-joined": (peer: Peer) => void;
  "connection-request": (request: ConnectionRequest) => void;
  offer: (offer: Offer) => void;
  answer: (answer: Answer) => void;
  "ice-candidate": (iceData: IceCandidateForPeer) => void;
  "peer-left": (data: PeerLeftData) => void;
  "rate-limited": (data: RateLimitedData) => void;
}

export interface InterServerEvents {
  ping: () => void;
}
