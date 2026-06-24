import { NUM_ACTIONS } from '../src/sim/obs';
import { ALL_CLASSES, PlayerClass } from '../src/sim/types';

export const MAX_INPUT_LINE_LENGTH = 1024 * 1024;

export function validateAction(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  if (value < 0 || value >= NUM_ACTIONS) return null;
  return value;
}

export function validatePlayerClass(value: unknown): PlayerClass | null {
  return (ALL_CLASSES as string[]).includes(value as string) ? (value as PlayerClass) : null;
}
