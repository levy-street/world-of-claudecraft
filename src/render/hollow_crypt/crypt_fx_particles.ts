// The Hollow Crypt's GPU particle kit, shared by the hero creatures' effects
// (crypt_creature_fx.ts) and the finale's (crypt_finale_fx.ts): per-particle
// launch data advected entirely in the vertex shader on one clock, drawn as
// camera-facing sprites; fire runs the Ignivar flame atlas through the
// ghost-fire ramp as upright flame tongues. The CPU writes a particle only
// when it is born.

import * as THREE from 'three';
import { FLAME_ATLAS_GLSL } from '../ignivar_fire_vfx';
import { ghostFireRampGlsl } from './crypt_creature_fx_core';

// ---------------------------------------------------------------- particles

const PARTICLE_COMMON = /* glsl */ `
uniform float uTime;
attribute vec3 aPos0;
attribute vec3 aVel;
attribute vec3 aAcc;
attribute vec4 aLife;   // birth, life, drag, floor
attribute vec4 aShape;  // size0, size1, spin, seed
attribute vec4 aColor;  // rgb, alpha (fire: heat in r)
varying float vT;
varying float vSeed;
varying vec4 vColor;
varying vec2 vUv;
vec3 particlePos(out float t, out float size) {
  float age = uTime - aLife.x;
  t = age / max(aLife.y, 1e-3);
  float drag = max(aLife.z, 1e-3);
  vec3 p = aPos0 + aVel * (1.0 - exp(-drag * age)) / drag + 0.5 * aAcc * age * age;
  p.y = max(p.y, aLife.w);
  size = mix(aShape.x, aShape.y, clamp(t, 0.0, 1.0));
  return p;
}
void billboard(vec3 p, float size, float spin) {
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float c = cos(spin), s = sin(spin);
  vec2 q = vec2(position.x * c - position.y * s, position.x * s + position.y * c);
  vec3 w = p + (camRight * q.x + camUp * q.y) * size;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

export const PARTICLE_VERT = /* glsl */ `
${PARTICLE_COMMON}
void main() {
  float t; float size;
  vec3 p = particlePos(t, size);
  vT = t;
  vSeed = aShape.w;
  vColor = aColor;
  vUv = position.xy + 0.5;
  if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  billboard(p, size, aShape.z * (uTime - aLife.x) + aShape.w * 6.2831);
}
`;

export const FIRE_VERT = /* glsl */ `
${PARTICLE_COMMON}
${FLAME_ATLAS_GLSL}
varying vec2 vUvA;
varying vec2 vUvB;
varying float vBlend;
void main() {
  float t; float size;
  vec3 p = particlePos(t, size);
  vT = t;
  vSeed = aShape.w;
  vColor = aColor;
  vUv = position.xy + 0.5;
  if (t < 0.0 || t > 1.0) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  float ff = min(t * 35.0, 34.999);
  float fA = floor(ff);
  vBlend = ff - fA;
  vec2 corner = position.xy + 0.5;
  vUvA = cellUv(corner, fA);
  vUvB = cellUv(corner, min(fA + 1.0, 35.0));
  // A flame stands upright and licks upward: never spun like a shard. Taller
  // than wide, its base on the particle, its tip swaying with the heat.
  vec3 camRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 camUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  float up = position.y + 0.5;
  float sway = sin(uTime * 7.0 + aShape.w * 40.0) * 0.14 * up * up;
  vec2 q = vec2(position.x * 0.8 + sway, (position.y + 0.32) * 1.75);
  vec3 w = p + (camRight * q.x + camUp * q.y) * size;
  gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
}
`;

/** The ghost-fire ramp (crypt_creature_fx_core.ts GHOST_FIRE_RAMP): warm
 *  grave-light, green-white at the core, never cyan. */
export const GHOST_RAMP = ghostFireRampGlsl();

export const FIRE_FRAG = /* glsl */ `
uniform sampler2D uTex;
uniform float uTime;
varying float vT;
varying float vSeed;
varying vec4 vColor;
varying vec2 vUv;
varying vec2 vUvA;
varying vec2 vUvB;
varying float vBlend;
${GHOST_RAMP}
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  float I = mix(texture2D(uTex, vUvA).r, texture2D(uTex, vUvB).r, vBlend);
  // Tongues of flame licking up through the sprite: scrolling noise carves the
  // flat atlas body into a hot core, licks and dark gaps.
  vec2 q = vUv * vec2(3.0, 2.2) + vec2(vSeed * 13.0, -uTime * 2.6 - vSeed * 7.0);
  float n = vnoise(q) * 0.6 + vnoise(q * 2.3 + 5.1) * 0.4;
  float core = 1.0 - smoothstep(0.0, 0.55, length((vUv - vec2(0.5, 0.3)) * vec2(1.7, 1.0)));
  // A teardrop tongue: wide and round at the base, drawn to a flickering tip.
  float halfW = mix(0.42, 0.04, smoothstep(0.08, 0.95, vUv.y)) * (0.7 + 0.45 * n) * (0.75 + 0.5 * fract(vSeed * 7.13));
  float tongue = (1.0 - smoothstep(halfW * 0.55, halfW, abs(vUv.x - 0.5)))
               * smoothstep(0.0, 0.12, vUv.y);
  float body = I * tongue * (0.45 + 0.8 * n) * (0.6 + 0.65 * core);
  float er = 0.12 + 0.5 * smoothstep(0.4, 1.0, vT);
  float m = smoothstep(er, er + 0.5, body);
  float flick = 0.88 + 0.12 * sin(uTime * 23.0 + vSeed * 61.0);
  // Hottest at the root of each tongue, cooling to grave-green at its tip.
  float heat = vColor.r * mix(1.0, 0.4, smoothstep(0.05, 0.95, vT)) * flick
             * mix(1.2, 0.55, smoothstep(0.05, 0.9, vUv.y));
  vec3 col = ghostRamp(clamp(body * heat, 0.0, 0.98));
  float fade = smoothstep(0.0, 0.08, vT) * (1.0 - smoothstep(0.6, 1.0, vT));
  gl_FragColor = vec4(col * 1.3, m * fade * vColor.a * 0.62);
}
`;

export const GLOW_FRAG = /* glsl */ `
varying float vT;
varying vec4 vColor;
varying vec2 vUv;
void main() {
  float r = length(vUv - 0.5) * 2.0;
  float core = pow(max(1.0 - r, 0.0), 2.2);
  float fade = smoothstep(0.0, 0.1, vT) * (1.0 - smoothstep(0.55, 1.0, vT));
  gl_FragColor = vec4(vColor.rgb * (0.6 + 1.2 * core), core * fade * vColor.a);
}
`;

/** Heat shimmer over the fire (the Ignivar furnace's wobble haze): a faint,
 *  rising band of warped light, additive, so the air over the flames swims. */
export const HAZE_FRAG = /* glsl */ `
uniform float uTime;
varying float vT;
varying float vSeed;
varying vec4 vColor;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float rise = uTime * 5.0 + vSeed * 20.0;
  float wob = sin(vUv.y * 21.0 - rise) * 0.5 + sin(vUv.x * 13.0 + rise * 0.7) * 0.5;
  float mask = (1.0 - smoothstep(0.12, 0.5, length(p * vec2(1.0, 0.8))));
  float fade = smoothstep(0.0, 0.2, vT) * (1.0 - smoothstep(0.55, 1.0, vT));
  gl_FragColor = vec4(vColor.rgb * (0.7 + 0.5 * wob), mask * fade * vColor.a * (0.45 + 0.55 * wob));
}
`;

export const DUST_FRAG = /* glsl */ `
varying float vT;
varying float vSeed;
varying vec4 vColor;
varying vec2 vUv;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  float n = vnoise(vUv * 4.0 + vSeed * 17.0) * 0.6 + vnoise(vUv * 9.0 - vSeed * 5.0) * 0.4;
  float puff = (1.0 - smoothstep(0.25, 1.0, r + (n - 0.5) * 0.55));
  float fade = smoothstep(0.0, 0.12, vT) * (1.0 - smoothstep(0.35, 1.0, vT));
  vec3 col = vColor.rgb * (0.75 + 0.35 * n);
  gl_FragColor = vec4(col, puff * fade * vColor.a);
}
`;

export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  ax?: number;
  ay?: number;
  az?: number;
  life: number;
  drag?: number;
  floor?: number;
  size0: number;
  size1: number;
  spin?: number;
  seed?: number;
  r: number;
  g: number;
  b: number;
  a: number;
}

export class ParticlePool {
  readonly mesh: THREE.Mesh;
  private readonly geo: THREE.InstancedBufferGeometry;
  private readonly pos0: THREE.InstancedBufferAttribute;
  private readonly vel: THREE.InstancedBufferAttribute;
  private readonly acc: THREE.InstancedBufferAttribute;
  private readonly life: THREE.InstancedBufferAttribute;
  private readonly shape: THREE.InstancedBufferAttribute;
  private readonly color: THREE.InstancedBufferAttribute;
  private cursor = 0;
  private dirty = false;
  /** When the last particle born so far dies (the pool hides after it). */
  lastDeath = -1;

  constructor(
    readonly capacity: number,
    readonly material: THREE.ShaderMaterial,
    order: number,
  ) {
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    const attr = (size: number) =>
      new THREE.InstancedBufferAttribute(new Float32Array(capacity * size), size).setUsage(
        THREE.DynamicDrawUsage,
      );
    this.pos0 = attr(3);
    this.vel = attr(3);
    this.acc = attr(3);
    this.life = attr(4);
    this.shape = attr(4);
    this.color = attr(4);
    // Every slot starts long dead.
    for (let i = 0; i < capacity; i++) this.life.setXYZW(i, -1e6, 1, 1, -1e6);
    this.geo.setAttribute('aPos0', this.pos0);
    this.geo.setAttribute('aVel', this.vel);
    this.geo.setAttribute('aAcc', this.acc);
    this.geo.setAttribute('aLife', this.life);
    this.geo.setAttribute('aShape', this.shape);
    this.geo.setAttribute('aColor', this.color);
    this.geo.instanceCount = capacity;
    this.mesh = new THREE.Mesh(this.geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = order;
    this.mesh.visible = false;
  }

  emit(now: number, p: ParticleSpec): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.pos0.setXYZ(i, p.x, p.y, p.z);
    this.vel.setXYZ(i, p.vx, p.vy, p.vz);
    this.acc.setXYZ(i, p.ax ?? 0, p.ay ?? 0, p.az ?? 0);
    this.life.setXYZW(i, now, p.life, p.drag ?? 0.001, p.floor ?? -1e6);
    this.shape.setXYZW(i, p.size0, p.size1, p.spin ?? 0, p.seed ?? (i * 0.6180339) % 1);
    this.color.setXYZW(i, p.r, p.g, p.b, p.a);
    this.lastDeath = Math.max(this.lastDeath, now + p.life);
    this.dirty = true;
  }

  update(now: number): void {
    if (this.dirty) {
      for (const a of [this.pos0, this.vel, this.acc, this.life, this.shape, this.color])
        a.needsUpdate = true;
      this.dirty = false;
    }
    this.mesh.visible = now <= this.lastDeath;
  }

  dispose(): void {
    this.geo.dispose();
  }
}
