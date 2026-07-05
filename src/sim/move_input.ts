import { MoveInput, emptyMoveInput } from './types';

const MOVE_FIELDS = [
  ['forward', 'f'],
  ['back', 'b'],
  ['turnLeft', 'tl'],
  ['turnRight', 'tr'],
  ['strafeLeft', 'sl'],
  ['strafeRight', 'sr'],
  ['jump', 'j'],
] as const;
const MAX_FACING_MAGNITUDE = 1000;

type MoveField = typeof MOVE_FIELDS[number][0];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isMoveFlag(value: unknown): boolean {
  return value === true || value === 1;
}

export function sanitizeMoveInput(raw: unknown): MoveInput {
  const input = emptyMoveInput();
  if (!isRecord(raw)) return input;
  for (const [field, compact] of MOVE_FIELDS) {
    input[field as MoveField] = isMoveFlag(raw[field]) || isMoveFlag(raw[compact]);
  }
  return input;
}

export function sanitizeMoveFacing(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) && Math.abs(raw) <= MAX_FACING_MAGNITUDE
    ? raw
    : null;
}

export function normalizeMoveFacing(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw)
    ? Math.atan2(Math.sin(raw), Math.cos(raw))
    : null;
}

export interface MoveInputFrame {
  moveInput: MoveInput;
  facing: number | null;
}

export function parseMoveInputFrame(raw: unknown): MoveInputFrame {
  if (!isRecord(raw)) return { moveInput: emptyMoveInput(), facing: null };
  return {
    moveInput: sanitizeMoveInput(raw.mi),
    facing: sanitizeMoveFacing(raw.facing),
  };
}
