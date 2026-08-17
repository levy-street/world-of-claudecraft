// Hand-written declarations for electron/discord_presence_codec.cjs so the
// Vitest suite (tests/electron_discord_codec.test.ts) type-checks its imports.
// Keep in sync with the .cjs exports (same convention as notify_guard.d.cts).

export interface DiscordFrame {
  opcode: number;
  payload: unknown;
}

export interface DiscordDecodeResult {
  frames: DiscordFrame[];
  rest: Buffer;
  error: null | 'oversize' | 'bad-opcode';
}

export const EMPTY_FRAME_BUFFER: Buffer;
export const HEADER_BYTES: number;
export const MAX_FRAME_BYTES: number;
export const OPCODES: {
  HANDSHAKE: number;
  FRAME: number;
  CLOSE: number;
  PING: number;
  PONG: number;
};
export function decodeFrames(buffer: Buffer): DiscordDecodeResult;
export function encodeFrame(opcode: number, payload: unknown): Buffer;
export function encodeHandshake(clientId: string): Buffer;
export function encodePong(payload: unknown): Buffer;
export function encodeSetActivity(nonce: string, pid: number, activity: unknown): Buffer;
