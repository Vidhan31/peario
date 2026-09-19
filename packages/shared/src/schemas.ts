import { z } from "zod";
import { fromError } from "zod-validation-error";

// Under strict CSP without 'unsafe-eval', disable Zod's `new Function("")` probe
z.config({ jitless: true });

/**
 * Peer identifiers are branded to prevent accidental room/peer mixups
 */
export const PeerIdSchema = z.uuidv7().brand<"PeerId">();

export type PeerId = z.infer<typeof PeerIdSchema>;

export const PEER_NAME_REGEX = /^[a-zA-Z0-9 _-]+$/;

/**
 * Peer name schema with whitespace trimming and character whitelisting
 */
export const PeerNameSchema = z
  .string()
  .trim()
  .min(1, "Name cannot be empty")
  .max(50, "Name cannot exceed 50 characters")
  .regex(PEER_NAME_REGEX, "Name can only contain alphanumeric characters, spaces, hyphens, and underscores");

export const ROOM_ID_REGEX = /^[A-Z0-9]{6}$/;

export const RoomIdSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(6, "Room ID must be exactly 6 characters")
  .regex(ROOM_ID_REGEX, "Room ID must be 6 alphanumeric characters");

export const PeerSchema = z
  .object({
    id: PeerIdSchema,
    timestamp: z.iso.datetime(),
    personalRoomId: RoomIdSchema.optional(),
    name: PeerNameSchema,
  })
  .strict();

export type Peer = z.infer<typeof PeerSchema>;

/**
 * SDP description schema - mirrors RTCSessionDescriptionInit
 * SDP blobs are typically 10-15KB max
 */
export const SDPDescriptionSchema = z
  .object({
    type: z.enum(["offer", "answer", "pranswer", "rollback"]),
    sdp: z.string().max(15360).optional(), // 15KB max
  })
  .strict();

export type SDPDescription = z.infer<typeof SDPDescriptionSchema>;

/**
 * ICE candidate schema - mirrors RTCIceCandidateInit
 * ICE candidates are typically under 1KB.
 * Enforces valid candidate strings or explicit end-of-candidate markers and rejects empty objects.
 */
export const IceCandidateSchema = z
  .object({
    candidate: z.string().max(1024).optional(), // 1KB max
    sdpMid: z.string().max(256).nullish(),
    sdpMLineIndex: z.number().int().nullish(),
    usernameFragment: z.string().max(256).nullish(),
  })
  .strict()
  .refine(
    (val) => {
      const hasCandidate = val.candidate !== undefined && val.candidate.trim().length > 0;
      const hasSdpMid = val.sdpMid !== undefined && val.sdpMid !== null;
      const hasMLine = val.sdpMLineIndex !== undefined && val.sdpMLineIndex !== null;
      const hasUsernameFragment = val.usernameFragment !== undefined && val.usernameFragment !== null;

      return hasCandidate || hasSdpMid || hasMLine || hasUsernameFragment;
    },
    { message: "ICE candidate object cannot be empty; must contain a candidate or sdpMid/sdpMLineIndex" },
  );

export type IceCandidate = z.infer<typeof IceCandidateSchema>;

export const SelfIdentifyDataSchema = z
  .object({
    customRoomId: RoomIdSchema.optional(),
    name: PeerNameSchema,
  })
  .strict();

export type SelfIdentifyData = z.infer<typeof SelfIdentifyDataSchema>;

export const ConnectToRoomSchema = RoomIdSchema;

export type ConnectToRoom = z.infer<typeof ConnectToRoomSchema>;

export const ConnectionRequestIncomingSchema = z
  .object({
    to: PeerSchema,
    isRoomConnection: z.boolean().optional(),
  })
  .strict();

export type ConnectionRequestIncoming = z.infer<typeof ConnectionRequestIncomingSchema>;

export const ConnectionRequestToSendSchema = ConnectionRequestIncomingSchema;
export type ConnectionRequestToSend = ConnectionRequestIncoming;

export const OfferIncomingSchema = z
  .object({
    to: PeerSchema,
    sdp: SDPDescriptionSchema,
  })
  .strict();

export type OfferIncoming = z.infer<typeof OfferIncomingSchema>;

export const OfferToSendSchema = z
  .object({
    to: PeerSchema,
    sdp: SDPDescriptionSchema.nullable(),
  })
  .strict();

export type OfferToSend = z.infer<typeof OfferToSendSchema>;

export const AnswerIncomingSchema = OfferIncomingSchema;
export type AnswerIncoming = z.infer<typeof AnswerIncomingSchema>;

export const AnswerToSendSchema = OfferToSendSchema;
export type AnswerToSend = z.infer<typeof AnswerToSendSchema>;

export const IceCandidateIncomingSchema = z
  .object({
    candidate: IceCandidateSchema,
    target: PeerSchema,
  })
  .strict();

export type IceCandidateIncoming = z.infer<typeof IceCandidateIncomingSchema>;

export const IceCandidateToSendSchema = IceCandidateIncomingSchema;
export type IceCandidateToSend = IceCandidateIncoming;

// Server-to-Client Event Payloads (with 'from' field added by server)
export const OfferSchema = z
  .object({
    from: PeerSchema,
    to: PeerSchema,
    sdp: SDPDescriptionSchema,
  })
  .strict();

