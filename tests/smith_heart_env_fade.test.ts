// The Smith's Heart's environment cross-fade (src/render/smith_heart/
// heart_env_fade_core.ts + heart_env_fade.ts; the team's doc of 2026-11-17:
// "add cross fade to environment lighting when going between areas"): which
// settles fade (only between the raid's own areas), the eased clock, and the
// painter over real THREE lights and fog: nothing pops on the settle frame, the
// mix runs to the new state's numbers, a fade caught midway starts the next
// from where it stood, the key light turns instead of jumping, and a settle
// out of the raid snaps as before.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyFogScenePreset } from '../src/render/fog_scene_state';
import {
  applyInteriorLightRig,
  type FogSceneState,
  interiorKeyLightDirection,
} from '../src/render/interior_light_rig';
import { HeartEnvFade, type HeartEnvLive } from '../src/render/smith_heart/heart_env_fade';
import {
  HEART_ENV_FADE_SECONDS,
  heartEnvFades,
  heartEnvFadeT,
} from '../src/render/smith_heart/heart_env_fade_core';
import {
  SMITH_HEART_BREATH_FOG,
  SMITH_HEART_BREATH_LIGHT,
  SMITH_HEART_RING_FOG,
  SMITH_HEART_RING_LIGHT,
} from '../src/render/smith_heart/heart_environment';

function liveRig(): HeartEnvLive {
  return {
    fog: new THREE.Fog(0x000000, 1, 2),
    sun: new THREE.DirectionalLight(),
    hemi: new THREE.HemisphereLight(),
    scene: new THREE.Scene(),
    rim: { value: 1 },
    rimColor: { value: new THREE.Color() },
  };
}

/** The renderer's settle, verbatim in order: capture, the preset, the rig, arm. */
function settle(fade: HeartEnvFade, live: HeartEnvLive, from: FogSceneState, to: FogSceneState) {
  fade.capture(from, to, live);
  applyFogScenePreset(to, live.fog, () => ({ color: 0x888888, near: 10, far: 900 }));
  applyInteriorLightRig(to, live, { sunIntensity: 3, hemiIntensity: 1, envIntensity: 1 });
  fade.arm();
}

describe('the cross-fade rule', () => {
  it('fades between the raid areas only, the Heart and the storm dusk included', () => {
    expect(heartEnvFades('smithHeartRing', 'smithHeartBreath')).toBe(true);
    expect(heartEnvFades('smithHeartHammer', 'smithHeartRing')).toBe(true);
    expect(heartEnvFades('smithHeartRing', 'smithHeartCore')).toBe(true);
    expect(heartEnvFades('sunkenBastion', 'smithHeartHeat')).toBe(true);
    expect(heartEnvFades('smithHeartRing', 'smithHeartRing')).toBe(false);
    expect(heartEnvFades('outdoor', 'smithHeartHammer')).toBe(false);
    expect(heartEnvFades('smithHeartHammer', 'outdoor')).toBe(false);
    expect(heartEnvFades('sunkenBastion', 'sunkenBastion')).toBe(false);
    expect(heartEnvFades('dungeon', 'sunkenBastion')).toBe(false);
  });

  it('eases in and out over its seconds', () => {
    expect(heartEnvFadeT(0)).toBe(0);
    expect(heartEnvFadeT(-1)).toBe(0);
    expect(heartEnvFadeT(HEART_ENV_FADE_SECONDS / 2)).toBeCloseTo(0.5, 9);
    expect(heartEnvFadeT(HEART_ENV_FADE_SECONDS)).toBe(1);
    expect(heartEnvFadeT(99)).toBe(1);
    // Smooth at both ends: the first and last tenths move little.
    expect(heartEnvFadeT(HEART_ENV_FADE_SECONDS * 0.1)).toBeLessThan(0.05);
  });
});

