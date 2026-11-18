// The fog scene's crossfade, painted (src/render/fog_scene_fade.ts) over real
// three objects: what the scene shows on a settle's own frame, through the fade
// and after it, the key light's turn, and the renderer's wiring
// (src/render/renderer.ts, the settle edge and updateKeyLight).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { afterEach, describe, expect, it } from 'vitest';
import { FogSceneFade } from '../src/render/fog_scene_fade';
import { applyFogScenePreset } from '../src/render/fog_scene_state';
import { sharedUniforms } from '../src/render/gfx';
import {
  applyInteriorLightRig,
  type FogSceneState,
  interiorKeyLightDirection,
} from '../src/render/interior_light_rig';
import { RIM_GLOW_DEFAULT_COLOR } from '../src/render/pbr_fragment_shader';

interface Rig {
  scene: THREE.Scene;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  fade: FogSceneFade;
}

function makeRig(): Rig {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x000000, 1, 2);
  const sun = new THREE.DirectionalLight();
  const hemi = new THREE.HemisphereLight();
  return { scene, sun, hemi, fade: new FogSceneFade(scene, sun, hemi) };
}

/** Every number a settle writes, as the scene shows it now. */
function shown(r: Rig): number[] {
  const fog = r.scene.fog as THREE.Fog;
  const rim = sharedUniforms.uRimColor.value;
  return [
    fog.color.r,
    fog.color.g,
    fog.color.b,
    fog.near,
    fog.far,
    r.sun.color.r,
    r.sun.color.g,
    r.sun.color.b,
    r.sun.intensity,
    r.hemi.color.r,
    r.hemi.color.g,
    r.hemi.color.b,
    r.hemi.groundColor.r,
    r.hemi.groundColor.g,
    r.hemi.groundColor.b,
    r.hemi.intensity,
    r.scene.environmentIntensity,
    sharedUniforms.uRimBoost.value,
    rim.r,
    rim.g,
    rim.b,
  ];
}

/** What `paint(r, v)` writes, in `shown`'s order: every number its own. */
function painted(v: number): number[] {
  return [
    v,
    v + 0.01,
    v + 0.02,
    10 + v * 100,
    500 + v * 100,
    v + 0.03,
    v + 0.04,
    v + 0.05,
    1 + v,
    v + 0.06,
    v + 0.07,
    v + 0.08,
    v + 0.09,
    v + 0.1,
    v + 0.11,
    2 + v,
    0.1 + v,
    1.2 + v,
    v + 0.12,
    v + 0.13,
    v + 0.14,
  ];
}

/** A stand-in settle writing every number a settle writes (`painted(v)`). */
function paint(r: Rig, v: number): void {
  const n = painted(v);
  const fog = r.scene.fog as THREE.Fog;
  fog.color.setRGB(n[0], n[1], n[2]);
  fog.near = n[3];
  fog.far = n[4];
  r.sun.color.setRGB(n[5], n[6], n[7]);
  r.sun.intensity = n[8];
  r.hemi.color.setRGB(n[9], n[10], n[11]);
  r.hemi.groundColor.setRGB(n[12], n[13], n[14]);
  r.hemi.intensity = n[15];
  r.scene.environmentIntensity = n[16];
  sharedUniforms.uRimBoost.value = n[17];
  sharedUniforms.uRimColor.value.setRGB(n[18], n[19], n[20]);
}

/** The renderer's own settle of a fog scene state: its fog preset and its light rig. */
function applyState(r: Rig, state: FogSceneState): void {
  applyFogScenePreset(state, r.scene.fog as THREE.Fog, () => ({
    color: 0x8899aa,
    near: 50,
    far: 900,
  }));
  applyInteriorLightRig(
    state,
    {
      sun: r.sun,
      hemi: r.hemi,
      scene: r.scene,
      rim: sharedUniforms.uRimBoost,
      rimColor: sharedUniforms.uRimColor,
    },
    { sunIntensity: 3, hemiIntensity: 1, envIntensity: 0.5 },
  );
}

