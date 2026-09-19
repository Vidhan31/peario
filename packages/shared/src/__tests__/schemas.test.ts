import { describe, expect, it } from "vitest";

import {
  ClientErrorReportSchema,
  ConnectToRoomSchema,
  DataChunkPayloadSchema,
  DataChunkSizeSchema,
  FileControlMessageSchema,
  FileMetadataSchema,
  formatValidationError,
  IceCandidateSchema,
  MAX_CHUNK_SIZE,
  MIN_CHUNK_SIZE,
  PeerIdSchema,
  PeerNameSchema,
  PeerSchema,
  RoomIdSchema,
  SDPDescriptionSchema,
  validatePayload,
} from "../schemas";

describe("Shared Schemas & Validation Hardening", () => {
  describe("FileMetadataSchema", () => {
    it("accepts valid metadata with exact attributes", () => {
      const parsed = FileMetadataSchema.parse({
        name: "document.pdf",
        size: 1024 * 1024,
        type: "application/pdf",
      });
      expect(parsed).toEqual({
        name: "document.pdf",
        size: 1024 * 1024,
        type: "application/pdf",
      });
    });

    it("trims whitespace from filename", () => {
      const parsed = FileMetadataSchema.parse({
        name: "   archive.zip   ",
        size: 500,
        type: "application/zip",
      });
      expect(parsed.name).toBe("archive.zip");
    });

    it("accepts 0-byte file metadata as a valid streaming edge case", () => {
      const parsed = FileMetadataSchema.parse({
        name: "empty.txt",
        size: 0,
        type: "text/plain",
      });
      expect(parsed.size).toBe(0);
    });

    it("accepts arbitrarily large file sizes without restriction", () => {
      const veryLargeSize = 100 * 1024 * 1024 * 1024; // 100 GB
      const parsed = FileMetadataSchema.parse({
        name: "massive-backup.iso",
        size: veryLargeSize,
        type: "application/octet-stream",
      });
      expect(parsed.size).toBe(veryLargeSize);
    });

    it("rejects path traversal sequences and directory separators in filenames", () => {
      const dangerousNames = [
        "../secret.txt",
        "..\\secret.txt",
        "/etc/passwd",
        "nested/file.txt",
        "nested\\file.txt",
        "C:\\Windows\\System32\\cmd.exe",
        "..",
        "folder/../file.txt",
      ];

      for (const name of dangerousNames) {
        const result = FileMetadataSchema.safeParse({
          name,
          size: 1024,
          type: "text/plain",
        });
        expect(result.success, `Expected filename "${name}" to be rejected`).toBe(false);
      }
    });

    it("rejects filenames exceeding 255 characters", () => {
      const longName = "a".repeat(256) + ".txt";
      expect(() =>
        FileMetadataSchema.parse({
          name: longName,
          size: 1024,
          type: "text/plain",
        }),
      ).toThrowError(/cannot exceed 255 characters/);
    });

    it("rejects negative, float, or invalid sizes", () => {
      const invalidSizes = [-1, 10.5, Number.NaN, Number.POSITIVE_INFINITY];
      for (const size of invalidSizes) {
        const result = FileMetadataSchema.safeParse({
          name: "test.bin",
          size,
          type: "application/octet-stream",
        });
        expect(result.success).toBe(false);
      }
    });

    it("rejects empty or whitespace-only MIME types", () => {
      expect(() =>
        FileMetadataSchema.parse({
          name: "file.bin",
          size: 100,
          type: "    ",
        }),
      ).toThrowError(/MIME type cannot be empty/);
    });
  });

  describe("FileControlMessageSchema", () => {
    it("validates file-offer control message with full metadata", () => {
      const msg = {
        kind: "file-offer" as const,
        metadata: {
          name: "report.pdf",
          size: 2048,
          type: "application/pdf",
        },
      };
      const parsed = FileControlMessageSchema.parse(msg);
      expect(parsed).toEqual(msg);
    });

    it("validates receiver-ready, pause, and resume control messages", () => {
      expect(FileControlMessageSchema.parse({ kind: "receiver-ready" })).toEqual({ kind: "receiver-ready" });
      expect(FileControlMessageSchema.parse({ kind: "pause" })).toEqual({ kind: "pause" });
      expect(FileControlMessageSchema.parse({ kind: "resume" })).toEqual({ kind: "resume" });
    });

    it("validates cancel message with optional reason", () => {
      const withReason = FileControlMessageSchema.parse({
        kind: "cancel",
        reason: "User closed prompt",
      });
      expect(withReason).toEqual({ kind: "cancel", reason: "User closed prompt" });

      const withoutReason = FileControlMessageSchema.parse({ kind: "cancel" });
      expect(withoutReason).toEqual({ kind: "cancel" });
    });

    it("validates error control message with required message string", () => {
      const err = FileControlMessageSchema.parse({
        kind: "error",
        message: "DataChannel write failure",
      });
      expect(err).toEqual({ kind: "error", message: "DataChannel write failure" });
    });

    it("rejects unrecognized control kind or missing payload fields", () => {
      expect(FileControlMessageSchema.safeParse({ kind: "unknown-kind" }).success).toBe(false);
      expect(FileControlMessageSchema.safeParse({ kind: "file-offer" }).success).toBe(false);
      expect(FileControlMessageSchema.safeParse({ kind: "error" }).success).toBe(false);
    });
  });

  describe("SDPDescriptionSchema", () => {
    it("accepts standard SDP offer and answer descriptors", () => {
      const offer = { type: "offer" as const, sdp: "v=0\r\no=alice" };
      expect(SDPDescriptionSchema.parse(offer)).toEqual(offer);

      const answer = { type: "answer" as const, sdp: "v=0\r\no=bob" };
      expect(SDPDescriptionSchema.parse(answer)).toEqual(answer);

      const pranswer = { type: "pranswer" as const };
      expect(SDPDescriptionSchema.parse(pranswer)).toEqual(pranswer);

      const rollback = { type: "rollback" as const };
      expect(SDPDescriptionSchema.parse(rollback)).toEqual(rollback);
    });

    it("rejects invalid SDP type", () => {
      expect(SDPDescriptionSchema.safeParse({ type: "invalid-type", sdp: "v=0" }).success).toBe(false);
    });

    it("rejects SDP exceeding the 15KB boundary limit", () => {
      const oversizedSdp = "a".repeat(15361);
      expect(SDPDescriptionSchema.safeParse({ type: "offer", sdp: oversizedSdp }).success).toBe(false);
    });

    it("rejects unexpected properties in strict mode", () => {
      const payload = { type: "offer", sdp: "v=0", injectedField: "malicious" };
      expect(SDPDescriptionSchema.safeParse(payload).success).toBe(false);
    });
  });

  describe("PeerSchema & PeerIdSchema", () => {
    const validPeerId = "01920000-0000-7000-8000-000000000001";

    it("accepts valid RFC 9562 UUIDv7 peer identifier", () => {
      const parsed = PeerIdSchema.parse(validPeerId);
      expect(parsed).toBe(validPeerId);
    });

    it("rejects non-UUIDv7 identifiers", () => {
      // UUIDv4 has version 4, not 7
      const v4 = "550e8400-e29b-41d4-a716-446655440000";
      expect(PeerIdSchema.safeParse(v4).success).toBe(false);
      expect(PeerIdSchema.safeParse("not-a-uuid").success).toBe(false);
    });

    it("validates full Peer record and rejects undeclared extra properties", () => {
      const validPeer = {
        id: validPeerId,
        timestamp: new Date().toISOString(),
        personalRoomId: "ABC234",
        name: "Alice",
      };
      const parsed = PeerSchema.parse(validPeer);
      expect(parsed.name).toBe("Alice");
      expect(parsed.personalRoomId).toBe("ABC234");

      const withInjected = { ...validPeer, role: "admin" };
      expect(PeerSchema.safeParse(withInjected).success).toBe(false);
    });
  });

  describe("PeerNameSchema", () => {
    it("accepts valid names with alphanumeric characters, spaces, hyphens, and underscores", () => {
      const validNames = ["Alice", "Bob-123", "User_Name 99", "Dev-Workstation_1"];
      for (const name of validNames) {
        expect(PeerNameSchema.parse(name)).toBe(name);
      }
    });

    it("rejects whitespace-only or empty names", () => {
      const invalid = ["", "   ", "\t\n"];
      for (const name of invalid) {
        expect(PeerNameSchema.safeParse(name).success).toBe(false);
      }
    });

    it("rejects characters outside allowed regex pattern (e.g. HTML tags, script injection)", () => {
      const illegalNames = [
        "<script>alert(1)</script>",
        "user@domain.com",
        "alice; rm -rf /",
        "name*test",
        "name/test",
      ];
      for (const name of illegalNames) {
        expect(PeerNameSchema.safeParse(name).success).toBe(false);
      }
    });

    it("rejects names longer than 50 characters", () => {
      const longName = "a".repeat(51);
      expect(PeerNameSchema.safeParse(longName).success).toBe(false);
    });
  });

  describe("RoomIdSchema & ConnectToRoomSchema", () => {
    it("accepts exactly 6 uppercase alphanumeric characters", () => {
      expect(RoomIdSchema.parse("ABC123")).toBe("ABC123");
    });

    it("ConnectToRoomSchema trims and uppercases lowercase input", () => {
      expect(ConnectToRoomSchema.parse("  abc123  ")).toBe("ABC123");
    });

    it("rejects room IDs with incorrect lengths", () => {
      for (const id of ["AB12", "ABC1234", ""]) {
        expect(RoomIdSchema.safeParse(id).success).toBe(false);
      }
    });

    it("rejects non-alphanumeric room IDs", () => {
      for (const id of ["AB-123", "AB 123", "AB!@12"]) {
        expect(RoomIdSchema.safeParse(id).success).toBe(false);
      }
    });
  });

  describe("IceCandidateSchema", () => {
    it("accepts valid ICE candidate with standard fields", () => {
      const candidate = {
        candidate: "candidate:1 1 UDP 2122252543 192.168.1.1 50000 typ host",
        sdpMid: "0",
        sdpMLineIndex: 0,
      };
      expect(IceCandidateSchema.parse(candidate)).toEqual(candidate);
    });

    it("accepts end-of-candidate marker with only sdpMid or sdpMLineIndex", () => {
      expect(IceCandidateSchema.parse({ sdpMid: "0", sdpMLineIndex: 0 })).toEqual({
        sdpMid: "0",
        sdpMLineIndex: 0,
      });
      expect(IceCandidateSchema.parse({ sdpMid: "0" })).toEqual({ sdpMid: "0" });
      expect(IceCandidateSchema.parse({ sdpMLineIndex: 1 })).toEqual({ sdpMLineIndex: 1 });
    });

    it("rejects completely empty object {}", () => {
      expect(IceCandidateSchema.safeParse({}).success).toBe(false);
    });

    it("rejects candidate string exceeding 1KB limit", () => {
      expect(IceCandidateSchema.safeParse({ candidate: "c".repeat(1025) }).success).toBe(false);
    });
  });

  describe("Binary Data Chunk Bounds", () => {
    it("validates size bounds (1 byte to 64 KB)", () => {
      expect(DataChunkSizeSchema.parse(MIN_CHUNK_SIZE)).toBe(MIN_CHUNK_SIZE);
      expect(DataChunkSizeSchema.parse(MAX_CHUNK_SIZE)).toBe(MAX_CHUNK_SIZE);
      expect(DataChunkSizeSchema.safeParse(0).success).toBe(false);
      expect(DataChunkSizeSchema.safeParse(MAX_CHUNK_SIZE + 1).success).toBe(false);
    });

    it("validates Uint8Array and ArrayBuffer binary payloads", () => {
      const validUint8 = new Uint8Array(16 * 1024);
      expect(DataChunkPayloadSchema.parse(validUint8)).toBe(validUint8);

      const validBuffer = new ArrayBuffer(16 * 1024);
      expect(DataChunkPayloadSchema.parse(validBuffer)).toBe(validBuffer);

      // Edge cases: 0 bytes and oversized
      expect(DataChunkPayloadSchema.safeParse(new Uint8Array(0)).success).toBe(false);
      expect(DataChunkPayloadSchema.safeParse(new Uint8Array(MAX_CHUNK_SIZE + 1)).success).toBe(false);
      expect(DataChunkPayloadSchema.safeParse("not a buffer").success).toBe(false);
    });
  });

  describe("ClientErrorReportSchema", () => {
    it("accepts valid client error reports", () => {
      const report = {
        eventType: "connect_error" as const,
        reason: "Connection refused",
        isRelay: false,
        details: "Timed out after 5000ms",
      };
      expect(ClientErrorReportSchema.parse(report)).toEqual(report);
    });

    it("rejects invalid eventType", () => {
      expect(
        ClientErrorReportSchema.safeParse({
          eventType: "unknown_error",
          reason: "Something happened",
        }).success,
      ).toBe(false);
    });

    it("enforces length constraints on reason and details", () => {
      expect(
        ClientErrorReportSchema.safeParse({
          eventType: "icecandidateerror",
          reason: "x".repeat(257),
        }).success,
      ).toBe(false);
    });
  });

  describe("validatePayload & formatValidationError", () => {
    it("returns data on successful validation", () => {
      const result = validatePayload(RoomIdSchema, "XYZ789");
      expect(result).toEqual({ success: true, data: "XYZ789" });
    });

    it("returns formatted error message on validation failure", () => {
      const result = validatePayload(RoomIdSchema, "invalid");
      expect(result.success).toBe(false);
      if (!result.success) {
        const message = formatValidationError(result.error);
        expect(typeof message).toBe("string");
        expect(message.length).toBeGreaterThan(0);
      }
    });
  });
});