export type Offer = z.infer<typeof OfferSchema>;

export const AnswerSchema = OfferSchema;
export type Answer = z.infer<typeof AnswerSchema>;

export const IceCandidateForPeerSchema = z
  .object({
    candidate: IceCandidateSchema,
    from: PeerSchema,
    target: PeerSchema,
  })
  .strict();

export type IceCandidateForPeer = z.infer<typeof IceCandidateForPeerSchema>;

export const ConnectionRequestSchema = z
  .object({
    from: PeerSchema,
    to: PeerSchema,
    isRoomConnection: z.boolean().optional(),
  })
  .strict();

export type ConnectionRequest = z.infer<typeof ConnectionRequestSchema>;

export const PeerLeftDataSchema = z
  .object({
    id: PeerIdSchema,
    timestamp: z.iso.datetime(),
  })
  .strict();

export type PeerLeftData = z.infer<typeof PeerLeftDataSchema>;

export const RateLimitedDataSchema = z
  .object({
    event: z.string().min(1),
    retryAfterMs: z.number().int().nonnegative(),
    message: z.string(),
  })
  .strict();

export type RateLimitedData = z.infer<typeof RateLimitedDataSchema>;

/** Maximum allowed transfer size per file (50 GB) */
export const MAX_FILE_SIZE_BYTES = 50 * 1024 * 1024 * 1024;

/**
 * Minimum and maximum allowable chunk payload sizes for WebRTC data transfers.
 * Standard WebRTC SCTP chunk size recommended bounds are 16 KB (16384 bytes) to 64 KB (65536 bytes).
 */
export const MIN_CHUNK_SIZE = 16 * 1024; // 16 KB
export const DEFAULT_CHUNK_SIZE = 16 * 1024; // 16 KB
export const MAX_CHUNK_SIZE = 64 * 1024; // 64 KB

export const DataChunkSizeSchema = z
  .number()
  .int()
  .min(1, "Chunk cannot be empty")
  .max(MAX_CHUNK_SIZE, `Chunk payload cannot exceed ${MAX_CHUNK_SIZE} bytes (64 KB)`);

export const DataChunkPayloadSchema = z.custom<ArrayBuffer | Uint8Array>(
  (val) => {
    if (val instanceof Uint8Array || val instanceof ArrayBuffer) {
      const byteLength = val.byteLength;
      return byteLength > 0 && byteLength <= MAX_CHUNK_SIZE;
    }
    return false;
  },
  {
    message: `Binary chunk must be an ArrayBuffer or Uint8Array with size between 1 and ${MAX_CHUNK_SIZE} bytes`,
  },
);

/**
 * File metadata schema for file transfers.
 * Rejects path traversal sequences, enforces size bounds, and requires non-empty MIME types.
 */
export const FileMetadataSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Filename cannot be empty")
      .max(255, "Filename cannot exceed 255 characters")
      .refine((val) => !val.includes("..") && !val.includes("/") && !val.includes("\\"), {
        message: "Filename must not contain path traversal sequences or directory separators",
      }),
    size: z
      .number()
      .int("File size must be an integer")
      .nonnegative("File size cannot be negative")
      .max(MAX_FILE_SIZE_BYTES, "File size exceeds 50 GB maximum per transfer"),
    type: z.string().trim().min(1, "MIME type cannot be empty").max(128, "MIME type is too long"),
  })
  .strict();

export type FileMetadata = z.infer<typeof FileMetadataSchema>;

export const FileControlMessageSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("file-offer"),
    metadata: FileMetadataSchema,
  }),
  z.object({
    kind: z.literal("receiver-ready"),
  }),
  z.object({
    kind: z.literal("pause"),
  }),
  z.object({
    kind: z.literal("resume"),
  }),
  z.object({
    kind: z.literal("cancel"),
    reason: z.string().optional(),
  }),
  z.object({
    kind: z.literal("error"),
    message: z.string(),
  }),
]);

export type FileControlMessage = z.infer<typeof FileControlMessageSchema>;

export const RTCIceServerSchema = z
  .object({
    urls: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
    username: z.string().optional(),
    credential: z.string().optional(),
    credentialType: z.enum(["password", "oauth"]).optional(),
  })
  .loose();

export type RTCIceServerType = z.infer<typeof RTCIceServerSchema>;

export const RTCIceServerListSchema = z.array(RTCIceServerSchema);

export type RTCIceServerListType = z.infer<typeof RTCIceServerListSchema>;

export const ClientErrorReportSchema = z
  .object({
    eventType: z.enum(["connect_error", "disconnect", "iceconnectionstatechange", "icecandidateerror"]),
    reason: z.string().max(256).optional(),
    isRelay: z.boolean().optional(),
    peerId: PeerIdSchema.optional(),
    details: z.string().max(512).optional(),
  })
  .strict();

export type ClientErrorReport = z.infer<typeof ClientErrorReportSchema>;

export type ValidationResult<T> = { success: true; data: T } | { success: false; error: z.ZodError };

export function validatePayload<T>(schema: z.ZodType<T>, data: unknown): ValidationResult<T> {
  const result = schema.safeParse(data);
  if (result.success) {
    return { success: true, data: result.data };
  }
  return { success: false, error: result.error };
}

export function formatValidationError(error: z.ZodError): string {
  return fromError(error).toString();
}
