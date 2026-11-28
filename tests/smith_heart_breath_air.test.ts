// The Breath vein's air, weather and light (phase 2G, presentation only:
// breath_air_core.ts, heart_environment.ts): the gusts' schedule (the same
// arithmetic the shaders run), the clouds under the Cornice's walk and past
// its rim, the tier's thinning,
// and the Breath's own light: a cold key over a neutral grey fill, never navy.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  BREATH_GUST,
  breathGustAt,
  planBreathAir,
} from '../src/render/smith_heart/breath_air_core';
import {
  SMITH_HEART_BREATH_FOG,
  SMITH_HEART_BREATH_LIGHT,
  SMITH_HEART_BREATH_STORM_SKY,
  SMITH_HEART_KEY_DIRECTION,
  SMITH_HEART_RING_FOG,
  SMITH_HEART_RING_LIGHT,
} from '../src/render/smith_heart/heart_environment';
import { buildHeartSky } from '../src/render/smith_heart/heart_sky';
import { BREATH } from '../src/sim/content/smith_heart_layout';

describe("the Breath's air, weather and light", () => {
  it('sweeps each gust down the bridge in its time, then lets it die', () => {
    const t0 = BREATH_GUST.offset + BREATH_GUST.period * 3;
    expect(breathGustAt(t0).front).toBeCloseTo(0, 6);
    expect(breathGustAt(t0 + BREATH_GUST.sweep / 2).front).toBeCloseTo(0.5, 6);
    expect(breathGustAt(t0 + BREATH_GUST.sweep / 2).strength).toBe(1);
    expect(breathGustAt(t0 + BREATH_GUST.sweep + 2).strength).toBe(0);
    expect(breathGustAt(t0 + BREATH_GUST.period).index).toBe(breathGustAt(t0).index + 1);
  });

  it('rolls its clouds past the rim under the walk, thinning with the tier', () => {
    const full = planBreathAir(1);
    const low = planBreathAir(0.35);
    const C = BREATH.cornice;
    for (const c of full.clouds.slice(0, 22)) {
      expect(c.y).toBeLessThan(C.h - 5);
      expect(Math.hypot((c.x - C.x) / (C.rx + 9), (c.z - C.z) / (C.rz + 9))).toBeGreaterThan(1);
    }
    const count = (p: typeof full) => p.volumes.reduce((n, v) => n + v.streaks + v.grit, 0);
    expect(count(low)).toBeLessThan(count(full) * 0.45);
  });

  it('lights the Breath its own: a cold key over a neutral grey fill, never navy', () => {
    const L = SMITH_HEART_BREATH_LIGHT;
    const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    const [r, g, b] = rgb(L.hemiSky);
    expect(b - r).toBeLessThan(40);
    expect(Math.min(r, g, b)).toBeGreaterThan(110);
    const [kr, , kb] = rgb(L.sunColor);
    expect(kb).toBeGreaterThanOrEqual(kr);
    expect(L.env).toBeLessThanOrEqual(0.05);
  });

  it('stands the summit under a thunderhead: darker than the hub, neutral, the rift on the one sun', () => {
    // The storm pass (design doc section 5.27): the guardian, the crystal and
    // the lightning are the brightest things on the Cornice.
    const rgb = (c: number) => [(c >> 16) & 255, (c >> 8) & 255, c & 255];
    const luma = (c: number) => {
      const [r, g, b] = rgb(c);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    // A dark slate storm air, well under the Ring's hub air, and never navy.
    expect(luma(SMITH_HEART_BREATH_FOG.color)).toBeLessThan(
      luma(SMITH_HEART_RING_FOG.color) * 0.85,
    );
    const [fr, , fb] = rgb(SMITH_HEART_BREATH_FOG.color);
    expect(fb - fr).toBeLessThan(40);
    // An overcast's light: the key under the hub's sun, the fill under the key
    // (a stronger key on this pale stone read as snow).
    const L = SMITH_HEART_BREATH_LIGHT;
    expect(L.sun).toBeLessThan(SMITH_HEART_RING_LIGHT.sun);
    expect(L.hemi).toBeLessThan(L.sun);
    // A body still reads off the dark slate: its rim over the hub's.
    expect(L.rim).toBeGreaterThan(SMITH_HEART_RING_LIGHT.rim);
    // The authored numbers (the pale summit they replace: sun 2.65, fill 2.2, rim 1.5,
    // air 0x707b88 from 80 to 560).
    expect([L.sun, L.hemi, L.rim]).toEqual([2.15, 1.7, 2]);
    expect(SMITH_HEART_BREATH_FOG).toEqual({ color: 0x4a5262, near: 70, far: 520 });
    // The painted deck hangs low (its dark bellies at the horizon, the painting
    // spent a third of the way up), pressed to a thunderhead with its tears kept.
    const S = SMITH_HEART_BREATH_STORM_SKY;
    expect(S.foot).toBeLessThanOrEqual(0.65);
    expect(S.foot - 0.7 * S.rise).toBeLessThan(0.05);
    expect(S.shade).toBeLessThan(0.5);
    expect(S.lit).toBeGreaterThan(S.shade * 2);
    // The rift is a COLD light, low.
    expect(S.rift[2]).toBeGreaterThan(S.rift[0]);
    expect(S.riftTop).toBeLessThan(0.5);
  });

  it('paints that storm on the dome: the low deck, the thunderhead, the rift on the one sun', () => {
    const dome = buildHeartSky({
      lowGfx: false,
      breathSky: new THREE.Texture(),
      onFrame: () => undefined,
    });
    const mat = dome.mesh.material as THREE.ShaderMaterial;
    const frag = mat.fragmentShader;
    const S = SMITH_HEART_BREATH_STORM_SKY;
    // The rift's bearing is the raid's one sun, the same vector every room's key reads.
    const sun = mat.uniforms.uBreathSun.value as THREE.Vector3;
    const key = new THREE.Vector3(...SMITH_HEART_KEY_DIRECTION).normalize();
    expect(sun.distanceTo(key)).toBeLessThan(1e-9);
    expect(mat.uniforms.uBreathPainted.value).toBe(1);
    // The shader reads the pass's numbers and runs the pass's arithmetic.
    for (const line of [
      `const float BREATH_SKY_FOOT = ${S.foot.toFixed(3)};`,
      `const float BREATH_SKY_RISE = ${S.rise.toFixed(3)};`,
      `const float BREATH_SKY_SHADE = ${S.shade.toFixed(3)};`,
      `const float BREATH_SKY_LIT = ${S.lit.toFixed(3)};`,
      `const float BREATH_SKY_RIFT_TOP = ${S.riftTop.toFixed(3)};`,
      `const vec3 BREATH_SKY_RIFT = vec3(${S.rift.map((v) => v.toFixed(3)).join(', ')});`,
      // The deck hung low: the painting's v from its foot, never the old line.
      'float v = clamp(BREATH_SKY_FOOT - max(up, 0.0) * BREATH_SKY_RISE, 0.005, 0.995);',
      // The thunderhead: shade pressed down, the lit tears kept.
      'painted *= mix(BREATH_SKY_SHADE, BREATH_SKY_LIT, smoothstep(0.24, 0.7, pv));',
      // The rift: toward the sun's bearing, low, and round the key itself.
      'vec3 sunFlat = normalize(vec3(uBreathSun.x, 0.0, uBreathSun.z));',
      'float toward = max(dot(normalize(vec3(d.x, 0.0001, d.z)), sunFlat), 0.0);',
      'float low = 1.0 - smoothstep(0.02, BREATH_SKY_RIFT_TOP, up);',
      'float kd = max(dot(d, uBreathSun), 0.0);',
      'col += BREATH_SKY_RIFT * (rift * 0.9 + k4 * k4 * 0.35);',
    ])
      expect(frag).toContain(line);
    expect(frag).not.toContain('0.82 - max(up, 0.0) * 1.2');
    // The foot sits above the painting's pale haze (the old foot was 0.82).
    expect(S.foot).toBeLessThan(0.7);
  });
});
