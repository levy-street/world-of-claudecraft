// QuenchWakeFx, a part of QuenchBody (quench_body.ts): the Blades Wake's
// column on the Guardian of the Quench's own body (plan: quench_wake_core.ts).
// Through the 4 s bar, as both her arms rise to the sky, a beam of cold power
// climbs round her: a dense bright cyan core shooting up from over her
// crown into the dark, inside a deep blue shell streaked with spiralling light that stands
// DARK against the white lake and the pale walls (additive light alone washed
// out to a pale curtain there), and a ring flashing on the ice at its foot.
// Where the beam leaves her crown it flares (round 3): a corona of turning
// rays on a ring round it and a burst of light, so a close or low camera that
// loses the column's top still reads the power at her crown.
// Held, dimmer, through the Blades Hunt. The throw-down is QuenchWakeThrow's
// (quench_wake_throw.ts). Cosmetic: the blades' own warnings are
// QuenchBladesFx's and QuenchFightFx's, on every tier.
//
// Rules (src/render/CLAUDE.md): every geometry and material built in the
// constructor under the owner's gated root; no per-frame allocation; no light.

import * as THREE from 'three';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  QUENCH_WAKE_COLORS as C,
  QUENCH_WAKE_COLUMN as COL,
  type QuenchWakeColumnLook,
  quenchWakeColumnLook,
} from './quench_wake_core';

const NOISE = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1.0, 0.0)), u.x),
             mix(h21(i + vec2(0.0, 1.0)), h21(i + vec2(1.0, 1.0)), u.x), u.y);
}
`;

const TUBE_VERT = /* glsl */ `
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

/** The shell: deep blue at its silhouette (dark on the pale room), streaks of
 *  cyan light spiralling up it, all but clear where it faces the camera so
 *  she stays seen through it. Normal blending: it can darken, never wash. */
const SHELL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uRise;
uniform vec3 uDeep;
uniform vec3 uMid;
uniform vec3 uCore;
varying vec2 vUv;
varying float vFacing;
${NOISE}
void main() {
  float u = vUv.x + vUv.y * 0.55 - uTime * 0.16;
  float streak = vnoise(vec2(u * 24.0, vUv.y * 2.4 - uTime * 2.4));
  float band = vnoise(vec2(u * 7.0 + 3.0, vUv.y * 4.5 - uTime * 1.2));
  float s = smoothstep(0.5, 0.95, streak);
  // Three ribbons of light winding up it.
  float helix = fract(vUv.x * 3.0 + vUv.y * 2.2 - uTime * 0.55);
  float ribbon = smoothstep(0.0, 0.05, helix) * (1.0 - smoothstep(0.08, 0.16, helix));
  s = max(s, ribbon * (0.7 + 0.3 * band));
  float top = smoothstep(uRise, uRise - 0.16, vUv.y);
  float foot = smoothstep(0.0, 0.04, vUv.y);
  float fade = 1.0 - smoothstep(0.62, 1.0, vUv.y);
  // Dark at its silhouette, all but clear where it faces the camera.
  float edge = smoothstep(0.25, 0.85, 1.0 - vFacing);
  float body = edge * (0.75 + 0.25 * band);
  float lit = s * (0.15 + 0.85 * edge);
  float a = uAlpha * top * foot * (0.35 + 0.65 * fade) * max(body, lit * 0.8);
  vec3 col = mix(uDeep, uMid, band * 0.35);
  col = mix(col, uCore, lit * 0.85);
  // The climbing top burns brighter.
  col = mix(col, uCore, smoothstep(uRise - 0.08, uRise, vUv.y) * 0.5);
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.92));
}
`;

/** The core beam: a dense bright cyan shaft, white at its heart, rippling up. */
const CORE_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uRise;
uniform vec3 uCore;
uniform vec3 uHot;
varying vec2 vUv;
varying float vFacing;
${NOISE}
void main() {
  float heart = vFacing * vFacing;
  float ripple = vnoise(vec2(vUv.x * 10.0, vUv.y * 9.0 - uTime * 6.0));
  float top = smoothstep(uRise, uRise - 0.08, vUv.y);
  float foot = smoothstep(0.0, 0.06, vUv.y);
  float fade = 1.0 - smoothstep(0.5, 1.0, vUv.y);
  float a = uAlpha * top * foot * (0.3 + 0.7 * fade) * (0.25 + 0.75 * heart) * (0.7 + 0.45 * ripple);
  // A saturated cyan, a paler heart, never pushed to white (the Quench's
  // tone curve turns an over-bright white cream).
  vec3 col = mix(uCore, uHot, heart * 0.45);
  gl_FragColor = vec4(col * a * 0.6, a);
}
`;

