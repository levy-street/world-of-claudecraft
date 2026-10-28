// The client half of the Stealth Rework shimmer band. The server ships the
// shimmers this viewer gets as an `ssh` snapshot suffix of rows [x, y, z, fade]
// (server/stealth_shimmer_wire.ts): rounded positions and a fade, no id. Sent
// only when the list changed, so an absent key keeps what is held and an
// explicit [] clears it. A malformed row is DROPPED rather than rendered, so a
// version-skewed frame never puts NaN in the world.

import { SHIMMER_VIEW_CAP } from '../sim/stealth_shimmer';
import type { StealthShimmer } from '../world_api';

const NONE: readonly StealthShimmer[] = Object.freeze([]);

export function decodeStealthShimmers(value: unknown): readonly StealthShimmer[] {
  if (!Array.isArray(value) || value.length === 0) return NONE;
  const out: StealthShimmer[] = [];
  for (const row of value) {
    if (out.length >= SHIMMER_VIEW_CAP) break;
    if (!Array.isArray(row) || row.length !== 4) continue;
    const [x, y, z, fade] = row as unknown[];
    if (![x, y, z, fade].every((n) => typeof n === 'number' && Number.isFinite(n))) continue;
    if ((fade as number) <= 0 || (fade as number) > 1) continue;
    out.push({ x: x as number, y: y as number, z: z as number, fade: fade as number });
  }
  return out.length === 0 ? NONE : out;
}

export interface StealthShimmerSink {
  stealthShimmers: readonly StealthShimmer[];
}

export function applyStealthShimmerSnapshot(
  world: StealthShimmerSink,
  snap: Readonly<Record<string, unknown>>,
): void {
  if (snap.ssh !== undefined) world.stealthShimmers = decodeStealthShimmers(snap.ssh);
}
