// The Gyre's storm granite (src/sim/content/quartered_gyre_crags.ts): painted crags round the
// peak's foot, standing stones along its climb and a pair of gate stones at each launch pocket,
// every one seated on existing ground with a collider matched to its footprint.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROP_NATURAL_SIZE } from '../src/render/prop_natural_size.generated';
import { PROP_ASSET_DEFS, propPreloadInternalsForTest } from '../src/render/props';
import { isBlocked } from '../src/sim/colliders';
import { COUNCIL_BEACON_STOPS } from '../src/sim/content/quartered_council_seat';
import {
  GYRE_CRAG_KIT,
  GYRE_GATE_INSET,
  GYRE_STONE_OFFSET,
  GYRE_STONE_STOPS,
  type GyreCragPiece,
  gyreCragDecor,
  gyreCragPieces,
  gyreFootCrags,
  gyreGateStones,
  gyreStonePieces,
} from '../src/sim/content/quartered_gyre_crags';
import { GYRE_RAIL_GAP_HALF } from '../src/sim/content/quartered_gyre_rails';
import { QUARTERED_ISLE_DECOR } from '../src/sim/content/quartered_isle';
import { GYRE_NEEDLE_CLEAR_R } from '../src/sim/content/quartered_spires';
import { GYRE_LAUNCH_POCKETS, gyreYardsAtT } from '../src/sim/quartered_gyre_wind';
import { GYRE_PEAK, gyrePathAt } from '../src/sim/quartered_landmarks';
import { terrainHeight, WATER_LEVEL } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const ground = (x: number, z: number): number => terrainHeight(x, z, WORLD_SEED);
const R = 0.5; // a player's body

/** A piece's box corners and edge midpoints on the ground (the footprint a base must stand on). */
function footprint(p: GyreCragPiece, share = 0.9) {
  const k = GYRE_CRAG_KIT[p.key];
  const hw = (k.w / 2) * p.scale * share;
  const hd = (k.d / 2) * p.scale * share;
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  const pts: { x: number; z: number }[] = [];
  for (const [lx, lz] of [
    [0, 0],
    [-hw, -hd],
    [hw, -hd],
    [hw, hd],
    [-hw, hd],
    [0, -hd],
    [0, hd],
    [-hw, 0],
    [hw, 0],
  ]) {
    pts.push({ x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c });
  }
  return pts;
}

describe('the crag models', () => {
  it('are registered, shipped, on every tier, and as large as the layout believes', () => {
    for (const key of Object.keys(GYRE_CRAG_KIT) as (keyof typeof GYRE_CRAG_KIT)[]) {
      const def = PROP_ASSET_DEFS[key];
      expect(def, key).toBeDefined();
      expect(existsSync(resolve('public', def.url.slice(1))), key).toBe(true);
      expect(propPreloadInternalsForTest.lowTierPropKeys, key).toContain(key);
      const size = PROP_NATURAL_SIZE[key];
      const k = GYRE_CRAG_KIT[key];
      expect(size.x, `${key} width`).toBeCloseTo(k.w, 1);
      expect(size.z, `${key} depth`).toBeCloseTo(k.d, 1);
      expect(size.y, `${key} height`).toBeCloseTo(k.h, 1);
    }
  });
});

describe('the foot ring', () => {
  const crags = gyreFootCrags();

  it('stands on dry, level ground round the peak, never on the mountain or its scree', () => {
    expect(crags.length).toBeGreaterThanOrEqual(5);
    for (const [i, c] of crags.entries()) {
      const ys = footprint(c).map((p) => ground(p.x, p.z));
      expect(Math.min(...ys), `crag ${i} dry`).toBeGreaterThan(WATER_LEVEL + 3);
      expect(Math.max(...ys) - Math.min(...ys), `crag ${i} level`).toBeLessThan(2.6);
      expect(
        Math.hypot(c.x - GYRE_PEAK.x, c.z - GYRE_PEAK.z),
        `crag ${i} off the peak`,
      ).toBeGreaterThan(GYRE_PEAK.startR + 3);
    }
  });

  it('do not overlap each other', () => {
    for (let i = 0; i < crags.length; i++) {
      for (let j = i + 1; j < crags.length; j++) {
        const a = GYRE_CRAG_KIT[crags[i].key];
        const b = GYRE_CRAG_KIT[crags[j].key];
        const reach =
          (Math.hypot(a.w, a.d) * crags[i].scale + Math.hypot(b.w, b.d) * crags[j].scale) * 0.4;
        expect(
          Math.hypot(crags[i].x - crags[j].x, crags[i].z - crags[j].z),
          `crags ${i} and ${j}`,
        ).toBeGreaterThan(reach);
      }
    }
  });

  it('keep the PR needles off the peak: they stand past the scree', () => {
    expect(GYRE_NEEDLE_CLEAR_R).toBeGreaterThan(GYRE_PEAK.startR + GYRE_PEAK.pathW / 2);
    const needles = QUARTERED_ISLE_DECOR.filter((d) => d.key === 'rockTallH');
    for (const n of needles) {
      expect(Math.hypot(n.x - GYRE_PEAK.x, n.z - GYRE_PEAK.z)).toBeGreaterThanOrEqual(
        GYRE_NEEDLE_CLEAR_R,
      );
    }
  });
});

