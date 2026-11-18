// The Gyre's railing (src/sim/content/quartered_gyre_rails.ts): a low storm-granite wall along the
// path's outer lip, open at the four launch pockets and butted against the way beacons, laid as
// fence runs of kind 'storm'. Solid to a walker, open at the gaps, and never in the way of the path.

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PROP_NATURAL_SIZE } from '../src/render/prop_natural_size.generated';
import { PROP_ASSET_DEFS } from '../src/render/props';
import { isBlocked, resolveMovement } from '../src/sim/colliders';
import { COUNCIL_BEACON_STOPS } from '../src/sim/content/quartered_council_seat';
import {
  GYRE_RAIL_BEACON_CLEAR,
  GYRE_RAIL_CROWN_CLEAR_YD,
  GYRE_RAIL_GAP_HALF,
  GYRE_RAIL_OFFSET,
  GYRE_RAIL_START_YD,
  GYRE_WALL_HEIGHT,
  GYRE_WALL_THICK,
  gyreLipAt,
  gyreRailFences,
  gyreRailPieces,
  gyreRailStretches,
} from '../src/sim/content/quartered_gyre_rails';
import { PROPS } from '../src/sim/data';
import {
  GYRE_LAUNCH_POCKETS,
  GYRE_PATH_YARDS,
  gyreTAtYards,
  gyreYardsAtT,
} from '../src/sim/quartered_gyre_wind';
import { GYRE_PEAK, gyrePathAt, gyrePathPoint } from '../src/sim/quartered_landmarks';
import { WORLD_SEED } from '../src/sim/world_seed';

const R = 0.5; // a player's body

/** A point on the path at `yd` yards along it and `off` yards outboard of its centre line. */
function onPath(yd: number, off: number) {
  const p = gyrePathPoint(gyreTAtYards(yd));
  const dx = p.x - GYRE_PEAK.x;
  const dz = p.z - GYRE_PEAK.z;
  const r = Math.hypot(dx, dz);
  return { x: p.x + (dx / r) * off, z: p.z + (dz / r) * off, y: p.y };
}

describe('the railing: where it runs', () => {
  const stretches = gyreRailStretches();

  it('runs foot to crown in order, clear of the road foot and the crown', () => {
    expect(stretches.length).toBeGreaterThanOrEqual(6);
    let prev = GYRE_RAIL_START_YD - 1e-6;
    for (const s of stretches) {
      expect(s.a).toBeGreaterThanOrEqual(prev);
      expect(s.b).toBeGreaterThan(s.a);
      prev = s.b;
    }
    expect(stretches[0].a).toBe(GYRE_RAIL_START_YD);
    expect(prev).toBeLessThanOrEqual(GYRE_PATH_YARDS - GYRE_RAIL_CROWN_CLEAR_YD + 1e-6);
  });

  it('opens at every launch pocket and closes against every beacon', () => {
    const covered = (yd: number) => stretches.some((s) => yd > s.a + 1e-6 && yd < s.b - 1e-6);
    for (const pocket of GYRE_LAUNCH_POCKETS) {
      const c = gyreYardsAtT(pocket.t);
      for (let d = -GYRE_RAIL_GAP_HALF + 0.05; d <= GYRE_RAIL_GAP_HALF - 0.05; d += 0.25) {
        expect(covered(c + d), `pocket ${pocket.t} at ${d}`).toBe(false);
      }
      // the wall is there either side of the opening (the gap is a gate, not a missing lip)
      expect(covered(c - GYRE_RAIL_GAP_HALF - 1.5), `before ${pocket.t}`).toBe(true);
    }
    // every beacon, the top one beside the crown too, stands in a break of the railing
    for (const t of COUNCIL_BEACON_STOPS) {
      const c = gyreYardsAtT(t);
      expect(covered(c - GYRE_RAIL_BEACON_CLEAR - 0.2), `beacon ${t} before`).toBe(true);
      expect(covered(c), `beacon ${t}`).toBe(false);
    }
  });

  it("walls the road's last bend past the top beacon, all the way up to the crown", () => {
    const covered = (yd: number) => stretches.some((s) => yd > s.a + 1e-6 && yd < s.b - 1e-6);
    const top = Math.max(...COUNCIL_BEACON_STOPS.map((t) => gyreYardsAtT(t)));
    expect(GYRE_RAIL_CROWN_CLEAR_YD).toBeLessThanOrEqual(1);
    for (let yd = top + GYRE_RAIL_BEACON_CLEAR + 0.2; yd < GYRE_PATH_YARDS - 1.2; yd += 0.25) {
      expect(covered(yd), `yd ${yd.toFixed(2)}`).toBe(true);
    }
  });

  it('stands on the path surface, its outer face flush with the lip', () => {
    expect(GYRE_RAIL_OFFSET + GYRE_WALL_THICK / 2).toBeLessThanOrEqual(GYRE_PEAK.pathW / 2);
    for (let yd = 12; yd < GYRE_PATH_YARDS - 12; yd += 17) {
      const lip = gyreLipAt(yd);
      expect(Math.hypot(lip.ox, lip.oz)).toBeCloseTo(1, 9);
      const at = gyrePathAt(lip.x, lip.z);
      expect(at, `yd ${yd}`).not.toBeNull();
      expect(at?.off ?? 0, `yd ${yd}`).toBeCloseTo(GYRE_RAIL_OFFSET, 1);
    }
  });
});

