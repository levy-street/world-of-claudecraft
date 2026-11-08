// QuenchWakeFx, a part of QuenchBody (quench_body.ts): the Blades Wake on the
// Guardian of the Quench's own body. Through the 4 s bar, as both her arms rise
// to the sky, a column of cold light climbs round her, streaked and spiralling
// with snow (quench_body_core.ts quenchGlowLook `column`); when her arms are
// thrown down, a bright line races over the ice from her feet to each of the
// four blades as they tear free (quenchWakeLineLook). Held, dimmer, through the
// Blades Hunt. Cosmetic: the blades' own warnings are QuenchBladesFx's and
// QuenchFightFx's, on every tier.
//
// Rules (src/render/CLAUDE.md): every geometry and material built in the
// constructor under the owner's gated root; fixed pools; no per-frame
// allocation; no light.

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { QUENCH_BODY_COLORS as C, QUENCH_YD_PER_UNIT } from './quench_body_core';

const COLUMN_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vFacing = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}
`;
const COLUMN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uRise;
uniform vec3 uColor;
varying vec2 vUv;
varying float vFacing;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x),
             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  // vUv.x round the column, vUv.y up it. Streaks climbing and twisting.
  float u = vUv.x + vUv.y * 0.35 - uTime * 0.12;
  float streak = vnoise(vec2(u * 26.0, vUv.y * 2.0 - uTime * 2.6));
  float band = vnoise(vec2(u * 7.0 + 4.0, vUv.y * 5.0 - uTime * 1.4));
  float s = smoothstep(0.45, 0.95, streak) * 0.85 + band * 0.35;
  // It climbs with the bar: nothing above its rising top.
  float top = smoothstep(uRise, uRise - 0.18, vUv.y);
  float foot = smoothstep(0.0, 0.08, vUv.y);
  float fade = 1.0 - smoothstep(0.65, 1.0, vUv.y);
  // Thin where it faces the camera (she stays seen through it), bright at its
  // silhouette; streaks, never a sheet.
  float edge = 0.22 + 0.78 * (1.0 - vFacing);
  float a = uAlpha * s * top * foot * (0.35 + 0.65 * fade) * edge;
  gl_FragColor = vec4(uColor * (0.8 + 0.9 * s), clamp(a, 0.0, 0.6));
}
`;

const LINE_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** A line racing over the ice: a hot head at uHead, a frost trail behind it. */
const LINE_FRAG = /* glsl */ `
uniform float uHead;
uniform float uAlpha;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
  float core = smoothstep(0.55, 1.0, across);
  float soft = smoothstep(0.0, 1.0, across);
  float behind = step(vUv.x, uHead);
  float head = exp(-abs(vUv.x - uHead) * 18.0);
  float trail = behind * (0.35 + 0.65 * smoothstep(uHead - 0.6, uHead, vUv.x));
  float a = uAlpha * (core * (trail + head * 1.6) + soft * head * 0.8);
  gl_FragColor = vec4(uColor * (1.0 + head * 1.4), clamp(a, 0.0, 1.0));
}
`;

/** The column's size in model units (her own height, a little wider than her
 *  gown's hem). */
const COLUMN_H = 15;
const COLUMN_R0 = 4.2;
const COLUMN_R1 = 2.6;

export class QuenchWakeFx {
  private readonly column: THREE.Mesh;
  private readonly columnMat: THREE.ShaderMaterial;
  private readonly lines: THREE.Mesh[] = [];
  private readonly lineMats: THREE.ShaderMaterial[] = [];

  constructor(
    parent: THREE.Object3D,
    uTime: { value: number },
    lineCount: number,
    materials: THREE.Material[],
    geometries: THREE.BufferGeometry[],
  ) {
    const U = QUENCH_YD_PER_UNIT;
    const geo = new THREE.CylinderGeometry(COLUMN_R1 * U, COLUMN_R0 * U, COLUMN_H * U, 40, 1, true);
    geo.translate(0, (COLUMN_H * U) / 2, 0);
    geometries.push(geo);
    this.columnMat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchWakeColumn',
      uniforms: {
        uTime,
        uAlpha: { value: 0 },
        uRise: { value: 0 },
        uColor: { value: new THREE.Color(C.column[0], C.column[1], C.column[2]) },
      },
      vertexShader: COLUMN_VERT,
      fragmentShader: COLUMN_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    materials.push(this.columnMat);
    this.column = new THREE.Mesh(geo, this.columnMat);
    this.column.name = 'smithHeartQuenchWakeColumn';
    this.column.frustumCulled = false;
    this.column.visible = false;
    parent.add(this.column);
    // A unit strip along +x, one per blade (stretched and turned when drawn).
    const lineGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0);
    geometries.push(lineGeo);
    for (let i = 0; i < lineCount; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'smithHeartQuenchWakeLine',
        uniforms: {
          uHead: { value: 0 },
          uAlpha: { value: 0 },
          uColor: { value: new THREE.Color(C.ring) },
        },
        vertexShader: LINE_VERT,
        fragmentShader: LINE_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      });
      materials.push(mat);
      const m = new THREE.Mesh(lineGeo, mat);
      m.name = 'smithHeartQuenchWakeLine';
      m.frustumCulled = false;
      m.visible = false;
      m.renderOrder = floorVfxRenderOrder('encounter', 5);
      parent.add(m);
      this.lines.push(m);
      this.lineMats.push(mat);
    }
  }

  /** The column at (x, y, z), `amount` 0..1 (it climbs and brightens with it). */
  setColumn(x: number, y: number, z: number, amount: number): void {
    if (amount <= 0.01) {
      this.column.visible = false;
      return;
    }
    this.column.visible = true;
    this.column.position.set(x, y, z);
    this.columnMat.uniforms.uAlpha.value = 0.5 + 0.5 * amount;
    this.columnMat.uniforms.uRise.value = 0.15 + 1.0 * amount;
  }

  /** Line `i` from (x0, z0) to (x1, z1) at height y, its head `head` of the
   *  way (0..1), `alpha` its brightness (0 hides it). */
  setLine(
    i: number,
    x0: number,
    z0: number,
    x1: number,
    z1: number,
    y: number,
    head: number,
    alpha: number,
  ): void {
    const m = this.lines[i];
    if (!m) return;
    if (alpha <= 0.01) {
      m.visible = false;
      return;
    }
    const len = Math.hypot(x1 - x0, z1 - z0);
    m.visible = true;
    m.position.set(x0, y + 0.1, z0);
    m.rotation.set(0, -Math.atan2(z1 - z0, x1 - x0), 0);
    m.scale.set(len, 1, 1.4);
    const u = this.lineMats[i].uniforms;
    u.uHead.value = head;
    u.uAlpha.value = alpha;
  }

  hide(): void {
    this.column.visible = false;
    for (const m of this.lines) m.visible = false;
  }
}
