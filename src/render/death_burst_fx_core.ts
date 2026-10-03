// Pure plan for the trash kit's death-burst rings (death_burst_fx.ts): the
// ring a dead kit mob paints where it fell while its burst builds
// (sim/mob/trash_kit/death_burst.ts), its colours, and how long it takes to
// fill. The fuse is read back from the templates, so the moment the ring fills
// is the moment the sim bursts.
//
// Three-free, DOM-free, deterministic.

import { MOBS } from '../sim/data';
import { TELEGRAPH_THREAT_COLORS } from './floor_telegraph/telegraph_look_core';

/** The ring's look: a danger rim and a pale steam-and-frost accent. */
export const DEATH_BURST_RING_LOOK = {
  color: TELEGRAPH_THREAT_COLORS.danger,
  accent: 0xe9eef0,
} as const;

/** The death-burst delay the templates author for a ring of this radius (the
 *  ring carries its radius and its mob's name; the delay is read back from the
 *  content). Two templates can share a radius with different fuses, so a
 *  template of the ring's own name wins over the nearest radius. */
const delays = new Map<string, number>();

export function burstDelayForRadius(radius: number, name?: string): number {
  const key = `${radius}|${name ?? ''}`;
  const cached = delays.get(key);
  if (cached !== undefined) return cached;
  let best = 1.5;
  let bestGap = Infinity;
  for (const t of Object.values(MOBS)) {
    const b = t.trashKit?.deathBurst;
    if (!b || b.delay <= 0) continue;
    // Its own template: an exact name beats any radius match.
    const gap = Math.abs(b.radius - radius) + (name !== undefined && t.name === name ? -1e6 : 0);
    if (gap < bestGap) {
      bestGap = gap;
      best = b.delay;
    }
  }
  delays.set(key, best);
  return best;
}

/** Fill of a ring `age` seconds in (1 at its moment). */
export function burstRingFill(age: number, seconds: number): number {
  if (seconds <= 0) return 1;
  return Math.min(1, Math.max(0, age / seconds));
}
