// The rune lanterns' flame placement. This is geometry that is invisible when
// it is wrong in the cheap way (a flame sealed inside an opaque lamp) and
// glaring when it is wrong in the expensive way (a flame hanging in the air
// beside its lantern), so it is pinned here rather than by eye.
import { describe, expect, it } from 'vitest';
import {
  LANTERN_ARM_LOCAL,
  LANTERN_FLAME,
  LANTERN_LAMP_LOCAL,
  LANTERN_SEED_STRIDE,
  lanternLampWorld,
  lanternMoteSeeds,
  lanternSeed,
} from '../src/render/battleground_lantern_fx_core';
import { TH_PLACEMENTS } from '../src/sim/thornhollow_field.generated';

const RUNE_PADS = [
  { x: 0, z: -91 },
  { x: 0, z: 91 },
  { x: -38, z: 0 },
  { x: 38, z: 0 },
  { x: 13, z: -48 },
  { x: -13, z: 48 },
];

const lanterns = TH_PLACEMENTS.filter((p) => p.assetId === 'dungeon/post_lantern');

describe('lantern lamp placement', () => {
  it('puts an unrotated post its arm length out along +z', () => {
    const lamp = lanternLampWorld({ x: 10, z: -4, rotY: 0, scale: 1, seatY: 2 });
    expect(lamp.x).toBeCloseTo(10, 6);
    expect(lamp.z).toBeCloseTo(-4 + LANTERN_LAMP_LOCAL.z, 6);
    expect(lamp.y).toBeCloseTo(2 + LANTERN_LAMP_LOCAL.y, 6);
  });

  it('carries the arm around with rotY, and scales its reach', () => {
    // A quarter turn takes the arm from +z to +x (rotY maps +Z -> (sin, cos)).
    const lamp = lanternLampWorld({ x: 0, z: 0, rotY: Math.PI / 2, scale: 2, seatY: 0 });
    expect(lamp.x).toBeCloseTo(LANTERN_LAMP_LOCAL.z * 2, 6);
    expect(lamp.z).toBeCloseTo(0, 6);
    expect(lamp.y).toBeCloseTo(LANTERN_LAMP_LOCAL.y * 2, 6);
  });

  it('leaves the lamp on the post when the arm has no reach', () => {
    const lamp = lanternLampWorld({ x: 5, z: 5, rotY: 1.234, scale: 0, seatY: 1 });
    expect(lamp.x).toBeCloseTo(5, 6);
    expect(lamp.z).toBeCloseTo(5, 6);
  });
});

describe('the shipped rune lanterns', () => {
  it('rings every rune pad with four posts', () => {
    for (const pad of RUNE_PADS) {
      const ring = lanterns.filter((p) => Math.hypot(p.x - pad.x, p.z - pad.z) < 5);
      expect(ring.length, `pad ${pad.x},${pad.z}`).toBe(4);
    }
  });

  it('aims every post INWARD, so all four hang their lamp over the pad', () => {
    // The bug this pins: the posts used to carry rotY = a (their own bearing
    // from the pad), which pointed each one a different way round the ring.
    for (const pad of RUNE_PADS) {
      const ring = lanterns.filter((p) => Math.hypot(p.x - pad.x, p.z - pad.z) < 5);
      for (const post of ring) {
        const postDist = Math.hypot(post.x - pad.x, post.z - pad.z);
        const lamp = lanternLampWorld(post);
        const lampDist = Math.hypot(lamp.x - pad.x, lamp.z - pad.z);
        // The arm reaches the pad's full scale length toward the centre.
        expect(lampDist).toBeLessThan(postDist);
        expect(postDist - lampDist).toBeCloseTo(LANTERN_ARM_LOCAL.z * post.scale, 2);
      }
    }
  });

  it('hangs every lamp at the same height above its own seat', () => {
    for (const post of lanterns) {
      expect(lanternLampWorld(post).y - post.seatY).toBeCloseTo(
        LANTERN_LAMP_LOCAL.y * post.scale,
        6,
      );
    }
  });
});

describe('flame tuning stays inside its lamp', () => {
  it('keeps a mote within the glass it is lit in', () => {
    // The glass runs 1.90..2.15 in model units (measured off the mesh; see
    // LANTERN_LAMP_LOCAL). A mote starts at the middle and climbs `rise`, so
    // the climb must not exceed the half-height, or the flame burns out
    // through the lamp's own roof.
    const glassHalfHeight = ((2.15 - 1.9) / 2) * 1.5; // at the shipped post scale
    expect(LANTERN_FLAME.rise).toBeLessThanOrEqual(glassHalfHeight + 1e-9);
    // And its spawn ring has to fit the glass's waist.
    expect(LANTERN_FLAME.radius).toBeLessThan(0.16 * 1.5);
  });
});

describe('flame seeds', () => {
  it('is deterministic, in range, and one block per mote', () => {
    const seeds = lanternMoteSeeds(5);
    expect(seeds).toHaveLength(5 * LANTERN_SEED_STRIDE);
    for (const s of seeds) {
      expect(s).toBeGreaterThanOrEqual(0);
      expect(s).toBeLessThan(1);
    }
    expect(Array.from(lanternMoteSeeds(5))).toEqual(Array.from(seeds));
    // Two lanterns' worth must not repeat the first lantern's phases, or a
    // ring of four strobes in lockstep instead of burning.
    const wide = lanternMoteSeeds(18);
    expect(wide[2]).not.toBeCloseTo(wide[9 * LANTERN_SEED_STRIDE + 2], 6);
  });

  it('separates its channels', () => {
    expect(lanternSeed(3, 1)).not.toBeCloseTo(lanternSeed(3, 2), 6);
  });
});
