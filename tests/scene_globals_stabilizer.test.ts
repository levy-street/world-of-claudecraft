import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { attachSceneGlobalsStabilizer } from '../src/render/scene_globals_stabilizer';
import {
  COLOR_BAND,
  DIRECTION_BAND,
  DIRECTION_BAND_UNSHADOWED,
  FOG_RANGE_BAND,
} from '../src/render/scene_globals_stabilizer_core';

// A scene shaped like the renderer's: one hemisphere, one directional key
// light anchored on the player (its target in the scene), linear fog, a camera.
function world() {
  const scene = new THREE.Scene();
  const hemi = new THREE.HemisphereLight(0xdcefff, 0x465f39, 1.2);
  const sun = new THREE.DirectionalLight(0xffdfaa, 2.5);
  scene.add(hemi, sun, sun.target);
  scene.fog = new THREE.Fog(0x9fb4c8, 40, 220);
  const camera = new THREE.PerspectiveCamera(60, 1.6, 0.1, 500);
  camera.position.set(10, 8, 12);
  camera.lookAt(0, 1, 0);
  const player = new THREE.Vector3(3, 0, -4);
  const sunDir = new THREE.Vector3(0.4, 0.8, 0.3).normalize();
  return { scene, hemi, sun, camera, player, sunDir };
}

type World = ReturnType<typeof world>;

// One frame the way the renderer drives it: ease the grade in place, aim the
// key light at the player, walk the matrices; then three's hooks around a
// render, returning what the render would read.
function frame(
  w: World,
  opts: { drift: number; cameraNoise?: number; turn?: number; shadows?: boolean; fogEase?: number },
) {
  const { scene, hemi, sun, camera, player, sunDir } = w;
  const grade = new THREE.Color(1, 0.6, 0.3);
  sun.color.lerp(grade, opts.drift);
  hemi.color.lerp(grade, opts.drift);
  hemi.groundColor.lerp(grade, opts.drift);
  sun.intensity += (3 - sun.intensity) * opts.drift;
  (scene.fog as THREE.Fog).color.lerp(grade, opts.drift);
  // The renderer damps fog near and far toward the hour's haze the same way.
  if (opts.fogEase) {
    (scene.fog as THREE.Fog).near += (60 - (scene.fog as THREE.Fog).near) * opts.fogEase;
    (scene.fog as THREE.Fog).far += (300 - (scene.fog as THREE.Fog).far) * opts.fogEase;
  }
  sunDir.applyAxisAngle(new THREE.Vector3(0, 0, 1), opts.turn ?? 2e-5).normalize();
  sun.position.copy(player).addScaledVector(sunDir, 200);
  sun.target.position.copy(player);
  if (opts.cameraNoise) camera.position.x += opts.cameraNoise;
  scene.updateMatrixWorld();
  camera.updateMatrixWorld();
  // three: scene.updateMatrixWorld, camera.updateMatrixWorld, onBeforeRender,
  // gather lights, draw, onAfterRender.
  const renderer = { shadowMap: { enabled: opts.shadows === true } } as THREE.WebGLRenderer;
  scene.onBeforeRender(renderer, scene, camera, null as never, null as never, null as never);
  const drawn = {
    sunColor: sun.color.toArray(),
    sunIntensity: sun.intensity,
    hemiColor: hemi.color.toArray(),
    hemiGround: hemi.groundColor.toArray(),
    fogColor: (scene.fog as THREE.Fog).color.toArray(),
    fogRange: [(scene.fog as THREE.Fog).near, (scene.fog as THREE.Fog).far],
    // WebGLLights.setupView: (light - target) in world space, to view space.
    sunDirection: new THREE.Vector3()
      .setFromMatrixPosition(sun.matrixWorld)
      .sub(new THREE.Vector3().setFromMatrixPosition(sun.target.matrixWorld))
      .transformDirection(camera.matrixWorldInverse)
      .toArray(),
    view: [...camera.matrixWorldInverse.elements],
    sunWorld: new THREE.Vector3().setFromMatrixPosition(sun.matrixWorld),
  };
  scene.onAfterRender(renderer, scene, camera, null as never, null as never, null as never);
  const live = {
    sunColor: sun.color.toArray(),
    hemiColor: hemi.color.toArray(),
    fogColor: (scene.fog as THREE.Fog).color.toArray(),
    fogRange: [(scene.fog as THREE.Fog).near, (scene.fog as THREE.Fog).far],
    sunIntensity: sun.intensity,
    sunWorld: new THREE.Vector3().setFromMatrixPosition(sun.matrixWorld),
  };
  return { drawn, live };
}

