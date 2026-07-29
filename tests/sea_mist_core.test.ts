import { describe, expect, it } from 'vitest';
import {
  bankDriftSpan,
  MIST_DRIFT_AMPLITUDE,
  RAY_HALF_WIDTH,
  SEA_LIGHT_RAYS,
  SEA_MIST_BANKS,
} from '../src/render/sea_mist_core';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';

const SEED = 20061;
const ground = (x: number, z: number): number => terrainHeight(x, z, SEED);
// A shade under the waterline, so nothing is placed sitting exactly on it.
const OFFSHORE = WATER_LEVEL - 0.25;

describe('bankDriftSpan', () => {
  it('covers the plane at both drift extremes, not just at rest', () => {
    const bank = { x: 10, z: 0, width: 100, height: 5, opacity: 1 };
    expect(bankDriftSpan(bank)).toEqual({
      lo: 10 - 50 - MIST_DRIFT_AMPLITUDE,
      hi: 10 + 50 + MIST_DRIFT_AMPLITUDE,
    });
  });
});

// The rule this module exists to hold: sea dressing sits on the ocean, never
// across land. A plane standing on dry ground pokes out of the hillside and
// its veil stops dead along the intersection, which reads as a hard,
// ruler-straight pale line across the terrain (reported at 59, 1342).
describe('the Veiled Hollow sea dressing stays offshore', () => {
  it('keeps every mist bank over open water across its whole drift range', () => {
    for (const bank of SEA_MIST_BANKS) {
      const { lo, hi } = bankDriftSpan(bank);
      for (let x = lo; x <= hi; x += 1) {
        expect(
          ground(x, bank.z),
          `bank z=${bank.z} x=${bank.x} w=${bank.width} crosses land at x=${x}`,
        ).toBeLessThan(OFFSHORE);
      }
    }
  });

  it('keeps every light ray over open water across its full width', () => {
    for (const ray of SEA_LIGHT_RAYS) {
      for (let x = ray.x - RAY_HALF_WIDTH; x <= ray.x + RAY_HALF_WIDTH; x += 1) {
        expect(
          ground(x, ray.z),
          `ray z=${ray.z} x=${ray.x} is rooted in land at x=${x}`,
        ).toBeLessThan(OFFSHORE);
      }
    }
  });

  // A guard that never fires is not a guard: the placement this bug was
  // reported against must still fail the sweep above.
  it('rejects the placement that caused the report', () => {
    const reported = { x: 40, z: 1350, width: 190, height: 11, opacity: 0.36 };
    const { lo, hi } = bankDriftSpan(reported);
    let onLand = 0;
    for (let x = lo; x <= hi; x += 1) if (ground(x, reported.z) >= OFFSHORE) onLand++;
    // It straddled the causeway: ~74yd of the isthmus, right where the player
    // stood at (59, 1342).
    expect(onLand).toBeGreaterThan(60);
    expect(ground(59, 1350)).toBeGreaterThan(OFFSHORE); // the crest it cut across
  });
});

// Placement is art, but the shape of it is load-bearing: the banks veil what
// lies beyond the sea, so losing a whole flank would quietly open the horizon
// on that side.
describe('the sea keeps its layered cover', () => {
  it('veils both flanks at each near depth', () => {
    const byDepth = new Map<number, { west: boolean; east: boolean }>();
    for (const bank of SEA_MIST_BANKS) {
      const entry = byDepth.get(bank.z) ?? { west: false, east: false };
      if (bank.x < 0) entry.west = true;
      else entry.east = true;
      byDepth.set(bank.z, entry);
    }
    // The near band (z 1300-1360) is what a player on the causeway looks
    // across, so it carries mist on both sides.
    for (const [z, sides] of byDepth) {
      if (z > 1360) continue;
      expect(sides.west, `depth z=${z} has no western bank`).toBe(true);
      expect(sides.east, `depth z=${z} has no eastern bank`).toBe(true);
    }
    expect(byDepth.size, 'the sea lost a whole depth layer').toBeGreaterThanOrEqual(4);
  });

  it('still fields the same number of light shafts as authored', () => {
    expect(SEA_LIGHT_RAYS).toHaveLength(5);
  });
});