const FOOT_VERT = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** The ring on the ice at the column's foot: a deep blue band, a bright cyan
 *  crest, rime spokes turning inside it. */
const FOOT_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uDeep;
uniform vec3 uCore;
uniform vec3 uHot;
varying vec2 vLocal;
${NOISE}
void main() {
  float r = length(vLocal);
  float ang = atan(vLocal.y, vLocal.x);
  float cd = (r - 0.78) * 14.0;
  float crest = exp(-cd * cd);
  float band = smoothstep(0.6, 0.7, r) * (1.0 - smoothstep(0.88, 0.99, r));
  float spokes = smoothstep(0.7, 1.0, sin(ang * 18.0 + uTime * 1.5) * 0.5 + 0.5)
    * smoothstep(0.3, 0.6, r) * (1.0 - smoothstep(0.62, 0.7, r));
  float rime = vnoise(vec2(ang * 9.0, r * 14.0 - uTime * 0.8));
  float inner = (1.0 - smoothstep(0.0, 0.62, r)) * 0.35 * rime;
  float a = uAlpha * clamp(band * 0.95 + crest + spokes * 0.6 + inner, 0.0, 1.0);
  vec3 col = mix(uDeep, uCore, clamp(crest * 1.2 + spokes * 0.6 + inner, 0.0, 1.0));
  col = mix(col, uHot, crest * 0.5);
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.95));
}
`;

/** The corona at her crown: a ring of light with rays turning out of it, a
 *  disc laid level round the beam (seen from below as from above). */
const HALO_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform vec3 uCore;
uniform vec3 uHot;
varying vec2 vLocal;
void main() {
  float r = length(vLocal);
  if (r > 1.0) discard;
  float ang = atan(vLocal.y, vLocal.x);
  float cd = (r - 0.32) * 11.0;
  float ring = exp(-cd * cd);
  float rays = pow(max(sin(ang * 12.0 + uTime * 1.3), 0.0), 6.0)
    + 0.6 * pow(max(sin(ang * 7.0 - uTime * 0.9 + 1.7), 0.0), 8.0);
  rays *= smoothstep(0.18, 0.34, r) * (1.0 - smoothstep(0.45, 1.0, r));
  float a = uAlpha * clamp(ring + rays * 0.7, 0.0, 1.0);
  vec3 col = mix(uCore, uHot, ring * 0.5);
  gl_FragColor = vec4(col * a * 0.7, a);
}
`;

const _look: QuenchWakeColumnLook = { shell: 0, core: 0, rise: 0, foot: 0 };
const color = (c: readonly [number, number, number]) => new THREE.Color(c[0], c[1], c[2]);

export class QuenchWakeFx {
  private readonly shell: THREE.Mesh;
  private readonly shellMat: THREE.ShaderMaterial;
  private readonly core: THREE.Mesh;
  private readonly coreMat: THREE.ShaderMaterial;
  private readonly foot: THREE.Mesh;
  private readonly footMat: THREE.ShaderMaterial;
  private readonly halo: THREE.Mesh;
  private readonly haloMat: THREE.ShaderMaterial;
  private readonly flare: THREE.Sprite;
  private readonly flareMat: THREE.SpriteMaterial;

