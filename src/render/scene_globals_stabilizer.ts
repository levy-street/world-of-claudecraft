// Holds the scene-wide values every lit program uploads (key and hemisphere
// light colour, intensity and direction, the fog colour, the camera's world
// matrix) still between frames unless they really moved, so three's
// per-program uniform cache stops re-sending them to every program on every
// frame. The deadband math, its bands and the measured reason live in
// scene_globals_stabilizer_core.ts.
//
// How it stays exact: the renderer's day/night grade eases these values IN
// PLACE (`color.lerp(target, k)` each frame), so the live objects are the
// integrator and must not be held back or the easing would stall short of its
// target. The stabilizer therefore swaps the committed values in only for the
// duration of a render (the scene's onBeforeRender, which three calls after
// its matrix walk and before it gathers lights) and puts the live values back
// in onAfterRender. The camera's snapped world matrix is the exception: the
// next frame recomposes it from position and rotation anyway, and every
// reader between two renders is better served by the matrix that was drawn.
//
// Directional and hemisphere lights are found once, at the first render: the
// render rule (src/render/CLAUDE.md, GPU work) forbids adding or removing
// either after boot, because their counts key every lit program.
//
// Gameplay-neutral by construction: the largest hold is half an 8-bit colour
// step, the same half step of brightness and of fog, a 0.11 degree direction
// where no shadow map draws (0.011 where one does) and a micrometre of camera
// travel.

import type * as THREE from 'three';
import {
  CAMERA_BAND,
  COLOR_BAND,
  DIRECTION_BAND,
  DIRECTION_BAND_UNSHADOWED,
  deadbandCommit,
  deadbandScalar,
  emptyCommitted,
  FOG_RANGE_BAND,
  INTENSITY_BAND,
} from './scene_globals_stabilizer_core';

/** A light target holds still to 10 micrometres (it is anchored on the player). */
const TARGET_BAND = 1e-5;

interface LightSlot {
  light: THREE.DirectionalLight | THREE.HemisphereLight;
  color: Float64Array;
  ground: Float64Array | null;
  intensity: number;
  /** Directional only: the target's world position and the unit offset to the light. */
  target: Float64Array | null;
  direction: Float64Array | null;
  /** The light's distance from its target, held with the direction (three
   *  normalizes the difference, so only its bits matter, not its size). */
  distance: number;
  /** Live values saved for the restore. */
  liveColor: Float64Array;
  liveGround: Float64Array | null;
  liveIntensity: number;
  liveTranslation: Float64Array;
  liveTargetTranslation: Float64Array;
}

interface CameraSlot {
  world: Float64Array;
  inverse: Float64Array;
}

const scratch3 = new Float64Array(3);

function colorInto(out: Float64Array, c: THREE.Color): Float64Array {
  out[0] = c.r;
  out[1] = c.g;
  out[2] = c.b;
  return out;
}

function writeColor(c: THREE.Color, v: Float64Array): void {
  c.r = v[0];
  c.g = v[1];
  c.b = v[2];
}

export class SceneGlobalsStabilizer {
  private lights: LightSlot[] | null = null;
  private readonly cameras = new WeakMap<THREE.Camera, CameraSlot>();
  private fogColor = emptyCommitted(3);
  private readonly liveFog = new Float64Array(3);
  private fogHeld: THREE.Fog | THREE.FogExp2 | null = null;
  /** Linear fog's near and far (or exponential fog's density in [0]), held and live. */
  private readonly fogRange = emptyCommitted(2);
  private readonly liveFogRange = new Float64Array(2);
  private depth = 0;
  /** Commits since creation, per value family (perf report and tests). */
  readonly commits = { light: 0, fog: 0, camera: 0 };

  /** Before a render of `scene` with `camera`: swap the committed values in.
   *  `renderer` says whether a shadow map draws (the direction band). */
  hold(
    scene: THREE.Scene,
    camera: THREE.Camera,
    renderer?: { shadowMap?: { enabled?: boolean } },
  ): void {
    // A render nested inside another render's hooks (a prewarm compile from a
    // callback) sees the outer hold already in place; only the outermost
    // render swaps and restores.
    if (this.depth++ > 0) return;
    this.holdCamera(camera);
    this.lights ??= this.findLights(scene);
    const shadows = renderer?.shadowMap?.enabled === true;
    for (const slot of this.lights) this.holdLight(slot, shadows);
    const fog = scene.fog;
    if (fog) {
      colorInto(this.liveFog, fog.color);
      let moved = deadbandCommit(this.fogColor, this.liveFog, COLOR_BAND);
      writeColor(fog.color, this.fogColor);
      if (this.holdFogRange(fog)) moved = true;
      if (moved) this.commits.fog++;
      this.fogHeld = fog;
    }
  }