/** What a state settles to on its own (the shared rim uniforms left as found). */
function settled(state: FogSceneState): number[] {
  const rim = sharedUniforms.uRimBoost.value;
  const rimColor = sharedUniforms.uRimColor.value.clone();
  const roof = sharedUniforms.uRoofDarkStrength.value;
  const r = makeRig();
  applyState(r, state);
  const look = shown(r);
  sharedUniforms.uRimBoost.value = rim;
  sharedUniforms.uRimColor.value.copy(rimColor);
  sharedUniforms.uRoofDarkStrength.value = roof;
  return look;
}

function expectHalfway(now: number[], a: number[], b: number[]): void {
  now.forEach((v, i) => {
    expect(v, `number ${i}`).toBeCloseTo((a[i] + b[i]) / 2, 6);
  });
}

const KEY = new THREE.Vector3(0, 1, 0);

afterEach(() => {
  sharedUniforms.uRimBoost.value = 1;
  sharedUniforms.uRimColor.value.setHex(RIM_GLOW_DEFAULT_COLOR);
  sharedUniforms.uRoofDarkStrength.value = 0;
});

describe('FogSceneFade between two of the raid rooms', () => {
  it('holds the old room on the settle frame and carries every number to the new one over a second', () => {
    const r = makeRig();
    // The first settle into the raid lands at once.
    r.fade.settle('smith_heart', KEY, () => paint(r, 0.2));
    expect(shown(r)).toEqual(painted(0.2));
    // Into the next room: the settle's own frame draws no change at all.
    r.fade.settle('smith_heart', KEY, () => paint(r, 0.6));
    expect(shown(r)).toEqual(painted(0.2));
    r.fade.step(0.5);
    expectHalfway(shown(r), painted(0.2), painted(0.6));
    r.fade.step(0.5);
    expect(shown(r)).toEqual(painted(0.6));
  });

  it('stops writing once it has arrived, so a later writer keeps what it wrote', () => {
    const r = makeRig();
    r.fade.settle('smith_heart', KEY, () => paint(r, 0.2));
    r.fade.settle('smith_heart', KEY, () => paint(r, 0.6));
    r.fade.step(1.2);
    r.sun.intensity = 9;
    r.fade.step(0.1);
    expect(r.sun.intensity).toBe(9);
  });

  it('fades the real rooms: the Ring into the Quench, ending on the Quench preset exactly', () => {
    const r = makeRig();
    r.fade.settle('smith_heart', KEY, () => applyState(r, 'smithHeartRing'));
    const ring = settled('smithHeartRing');
    const quench = settled('smithHeartQuench');
    expect(shown(r)).toEqual(ring);
    r.fade.settle('smith_heart', KEY, () => applyState(r, 'smithHeartQuench'));
    expect(shown(r)).toEqual(ring);
    r.fade.step(0.5);
    expectHalfway(shown(r), ring, quench);
    r.fade.step(0.5);
    expect(shown(r)).toEqual(quench);
  });

  it('starts a room crossed mid-fade from what the scene shows, never jumping', () => {
    const r = makeRig();
    r.fade.settle('smith_heart', KEY, () => paint(r, 0.2));
    r.fade.settle('smith_heart', KEY, () => paint(r, 0.6));
    r.fade.step(0.5);
    const mid = shown(r);
    // Back the way it came, halfway over.
    r.fade.settle('smith_heart', KEY, () => paint(r, 0.2));
    expect(shown(r)).toEqual(mid);
    r.fade.step(0.5);
    expectHalfway(shown(r), mid, painted(0.2));
    r.fade.step(0.5);
    expect(shown(r)).toEqual(painted(0.2));
  });

  it('turns the key light from the old room toward the new one, ending on it', () => {
    const r = makeRig();
    const dir = new THREE.Vector3();
    const ringDir = new THREE.Vector3();
    const quenchDir = new THREE.Vector3();
    interiorKeyLightDirection('smithHeartRing', ringDir);
    interiorKeyLightDirection('smithHeartQuench', quenchDir);
    // The renderer's key light each frame: the state's direction, then the turn.
    const frame = (state: FogSceneState) => {
      interiorKeyLightDirection(state, dir);
      r.fade.keyDirection(dir);
    };
    r.fade.settle('smith_heart', dir, () => applyState(r, 'smithHeartRing'));
    frame('smithHeartRing');
    expect(dir.equals(ringDir)).toBe(true);
    r.fade.settle('smith_heart', dir, () => applyState(r, 'smithHeartQuench'));
    frame('smithHeartQuench');
    expect(dir.distanceTo(ringDir)).toBeLessThan(1e-9);
    r.fade.step(0.5);
    frame('smithHeartQuench');
    expect(dir.length()).toBeCloseTo(1, 9);
    expect(dir.angleTo(ringDir)).toBeCloseTo(dir.angleTo(quenchDir), 9);
    expect(dir.angleTo(ringDir)).toBeGreaterThan(0.3);
    r.fade.step(0.5);
    frame('smithHeartQuench');
    expect(dir.equals(quenchDir)).toBe(true);
  });
});

