import type { PeerId } from "@peario/shared";

import type { FileMetadata } from "./FileMetadata";

export type TransferStatus = "pending_acceptance" | "transferring" | "paused" | "completed" | "failed";

export interface FileTransferRecord {
  id: string;
  peerId: PeerId;
  fileMetadata: FileMetadata;
  direction: "incoming" | "outgoing";
  status: TransferStatus;
  timestamp: number;
  error?: string;
}
