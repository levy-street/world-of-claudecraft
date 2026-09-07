export const ONLINE_WORLD_AUTH_TYPE: 'auth-world-29';

export const ONLINE_WORLD_INCOMPATIBLE_MESSAGE: 'Game and server versions are incompatible. Reload or update, then try again.';

export const MOVEMENT_WIRE_VERSION: 2;

export interface WorldAuthMessage {
  readonly t: typeof ONLINE_WORLD_AUTH_TYPE;
  readonly token: string;
  readonly character: number;
  readonly movementWire: typeof MOVEMENT_WIRE_VERSION;
}

export function worldAuthMessage(token: string, character: number): WorldAuthMessage;

export interface ChatCommandMessage {
  readonly t: 'cmd';
  readonly cmd: 'chat';
  readonly text: string;
}

export function chatCommandMessage(text: string): ChatCommandMessage;

export const MOVEMENT_FRAME_INTERVAL_MS: 50;

export interface MovementInputFrame {
  readonly t: 'input';
  readonly ct: number;
  readonly mi: Record<string, number>;
  readonly facing?: number;
}

export interface MovementInputStream {
  start(): void;
  set(moveInput?: Record<string, number>, facing?: number): void;
  stop(): void;
}

export function createMovementInputStream(
  send: (frame: MovementInputFrame) => void,
): MovementInputStream;
