// The Masterless Strength's Overload ring in the room's centre (plan:
// final_overload_ring_core.ts; Jose's brief of 2026-11-20), a part of FinalFx
// (final_fx.ts reads the boss and hands its state in). The HUD's four bars
// moved here, where the whole raid looks:
//   - a great engraved ring inlaid in the floor round the central well (its
//     notches, its rune band, its two grooves), its channel filling like a
//     clock hand's sweep in the colour of the quarter the boss drinks, a hot
//     hand at the front;
//   - the well's glow and a light column over it rising with the fill (no
//     floating text: Jose's playtest of 2026-11-20, the ring alone reads);
//   - from four fifths full: the flicker, the sparks off the ring, the track
//     ahead burning red, and a second, sharper crystal strain at nine
//     tenths from the well (the first, at four fifths, is the fight's own
//     audio's off the boss: game/smith_heart_final_audio_core.ts);
//   - the boss in the centre ring: the whole ring red and pulsing;
//   - a bar reaching 100 percent (the sim's Overload Burst cue, handed in by
//     FinalFx): the explosion out of the well in the quarter's colour, a
//     white-hot flash, a shockwave racing out over the floor to the
//     platform's rim with a faster thin ring ahead of it, the column surging
//     up its full height, the ring flaring and draining back to empty, a
//     boom from the well, debris and sparks (the low tier sheds those only).
// Every tier draws the ring, its fill and colour, the warning's
// light and the centre's red; the low tier sheds the sparks; reduced motion
// keeps a steady light (no flicker, no pulse).
//
// Rules (src/render/CLAUDE.md): every material is built in the constructor
// under FinalFx's root, before its gated attach (the compile gate links them
// hidden); no light; no texture; no per-frame allocation.

import * as THREE from 'three';
import { sfx } from '../../game/sfx';
import { HEART_ROOM, type SmithHeartVein } from '../../sim/content/smith_heart_layout';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { HEART_QUARTER_PALETTE, HEART_RING_LOOK } from '../smith_heart/heart_quarters_core';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  easeSweep,
  newOverloadBurstLook,
  newOverloadRingLook,
  OVERLOAD_BURST,
  OVERLOAD_RING,
  type OverloadBurstLook,
  type OverloadRingState,
  overloadBurstLook,
  overloadBurstPieces,
  overloadRingLook,
  ringWarnBeat,
} from './final_overload_ring_core';

/** What FinalFx lends. */
export interface FinalOverloadRingHost {
  root: THREE.Object3D;
  particles: EngineParticles;
  groundY: (x: number, z: number) => number;
  rand: () => number;
  /** The low tier: no sparks, no debris. */
  low: boolean;
  /** The tier's share of the cosmetic particles. */
  share: number;
  reducedMotion: () => boolean;
  /** One of FinalFx's flash sprites (additive, its radial glow). */
  flash: (
    x: number,
    y: number,
    z: number,
    size: number,
    span: number,
    color: number,
    peak: number,
  ) => void;
}