describe('scene globals stabilizer', () => {
  it('holds what a render reads bit-identical under sub-band drift and camera noise', () => {
    const w = world();
    attachSceneGlobalsStabilizer(w.scene);
    frame(w, { drift: 0.5 }); // settle onto the first commit
    const first = frame(w, { drift: 1e-5, cameraNoise: 1e-12 }).drawn;
    for (let i = 0; i < 5; i++) {
      const next = frame(w, { drift: 1e-5, cameraNoise: 1e-12, fogEase: 1e-6 }).drawn;
      expect(next.fogRange).toEqual(first.fogRange);
      expect(next.sunColor).toEqual(first.sunColor);
      expect(next.sunIntensity).toBe(first.sunIntensity);
      expect(next.hemiColor).toEqual(first.hemiColor);
      expect(next.hemiGround).toEqual(first.hemiGround);
      expect(next.fogColor).toEqual(first.fogColor);
      expect(next.sunDirection).toEqual(first.sunDirection);
      expect(next.view).toEqual(first.view);
    }
  });

  it('gives the integrator its exact live values back after every render', () => {
    const held = world();
    const plain = world();
    attachSceneGlobalsStabilizer(held.scene);
    for (let i = 0; i < 200; i++) {
      const a = frame(held, { drift: 0.003, fogEase: 0.003 }).live;
      const b = frame(plain, { drift: 0.003, fogEase: 0.003 }).live;
      expect(a.fogRange).toEqual(b.fogRange);
      expect(a.sunColor).toEqual(b.sunColor);
      expect(a.hemiColor).toEqual(b.hemiColor);
      expect(a.fogColor).toEqual(b.fogColor);
      expect(a.sunIntensity).toBe(b.sunIntensity);
      expect(a.sunWorld.toArray()).toEqual(b.sunWorld.toArray());
    }
  });

  it('commits real changes: a visible colour step, a camera move, a walking player', () => {
    const w = world();
    attachSceneGlobalsStabilizer(w.scene);
    const base = frame(w, { drift: 0.5 }).drawn;
    const graded = frame(w, { drift: 0.05 }).drawn;
    expect(graded.sunColor).not.toEqual(base.sunColor);
    const moved = frame(w, { drift: 0, cameraNoise: 0.01 }).drawn;
    expect(moved.view).not.toEqual(graded.view);
    // The key light follows the player exactly enough for the shadow box.
    w.player.set(30, 0, 12);
    const walked = frame(w, { drift: 0 }).drawn;
    expect(
      walked.sunWorld.distanceTo(new THREE.Vector3(30, 0, 12).addScaledVector(w.sunDir, 200)),
    ).toBeLessThan(0.02);
  });

  for (const shadows of [false, true]) {
    it(`keeps the held error inside the bands (${shadows ? 'with' : 'without'} a shadow map)`, () => {
      const w = world();
      w.sun.castShadow = true;
      attachSceneGlobalsStabilizer(w.scene);
      frame(w, { drift: 0.5, shadows });
      const directionBand = shadows ? DIRECTION_BAND : DIRECTION_BAND_UNSHADOWED;
      let widest = 0;
      for (let i = 0; i < 300; i++) {
        // the fastest stretch measured online (dusk): colours 1.4e-4, sun 1e-4 rad a frame
        const { drawn, live } = frame(w, { drift: 2e-4, turn: 1e-4, shadows, fogEase: 2e-3 });
        for (let c = 0; c < 3; c++) {
          expect(Math.abs(drawn.sunColor[c] - live.sunColor[c])).toBeLessThanOrEqual(COLOR_BAND);
          expect(Math.abs(drawn.fogColor[c] - live.fogColor[c])).toBeLessThanOrEqual(COLOR_BAND);
        }
        for (let r = 0; r < 2; r++) {
          expect(Math.abs(drawn.fogRange[r] - live.fogRange[r])).toBeLessThanOrEqual(
            FOG_RANGE_BAND * live.fogRange[r] * 1.01,
          );
        }
        const liveDir = new THREE.Vector3().subVectors(live.sunWorld, w.player).normalize();
        const drawnDir = new THREE.Vector3().subVectors(drawn.sunWorld, w.player).normalize();
        const angle = liveDir.angleTo(drawnDir);
        expect(angle).toBeLessThan(directionBand * 2);
        widest = Math.max(widest, angle);
      }
      // the arm really uses its own band: without shadows the held direction
      // lags further than the shadowed band ever allows
      if (!shadows) expect(widest).toBeGreaterThan(DIRECTION_BAND * 2);
    });
  }

  it('commits far less often at the fastest stretch of the day than it renders', () => {
    const w = world();
    const stabilizer = attachSceneGlobalsStabilizer(w.scene);
    frame(w, { drift: 0.5 });
    const before = { ...stabilizer.commits };
    // fog distances eased about a hundred times faster than measured online (6e-6 a frame)
    for (let i = 0; i < 120; i++) frame(w, { drift: 2e-4, turn: 1e-4, fogEase: 1e-5 });
    // 120 renders of the dusk drift. A light commits when ANY of its values
    // crosses its band (two lights, three colours, a direction, the
    // intensities, each crossing at its own time), so the count is per light
    // per render: well under one, where every render re-sent them before.
    const lightRenders = 120 * 2;
    expect((stabilizer.commits.light - before.light) / lightRenders).toBeLessThan(0.25);
    expect((stabilizer.commits.fog - before.fog) / 120).toBeLessThan(0.25);
  });

  it('chains after an existing hook and holds only the outermost of nested renders', () => {
    const w = world();
    const order: string[] = [];
    w.scene.onBeforeRender = () => {
      order.push('earlier');
    };
    const stabilizer = attachSceneGlobalsStabilizer(w.scene);
    frame(w, { drift: 0.5 });
    expect(order).toEqual(['earlier']);
    const r = {} as THREE.WebGLRenderer;
    const fog = w.scene.fog as THREE.Fog;
    fog.color.setRGB(0.2, 0.3, 0.4);
    w.scene.onBeforeRender(r, w.scene, w.camera, null as never, null as never, null as never);
    const held = fog.color.toArray();
    // A nested render (a compile from inside a hook) neither re-holds nor restores.
    w.scene.onBeforeRender(r, w.scene, w.camera, null as never, null as never, null as never);
    w.scene.onAfterRender(r, w.scene, w.camera, null as never, null as never, null as never);
    expect(fog.color.toArray()).toEqual(held);
    w.scene.onAfterRender(r, w.scene, w.camera, null as never, null as never, null as never);
    expect(fog.color.toArray()).toEqual([0.2, 0.3, 0.4]);
    expect(stabilizer.commits.fog).toBeGreaterThan(0);
  });
});
