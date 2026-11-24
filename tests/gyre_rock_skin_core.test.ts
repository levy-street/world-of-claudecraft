// The Gyre's rock skin as geometry (src/render/gyre_rock_skin_core.ts): a faceted cliff laid a
// hand over the steep ground of the storm peak, never under it, off the road. Node-only
// (RENDER_PURE_CORES): no Three, no DOM.

import { describe, expect, it } from 'vitest';
import {
  buildGyreRockSkin,
  facetNoise,
  ledgeProfile,
  SKIN_REACH,
  SKIN_SLOPE_LO,
  SKIN_TILE,
} from '../src/render/gyre_rock_skin_core';
import { GYRE_PEAK, gyreGroundAt, gyrePathAt } from '../src/sim/quartered_landmarks';
import { terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const ground = (x: number, z: number) => terrainHeight(x, z, WORLD_SEED);
const HALF = GYRE_PEAK.pathW / 2;

/** Yards from (x, z) to the road strip, walking radially in or out (null-safe: Infinity when none
 *  within three yards). The skin's own ramp is measured the same way. */
function nearestRoadDistance(x: number, z: number, dir: number): number {
  const dx = x - GYRE_PEAK.x;
  const dz = z - GYRE_PEAK.z;
  const r = Math.hypot(dx, dz) || 1;
  for (let step = 0; step <= 3; step += 0.25) {
    if (gyrePathAt(x + (dx / r) * dir * step, z + (dz / r) * dir * step)) return step;
  }
  return Number.POSITIVE_INFINITY;
}

const skin = buildGyreRockSkin(ground);
const verts = skin.positions.length / 3;

describe('faceted noise', () => {
  it('is the same value for the same place and seed, another for another seed', () => {
    const a = facetNoise(3.2, 17.9, -41.5, 5, 0.3, 11);
    expect(facetNoise(3.2, 17.9, -41.5, 5, 0.3, 11)).toBe(a);
    let differ = 0;
    for (let k = 0; k < 40; k++) {
      const x = k * 1.37;
      if (facetNoise(x, 9 + k, 2 * k, 5, 0.3, 11) !== facetNoise(x, 9 + k, 2 * k, 5, 0.3, 12)) {
        differ++;
      }
    }
    expect(differ).toBeGreaterThan(35);
  });

  it('stays within a couple of amplitudes however far you look', () => {
    for (let k = 0; k < 3000; k++) {
      const v = facetNoise(k * 0.731, (k * 0.377) % 61, -k * 0.419, 4.5, 0.5, 7);
      expect(Math.abs(v)).toBeLessThan(2.2 * 0.5);
    }
  });

  it('runs smooth inside a facet and steps at the border between two', () => {
    let steps = 0;
    let smoothSteps = 0;
    let prev = facetNoise(0, 5, 2, 5, 1, 3);
    for (let k = 1; k <= 1500; k++) {
      const v = facetNoise(k * 0.02, 5, 2, 5, 1, 3);
      if (Math.abs(v - prev) > 0.2) steps++;
      else if (Math.abs(v - prev) < 0.05) smoothSteps++;
      prev = v;
    }
    expect(steps).toBeGreaterThanOrEqual(2);
    expect(smoothSteps).toBeGreaterThan(1400);
  });
});

describe('the bedding ledges', () => {
  it('rise slowly to a ledge and drop at the next, between a hollow and a lip', () => {
    // one period (4.2 yards of height) at a fixed place, a hundredth of a yard apart
    let drops = 0;
    let lo = Number.POSITIVE_INFINITY;
    let hi = Number.NEGATIVE_INFINITY;
    let prev = ledgeProfile(14, 20, 2330);
    for (let k = 1; k <= 420; k++) {
      const v = ledgeProfile(14, 20 + k * 0.01, 2330);
      if (v - prev < -0.1) drops++;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      prev = v;
    }
    expect(drops).toBe(1);
    expect(lo).toBeGreaterThanOrEqual(-0.11);
    expect(hi).toBeLessThanOrEqual(0.25);
    expect(hi - lo).toBeGreaterThan(0.3);
  });

  it('repeat every 4.2 yards of height', () => {
    for (const y of [18.3, 24.9, 31.1, 40.6]) {
      expect(ledgeProfile(-9, y + 4.2, 2349)).toBeCloseTo(ledgeProfile(-9, y, 2349), 9);
    }
  });

  it('tilt with the bearing: the same height has another phase round the mountain', () => {
    const ys = [22, 25, 28, 31];
    let moved = 0;
    for (const y of ys) {
      if (Math.abs(ledgeProfile(30, y, 2356) - ledgeProfile(-30, y, 2356)) > 0.02) moved++;
    }
    expect(moved).toBeGreaterThanOrEqual(3);
  });
});

describe('the skin over the Gyre', () => {
  it('is a mountain of rock: thousands of triangles, three vertices to each, all finite', () => {
    expect(skin.triangles).toBeGreaterThan(3000);
    expect(skin.triangles).toBeLessThan(60000);
    expect(verts).toBe(skin.triangles * 3);
    expect(skin.uvs.length).toBe(verts * 2);
    expect(skin.colors.length).toBe(verts * 3);
    for (const arr of [skin.positions, skin.uvs, skin.colors]) {
      for (let i = 0; i < arr.length; i++) expect(Number.isFinite(arr[i])).toBe(true);
    }
  });

  it('stays on the peak: every vertex inside the reach round its axis', () => {
    for (let i = 0; i < verts; i++) {
      const d = Math.hypot(
        skin.positions[i * 3] - GYRE_PEAK.x,
        skin.positions[i * 3 + 2] - GYRE_PEAK.z,
      );
      expect(d, `vertex ${i}`).toBeLessThanOrEqual(SKIN_REACH + 1e-3);
    }
  });

  it('stays flush where it meets the road: any vertex inside the strip lies on the ground, a hand deep at most', () => {
    // the paving covers the strip's middle; the skin runs a little way under its edge so no bare
    // ground shows beside it, flush with the ground there so it never shows through
    let inside = 0;
    let deep = 0;
    for (let i = 0; i < verts; i++) {
      const x = skin.positions[i * 3];
      const z = skin.positions[i * 3 + 2];
      const at = gyrePathAt(x, z);
      if (!at) continue;
      inside++;
      if (Math.abs(at.off) < HALF - 1.0) deep++;
      expect(Math.abs(at.off), `vertex ${i}`).toBeGreaterThanOrEqual(HALF - 1.5 - 0.05);
      expect(skin.positions[i * 3 + 1] - ground(x, z), `vertex ${i}`).toBeLessThan(0.02);
    }
    expect(inside).toBeGreaterThan(100);
    // and it does run a good way under the edge (a tuck shrunk to half a yard would pass the above)
    expect(deep).toBeGreaterThan(100);
  });

  it('rises gently off the road: within a yard of its edge the skin stands off by under a hand', () => {
    for (let i = 0; i < verts; i++) {
      const x = skin.positions[i * 3];
      const z = skin.positions[i * 3 + 2];
      const at = gyrePathAt(x, z);
      if (!at || Math.abs(at.off) < HALF - 0.01) continue;
      // (a vertex a hair outside the strip is the ramp's first step)
      const gap = skin.positions[i * 3 + 1] - ground(x, z);
      expect(gap, `vertex ${i}`).toBeLessThan(0.02);
    }
    let nearEdge = 0;
    let tall = 0;
    for (let i = 0; i < verts; i++) {
      const x = skin.positions[i * 3];
      const z = skin.positions[i * 3 + 2];
      const gap = skin.positions[i * 3 + 1] - ground(x, z);
      // off the strip but within a yard of it
      const d = Math.min(...[-1, 1].map((sgn) => nearestRoadDistance(x, z, sgn)));
      if (d > 0 && d <= 1.01) {
        nearEdge++;
        if (gap > 0.5) tall++;
      }
    }
    expect(nearEdge).toBeGreaterThan(100);
    expect(tall).toBe(0);
  });

  it('lies on or over the ground and never under it, and stands off it for the most part', () => {
    let off = 0;
    for (let i = 0; i < verts; i++) {
      const x = skin.positions[i * 3];
      const z = skin.positions[i * 3 + 2];
      const gap = skin.positions[i * 3 + 1] - ground(x, z);
      expect(gap, `vertex ${i}`).toBeGreaterThanOrEqual(-1e-3);
      if (gap > 0.1) off++;
    }
    expect(off / verts).toBeGreaterThan(0.6);
  });

  it('clothes the steep ground of the peak: every steep, off-road point has skin beside it', () => {
    // a hash of the skin's vertices by 2-yard cell
    const cells = new Map<number, number[]>();
    for (let i = 0; i < verts; i++) {
      const cx = Math.floor(skin.positions[i * 3] / 2);
      const cz = Math.floor(skin.positions[i * 3 + 2] / 2);
      const key = cx * 100003 + cz;
      const list = cells.get(key);
      if (list) list.push(i);
      else cells.set(key, [i]);
    }
    const near = (x: number, z: number, r: number): boolean => {
      const cx = Math.floor(x / 2);
      const cz = Math.floor(z / 2);
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          for (const i of cells.get((cx + dx) * 100003 + (cz + dz)) ?? []) {
            if (Math.hypot(skin.positions[i * 3] - x, skin.positions[i * 3 + 2] - z) <= r)
              return true;
          }
        }
      }
      return false;
    };
    const tint = { gyreRock: 0, gyreWay: 0, gyreCap: 0 };
    let tested = 0;
    let missed = 0;
    for (let x = -50; x <= 50; x += 1.37) {
      for (let z = GYRE_PEAK.z - 50; z <= GYRE_PEAK.z + 50; z += 1.37) {
        const gx = (ground(x + 0.5, z) - ground(x - 0.5, z)) / 1;
        const gz = (ground(x, z + 0.5) - ground(x, z - 0.5)) / 1;
        const slope = Math.hypot(gx, gz);
        if (slope < 1.1 || slope > 4.5) continue;
        gyreGroundAt(x, z, tint);
        if (tint.gyreRock < 0.95) continue;
        const road = gyrePathAt(x, z);
        if (road && Math.abs(road.off) < HALF + 0.6) continue;
        tested++;
        if (!near(x, z, 1.8)) missed++;
      }
    }
    expect(tested).toBeGreaterThan(800);
    expect(missed / tested).toBeLessThan(0.03);
  });

  it('is the same rock on every build', () => {
    const again = buildGyreRockSkin(ground);
    expect(again.triangles).toBe(skin.triangles);
    let different = 0;
    for (let i = 0; i < skin.positions.length; i++) {
      if (again.positions[i] !== skin.positions[i]) different++;
    }
    for (let i = 0; i < skin.colors.length; i++) {
      if (again.colors[i] !== skin.colors[i]) different++;
    }
    for (let i = 0; i < skin.uvs.length; i++) {
      if (again.uvs[i] !== skin.uvs[i]) different++;
    }
    expect(different).toBe(0);
  });

  it('is paler toward the crown, dark in hollows, with lichen on some ledges', () => {
    let lichen = 0;
    for (let i = 0; i < verts; i++) {
      const r = skin.colors[i * 3];
      const g = skin.colors[i * 3 + 1];
      const b = skin.colors[i * 3 + 2];
      for (const c of [r, g, b]) {
        expect(c).toBeGreaterThan(0.2);
        expect(c).toBeLessThan(1.3);
      }
      if (g > r * 1.15) lichen++;
    }
    expect(lichen).toBeGreaterThan(verts * 0.005);
    expect(lichen).toBeLessThan(verts * 0.5);
  });
});

