export interface SenderProgress {
  bytesTransferred: number;
  bytesBuffered: number;
  timestamp: number;
}

export interface ReceiverProgress {
  bytesTransferred: number;
  timestamp: number;
}