describe('the railing: its fence runs', () => {
  const pieces = gyreRailPieces();
  const fences = gyreRailFences();

  it('are short straight chords of the lip, joined end to end along each stretch', () => {
    expect(pieces.length).toBeGreaterThanOrEqual(40);
    for (const p of pieces) {
      expect(p.chord).toBeGreaterThan(4);
      expect(p.chord).toBeLessThan(8.5);
    }
    // the next run starts where this one ends, or after an opening
    let joined = 0;
    for (let i = 0; i + 1 < pieces.length; i++) {
      if (Math.hypot(pieces[i].x2 - pieces[i + 1].x1, pieces[i].z2 - pieces[i + 1].z1) < 1e-9) {
        joined++;
      }
    }
    expect(joined).toBeGreaterThan(pieces.length - 12);
  });

  it('are the storm kind, as thick and tall as the wall models', () => {
    expect(fences).toHaveLength(pieces.length);
    for (const f of fences) {
      expect(f.kind).toBe('storm');
      expect(f.width).toBe(GYRE_WALL_THICK);
      expect(f.height).toBe(GYRE_WALL_HEIGHT);
    }
    for (const key of ['gyreStormWallA', 'gyreStormWallB'] as const) {
      const def = PROP_ASSET_DEFS[key];
      expect(def, key).toBeDefined();
      expect(existsSync(resolve('public', def.url.slice(1))), key).toBe(true);
      const size = PROP_NATURAL_SIZE[key];
      expect(size.y, key).toBeCloseTo(GYRE_WALL_HEIGHT, 1);
      expect(size.z, key).toBeCloseTo(GYRE_WALL_THICK, 1);
      expect(size.x, key).toBeGreaterThan(5.8);
      expect(size.x, key).toBeLessThan(6.2);
    }
  });

  it('reach the live world: every run is a fence of the isle', () => {
    const live = PROPS.fences.filter((f) => f.kind === 'storm');
    expect(live).toHaveLength(fences.length);
  });
});

describe('the railing, as a player meets it', () => {
  it('lets a player walk the whole climb along the path centre, rail and beacons notwithstanding', () => {
    let at = onPath(4, 0);
    for (let yd = 4.5; yd < GYRE_PATH_YARDS - 4; yd += 0.5) {
      const next = onPath(yd, 0);
      const end = resolveMovement(WORLD_SEED, at.x, at.z, next.x, next.z, R);
      expect(Math.hypot(end.x - next.x, end.z - next.z), `yd ${yd}`).toBeLessThan(0.02);
      at = next;
    }
  });

  it('stops a player at the wall: pushed outward from the road, they do not reach the lip', () => {
    for (const s of gyreRailStretches()) {
      const mid = (s.a + s.b) / 2;
      const from = onPath(mid, 0.5);
      const to = onPath(mid, GYRE_PEAK.pathW / 2 + 1.5);
      const end = resolveMovement(WORLD_SEED, from.x, from.z, to.x, to.z, R);
      const off = gyrePathAt(end.x, end.z)?.off ?? 99;
      expect(off, `stretch ${s.a.toFixed(0)}`).toBeLessThan(GYRE_RAIL_OFFSET - GYRE_WALL_THICK / 2);
      expect(off).toBeGreaterThan(0.4);
    }
  });

  it('lets a player walk out to the lip at each launch pocket', () => {
    for (const pocket of GYRE_LAUNCH_POCKETS) {
      const c = gyreYardsAtT(pocket.t);
      const from = onPath(c, 0.5);
      const to = onPath(c, GYRE_PEAK.pathW / 2 - 0.4);
      const end = resolveMovement(WORLD_SEED, from.x, from.z, to.x, to.z, R);
      expect(Math.hypot(end.x - to.x, end.z - to.z), `pocket ${pocket.t}`).toBeLessThan(0.05);
      // and the pocket itself is open ground, not a collider
      expect(isBlocked(WORLD_SEED, pocket.x, pocket.z, R), `pocket ${pocket.t}`).toBe(false);
    }
  });
});
