export const MSG = Object.freeze({
  HELLO: "HELLO",
  ACTION: "ACTION",
  PONG: "PONG",
  REQUEST_FULL_STATE: "REQUEST_FULL_STATE",

  WELCOME: "WELCOME",
  FULL_STATE: "FULL_STATE",
  STATE_PATCH: "STATE_PATCH",
  ACTION_ACK: "ACTION_ACK",
  ACTION_REJECTED: "ACTION_REJECTED",
  PING: "PING",
  CLIENT_LIST: "CLIENT_LIST",
  CONNECTION_REJECTED: "CONNECTION_REJECTED",
} as const);

export const PROTOCOL_VERSION = 1;
export const DEFAULT_WS_PORT = 4747;
export const PING_INTERVAL_MS = 10000;
export const PENDING_TIMEOUT_MS = 60000;

export function safeParse(s: string): unknown {
  try { return JSON.parse(s); } catch { return null; }
}
