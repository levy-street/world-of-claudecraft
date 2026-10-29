// The client half of the Stealth Rework footprints. The server ships the
// prints this viewer can read as an `sfp` snapshot suffix of immutable rows
// [x, y, z, facing, bornAt, foot] (server/stealth_footprint_wire.ts), and only
// when that set changed: an absent key means "unchanged", so the held list is
// re-aged from the snapshot clock, and an explicit [] clears it. A malformed
// row is DROPPED rather than rendered, so a version-skewed frame never puts NaN
// in the world.

import { FOOTPRINT_LIFETIME, FOOTPRINT_VIEW_CAP } from '../sim/stealth_footprints';
import type { VisibleFootprint } from '../world_api';

const NONE: readonly VisibleFootprint[] = Object.freeze([]);

export function decodeStealthFootprints(value: unknown, now: number): readonly VisibleFootprint[] {
  if (!Array.isArray(value) || value.length === 0 || !Number.isFinite(now)) return NONE;
  const out: VisibleFootprint[] = [];
  for (const row of value) {
    if (out.length >= FOOTPRINT_VIEW_CAP) break;
    if (!Array.isArray(row) || row.length !== 6) continue;
    const [x, y, z, facing, bornAt, foot] = row as unknown[];
    if (![x, y, z, facing, bornAt].every((n) => typeof n === 'number' && Number.isFinite(n)))
      continue;
    if (foot !== 0 && foot !== 1) continue;
    const age = now - (bornAt as number);
    if (age < 0 || age > FOOTPRINT_LIFETIME) continue;
    out.push({
      x: x as number,
      y: y as number,
      z: z as number,
      facing: facing as number,
      bornAt: bornAt as number,
      age,
      foot,
    });
  }
  return out.length === 0 ? NONE : out;
}

/** The held list aged to `now`, expired prints dropped. */
export function reageStealthFootprints(
  held: readonly VisibleFootprint[],
  now: number,
): readonly VisibleFootprint[] {
  if (held.length === 0 || !Number.isFinite(now)) return held;
  const out: VisibleFootprint[] = [];
  for (const p of held) {
    const age = now - p.bornAt;
    if (age <= FOOTPRINT_LIFETIME) out.push({ ...p, age });
  }
  return out.length === 0 ? NONE : out;
}

export interface StealthFootprintSink {
  stealthFootprints: readonly VisibleFootprint[];
}

export function applyStealthFootprintSnapshot(
  world: StealthFootprintSink,
  snap: Readonly<Record<string, unknown>>,
): void {
  const now = typeof snap.time === 'number' ? snap.time : Number.NaN;
  if (snap.sfp !== undefined) world.stealthFootprints = decodeStealthFootprints(snap.sfp, now);
  else world.stealthFootprints = reageStealthFootprints(world.stealthFootprints ?? NONE, now);
}