describe('the standing stones and the gate stones', () => {
  it('line the climb on its inner lip, on the path surface, between the way beacons', () => {
    const stones = gyreStonePieces();
    expect(stones).toHaveLength(GYRE_STONE_STOPS.length);
    for (const [i, s] of stones.entries()) {
      const at = gyrePathAt(s.x, s.z);
      expect(at, `stone ${i}`).not.toBeNull();
      expect(at?.off ?? 0, `stone ${i}`).toBeCloseTo(-GYRE_STONE_OFFSET, 1);
      const ys = footprint(s).map((p) => ground(p.x, p.z));
      expect(Math.max(...ys) - Math.min(...ys), `stone ${i} level`).toBeLessThan(0.6);
    }
    for (const stop of GYRE_STONE_STOPS) {
      for (const beacon of COUNCIL_BEACON_STOPS) {
        expect(Math.abs(gyreYardsAtT(stop) - gyreYardsAtT(beacon))).toBeGreaterThan(12);
      }
    }
  });

  it('flank every launch pocket, inside the railing gap, their faces turned to each other', () => {
    const gates = gyreGateStones();
    expect(gates).toHaveLength(GYRE_LAUNCH_POCKETS.length * 2);
    GYRE_LAUNCH_POCKETS.forEach((pocket, i) => {
      const [a, b] = [gates[i * 2], gates[i * 2 + 1]];
      const front = (g: GyreCragPiece) => ({ x: Math.sin(g.rot), z: Math.cos(g.rot) });
      const fa = front(a);
      const fb = front(b);
      // facing each other across the opening: opposite fronts, each toward the other stone
      expect(fa.x * fb.x + fa.z * fb.z, `pocket ${i}`).toBeLessThan(-0.99);
      expect(fa.x * (b.x - a.x) + fa.z * (b.z - a.z), `pocket ${i}`).toBeGreaterThan(0);
      expect(fb.x * (a.x - b.x) + fb.z * (a.z - b.z), `pocket ${i}`).toBeGreaterThan(0);
      // the pair spans the opening's middle, inside its gap, with the pocket between them
      const span = Math.hypot(a.x - b.x, a.z - b.z);
      expect(span).toBeGreaterThan(GYRE_RAIL_GAP_HALF);
      expect(span).toBeLessThan(2 * GYRE_RAIL_GAP_HALF);
      expect(GYRE_RAIL_GAP_HALF - GYRE_GATE_INSET).toBeGreaterThan(2.5);
      const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
      expect(Math.hypot(mid.x - pocket.x, mid.z - pocket.z), `pocket ${i}`).toBeLessThan(2.2);
    });
  });
});

describe('the crags as decor rows', () => {
  const rows = gyreCragDecor();

  it('are one row per piece, all in the isle, seated on the ground as it is', () => {
    expect(rows).toHaveLength(gyreCragPieces().length);
    for (const r of rows) {
      expect(r.terrainCalm).toBe(false);
      expect(QUARTERED_ISLE_DECOR).toContainEqual(r);
      // a collider the size of the piece and no taller: a glide crosses it
      expect(r.clearAbove).toBe(r.h);
      expect(r.hw).toBeGreaterThan(0);
      expect(r.hd).toBeGreaterThan(0);
      // the circumscribed clearance radius covers the box
      expect(r.r).toBeGreaterThanOrEqual(Math.hypot(r.hw ?? 0, r.hd ?? 0) - 0.02);
    }
  });

  it('block a walker at the foot, and leave the path beside the stones open', () => {
    for (const c of gyreFootCrags()) {
      expect(isBlocked(WORLD_SEED, c.x, c.z, R), `${c.key} at ${c.x.toFixed(0)}`).toBe(true);
    }
    for (const t of GYRE_STONE_STOPS) {
      const stone = gyreStonePieces()[GYRE_STONE_STOPS.indexOf(t)];
      expect(isBlocked(WORLD_SEED, stone.x, stone.z, R), `stone ${t}`).toBe(true);
      // the road's own centre line beside it
      const at = gyrePathAt(stone.x, stone.z);
      expect(at).not.toBeNull();
    }
  });
});
