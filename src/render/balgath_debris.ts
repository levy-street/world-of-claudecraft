// The Three half of the boss's ground debris: one pooled Points cloud, one draw call.
//
// Every burst in the fight shares this pool, so the cost of the whole system is fixed no
// matter how many slams land at once: a burst that would overflow simply recycles the
// oldest particles instead of allocating, which is what keeps a raid-sized pile-up from
// turning into a frame spike at exactly the moment the fight is most worth watching.
//
// All the behaviour lives in balgath_debris_core.ts; this file owns buffers and a material.
import * as THREE from 'three';
import type { Surface } from './audio_sink';
import {
  type DebrisParticle,
  debrisAlpha,
  debrisBearing,
  debrisProfileFor,
  debrisSpeedScale,
  MOTE_PROFILE,
  stepDebrisParticle,
} from './balgath_debris_core';

/** Hard pool ceiling. Roughly three simultaneous full-power slams' worth. */
export const MAX_DEBRIS = 560;

/**
 * A custom point shader, rather than PointsMaterial, for exactly one reason: SIZE.
 *
 * `PointsMaterial` carries a single size for the entire cloud, so a pool shared by a
 * footfall puff and a sixteen-yard slam draws both as identical dots and the debris reads
 * as uniform grit however hard he hits. Per-point size is what turns it into clods and
 * chips of different weights, which is the whole difference between "particles" and
 * "material coming off the ground". Alpha rides its own attribute for the same reason:
 * folding it into the colour worked, but it darkened toward black instead of fading out.
 */
const DEBRIS_VERT = `
attribute float aSize;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = color;
  vAlpha = aAlpha;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (300.0 / max(0.001, -mv.z));
  gl_Position = projectionMatrix * mv;
}`;

const DEBRIS_FRAG = `
uniform sampler2D uMap;
uniform float uHasMap;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 uv = gl_PointCoord;
  float mask = uHasMap > 0.5 ? texture2D(uMap, uv).a : (1.0 - smoothstep(0.35, 0.5, length(uv - 0.5)));
  if (mask * vAlpha < 0.01) discard;
  gl_FragColor = vec4(vColor, mask * vAlpha);
}`;

/**
 * A soft round sprite, built once.
 *
 * Guarded for a document-free host the same way the ring textures are: a headless probe
 * ticking this system must not throw, it just draws square points nobody is looking at.
 */
function debrisSprite(): THREE.Texture | undefined {
  if (typeof document === 'undefined') return undefined;
  const size = 32;
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const g = cv.getContext('2d');
  if (!g) return undefined;
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(cv);
  tex.needsUpdate = true;
  return tex;
}

export class BalgathDebris {
  private live: DebrisParticle[] = [];
  private points: THREE.Points | null = null;
  private mat: THREE.ShaderMaterial | null = null;
  private geo: THREE.BufferGeometry | null = null;
  private positions = new Float32Array(MAX_DEBRIS * 3);
  private colors = new Float32Array(MAX_DEBRIS * 3);
  private sizes = new Float32Array(MAX_DEBRIS);
  private alphas = new Float32Array(MAX_DEBRIS);
  private quality = 1;
  private tint = new THREE.Color();
  private moteSeed = 0;

  constructor(private scene: THREE.Scene) {}

  setQuality(level: number): void {
    this.quality = Math.min(1, Math.max(0, level));
  }

  /**
   * Throw a burst of whatever `surface` is made of.
   *
   * `radius` seeds the particles around the rim rather than all at the centre, so a
   * sixteen-yard slam throws a wall of soil and a footfall throws a puff: without it every
   * burst is the same fountain scaled up, which reads as one effect at three sizes.
   */
  burst(x: number, y: number, z: number, surface: Surface, power: number, radius = 0): void {
    if (this.quality < 0.25 || power <= 0.02) return;
    const profile = debrisProfileFor(surface);
    const count = Math.max(3, Math.round(profile.count * power * (0.5 + 0.5 * this.quality)));
    for (let i = 0; i < count; i++) {
      const bearing = debrisBearing(i);
      const speed = debrisSpeedScale(i, count);
      // Seed around the rim, biased outward: the material comes off the EDGE of an impact,
      // not out of its middle.
      const seed = radius * (0.35 + (0.65 * ((i * 7919) % 97)) / 97);
      const accent = ((i * 6151) % 100) / 100 < profile.accent;
      const p: DebrisParticle = {
        x: x + Math.sin(bearing) * seed,
        y: y + 0.15,
        z: z + Math.cos(bearing) * seed,
        vx: Math.sin(bearing) * profile.out * speed,
        vy: profile.lift * (0.55 + 0.45 * speed),
        vz: Math.cos(bearing) * profile.out * speed,
        age: 0,
        life: profile.life * (0.7 + 0.5 * speed),
        size: profile.size * (0.7 + 0.6 * speed),
        color: accent ? profile.colors[1] : profile.colors[0],
        floor: y,
        drag: profile.drag,
        gravity: 1,
        pullK: 0,
      };
      // Recycle rather than allocate past the cap: a pile-up must cost a constant, and the
      // oldest particle is the one nobody is looking at.
      if (this.live.length >= MAX_DEBRIS) this.live.shift();
      this.live.push(p);
    }
  }