const RING_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// The inlay, drawn twice off one geometry: the BASE pass lays the carved
// band itself into the floor (dark basalt with its two grooves, the channel
// sunk between two bronze lips, notches every twentieth and longer at the
// quarters, a band of runes), so the ring reads on the pale stone even empty;
// the LIGHT pass (additive) fills the channel like a clock hand's sweep in the
// quarter's colour, white-hot at its hand, the track ahead a faint ember of
// the same colour so the full circle always reads.
const RING_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSweep;
uniform float uLight;
uniform float uFlicker;
uniform float uWarn;
uniform float uCentre;
uniform float uPulse;
uniform float uInner;
uniform float uOuter;
uniform vec3 uColor;
uniform vec3 uHot;
varying vec2 vP;
float rh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  const float TAU = 6.2831853;
  float r = length(vP);
  float u = clamp((r - uInner) / (uOuter - uInner), 0.0, 1.0);
  // Clockwise from the room's north (+z), 0 to 1.
  float f = fract(atan(vP.x, vP.y) / TAU + 1.0);
  float aa = fwidth(f) * 1.5 + 0.0005;
  float filled = 1.0 - smoothstep(uSweep - aa, uSweep + aa, f);
  if (uSweep >= 0.999) filled = 1.0;
  float band = smoothstep(0.0, 0.04, u) * (1.0 - smoothstep(0.96, 1.0, u));
  float groove = exp(-pow((u - 0.06) * 30.0, 2.0)) + exp(-pow((u - 0.94) * 30.0, 2.0));
  float lip = exp(-pow((u - 0.24) * 34.0, 2.0)) + exp(-pow((u - 0.7) * 34.0, 2.0));
  float chan = smoothstep(0.25, 0.3, u) * (1.0 - smoothstep(0.64, 0.69, u));
  float tk = fract(f * 20.0);
  float tkd = min(tk, 1.0 - tk) * TAU * r / 20.0;
  float q = fract(f * 4.0);
  float major = 1.0 - smoothstep(0.004, 0.012, min(q, 1.0 - q));
  float notch = (1.0 - smoothstep(0.1, 0.24, tkd)) * smoothstep(0.08, 0.1, u) * (1.0 - smoothstep(0.2, 0.23, u));
  notch = max(notch, major * smoothstep(0.06, 0.08, u) * (1.0 - smoothstep(0.92, 0.94, u)));
  vec2 cell = vec2(floor(f * 120.0), 0.0);
  float runeBand = smoothstep(0.74, 0.76, u) * (1.0 - smoothstep(0.88, 0.9, u));
  float rv = (u - 0.75) / 0.13;
  float rx = fract(f * 120.0);
  float rune = runeBand * step(0.3, rh(cell)) * max(
    1.0 - smoothstep(0.06, 0.14, abs(rx - 0.5)),
    (1.0 - smoothstep(0.05, 0.12, abs(rv - mix(0.2, 0.8, rh(cell + 7.0))))) * step(0.25, rx) * step(rx, 0.75)
  );
#ifdef BASE
  // The carved band: dark basalt, the channel and grooves darker still, the
  // lips, the notches and the runes a dull bronze.
  vec3 stone = vec3(0.05, 0.035, 0.03);
  vec3 bronze = vec3(0.36, 0.25, 0.13);
  vec3 col = mix(stone, stone * 0.5, max(chan, groove));
  col = mix(col, bronze, clamp(lip * 0.9 + notch * 0.8 + rune * 0.55, 0.0, 1.0));
  float a = band * 0.82;
  if (a <= 0.004) discard;
  gl_FragColor = vec4(col, a);
#else
  // The light: the filled channel blazing, a hand at its front, the track a
  // faint ember; the lips, notches and runes lit where it is filled.
  float behind = fract(uSweep - f + 1.0);
  float hand = filled * exp(-behind * 60.0) * step(0.001, uSweep) * (1.0 - uCentre);
  float flow = 0.8 + 0.2 * sin(f * 180.0 - uTime * 6.0);
  float core = clamp(1.0 - abs(u - 0.47) / 0.22, 0.0, 1.0);
  float lit = chan * mix(0.06, (0.7 + 0.6 * core) * flow, filled);
  float frame = (lip * 0.7 + notch * 0.8 + rune * 0.8 + groove * 0.25) * mix(0.08, 1.0, filled);
  // The zero mark at the room's north, always lit: where the sweep starts.
  float zero = (1.0 - smoothstep(0.0015, 0.004, min(f, 1.0 - f))) * band * (1.0 - uCentre);
  frame += zero * 1.6;
  vec3 col = uColor * (lit * 1.8 + frame) + uHot * (hand * chan * 3.0 + filled * chan * core * 0.35);
  // The warning: the channel's light boils, flecks of white-hot in it, and
  // the little left of the track ahead of the hand burns danger-red.
  col += uHot * uWarn * filled * chan * step(0.8, rh(floor(vec2(f * 240.0, uTime * 16.0)))) * 1.2;
  float gap = (1.0 - filled) * chan * uWarn;
  col += vec3(1.0, 0.16, 0.08) * gap * (0.9 + 0.6 * uPulse);
  lit += gap * 0.9;
  // The centre: the whole ring red, its pulse running round it.
  float run = 0.5 + 0.5 * sin(f * TAU * 3.0 - uTime * 4.0);
  col *= mix(1.0, (0.65 + 0.7 * uPulse) * (0.8 + 0.4 * run), uCentre);
  float a = clamp((lit + frame + hand) * uLight * uFlicker, 0.0, 1.0) * band;
  if (a <= 0.004) discard;
  gl_FragColor = vec4(col * uLight * uFlicker, a);
