import { describe, expect, it, vi } from "vitest";

import type { Peer, PeerId, PeerServer, PeerSocket } from "../types";

import { generateRoomId, handleIdentifyPeers, handleSelfIdentify, UNAMBIGUOUS_ROOM_CHARS } from "../handlers/identity";
import { RoomIdSchema } from "../types";
import { unregisterPeer } from "../utils/peer";

function createMockSocket(
  id = "sock-test-1",
  ip = "192.168.1.100",
): {
  socket: PeerSocket;
  emitted: { event: string; data: unknown }[];
  roomsJoined: string[];
} {
  const emitted: { event: string; data: unknown }[] = [];
  const roomsJoined: string[] = [];

  const socket = {
    id,
    data: {},
    handshake: { address: ip },
    emit: vi.fn((event: string, data: unknown) => {
      emitted.push({ event, data });
      return true;
    }),
    disconnect: vi.fn(),
    join: vi.fn((room: string) => {
      roomsJoined.push(room);
      return Promise.resolve();
    }),
    to: vi.fn((_room: string) => ({
      emit: vi.fn((event: string, data: unknown) => {
        emitted.push({ event: `broadcast:${event}`, data });
        return true;
      }),
    })),
  } as unknown as PeerSocket;

  return { socket, emitted, roomsJoined };
}

describe("Room ID Generation & Character Constraints", () => {
  it("generates a 6-character room ID by default conforming to RoomIdSchema", () => {
    const roomId = generateRoomId();
    expect(roomId).toHaveLength(6);
    expect(RoomIdSchema.safeParse(roomId).success).toBe(true);
  });

  it("generates customizable length room IDs", () => {
    expect(generateRoomId(8)).toHaveLength(8);
    expect(generateRoomId(10)).toHaveLength(10);
  });

  it("contains only characters from UNAMBIGUOUS_ROOM_CHARS and excludes 0, O, 1, I", () => {
    const allowedCharsSet = new Set(UNAMBIGUOUS_ROOM_CHARS.split(""));
    const ambiguousChars = ["0", "O", "1", "I"];

    for (let i = 0; i < 50; i++) {
      const roomId = generateRoomId(6);
      for (const char of roomId) {
        expect(allowedCharsSet.has(char)).toBe(true);
      }
      for (const ambiguous of ambiguousChars) {
        expect(roomId.includes(ambiguous)).toBe(false);
      }
    }
  });

  it("generates statistically distinct codes across consecutive invocations", () => {
    const codes = new Set<string>();
    const count = 100;
    for (let i = 0; i < count; i++) {
      codes.add(generateRoomId(6));
    }
    expect(codes.size).toBe(count);
  });
});

describe("handleSelfIdentify Behavioral Logic", () => {
  it("authenticates peer with generated UUIDv7, assigns default subnet room, and emits identity-confirmed", () => {
    const { socket, emitted, roomsJoined } = createMockSocket("sock-alice-1", "192.168.1.50");

    handleSelfIdentify(socket, { name: "Alice" });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.event).toBe("identity-confirmed");
    const confirmedPeer = emitted[0]?.data as Peer;
    expect(confirmedPeer.name).toBe("Alice");
    expect(confirmedPeer.id).toBeDefined();
    expect(confirmedPeer.personalRoomId).toHaveLength(6);

    // Default subnet assignment: 192.168.1.50 -> 192.168.1
    expect(roomsJoined).toContain("192.168.1");
    expect(socket.data.roomId).toBe("192.168.1");

    // Clean up registered peer
    unregisterPeer(confirmedPeer.id, confirmedPeer.personalRoomId);
  });

  it("assigns customRoomId when explicitly provided", () => {
    const { socket, emitted, roomsJoined } = createMockSocket("sock-bob-1", "10.0.0.5");

    handleSelfIdentify(socket, { name: "Bob", customRoomId: "CUSTOM" });

    expect(roomsJoined).toContain("CUSTOM");
    expect(socket.data.roomId).toBe("CUSTOM");

    const confirmedPeer = emitted[0]?.data as Peer;
    unregisterPeer(confirmedPeer.id, confirmedPeer.personalRoomId);
  });

  it("rejects invalid or empty name payload, emits identity-error, and disconnects socket", () => {
    const { socket, emitted } = createMockSocket("sock-bad-1");

    handleSelfIdentify(socket, { name: "   " });

    expect(emitted).toContainEqual({
      event: "identity-error",
      data: { message: expect.stringContaining("Validation error:") },
    });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
  });
});

describe("handleIdentifyPeers Behavioral Logic", () => {
  it("drops request when socket is not authenticated", async () => {
    const { socket, emitted } = createMockSocket("sock-unauth-1");
    const mockIO = {} as unknown as PeerServer;

    await handleIdentifyPeers(mockIO, socket);

    expect(emitted).toHaveLength(0);
  });

  it("fetches room sockets, excludes caller, and notifies existing room members with new-peer-joined", async () => {
    const { socket: callerSocket, emitted: callerEmitted } = createMockSocket("sock-caller", "192.168.1.1");
    const callerPeer: Peer = {
      id: "01920000-0000-7000-8000-000000000001" as PeerId,
      name: "CallerAlice",
      timestamp: new Date().toISOString(),
    };
    callerSocket.data = { ...callerPeer, roomId: "ROOM01" };

    const peerBob: Peer = {
      id: "01920000-0000-7000-8000-000000000002" as PeerId,
      name: "BobInRoom",
      timestamp: new Date().toISOString(),
    };
    const otherSocket = {
      id: "sock-bob",
      data: { ...peerBob, roomId: "ROOM01" },
    };

    const mockIO = {
      in: vi.fn(() => ({
        fetchSockets: vi.fn().mockResolvedValue([callerSocket, otherSocket]),
      })),
    } as unknown as PeerServer;

    await handleIdentifyPeers(mockIO, callerSocket);

    // Caller receives only Bob (caller is excluded)
    expect(callerEmitted).toContainEqual({
      event: "peers-identified",
      data: [expect.objectContaining({ name: "BobInRoom", id: peerBob.id })],
    });

    // Room members are notified that caller joined
    expect(callerEmitted).toContainEqual({
      event: "broadcast:new-peer-joined",
      data: expect.objectContaining({ name: "CallerAlice", id: callerPeer.id }),
    });
  });

  it("handles room socket fetch error gracefully by returning an empty peer list", async () => {
    const { socket, emitted } = createMockSocket("sock-err-1");
    socket.data = {
      id: "01920000-0000-7000-8000-000000000001" as PeerId,
      name: "Alice",
      timestamp: new Date().toISOString(),
      roomId: "ROOM01",
    };

    const mockIO = {
      in: vi.fn(() => ({
        fetchSockets: vi.fn().mockRejectedValue(new Error("Redis or engine IO failure")),
      })),
    } as unknown as PeerServer;

    await handleIdentifyPeers(mockIO, socket);

    expect(emitted).toContainEqual({
      event: "peers-identified",
      data: [],
    });
  });
});
