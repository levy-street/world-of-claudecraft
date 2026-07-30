import type { BlockerDef, HeightStamp } from './types';

export type JailState = {
  returnPos: { x: number; z: number };
  returnFacing: number;
  // Sentence end, epoch ms (server wall clock). Absent = indefinite, held
  // until a moderator /unjail. Persisted with the character state, so a
  // sentence keeps running across reconnects and is enforced at next login.
  until?: number;
};

export const JAIL_CENTER = { x: -12_000, z: -12_000 };
export const JAIL_VISITOR_POS = { x: JAIL_CENTER.x + 25, z: JAIL_CENTER.z };
export const JAIL_OUTER_HALF = 38;
export const JAIL_CAGE_HALF = 17;

function segment(x1: number, z1: number, x2: number, z2: number): BlockerDef {
  return { x1, z1, x2, z2 };
}

export function jailCageSpawn(slot: number): { x: number; z: number } {
  const index = Math.abs(Math.trunc(slot)) % 10;
  if (index === 0) return { x: JAIL_CENTER.x, z: JAIL_CENTER.z };
  const angle = ((index - 1) / 9) * Math.PI * 2;
  const radius = index % 2 === 0 ? 7 : 11;
  return {
    x: JAIL_CENTER.x + Math.cos(angle) * radius,
    z: JAIL_CENTER.z + Math.sin(angle) * radius,
  };
}

// The moderator gate: a marked section of the cage's east face (the visitor
// side). The cage colliders stay sealed for everyone; the SERVER teleports a
// session with the moderation permission across the bars when it walks into
// the trigger box (server/game.ts enforceJailStates). Prisoners and ordinary
// players just bump into the blocker. The z offset matches a cage wall module
// centre so the render-side portal arch frames a full bar panel.
export const JAIL_GATE = { x: JAIL_CENTER.x + JAIL_CAGE_HALF, z: JAIL_CENTER.z - 4.25 };
// Trigger half-extent through the wall (x). Blocker standoff is
// FENCE_HALF_DEPTH (0.35) + body radius (<= 0.8), so a mover pressing into the
// bars sits ~0.85 to 1.15 yd from the centreline: inside this depth, while a
// walk past the gate along the aisle stays outside it.
const JAIL_GATE_DEPTH = 1.25;
// Trigger half-extent along the wall (z), the visual portal's width.
const JAIL_GATE_HALF_WIDTH = 1.6;
// Landing distance from the wall centreline, past the trigger depth so the
// arrival never re-triggers the gate.
const JAIL_GATE_EXIT = 2.6;

/** Moderator-gate trigger test: inside the gate box, returns the landing spot
 * on the other side of the bars; anywhere else, null. Pure position math; the
 * caller owns the permission check. */
export function jailGateTeleport(pos: { x: number; z: number }): { x: number; z: number } | null {
  if (Math.abs(pos.x - JAIL_GATE.x) > JAIL_GATE_DEPTH) return null;
  if (Math.abs(pos.z - JAIL_GATE.z) > JAIL_GATE_HALF_WIDTH) return null;
  const dir = pos.x < JAIL_GATE.x ? 1 : -1;
  return { x: JAIL_GATE.x + dir * JAIL_GATE_EXIT, z: JAIL_GATE.z };
}

// Escape check for the jailed-session enforcement (server/game.ts). The bound
// is the PHYSICAL cage wall line: a prisoner pressing into the bars (or into
// the moderator gate) sits at ~JAIL_CAGE_HALF minus the collision standoff and
// must still count as inside, or the enforcement would snap wall-huggers back
// to their cell spawn. Movement collision means a legitimate position never
// reaches the wall line itself; only a genuine escape lands beyond it.
export function isInJailCage(pos: { x: number; z: number }): boolean {
  return (
    Math.abs(pos.x - JAIL_CENTER.x) <= JAIL_CAGE_HALF &&
    Math.abs(pos.z - JAIL_CENTER.z) <= JAIL_CAGE_HALF
  );
}

export const JAIL_BLOCKERS: BlockerDef[] = [
  segment(
    JAIL_CENTER.x - JAIL_OUTER_HALF,
    JAIL_CENTER.z - JAIL_OUTER_HALF,
    JAIL_CENTER.x + JAIL_OUTER_HALF,
    JAIL_CENTER.z - JAIL_OUTER_HALF,
  ),
  segment(
    JAIL_CENTER.x + JAIL_OUTER_HALF,
    JAIL_CENTER.z - JAIL_OUTER_HALF,
    JAIL_CENTER.x + JAIL_OUTER_HALF,
    JAIL_CENTER.z + JAIL_OUTER_HALF,
  ),
  segment(
    JAIL_CENTER.x + JAIL_OUTER_HALF,
    JAIL_CENTER.z + JAIL_OUTER_HALF,
    JAIL_CENTER.x - JAIL_OUTER_HALF,
    JAIL_CENTER.z + JAIL_OUTER_HALF,
  ),
  segment(
    JAIL_CENTER.x - JAIL_OUTER_HALF,
    JAIL_CENTER.z + JAIL_OUTER_HALF,
    JAIL_CENTER.x - JAIL_OUTER_HALF,
    JAIL_CENTER.z - JAIL_OUTER_HALF,
  ),
  segment(
    JAIL_CENTER.x - JAIL_CAGE_HALF,
    JAIL_CENTER.z - JAIL_CAGE_HALF,
    JAIL_CENTER.x + JAIL_CAGE_HALF,
    JAIL_CENTER.z - JAIL_CAGE_HALF,
  ),
  segment(
    JAIL_CENTER.x + JAIL_CAGE_HALF,
    JAIL_CENTER.z - JAIL_CAGE_HALF,
    JAIL_CENTER.x + JAIL_CAGE_HALF,
    JAIL_CENTER.z + JAIL_CAGE_HALF,
  ),
  segment(
    JAIL_CENTER.x + JAIL_CAGE_HALF,
    JAIL_CENTER.z + JAIL_CAGE_HALF,
    JAIL_CENTER.x - JAIL_CAGE_HALF,
    JAIL_CENTER.z + JAIL_CAGE_HALF,
  ),
  segment(
    JAIL_CENTER.x - JAIL_CAGE_HALF,
    JAIL_CENTER.z + JAIL_CAGE_HALF,
    JAIL_CENTER.x - JAIL_CAGE_HALF,
    JAIL_CENTER.z - JAIL_CAGE_HALF,
  ),
];

export const JAIL_TERRAIN_EDITS: HeightStamp[] = [
  {
    x: JAIL_CENTER.x,
    z: JAIL_CENTER.z,
    radius: JAIL_OUTER_HALF + 10,
    delta: 0,
    falloff: 'flat',
    mode: 'level',
  },
];
