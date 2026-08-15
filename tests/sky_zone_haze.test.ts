// The sky dome as a biome-haze consumer (src/render/sky.ts skyFrag): the
// composed fragment either carries the directional horizon-band tint on the
// SHARED haze uniforms, or is byte-identical to the legacy dome. What matters:
// the gate really is compile-time, the tint samples the field along the view
// ray, and it lands BEFORE the dome's own fog band, so the camera zone's fog
// still owns the true rim exactly as it does over every geometry consumer.

import { describe, expect, it } from 'vitest';
import { BIOME_HAZE_DECLARATIONS, biomeHazeUniforms } from '../src/render/biome_haze_field';
import {
  HAZE_AERIAL_MAX,
  HAZE_SKY_SAMPLE_DIST,
  HAZE_SKY_TINT_MAX,
} from '../src/render/biome_haze_field_core';
import { skyZoneHazeInternalsForTest } from '../src/render/sky';

const { skyFrag } = skyZoneHazeInternalsForTest;

describe('the composed dome fragment', () => {
  it('without a field is exactly the legacy shader: no haze identifier at all', () => {
    expect(skyFrag(false)).not.toContain('uHaze');
    expect(skyFrag(false)).not.toContain('wocSky');
  });

  it('with a field declares and samples every shared haze uniform', () => {
    const frag = skyFrag(true);
    for (const name of ['uHazeField', 'uHazeRect', 'uHazeGrade', 'uHazeCam']) {
      expect(frag).toContain(name);
      expect(BIOME_HAZE_DECLARATIONS).toContain(name);
    }
    // The uniform objects the material installs are the shared ones, so the
    // dome follows the same camera and day/night grade as the terrain layers.
    expect(Object.keys(biomeHazeUniforms()).sort()).toEqual([
      'uHazeCam',
      'uHazeField',
      'uHazeGrade',
      'uHazeRect',
    ]);
  });

  it('samples the field along the view ray at the pinned mid-vista distance', () => {
    const frag = skyFrag(true);
    expect(frag).toContain(`* ${HAZE_SKY_SAMPLE_DIST.toFixed(1)}`);
    expect(frag).toContain('uHazeCam + normalize(dir.xz');
    // The sample distance must stay well inside the field rect from any
    // camera the world allows, or the tint clamps to the apron edge value.
    expect(HAZE_SKY_SAMPLE_DIST).toBeLessThanOrEqual(900);
  });

  it('caps the tint at its OWN constant, not the ground border ceiling', () => {
    expect(skyFrag(true)).toContain(`${HAZE_SKY_TINT_MAX.toFixed(6)} * wocSkyHaze.a`);
    // The dome's job is matching the hazed geometry in front of it near the
    // horizon, which is the FAR term's business; it once borrowed the ground's
    // border-band ceiling, so retuning that band silently dimmed the sky with
    // it. Pinned as a real separation: the two may hold equal values, but the
    // dome must not read the border constant.
    expect(skyFrag(true)).not.toContain(`${HAZE_AERIAL_MAX.toFixed(6)} * wocSkyHaze.a`);
  });

  it('lands AFTER the fog band: inside it the band ramp multiplies the tint away', () => {
    const frag = skyFrag(true);
    const tint = frag.indexOf('wocSkyHaze');
    const fogBand = frag.indexOf('c = mix(uFog, c,');
    const output = frag.indexOf('gl_FragColor = vec4(c, 1.0);');
    expect(tint).toBeGreaterThan(fogBand);
    expect(tint).toBeLessThan(output);
    expect(fogBand).toBeGreaterThan(-1);
  });

  it('fades to ZERO at the true rim, where fogged geometry lands at exactly the fog colour', () => {
    // The window opens above dir.y 0.02 (about 1 degree): everything below is
    // the extreme rim, which must stay pure camera fog on the dome exactly as
    // fully fogged geometry does, or skylines read as cutouts against a
    // recoloured band.
    expect(skyFrag(true)).toContain('smoothstep(0.02, 0.1, dir.y) * (1.0 - smoothstep(');
  });

  it('stays brace-balanced in both arms', () => {
    for (const arm of [true, false]) {
      let depth = 0;
      for (const ch of skyFrag(arm)) {
        if (ch === '{') depth++;
        if (ch === '}') depth--;
      }
      expect(depth).toBe(0);
    }
  });
});
