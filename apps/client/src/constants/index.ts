export const STORAGE_KEYS = {
  THEME: "ui-theme",
  USERNAME: "pear_username",
  TURN_ENABLED: "pear_turn_enabled",
} as const;

export const QUERY_PARAMS = {
  /** Room invite parameter, e.g. `?room=ABC123`. */
  ROOM: "room",
  TURN: "turn",
  RELAY: "relay",
  CODE: "code",
} as const;

export const CHANNEL_LABELS = {
  CTRL: "file-ctrl",
  DATA: "file-data",
  /** Legacy single channel, kept as a connection fallback. */
  LEGACY: "file",
} as const;

export const DEFAULT_CHANNEL_LABELS: readonly string[] = [
  CHANNEL_LABELS.CTRL,
  CHANNEL_LABELS.DATA,
  CHANNEL_LABELS.LEGACY,
] as const;

export const TIMEOUTS_MS: {
  SOCKET_CONNECT: number;
  CHANNEL_WAIT: number;
  CHANNEL_WAIT_DEFAULT: number;
  WRITER_CLOSE: number;
  WRITER_ABORT: number;
  TRANSFER_STALL: number;
} = {
  SOCKET_CONNECT: 10_000,
  CHANNEL_WAIT: 10_000,
  CHANNEL_WAIT_DEFAULT: 15_000,
  WRITER_CLOSE: 15_000,
  WRITER_ABORT: 5_000,
  // Fail transfer visibly if no bytes flow for this duration while not user-paused.
  TRANSFER_STALL: 60_000,
};

export const TOAST_DURATIONS_MS: {
  DEFAULT: number;
  RECONNECTING: number;
  CONNECTION_FAILED: number;
  CONNECTION_LOST: number;
  RECONNECTED: number;
} = {
  DEFAULT: 5_000,
  RECONNECTING: 8_000,
  CONNECTION_FAILED: 10_000,
  CONNECTION_LOST: 15_000,
  RECONNECTED: 3_000,
};
