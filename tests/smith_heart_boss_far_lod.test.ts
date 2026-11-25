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
import { animCadenceFrames, CHARACTER_LOD_RANGE } from '../src/render/crowd_lod';
import { latchFarLod } from '../src/render/far_lod_latch';
import {
  awaitsScriptedPose,
  keepsArticulatedRig,
  noteScriptedGesture,
  SCRIPTED_POSE_SETTLE,
  SMITH_HEART_SCRIPTED_POSE_BOSSES,
  scriptedPoseHidden,
} from '../src/render/smith_heart_fx/boss_far_lod_core';
import { SMITH_HEART_FINAL_BOSS, SMITH_HEART_GUARDIANS } from '../src/sim/content/smith_heart';
import { BREATH_AURAS } from '../src/sim/encounters/smith_heart/breath_ids';
import { BREATH_INTRO } from '../src/sim/encounters/smith_heart/breath_intro_plan';
import {
  COUNCIL_AURAS,
  COUNCIL_GUARDIAN,
  COUNCIL_SEAM_SINGER,
} from '../src/sim/encounters/smith_heart/council_ids';
import { COUNCIL_INTRO } from '../src/sim/encounters/smith_heart/council_intro_plan';
import { HEAT_AURAS } from '../src/sim/encounters/smith_heart/heat_ids';
import { HEAT_INTRO } from '../src/sim/encounters/smith_heart/heat_intro_plan';
import { QUENCH_AURAS } from '../src/sim/encounters/smith_heart/quench_ids';

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
    for (const reach of [COUNCIL_INTRO.reach, HEAT_INTRO.reach])
      expect(reach).toBeLessThanOrEqual(CHARACTER_LOD_RANGE + 1);
    // The Breath's wakes from across the chasm (its landing, 2026-11-25), past
    // the band: its rig there neither swaps nor drops to the far cadence.
    expect(BREATH_INTRO.reach).toBeGreaterThan(CHARACTER_LOD_RANGE + 1);
  });

  it('plays every entrance at no less than the mid cadence from its wake reach', () => {
    const breath = SMITH_HEART_GUARDIANS.breath;
    for (const reach of [BREATH_INTRO.reach, COUNCIL_INTRO.reach, HEAT_INTRO.reach, 150]) {
      expect(everFar(breath, reach)).toBe(false);
      expect(animCadenceFrames(yd(reach), BANDS, keepsArticulatedRig(breath))).toBe(
        BANDS.midCadence,
      );
    }
    // Any other body still slows past the band.
    expect(animCadenceFrames(yd(BREATH_INTRO.reach), BANDS, false)).toBeGreaterThan(
      BANDS.midCadence,
    );
    const src = readFileSync('src/render/renderer.ts', 'utf8');
    expect(src).toContain('animCadenceFrames(d2, lodBands, keepsArticulatedRig(e.templateId));');
  });

  it('casts its own shadow too (the static-pose proxy shadow would stand it up)', () => {
    const src = readFileSync('src/render/renderer.ts', 'utf8');
    expect(src).toContain('wantShadow = d2 < shadowRangeSq || keepsArticulatedRig(e.templateId);');
  });
});

describe('a boss awaiting its entrance never draws a frame out of its scripted pose', () => {
  const breath = (intro: number | null) => ({
    templateId: SMITH_HEART_GUARDIANS.breath,
    auras: intro === null ? [] : [{ id: BREATH_AURAS.intro, value: intro }],
  });

  it('holds every boss with an entrance aura, and the final boss always', () => {
    expect(awaitsScriptedPose(breath(0))).toBe(true);
    expect(awaitsScriptedPose(breath(1))).toBe(true);
    expect(awaitsScriptedPose(breath(null))).toBe(false);
    for (const [tpl, aura] of [
      [COUNCIL_GUARDIAN, COUNCIL_AURAS.intro],
      [COUNCIL_SEAM_SINGER, COUNCIL_AURAS.intro],
      [SMITH_HEART_GUARDIANS.quench, QUENCH_AURAS.intro],
      [SMITH_HEART_GUARDIANS.heat, HEAT_AURAS.intro],
    ] as const)
      expect(awaitsScriptedPose({ templateId: tpl, auras: [{ id: aura }] }), tpl).toBe(true);
    expect(awaitsScriptedPose({ templateId: SMITH_HEART_FINAL_BOSS, auras: [] })).toBe(true);
    // A trash mob wearing the aura id is never held.
    expect(
      awaitsScriptedPose({
        templateId: 'heart_breath_warder',
        auras: [{ id: BREATH_AURAS.intro }],
      }),
    ).toBe(false);
  });

  it('a fresh rig is hidden from its first frame until a gesture reaches it and settles', () => {
    const rig = {};
    const e = breath(0);
    // Built: no gesture yet, however long it waits.
    expect(scriptedPoseHidden(rig, e, 10)).toBe(true);
    expect(scriptedPoseHidden(rig, e, 99)).toBe(true);
    noteScriptedGesture(rig, 100);
    expect(scriptedPoseHidden(rig, e, 100)).toBe(true);
    expect(scriptedPoseHidden(rig, e, 100 + SCRIPTED_POSE_SETTLE - 0.01)).toBe(true);
    expect(scriptedPoseHidden(rig, e, 100 + SCRIPTED_POSE_SETTLE + 0.001)).toBe(false);
    // A later gesture never restarts the wait.
    noteScriptedGesture(rig, 200);
    expect(scriptedPoseHidden(rig, e, 101)).toBe(false);
    // A rebuilt rig (the view kept, its visual new) waits again.
    expect(scriptedPoseHidden({}, e, 500)).toBe(true);
    // The entrance played (no aura): never held.
    expect(scriptedPoseHidden({}, breath(null), 0)).toBe(false);
  });

  it('the renderer notes every gesture on the rig and gates each view on it', () => {
    const src = readFileSync('src/render/renderer.ts', 'utf8');
    expect(src).toContain('noteScriptedGesture(visual, this.time);');
    expect(src).toContain('!scriptedPoseHidden(this.activeVisual(v) ?? v, e, this.time);');
  });
});
