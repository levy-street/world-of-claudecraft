// The natural-relief terrain stack (src/sim/terrain_relief.ts + its wiring in
// world.ts baseHeight): domain-warped gradient-damped hills, ridged crag
// crests on the uplands, and the calm field that eases every character layer
// off around roads, camps, hubs, and the Drakemaw's graded volcano benches.
import { describe, expect, it } from 'vitest';
import { erodedFbm2, noise2d, ridged2, warpedCoords } from '../src/sim/terrain_relief';
import { terrainHeight } from '../src/sim/world';
import { WORLD_SEED } from '../src/sim/world_seed';

const SEED = WORLD_SEED;

describe('noise primitives', () => {
  it('noise2d matches central-difference derivatives', () => {
    const eps = 1e-4;
    for (let i = 0; i < 200; i++) {
      const x = (i * 0.73) % 17.3;
      const y = (i * 1.31) % 23.7;
      const n = noise2d(x, y, 907);
      const v = n.v;
      const dx = n.dx;
      const dy = n.dy;
      const vxp = noise2d(x + eps, y, 907).v;
      const vxm = noise2d(x - eps, y, 907).v;
      expect(dx).toBeCloseTo((vxp - vxm) / (2 * eps), 3);
      const vyp = noise2d(x, y + eps, 907).v;
      const vym = noise2d(x, y - eps, 907).v;
      expect(dy).toBeCloseTo((vyp - vym) / (2 * eps), 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('erodedFbm2 and ridged2 stay bounded and deterministic', () => {
    for (let i = 0; i < 500; i++) {
      const x = i * 3.7;
      const z = i * 2.3;
      const e = erodedFbm2(x * 0.013, z * 0.013, SEED, 4, 0.9);
      expect(e).toBeGreaterThanOrEqual(0);
      expect(e).toBeLessThanOrEqual(1);
      expect(e).toBe(erodedFbm2(x * 0.013, z * 0.013, SEED, 4, 0.9));
      const r = ridged2(x * 0.014, z * 0.014, SEED + 11, 3);
      expect(r).toBeGreaterThanOrEqual(0);
      expect(r).toBeLessThanOrEqual(1);
      expect(r).toBe(ridged2(x * 0.014, z * 0.014, SEED + 11, 3));
    }
  });

  it('warpedCoords with ampScale 0 is the identity', () => {
    const w = warpedCoords(123.4, -56.7, SEED, 0);
    expect(w.x).toBe(123.4);
    expect(w.z).toBe(-56.7);
  });
});

describe('the calm field keeps graded features on their exact classic terrain', () => {
  // Golden heights captured from the pre-relief heightfield (the v0.35
  // release base) at points where calm is exactly 0: road centerlines, camp
  // cores, hub cores, and the Drakemaw's escape-graded benches. At calm 0
  // the blend must return the LEGACY field bit for bit, so these pins hold
  // to full float precision; a drift here means a road, camp pad, or graded
  // bench no longer stands on the terrain it was built against.
  const goldens: [string, number, number, number][] = [
    ['vale road', 0, 160, -3.3480606337549164],
    ['peaks road', -98, 727, 10.139872348652359],
    ['marsh road', 20, 470, -1.769678368869094],
    ['frost road', -73, 1696, 13.619770689175878],
    ['peaks camp core', -90, 700, 12.536439409032718],
    ['tiny camp core', -78, 716, 13.501711523786856],
    ['ember camp core', 392, 2296, 10.399999999999999],
    ['vale hub core', 0, 0, 1.5],
    ['drakemaw bench n', 390, 2330, 13.5055094022491],
    ['drakemaw bench s', 390, 2308, 13.4],
    ['drakemaw bench e', 402, 2320, 13.4],
    ['cone crater 2', 270, 2282, 11.5],
    ['cone crater 3', 487, 2356, 9.5],
  ];
  it.each(goldens)('%s keeps its classic height', (_name, x, z, h) => {
    expect(terrainHeight(x, z, SEED)).toBeCloseTo(h, 9);
  });
});

describe('the relief actually shapes the world', () => {
  it('Thornpeak carries real mountains and crags now', () => {
    // interior box well away from the border walls and the hub
    let maxH = -Infinity;
    let steep = 0;
    let n = 0;
    for (let x = -150; x <= 150; x += 5) {
      for (let z = 580; z <= 860; z += 5) {
        const h = terrainHeight(x, z, SEED);
        if (h > maxH) maxH = h;
        const e = 0.5;
        const hx = (terrainHeight(x + e, z, SEED) - terrainHeight(x - e, z, SEED)) / (2 * e);
        const hz = (terrainHeight(x, z + e, SEED) - terrainHeight(x, z - e, SEED)) / (2 * e);
        if (Math.hypot(hx, hz) > 1.5) steep++;
        n++;
      }
    }
    // the pre-relief interior topped out around 27 with under 1% steep
    // ground; the crag layer makes the mountain realm actually mountainous.
    // The floor sits at 2.5%: the placement-integrity calm pads (dungeon
    // doors, the Duskfall portal, graveyards, camps) legitimately level the
    // ground gameplay stands on, which trims the steep fraction without
    // touching the crags between pads.
    expect(maxH).toBeGreaterThan(38);
    expect(steep / n).toBeGreaterThan(0.025);
  });

  it('the wetlands stay calm', () => {
    // the Willowfen keeps crag 0: gentle wet lowland, no spikes
    let steep = 0;
    let n = 0;
    for (let x = -150; x <= 150; x += 5) {
      for (let z = 1300; z <= 1500; z += 5) {
        const e = 0.5;
        const hx = (terrainHeight(x + e, z, SEED) - terrainHeight(x - e, z, SEED)) / (2 * e);
        const hz = (terrainHeight(x, z + e, SEED) - terrainHeight(x, z - e, SEED)) / (2 * e);
        if (Math.hypot(hx, hz) > 1.5) steep++;
        n++;
      }
    }
    expect(steep / n).toBeLessThan(0.05);
  });
});
