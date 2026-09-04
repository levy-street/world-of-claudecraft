// Soul Rend marker, the pure half. A marked raider must stand within the stack
// range of another marked raider before the fuse blows, so the marker has two
// jobs: show WHO is marked (a sigil over the head, a ring on the floor) and
// show WHETHER they still need to move (the ring is the exact stack range, and
// it turns from red to green the moment another mark is inside it). Colours,
// the stacked test, and the fuse pulse live here without Three, DOM, or clocks;
// the painter (nythraxis_soul_rend_marker.ts) owns the meshes.
//
// Node-only (RENDER_PURE_CORES): no three.js, no DOM, no randomness.

import { NYTHRAXIS_SOUL_REND_STACK_RANGE } from '../sim/encounters/nythraxis';

/** The aura the encounter puts on a marked raider (encounters/nythraxis.ts). */
export const NYTHRAXIS_SOUL_REND_AURA_ID = 'nythraxis_soul_rend';
/** The floor ring is the stack range itself: overlapping rings means a shared hit. */
export const NYTHRAXIS_SOUL_REND_MARKER_RADIUS = NYTHRAXIS_SOUL_REND_STACK_RANGE;
/** Metres above the raider's feet the sigil floats (scaled by the entity). */
export const NYTHRAXIS_SOUL_REND_SIGIL_HEIGHT = 2.35;
export const NYTHRAXIS_SOUL_REND_SIGIL_BOB = 0.12;
export const NYTHRAXIS_SOUL_REND_MARKER_GROUND_LIFT = 0.06;

export interface NythraxisSoulRendMarkerPalette {
  ring: number;
  fill: number;
  sigil: number;
}

/** Alone: blood red, the colour of the mark. Stacked: the calm green of a shared hit. */
export const NYTHRAXIS_SOUL_REND_ALONE_PALETTE: NythraxisSoulRendMarkerPalette = {
  ring: 0xff3a2a,
  fill: 0x7a0e0e,
  sigil: 0xff6a4a,
};
export const NYTHRAXIS_SOUL_REND_STACKED_PALETTE: NythraxisSoulRendMarkerPalette = {
  ring: 0x7dff9a,
  fill: 0x0f4a22,
  sigil: 0xbaffcf,
};

export interface NythraxisSoulRendAuraLike {
  id: string;
  remaining: number;
  duration: number;
}

export interface NythraxisSoulRendEntityLike {
  id: number;
  dead: boolean;
  scale?: number;
  pos: { x: number; y: number; z: number };
  auras: readonly NythraxisSoulRendAuraLike[];
}

/** The live mark on a raider, or null. */
export function nythraxisSoulRendMarkOf(
  entity: NythraxisSoulRendEntityLike,
): NythraxisSoulRendAuraLike | null {
  if (entity.dead) return null;
  for (const aura of entity.auras) if (aura.id === NYTHRAXIS_SOUL_REND_AURA_ID) return aura;
  return null;
}

/** Every marked raider in the roster, in roster order. Allocation-free when `out` is reused. */
export function nythraxisSoulRendMarkedInto<T extends NythraxisSoulRendEntityLike>(
  out: T[],
  entities: Iterable<T>,
): T[] {
  out.length = 0;
  for (const entity of entities) if (nythraxisSoulRendMarkOf(entity)) out.push(entity);
  return out;
}

/** How many OTHER marked raiders stand inside this raider's stack range. */
export function nythraxisSoulRendPartners(
  marked: readonly NythraxisSoulRendEntityLike[],
  index: number,
  range: number = NYTHRAXIS_SOUL_REND_STACK_RANGE,
): number {
  const self = marked[index];
  let partners = 0;
  for (let other = 0; other < marked.length; other++) {
    if (other === index) continue;
    const candidate = marked[other];
    const dx = candidate.pos.x - self.pos.x;
    const dz = candidate.pos.z - self.pos.z;
    if (dx * dx + dz * dz <= range * range) partners++;
  }
  return partners;
}

export function nythraxisSoulRendPalette(partners: number): NythraxisSoulRendMarkerPalette {
  return partners > 0 ? NYTHRAXIS_SOUL_REND_STACKED_PALETTE : NYTHRAXIS_SOUL_REND_ALONE_PALETTE;
}

/**
 * The marker's pulse for one frame, 0 to 1: it beats faster as the fuse runs
 * down (a calm 1.5 Hz with the whole fuse left, up to 5 Hz in the last second)
 * so the urgency is readable without a timer. Reduced motion settles at the
 * midpoint.
 */
export function nythraxisSoulRendPulse(
  time: number,
  remaining: number,
  duration: number,
  reducedMotion: boolean,
): number {
  if (reducedMotion) return 0.5;
  const fraction = duration > 0 ? Math.min(1, Math.max(0, remaining / duration)) : 0;
  const hz = 1.5 + (1 - fraction) * 3.5;
  return 0.5 + 0.5 * Math.sin(time * hz * Math.PI * 2);
}
