import type { PeerId } from "@peario/shared";

import { describe, expect, it } from "vitest";

import type { FileTransferRecord } from "../../types/FileTransferRecord";

import { failStuckOutgoingRecords, removePendingIncomingForPeer } from "../useFileTransfer";

const TEST_PEER_ID = "01920000-0000-7000-8000-000000000001" as PeerId;
const OTHER_PEER_ID = "01920000-0000-7000-8000-000000000002" as PeerId;

function makeRecord(overrides: Partial<FileTransferRecord> = {}): FileTransferRecord {
  return {
    id: `file-${Math.random().toString(36).slice(2)}`,
    peerId: TEST_PEER_ID,
    fileMetadata: { name: "test.bin", size: 1024, type: "application/octet-stream" },
    direction: "outgoing",
    status: "transferring",
    timestamp: Date.now(),
    ...overrides,
  };
}

describe("failStuckOutgoingRecords", () => {
  it("returns the SAME array reference when no record needs failing (setState bailout)", () => {
    const prev: FileTransferRecord[] = [
      makeRecord({ status: "completed" }),
      makeRecord({ status: "failed" }),
      makeRecord({ direction: "incoming", status: "transferring" }),
      makeRecord({ direction: "incoming", status: "pending_acceptance" }),
    ];
    // A new identity here would re-render Pear + transfer subtree on every
    // disconnect-effect run even though nothing changed.
    expect(failStuckOutgoingRecords(prev)).toBe(prev);
  });

  it("returns the same reference for an empty list", () => {
    const prev: FileTransferRecord[] = [];
    expect(failStuckOutgoingRecords(prev)).toBe(prev);
  });

  it("marks stuck outgoing transferring/paused records failed with a new array", () => {
    const stuck = makeRecord({ status: "transferring" });
    const paused = makeRecord({ status: "paused" });
    const done = makeRecord({ status: "completed" });
    const prev = [stuck, paused, done];

    const next = failStuckOutgoingRecords(prev);

    expect(next).not.toBe(prev);
    expect(next[0]).toMatchObject({ status: "failed", error: "Peer disconnected" });
    expect(next[1]).toMatchObject({ status: "failed", error: "Peer disconnected" });
    expect(next[2]).toBe(done);
    // Untouched records keep identity so memoized children below them hold.
    expect(next[0]).not.toBe(stuck);
  });

  it("leaves incoming transferring records alone", () => {
    const incoming = makeRecord({ direction: "incoming", status: "transferring" });
    const prev = [incoming];
    expect(failStuckOutgoingRecords(prev)).toBe(prev);
  });
});

describe("removePendingIncomingForPeer", () => {
  it("returns the SAME array reference when nothing matches (setState bailout)", () => {
    const prev: FileTransferRecord[] = [
      makeRecord({ direction: "incoming", status: "transferring" }),
      makeRecord({ direction: "outgoing", status: "transferring" }),
      makeRecord({ direction: "incoming", status: "completed" }),
    ];
    expect(removePendingIncomingForPeer(prev, TEST_PEER_ID)).toBe(prev);
  });

  it("returns the same reference for null peer or an empty list", () => {
    const prev = [makeRecord({ direction: "incoming", status: "pending_acceptance" })];
    expect(removePendingIncomingForPeer(prev, null)).toBe(prev);
    expect(removePendingIncomingForPeer([], TEST_PEER_ID)).toEqual([]);
  });

  it("drops only pending incoming records for the given peer", () => {
    const pending = makeRecord({ direction: "incoming", status: "pending_acceptance" });
    const otherPeerPending = makeRecord({
      direction: "incoming",
      status: "pending_acceptance",
      peerId: OTHER_PEER_ID,
    });
    const transferring = makeRecord({ direction: "incoming", status: "transferring" });
    const prev = [pending, otherPeerPending, transferring];

    const next = removePendingIncomingForPeer(prev, TEST_PEER_ID);

    expect(next).not.toBe(prev);
    expect(next).toEqual([otherPeerPending, transferring]);
  });
});