  constructor(
    parent: THREE.Object3D,
    private readonly uTime: { value: number },
    materials: THREE.Material[],
    geometries: THREE.BufferGeometry[],
    glowTex: THREE.Texture | null = null,
  ) {
    const shellGeo = new THREE.CylinderGeometry(
      COL.shellR1,
      COL.shellR0,
      COL.height,
      48,
      6,
      true,
    ).translate(0, COL.height / 2, 0);
    const coreGeo = new THREE.CylinderGeometry(
      COL.coreR * 0.7,
      COL.coreR,
      COL.coreHeight,
      20,
      4,
      true,
    ).translate(0, COL.coreFrom + COL.coreHeight / 2, 0);
    // A unit disc scaled to the ring's reach (the shader reads its own radius).
    const footGeo = new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2);
    geometries.push(shellGeo, coreGeo, footGeo);
    this.shellMat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchWakeShell',
      uniforms: {
        uTime,
        uAlpha: { value: 0 },
        uRise: { value: 0 },
        uDeep: { value: color(C.deep) },
        uMid: { value: color(C.mid) },
        uCore: { value: color(C.core) },
      },
      vertexShader: TUBE_VERT,
      fragmentShader: SHELL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: false,
    });
    this.coreMat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchWakeCore',
      uniforms: {
        uTime,
        uAlpha: { value: 0 },
        uRise: { value: 0 },
        uCore: { value: color(C.core) },
        uHot: { value: color(C.hot) },
      },
      vertexShader: TUBE_VERT,
      fragmentShader: CORE_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      // Premultiplied light added over the shell: the core burns, the shell
      // keeps the dark edge round it.
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      fog: false,
    });
    this.footMat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchWakeFoot',
      uniforms: {
        uTime,
        uAlpha: { value: 0 },
        uDeep: { value: color(C.deep) },
        uCore: { value: color(C.core) },
        uHot: { value: color(C.hot) },
      },
      vertexShader: FOOT_VERT,
      fragmentShader: FOOT_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      fog: false,
    });
    this.haloMat = new THREE.ShaderMaterial({
      name: 'smithHeartQuenchWakeHalo',
      uniforms: {
        uTime,
        uAlpha: { value: 0 },
        uCore: { value: color(C.core) },
        uHot: { value: color(C.hot) },
      },
      vertexShader: FOOT_VERT,
      fragmentShader: HALO_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.CustomBlending,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
      fog: false,
    });
    this.flareMat = new THREE.SpriteMaterial({
      name: 'smithHeartQuenchWakeFlare',
      map: glowTex,
      color: color(C.core),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
    });
    materials.push(this.shellMat, this.coreMat, this.footMat, this.haloMat, this.flareMat);
    const mk = (geo: THREE.BufferGeometry, mat: THREE.ShaderMaterial, name: string) => {
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      m.frustumCulled = false;
      m.visible = false;
      parent.add(m);
      return m;
    };
    this.foot = mk(footGeo, this.footMat, 'smithHeartQuenchWakeFoot');
    this.foot.renderOrder = floorVfxRenderOrder('encounter', 5);
    this.foot.scale.setScalar(COL.footR);
    this.shell = mk(shellGeo, this.shellMat, 'smithHeartQuenchWakeShell');
    this.core = mk(coreGeo, this.coreMat, 'smithHeartQuenchWakeCore');
    // The core after the shell (its light over the dark edge).
    this.core.renderOrder = 1;
    this.halo = mk(footGeo, this.haloMat, 'smithHeartQuenchWakeHalo');
    this.halo.renderOrder = 2;
    this.flare = new THREE.Sprite(this.flareMat);
    this.flare.name = 'smithHeartQuenchWakeFlare';
    this.flare.visible = false;
    this.flare.renderOrder = 2;
    parent.add(this.flare);
  }

  /** The column at (x, y, z), `amount` 0..1 (it climbs and brightens with it). */
  setColumn(x: number, y: number, z: number, amount: number): void {
    const look = quenchWakeColumnLook(amount, this.uTime.value, _look);
    if (look.shell <= 0) {
      this.hide();
      return;
    }
    this.shell.visible = true;
    this.core.visible = true;
    this.foot.visible = true;
    this.shell.position.set(x, y, z);
    this.core.position.set(x, y, z);
    this.foot.position.set(x, y + 0.12, z);
    this.shellMat.uniforms.uAlpha.value = look.shell;
    this.shellMat.uniforms.uRise.value = look.rise;
    this.coreMat.uniforms.uAlpha.value = look.core;
    this.coreMat.uniforms.uRise.value = look.rise;
    this.footMat.uniforms.uAlpha.value = look.foot;
    // The flare where the beam leaves her crown, swelling with the core.
    const crownY = y + COL.coreFrom;
    const pulse = 0.9 + 0.1 * Math.sin(this.uTime.value * 7);
    this.halo.visible = look.core > 0.02;
    this.halo.position.set(x, crownY, z);
    this.halo.scale.setScalar(COL.crownHaloR * (0.6 + 0.4 * look.core));
    this.haloMat.uniforms.uAlpha.value = look.core;
    this.flare.visible = look.core > 0.02;
    this.flare.position.set(x, crownY + 0.5, z);
    this.flare.scale.setScalar(COL.crownFlare * look.core * pulse);
    this.flareMat.opacity = Math.min(0.9, look.core * 0.75);
  }

  hide(): void {
    this.shell.visible = false;
    this.core.visible = false;
    this.foot.visible = false;
    this.halo.visible = false;
    this.flare.visible = false;
  }
}