#endif
  #include <colorspace_fragment>
}`;

const CURTAIN_VERT = /* glsl */ `
varying vec2 vP;
varying float vV;
void main() {
  vP = position.xz;
  vV = uv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// A low curtain of light standing on the ring's outer edge along the filled
// arc only: the sweep still reads from a camera low at a quarter's far rim,
// where the floor's band is seen almost edge on.
const CURTAIN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uSweep;
uniform float uLight;
uniform float uFlicker;
uniform float uCentre;
uniform float uPulse;
uniform vec3 uColor;
uniform vec3 uHot;
varying vec2 vP;
varying float vV;
void main() {
  const float TAU = 6.2831853;
  float f = fract(atan(vP.x, vP.y) / TAU + 1.0);
  float aa = fwidth(f) * 1.5 + 0.0005;
  float filled = 1.0 - smoothstep(uSweep - aa, uSweep + aa, f);
  if (uSweep >= 0.999) filled = 1.0;
  float behind = fract(uSweep - f + 1.0);
  float hand = filled * exp(-behind * 40.0) * (1.0 - uCentre);
  float flick = 0.75 + 0.25 * sin(f * 90.0 + uTime * 5.0 + vV * 6.0);
  float h = pow(1.0 - vV, 2.2) * (0.7 + 0.3 * flick) * (1.0 + hand * 2.5);
  float a = filled * h * uLight * uFlicker * mix(0.8, 0.5 + 0.45 * uPulse, uCentre);
  if (a <= 0.004) discard;
  gl_FragColor = vec4(mix(uColor, uHot, 0.25 + 0.5 * hand) * a * 1.3, a);
  #include <colorspace_fragment>
}`;

const WELL_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// The well's glow: a soft disc of the colour over the well, brightest at its
// heart, rippling outward.
const WELL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLevel;
uniform float uR;
uniform vec3 uColor;
varying vec2 vP;
void main() {
  float r = length(vP) / uR;
  if (r > 1.0) discard;
  float core = exp(-r * r * 3.2);
  float ripple = 0.5 + 0.5 * sin(r * 22.0 - uTime * 3.0);
  float a = uLevel * (core * 0.85 + ripple * (1.0 - r) * 0.18) * (1.0 - smoothstep(0.85, 1.0, r));
  if (a <= 0.004) discard;
  gl_FragColor = vec4(uColor * a * 1.5, a);
  #include <colorspace_fragment>
}`;

const COLUMN_VERT = /* glsl */ `
varying vec2 vUv;
varying float vRim;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 n = normalize(normalMatrix * normal);
  vRim = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`;

// The light column: strands winding up out of the well, gone at its
// silhouette (no hard edge from any angle) and at its rising top.
const COLUMN_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLevel;
uniform float uTop;
uniform float uSurge;
uniform float uFront;
uniform vec3 uColor;
uniform vec3 uHot;
varying vec2 vUv;
varying float vRim;
void main() {
  float y = vUv.y;
  if (y > uTop) discard;
  float top = 1.0 - smoothstep(uTop * 0.55, uTop, y);
  float strand = 0.55 + 0.45 * sin(vUv.x * 6.2831853 * 3.0 + y * 14.0 - uTime * (2.6 + 9.0 * uSurge));
  // The explosion's surge: the column blazing up its whole height, a
  // white-hot front climbing it, the strands racing.
  float front = exp(-pow((y - uFront) * 9.0, 2.0)) * uSurge;
  float body = uLevel * top * strand * (1.0 - y * 0.6) + uSurge * strand * 1.1 * (1.0 - y * 0.75) + front * 2.2;
  float a = body * pow(vRim, 1.4 - 0.6 * uSurge);
  if (a <= 0.004) discard;
  vec3 col = mix(uColor, uHot, clamp(0.35 * (1.0 - y) + 0.55 * uSurge + front, 0.0, 1.0));
  gl_FragColor = vec4(col * a * 1.4, min(a, 1.0));
  #include <colorspace_fragment>
}`;

const SHOCK_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

// The explosion's floor: one band (room-local yards) from the well's rim out
// past the platform's, carrying the main shockwave (a white-hot crest in the
// quarter's colour, a torn scorched wake behind it), the thin faster ring
// ahead of it, and the flash's light pooled on the floor round the well.
const SHOCK_FRAG = /* glsl */ `
uniform float uTime;
uniform float uR1;
uniform float uA1;
uniform float uR2;
uniform float uA2;
uniform float uW;
uniform float uFlash;
uniform float uInner;
uniform vec3 uColor;
uniform vec3 uHot;
varying vec2 vP;
float sh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float sn(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(sh(i), sh(i + vec2(1.0, 0.0)), f.x), mix(sh(i + vec2(0.0, 1.0)), sh(i + vec2(1.0, 1.0)), f.x), f.y);
}
void main() {
  float r = length(vP);
  float ang = atan(vP.y, vP.x);
  // A ragged front: the crest breaks along its length.
  float rag = (sn(vec2(ang * 14.0, uTime * 2.0)) - 0.5) * uW * 0.55;
  float d = uR1 + rag - r;
  // The crest: a coloured glow trailing a thin white-hot leading line.
  float crest = d > 0.0 ? exp(-pow(d / uW, 2.0)) : exp(-pow(d / (uW * 0.3), 2.0));
  float core = exp(-pow((d - uW * 0.15) / (uW * 0.28), 2.0));
  float wake = d > 0.0 ? exp(-d / (uW * 3.0)) * (0.3 + 0.7 * sn(vec2(ang * 22.0, r * 0.6))) : 0.0;
  float streak = 0.65 + 0.35 * sn(vec2(ang * 60.0, 0.0));
  float main1 = (crest * (0.75 + 0.5 * streak) + core * 0.6 + wake * 0.22) * uA1;
  float ring2 = exp(-pow((uR2 - r) / (uW * 0.3), 2.0)) * uA2;
  float pool = uFlash * exp(-pow(max(r - uInner, 0.0) / 14.0, 2.0)) * 0.9;
  vec3 col = uColor * (wake * 0.5 * uA1 + pool + crest * streak * 1.5 * uA1)
    + uHot * (core * 1.6 * uA1 + ring2 * 1.2);
  float a = clamp(main1 + ring2 + pool, 0.0, 1.0) * smoothstep(uInner, uInner + 1.5, r);
  if (a <= 0.004) discard;
  gl_FragColor = vec4(col, a);
  #include <colorspace_fragment>
}`;

/** The column's full height (yards) and its radius at the well. */
const COLUMN_H = 34;
const COLUMN_R = 3.4;

const _hot = new THREE.Color();
/** The explosion's dust (the Anvil's pale granite). */
const DUST: [number, number, number] = [0.46, 0.4, 0.34];
const _rgb: [number, number, number] = [1, 1, 1];

export class FinalOverloadRing {
  private readonly group = new THREE.Group();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly ring: THREE.Mesh;
  private readonly ringMat: THREE.ShaderMaterial;
  /** The carved band under the light (normal blending: dark on pale stone). */
  private readonly ringBase: THREE.Mesh;
  /** The low curtain of light on the filled arc's outer edge. */
  private readonly curtain: THREE.Mesh;
  private readonly well: THREE.Mesh;
  private readonly wellMat: THREE.ShaderMaterial;
  private readonly column: THREE.Mesh;
  private readonly columnMat: THREE.ShaderMaterial;
  private readonly look = newOverloadRingLook();
  /** The explosion's floor (its own group: it plays out even if the ring
   *  goes dark under it). */
  private readonly burstGroup = new THREE.Group();
  private readonly shock: THREE.Mesh;
  private readonly shockMat: THREE.ShaderMaterial;
  private readonly shockGeo: THREE.BufferGeometry;
  private readonly burstLook = newOverloadBurstLook();
  /** When the last explosion went off (host clock; -99 none), whether its
   *  one-off moments are still owed, and its quarter's colours. */
  private burstAt = -99;
  private burstPending = false;
  private burstColor = 0xffffff;
  private burstHot = 0xffffff;
  private clock = 0;
  private readonly uTime = { value: 0 };
  private sweep = 0;
  private lastVein: SmithHeartVein | null = null;
  private lastMode: OverloadRingState['mode'] = 'off';
  private lastFill = 0;
  /** The floor's height under the band and the well's, per slot. */
  private floorKey = Number.NaN;
  private floorY = 0;
  private wellY = 0;
  private sparkOwed = 0;

  constructor(private readonly h: FinalOverloadRingHost) {
    this.group.name = 'smithHeartOverloadRing';
    this.group.visible = false;
    const { inner, outer } = OVERLOAD_RING;
    const ringGeo = new THREE.RingGeometry(inner, outer, 256, 4).rotateX(-Math.PI / 2);
    this.geometries.push(ringGeo);
    const common = {
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
      blending: THREE.AdditiveBlending,
    } as const;
    this.ringMat = new THREE.ShaderMaterial({
      name: 'smithHeartOverloadRing',
      uniforms: {
        uTime: this.uTime,
        uSweep: { value: 0 },
        uLight: { value: 1 },
        uFlicker: { value: 1 },
        uWarn: { value: 0 },
        uCentre: { value: 0 },
        uPulse: { value: 0 },
        uInner: { value: inner },
        uOuter: { value: outer },
        uColor: { value: new THREE.Color(0xffffff) },
        uHot: { value: new THREE.Color(0xffffff) },
      },
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      side: THREE.DoubleSide,
      ...common,
    });
    this.materials.push(this.ringMat);
    const baseMat = new THREE.ShaderMaterial({
      name: 'smithHeartOverloadRingBase',
      uniforms: this.ringMat.uniforms,
      defines: { BASE: '' },
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      side: THREE.DoubleSide,
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.materials.push(baseMat);
    this.ringBase = new THREE.Mesh(ringGeo, baseMat);
    this.ringBase.name = 'smithHeartOverloadRingBase';
    this.ringBase.frustumCulled = false;
    // Under every telegraph on the floor (the encounter's lowest rungs): the
    // carved band, then its light.
    this.ringBase.renderOrder = floorVfxRenderOrder('encounter', 0);
    this.group.add(this.ringBase);
    this.ring = new THREE.Mesh(ringGeo, this.ringMat);
    this.ring.name = 'smithHeartOverloadRingInlay';
    this.ring.frustumCulled = false;
    this.ring.renderOrder = floorVfxRenderOrder('encounter', 1);
    this.group.add(this.ring);
    const curtainR = outer - 0.35;
    const curtainGeo = new THREE.CylinderGeometry(curtainR, curtainR, 2.8, 256, 1, true);
    curtainGeo.translate(0, 1.4, 0);
    this.geometries.push(curtainGeo);
    const curtainMat = new THREE.ShaderMaterial({
      name: 'smithHeartOverloadCurtain',
      uniforms: this.ringMat.uniforms,
      vertexShader: CURTAIN_VERT,
      fragmentShader: CURTAIN_FRAG,
      side: THREE.DoubleSide,
      ...common,
    });
    this.materials.push(curtainMat);
    this.curtain = new THREE.Mesh(curtainGeo, curtainMat);
    this.curtain.name = 'smithHeartOverloadCurtain';
    this.curtain.frustumCulled = false;
    this.group.add(this.curtain);
    const wellR = HEART_RING_LOOK.wellR;
    const wellGeo = new THREE.CircleGeometry(wellR, 96).rotateX(-Math.PI / 2);
    this.geometries.push(wellGeo);
    this.wellMat = new THREE.ShaderMaterial({
      name: 'smithHeartOverloadWell',
      uniforms: {
        uTime: this.uTime,
        uLevel: { value: 0 },
        uR: { value: wellR },
        uColor: { value: new THREE.Color(0xffffff) },
      },
      vertexShader: WELL_VERT,
      fragmentShader: WELL_FRAG,
      ...common,
    });
    this.materials.push(this.wellMat);
    this.well = new THREE.Mesh(wellGeo, this.wellMat);
    this.well.name = 'smithHeartOverloadWellGlow';
    this.well.frustumCulled = false;
    this.well.renderOrder = floorVfxRenderOrder('encounter', 1);
    this.group.add(this.well);
    const colGeo = new THREE.CylinderGeometry(COLUMN_R * 0.7, COLUMN_R, COLUMN_H, 48, 12, true);
    colGeo.translate(0, COLUMN_H / 2, 0);
    this.geometries.push(colGeo);
    this.columnMat = new THREE.ShaderMaterial({
      name: 'smithHeartOverloadColumn',
      uniforms: {
        uTime: this.uTime,
        uLevel: { value: 0 },
        uTop: { value: 0.2 },
        uSurge: { value: 0 },
        uFront: { value: 0 },
        uColor: { value: new THREE.Color(0xffffff) },
        uHot: { value: new THREE.Color(0xffffff) },
      },
      vertexShader: COLUMN_VERT,
      fragmentShader: COLUMN_FRAG,
      side: THREE.DoubleSide,
      ...common,
    });
    this.materials.push(this.columnMat);
    this.column = new THREE.Mesh(colGeo, this.columnMat);
    this.column.name = 'smithHeartOverloadColumn';
    this.column.frustumCulled = false;
    this.group.add(this.column);
    // The explosion's floor: a band from the well's rim out past the
    // platform's (its fronts are uniforms in yards, never a scale), its rings
    // close enough to lie on the floor's steps once laid (readFloor).
    const shockGeo = new THREE.RingGeometry(
      HEART_RING_LOOK.rimOut,
      OVERLOAD_BURST.shockTo + 10,
      192,
      48,
    ).rotateX(-Math.PI / 2);
    this.geometries.push(shockGeo);
    this.shockGeo = shockGeo;
    this.shockMat = new THREE.ShaderMaterial({
      name: 'smithHeartOverloadShock',
      uniforms: {
        uTime: this.uTime,
        uR1: { value: 0 },
        uA1: { value: 0 },
        uR2: { value: 0 },
        uA2: { value: 0 },
        uW: { value: OVERLOAD_BURST.shockWidth },
        uFlash: { value: 0 },
        uInner: { value: HEART_RING_LOOK.rimOut },
        uColor: { value: new THREE.Color(0xffffff) },
        uHot: { value: new THREE.Color(0xffffff) },
      },
      vertexShader: SHOCK_VERT,
      fragmentShader: SHOCK_FRAG,
      side: THREE.DoubleSide,
      ...common,
    });
    this.materials.push(this.shockMat);
    this.shock = new THREE.Mesh(shockGeo, this.shockMat);
    this.shock.name = 'smithHeartOverloadShock';
    this.shock.frustumCulled = false;
    this.shock.renderOrder = floorVfxRenderOrder('encounter', 1);
    this.burstGroup.name = 'smithHeartOverloadBurst';
    this.burstGroup.visible = false;
    this.burstGroup.add(this.shock);
    h.root.add(this.burstGroup);
    h.root.add(this.group);
  }

  /** One frame: `s` the ring's state (final_overload_ring_core.ts), (ox, oz)
   *  the slot's origin, `clock` and `dt` the host's. */
  update(s: OverloadRingState, ox: number, oz: number, clock: number, dt: number): void {
    this.uTime.value = clock;
    this.clock = clock;
    const snap = s.mode !== this.lastMode || s.vein !== this.lastVein || this.lastMode === 'off';
    this.sweep = easeSweep(this.sweep, s.mode === 'centre' ? 1 : s.fill, dt, snap);
    const look = overloadRingLook(
      s,
      this.sweep,
      clock,
      this.h.low,
      this.h.reducedMotion(),
      this.look,
    );
    const cx = ox + HEART_ROOM.x;
    const cz = oz + HEART_ROOM.z;
    this.readFloor(cx, cz);
    const burst = overloadBurstLook(clock - this.burstAt, this.h.reducedMotion(), this.burstLook);
    this.paintBurst(burst, cx, cz);
    if (look.shown <= 0) {
      this.group.visible = false;
      this.lastMode = s.mode;
      this.lastVein = s.vein;
      this.lastFill = 0;
      return;
    }
    this.group.visible = true;
    const y = this.floorY;
    this.group.position.set(cx, y + 0.1, cz);
    // The well and the column stand on the well's own floor.
    const wy = this.wellY - y;
    this.well.position.y = wy + 0.15;
    this.column.position.y = wy;
    const u = this.ringMat.uniforms;
    // Through the explosion the ring keeps the burst quarter's colour while
    // it drains back to empty round the dial, flaring as it goes.
    const draining = burst.live && burst.drain > look.sweep && s.mode !== 'centre';
    const color = draining ? this.burstColor : s.color;
    const hot =
      s.mode === 'centre'
        ? _hot.setHex(0xffb08a)
        : _hot.setHex(
            draining ? this.burstHot : s.vein ? HEART_QUARTER_PALETTE[s.vein].hot : 0xffffff,
          );
    (u.uColor.value as THREE.Color).setHex(color);
    (u.uHot.value as THREE.Color).copy(hot);
    u.uSweep.value = draining ? burst.drain : look.sweep;
    u.uLight.value = look.light + 0.9 * burst.flare;
    u.uFlicker.value = burst.live ? 1 : look.flicker;
    u.uWarn.value = burst.live ? 0 : look.warn;
    u.uCentre.value = s.mode === 'centre' ? 1 : 0;
    u.uPulse.value = look.pulse;
    const w = this.wellMat.uniforms;
    (w.uColor.value as THREE.Color).setHex(color);
    w.uLevel.value = look.well * look.flicker + 1.4 * burst.flare;
    const c = this.columnMat.uniforms;
    (c.uColor.value as THREE.Color).setHex(color);
    (c.uHot.value as THREE.Color).copy(hot);
    c.uLevel.value = (0.55 + 0.45 * look.column) * look.flicker;
    c.uTop.value = 0.12 + 0.88 * Math.max(look.column, burst.surge);
    c.uSurge.value = burst.surge;
    c.uFront.value = burst.surgeFront;
    const girth = 1 + 0.55 * burst.surge;
    this.column.scale.set(girth, 1, girth);
    this.sparks(s, look.sparks, cx, y, cz, dt);
    // The second, sharper warning at nine tenths, from the well (the first,
    // at four fifths, is the fight's own crystal strain off the boss).
    if (s.mode === 'fill' && ringWarnBeat(this.lastVein, this.lastFill, s.vein, s.fill))
      sfx.playAt('heart_final_overload_rising', cx, y + 4, cz, {
        gain: 1,
        rate: 1.22,
        cooldown: 1.5,
        priority: true,
      });
    this.lastMode = s.mode;
    this.lastVein = s.vein;
    this.lastFill = s.fill;
  }

  /** The floor under the band (the well's own ground sits lower than the
   *  platform round its rim): the highest of a few points on the ring. Read
   *  once per slot (the floor never moves). */
  private readFloor(cx: number, cz: number): void {
    if (cx * 7919 + cz === this.floorKey) return;
    this.floorKey = cx * 7919 + cz;
    const mid = (OVERLOAD_RING.inner + OVERLOAD_RING.outer) / 2;
    let top = -Infinity;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      top = Math.max(top, this.h.groundY(cx + Math.sin(a) * mid, cz + Math.cos(a) * mid));
    }
    this.floorY = top;
    this.wellY = this.h.groundY(cx, cz);
    // The shockwave's band laid on the floor it races over (the platform
    // steps down off the ring's dais): each vertex at the ground under it,
    // once per slot, so the wave hugs the stone instead of floating.
    const pos = this.shockGeo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      pos.setY(i, this.h.groundY(cx + x, cz + z) - top);
    }
    pos.needsUpdate = true;
  }

  /** A bar reached 100 percent: the sim's Overload Burst cue (FinalFx reads
   *  it and names the quarter that blew). Its moments play on the next frame. */
  burst(vein: SmithHeartVein): void {
    const pal = HEART_QUARTER_PALETTE[vein];
    this.burstColor = pal.color;
    this.burstHot = pal.hot;
    this.burstAt = this.clock;
    this.burstPending = true;
  }

  /** The explosion's floor, and its one-off moments the frame it starts
   *  (the flashes, the boom, the debris and sparks). */
  private paintBurst(b: OverloadBurstLook, cx: number, cz: number): void {
    this.burstGroup.visible = b.live;
    if (!b.live) {
      this.burstPending = false;
      return;
    }
    const y = this.floorY;
    this.burstGroup.position.set(cx, y + 0.14, cz);
    const u = this.shockMat.uniforms;
    (u.uColor.value as THREE.Color).setHex(this.burstColor);
    (u.uHot.value as THREE.Color).setHex(this.burstHot);
    u.uR1.value = b.shockR;
    u.uA1.value = b.shockAlpha;
    u.uR2.value = b.shock2R;
    u.uA2.value = b.shock2Alpha;
    u.uFlash.value = b.flash;
    if (!this.burstPending) return;
    this.burstPending = false;
    const H = this.h;
    const wy = this.wellY;
    // The flash: a white-hot core over the well in a bloom of the quarter's
    // colour (every tier; reduced motion keeps it short of a white-out).
    const peak = H.reducedMotion() ? OVERLOAD_BURST.flashCalm : 1;
    H.flash(cx, wy + 5, cz, 46, OVERLOAD_BURST.flashSpan + 0.2, this.burstColor, peak);
    H.flash(cx, wy + 4, cz, 20, OVERLOAD_BURST.flashSpan, 0xfff6e8, peak);
    H.flash(cx, wy + 22, cz, 26, OVERLOAD_BURST.flashSpan + 0.35, this.burstHot, peak * 0.8);
    // The boom from the well (the boss's own burst sound is the fight's).
    sfx.playAt('heart_final_anvil_fall', cx, y + 3, cz, {
      gain: 1,
      rate: 0.74,
      cooldown: 1,
      priority: true,
    });
    this.throwPieces(cx, y, cz, wy);
  }

  /** The explosion's debris and sparks (cosmetic: none on the low tier). */
  private throwPieces(cx: number, y: number, cz: number, wy: number): void {
    const H = this.h;
    const n = overloadBurstPieces(H.low, H.share);
    if (n.sparks + n.debris === 0) return;
    const hot = this.burstHot;
    _rgb[0] = ((hot >> 16) & 255) / 255;
    _rgb[1] = ((hot >> 8) & 255) / 255;
    _rgb[2] = (hot & 255) / 255;
    const { inner, outer } = OVERLOAD_RING;
    // Sparks thrown off the ring, out and up, falling back on the floor.
    for (let i = 0; i < n.sparks; i++) {
      const a = H.rand() * Math.PI * 2;
      const r = inner + (outer - inner) * H.rand();
      const sx = Math.sin(a);
      const sz = Math.cos(a);
      H.particles.puff(cx + sx * r, y + 0.4, cz + sz * r, 1, {
        speed: 16 + 18 * H.rand(),
        up: 6 + 10 * H.rand(),
        life: 0.9 + 0.5 * H.rand(),
        size: [0.5, 0.06],
        color: _rgb,
        alpha: 1,
        pool: 'glow',
        dir: [sx, 0.35, sz],
        spread: 0.25,
        gravity: 14,
        drag: 0.5,
      });
    }
    // Embers riding the surge up out of the well.
    const embers = Math.round(n.sparks * 0.35);
    for (let i = 0; i < embers; i++)
      H.particles.puff(cx, wy + 1, cz, 1, {
        speed: 4 + 4 * H.rand(),
        up: 18 + 16 * H.rand(),
        life: 1.4,
        size: [0.7, 0.1],
        color: _rgb,
        alpha: 0.9,
        pool: 'glow',
        radius: 4,
        drag: 0.8,
      });
    // Debris: dust and grit rolling out over the floor behind the wave.
    for (let i = 0; i < n.debris; i++) {
      const a = H.rand() * Math.PI * 2;
      const sx = Math.sin(a);
      const sz = Math.cos(a);
      H.particles.puff(cx + sx * (outer - 0.5), y + 0.6, cz + sz * (outer - 0.5), 1, {
        speed: 12 + 10 * H.rand(),
        up: 1 + 2 * H.rand(),
        life: 1.3 + 0.6 * H.rand(),
        size: [1.6, 4.2],
        color: DUST,
        alpha: 0.55,
        pool: 'smoke',
        dir: [sx, 0.05, sz],
        spread: 0.2,
        drag: 1.6,
      });
    }
  }

  /** The warning's sparks: off the hand and the filled arc (none on the low
   *  tier, none under four fifths). */
  private sparks(
    s: OverloadRingState,
    rate: number,
    cx: number,
    y: number,
    cz: number,
    dt: number,
  ) {
    if (rate <= 0 || s.mode !== 'fill') {
      this.sparkOwed = 0;
      return;
    }
    const H = this.h;
    this.sparkOwed += dt * rate;
    const pal = HEART_QUARTER_PALETTE[s.vein ?? 'hammer'];
    _rgb[0] = ((pal.hot >> 16) & 255) / 255;
    _rgb[1] = ((pal.hot >> 8) & 255) / 255;
    _rgb[2] = (pal.hot & 255) / 255;
    const { inner, outer } = OVERLOAD_RING;
    while (this.sparkOwed >= 1) {
      this.sparkOwed -= 1;
      // Mostly at the hand, the rest along the filled arc.
      const f = H.rand() < 0.45 ? this.sweep - H.rand() * 0.02 : H.rand() * this.sweep;
      const a = f * Math.PI * 2;
      const r = inner + (outer - inner) * (0.35 + 0.3 * H.rand());
      H.particles.puff(cx + Math.sin(a) * r, y + 0.3, cz + Math.cos(a) * r, 1, {
        speed: 2 + 3 * H.rand(),
        up: 5 + 5 * H.rand(),
        life: 0.7,
        size: [0.42, 0.06],
        color: _rgb,
        alpha: 1,
        pool: 'glow',
        gravity: 6,
        radius: 0.4,
      });
    }
  }

  hide(): void {
    this.group.visible = false;
    this.burstGroup.visible = false;
    this.burstAt = -99;
    this.burstPending = false;
    this.lastMode = 'off';
    this.lastVein = null;
    this.lastFill = 0;
  }

  dispose(): void {
    this.group.removeFromParent();
    this.burstGroup.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
