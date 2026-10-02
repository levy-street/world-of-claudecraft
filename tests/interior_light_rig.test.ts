// The fog scene state's own predicates (src/render/interior_light_rig.ts):
// what a state means for the sky dome, beside the type that names every state.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FIRE_AND_FLY_SUN_DIRECTION } from '../src/render/fire_and_fly_arena_core';
import {
  applyInteriorLightRig,
  FIRE_AND_FLY_KEY_LIGHT_DIRECTION,
  type FogSceneState,
  interiorKeyLightDirection,
  isOpenAirFogState,
} from '../src/render/interior_light_rig';

describe('isOpenAirFogState', () => {
  it('shows the sky dome over the overworld, the open fields and the Thornhollow hollow only', () => {
    const openAir: FogSceneState[] = [
      'outdoor',
      'hoardValley',
      'wildheartField',
      'fireAndFly',
      'battleground',
    ];
    const covered: FogSceneState[] = [
      'dungeon',
      'temple',
      'nythraxis',
      'delve',
      'yumiMaze',
      'underwater',
      'rift',
      'practice',
      'lastkeep',
      'dawnhold',
    ];
    for (const state of openAir) expect(isOpenAirFogState(state), state).toBe(true);
    for (const state of covered) expect(isOpenAirFogState(state), state).toBe(false);
  });
});

describe('the Fire and Fly golden hour', () => {
  it('grades the one sun/hemi pair warm and aims the key light low from the tree line', () => {
    const sun = new THREE.DirectionalLight(0xffffff, 1);
    const hemi = new THREE.HemisphereLight(0xffffff, 0x000000, 1);
    const targets = {
      sun,
      hemi,
      scene: new THREE.Scene(),
      rim: { value: 1 },
      rimColor: { value: new THREE.Color() },
    };
    // The outdoor legs at deep night: the arena ignores the world clock.
    const night = { sunIntensity: 0.2, hemiIntensity: 0.1, envIntensity: 0.05 };
    applyInteriorLightRig('fireAndFly', targets, night);
    expect(sun.intensity).toBeGreaterThan(2);
    expect(hemi.intensity).toBeGreaterThan(night.hemiIntensity);
    const warm = sun.color;
    expect(warm.r).toBeGreaterThan(warm.g);
    expect(warm.g).toBeGreaterThan(warm.b);
    applyInteriorLightRig('outdoor', targets, night);
    expect(sun.intensity).toBe(night.sunIntensity);

    const aim = new THREE.Vector3();
    expect(interiorKeyLightDirection('fireAndFly', aim)).toBe(true);
    expect(aim.equals(FIRE_AND_FLY_KEY_LIGHT_DIRECTION)).toBe(true);
    expect(aim.x).toBe(FIRE_AND_FLY_SUN_DIRECTION.x);
    expect(aim.y).toBe(FIRE_AND_FLY_SUN_DIRECTION.y);
    expect(aim.z).toBe(FIRE_AND_FLY_SUN_DIRECTION.z);
  });
});
