import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  Answer,
  ConnectionRequest,
  IceCandidateForPeer,
  Offer,
  Peer,
  PeerId,
  PeerServer,
  PeerSocket,
} from "../types";

import { handleConnectionRequest, handleConnectToRoom } from "../handlers/connection";
import { handleDisconnect } from "../handlers/disconnect";
import { handleAnswer, handleIceCandidate, handleOffer } from "../handlers/signaling";
import { _resetLimitersForTesting } from "../utils/limiter";
import { registerPeer, unregisterPeer } from "../utils/peer";

const ALICE_ID = "01920000-0000-7000-8000-000000000001" as PeerId;
const BOB_ID = "01920000-0000-7000-8000-000000000002" as PeerId;

const peerAlice: Peer = {
  id: ALICE_ID,
  name: "Alice",
  timestamp: new Date().toISOString(),
  personalRoomId: "ROOMAA",
};

const peerBob: Peer = {
  id: BOB_ID,
  name: "Bob",
  timestamp: new Date().toISOString(),
  personalRoomId: "ROOMBB",
};

function createMockIO() {
  const forwarded: { socketId: string; event: string; data: unknown }[] = [];
  const io = {
    to: vi.fn((socketId: string) => ({
      emit: vi.fn((event: string, data: unknown) => {
        forwarded.push({ socketId, event, data });
      }),
    })),
  } as unknown as PeerServer;
  return { io, forwarded };
}

function createMockSocket(peer: Peer, socketId: string, roomId = "192.168.1"): PeerSocket {
  const emitted: { event: string; data: unknown }[] = [];
  return {
    id: socketId,
    data: { ...peer, roomId },
    handshake: { address: "127.0.0.1" },
    emit: vi.fn((event: string, data: unknown) => {
      emitted.push({ event, data });
      return true;
    }),
    to: vi.fn((targetRoom: string) => ({
      emit: vi.fn((event: string, data: unknown) => {
        emitted.push({ event: `broadcast:${targetRoom}:${event}`, data });
        return true;
      }),
    })),
  } as unknown as PeerSocket;
}

describe("Server Signaling & Connection Security Handlers", () => {
  beforeEach(() => {
    _resetLimitersForTesting();
    unregisterPeer(ALICE_ID, "ROOMAA");
    unregisterPeer(BOB_ID, "ROOMBB");
    registerPeer(peerAlice, "socket-alice");
    registerPeer(peerBob, "socket-bob");
  });

  describe("handleConnectToRoom", () => {
    it("routes room connection request to target peer owning the personal room ID", async () => {
      const { io, forwarded } = createMockIO();
      const socketAlice = createMockSocket(peerAlice, "socket-alice");

      await handleConnectToRoom(io, socketAlice, "ROOMBB");

      expect(forwarded).toHaveLength(1);
      expect(forwarded[0]?.socketId).toBe("socket-bob");
      expect(forwarded[0]?.event).toBe("connection-request");
      const req = forwarded[0]?.data as ConnectionRequest;
      expect(req.from.id).toBe(ALICE_ID);
      expect(req.to.id).toBe(BOB_ID);
      expect(req.isRoomConnection).toBe(true);
    });

    it("drops request silently when target room does not exist", async () => {
      const { io, forwarded } = createMockIO();
      const socketAlice = createMockSocket(peerAlice, "socket-alice");

      await handleConnectToRoom(io, socketAlice, "NONEXS");
      expect(forwarded).toHaveLength(0);
    });
  });

  describe("handleOffer, handleAnswer, handleIceCandidate", () => {
    it("routes WebRTC offer with verified sender identity to target socket", () => {
      const { io, forwarded } = createMockIO();
      const socketAlice = createMockSocket(peerAlice, "socket-alice");

      handleOffer(io, socketAlice, {
        to: peerBob,
        sdp: { type: "offer", sdp: "v=0\r\no=alice 1 1 IN IP4 127.0.0.1" },
      });

      expect(forwarded).toHaveLength(1);
      expect(forwarded[0]?.socketId).toBe("socket-bob");
      expect(forwarded[0]?.event).toBe("offer");
      const offerData = forwarded[0]?.data as Offer;
      expect(offerData.from.id).toBe(ALICE_ID);
      expect(offerData.to.id).toBe(BOB_ID);
      expect(offerData.sdp.type).toBe("offer");
    });

    it("routes WebRTC answer to target socket", () => {
      const { io, forwarded } = createMockIO();
      const socketBob = createMockSocket(peerBob, "socket-bob");

      handleAnswer(io, socketBob, {
        to: peerAlice,
        sdp: { type: "answer", sdp: "v=0\r\no=bob 1 1 IN IP4 127.0.0.1" },
      });

      expect(forwarded).toHaveLength(1);
      expect(forwarded[0]?.socketId).toBe("socket-alice");
      expect(forwarded[0]?.event).toBe("answer");
      const answerData = forwarded[0]?.data as Answer;
      expect(answerData.from.id).toBe(BOB_ID);
      expect(answerData.sdp.type).toBe("answer");
    });

    it("routes ICE candidates to target socket with verified from peer", () => {
      const { io, forwarded } = createMockIO();
      const socketAlice = createMockSocket(peerAlice, "socket-alice");

      handleIceCandidate(io, socketAlice, {
        target: peerBob,
        candidate: { candidate: "candidate:1 1 UDP 2122252543 192.168.1.1 50000 typ host", sdpMid: "0" },
      });

      expect(forwarded).toHaveLength(1);
      expect(forwarded[0]?.socketId).toBe("socket-bob");
      expect(forwarded[0]?.event).toBe("ice-candidate");
      const iceData = forwarded[0]?.data as IceCandidateForPeer;
      expect(iceData.from.id).toBe(ALICE_ID);
      expect(iceData.target.id).toBe(BOB_ID);
      expect(iceData.candidate.sdpMid).toBe("0");
    });

    it("rejects malformed SDP payloads without forwarding", () => {
      const { io, forwarded } = createMockIO();
      const socketAlice = createMockSocket(peerAlice, "socket-alice");

      handleOffer(io, socketAlice, {
        to: peerBob,
        sdp: { type: "invalid-type", sdp: "v=0" },
      });

      expect(forwarded).toHaveLength(0);
    });
  });

  describe("handleDisconnect", () => {
    it("unregisters peer and broadcasts peer-left to the room", () => {
      const socketAlice = createMockSocket(peerAlice, "socket-alice", "ROOM-ALPHA");

      handleDisconnect(socketAlice);

      // Alice should no longer be mapped
      const { io, forwarded } = createMockIO();
      const socketBob = createMockSocket(peerBob, "socket-bob");
      handleConnectionRequest(io, socketBob, { to: peerAlice });
      expect(forwarded).toHaveLength(0);
    });
  });
});
