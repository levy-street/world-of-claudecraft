// The Smith's Heart's environment cross-fade, painted (the numbers and the rule:
// heart_env_fade_core.ts). The renderer calls it round its fog-state settle:
// `capture` the live fog and light rig just before a new state's preset is
// written, `arm` right after (it reads the preset as the target and puts the
// old values straight back, so nothing pops), `update` each frame to ease the
// fog's colour and range, the key, the sky fill and its bounce, the IBL and
// the rim from the one to the other, and `steerKey` to turn the key light's
// direction the same way (the shadows swing round instead of jumping). A fade
// caught by another settle starts the next from wherever it stood. It writes
// six numbers, five colours and a direction a frame while a fade runs, and
// nothing otherwise: no allocation, no GPU work.

import * as THREE from 'three';
import {
  HEART_ENV_FADE_SECONDS,
  heartEnvFades,
  heartEnvFadeT,
  heartEnvMix,
} from './heart_env_fade_core';

/** The live fog and light rig the fade reads and writes. */
export interface HeartEnvLive {
  fog: THREE.Fog;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  scene: THREE.Scene;
  rim: { value: number };
  rimColor: { value: THREE.Color };
}

interface Snapshot {
  fogColor: THREE.Color;
  near: number;
  far: number;
  sun: number;
  hemi: number;
  env: number;
  rim: number;
  sunColor: THREE.Color;
  hemiSky: THREE.Color;
  hemiGround: THREE.Color;
  rimColor: THREE.Color;
  key: THREE.Vector3;
}

function snapshot(): Snapshot {
  return {
    fogColor: new THREE.Color(),
    near: 0,
    far: 0,
    sun: 0,
    hemi: 0,
    env: 0,
    rim: 0,
    sunColor: new THREE.Color(),
    hemiSky: new THREE.Color(),
    hemiGround: new THREE.Color(),
    rimColor: new THREE.Color(),
    key: new THREE.Vector3(0, 1, 0),
  };
}

function read(live: HeartEnvLive, out: Snapshot): void {
  out.fogColor.copy(live.fog.color);
  out.near = live.fog.near;
  out.far = live.fog.far;
  out.sun = live.sun.intensity;
  out.hemi = live.hemi.intensity;
  out.env = live.scene.environmentIntensity;
  out.rim = live.rim.value;
  out.sunColor.copy(live.sun.color);
  out.hemiSky.copy(live.hemi.color);
  out.hemiGround.copy(live.hemi.groundColor);
  out.rimColor.copy(live.rimColor.value);
}

function mixColor(a: THREE.Color, b: THREE.Color, t: number, out: THREE.Color): void {
  out.r = heartEnvMix(a.r, b.r, t);
  out.g = heartEnvMix(a.g, b.g, t);
  out.b = heartEnvMix(a.b, b.b, t);
}

export class HeartEnvFade {
  private readonly from = snapshot();
  private readonly to = snapshot();
  private live: HeartEnvLive | null = null;
  private pending = false;
  private active = false;
  private age = 0;
  /** The key light's direction as it last stood (where the next fade turns from). */
  private readonly lastKey = new THREE.Vector3(0, 1, 0);

  /** Just before a settle from `from` to `to`: keep what stands now. */
  capture(from: string, to: string, live: HeartEnvLive): void {
    this.pending = heartEnvFades(from, to);
    if (!this.pending) {
      this.active = false;
      return;
    }
    this.live = live;
    read(live, this.from);
    this.from.key.copy(this.lastKey);
  }

  /** Just after the settle wrote its preset: that is the target; the old
   *  values go straight back, and the fade runs from them. */
  arm(): void {
    const live = this.live;
    if (!this.pending || !live) return;
    this.pending = false;
    read(live, this.to);
    this.active = true;
    this.age = 0;
    this.write(0);
  }

  /** Is a fade running (the key light is being turned)? */
  get running(): boolean {
    return this.active;
  }

  update(dt: number): void {
    if (!this.active) return;
    this.age += Math.max(0, dt);
    if (this.age >= HEART_ENV_FADE_SECONDS) {
      this.write(1);
      this.active = false;
      return;
    }
    this.write(heartEnvFadeT(this.age));
  }

  /** Turn the frame's key-light direction (already the new state's) from
   *  where it stood when the fade began; remember it for the next fade. */
  steerKey(dir: THREE.Vector3): void {
    if (this.active) {
      this.to.key.copy(dir);
      dir.copy(this.from.key).lerp(this.to.key, heartEnvFadeT(this.age)).normalize();
    }
    this.lastKey.copy(dir);
  }

  private write(t: number): void {
    const live = this.live;
    if (!live) return;
    const a = this.from;
    const b = this.to;
    mixColor(a.fogColor, b.fogColor, t, live.fog.color);
    live.fog.near = heartEnvMix(a.near, b.near, t);
    live.fog.far = heartEnvMix(a.far, b.far, t);
    live.sun.intensity = heartEnvMix(a.sun, b.sun, t);
    live.hemi.intensity = heartEnvMix(a.hemi, b.hemi, t);
    live.scene.environmentIntensity = heartEnvMix(a.env, b.env, t);
    live.rim.value = heartEnvMix(a.rim, b.rim, t);
    mixColor(a.sunColor, b.sunColor, t, live.sun.color);
    mixColor(a.hemiSky, b.hemiSky, t, live.hemi.color);
    mixColor(a.hemiGround, b.hemiGround, t, live.hemi.groundColor);
    mixColor(a.rimColor, b.rimColor, t, live.rimColor.value);
  }
}
