// STUB (RFC) — deterministic steering (Clock A).
// Converts a high-level Goal into one movement-intent frame per 20Hz tick.
// Because the server accepts an ABSOLUTE facing angle (src/sim/move_input.ts), steering is
// mostly: point at the destination, hold forward, stop within range. No tl/tr ramping.
// This module is pure (no LLM, no network) and is the unit-test target.

import type { Goal, MoveInput, WireSelf, WireEntity } from '../types.js';

export interface InputFrame {
  mi: MoveInput;
  facing?: number;
}

const STOP: InputFrame = { mi: {} };

function angleTo(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.atan2(b.z - a.z, b.x - a.x);
}

function dist2d(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  return Math.sqrt(dx * dx + dz * dz);
}

/** Resolve a goal's destination point from the live world view. */
function resolveDest(
  goal: Goal,
  self: WireSelf,
  entityById: (id: number) => WireEntity | undefined,
): { x: number; z: number } | null {
  switch (goal.kind) {
    case 'idle':
      return null;
    case 'waypoint':
      return { x: goal.x, z: goal.z };
    case 'follow': {
      const e = entityById(goal.targetId);
      return e ? { x: e.x, z: e.z } : null;
    }
  }
}

/** One tick of steering. Returns the input frame to send this tick. */
export function tick(
  goal: Goal,
  self: WireSelf,
  entityById: (id: number) => WireEntity | undefined,
): InputFrame {
  const dest = resolveDest(goal, self, entityById);
  if (!dest) return STOP; // nothing to do — let Clock B (the LLM) replan
  const stopRange = goal.kind === 'idle' ? 0 : goal.stopRange;
  if (dist2d(self, dest) <= stopRange) return STOP; // arrived — hold position
  return { mi: { f: 1 }, facing: angleTo(self, dest) };
}