  /**
   * One drifting aura mote, optionally drawn toward `pull` (his chest).
   *
   * Rides the same pool and integrator as the thrown debris, so the whole boss costs one
   * draw call however much is going on: the only difference is that a mote has no weight.
   */
  mote(
    x: number,
    y: number,
    z: number,
    color: number,
    size: number,
    pull?: [number, number, number],
    /** Radius to seed around the emission point: the body shell a phase mote hugs. */
    spreadRadius?: number,
  ): void {
    if (this.quality < 0.25) return;
    const bearing = debrisBearing(this.moteSeed++);
    const spread = spreadRadius ?? (pull ? 2.4 : 1.2);
    const p: DebrisParticle = {
      x: x + Math.sin(bearing) * spread,
      y: y + 0.2,
      z: z + Math.cos(bearing) * spread,
      vx: Math.sin(bearing) * MOTE_PROFILE.out * 0.5,
      vy: MOTE_PROFILE.lift * (pull ? 0.4 : 1),
      vz: Math.cos(bearing) * MOTE_PROFILE.out * 0.5,
      age: 0,
      life: MOTE_PROFILE.life,
      size,
      color,
      floor: y,
      drag: MOTE_PROFILE.drag,
      // Buoyant, so they hang and rise instead of falling back like thrown soil.
      gravity: pull ? 0 : -0.06,
      pull,
      pullK: pull ? 26 : 0,
    };
    if (this.live.length >= MAX_DEBRIS) this.live.shift();
    this.live.push(p);
  }

  update(dt: number): void {
    if (this.live.length === 0) {
      if (this.points) this.points.visible = false;
      return;
    }
    for (let i = this.live.length - 1; i >= 0; i--) {
      if (!stepDebrisParticle(this.live[i], dt)) this.live.splice(i, 1);
    }
    this.ensureCloud();
    if (!this.points || !this.geo) return;
    const n = Math.min(this.live.length, MAX_DEBRIS);
    for (let i = 0; i < n; i++) {
      const p = this.live[i];
      this.positions[i * 3] = p.x;
      this.positions[i * 3 + 1] = p.y;
      this.positions[i * 3 + 2] = p.z;
      this.tint.setHex(p.color);
      this.colors[i * 3] = this.tint.r;
      this.colors[i * 3 + 1] = this.tint.g;
      this.colors[i * 3 + 2] = this.tint.b;
      this.sizes[i] = p.size;
      this.alphas[i] = debrisAlpha(p);
    }
    this.points.visible = true;
    this.geo.setDrawRange(0, n);
    for (const name of ['position', 'color', 'aSize', 'aAlpha']) {
      (this.geo.getAttribute(name) as THREE.BufferAttribute).needsUpdate = true;
    }
  }

  private ensureCloud(): void {
    if (this.points) return;
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.sizes, 1));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphas, 1));
    const map = debrisSprite();
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: map ?? null }, uHasMap: { value: map ? 1 : 0 } },
      vertexShader: DEBRIS_VERT,
      fragmentShader: DEBRIS_FRAG,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.scene.add(this.points);
  }

  /** Live particle count, for tests and budget probes. */
  count(): number {
    return this.live.length;
  }

  clear(): void {
    this.live.length = 0;
    if (this.points) this.points.visible = false;
  }

  dispose(): void {
    this.clear();
    if (this.points) this.scene.remove(this.points);
    this.geo?.dispose();
    (this.mat?.uniforms.uMap.value as THREE.Texture | null)?.dispose();
    this.mat?.dispose();
    this.points = null;
    this.geo = null;
    this.mat = null;
  }
}
