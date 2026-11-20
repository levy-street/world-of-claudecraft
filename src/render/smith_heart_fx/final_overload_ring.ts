// The Masterless Strength's Overload ring in the room's centre (plan:
// final_overload_ring_core.ts; Jose's brief of 2026-11-20), a part of FinalFx
// (final_fx.ts reads the boss and hands its state in). The HUD's four bars
// moved here, where the whole raid looks:
//   - a great engraved ring inlaid in the floor round the central well (its
//     notches, its rune band, its two grooves), its channel filling like a
//     clock hand's sweep in the colour of the quarter the boss drinks, a hot
//     hand at the front;
//   - the well's glow and a light column over it rising with the fill;
//   - the percent (and the quarter's name) standing in the air over the
//     well, facing every camera, so it reads from any rim of the room;
//   - from four fifths full: the flicker, the sparks off the ring, the track
//     ahead burning red, and a second, sharper crystal strain at nine
//     tenths from the well (the first, at four fifths, is the fight's own
//     audio's off the boss: game/smith_heart_final_audio_core.ts);
//   - the boss in the centre ring: the whole ring red and pulsing, Heart
//     Unbound's stacks over the well.
// Every tier draws the ring, its fill and colour, the label, the warning's
// light and the centre's red; the low tier sheds the sparks; reduced motion
// keeps a steady light (no flicker, no pulse).
//
// Rules (src/render/CLAUDE.md): every material and the label's canvas are
// built in the constructor under FinalFx's root, before its gated attach (the
// compile gate links them hidden); no light; the label redraws (one small
// canvas upload) only when its text or colour changes; no per-frame
// allocation.

import * as THREE from 'three';
import { sfx } from '../../game/sfx';
import { HEART_ROOM, type SmithHeartVein } from '../../sim/content/smith_heart_layout';
import { formatNumber, getI18nRevision, t } from '../../ui/i18n';
import { localizeSimAuraName } from '../../ui/sim_i18n';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { HEART_QUARTER_PALETTE, HEART_RING_LOOK } from '../smith_heart/heart_quarters_core';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  easeSweep,
  newOverloadRingLook,
  OVERLOAD_RING,
  type OverloadRingState,
  overloadRingLook,
  ringLabelKind,
  ringWarnBeat,
} from './final_overload_ring_core';

