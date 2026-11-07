// Mountain's Rush's marks on the Quarry floor, a part of CouncilRushFx: the
// ground the Guardian tears as it runs (a furrowed scar down the run's line, a
// jagged fissure glowing hot along its middle, torn open behind the body as it
// passes, cooling, then fading: council_mechanic_look_core.ts `rushScar`) and
// the star of cracks its feet split open where it plants for the wind-up and
// where it stops. Presentation only (the lane a player reacts to is the
// painted lane, council_rush_fx.ts); drawn on every tier (three draws).
// Built in the constructor under the host's root (the host's one gated attach);
// the scar's strip is re-draped over the floor once per Rush into its own
// preallocated buffer, never a new allocation.

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import type { CouncilFxHost } from './council_pillars_fx';

/** Rings down the scar's strip (each re-draped on the floor). */
const SCAR_ROWS = 64;
/** The scar's half width (yards): a little under the lane's. */
const SCAR_HALF = 1.7;
/** The star of cracks (yards): under the wind-up, and where it stops. */
export const RUSH_STAR = { plant: 4.2, stop: 6.5 } as const;

const SCAR_VERT = /* glsl */ `
attribute vec2 aUV;
varying vec2 vUV;
void main() {
  vUV = aUV;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** aUV.x runs 0 to 1 down the line, aUV.y -1 to 1 across it. */
const SCAR_FRAG = /* glsl */ `
uniform float uReveal;
uniform float uHeat;
uniform float uFade;
uniform float uLen;
uniform float uTime;
uniform vec3 uEarth;
uniform vec3 uLip;
uniform vec3 uCore;
varying vec2 vUV;
float h1(float x) { return fract(sin(x * 127.1) * 43758.5453); }
float n1(float x) { float i = floor(x); float f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(h1(i), h1(i + 1.0), f); }
void main() {
  float u = vUV.x;
  float v = vUV.y;
  if (u > uReveal) discard;
  float yd = u * uLen;
  // The scuffed earth: furrows dragged along the line, ragged edges.
  float edge = 0.78 + 0.22 * n1(yd * 1.7 + 11.0);
  float across = abs(v) / edge;
  if (across > 1.0) discard;
  float furrow = 0.6 + 0.4 * sin(v * 22.0 + n1(yd * 0.6) * 5.0);
  float scuff = (1.0 - smoothstep(0.55, 1.0, across)) * (0.4 + 0.25 * furrow);
  // The fissure: a jagged line down the middle, with short side cracks.
  float off = (n1(yd * 0.9) - 0.5) * 0.5 + (n1(yd * 3.1 + 7.0) - 0.5) * 0.18;
  float d = abs(v - off);
  float split = 1.0 - smoothstep(0.04, 0.12, d);
  float branchAt = fract(yd * 0.42);
  float side = sign(sin(floor(yd * 0.42) * 12.9898));
  float bx = (branchAt - 0.15) * 1.6;
  float branch = step(0.15, branchAt) * step(branchAt, 0.6)
    * (1.0 - smoothstep(0.02, 0.07, abs((v - off) * side - bx)));
  float crack = max(split, branch * 0.8);
  float lip = 1.0 - smoothstep(0.1, 0.26, d);
  // The leading edge, just behind the body, burns brightest.
  float fresh = 1.0 - smoothstep(0.0, 6.0 / max(uLen, 1.0), uReveal - u);
  float heat = clamp(uHeat * (0.55 + 0.45 * sin(uTime * 7.0 + yd)) + fresh, 0.0, 1.0);
  vec3 col = uEarth;
  col = mix(col, uLip, lip * 0.8);
  col = mix(col, uCore * (0.6 + 1.6 * heat), crack * clamp(heat + 0.25, 0.0, 1.0));
  float a = max(scuff, max(lip * 0.75, crack)) * uFade;
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

const STAR_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** A star of cracks split open from the middle out to uGrow (0 to 1): long
 *  jagged fissures and shorter branches between them, each a dark torn lip
 *  round a thin ember core, a crushed dark ring at the heart, the core
 *  cooling with uHeat. */
const STAR_FRAG = /* glsl */ `
uniform float uGrow;
uniform float uHeat;
uniform float uFade;
uniform float uSeed;
uniform vec3 uEarth;
uniform vec3 uLip;
uniform vec3 uCore;
varying vec2 vP;
float h1(float x) { return fract(sin(x * 127.1 + uSeed) * 43758.5453); }
// Lateral distance (disc units) from vP to the nearest of n jagged rays.
float rays(float r, float ang, float n, float salt, out float len) {
  float k = ang * n / 6.2832;
  float cell = floor(k);
  float wob = (h1(cell + salt) - 0.5) * 0.45
    + sin(r * 23.0 + cell * 5.0 + salt) * 0.05
    + sin(r * 61.0 + cell * 1.7) * 0.02;
  float da = abs(fract(k) - 0.5 - wob * 0.5) * 6.2832 / n;
  len = 0.45 + 0.55 * h1(cell + salt + 4.0);
  return da * r;
}
void main() {
  float r = length(vP);
  if (r > 1.0 || r > uGrow + 0.02) discard;
  float ang = atan(vP.y, vP.x);
  float lenA;
  float lenB;
  float dA = rays(r, ang, 9.0, 0.0, lenA);
  float dB = rays(r, ang + 0.35, 17.0, 31.0, lenB);
  float w = 0.014 * (1.25 - r);
  float onA = step(r, lenA);
  float onB = step(r, lenB * 0.55) * step(0.18, r);
  float coreA = (1.0 - smoothstep(w * 0.4, w, dA)) * onA;
  float lipA = (1.0 - smoothstep(w, w * 3.2, dA)) * onA;
  float coreB = (1.0 - smoothstep(w * 0.3, w * 0.7, dB)) * onB;
  float lipB = (1.0 - smoothstep(w * 0.7, w * 2.2, dB)) * onB;
  float heart = 1.0 - smoothstep(0.08, 0.26, r);
  float ring = (1.0 - smoothstep(0.0, 0.03, abs(r - 0.22))) * 0.8;
  float lip = max(max(lipA, lipB * 0.8), max(heart * 0.7, ring * 0.6));
  float core = max(coreA, coreB * 0.75);
  vec3 col = mix(uEarth, uLip, clamp(lip, 0.0, 1.0));
  col = mix(col, uCore * (0.55 + 1.0 * uHeat), core * clamp(uHeat + 0.2, 0.0, 1.0));
  float a = max(lip * 0.8, core) * uFade * (1.0 - smoothstep(0.85, 1.0, r));
  gl_FragColor = vec4(col, clamp(a, 0.0, 1.0));
  #include <colorspace_fragment>
}
`;

const EARTH = 0x2a1e14;
const LIP = 0x4a3220;
/** The fissure's hot core: the vein's ochre fire, never volcanic red. */
const CORE = 0xff8a30;

interface Star {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

export class RushScar {
  private readonly scar: THREE.Mesh;
  private readonly scarMat: THREE.ShaderMaterial;
  private readonly scarPos: THREE.BufferAttribute;
  private readonly stars: Star[] = [];

  constructor(private readonly h: CouncilFxHost) {
    const rows = SCAR_ROWS + 1;
    const pos = new Float32Array(rows * 2 * 3);
    const uv = new Float32Array(rows * 2 * 2);
    for (let i = 0; i < rows; i++)
      for (let j = 0; j < 2; j++) {
        const k = i * 2 + j;
        uv[k * 2] = i / SCAR_ROWS;
        uv[k * 2 + 1] = j === 0 ? -1 : 1;
      }
    const idx: number[] = [];
    for (let i = 0; i < SCAR_ROWS; i++) {
      const a = i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
    const scarGeo = new THREE.BufferGeometry();
    this.scarPos = new THREE.BufferAttribute(pos, 3);
    this.scarPos.setUsage(THREE.DynamicDrawUsage);
    scarGeo.setAttribute('position', this.scarPos);
    scarGeo.setAttribute('aUV', new THREE.BufferAttribute(uv, 2));
    scarGeo.setIndex(idx);
    const starGeo = new THREE.CircleGeometry(1, 48);
    h.geometries.push(scarGeo, starGeo);
    this.scarMat = new THREE.ShaderMaterial({
      name: 'smithHeartRushScar',
      uniforms: {
        uReveal: { value: 0 },
        uHeat: { value: 0 },
        uFade: { value: 0 },
        uLen: { value: 1 },
        uTime: h.uTime,
        uEarth: { value: new THREE.Color(EARTH) },
        uLip: { value: new THREE.Color(LIP) },
        uCore: { value: new THREE.Color(CORE) },
      },
      vertexShader: SCAR_VERT,
      fragmentShader: SCAR_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.scar = new THREE.Mesh(scarGeo, this.scarMat);
    this.scar.name = 'smithHeartRushScar';
    this.scar.visible = false;
    this.scar.frustumCulled = false;
    this.scar.renderOrder = floorVfxRenderOrder('encounter', 11);
    h.root.add(this.scar);
    for (let i = 0; i < 2; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'smithHeartRushStar',
        uniforms: {
          uGrow: { value: 0 },
          uHeat: { value: 0 },
          uFade: { value: 0 },
          uSeed: { value: i * 17.3 },
          uEarth: { value: new THREE.Color(EARTH) },
          uLip: { value: new THREE.Color(0x1a120c) },
          uCore: { value: new THREE.Color(CORE) },
        },
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        toneMapped: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const mesh = new THREE.Mesh(starGeo, mat);
      mesh.name = 'smithHeartRushStar';
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 11);
      h.root.add(mesh);
      h.materials.push(mat);
      this.stars.push({ mesh, mat });
    }
    h.materials.push(this.scarMat);
  }

  /** Lay the scar's strip down the run's line (from, heading, length):
   *  once per Rush, each ring draped on the floor. */
  lay(fx: number, fz: number, dirX: number, dirZ: number, length: number): void {
    const p = this.scarPos.array as Float32Array;
    // Across the line (its right hand).
    const sx = dirZ;
    const sz = -dirX;
    for (let i = 0; i <= SCAR_ROWS; i++) {
      const along = (i / SCAR_ROWS) * length;
      for (let j = 0; j < 2; j++) {
        const w = j === 0 ? -SCAR_HALF : SCAR_HALF;
        const x = fx + dirX * along + sx * w;
        const z = fz + dirZ * along + sz * w;
        const k = (i * 2 + j) * 3;
        p[k] = x - fx;
        p[k + 1] = this.h.groundY(x, z) + 0.07;
        p[k + 2] = z - fz;
      }
    }
    // Relative to the strip's origin (the instance sits far out).
    const y0 = this.h.groundY(fx, fz);
    for (let k = 1; k < p.length; k += 3) p[k] -= y0;
    this.scar.position.set(fx, y0, fz);
    this.scarPos.needsUpdate = true;
    this.scarMat.uniforms.uLen.value = Math.max(1, length);
  }

  /** The scar's state this frame (`rushScar`'s numbers); hidden at 0. */
  paint(reveal: number, heat: number, fade: number): void {
    this.scar.visible = reveal > 0 && fade > 0;
    this.scarMat.uniforms.uReveal.value = reveal;
    this.scarMat.uniforms.uHeat.value = heat;
    this.scarMat.uniforms.uFade.value = fade;
  }

  /** Star 0 (the wind-up's plant) or 1 (the stop) at (x, z), `radius`
   *  yards, opened to `grow` (0 to 1), hot by `heat`, faded by `fade`. */
  star(
    i: 0 | 1,
    x: number,
    z: number,
    radius: number,
    grow: number,
    heat: number,
    fade: number,
  ): void {
    const s = this.stars[i];
    s.mesh.visible = grow > 0 && fade > 0;
    if (!s.mesh.visible) return;
    s.mesh.position.set(x, this.h.groundY(x, z) + 0.09, z);
    s.mesh.scale.set(radius, radius, 1);
    s.mat.uniforms.uGrow.value = grow;
    s.mat.uniforms.uHeat.value = heat;
    s.mat.uniforms.uFade.value = fade;
  }

  hide(): void {
    this.scar.visible = false;
    for (const s of this.stars) s.mesh.visible = false;
  }
}
