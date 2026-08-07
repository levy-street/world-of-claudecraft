// The far vista's day/night response, which is the half of the "distant
// terrain ignores the light" report that no amount of haze retuning fixes.
//
// The grade's AMBIENT half deliberately holds a high night floor
// (day_night_core NIGHT_AMBIENT_FLOOR) so terrain shape and silhouettes stay
// readable underfoot. Out on the vista that same floor lands on large
// high-albedo faces (snow caps, pale rim rock) that are almost entirely
// ambient-lit, and they held roughly two thirds of their DAY brightness against
// a sky graded to deep navy: glowing cutout peaks pasted over the night. The
// answer is an albedo multiply on this material alone, so every light term
// comes down together and the surface keeps its light-and-shade ratio.
//
// Two things are pinned here: the grade endpoints (a real numeric contract, on
// the live shared uniforms), and where the multiply lands in the fragment
// splice (source text, the same idiom foliage_impostor_core uses for a
// Three-bound painter: an onBeforeCompile patch fails SILENTLY when its anchor
// or its ordering moves).

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  farTerrainNightInternalsForTest,
  setFarTerrainNightGrade,
} from '../src/render/far_terrain';

const { farNightFloor, farNightDim, FAR_NIGHT_FLOOR, FAR_NIGHT_ALBEDO_DIM } =
  farTerrainNightInternalsForTest;

const SRC = readFileSync(new URL('../src/render/far_terrain.ts', import.meta.url), 'utf8');

describe('the far vista night grade', () => {
  it('is the exact identity by day, so the day frame is byte-identical', () => {
    setFarTerrainNightGrade(0);
    expect(farNightDim.value).toBe(1);
    expect(farNightFloor.value.r).toBe(0);
    expect(farNightFloor.value.g).toBe(0);
    expect(farNightFloor.value.b).toBe(0);
  });

  it('dims the albedo and lifts the floor at deepest night', () => {
    setFarTerrainNightGrade(1);
    expect(farNightDim.value).toBeCloseTo(FAR_NIGHT_ALBEDO_DIM, 9);
    expect(farNightFloor.value.r).toBeCloseTo(FAR_NIGHT_FLOOR[0], 9);
    expect(farNightFloor.value.g).toBeCloseTo(FAR_NIGHT_FLOOR[1], 9);
    expect(farNightFloor.value.b).toBeCloseTo(FAR_NIGHT_FLOOR[2], 9);
  });

  it('actually darkens: a night vista can never be brighter than its day', () => {
    // The regression in the other direction. The floor alone LIFTS the surface,
    // and it shipped as the only night term here, so deep night made the vista
    // brighter than noon on pale ground while the sky went dark.
    setFarTerrainNightGrade(0);
    const day = farNightDim.value + farNightFloor.value.r;
    for (const nightAmt of [0.25, 0.5, 0.75, 1]) {
      setFarTerrainNightGrade(nightAmt);
      expect(farNightDim.value + farNightFloor.value.r).toBeLessThan(day);
    }
  });

  it('walks monotonically with the cycle, so dusk never steps', () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let n = 0; n <= 1.0001; n += 0.05) {
      setFarTerrainNightGrade(Math.min(1, n));
      expect(farNightDim.value).toBeLessThanOrEqual(prev);
      prev = farNightDim.value;
    }
  });

  it('keeps enough of the vista to read as terrain, not a silhouette', () => {
    // A dim is cosmetic here (this material only draws past the detail
    // envelope, so it carries no information a player acts on), but the world
    // must still be legible at night: the ridges are the horizon.
    expect(FAR_NIGHT_ALBEDO_DIM).toBeGreaterThanOrEqual(0.35);
    expect(FAR_NIGHT_ALBEDO_DIM).toBeLessThan(1);
  });
});

describe('where the dim lands in the fragment splice', () => {
  it('multiplies ALBEDO, before any lighting chunk can read it', () => {
    // Albedo is what makes this a uniform dim of sun, hemisphere and IBL at
    // once. Applied after the lights instead, it would either dim only part of
    // the rig or flatten the shading it exists to preserve.
    expect(SRC).toContain('diffuseColor.rgb *= uFarNightDim;');
    const dim = SRC.indexOf('diffuseColor.rgb *= uFarNightDim;');
    expect(dim).toBeGreaterThan(SRC.indexOf("'#include <color_fragment>'"));
    expect(dim).toBeLessThan(SRC.indexOf("'#include <emissivemap_fragment>'"));
  });

  it('lands after the meadow ground paint, so the dim owns the final colour', () => {
    const grass = SRC.indexOf('texture2D(uGrassBake');
    const dim = SRC.indexOf('diffuseColor.rgb *= uFarNightDim;');
    expect(grass).toBeGreaterThan(0);
    expect(dim).toBeGreaterThan(grass);
  });

  it('shapes albedo in ONE patch of the colour chunk, not two passes over it', () => {
    // Chaining a second replace of <color_fragment> only works because the
    // anchor survives inside the first replacement. It reads as independent and
    // is not, so the count is pinned rather than the comment trusted.
    expect(SRC.split("'#include <color_fragment>'").length - 1).toBe(1);
  });

  it('declares the uniform it samples and installs the shared object', () => {
    expect(SRC).toContain('uniform float uFarNightDim;');
    expect(SRC).toContain('shader.uniforms.uFarNightDim = farNightDim;');
  });
});
