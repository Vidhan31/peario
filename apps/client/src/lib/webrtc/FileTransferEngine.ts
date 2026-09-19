import type { FileMetadata, PeerId } from "@peario/shared";

import type { ReceiverProgress, SenderProgress } from "@/types/TransferProgress";

import { TIMEOUTS_MS } from "@/constants/index.ts";
import { Pausable } from "@/utils/FileUtils";

import type { PeerTransport } from "./PeerTransport";

import { createChunkTransformStream } from "../ChunkTransformStream";
import { fileLogger } from "../logger";
import { createProgressTransformStream } from "../ProgressTransformStream";
import { createDataChannelWritableStream } from "../WriteableDataChannelStream";

export const BACKPRESSURE_PAUSE_THRESHOLD = 32;
export const BACKPRESSURE_RESUME_THRESHOLD = 8;

export interface SendFileOptions {
  onProgress?: (progress: SenderProgress) => void;
  signal?: AbortSignal;
  /**
   * How long to wait for the receiver to accept before failing. Defaults to
   * 0 (no timeout): the receiver may take as long as needed. Pass a positive
   * value only to bound the wait (e.g. in tests).
   */
  timeoutMs?: number;
  /**
   * Fail the transfer when no bytes are sent for this long. User pauses are
   * excluded. Defaults to TIMEOUTS_MS.TRANSFER_STALL.
   */
  stallTimeoutMs?: number;
}

export interface ReceiveFileOptions {
  onProgress?: (progress: ReceiverProgress) => void;
  signal?: AbortSignal;
  /**
   * Fail the transfer when received chunks stop draining to disk for this
   * long. Defaults to TIMEOUTS_MS.TRANSFER_STALL.
   */
  stallTimeoutMs?: number;
}

export interface IncomingTransferSession {
  metadata: FileMetadata;
  accept: (
    writable: FileSystemWritableFileStream | WritableStream<Uint8Array>,
    options?: ReceiveFileOptions,
  ) => Promise<void>;
  reject: (reason?: string) => void;
}

export class FileTransferEngine {
  public readonly peerId: PeerId;
  public readonly transport: PeerTransport;

  private activeBackpressurePausable: Pausable | null = null;
  private activeUserPausable: Pausable | null = null;
  private isDestroyed = false;

  constructor(peerId: PeerId, transport: PeerTransport) {
    this.peerId = peerId;
    this.transport = transport;

    this.bindTransportControl();
  }

  /**
   * Sender-side user pause. Purely local: freezes the chunk pipeline by
   * engaging the user gate. The receiver just idles (no chunks arrive) and
   * needs no UI change. Kept separate from the backpressure gate so a
   * receiver-driven resume can never unblock a user-paused transfer.
   * Idempotent; no-ops when no send is in flight.
   */
  public pauseSending(): void {
    this.activeUserPausable?.pause();
    fileLogger.debug(`[FileTransferEngine] User paused send to peer ${this.peerId}`);
  }

  /**
   * Sender-side user resume. Releases only the user gate; if receiver
   * backpressure is still engaged the transfer stays paused until the
   * receiver drains. Idempotent.
   */
  public resumeSending(): void {
    this.activeUserPausable?.resume();
    fileLogger.debug(`[FileTransferEngine] User resumed send to peer ${this.peerId}`);
  }

  public get isUserPaused(): boolean {
    return this.activeUserPausable?.isPaused() ?? false;
  }

  private bindTransportControl() {
    this.transport.onFileControl((control) => {
      if (control.kind === "pause") {
        fileLogger.debug(`[FileTransferEngine] Received pause from peer ${this.peerId}`);
        this.activeBackpressurePausable?.pause();
      } else if (control.kind === "resume") {
        fileLogger.debug(`[FileTransferEngine] Received resume from peer ${this.peerId}`);
        this.activeBackpressurePausable?.resume();
      }
    });
  }

