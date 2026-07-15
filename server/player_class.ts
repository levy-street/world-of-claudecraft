// Server-side player-class validation shared by every HTTP surface. The sim's
// ALL_CLASSES registry is the authority; server routes must never copy that list.

import { CLASSES } from '../src/sim/content/classes';
import { ALL_CLASSES, type PlayerClass } from '../src/sim/types';

export const PLAYER_CLASSES: readonly PlayerClass[] = Object.freeze([...ALL_CLASSES]);

const PLAYER_CLASS_IDS: ReadonlySet<string> = new Set(PLAYER_CLASSES);

export function isPlayerClass(value: unknown): value is PlayerClass {
  return typeof value === 'string' && PLAYER_CLASS_IDS.has(value);
}

export function canonicalPlayerClassName(value: unknown): string {
  return isPlayerClass(value) ? CLASSES[value].name : '';
}
