// QuenchStrikeCracks, a part of QuenchBody (quench_body.ts): where the
// Guardian of the Quench's two fists hammer the ice (Tempering Strike), the
// lake cracks: jagged cracks race out from a shattered crater, dark lake-deep
// at their edges with a cold cyan light in them, held a moment, then frosted
// over. Plan: quench_strike_core.ts. Cosmetic: the strike's arc and its
// spikes are QuenchFx's, on every tier.
//
// Rules (src/render/CLAUDE.md): a fixed pool of floor quads built in the
// constructor under the owner's gated root; no per-frame allocation; no light.

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  QUENCH_STRIKE_CRACKS as K,
  quenchStrikeCrackLook,
  QUENCH_STRIKE_COLORS as SC,
} from './quench_strike_core';

const VERT = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** Radial cracks from the crater (vLocal in -1..1 of the decal's radius). */
const FRAG = /* glsl */ `
uniform float uOpen;
uniform float uAlpha;
uniform float uGlow;
uniform float uSeed;
uniform vec3 uDeep;
uniform vec3 uCore;
uniform vec3 uHot;
varying vec2 vLocal;
float h11(float n) { return fract(sin(n * 91.345 + uSeed) * 47453.5453); }
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x),
             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  float r = length(vLocal);
  if (r > 1.0) discard;
  float ang = atan(vLocal.y, vLocal.x);
  float best = 10.0;
  for (int i = 0; i < ${K.rays}; i++) {
    float fi = float(i);
    float ai = (fi + 0.5 * h11(fi)) / ${K.rays}.0 * 6.2831853;
    float reach = (0.55 + 0.45 * h11(fi + 17.0)) * uOpen;
    if (r > reach) continue;
    float jag = (vnoise(vec2(r * 7.0, fi * 3.7 + uSeed)) - 0.5) * 0.5;
    float d = abs(sin(ang - ai - jag * r)) * r;
    // a branch off it, half way out
    float bi = ai + (h11(fi + 5.0) - 0.5) * 1.2;
    float bd = abs(sin(ang - bi - jag * 0.6)) * r;
    if (r > 0.35 * uOpen && r < reach * 0.8) d = min(d, bd + 0.004);
    best = min(best, d / max(0.25, 1.0 - r * 0.6));
  }
  float line = 1.0 - smoothstep(0.004, 0.018, best);
  float halo = 1.0 - smoothstep(0.01, 0.06, best);
  // The crater: a shattered disc at the fists, rimmed in deep blue.
  float crater = 1.0 - smoothstep(0.13, 0.17, r + (vnoise(vec2(ang * 3.0, 1.0)) - 0.5) * 0.04);
  float shards = step(0.55, vnoise(vec2(ang * 6.0, r * 18.0))) * crater;
  float a = uAlpha * clamp(halo * 0.75 + crater * 0.85, 0.0, 1.0);
  vec3 col = uDeep;
  col = mix(col, uCore, clamp(line * uGlow + shards * 0.6 * uGlow, 0.0, 1.0));
  col = mix(col, uHot, line * uGlow * (1.0 - smoothstep(0.0, 0.5, r)) * 0.6);
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.92));
}
`;

const color = (c: readonly [number, number, number]) => new THREE.Color(c[0], c[1], c[2]);
const _look = { open: 0, alpha: 0, glow: 0 };

interface Crack {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  live: boolean;
}

export class QuenchStrikeCracks {
  private readonly cracks: Crack[] = [];
  private seed = 0;

  constructor(
    parent: THREE.Object3D,
    count: number,
    materials: THREE.Material[],
    geometries: THREE.BufferGeometry[],
  ) {
    const geo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
    geometries.push(geo);
    for (let i = 0; i < count; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'smithHeartQuenchStrikeCracks',
        uniforms: {
          uOpen: { value: 0 },
          uAlpha: { value: 0 },
          uGlow: { value: 0 },
          uSeed: { value: i * 13.7 },
          uDeep: { value: color(SC.crackDeep) },
          uCore: { value: color(SC.crackCore) },
          uHot: { value: color(SC.crackHot) },
        },
        vertexShader: VERT,
        fragmentShader: FRAG,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
        fog: false,
      });
      materials.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.name = 'smithHeartQuenchStrikeCracks';
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 6);
      parent.add(mesh);
      this.cracks.push({ mesh, mat, born: -99, live: false });
    }
  }

  /** The fists land at (x, y, z) facing `yaw`, at render time `clock`. */
  open(x: number, y: number, z: number, yaw: number, clock: number): void {
    let slot = this.cracks[0];
    for (const c of this.cracks) if (c.born < slot.born) slot = c;
    slot.born = clock;
    slot.live = true;
    this.seed = (this.seed + 1) % 97;
    slot.mat.uniforms.uSeed.value = this.seed * 5.31;
    slot.mesh.position.set(x, y + 0.1, z);
    slot.mesh.rotation.set(0, yaw, 0);
    slot.mesh.scale.setScalar(K.radius);
    slot.mesh.visible = true;
  }

  update(clock: number): void {
    for (const c of this.cracks) {
      if (!c.live) continue;
      const look = quenchStrikeCrackLook(clock - c.born, _look);
      if (look.alpha <= 0) {
        c.live = false;
        c.mesh.visible = false;
        continue;
      }
      c.mat.uniforms.uOpen.value = look.open;
      c.mat.uniforms.uAlpha.value = look.alpha;
      c.mat.uniforms.uGlow.value = look.glow;
    }
  }

  hide(): void {
    for (const c of this.cracks) {
      c.live = false;
      c.mesh.visible = false;
    }
  }
}
