// The world's outer margins end in coast, not cliff. Two bug classes pinned:
//
// 1. applyWorldEdgeSea measured its margin against worldXBoundsAt, a STEP
//    function of z: at the Amberfall's zMax the west column's rows vanish
//    and the whole z = 2380 line was an instant 16yd wall into sunk sea.
//    The margin is now measured against each column's own north end.
// 2. Land used to stand at full height right up to the sink band, ending the
//    map in sheer plateau walls (the report: the Drakelands' east shore, the
//    Amberfall's west and north, the Reach's north headlands). The margin
//    now shaves tall ground to a walkable bank rising from the beach, and
//    the north bay's dry headlands taper into low spits.
//
// The dry-cliff sweep asserts the RIDDEN surface (water clamps a seabed
// step): underwater canyons are invisible and legal; dry walls are not.

import { describe, expect, it } from 'vitest';
import { groundHeight, WATER_LEVEL, waterLevelAt } from '../src/sim/world';

// The production seed: the reported cliffs are seed-pinned world geometry.
const SEED = 20061;

function ride(x: number, z: number): number {
  return Math.max(groundHeight(x, z, SEED), waterLevelAt(x, z, SEED));
}

describe('the world edges end in coast, not cliff', () => {
  it('the Amberfall north boundary has no instant wall (z = 2380)', () => {
    const bad: string[] = [];
    for (let x = -536; x <= -186; x += 2) {
      const step = Math.abs(ride(x, 2380.02) - ride(x, 2379.98));
      if (step > 0.35) bad.push(`x=${x}: step ${step.toFixed(2)}`);
    }
    expect(bad, bad.slice(0, 8).join('\n')).toEqual([]);
  });

  it('no dry land survives past the Reach north boundary (z = 1960)', () => {
    // Land past the zone line stands in no-zone space, where zoneAt falls
    // back to the Amberfall: the HUD shows the wrong realm and the map has
    // no tiles there (the reported glitch). The Reach's north shore must end
    // inside its own band; everything beyond is the bay's open water. The
    // two isthmus crossings at z 1890 sit south of this sweep, untouched.
    const bad: string[] = [];
    for (let x = -179; x <= 179; x += 1) {
      for (let z = 1960; z <= 2100; z += 2) {
        const h = groundHeight(x, z, SEED);
        if (h > WATER_LEVEL - 0.05) bad.push(`(${x}, ${z}): h ${h.toFixed(2)}`);
      }
    }
    expect(bad, bad.slice(0, 10).join('\n')).toEqual([]);
  });

  it('no sheer face rises straight out of the shore on the named margins', () => {
    // walk each margin from 150yd inland out past the boundary; a 2yd
    // advance whose LOWER side sits near the waterline must stay under a
    // bank gradient (the pre-fix walls measured 5 to 16yd per 2yd step
    // straight off the water). Faces rooted higher up are interior terrain
    // (the Drakemaw's volcanic cones), intended and exempt.
    const MAX_RISE_PER_2YD = 4;
    const bad: string[] = [];
    const sweep = (
      name: string,
      pt: (d: number, t: number) => [number, number],
      tLo: number,
      tHi: number,
    ) => {
      for (let t = tLo; t <= tHi; t += 8) {
        let prev: number | null = null;
        for (let d = 150; d >= -10; d -= 2) {
          const [x, z] = pt(d, t);
          const r = ride(x, z);
          if (prev !== null) {
            const rise = Math.abs(r - prev);
            const wl = waterLevelAt(x, z, SEED);
            const shoreRooted = Math.min(r, prev) < wl + 3;
            if (rise > MAX_RISE_PER_2YD && shoreRooted && r > wl + 0.05 && prev > wl + 0.05) {
              bad.push(`${name} t=${t} d=${d}: rise ${rise.toFixed(1)}`);
            }
          }
          prev = r;
        }
      }
    };
    sweep('drake east', (d, z) => [540 - d, z], 1830, 2410);
    sweep('drake north', (d, x) => [x, 2420 - d], 190, 530);
    sweep('amber west', (d, z) => [-540 + d, z], 1830, 2370);
    sweep('amber north', (d, x) => [x, 2380 - d], -530, -190);
    sweep('frost north bay', (d, x) => [x, 2040 - d], -170, 170);
    expect(bad, bad.slice(0, 10).join('\n')).toEqual([]);
  });
});
