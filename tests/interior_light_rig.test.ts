// The fog scene state's own predicates (src/render/interior_light_rig.ts):
// what a state means for the sky dome, beside the type that names every state.

import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import {
  applyInteriorLightRig,
  applyRiftLightRig,
  type FogSceneState,
  INTERIOR_KEY_LIGHT_DIRECTION,
  interiorKeyLightDirection,
  isOpenAirFogState,
} from '../src/render/interior_light_rig';

describe('isOpenAirFogState', () => {
  it('shows the sky dome over the overworld and the Thornhollow hollow only', () => {
    // The open-air dungeon fields (the Wildheart Basin among them) carry their
    // own sky dome inside the interior, so the world dome hides there.
    const openAir: FogSceneState[] = ['outdoor', 'hoardValley', 'battleground'];
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
      'wildheartBasin',
      'hollowCrypt',
      'drownedTemple',
      'gravewyrmSanctum',
    ];
    for (const state of openAir) expect(isOpenAirFogState(state), state).toBe(true);
    for (const state of covered) expect(isOpenAirFogState(state), state).toBe(false);
  });

  it('pins a fixed overhead-south key light direction in enclosed raids and dungeons', () => {
    const out = new THREE.Vector3();
    for (const state of [
      'dungeon',
      'temple',
      'nythraxis',
      'ignivarApproach',
      'ignivar',
      'varkhul',
      'delve',
      'yumiMaze',
      'rift',
      'lastkeep',
      'dawnhold',
    ] as const) {
      out.set(0, 0, 1);
      expect(interiorKeyLightDirection(state, out), state).toBe(true);
      expect(out.equals(INTERIOR_KEY_LIGHT_DIRECTION)).toBe(true);
      // Overhead and from the south (-Z) so floors and camera-facing mob fronts stay lit at night.
      expect(out.x).toBeGreaterThan(0.3);
      expect(out.y).toBeGreaterThan(0.8);
      expect(out.z).toBeLessThan(-0.3);
    }
    expect(interiorKeyLightDirection('outdoor', out)).toBe(false);
  });

  it('settles Nythraxis, underground dungeons, Yumi maze, and rifts with consistent raid/dungeon lighting regardless of outdoor night', () => {
    const sun = new THREE.DirectionalLight(0x111122, 0.1);
    const hemi = new THREE.HemisphereLight(0x111122, 0x050508, 0.1);
    const scene = new THREE.Scene();
    const targets = {
      sun,
      hemi,
      scene,
      rim: { value: 1 },
      rimColor: { value: new THREE.Color() },
    };
    const darkOutdoor = { sunIntensity: 0.15, hemiIntensity: 0.12, envIntensity: 0.02 };
    applyInteriorLightRig('nythraxis', targets, darkOutdoor);
    expect(sun.intensity).toBeCloseTo(0.92, 5);
    expect(hemi.intensity).toBeCloseTo(0.58, 5);
    expect(scene.environmentIntensity).toBeCloseTo(0.16, 5);
    expect(targets.rim.value).toBeCloseTo(2.4, 5);
    expect(sun.color.getHex()).toBe(0xd6deff);
    expect(hemi.color.getHex()).toBe(0x7c8ab8);
    expect(hemi.groundColor.getHex()).toBe(0x2c2440);

    applyInteriorLightRig('yumiMaze', targets, darkOutdoor);
    expect(sun.color.getHex()).toBe(0xd8e2ff);
    expect(hemi.color.getHex()).toBe(0x7480a8);
    expect(hemi.groundColor.getHex()).toBe(0x2c2824);

    applyInteriorLightRig('dungeon', targets, darkOutdoor);
    expect(sun.color.getHex()).toBe(0xe8dec8);
    expect(hemi.color.getHex()).toBe(0x8a8298);
    expect(hemi.groundColor.getHex()).toBe(0x2a2420);

    applyRiftLightRig(true, targets);
    expect(sun.color.getHex()).toBe(0xffc49a);
    expect(hemi.color.getHex()).toBe(0xa86448);
    expect(hemi.groundColor.getHex()).toBe(0x381c14);

    applyRiftLightRig(false, targets);
    expect(sun.color.getHex()).toBe(0xe8dec8);
    expect(hemi.color.getHex()).toBe(0x8a8298);
    expect(hemi.groundColor.getHex()).toBe(0x2a2420);
  });
});