  public onIncomingOffer = (handler: (session: IncomingTransferSession) => void): (() => void) => {
    return this.transport.onFileControl((control) => {
      if (control.kind === "file-offer") {
        const metadata = control.metadata;
        fileLogger.info(`[FileTransferEngine] Received file offer: ${metadata.name} (${metadata.size} bytes)`);

        let handled = false;

        const session: IncomingTransferSession = {
          metadata,
          accept: async (writable, options) => {
            if (handled) throw new Error("File offer has already been handled");
            handled = true;
            return this.receiveFile(metadata, writable, options);
          },
          reject: (reason) => {
            if (handled) return;
            handled = true;
            this.transport.sendFileControl({ kind: "cancel", reason });
          },
        };

        handler(session);
      }
    });
  };

  public sendFile = async (file: File, options: SendFileOptions = {}): Promise<void> => {
    const { onProgress, signal, timeoutMs = 0, stallTimeoutMs = TIMEOUTS_MS.TRANSFER_STALL } = options;

    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }

    fileLogger.info(
      `[FileTransferEngine] Starting transfer to ${this.peerId}: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`,
    );

    const pausable = new Pausable();
    const userPausable = new Pausable();
    this.activeBackpressurePausable = pausable;
    this.activeUserPausable = userPausable;

    const metadata: FileMetadata = {
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
    };

    try {
      await new Promise<void>((resolve, reject) => {
        let timer: ReturnType<typeof setTimeout> | null = null;

        const cleanup = () => {
          if (timer) clearTimeout(timer);
          unsubscribe();
          if (signal) signal.removeEventListener("abort", onAbort);
        };

        const onAbort = () => {
          cleanup();
          this.transport.sendFileControl({ kind: "cancel", reason: "Sender aborted" });
          reject(new DOMException("Aborted", "AbortError"));
        };

        if (signal) {
          signal.addEventListener("abort", onAbort);
        }

        const unsubscribe = this.transport.onFileControl((ctrl) => {
          if (ctrl.kind === "receiver-ready") {
            cleanup();
            fileLogger.debug(`[FileTransferEngine] Receiver ready for ${file.name}`);
            resolve();
          } else if (ctrl.kind === "cancel") {
            cleanup();
            // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty reason should also fall back to "unknown" in user-facing errors
            reject(new Error(`Receiver rejected file transfer: ${ctrl.reason || "unknown"}`));
          } else if (ctrl.kind === "error") {
            cleanup();
            reject(new Error(`Receiver error: ${ctrl.message}`));
          }
        });

        if (timeoutMs > 0) {
          timer = setTimeout(() => {
            cleanup();
            reject(new Error(`Timeout waiting for receiver to accept "${file.name}"`));
          }, timeoutMs);
        }

        this.transport.sendFileOffer(metadata);
      });

      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }

      // Listen for receiver cancel/error mid-stream so a receiver-side abort
      // (e.g. browser download cancelled, writer.write() throwing) unblocks
      // the sender instead of leaving it paused forever.
      // Holder object (not a plain let) so narrowing survives closure writes.
      const remoteFailure: { error: Error | null } = { error: null };
      const transferAbort = new AbortController();
      const forwardUserAbort = () => {
        transferAbort.abort(signal?.reason ?? new DOMException("Aborted", "AbortError"));
      };
      if (signal) {
        signal.addEventListener("abort", forwardUserAbort);
      }

      const unsubscribeTransferCtrl = this.transport.onFileControl((ctrl) => {
        if (ctrl.kind === "cancel") {
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty reason should also fall back to "unknown" in user-facing errors
          remoteFailure.error = tagRemote(new Error(`Receiver cancelled transfer: ${ctrl.reason || "unknown"}`));
          // Unblock both gates so pipeTo can observe the abort even when the
          // user paused the transfer before the receiver cancelled.
          pausable.resume();
          userPausable.resume();
          transferAbort.abort(remoteFailure.error);
        } else if (ctrl.kind === "error") {
          remoteFailure.error = tagRemote(new Error(`Receiver error: ${ctrl.message}`));
          pausable.resume();
          userPausable.resume();
          transferAbort.abort(remoteFailure.error);
        }
      });

