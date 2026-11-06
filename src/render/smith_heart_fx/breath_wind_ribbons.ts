// The Guardian of the Breath's ribbons, a part of BreathBody: a fixed pool of
// camera-facing strips, each wound along a spine the painter writes every
// frame (no card edge ever shows: the strip turns to the camera round its own
// tangent). Two looks over the same pool shape:
//  - the WIND (normal blend): the living currents that are its body: torn
//    filaments of pale steel-blue air streaming along the spine, a bright
//    white leading edge, a darker blue shade where they run thick (so they
//    read on the pale Cornice and the bright sky); through the storm the same
//    currents turn to a dark cloud core, lit blue-white by its lightning;
//  - the BOLT (additive): lightning, a white-hot core, a blue edge, flickering.
// Alpha is capped under 1 and the bolt's colour under white so stacked
// strips never blow the frame out (the Heat pass's lesson).
//
// Cosmetic (src/render/CLAUDE.md): the owner keeps fewer ribbons on the low
// tier; nothing here is information a player acts on. Both materials are
// built by the owner with its root before the gated attach; fixed buffers
// written in place each frame (one small upload per pool), no light.

import * as THREE from 'three';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';

const RIBBON_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
attribute vec3 aSpine;
attribute vec3 aTan;
attribute vec4 aShape; // width, alpha, distance along (yards), seed
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
void main() {
  vUv = vec2(aShape.z, position.x * 0.5 + 0.5);
  vAlpha = aShape.y;
  vSeed = aShape.w;
  if (aShape.y <= 0.002) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
  vec3 t = aTan;
  float tl = length(t);
  t = tl > 1e-5 ? t / tl : vec3(0.0, 1.0, 0.0);
  vec3 toCam = normalize(cameraPosition - aSpine);
  vec3 side = cross(t, toCam);
  float sl = length(side);
  side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
  vec3 w = aSpine + side * position.x * aShape.x;
  gl_Position = projectionMatrix * wocCamRelView(w);
}
`;

const NOISE = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x),
             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  return vnoise(p) * 0.55 + vnoise(p * 2.03 + 1.7) * 0.3 + vnoise(p * 4.01 + 3.1) * 0.15;
}
`;

const WIND_FRAG = /* glsl */ `
uniform float uTime;
uniform float uFlow;
uniform float uStorm;
uniform float uFlash;
uniform vec3 uWind;
uniform vec3 uEdge;
uniform vec3 uShade;
uniform vec3 uStormBody;
uniform vec3 uStormEdge;
uniform vec3 uStormShade;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
${NOISE}
void main() {
  float across = vUv.y * 2.0 - 1.0;
  if (vSeed >= 2.0) {
    // A soft body strand: smooth, thick in the middle, glowing from within.
    float s2 = (vSeed - 2.0) * 23.0;
    float tt = uTime * uFlow;
    float m = fbm(vec2(vUv.x * 0.32 - tt * 0.7 + s2, across * 1.1 + s2 * 0.3));
    float core = 1.0 - smoothstep(0.0, 1.0, abs(across + (m - 0.5) * 0.4));
    float a2 = vAlpha * core * core * (0.3 + 0.7 * m);
    vec3 c2 = mix(uShade, uWind, 0.35 + 0.65 * m) + uEdge * core * core * 0.18;
    vec3 sc2 = mix(uStormShade, uStormBody, m) + uStormEdge * core * uFlash * 0.4;
    c2 = mix(c2, sc2, uStorm);
    a2 *= 1.0 + 1.6 * uStorm;
    gl_FragColor = vec4(c2, clamp(a2, 0.0, 0.55 + 0.25 * uStorm));
    return;
  }
  float s = vSeed * 31.0;
  float along = vUv.x;
  float t = uTime * uFlow;
  // Torn filaments stretched along the flow, a slower body under them.
  vec2 q = vec2(along * 0.55 - t * 1.25 + s, across * 1.6 + s * 0.37);
  float body = fbm(q);
  float fil = vnoise(vec2(along * 1.7 - t * 2.4 + s * 1.3, across * 6.0 + body * 2.0));
  float wob = (body - 0.5) * 0.7;
  float shape = 1.0 - smoothstep(0.25, 1.0, abs(across + wob));
  float streak = smoothstep(0.5, 0.86, fil);
  // The leading edge, bright; the trailing side shaded.
  float lead = smoothstep(0.15, 0.75, across + wob) * (1.0 - smoothstep(0.75, 1.0, across + wob));
  float a = vAlpha * shape * (0.06 + 0.32 * body * body + 0.62 * streak);
  vec3 col = mix(uShade, uWind, clamp(0.25 + body * 0.9, 0.0, 1.0));
  col = mix(col, uEdge, clamp(lead * streak * 1.3 + streak * 0.25, 0.0, 1.0));
  // The storm: the same currents as a dark cloud, its edges lit by lightning.
  vec3 sc = mix(uStormShade, uStormBody, clamp(body * 1.2, 0.0, 1.0));
  sc = mix(sc, uStormEdge, clamp(lead * 0.35 + streak * (0.25 + uFlash), 0.0, 1.0));
  col = mix(col, sc, uStorm);
  a *= 1.0 + 0.6 * uStorm;
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.62 + 0.15 * uStorm));
}
`;