describe('the painter', () => {
  it('nothing pops on the settle frame, then it runs to the new area', () => {
    const live = liveRig();
    const fade = new HeartEnvFade();
    settle(fade, live, 'outdoor', 'smithHeartRing');
    // From outside: a snap (no fade), the Ring's numbers at once.
    expect(fade.running).toBe(false);
    expect(live.fog.far).toBe(SMITH_HEART_RING_FOG.far);
    expect(live.sun.intensity).toBe(SMITH_HEART_RING_LIGHT.sun);
    // Ring to Breath: the frame keeps the Ring's values.
    settle(fade, live, 'smithHeartRing', 'smithHeartBreath');
    expect(fade.running).toBe(true);
    expect(live.fog.far).toBe(SMITH_HEART_RING_FOG.far);
    expect(live.fog.color.getHex()).toBe(SMITH_HEART_RING_FOG.color);
    expect(live.sun.intensity).toBe(SMITH_HEART_RING_LIGHT.sun);
    // Halfway: between the two.
    fade.update(HEART_ENV_FADE_SECONDS / 2);
    const midFar = (SMITH_HEART_RING_FOG.far + SMITH_HEART_BREATH_FOG.far) / 2;
    expect(live.fog.far).toBeCloseTo(midFar, 6);
    const midSun = (SMITH_HEART_RING_LIGHT.sun + SMITH_HEART_BREATH_LIGHT.sun) / 2;
    expect(live.sun.intensity).toBeCloseTo(midSun, 6);
    // Done: the Breath's own numbers, exactly, and it stops writing.
    fade.update(HEART_ENV_FADE_SECONDS);
    expect(fade.running).toBe(false);
    expect(live.fog.far).toBe(SMITH_HEART_BREATH_FOG.far);
    expect(live.fog.color.getHex()).toBe(SMITH_HEART_BREATH_FOG.color);
    expect(live.sun.intensity).toBe(SMITH_HEART_BREATH_LIGHT.sun);
    expect(live.hemi.color.getHex()).toBe(SMITH_HEART_BREATH_LIGHT.hemiSky);
    expect(live.rim.value).toBe(SMITH_HEART_BREATH_LIGHT.rim);
    live.fog.far = 1;
    fade.update(0.1);
    expect(live.fog.far).toBe(1);
  });

  it('a fade caught midway starts the next from where it stood (no jump back)', () => {
    const live = liveRig();
    const fade = new HeartEnvFade();
    settle(fade, live, 'outdoor', 'smithHeartRing');
    settle(fade, live, 'smithHeartRing', 'smithHeartBreath');
    fade.update(HEART_ENV_FADE_SECONDS / 2);
    const far = live.fog.far;
    const sun = live.sun.intensity;
    settle(fade, live, 'smithHeartBreath', 'smithHeartRing');
    expect(live.fog.far).toBeCloseTo(far, 9);
    expect(live.sun.intensity).toBeCloseTo(sun, 9);
    fade.update(HEART_ENV_FADE_SECONDS);
    expect(live.fog.far).toBe(SMITH_HEART_RING_FOG.far);
  });

  it('turns the key light round instead of jumping, and never past the new one', () => {
    const live = liveRig();
    const fade = new HeartEnvFade();
    const dir = new THREE.Vector3();
    settle(fade, live, 'outdoor', 'smithHeartRing');
    interiorKeyLightDirection('smithHeartRing', dir);
    fade.steerKey(dir);
    const ring = dir.clone();
    settle(fade, live, 'smithHeartRing', 'smithHeartBreath');
    const breath = new THREE.Vector3();
    interiorKeyLightDirection('smithHeartBreath', breath);
    // The settle frame: still the Ring's key.
    dir.copy(breath);
    fade.steerKey(dir);
    expect(dir.angleTo(ring)).toBeLessThan(1e-6);
    fade.update(HEART_ENV_FADE_SECONDS / 2);
    dir.copy(breath);
    fade.steerKey(dir);
    expect(dir.angleTo(ring)).toBeGreaterThan(0.01);
    expect(dir.angleTo(breath)).toBeGreaterThan(0.01);
    expect(dir.length()).toBeCloseTo(1, 9);
    fade.update(HEART_ENV_FADE_SECONDS);
    dir.copy(breath);
    fade.steerKey(dir);
    expect(dir.angleTo(breath)).toBeLessThan(1e-6);
  });

  it('leaving the raid snaps as it always did', () => {
    const live = liveRig();
    const fade = new HeartEnvFade();
    settle(fade, live, 'outdoor', 'smithHeartHammer');
    settle(fade, live, 'smithHeartHammer', 'outdoor');
    expect(fade.running).toBe(false);
    expect(live.fog.far).toBe(900);
  });
});
