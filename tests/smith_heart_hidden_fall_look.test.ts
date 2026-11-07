// Mythic's hidden phase, the weak-spots pass of 2026-11-04: a fallen quarter's
// root of the mountain goes with its landmark (never left hanging over the
// hole), and the abyss under it keeps its depth seen from a body's height (no
// lit floor of stacked layers edge on).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  HEART_COLLAPSE_LOOK,
  HEART_FALL_DEPTH,
  HEART_FALL_VEIL,
  heartLandmarkFall,
  heartRootFall,
} from '../src/render/smith_heart/heart_collapse_core';
import { DEPTH_FRAG, DEPTH_VERT } from '../src/render/smith_heart/heart_collapse_glsl';

describe('Smith Heart hidden phase: the root falls with its quarter', () => {
  it('stands whole until its landmark starts to go, then tears out after it', () => {
    expect(heartRootFall(-1)).toEqual({ drop: 0, gone: false });
    expect(heartRootFall(HEART_COLLAPSE_LOOK.landmarkAt).drop).toBe(0);
    let last = 0;
    for (let t = 0; t <= 8; t += 0.25) {
      const r = heartRootFall(t);
      expect(r.drop).toBeGreaterThanOrEqual(last);
      last = r.drop;
    }
    expect(heartRootFall(3).drop).toBeGreaterThan(10);
  });

  it('is gone from sight no sooner than its landmark, and gone once the fall has played', () => {
    for (let t = 0; t <= 10; t += 0.1) {
      if (heartRootFall(t).gone) expect(heartLandmarkFall(t).gone).toBe(true);
    }
    expect(
      heartRootFall(HEART_COLLAPSE_LOOK.landmarkAt + HEART_COLLAPSE_LOOK.landmarkSeconds + 1).gone,
    ).toBe(true);
  });

  it("drives every vein's root from the quarters' frame", () => {
    const q = readFileSync('src/render/smith_heart/heart_quarters.ts', 'utf8');
    expect(q).toMatch(/const rf = heartRootFall\(fallT\);/);
    const kit = readFileSync('src/render/smith_heart/heart_room_kit.ts', 'utf8');
    expect(kit).toMatch(/root: \(vein\) => roots\.get\(vein\) \?\? null/);
    const interior = readFileSync('src/render/smith_heart/heart_interior.ts', 'utf8');
    expect(interior).toMatch(/buildHeartQuarters\(deps\.lowGfx, heartKit\.altar, heartKit\.root\)/);
  });
});

describe('Smith Heart hidden phase: the abyss keeps its depth', () => {
  it('spreads its layers deep under the keel, the veil under the deepest', () => {
    expect(HEART_FALL_DEPTH.length).toBeGreaterThanOrEqual(4);
    const ys = HEART_FALL_DEPTH.map((l) => l.y);
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThanOrEqual(25);
    expect(HEART_FALL_VEIL.y).toBeLessThan(Math.min(...ys));
  });

  it('fades a layer seen edge on, so it never stacks into a lit floor', () => {
    expect(DEPTH_VERT).toMatch(/vDown = abs\(dot\(normalize\(mv\.xyz\), up\)\);/);
    expect(DEPTH_FRAG).toMatch(/float face = smoothstep\(0\.06, 0\.5, vDown\);/);
    expect(DEPTH_FRAG).toMatch(/\* face, 1\.0\)/);
  });
});
