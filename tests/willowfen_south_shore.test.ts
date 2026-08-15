// The Willowfen's south edge is the world's SOUTHWEST PERIMETER, and it used
// to end in a ruled cliff.
//
// The west column starts at the fen, so everything south of its zMin is open
// ocean and nothing shaped that coast. Two appliers met on the z = FEN_ZMIN
// line and both got it wrong:
//   - applyFenCoast cross-fades its own carve OUT across zMin +-8 (a zone-seam
//     fade with no southern neighbour to yield to), so the un-carved base field
//     stood back up as a lip of DRY ground along the whole line;
//   - the row-bound carve in terrainHeightUnpadded switched ON south of it
//     (worldXBoundsAt is a STEP function of z, the same trap the Amberfall's
//     z = 2380 wall hit in tests/world_edge_coast.test.ts), dropping the ground
//     straight to the seabed.
// Measured before the fix: a dry step of up to 11.78 yards running the fen's
// whole 330 yard south edge, reported from the water as a hard edge on the map.

import { describe, expect, it } from 'vitest';
import { NPCS, PROPS, ROADS, ZONES } from '../src/sim/data';
import { groundHeight, terrainHeight, WATER_LEVEL, waterLevelAt } from '../src/sim/world';

// The production seed: this is seed-pinned world geometry.
const SEED = 20061;
const FEN_ZMIN = 180;

const ride = (x: number, z: number): number =>
  Math.max(groundHeight(x, z, SEED), waterLevelAt(x, z, SEED));

describe("the Willowfen's south shore ends in coast, not cliff", () => {
  it('has no ridden step along the z = 180 perimeter line', () => {
    // The same 0.04yd-gap measure tests/terrain_window_seams.test.ts uses: a
    // true discontinuity shows nearly its full height across the gap, while the
    // steepest intended slope contributes only ~gradient * 0.04.
    const bad: string[] = [];
    for (let x = -566; x <= -170; x += 2) {
      const step = Math.abs(ride(x, FEN_ZMIN + 0.02) - ride(x, FEN_ZMIN - 0.02));
      if (step > 0.35) bad.push(`x=${x}: step ${step.toFixed(2)}`);
    }
    expect(bad, bad.slice(0, 8).join('\n')).toEqual([]);
  });

  it('rises no sheer face out of the water anywhere along that shore', () => {
    // Walk in from 150yd offshore to 30yd inland. A 2yd advance whose LOWER
    // side sits near the waterline must stay under a bank gradient; faces
    // rooted higher up are interior terrain and are exempt.
    const MAX_RISE_PER_2YD = 4;
    const bad: string[] = [];
    for (let x = -560; x <= -200; x += 6) {
      let prev: number | null = null;
      for (let d = 150; d >= -30; d -= 2) {
        const z = FEN_ZMIN + d;
        const r = ride(x, z);
        const wl = waterLevelAt(x, z, SEED);
        if (prev !== null) {
          const rise = Math.abs(r - prev);
          const shoreRooted = Math.min(r, prev) < wl + 3;
          if (rise > MAX_RISE_PER_2YD && shoreRooted && r > wl + 0.05 && prev > wl + 0.05) {
            bad.push(`x=${x} z=${z}: rise ${rise.toFixed(1)}`);
          }
        }
        prev = r;
      }
    }
    expect(bad, bad.slice(0, 8).join('\n')).toEqual([]);
  });

  it('drowns the shore progressively instead of on one ruled line', () => {
    // The waterline must WANDER: sample where the ground first breaks the
    // surface along the shore and assert the contour is not a straight line.
    const shoreZ: number[] = [];
    for (let x = -520; x <= -260; x += 10) {
      let found: number | null = null;
      for (let z = 150; z <= 320; z += 1) {
        if (terrainHeight(x, z, SEED) > WATER_LEVEL) {
          found = z;
          break;
        }
      }
      if (found !== null) shoreZ.push(found);
    }
    expect(shoreZ.length).toBeGreaterThan(15);
    const min = Math.min(...shoreZ);
    const max = Math.max(...shoreZ);
    // A ruled edge would put every sample on the same z. Real coves and spits
    // spread it over tens of yards.
    expect(max - min, `shore contour spans only ${max - min}yd`).toBeGreaterThan(25);
  });

  it('keeps every piece of authored fen content on dry ground', () => {
    // The shore carves toward the seabed, so the content standing nearest it
    // (the Amberfen Steps' waykeeper, its POI, the stair dressing, the south
    // roads and camps) is what a too-greedy carve would drown.
    const dry: [string, number, number][] = [];
    const pell = NPCS.waykeeper_pell;
    if (pell?.pos) dry.push(['waykeeper_pell', pell.pos.x, pell.pos.z]);
    for (const zone of ZONES) {
      if (zone.id !== 'willowfen') continue;
      for (const poi of zone.pois ?? []) {
        if (poi.z <= 320) dry.push([`poi ${poi.id}`, poi.x, poi.z]);
      }
    }
    // ZonePropsDef is a named-field record of prop arrays, not an index
    // signature, so widen through unknown to walk every family generically.
    for (const [key, list] of Object.entries(PROPS as unknown as Record<string, unknown>)) {
      for (const p of (Array.isArray(list) ? list : [list]) as { x?: number; z?: number }[]) {
        if (typeof p?.x !== 'number' || typeof p?.z !== 'number') continue;
        if (p.x <= -180 && p.z >= 180 && p.z <= 320) dry.push([`prop ${key}`, p.x, p.z]);
      }
    }
    for (const road of ROADS) {
      for (const p of road) {
        if (p.x <= -180 && p.z >= 180 && p.z <= 300) dry.push([`road`, p.x, p.z]);
      }
    }
    expect(dry.length, 'nothing sampled: the content tables moved').toBeGreaterThan(8);
    const drowned = dry
      .filter(([, x, z]) => terrainHeight(x, z, SEED) <= WATER_LEVEL)
      .map(([n, x, z]) => `${n} (${x}, ${z}) h=${terrainHeight(x, z, SEED).toFixed(2)}`);
    expect(drowned, drowned.join('\n')).toEqual([]);
  });

  it('leaves the other world boundary lines untouched', () => {
    // The fix is local to the southwest perimeter. Every other row line that
    // worldXBoundsAt steps on must stay exactly as clean as it already was.
    const bad: string[] = [];
    for (const line of [540, 700, 900, 1260, 1440, 1820, 1960, 2380]) {
      for (let x = -560; x <= 560; x += 4) {
        const a = ride(x, line - 0.02);
        const b = ride(x, line + 0.02);
        const wl = Math.max(waterLevelAt(x, line - 0.02, SEED), waterLevelAt(x, line + 0.02, SEED));
        if (a > wl + 0.05 && b > wl + 0.05 && Math.abs(a - b) > 0.35) {
          bad.push(`z=${line} x=${x}: step ${Math.abs(a - b).toFixed(2)}`);
        }
      }
    }
    expect(bad, bad.slice(0, 8).join('\n')).toEqual([]);
  });
});