/** What FinalFx lends. */
export interface FinalOverloadRingHost {
  root: THREE.Object3D;
  particles: EngineParticles;
  groundY: (x: number, z: number) => number;
  rand: () => number;
  /** The low tier: no sparks. */
  low: boolean;
  reducedMotion: () => boolean;
  hasDom: boolean;
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
uniform vec3 uColor;
uniform vec3 uHot;
varying vec2 vUv;
varying float vRim;
void main() {
  float y = vUv.y;
  if (y > uTop) discard;
  float top = 1.0 - smoothstep(uTop * 0.55, uTop, y);
  float strand = 0.55 + 0.45 * sin(vUv.x * 6.2831853 * 3.0 + y * 14.0 - uTime * 2.6);
  float a = uLevel * top * pow(vRim, 1.4) * strand * (1.0 - y * 0.6);
  if (a <= 0.004) discard;
  gl_FragColor = vec4(mix(uColor, uHot, 0.35 * (1.0 - y)) * a * 1.4, a);
  #include <colorspace_fragment>
}`;

/** The column's full height (yards) and its radius at the well. */
const COLUMN_H = 34;
const COLUMN_R = 3.4;

const _hot = new THREE.Color();
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
  private readonly label: THREE.Sprite;
  private readonly labelMat: THREE.SpriteMaterial;
  private readonly canvas: HTMLCanvasElement | null = null;
  private readonly texture: THREE.CanvasTexture | null = null;
  private readonly look = newOverloadRingLook();
  private readonly uTime = { value: 0 };
  private sweep = 0;
  private lastVein: SmithHeartVein | null = null;
  private lastMode: OverloadRingState['mode'] = 'off';
  private lastFill = 0;
  private labelText = '';
  private labelSub = '';
  private labelColor = -1;
  private labelWarn = false;
  private labelRevision = -1;
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
    // The label over the well: a small canvas drawn only when it changes.
    if (h.hasDom) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 256;
      this.canvas = canvas;
      this.texture = new THREE.CanvasTexture(canvas);
      this.texture.colorSpace = THREE.SRGBColorSpace;
      this.texture.generateMipmaps = true;
      this.texture.minFilter = THREE.LinearMipmapLinearFilter;
    }
    this.labelMat = new THREE.SpriteMaterial({
      name: 'smithHeartOverloadLabel',
      map: this.texture,
      transparent: true,
      depthWrite: false,
      fog: false,
      toneMapped: false,
    });
    this.materials.push(this.labelMat);
    this.label = new THREE.Sprite(this.labelMat);
    this.label.name = 'smithHeartOverloadLabel';
    this.label.renderOrder = 10;
    this.label.visible = false;
    this.group.add(this.label);
    h.root.add(this.group);
  }

  /** One frame: `s` the ring's state (final_overload_ring_core.ts), (ox, oz)
   *  the slot's origin, `clock` and `dt` the host's. */
  update(s: OverloadRingState, ox: number, oz: number, clock: number, dt: number): void {
    this.uTime.value = clock;
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
    if (look.shown <= 0) {
      this.group.visible = false;
      this.lastMode = s.mode;
      this.lastVein = s.vein;
      this.lastFill = 0;
      return;
    }
    this.group.visible = true;
    // The floor under the band (the well's own ground sits lower than the
    // platform round its rim): the highest of a few points on the ring.
    // Read once per slot (the floor never moves).
    if (cx * 7919 + cz !== this.floorKey) {
      this.floorKey = cx * 7919 + cz;
      const mid = (OVERLOAD_RING.inner + OVERLOAD_RING.outer) / 2;
      let top = -Infinity;
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        top = Math.max(top, this.h.groundY(cx + Math.sin(a) * mid, cz + Math.cos(a) * mid));
      }
      this.floorY = top;
      this.wellY = this.h.groundY(cx, cz);
    }
    const y = this.floorY;
    this.group.position.set(cx, y + 0.1, cz);
    // The well and the column stand on the well's own floor.
    const wy = this.wellY - y;
    this.well.position.y = wy + 0.15;
    this.column.position.y = wy;
    const u = this.ringMat.uniforms;
    const hot =
      s.mode === 'centre'
        ? _hot.setHex(0xffb08a)
        : _hot.setHex(s.vein ? HEART_QUARTER_PALETTE[s.vein].hot : 0xffffff);
    (u.uColor.value as THREE.Color).setHex(s.color);
    (u.uHot.value as THREE.Color).copy(hot);
    u.uSweep.value = look.sweep;
    u.uLight.value = look.light;
    u.uFlicker.value = look.flicker;
    u.uWarn.value = look.warn;
    u.uCentre.value = s.mode === 'centre' ? 1 : 0;
    u.uPulse.value = look.pulse;
    const w = this.wellMat.uniforms;
    (w.uColor.value as THREE.Color).setHex(s.color);
    w.uLevel.value = look.well * look.flicker;
    const c = this.columnMat.uniforms;
    (c.uColor.value as THREE.Color).setHex(s.color);
    (c.uHot.value as THREE.Color).copy(hot);
    c.uLevel.value = (0.55 + 0.45 * look.column) * look.flicker;
    c.uTop.value = 0.12 + 0.88 * look.column;
    this.paintLabel(s, look.flicker);
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

  /** The label over the well: the percent and the quarter, or Heart
   *  Unbound's stacks. Redrawn only when its text or colour changes. */
  private paintLabel(s: OverloadRingState, flicker: number): void {
    const kind = ringLabelKind(s);
    this.label.visible = kind !== 'none' && this.texture !== null;
    if (!this.label.visible) return;
    const { labelY, labelSize } = OVERLOAD_RING;
    this.label.position.set(0, labelY, 0);
    this.label.scale.set(labelSize * 2, labelSize, 1);
    this.labelMat.opacity = Math.min(1, 0.55 + 0.45 * flicker + (s.mode === 'held' ? -0.3 : 0));
    const text =
      kind === 'pct'
        ? formatNumber(s.pct / 100, { style: 'percent', maximumFractionDigits: 0 })
        : formatNumber(s.stacks, { maximumFractionDigits: 0 });
    const sub =
      kind === 'pct' && s.vein
        ? t(`hudChrome.finalOverload.${s.vein}` as const)
        : (localizeSimAuraName('Heart Unbound') ?? '');
    const revision = getI18nRevision();
    if (
      text === this.labelText &&
      sub === this.labelSub &&
      s.color === this.labelColor &&
      s.warn === this.labelWarn &&
      revision === this.labelRevision
    )
      return;
    this.labelRevision = revision;
    this.labelText = text;
    this.labelSub = sub;
    this.labelColor = s.color;
    this.labelWarn = s.warn;
    this.drawLabel(text, sub, s.color, s.warn || s.mode === 'centre');
  }

  private drawLabel(text: string, sub: string, color: number, danger: boolean): void {
    const canvas = this.canvas;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || !this.texture) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const hex = `#${color.toString(16).padStart(6, '0')}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.font = 'bold 150px "Cinzel", "Trajan Pro", Georgia, serif';
    // A warning (four fifths, or the centre) wears a danger-red rim.
    if (danger) {
      ctx.lineWidth = 26;
      ctx.strokeStyle = 'rgba(255, 40, 20, 0.85)';
      ctx.strokeText(text, 256, 104, 496);
    }
    ctx.lineWidth = 16;
    ctx.strokeStyle = 'rgba(10, 6, 4, 0.92)';
    ctx.strokeText(text, 256, 104, 496);
    ctx.shadowColor = hex;
    ctx.shadowBlur = 28;
    ctx.fillStyle = hex;
    ctx.fillText(text, 256, 104, 496);
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(255, 246, 228, 0.9)';
    ctx.fillText(text, 256, 104, 496);
    // The colour over the white core, so the hue still reads.
    ctx.globalAlpha = 0.55;
    ctx.fillStyle = hex;
    ctx.fillText(text, 256, 104, 496);
    ctx.globalAlpha = 1;
    if (sub) {
      ctx.font = 'bold 44px "Cinzel", "Trajan Pro", Georgia, serif';
      ctx.lineWidth = 9;
      ctx.strokeText(sub, 256, 214, 480);
      ctx.fillStyle = hex;
      ctx.fillText(sub, 256, 214, 480);
    }
    this.texture.needsUpdate = true;
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
    this.lastMode = 'off';
    this.lastVein = null;
    this.lastFill = 0;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.texture?.dispose();
  }
}
