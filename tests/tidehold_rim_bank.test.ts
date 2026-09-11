// The tier rims of the ring city: banked, not cliffed.
//
// Troy, 2026-09-09, of the old rim: "increase the topo of these levels so its
// smooth and not jaggy ... make them nice and smooth but still keep the
// levels." Two faults produced it, and this pins both fixes:
//  - PLAN: the tier was a ring of flat discs whose union scalloped the edge in
//    and out by ~1.7yd every 17yd of arc (the row of stone columns).
//  - SECTION: 'flat' falloff dropped all 14-16yd between two terrain samples.
// It also pins what must NOT change: the tiers are still tiers, and nothing
// the generator builds stands on the new slope.
import { describe, expect, it } from 'vitest';
import { setActiveWorldContent } from '../src/sim/data';
import { RIM_BANK, ringPlacements } from '../src/sim/deepglass/citadel_ring';
import {
  pol,
  RING_AVENUES,
  RING_CROWN,
  RING_CX,
  RING_CZ,
  RING_MIDDLE,
  RING_OUTER,
} from '../src/sim/deepglass/citadel_ring_frame';
import { buildDeepglassWorld, DEEPGLASS_MAP_ENTRY } from '../src/sim/deepglass/world';
import { terrainHeight } from '../src/sim/world';

const SEED = DEEPGLASS_MAP_ENTRY.seed;
// Bearings clear of the four avenues, whose stair flights deliberately cut
// stepped lanes through every rim.
const CLEAR_BEARINGS = [0.7, 1.9, 2.7, -0.7, -1.9, -2.7].filter((phi) =>
  RING_AVENUES.every((av) => Math.abs(Math.atan2(Math.sin(phi - av), Math.cos(phi - av))) > 0.5),
);

function height(r: number, phi: number): number {
  const p = pol(r, phi);
  return terrainHeight(p.x, p.z, SEED);
}

describe('the tier rims are banked', () => {
  setActiveWorldContent(buildDeepglassWorld());

  for (const [name, tier, below] of [
    ['crown', RING_CROWN, RING_MIDDLE.y],
    ['middle', RING_MIDDLE, RING_OUTER.y],
  ] as const) {
    const bank = RIM_BANK[name];
    it(`${name}: falls to the tier below over yards, not one sample`, () => {
      const from = tier.r1 - bank.in - 3;
      const to = tier.r1 + bank.out + 3;
      for (const phi of CLEAR_BEARINGS) {
        let worst = 0;
        let prev = height(from, phi);
        for (let r = from; r <= to; r += 0.5) {
          const h = height(r, phi);
          worst = Math.max(worst, prev - h);
          // Monotonic: a bank that climbs again is a lip a player trips on.
          expect(h, `${name} @${phi} r${r}`).toBeLessThanOrEqual(prev + 0.01);
          prev = h;
        }
        // The whole drop is 14-16yd; no half-yard step may carry a third of it.
        // The whole drop is 14-16yd over 6-8; no half-yard sample may carry a
        // sixth of it, which is what a bank with an eased face buys.
        expect(worst, `${name} @${phi} worst step`).toBeLessThan(2.4);
        expect(height(from, phi)).toBeCloseTo(tier.y, 1);
        expect(height(to, phi)).toBeCloseTo(below, 1);
      }
    });

    it(`${name}: the rim is a circle, not a scallop`, () => {
      // Sample a whole quadrant just inside the crest. Before the fix this
      // flipped between the two tier heights as the disc union came and went.
      const at = tier.r1 - bank.in - 2;
      const vals: number[] = [];
      for (const phi of CLEAR_BEARINGS) {
        for (let d = -0.2; d <= 0.2; d += 0.05) vals.push(height(at, phi + d));
      }
      expect(Math.max(...vals) - Math.min(...vals), 'rim wobble').toBeLessThan(0.5);
      expect(vals[0]).toBeCloseTo(tier.y, 1);
    });
  }

  it('the quay keeps its hard harbour edge', () => {
    for (const phi of CLEAR_BEARINGS) {
      expect(height(RING_OUTER.r1 - 2, phi)).toBeCloseTo(RING_OUTER.y, 1);
    }
  });

  it('nothing the generator builds stands on a bank', () => {
    // Fences, walls and their pillars are seated on the ground where they
    // stand, so a piece on the slope leans or floats. Plot bands and the crown
    // wall are placed to clear the banks; this is what says so.
    const flat = (x: number, z: number): number => {
      const h = terrainHeight(x, z, SEED);
      let worst = 0;
      for (const [dx, dz] of [
        [1.5, 0],
        [-1.5, 0],
        [0, 1.5],
        [0, -1.5],
      ] as const) {
        worst = Math.max(worst, Math.abs(terrainHeight(x + dx, z + dz, SEED) - h));
      }
      return worst;
    };
    const watched = /garden_iron_fence|warden_wall|warden_tower/;
    let steep = 0;
    for (const p of ringPlacements() as { path: string; x: number; z: number }[]) {
      if (!watched.test(p.path)) continue;
      // The stair flights step through the rims on purpose; a piece beside one
      // sits on its shoulder by design.
      const phi = Math.atan2(p.x - RING_CX, p.z - RING_CZ);
      if (
        RING_AVENUES.some(
          (av) => Math.abs(Math.atan2(Math.sin(phi - av), Math.cos(phi - av))) < 0.22,
        )
      )
        continue;
      if (flat(p.x, p.z) > 2.2) steep++;
    }
    expect(steep, 'pieces standing on a slope').toBe(0);
  });
});