const BOLT_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uCore;
uniform vec3 uGlow;
varying vec2 vUv;
varying float vAlpha;
varying float vSeed;
void main() {
  float e = abs(vUv.y * 2.0 - 1.0);
  float core = 1.0 - smoothstep(0.0, 0.28, e);
  float glow = 1.0 - smoothstep(0.1, 1.0, e);
  float flick = 0.75 + 0.25 * sin(uTime * 61.0 + vSeed * 40.0 + vUv.x * 3.0);
  vec3 col = mix(uGlow, uCore, core);
  float a = (core * 0.9 + glow * glow * 0.5) * vAlpha * flick;
  gl_FragColor = vec4(min(col * (0.8 + core * 0.5), vec3(0.95)) * a, a);
}
`;

export type RibbonLook = 'wind' | 'bolt';

/** The wind's uniforms (written by the owner each frame). */
export interface WindUniforms {
  uTime: { value: number };
  uFlow: { value: number };
  uStorm: { value: number };
  uFlash: { value: number };
}

const rgb = (c: readonly [number, number, number]) => new THREE.Color(c[0], c[1], c[2]);

export class BreathRibbonPool {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private readonly spine: THREE.BufferAttribute;
  private readonly tan: THREE.BufferAttribute;
  private readonly shape: THREE.BufferAttribute;
  private readonly geo: THREE.BufferGeometry;
  private readonly dyn: readonly THREE.BufferAttribute[];

  constructor(
    name: string,
    readonly ribbons: number,
    readonly segments: number,
    look: RibbonLook,
    uniforms: Record<string, { value: unknown }>,
    materials: THREE.Material[],
    geometries: THREE.BufferGeometry[],
  ) {
    const per = (segments + 1) * 2;
    const verts = ribbons * per;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(verts * 3);
    for (let v = 0; v < verts; v++) pos[v * 3] = v % 2 === 0 ? -1 : 1;
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dyn = (size: number) =>
      new THREE.BufferAttribute(new Float32Array(verts * size), size).setUsage(
        THREE.DynamicDrawUsage,
      );
    this.spine = dyn(3);
    this.tan = dyn(3);
    this.shape = dyn(4);
    geo.setAttribute('aSpine', this.spine);
    geo.setAttribute('aTan', this.tan);
    geo.setAttribute('aShape', this.shape);
    this.dyn = [this.spine, this.tan, this.shape];
    const idx = new Uint32Array(ribbons * segments * 6);
    let k = 0;
    for (let r = 0; r < ribbons; r++)
      for (let i = 0; i < segments; i++) {
        const a = r * per + i * 2;
        idx[k++] = a;
        idx[k++] = a + 1;
        idx[k++] = a + 2;
        idx[k++] = a + 1;
        idx[k++] = a + 3;
        idx[k++] = a + 2;
      }
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.setDrawRange(0, 0);
    this.geo = geo;
    geometries.push(geo);
    this.material = new THREE.ShaderMaterial({
      name,
      uniforms,
      vertexShader: RIBBON_VERT,
      fragmentShader: look === 'wind' ? WIND_FRAG : BOLT_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: look === 'wind' ? THREE.NormalBlending : THREE.AdditiveBlending,
      fog: false,
    });
    materials.push(this.material);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
  }

  /** Write point `i` of ribbon `r`: its spine, tangent, width (yards), alpha,
   *  distance along (yards) and seed. */
  point(
    r: number,
    i: number,
    x: number,
    y: number,
    z: number,
    tx: number,
    ty: number,
    tz: number,
    width: number,
    alpha: number,
    along: number,
    seed: number,
  ): void {
    const v = r * (this.segments + 1) * 2 + i * 2;
    for (let j = 0; j < 2; j++) {
      this.spine.setXYZ(v + j, x, y, z);
      this.tan.setXYZ(v + j, tx, ty, tz);
      this.shape.setXYZW(v + j, width, alpha, along, seed);
    }
  }

  /** Hide ribbon `r` (all its points' alpha to 0). */
  clear(r: number): void {
    const v0 = r * (this.segments + 1) * 2;
    for (let v = v0; v < v0 + (this.segments + 1) * 2; v++) this.shape.setY(v, 0);
  }

  /** Upload this frame's writes; `used` ribbons draw. */
  commit(used: number): void {
    // Only the ribbons in use upload (the rest of the pool is never drawn).
    const verts = Math.max(0, used) * (this.segments + 1) * 2;
    if (verts > 0) {
      for (const at of this.dyn) {
        at.clearUpdateRanges();
        at.addUpdateRange(0, verts * at.itemSize);
        at.needsUpdate = true;
      }
    }
    this.geo.setDrawRange(0, Math.max(0, used) * this.segments * 6);
    this.mesh.visible = used > 0;
  }
}

/** The wind's uniform set (shared colours from the palette, live values). */
export function windUniforms(
  uTime: { value: number },
  c: {
    wind: readonly [number, number, number];
    windEdge: readonly [number, number, number];
    windShade: readonly [number, number, number];
    storm: readonly [number, number, number];
    stormEdge: readonly [number, number, number];
    stormShade: readonly [number, number, number];
  },
): Record<string, { value: unknown }> & WindUniforms {
  return {
    uTime,
    uFlow: { value: 1 },
    uStorm: { value: 0 },
    uFlash: { value: 0 },
    uWind: { value: rgb(c.wind) },
    uEdge: { value: rgb(c.windEdge) },
    uShade: { value: rgb(c.windShade) },
    uStormBody: { value: rgb(c.storm) },
    uStormEdge: { value: rgb(c.stormEdge) },
    uStormShade: { value: rgb(c.stormShade) },
  };
}

/** The bolt's uniform set. */
export function boltUniforms(
  uTime: { value: number },
  core: number,
  glow: number,
): Record<string, { value: unknown }> {
  return {
    uTime,
    uCore: { value: new THREE.Color(core) },
    uGlow: { value: new THREE.Color(glow) },
  };
}