      // Stall watchdog: fail visibly if backpressure pause does not resume within the stall window.
      let lastSendProgressAt = Date.now();
      const stallCheckIntervalMs = Math.max(50, Math.min(5000, Math.floor(stallTimeoutMs / 4)));
      const stallTimer = setInterval(() => {
        if (remoteFailure.error || userPausable.isPaused()) return;
        if (Date.now() - lastSendProgressAt > stallTimeoutMs) {
          const stalledFor = stallTimeoutMs < 1000 ? `${stallTimeoutMs}ms` : `${Math.round(stallTimeoutMs / 1000)}s`;
          remoteFailure.error = new Error(
            `Transfer stalled: no data sent for ${stalledFor}. The receiver may have blocked the download — cancel and try again.`,
          );
          fileLogger.warn(`[FileTransferEngine] ${remoteFailure.error.message} (peer ${this.peerId})`);
          pausable.resume();
          userPausable.resume();
          transferAbort.abort(remoteFailure.error);
        }
      }, stallCheckIntervalMs);

      try {
        await file
          .stream()
          .pipeThrough(createChunkTransformStream())
          .pipeThrough(
            createProgressTransformStream((bytesTransferred) => {
              lastSendProgressAt = Date.now();
              onProgress?.({
                bytesTransferred,
                bytesBuffered: this.transport.dataBufferedAmount,
                timestamp: Date.now(),
              });
            }),
          )
          .pipeTo(
            createDataChannelWritableStream(this.transport.rawFileDataChannel, {
              pausables: [pausable, userPausable],
              signal: transferAbort.signal,
            }),
            { signal: transferAbort.signal },
          );
      } catch (pipeErr: unknown) {
        // Prefer the receiver's reason over a generic AbortError from pipeTo.
        throw remoteFailure.error ?? (pipeErr instanceof Error ? pipeErr : new Error(String(pipeErr)));
      } finally {
        clearInterval(stallTimer);
        unsubscribeTransferCtrl();
        if (signal) signal.removeEventListener("abort", forwardUserAbort);
      }

