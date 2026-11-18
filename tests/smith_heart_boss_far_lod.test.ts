// The Smith's Heart bosses never draw as the static far LOD (Jose's playtest
// of 2026-11-18: a boss waiting for its entrance stood in the open from afar,
// then vanished as the raid came in range and played its entrance). Past the
// articulated band the stock-pose far bake stood the body up; the band's edge
// (58 yd) is every entrance's wake reach, so the swap and the wake landed
// together. Each boss now keeps its rig (and its own shadow) at every
// distance, so its scripted dormant clip (gathered, fused in rock, under the
// ice, cold coal, the kneeling statue) is what the raid sees from afar.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CharacterLodBands } from '../src/render/crowd_lod';
import { CHARACTER_LOD_RANGE } from '../src/render/crowd_lod';
import { latchFarLod } from '../src/render/far_lod_latch';
import {
  keepsArticulatedRig,
  SMITH_HEART_SCRIPTED_POSE_BOSSES,
} from '../src/render/smith_heart_fx/boss_far_lod_core';
import { SMITH_HEART_FINAL_BOSS, SMITH_HEART_GUARDIANS } from '../src/sim/content/smith_heart';
import { BREATH_INTRO } from '../src/sim/encounters/smith_heart/breath_intro_plan';
import {
  COUNCIL_GUARDIAN,
  COUNCIL_SEAM_SINGER,
} from '../src/sim/encounters/smith_heart/council_ids';
import { COUNCIL_INTRO } from '../src/sim/encounters/smith_heart/council_intro_plan';
import { HEAT_INTRO } from '../src/sim/encounters/smith_heart/heat_intro_plan';

const yd = (d: number) => d * d;
const BANDS: CharacterLodBands = {
  shadowRangeSq: yd(25),
  lodRangeSq: yd(58),
  staticRangeSq: yd(58),
  actionableStaticRangeSq: yd(70),
  midCadence: 2,
  farCadence: 4,
};

function standingAt(templateId: string) {
  return {
    templateId,
    pos: { x: 0, z: 0 },
    prevPos: { x: 0, z: 0 },
    vx: 0,
    vz: 0,
  };
}

/** Hold a still body `d` yards out for two seconds; was it ever far? */
function everFar(templateId: string, d: number): boolean {
  const view = { isFar: false };
  const e = standingAt(templateId);
  let far = false;
  for (let i = 0; i < 120; i++) {
    view.isFar = latchFarLod(view, e, 1, false, yd(d), BANDS, false, i / 60);
    far = far || view.isFar;
  }
  return far;
}

describe("the Smith's Heart bosses keep their rig at every distance", () => {
  it('names every boss body of the raid', () => {
    for (const id of [
      ...Object.values(SMITH_HEART_GUARDIANS),
      COUNCIL_GUARDIAN,
      COUNCIL_SEAM_SINGER,
      SMITH_HEART_FINAL_BOSS,
    ])
      expect(keepsArticulatedRig(id), id).toBe(true);
    expect(SMITH_HEART_SCRIPTED_POSE_BOSSES.size).toBe(6);
    expect(keepsArticulatedRig('heart_breath_warder')).toBe(false);
    expect(keepsArticulatedRig(undefined)).toBe(false);
  });

  it('a boss never swaps to the far mesh; any other body still does', () => {
    for (const id of SMITH_HEART_SCRIPTED_POSE_BOSSES) expect(everFar(id, 150), id).toBe(false);
    expect(everFar('heart_breath_warder', 150)).toBe(true);
  });

  it('the wake reach sits on the articulated band (why the swap and the wake landed together)', () => {
    for (const reach of [BREATH_INTRO.reach, COUNCIL_INTRO.reach, HEAT_INTRO.reach])
      expect(reach).toBeLessThanOrEqual(CHARACTER_LOD_RANGE + 1);
  });

  it('casts its own shadow too (the static-pose proxy shadow would stand it up)', () => {
    const src = readFileSync('src/render/renderer.ts', 'utf8');
    expect(src).toContain('wantShadow = d2 < shadowRangeSq || keepsArticulatedRig(e.templateId);');
  });
});