describe('FogSceneFade everywhere else', () => {
  it('lands at once on the way into the raid and out of it, as every settle did before', () => {
    const r = makeRig();
    r.fade.settle(null, KEY, () => applyState(r, 'outdoor'));
    r.fade.settle('smith_heart', KEY, () => applyState(r, 'smithHeartRing'));
    expect(shown(r)).toEqual(settled('smithHeartRing'));
    r.fade.step(0.4);
    expect(shown(r)).toEqual(settled('smithHeartRing'));
    r.fade.settle('crypt', KEY, () => applyState(r, 'dungeon'));
    expect(shown(r)).toEqual(settled('dungeon'));
  });

  it('never turns the key light outside a fade', () => {
    const r = makeRig();
    const dir = new THREE.Vector3(0.3, 0.9, 0.1).normalize();
    const before = dir.clone();
    r.fade.keyDirection(dir);
    expect(dir.equals(before)).toBe(true);
  });

  it('forgets the raid on a cancel (the rift rig), dropping any fade, so the next room lands at once', () => {
    const r = makeRig();
    r.fade.settle('smith_heart', KEY, () => paint(r, 0.2));
    r.fade.settle('smith_heart', KEY, () => paint(r, 0.6));
    r.fade.step(0.3);
    r.fade.cancel();
    r.sun.intensity = 7;
    r.fade.step(0.3);
    expect(r.sun.intensity).toBe(7);
    r.fade.settle('smith_heart', KEY, () => paint(r, 0.4));
    expect(shown(r)).toEqual(painted(0.4));
  });
});

describe('the renderer wiring', () => {
  const src = readFileSync(
    fileURLToPath(new URL('../src/render/renderer.ts', import.meta.url)),
    'utf8',
  );

  it('settles every new fog scene state through the fade, its preset and light rig inside it', () => {
    const open = 'this.sceneFade.settle(fogScene.interior, this.lightDir, () => {';
    const start = src.indexOf(open);
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf('});', start));
    expect(body).toContain('applyFogScenePreset(desired, fog,');
    expect(body).toContain('this.applyStateLightRig(desired);');
    // Nowhere else is a state's preset written.
    expect(src.split('applyFogScenePreset(').length - 1).toBe(1);
    expect(src.split('this.applyStateLightRig(desired)').length - 1).toBe(1);
  });

  it('steps the fade on every frame that keeps its state', () => {
    const settle = src.indexOf('this.sceneFade.settle(');
    const step = src.indexOf('this.sceneFade.step(dt);');
    expect(step).toBeGreaterThan(settle);
    expect(src.split('this.sceneFade.step(').length - 1).toBe(1);
  });

  it('turns the key light right after the state picks its direction', () => {
    expect(src).toMatch(
      /interiorKeyLightDirection\(this\.fogState, this\.lightDir\);\s*\n\s*this\.sceneFade\.keyDirection\(this\.lightDir\);/,
    );
  });

  it('drops the fade on the rift rig, which writes the light every frame', () => {
    expect(src).toMatch(/this\.fogState = 'rift';\s*\n\s*this\.sceneFade\.cancel\(\);/);
  });
});