  /** Fog near and far (linear) or density (exponential), each in its relative
   *  band; returns whether it committed. */
  private holdFogRange(fog: THREE.Fog | THREE.FogExp2): boolean {
    const held = this.fogRange;
    const live = this.liveFogRange;
    if ((fog as THREE.FogExp2).isFogExp2) {
      const exp = fog as THREE.FogExp2;
      live[0] = exp.density;
      const next = Number.isNaN(held[0])
        ? exp.density
        : deadbandScalar(held[0], exp.density, FOG_RANGE_BAND);
      const moved = next !== held[0];
      held[0] = next;
      exp.density = next;
      return moved;
    }
    const linear = fog as THREE.Fog;
    live[0] = linear.near;
    live[1] = linear.far;
    const near = Number.isNaN(held[0])
      ? linear.near
      : deadbandScalar(held[0], linear.near, FOG_RANGE_BAND);
    const far = Number.isNaN(held[1])
      ? linear.far
      : deadbandScalar(held[1], linear.far, FOG_RANGE_BAND);
    // Commit both together, so the held pair is always one the integrator held.
    const moved = near !== held[0] || far !== held[1];
    if (moved) {
      held[0] = linear.near;
      held[1] = linear.far;
    }
    linear.near = held[0];
    linear.far = held[1];
    return moved;
  }

  /** After the render: put the live (integrator) values back. */
  release(): void {
    if (--this.depth > 0) return;
    this.depth = 0;
    for (const slot of this.lights ?? []) {
      const light = slot.light;
      writeColor(light.color, slot.liveColor);
      light.intensity = slot.liveIntensity;
      if (slot.liveGround)
        writeColor((light as THREE.HemisphereLight).groundColor, slot.liveGround);
      const e = light.matrixWorld.elements;
      e[12] = slot.liveTranslation[0];
      e[13] = slot.liveTranslation[1];
      e[14] = slot.liveTranslation[2];
      const target = (light as THREE.DirectionalLight).target;
      if (slot.target && target) {
        const t = target.matrixWorld.elements;
        t[12] = slot.liveTargetTranslation[0];
        t[13] = slot.liveTargetTranslation[1];
        t[14] = slot.liveTargetTranslation[2];
      }
    }
    if (this.fogHeld) {
      writeColor(this.fogHeld.color, this.liveFog);
      if ((this.fogHeld as THREE.FogExp2).isFogExp2)
        (this.fogHeld as THREE.FogExp2).density = this.liveFogRange[0];
      else {
        (this.fogHeld as THREE.Fog).near = this.liveFogRange[0];
        (this.fogHeld as THREE.Fog).far = this.liveFogRange[1];
      }
    }
    this.fogHeld = null;
  }

  private findLights(scene: THREE.Scene): LightSlot[] {
    const slots: LightSlot[] = [];
    scene.traverse((o) => {
      const directional = (o as THREE.DirectionalLight).isDirectionalLight === true;
      const hemisphere = (o as THREE.HemisphereLight).isHemisphereLight === true;
      if (!directional && !hemisphere) return;
      const light = o as THREE.DirectionalLight | THREE.HemisphereLight;
      slots.push({
        light,
        color: emptyCommitted(3),
        ground: hemisphere ? emptyCommitted(3) : null,
        intensity: Number.NaN,
        target: directional ? emptyCommitted(3) : null,
        direction: directional ? emptyCommitted(3) : null,
        distance: 0,
        liveColor: new Float64Array(3),
        liveGround: hemisphere ? new Float64Array(3) : null,
        liveIntensity: 0,
        liveTranslation: new Float64Array(3),
        liveTargetTranslation: new Float64Array(3),
      });
    });
    return slots;
  }

