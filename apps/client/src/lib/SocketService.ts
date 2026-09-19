import { formatValidationError, type Peer, PeerSchema, validatePayload } from "@peario/shared";
import { io, Socket } from "socket.io-client";

import { TIMEOUTS_MS } from "../constants/index.ts";
import { reportClientError } from "./errorReporter";
import { socketLogger } from "./logger";

export function resolveSignalingServerUrl(): string {
  const envUrl = import.meta.env.VITE_SIGNALING_SERVER_URL;
  if (typeof envUrl === "string" && envUrl.trim() !== "") {
    return envUrl.trim();
  }

  if (import.meta.env.PROD) {
    const prodDefault = "https://signal.peario.app";
    socketLogger.error(
      "CONFIGURATION ERROR: VITE_SIGNALING_SERVER_URL is not set in production build! Defaulting to:",
      prodDefault,
    );
    return prodDefault;
  }

  // In development, route signaling through the Vite proxy on the same origin/port
  // to avoid cross-port self-signed certificate untrusted errors in Firefox.
  return "";
}

const URL = resolveSignalingServerUrl();

class SocketService {
  public socket: Socket;
  private identityPromise: Promise<Peer> | null = null;
  private connectionErrorListeners: Set<(error: Error) => void> = new Set();
  private reconnectAttemptListeners: Set<(attemptNumber: number) => void> = new Set();

  constructor() {
    this.socket = io(URL, {
      path: "/socket.io/",
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10000,
      randomizationFactor: 0.5,
      timeout: TIMEOUTS_MS.SOCKET_CONNECT,
      transports: ["websocket", "polling"],
    });

    this.socket.on("connect", () => {
      socketLogger.info("Connected to signaling server");
      socketLogger.debug(`Socket ID: ${this.socket.id}`);
    });

    this.socket.on("disconnect", (reason) => {
      socketLogger.info(`Disconnected from signaling server: ${reason}`);
      this.identityPromise = null;
      if (reason !== "io client disconnect") {
        void reportClientError({
          eventType: "disconnect",
          reason,
        });
      }
    });

    this.socket.on("connect_error", (error) => {
      socketLogger.error("Connection error:", error.message);
      this.connectionErrorListeners.forEach((listener) => listener(error));
      void reportClientError({
        eventType: "connect_error",
        reason: error.message,
      });
    });

    this.socket.io.on("reconnect_attempt", (attemptNumber) => {
      socketLogger.debug(`Reconnection attempt ${attemptNumber}`);
      this.reconnectAttemptListeners.forEach((listener) => listener(attemptNumber));
    });

    this.socket.io.on("reconnect_failed", () => {
      socketLogger.error("Failed to reconnect to signaling server");
      const error = new Error("Failed to reconnect to signaling server");
      this.connectionErrorListeners.forEach((listener) => listener(error));
    });
  }

  onConnectionError(listener: (error: Error) => void): () => void {
    this.connectionErrorListeners.add(listener);
    return () => {
      this.connectionErrorListeners.delete(listener);
    };
  }

  onReconnectAttempt(listener: (attemptNumber: number) => void): () => void {
    this.reconnectAttemptListeners.add(listener);
    return () => {
      this.reconnectAttemptListeners.delete(listener);
    };
  }

  connect() {
    socketLogger.debug("Connecting to signaling server...");
    this.socket.connect();
  }

  disconnect() {
    socketLogger.debug("Disconnecting from signaling server...");
    this.socket.disconnect();
    this.identityPromise = null;
  }

  getIdentity(name: string): Promise<Peer> {
    if (this.identityPromise) {
      return this.identityPromise;
    }

    socketLogger.debug(`Requesting identity for name: ${name}`);

    this.identityPromise = new Promise((resolve, reject) => {
      const handleIdentityConfirmed = (data: unknown) => {
        this.socket.off("identity-confirmed", handleIdentityConfirmed);

        const validation = validatePayload(PeerSchema, data);
        if (!validation.success) {
          socketLogger.error(`Invalid identity-confirmed payload: ${formatValidationError(validation.error)}`);
          this.identityPromise = null;
          reject(new Error("Invalid identity response from server"));
          return;
        }

        socketLogger.info(`Identity confirmed: ${validation.data.name} (${validation.data.id})`);
        socketLogger.trace("Identity details:", validation.data);
        resolve(validation.data);
      };

      this.socket.on("identity-confirmed", handleIdentityConfirmed);

      if (this.socket.connected) {
        this.socket.emit("self-identify", { name });
      } else {
        this.socket.once("connect", () => {
          this.socket.emit("self-identify", { name });
        });
      }
    });

    return this.identityPromise;
  }

  resetIdentity(): void {
    this.identityPromise = null;
  }
}

export const socketService = new SocketService();
export const socket: Socket = socketService.socket;
