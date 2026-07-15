import { describe, expect, it } from 'vitest';

import { GRAVEYARD_POS, ZONE1_CAMPS } from '../src/sim/content/zone1';
import type { CampDef } from '../src/sim/types';

// Regression guard for #1908: the north-woods forest wolf camps sit on the
// direct corpse-run line from the Eastbrook graveyard. The old layout packed 13
// wolves into two dense, OVERLAPPING camps (counts 7 and 6, centers ~38 apart
// with a combined reach of 42), so a level 1-2 player who corpse-rezzed at 50%
// HP walked straight back into the blob and was chain-killed (packFrenzy makes
// this worse). The fix thins and separates the near-graveyard camps and relocates
// the surplus pack deep north, off the corpse-run line, without inventing any
// AI/aggro-grace mechanic. These bounds pin that content-data density.

// How far north of the graveyard a low-HP corpse-runner is still in the danger
// stretch. Camps whose spawn disc reaches within this distance count as "on the
// corpse run".
const CORPSE_RUN_RADIUS = 100;

function dist(a: { x: number; z: number }, b: { x: number; z: number }): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

const wolfCamps: CampDef[] = ZONE1_CAMPS.filter((c) => c.mobId === 'forest_wolf');

describe('zone1 forest wolf pack density on the newbie corpse-run', () => {
  it('keeps the zone-wide wolf headcount stable (13) for world-gen determinism', () => {
    // Redistributing rather than deleting wolves keeps the world-construction RNG
    // draw order byte-identical, so every seed-pinned spawn/delve roll is stable.
    const total = wolfCamps.reduce((sum, c) => sum + c.count, 0);
    expect(total).toBe(13);
  });

  it('does not overlap any two wolf camps (a clear gap between spawn discs)', () => {
    // Old layout: the two camps sat ~38.1 apart with a combined reach of 42, so
    // their discs overlapped by ~3.9 (gap < 0). Every pair must now have a
    // comfortable positive gap between their edges.
    for (let i = 0; i < wolfCamps.length; i++) {
      for (let j = i + 1; j < wolfCamps.length; j++) {
        const a = wolfCamps[i];
        const b = wolfCamps[j];
        const gap = dist(a.center, b.center) - (a.radius + b.radius);
        expect(gap).toBeGreaterThanOrEqual(10);
      }
    }
  });

  it('bounds the wolves within reach of the graveyard corpse-run', () => {
    // Old total on the corpse run was 7 + 6 = 13 (both camps near the graveyard);
    // the surplus pack now lives deep north, so at most 8 wolves border the run a
    // corpse-rezzer walks back along.
    const nearRunWolves = wolfCamps
      .filter((c) => dist(c.center, GRAVEYARD_POS) - c.radius <= CORPSE_RUN_RADIUS)
      .reduce((sum, c) => sum + c.count, 0);
    expect(nearRunWolves).toBeLessThanOrEqual(8);
  });

  it('keeps each wolf camp at a believable but non-lethal density', () => {
    for (const c of wolfCamps) {
      // No single camp packs the old dense pack's headcount (7/6), and each still
      // fields real wolves (not emptied out).
      expect(c.count).toBeGreaterThanOrEqual(3);
      expect(c.count).toBeLessThanOrEqual(5);
    }
  });
});