  private holdLight(slot: LightSlot, shadows: boolean): void {
    const light = slot.light;
    let moved = deadbandCommit(slot.color, colorInto(slot.liveColor, light.color), COLOR_BAND);
    writeColor(light.color, slot.color);
    slot.liveIntensity = light.intensity;
    const intensity = Number.isNaN(slot.intensity)
      ? light.intensity
      : deadbandScalar(slot.intensity, light.intensity, INTENSITY_BAND);
    if (intensity !== slot.intensity) moved = true;
    slot.intensity = intensity;
    light.intensity = intensity;
    if (slot.ground && slot.liveGround) {
      const ground = (light as THREE.HemisphereLight).groundColor;
      if (deadbandCommit(slot.ground, colorInto(slot.liveGround, ground), COLOR_BAND)) moved = true;
      writeColor(ground, slot.ground);
    }
    const e = light.matrixWorld.elements;
    slot.liveTranslation[0] = e[12];
    slot.liveTranslation[1] = e[13];
    slot.liveTranslation[2] = e[14];
    const target = (light as THREE.DirectionalLight).target;
    if (slot.target && slot.direction && target) {
      // three's direction is (light - target) in world space: hold the target
      // and the unit offset separately, then rebuild the light's position from
      // the held pair, so the subtraction three does is bit-identical while
      // neither moved.
      const t = target.matrixWorld.elements;
      slot.liveTargetTranslation[0] = t[12];
      slot.liveTargetTranslation[1] = t[13];
      slot.liveTargetTranslation[2] = t[14];
      scratch3[0] = t[12];
      scratch3[1] = t[13];
      scratch3[2] = t[14];
      if (deadbandCommit(slot.target, scratch3, TARGET_BAND)) moved = true;
      const dx = e[12] - t[12];
      const dy = e[13] - t[13];
      const dz = e[14] - t[14];
      const length = Math.hypot(dx, dy, dz);
      if (length > 0) {
        scratch3[0] = dx / length;
        scratch3[1] = dy / length;
        scratch3[2] = dz / length;
        // A shadow map stretches a direction error across the shadow's length;
        // without one only the diffuse term reads it.
        const band =
          shadows && (light as THREE.DirectionalLight).castShadow
            ? DIRECTION_BAND
            : DIRECTION_BAND_UNSHADOWED;
        if (deadbandCommit(slot.direction, scratch3, band) || slot.distance === 0) {
          slot.distance = length;
          moved = true;
        }
        const held = slot.distance;
        t[12] = slot.target[0];
        t[13] = slot.target[1];
        t[14] = slot.target[2];
        e[12] = slot.target[0] + slot.direction[0] * held;
        e[13] = slot.target[1] + slot.direction[1] * held;
        e[14] = slot.target[2] + slot.direction[2] * held;
      }
    }
    if (moved) this.commits.light++;
  }

  private holdCamera(camera: THREE.Camera): void {
    let slot = this.cameras.get(camera);
    if (!slot) {
      slot = { world: emptyCommitted(16), inverse: new Float64Array(16) };
      this.cameras.set(camera, slot);
    }
    const world = camera.matrixWorld.elements;
    if (deadbandCommit(slot.world, world, CAMERA_BAND)) {
      // Committed: keep three's own inverse of exactly this matrix.
      slot.inverse.set(camera.matrixWorldInverse.elements);
      this.commits.camera++;
      return;
    }
    const inverse = camera.matrixWorldInverse.elements;
    for (let i = 0; i < 16; i++) {
      world[i] = slot.world[i];
      inverse[i] = slot.inverse[i];
    }
  }
}

/** Chain a stabilizer onto `scene`'s render hooks (after any hook already
 *  there, so it holds the values the earlier hooks wrote). */
export function attachSceneGlobalsStabilizer(scene: THREE.Scene): SceneGlobalsStabilizer {
  const stabilizer = new SceneGlobalsStabilizer();
  const before = scene.onBeforeRender;
  const after = scene.onAfterRender;
  scene.onBeforeRender = ((...args: unknown[]) => {
    (before as (...a: unknown[]) => void).apply(scene, args);
    stabilizer.hold(
      scene,
      args[2] as THREE.Camera,
      args[0] as { shadowMap?: { enabled?: boolean } } | undefined,
    );
  }) as unknown as THREE.Scene['onBeforeRender'];
  scene.onAfterRender = ((...args: unknown[]) => {
    stabilizer.release();
    (after as (...a: unknown[]) => void).apply(scene, args);
  }) as unknown as THREE.Scene['onAfterRender'];
  return stabilizer;
}