      fileLogger.info(`[FileTransferEngine] Completed transfer: ${file.name}`);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      fileLogger.error(`[FileTransferEngine] Transfer failed for ${file.name}:`, error.message);
      if (error instanceof Error && (error as { __remoteCancel?: boolean }).__remoteCancel) {
        // Failure already originated from the receiver; don't bounce an error back.
        throw error;
      }
      try {
        if (signal?.aborted || error.name === "AbortError") {
          this.transport.sendFileControl({ kind: "cancel", reason: "Sender aborted" });
        } else {
          this.transport.sendFileControl({ kind: "error", message: error.message });
        }
      } catch {
        // Ignore: control channel may already be closed.
      }
      throw error;
    } finally {
      this.activeBackpressurePausable = null;
      this.activeUserPausable = null;
    }
  };

  private async receiveFile(
    metadata: FileMetadata,
    destination: FileSystemWritableFileStream | WritableStream<Uint8Array>,
    options: ReceiveFileOptions = {},
  ): Promise<void> {
    const { onProgress, signal, stallTimeoutMs = TIMEOUTS_MS.TRANSFER_STALL } = options;

    if (signal?.aborted) {
      this.transport.sendFileControl({ kind: "cancel", reason: "Receiver aborted" });
      throw new DOMException("Aborted", "AbortError");
    }

    const writer = destination.getWriter();

    if (metadata.size === 0) {
      this.transport.sendFileControl({ kind: "receiver-ready" });
      try {
        await Promise.race([writer.close(), new Promise((_, reject) => setTimeout(reject, 5000))]);
      } catch (err) {
        fileLogger.warn(`[FileTransferEngine] writer.close() warning for ${metadata.name}:`, err);
      } finally {
        try {
          writer.releaseLock();
        } catch {
          // releaseLock throws if already released - safe to ignore
        }
      }
      fileLogger.info(`[FileTransferEngine] Successfully received empty file: ${metadata.name}`);
      return;
    }

    let bytesReceived = 0;
    let isPaused = false;
    let pendingWrites = 0;
    let backpressurePaused = false;
    let writeQueue: Promise<void> = Promise.resolve();

    return new Promise<void>((resolve, reject) => {
      let isCompleted = false;
      let lastDrainAt = Date.now();
      let stallTimer: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (isCompleted) return;
        isCompleted = true;
        if (stallTimer) {
          clearInterval(stallTimer);
          stallTimer = null;
        }
        pendingWrites = 0;
        backpressurePaused = false;
        unsubscribeData();
        unsubscribeCtrl();
        if (signal) signal.removeEventListener("abort", onAbort);
      };

      const closeWriterAndSucceed = async () => {
        cleanup();
        try {
          await Promise.race([
            writer.close(),
            new Promise((_, reject) =>
              setTimeout(() => {
                reject(new Error("Timeout waiting for writer.close()"));
              }, TIMEOUTS_MS.WRITER_CLOSE),
            ),
          ]);
        } catch (err) {
          fileLogger.warn(`[FileTransferEngine] writer.close() warning for ${metadata.name}:`, err);
        } finally {
          try {
            writer.releaseLock();
          } catch {
            // releaseLock throws if already released - safe to ignore
          }
        }
        fileLogger.info(`[FileTransferEngine] Successfully received file: ${metadata.name}`);
        resolve();
      };

      const closeWriterAndFail = async (err: Error) => {
        cleanup();
        pendingWrites = 0;
        backpressurePaused = false;
        // writer.abort() can pend forever behind an in-flight write that never
        // settles (e.g. a stalled service-worker download leg). Race it so a
        // dead sink cannot wedge the failure path itself.
        let abortTimer: ReturnType<typeof setTimeout> | undefined;
        const abortTimeout = new Promise<never>((_, reject) => {
          abortTimer = setTimeout(() => {
            reject(new Error("Timeout aborting writer"));
          }, TIMEOUTS_MS.WRITER_ABORT);
        });
        try {
          await Promise.race([writer.abort(err), abortTimeout]);
        } catch {
          // abort throws if writer already errored - safe to ignore
        } finally {
          // clearTimeout is a no-op for undefined, which covers the race where
          // abort() settled first and the timer already fired.
          clearTimeout(abortTimer);
          try {
            writer.releaseLock();
          } catch {
            // releaseLock throws if already released - safe to ignore
          }
        }
        reject(err);
      };

      const onAbort = () => {
        this.transport.sendFileControl({ kind: "cancel", reason: "Receiver aborted" });
        void closeWriterAndFail(new DOMException("Aborted", "AbortError"));
      };

      if (signal) {
        signal.addEventListener("abort", onAbort);
      }

      const unsubscribeCtrl = this.transport.onFileControl((ctrl) => {
        if (ctrl.kind === "cancel") {
          // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- empty reason should also fall back to "unknown" in user-facing errors
          void closeWriterAndFail(new Error(`Sender cancelled transfer: ${ctrl.reason || "unknown"}`));
        } else if (ctrl.kind === "error") {
          void closeWriterAndFail(new Error(`Sender error: ${ctrl.message}`));
        }
      });

      fileLogger.debug(`[FileTransferEngine] Registering onFileData listener for ${metadata.name}`);
      const unsubscribeData = this.transport.onFileData((chunk) => {
        if (isCompleted) {
          fileLogger.trace(`[FileTransferEngine onFileData] Ignored chunk because isCompleted=true`);
          return;
        }

        pendingWrites++;
        if (pendingWrites >= BACKPRESSURE_PAUSE_THRESHOLD && !backpressurePaused) {
          backpressurePaused = true;
          this.transport.sendFileControl({ kind: "pause" });
          fileLogger.trace(`[FileTransferEngine] Pending writes reached threshold (${pendingWrites}). Sent pause.`);
        }

        // Strictly serialize writes in a promise queue to eliminate race conditions
        writeQueue = writeQueue.then(async () => {
          if (isCompleted) return;

          try {
            const uint8 = new Uint8Array(chunk);
            const chunkSize = uint8.byteLength;
            await writer.write(uint8);
            bytesReceived += chunkSize;
            lastDrainAt = Date.now();

            onProgress?.({
              bytesTransferred: bytesReceived,
              timestamp: Date.now(),
            });

            if (metadata.size > 0 && bytesReceived >= metadata.size) {
              await closeWriterAndSucceed();
              return;
            }

            const desiredSize = writer.desiredSize;
            const isBufferFull = desiredSize !== null && desiredSize <= 0;

            if (isBufferFull && !isPaused) {
              isPaused = true;
              this.transport.sendFileControl({ kind: "pause" });
              fileLogger.trace(`[FileTransferEngine] Disk buffer full (${desiredSize}). Sent pause.`);

              writer.ready
                .then(() => {
                  if (isPaused && !isCompleted) {
                    isPaused = false;
                    this.transport.sendFileControl({ kind: "resume" });
                    fileLogger.trace("[FileTransferEngine] Disk buffer drained. Sent resume.");
                  }
                })
                .catch((readyErr: unknown) => {
                  // The sink errored while paused (e.g. browser blocked download); cancel sender to unblock.
                  if (isCompleted) return;
                  const error = readyErr instanceof Error ? readyErr : new Error("Download stream failed while paused");
                  fileLogger.error("[FileTransferEngine] writer.ready rejected, failing transfer:", error.message);
                  try {
                    this.transport.sendFileControl({ kind: "cancel", reason: error.message });
                  } catch {
                    // Ignore: control channel may already be closed.
                  }
                  void closeWriterAndFail(error);
                });
            }

            pendingWrites--;
            if (backpressurePaused && pendingWrites <= BACKPRESSURE_RESUME_THRESHOLD) {
              backpressurePaused = false;
              this.transport.sendFileControl({ kind: "resume" });
              fileLogger.trace(`[FileTransferEngine] Pending writes drained to ${pendingWrites}. Sent resume.`);
            }
          } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            fileLogger.error(`[FileTransferEngine] Error writing chunk:`, error.message);
            // Cancel sender on local write failure rather than pausing indefinitely.
            try {
              this.transport.sendFileControl({ kind: "cancel", reason: error.message });
            } catch {
              // Ignore: control channel may already be closed.
            }
            void closeWriterAndFail(error);
          }
        });
      });

      fileLogger.debug(`[FileTransferEngine] Signaling sender: receiver-ready for ${metadata.name}`);

      // Drain watchdog: fail visibly if received chunks do not reach disk within the stall window.
      const stallCheckIntervalMs = Math.max(50, Math.min(5000, Math.floor(stallTimeoutMs / 4)));
      stallTimer = setInterval(() => {
        if (isCompleted || pendingWrites === 0) return;
        if (Date.now() - lastDrainAt > stallTimeoutMs) {
          const error = new Error(
            `Receiver stalled: download is not draining (${pendingWrites} chunks waiting). The browser may have blocked the download — cancel and try again.`,
          );
          fileLogger.warn(`[FileTransferEngine] ${error.message} (${metadata.name})`);
          try {
            this.transport.sendFileControl({ kind: "cancel", reason: error.message });
          } catch {
            // Ignore: control channel may already be closed.
          }
          void closeWriterAndFail(error);
        }
      }, stallCheckIntervalMs);

      this.transport.sendFileControl({ kind: "receiver-ready" });
    });
  }

  public destroy = (): void => {
    if (this.isDestroyed) return;
    this.isDestroyed = true;
    // Release any gated write so a paused pipeTo can settle instead of hanging.
    this.activeBackpressurePausable?.resume();
    this.activeUserPausable?.resume();
    this.activeBackpressurePausable = null;
    this.activeUserPausable = null;
  };
}

/**
 * Tags an error as originating from the remote peer so the sender's catch
 * block knows not to bounce another error/cancel back (the receiver already
 * knows the transfer is dead).
 */
function tagRemote(error: Error): Error {
  (error as { __remoteCancel?: boolean }).__remoteCancel = true;
  return error;
}