/** The ground's slope the way the core measures it: a one yard central difference. */
function slopeAt(x: number, z: number): number {
  return Math.hypot(
    (ground(x + 1, z) - ground(x - 1, z)) / 2,
    (ground(x, z + 1) - ground(x, z - 1)) / 2,
  );
}

describe('the skin beside the road, the crown and the approach', () => {
  const CROWN = GYRE_PEAK.endR - HALF + 1;
  const APRON_Z = -(GYRE_PEAK.startR + HALF - 3);
  const inApron = (dx: number, dz: number) => dz < APRON_Z && Math.abs(dx) <= HALF + 0.5;

  it('leaves no bare band beside the road inside the peak body, shallow ground included', () => {
    const placed = new Set<string>();
    for (let i = 0; i < verts; i++) {
      placed.add(`${Math.round(skin.positions[i * 3])},${Math.round(skin.positions[i * 3 + 2])}`);
    }
    const tint = { gyreRock: 0, gyreWay: 0, gyreCap: 0 };
    let tested = 0;
    let missed = 0;
    for (let r = GYRE_PEAK.endR - HALF - 2; r <= GYRE_PEAK.startR + HALF + 2; r += 0.5) {
      for (let a = 0; a < Math.PI * 2; a += 0.5 / r) {
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        const x = GYRE_PEAK.x + ca * r;
        const z = GYRE_PEAK.z + sa * r;
        if (gyrePathAt(x, z)) continue;
        // only ground within three quarters of a yard of the road: the band the body rule fills
        if (
          !gyrePathAt(x + ca * 0.75, z + sa * 0.75) &&
          !gyrePathAt(x - ca * 0.75, z - sa * 0.75)
        ) {
          continue;
        }
        const dx = x - GYRE_PEAK.x;
        const dz = z - GYRE_PEAK.z;
        if (Math.hypot(dx, dz) <= CROWN + 1.5) continue;
        if (dz < APRON_Z + 1.5 && Math.abs(dx) <= HALF + 2) continue;
        gyreGroundAt(x, z, tint);
        if (tint.gyreRock < 0.95) continue;
        tested++;
        const gx = Math.round(x);
        const gz = Math.round(z);
        let hit = false;
        for (let u = -1; u <= 1 && !hit; u++) {
          for (let v = -1; v <= 1 && !hit; v++) {
            hit = placed.has(`${gx + u},${gz + v}`) && Math.hypot(gx + u - x, gz + v - z) <= 1;
          }
        }
        if (!hit) missed++;
      }
    }
    expect(tested).toBeGreaterThan(2000);
    expect(missed).toBe(0);
  });

  it('leaves the crown plaza and the approach ramp bare where they are flat', () => {
    let flatCrown = 0;
    let flatApron = 0;
    for (let i = 0; i < verts; i++) {
      const x = skin.positions[i * 3];
      const z = skin.positions[i * 3 + 2];
      if (gyrePathAt(x, z)) continue;
      const dx = x - GYRE_PEAK.x;
      const dz = z - GYRE_PEAK.z;
      const slope = slopeAt(x, z);
      if (Math.hypot(dx, dz) <= CROWN && slope < SKIN_SLOPE_LO - 1e-3) flatCrown++;
      if (inApron(dx, dz) && slope < SKIN_SLOPE_LO - 1e-3) flatApron++;
    }
    expect(flatCrown).toBe(0);
    expect(flatApron).toBe(0);
  });

  it('blurs the facet steps: neighbouring grid vertices never differ by a spike', () => {
    const gapAt = new Map<string, number>();
    for (let i = 0; i < verts; i++) {
      const x = skin.positions[i * 3];
      const z = skin.positions[i * 3 + 2];
      gapAt.set(`${Math.round(x)},${Math.round(z)}`, skin.positions[i * 3 + 1] - ground(x, z));
    }
    let max = 0;
    let sum = 0;
    let n = 0;
    for (const [k, g] of gapAt) {
      const [x, z] = k.split(',').map(Number);
      for (const [a, b] of [
        [1, 0],
        [0, 1],
      ]) {
        const o = gapAt.get(`${x + a},${z + b}`);
        if (o === undefined) continue;
        const d = Math.abs(o - g);
        max = Math.max(max, d);
        sum += d;
        n++;
      }
    }
    // unblurred, the same terrain gives 1.31 and 0.17
    expect(max).toBeLessThan(0.9);
    expect(sum / n).toBeLessThan(0.13);
  });

  it('hugs the seam wall flat where the ground is sheerer than five to one', () => {
    const seen = new Set<string>();
    let seam = 0;
    for (let i = 0; i < verts; i++) {
      const x = skin.positions[i * 3];
      const z = skin.positions[i * 3 + 2];
      const key = `${x},${z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (slopeAt(x, z) < 5) continue;
      seam++;
      expect(skin.positions[i * 3 + 1] - ground(x, z), `vertex ${i}`).toBeLessThan(1e-4);
    }
    // the scan does see the wall
    expect(seam).toBeGreaterThan(0);
  });

  it('ramps up from flush over the three yards beside the road', () => {
    const dist = (x: number, z: number) => {
      const dx = x - GYRE_PEAK.x;
      const dz = z - GYRE_PEAK.z;
      const r = Math.hypot(dx, dz) || 1;
      let best = Number.POSITIVE_INFINITY;
      for (const dir of [-1, 1]) {
        for (let s = 0; s <= 5; s += 0.125) {
          if (gyrePathAt(x + (dx / r) * dir * s, z + (dz / r) * dir * s)) {
            best = Math.min(best, s);
            break;
          }
        }
      }
      return best;
    };
    const sum = [0, 0, 0];
    const cnt = [0, 0, 0];
    const seen = new Set<string>();
    for (let i = 0; i < verts; i++) {
      const x = skin.positions[i * 3];
      const z = skin.positions[i * 3 + 2];
      if (seen.has(`${x},${z}`)) continue;
      seen.add(`${x},${z}`);
      const d = dist(x, z);
      if (!(d > 0 && d < 3)) continue;
      const b = Math.floor(d);
      sum[b] += skin.positions[i * 3 + 1] - ground(x, z);
      cnt[b]++;
    }
    const mean = sum.map((total, b) => total / cnt[b]);
    for (const c of cnt) expect(c).toBeGreaterThan(100);
    // flush at the edge, a hand up a yard out, fully worn by three (no fade: 0.23 / 0.31 / 0.55)
    expect(mean[0]).toBeLessThan(0.15);
    expect(mean[1]).toBeGreaterThan(mean[0] + 0.15);
    expect(mean[2]).toBeGreaterThan(0.4);
  });
});

describe('the skin textured', () => {
  /** u x v of every triangle against its own normal: the sign of how the painting is laid. */
  function handedness(): { walls: [number, number]; tops: [number, number]; tilePinned: boolean } {
    const walls: [number, number] = [0, 0];
    const tops: [number, number] = [0, 0];
    let vFollowsHeight = true;
    for (let t = 0; t < skin.triangles; t++) {
      const P = (k: number, c: number) => skin.positions[(t * 3 + k) * 3 + c];
      const U = (k: number, c: number) => skin.uvs[(t * 3 + k) * 2 + c];
      const e1 = [P(1, 0) - P(0, 0), P(1, 1) - P(0, 1), P(1, 2) - P(0, 2)];
      const e2 = [P(2, 0) - P(0, 0), P(2, 1) - P(0, 1), P(2, 2) - P(0, 2)];
      const n = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const nl = Math.hypot(n[0], n[1], n[2]);
      if (nl < 1e-6) continue;
      const du1 = [U(1, 0) - U(0, 0), U(1, 1) - U(0, 1)];
      const du2 = [U(2, 0) - U(0, 0), U(2, 1) - U(0, 1)];
      const det = du1[0] * du2[1] - du2[0] * du1[1];
      if (Math.abs(det) < 1e-9) continue;
      // the tangent (along u) and bitangent (along v) of the mapping
      const T = [0, 1, 2].map((c) => (e1[c] * du2[1] - e2[c] * du1[1]) / det);
      const B = [0, 1, 2].map((c) => (e2[c] * du1[0] - e1[c] * du2[0]) / det);
      const cross = [
        T[1] * B[2] - T[2] * B[1],
        T[2] * B[0] - T[0] * B[2],
        T[0] * B[1] - T[1] * B[0],
      ];
      const sign = cross[0] * n[0] + cross[1] * n[1] + cross[2] * n[2] > 0 ? 0 : 1;
      const top = Math.abs(n[1]) / nl >= 0.75;
      (top ? tops : walls)[sign]++;
      // one unit of v is exactly SKIN_TILE yards along the world's up on a wall, along z on a top
      const axis = top ? 2 : 1;
      if (Math.abs(B[axis] - SKIN_TILE) > 0.05 * SKIN_TILE) vFollowsHeight = false;
    }
    return { walls, tops, tilePinned: vFollowsHeight };
  }

  it('lays the painting right-handed on every face, walls and ledges alike, never mirrored', () => {
    const h = handedness();
    // [right-handed, mirrored]
    expect(h.walls[1]).toBe(0);
    expect(h.walls[0]).toBeGreaterThan(1000);
    expect(h.tops[1]).toBe(0);
    expect(h.tops[0]).toBeGreaterThan(300);
  });

  it('repeats the painting every SKIN_TILE yards, a figure the painter and the pillars share', () => {
    expect(SKIN_TILE).toBe(16);
    expect(handedness().tilePinned).toBe(true);
  });
});
