// The Mere Hydra's Combined Breath on the Hydra Pool (sim:
// src/sim/encounters/drowned_temple/hydra_combo.ts), composed by temple_fx.ts:
//  - the warning: while two heads hold a combo bar a two-colour ribbon of
//    light links them across the water, one element's colour flowing into the
//    other (a lone survivor carrying both wears a two-colour ring); the mouth
//    charge and the pours are temple_hydra.ts / temple_hydra_fx.ts's;
//  - Frostlocked Torrent: the frozen lane on the floor while the bar runs, a
//    crack of ice down it as it lands, then the ICE WALL: blue crystal with
//    moonlight caught inside, a frosted floor round its foot and cold vapour
//    rising. While a Tsunami warns, the floor of its lee shimmers silver. The
//    wave that breaks on it throws foam and shards everywhere, a white flash
//    and a camera kick, and the wall falls apart into the water; a wall that
//    simply melts sinks away;
//  - Venom Current: a foam arrow under every venom pool pointing the way it
//    will slide, the swollen pools bubbling and leaving a glowing trail;
//  - Toxic Rime: green crystals grow out of each pool, their glow climbing and
//    their pulse quickening toward the burst (a visual countdown), then a ring
//    of green and white shards, a breath of toxic mist and a small kick.
// The lane, the arrows, the wall and the crystals are ACTIONABLE (where not to
// stand, where to hide) and draw on every tier; only the particles shed
// density on the low tier. Reduced motion halves the flashes and skips the
// camera kicks.
//
// State is read off IWorld only (the heads' bars, facing and dead flags, the
// combo objects' template, position, facing and scale) plus the burst cues,
// so offline and online look the same. The math is temple_hydra_combo_core.ts.
// Rules (src/render/CLAUDE.md): every mesh and material is built once here,
// under the gated temple root, collapsed until that gate has linked them;
// after it the whole layer hides while nothing combo stands. No lights; the
// idle frame allocates nothing.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
import {
  BRINE_SPIT_TEMPLATE,
  HYDRA_COMBO_CASTS,
  HYDRA_COMBO_TUNING,
  HYDRA_FROSTLOCKED_TORRENT,
  HYDRA_HEAD_TEMPLATES,
  HYDRA_ICE_WALL_SHATTER,
  HYDRA_RIME_BURST,
  HYDRA_TOXIC_RIME,
  HYDRA_VENOM_CURRENT,
  type HydraElement,
  hydraComboOf,
  ICE_WALL_HALF_THICKNESS,
  ICE_WALL_TEMPLATE,
  RIME_CRYSTAL_TEMPLATE,
  TSUNAMI_TEMPLATES,
  VENOM_CURRENT_TEMPLATE,
  VENOM_POOL_TEMPLATE,
} from '../../sim/encounters/drowned_temple/ids';
import type { SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import type { TelegraphKit, TelegraphLane } from '../floor_telegraph';
import { TELEGRAPH_ACCENTS, TELEGRAPH_THREAT_COLORS } from '../floor_telegraph/telegraph_look_core';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  DUST_FRAG,
  GLOW_FRAG,
  PARTICLE_VERT,
  ParticlePool,
} from '../hollow_crypt/crypt_fx_particles';
import {
  advancePhase,
  burstShake,
  COMBO_ELEMENT_RGB,
  type ComboLane,
  type CurrentArrow,
  comboFill,
  comboHeadElementsInto,
  currentArrowInto,
  currentArrowLeft,
  frostlockLaneInto,
  ICE_WALL_HEIGHT,
  ICE_WALL_LENGTH,
  iceWallLeeSign,
  iceWallMelt,
  iceWallRise,
  type RimeLook,
  rimeLookInto,
  waterHead,
} from './temple_hydra_combo_core';

const COLLAPSED = 1e-4;
const SCAN_SEC = 0.15;
const WALL_SLOTS = 2;
const ARROW_SLOTS = 8;
const CRYSTAL_SLOTS = 6;
const COMBO_CASTS = new Set<string>(Object.values(HYDRA_COMBO_CASTS));
/** The arrow's width on the floor (yards). */
const ARROW_WIDTH = 2.8;
/** How long a breaking wall takes to fall apart into the water. */
const BREAK_SECONDS = 0.9;
/** The frozen lane: a lethal rim (it freezes), a frost accent. */
const LANE_STYLE = {
  color: TELEGRAPH_THREAT_COLORS.lethal,
  accent: TELEGRAPH_ACCENTS.frost,
} as const;

const NOISE = /* glsl */ `
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h21(i), h21(i + vec2(1, 0)), u.x), mix(h21(i + vec2(0, 1)), h21(i + vec2(1, 1)), u.x), u.y);
}
`;

const FLAT_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// The two-colour link between the heads: the first element's colour flows
// into the second's along the ribbon (uv.x), energy waves running both ways,
// brighter edges and a pulse that quickens as the bar fills.
const LINK_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uFill;
uniform float uFade;
uniform float uPhase;
uniform vec3 uColA;
uniform vec3 uColB;
varying vec2 vUv;
${NOISE}
void main() {
  float x = vUv.x;
  float y = abs(vUv.y - 0.5) * 2.0;
  vec3 col = mix(uColA, uColB, smoothstep(0.2, 0.8, x));
  float waveA = pow(max(0.5 + 0.5 * sin(x * 18.0 - uTime * 7.0), 0.0), 6.0) * (1.0 - x);
  float waveB = pow(max(0.5 + 0.5 * sin(x * 18.0 + uTime * 7.0), 0.0), 6.0) * x;
  float core = 1.0 - smoothstep(0.0, 0.55, y);
  float edge = smoothstep(0.75, 0.95, y) * (1.0 - smoothstep(0.95, 1.0, y));
  float n = vnoise(vec2(x * 22.0 - uTime * 3.0, y * 4.0 + uTime));
  float pulse = 0.7 + 0.3 * sin(uPhase);
  float ends = smoothstep(0.0, 0.06, x) * (1.0 - smoothstep(0.94, 1.0, x));
  float a = (core * (0.35 + 0.55 * uFill) * (0.6 + 0.4 * n) + edge * 0.8 + (waveA + waveB) * core * 0.9) * pulse * ends;
  vec3 c = col * (1.1 + 1.4 * (waveA + waveB)) + vec3(1.0) * core * uFill * 0.35;
  gl_FragColor = vec4(c * a * uFade, a * uFade);
}
`;

// A lone survivor's two-colour ring: the halves of the ring each carry one
// element, chasing each other round.
const RING_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uFill;
uniform float uFade;
uniform float uPhase;
uniform vec3 uColA;
uniform vec3 uColB;
varying vec2 vUv;
void main() {
  vec2 p = vUv - 0.5;
  float r = length(p) * 2.0;
  float band = smoothstep(0.7, 0.8, r) * (1.0 - smoothstep(0.94, 1.0, r));
  float a = atan(p.y, p.x) + uPhase;
  float side = 0.5 + 0.5 * sin(a);
  vec3 col = mix(uColA, uColB, smoothstep(0.35, 0.65, side));
  float spark = pow(max(0.5 + 0.5 * sin(a * 6.0 - uTime * 9.0), 0.0), 8.0);
  float alpha = band * (0.55 + 0.45 * uFill + spark * 0.6);
  gl_FragColor = vec4(col * (1.2 + spark) * alpha * uFade, alpha * uFade);
}
`;

const SOLID_VERT = /* glsl */ `${CAMERA_RELATIVE_GLSL}
varying vec3 vN;
varying vec3 vW;
varying float vH;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vW = w.xyz;
  vH = position.y;
  vN = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * wocCamRelView(w.xyz);
}
`;

// The Ice Wall: deep blue at the foot to pale cyan at the crests, cut facets
// lit by the moon, a silver fresnel rim, moonlight caught inside as slow
// streaks, the lee glow while a wave warns, and the white flash of a break.
const WALL_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uFade;
uniform float uFlash;
uniform float uLee;
uniform float uHeight;
varying vec3 vN;
varying vec3 vW;
varying float vH;
${NOISE}
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float fres = pow(max(1.0 - abs(dot(n, v)), 0.0), 2.4);
  vec3 moon = normalize(vec3(-0.14, 0.62, 0.77));
  float lam = 0.35 + 0.65 * max(dot(n, moon), 0.0);
  float h = clamp(vH / uHeight, 0.0, 1.0);
  vec3 deep = vec3(0.03, 0.2, 0.42);
  vec3 pale = vec3(0.6, 0.9, 1.0);
  vec3 base = mix(deep, pale, smoothstep(0.0, 1.0, h));
  float streak = vnoise(vec2((vW.x + vW.z) * 0.55, vW.y * 1.7 - uTime * 0.35));
  float vein = 1.0 - smoothstep(0.0, 0.07, abs(vnoise(vec2(vW.x * 0.9 - vW.z * 0.4, vW.y * 0.8)) - 0.5));
  vec3 inner = vec3(0.7, 0.92, 1.0) * (pow(max(streak, 0.0), 3.0) * 1.3 + vein * 0.9);
  vec3 col = base * lam + inner * 0.55 + vec3(0.85, 0.95, 1.0) * fres * 1.1;
  col += vec3(0.55, 0.95, 1.0) * uLee * (0.35 + 0.35 * sin(uTime * 4.0 + vW.y));
  col = mix(col, vec3(1.0), uFlash * 0.85);
  float a = clamp(0.72 + 0.25 * fres + 0.2 * vein, 0.0, 1.0);
  gl_FragColor = vec4(col, a * uFade);
  #include <colorspace_fragment>
}
`;

// The frost round the wall's foot (additive): sparkling rime fading out from
// the wall's line (uv.x across, centred), its strength `uAlpha`.
const FROST_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
${NOISE}
void main() {
  float across = abs(vUv.x - 0.5) * 2.0;
  float along = abs(vUv.y - 0.5) * 2.0;
  float body = (1.0 - smoothstep(0.2, 1.0, across)) * (1.0 - smoothstep(0.85, 1.0, along));
  float n = vnoise(vUv * vec2(9.0, 60.0));
  float sparkle = pow(max(vnoise(vUv * vec2(40.0, 260.0) + uTime * 0.4), 0.0), 12.0) * 3.0;
  vec3 col = vec3(0.65, 0.88, 1.0) * (0.45 + 0.55 * n) + vec3(1.0) * sparkle;
  gl_FragColor = vec4(col * body * uAlpha, body * uAlpha);
}
`;

// The lee of the wall while a wave warns: a silver shimmer on the floor that
// fades out from the ice (uv.x 0 at the wall, 1 at the lee's depth).
const LEE_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
varying vec2 vUv;
void main() {
  float out1 = vUv.x;
  float along = abs(vUv.y - 0.5) * 2.0;
  float body = (1.0 - smoothstep(0.55, 1.0, out1)) * (1.0 - smoothstep(0.88, 1.0, along));
  float ripple = 0.5 + 0.5 * sin(out1 * 22.0 + uTime * 5.0);
  vec3 col = mix(vec3(0.75, 0.9, 1.0), vec3(1.0), ripple * 0.5);
  float a = body * (0.25 + 0.35 * ripple) * uAlpha;
  gl_FragColor = vec4(col * a, a);
}
`;

// A Venom Current arrow (additive): green foam chevrons flowing the way the
// pool will slide (uv.y 0 at the pool, 1 at the arrow's head), a solid head.
const ARROW_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uAlpha;
uniform float uLeft;
varying vec2 vUv;
${NOISE}
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  float y = 1.0 - vUv.y;
  if (y > uLeft) discard;
  float t = y / max(uLeft, 0.001);
  float shaft = 1.0 - smoothstep(0.3, 0.4, x);
  float head = step(0.7, t) * (1.0 - smoothstep(-0.04, 0.04, x - (1.0 - t) * 3.3));
  float body = max(shaft * step(t, 0.72), head);
  float chev = pow(max(fract(t * 5.0 - x * 0.6 - uTime * 1.6), 0.0), 3.0);
  float foam = vnoise(vec2(x * 6.0, y * 14.0 - uTime * 3.0));
  vec3 col = mix(vec3(0.3, 0.85, 0.35), vec3(0.85, 1.0, 0.8), chev * 0.7 + foam * 0.3);
  float a = body * (0.4 + 0.6 * chev + 0.2 * foam) * uAlpha;
  gl_FragColor = vec4(col * a * 1.3, a);
}
`;

// A Toxic Rime crystal: venom-green glass, white at the tips, its inner glow
// climbing and pulsing faster toward the burst.
const CRYSTAL_FRAG = /* glsl */ `
precision highp float;
uniform float uTime;
uniform float uGlow;
uniform float uPhase;
uniform float uFlash;
uniform float uFade;
uniform float uHeight;
varying vec3 vN;
varying vec3 vW;
varying float vH;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  float fres = pow(max(1.0 - abs(dot(n, v)), 0.0), 2.0);
  float h = clamp(vH / uHeight, 0.0, 1.0);
  float lam = 0.4 + 0.6 * max(dot(n, normalize(vec3(-0.14, 0.62, 0.77))), 0.0);
  vec3 base = mix(vec3(0.05, 0.32, 0.12), vec3(0.55, 1.0, 0.55), h);
  base = mix(base, vec3(0.92, 1.0, 0.95), smoothstep(0.75, 1.0, h));
  float beat = 0.5 + 0.5 * sin(uPhase);
  vec3 glow = vec3(0.55, 1.0, 0.45) * uGlow * (0.6 + 0.8 * beat);
  vec3 col = base * lam + glow + vec3(0.9, 1.0, 0.95) * fres * 0.8;
  col = mix(col, vec3(1.0), uFlash);
  gl_FragColor = vec4(col, (0.82 + 0.18 * fres) * uFade);
  #include <colorspace_fragment>
}
`;

type EntityView = IWorld['entities'] extends Map<number, infer E> ? E : never;

interface FxUniforms {
  uTime: { value: number };
  uFill: { value: number };
  /** The pulse's phase, accumulated on the CPU (radians, wrapped). */
  uPhase: { value: number };
  uFade: { value: number };
  uColA: { value: THREE.Color };
  uColB: { value: THREE.Color };
}

interface WallSlot {
  mesh: THREE.Mesh;
  u: {
    uTime: { value: number };
    uFade: { value: number };
    uFlash: { value: number };
    uLee: { value: number };
    uHeight: { value: number };
  };
  frost: THREE.Mesh;
  frostAlpha: { value: number };
  lee: THREE.Mesh;
  leeAlpha: { value: number };
  objectId: number;
  state: 'idle' | 'live' | 'melt' | 'break';
  seenAt: number;
  age: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  length: number;
  vapourDebt: number;
}

interface ArrowSlot {
  mesh: THREE.Mesh;
  alpha: { value: number };
  left: { value: number };
  objectId: number;
  /** Where its pool was first seen (world), to read how far it has slid. */
  sx: number;
  sz: number;
  /** Its claim's origin (world), read once when the pool is first seen. */
  ox: number;
  oz: number;
}

interface CrystalSlot {
  mesh: THREE.Mesh;
  u: {
    uTime: { value: number };
    uGlow: { value: number };
    uPhase: { value: number };
    uFlash: { value: number };
    uFade: { value: number };
    uHeight: { value: number };
  };
  objectId: number;
  seenAt: number;
  /** Seconds since its burst, or -1. */
  burst: number;
  x: number;
  y: number;
  z: number;
}

/** A deterministic 0..1 sequence for the procedural geometry. */
function seq(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

/** The Ice Wall's crystal: a row of tapered hexagonal shards along local +z
 *  (centred), ICE_WALL_LENGTH long, about ICE_WALL_HEIGHT tall, two half
 *  thicknesses through, flat-faceted (unshared normals). */
function wallGeometry(): THREE.BufferGeometry {
  const rnd = seq(4271);
  const parts: THREE.BufferGeometry[] = [];
  const thick = ICE_WALL_HALF_THICKNESS;
  const n = 30;
  for (let i = 0; i < n; i++) {
    const z = -ICE_WALL_LENGTH / 2 + ((i + 0.5) / n) * ICE_WALL_LENGTH;
    // Taller in the middle of the wall, ragged crests, a few spires.
    const mid = 1 - Math.abs(z / (ICE_WALL_LENGTH / 2)) ** 2 * 0.35;
    const spire = rnd() < 0.18 ? 1.25 : 1;
    const h = ICE_WALL_HEIGHT * mid * spire * (0.72 + 0.4 * rnd());
    const r = thick * (0.9 + 0.5 * rnd());
    const g = new THREE.CylinderGeometry(r * (0.12 + 0.2 * rnd()), r, h, 6, 1).toNonIndexed();
    g.translate(0, h / 2, 0);
    g.rotateZ((rnd() - 0.5) * 0.35);
    g.rotateX((rnd() - 0.5) * 0.3);
    g.rotateY(rnd() * Math.PI);
    g.translate((rnd() - 0.5) * thick * 0.8, 0, z + (rnd() - 0.5) * 0.4);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    parts.push(g);
  }
  // A low foot of rough ice joining the shards.
  const foot = new THREE.BoxGeometry(thick * 2.1, 0.9, ICE_WALL_LENGTH, 1, 1, 8).toNonIndexed();
  foot.translate(0, 0.45, 0);
  foot.deleteAttribute('uv');
  foot.deleteAttribute('normal');
  parts.push(foot);
  const merged = mergeGeometries(parts) ?? new THREE.BufferGeometry();
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return merged;
}

/** A Toxic Rime cluster: shards leaning out of the pool, about 2.4 yd round. */
const CRYSTAL_H = 2.6;
function crystalGeometry(): THREE.BufferGeometry {
  const rnd = seq(911);
  const parts: THREE.BufferGeometry[] = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rnd() * 0.5;
    const d = i === 0 ? 0 : 0.6 + rnd() * 1.6;
    const h = CRYSTAL_H * (i === 0 ? 1 : 0.45 + 0.5 * rnd());
    const r = 0.22 + 0.25 * rnd();
    const g = new THREE.CylinderGeometry(0, r, h, 6, 1).toNonIndexed();
    g.translate(0, h / 2, 0);
    g.rotateX(d > 0 ? 0.25 + 0.35 * rnd() : 0);
    g.rotateY(a);
    g.translate(Math.sin(a) * d, 0, Math.cos(a) * d);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    parts.push(g);
  }
  const merged = mergeGeometries(parts) ?? new THREE.BufferGeometry();
  for (const p of parts) p.dispose();
  merged.computeVertexNormals();
  return merged;
}

export class TempleHydraComboFx {
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly materials: THREE.Material[] = [];
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly glow: ParticlePool;
  private readonly mist: ParticlePool;
  private readonly density: number;
  private readonly link: THREE.Mesh;
  private readonly linkU: FxUniforms;
  private readonly ring: THREE.Mesh;
  private readonly ringU: FxUniforms;
  private readonly lane: TelegraphLane;
  private readonly walls: WallSlot[] = [];
  private readonly arrows: ArrowSlot[] = [];
  private readonly crystals: CrystalSlot[] = [];
  private readonly heads: (number | null)[] = [null, null, null];
  private readonly dead = [true, true, true];
  private readonly laneNow: ComboLane = { x: 0, z: 0, yaw: 0, length: 0, halfWidth: 0 };
  private readonly arrowNow: CurrentArrow = { x: 0, z: 0, yaw: 0, length: 0 };
  private readonly rime: RimeLook = { grow: 0, glow: 0, pulse: 0 };
  private scan = 0;
  private seed = 23;
  private linkFade = 0;
  private ringFade = 0;
  private laneOn = false;
  private currentBar = false;
  private waveFacing: number | null = null;
  private gated = false;
  private clock = 0;
  private linkDebt = 0;
  private trailDebt = 0;
  private readonly elsA: HydraElement[] = [];
  private readonly elsB: HydraElement[] = [];

  constructor(
    parent: THREE.Group,
    private readonly world: IWorld | undefined,
    private readonly groundY: (x: number, z: number) => number,
    detail: boolean,
    private readonly kit: TelegraphKit,
    private readonly shake?: (amount: number) => void,
    private readonly calm: () => boolean = () => false,
  ) {
    this.root.name = 'drowned-temple-hydra-combo-fx';
    parent.add(this.root);
    this.density = detail ? 1 : 0.35;
    const particleMat = (frag: string, blending: THREE.Blending) => {
      const m = new THREE.ShaderMaterial({
        uniforms: { uTime: this.uTime },
        vertexShader: PARTICLE_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending,
      });
      this.materials.push(m);
      return m;
    };
    this.glow = new ParticlePool(
      Math.round(2200 * this.density),
      particleMat(GLOW_FRAG, THREE.AdditiveBlending),
      floorVfxRenderOrder('encounter', 8),
    );
    this.mist = new ParticlePool(
      Math.round(700 * this.density),
      particleMat(DUST_FRAG, THREE.NormalBlending),
      floorVfxRenderOrder('encounter', 7),
    );
    this.root.add(this.glow.mesh, this.mist.mesh);

    // The frozen lane: the shared floor telegraph (actionable, every tier).
    this.lane = kit.lane(17);

    const flat = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.geometries.push(flat);
    const additive = (frag: string, uniforms: Record<string, THREE.IUniform>) => {
      const m = new THREE.ShaderMaterial({
        uniforms,
        vertexShader: FLAT_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      this.materials.push(m);
      return m;
    };
    const fxUniforms = (): FxUniforms => ({
      uTime: this.uTime,
      uFill: { value: 0 },
      uPhase: { value: 0 },
      uFade: { value: 0 },
      uColA: { value: new THREE.Color() },
      uColB: { value: new THREE.Color() },
    });
    this.linkU = fxUniforms();
    this.link = new THREE.Mesh(
      flat,
      additive(LINK_FRAG, this.linkU as unknown as Record<string, THREE.IUniform>),
    );
    this.link.frustumCulled = false;
    this.link.renderOrder = floorVfxRenderOrder('encounter', 3);
    this.link.scale.setScalar(COLLAPSED);
    this.root.add(this.link);
    this.ringU = fxUniforms();
    this.ring = new THREE.Mesh(
      flat,
      additive(RING_FRAG, this.ringU as unknown as Record<string, THREE.IUniform>),
    );
    this.ring.frustumCulled = false;
    this.ring.renderOrder = floorVfxRenderOrder('encounter', 3);
    this.ring.scale.setScalar(COLLAPSED);
    this.root.add(this.ring);

    // The Ice Walls (one standing and one breaking or melting at once).
    const wallGeo = wallGeometry();
    this.geometries.push(wallGeo);
    // The lee strip: local +x runs out from the wall, z along it.
    const leeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0);
    this.geometries.push(leeGeo);
    for (let i = 0; i < WALL_SLOTS; i++) {
      const u = {
        uTime: this.uTime,
        uFade: { value: 0 },
        uFlash: { value: 0 },
        uLee: { value: 0 },
        uHeight: { value: ICE_WALL_HEIGHT },
      };
      // Normal-blended, nearly opaque ice (alpha 0.72 to 1): it WRITES depth
      // on purpose, so the vapour, the shards and the water behind the wall
      // are occluded by it and the shelter reads as solid. It is not an
      // additive layer (those below write no depth).
      const m = new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: SOLID_VERT,
        fragmentShader: WALL_FRAG,
        transparent: true,
        depthWrite: true,
      });
      this.materials.push(m);
      const mesh = new THREE.Mesh(wallGeo, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = 9;
      mesh.scale.setScalar(COLLAPSED);
      this.root.add(mesh);
      const frostAlpha = { value: 0 };
      const frost = new THREE.Mesh(
        flat,
        additive(FROST_FRAG, { uTime: this.uTime, uAlpha: frostAlpha }),
      );
      frost.frustumCulled = false;
      frost.renderOrder = floorVfxRenderOrder('encounter', 2);
      frost.scale.setScalar(COLLAPSED);
      this.root.add(frost);
      const leeAlpha = { value: 0 };
      const lee = new THREE.Mesh(
        leeGeo,
        additive(LEE_FRAG, { uTime: this.uTime, uAlpha: leeAlpha }),
      );
      lee.frustumCulled = false;
      lee.renderOrder = floorVfxRenderOrder('encounter', 2);
      lee.scale.setScalar(COLLAPSED);
      this.root.add(lee);
      this.walls.push({
        mesh,
        u,
        frost,
        frostAlpha,
        lee,
        leeAlpha,
        objectId: -1,
        state: 'idle',
        seenAt: 0,
        age: 0,
        x: 0,
        y: 0,
        z: 0,
        yaw: 0,
        length: ICE_WALL_LENGTH,
        vapourDebt: 0,
      });
    }

    // The current arrows: a flat strip running from the pool along +z.
    const arrowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    this.geometries.push(arrowGeo);
    for (let i = 0; i < ARROW_SLOTS; i++) {
      const alpha = { value: 0 };
      const left = { value: 1 };
      const mesh = new THREE.Mesh(
        arrowGeo,
        additive(ARROW_FRAG, { uTime: this.uTime, uAlpha: alpha, uLeft: left }),
      );
      mesh.frustumCulled = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 4);
      mesh.scale.setScalar(COLLAPSED);
      this.root.add(mesh);
      this.arrows.push({ mesh, alpha, left, objectId: -1, sx: 0, sz: 0, ox: 0, oz: 0 });
    }

    // The Toxic Rime crystals.
    const crystalGeo = crystalGeometry();
    this.geometries.push(crystalGeo);
    for (let i = 0; i < CRYSTAL_SLOTS; i++) {
      const u = {
        uTime: this.uTime,
        uGlow: { value: 0 },
        uPhase: { value: 0 },
        uFlash: { value: 0 },
        uFade: { value: 0 },
        uHeight: { value: CRYSTAL_H },
      };
      // Normal-blended, nearly opaque crystal (alpha 0.82 to 1, fading only
      // in its 0.18 s burst): it writes depth on purpose, like the wall, so
      // its shards occlude each other and the motes behind it.
      const m = new THREE.ShaderMaterial({
        uniforms: u,
        vertexShader: SOLID_VERT,
        fragmentShader: CRYSTAL_FRAG,
        transparent: true,
        depthWrite: true,
      });
      this.materials.push(m);
      const mesh = new THREE.Mesh(crystalGeo, m);
      mesh.frustumCulled = false;
      mesh.renderOrder = 9;
      mesh.scale.setScalar(COLLAPSED);
      this.root.add(mesh);
      this.crystals.push({ mesh, u, objectId: -1, seenAt: 0, burst: -1, x: 0, y: 0, z: 0 });
    }
  }

  private rand(): number {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** The temple root's gate has linked every program: idle, hide the layer. */
  markGated(): void {
    this.gated = true;
  }

  private kick(x: number, z: number, nearR: number, near: number, farR: number, far: number): void {
    if (!this.shake || this.calm()) return;
    const world = this.world;
    const me = world?.entities.get(world.playerId);
    if (!me) return;
    const amount = burstShake(Math.hypot(me.pos.x - x, me.pos.z - z), nearR, near, farR, far);
    if (amount > 0) this.shake(amount);
  }

  /** True when the cue is the Combined Breath's (the renderer skips its
   *  generic draw). */
  handleEvent(ev: SimEvent): boolean {
    if (ev.type !== 'spellfx') return false;
    const ability = ev.ability ?? '';
    if (ability === HYDRA_ICE_WALL_SHATTER) {
      const slot = this.walls.find((w) => w.objectId === ev.targetId && w.state !== 'idle');
      if (slot) this.shatter(slot);
      return true;
    }
    if (ability === HYDRA_RIME_BURST) {
      const slot = this.crystals.find((c) => c.objectId === ev.targetId);
      const obj = this.world?.entities.get(ev.targetId);
      if (slot) this.burstCrystal(slot);
      else if (obj) this.burstAt(obj.pos.x, this.groundY(obj.pos.x, obj.pos.z), obj.pos.z);
      return true;
    }
    if (!COMBO_CASTS.has(ability)) return false;
    // The bar's windup is drawn by the link and the mouths; the landings here.
    if (ev.fx === 'windup') return true;
    const source = this.world?.entities.get(ev.sourceId);
    if (!source) return true;
    if (ability === HYDRA_FROSTLOCKED_TORRENT) this.crackLane(source);
    else if (ability === HYDRA_VENOM_CURRENT) this.splashPools(source, false);
    else if (ability === HYDRA_TOXIC_RIME) this.splashPools(source, true);
    return true;
  }

  /** The torrent freezes in flight: ice cracks white down the whole lane. */
  private crackLane(src: EntityView): void {
    const n = Math.round(150 * this.density);
    const ax = Math.sin(src.facing);
    const az = Math.cos(src.facing);
    const len = HYDRA_COMBO_TUNING.wallStart + ICE_WALL_LENGTH;
    for (let k = 0; k < n; k++) {
      const t = this.rand() * len;
      const x = src.pos.x + ax * t + az * (this.rand() - 0.5) * 3;
      const z = src.pos.z + az * t - ax * (this.rand() - 0.5) * 3;
      const y = this.groundY(x, z);
      const white = this.rand();
      this.glow.emit(this.uTime.value, {
        x,
        y: y + 0.5 + this.rand() * 2.5,
        z,
        vx: (this.rand() - 0.5) * 4,
        vy: 2 + this.rand() * 6,
        vz: (this.rand() - 0.5) * 4,
        ay: -14,
        drag: 0.8,
        life: 0.6 + this.rand() * 0.6,
        size0: 0.5 + this.rand() * 0.6,
        size1: 0.12,
        spin: 5,
        r: 0.65 + 0.35 * white,
        g: 0.9 + 0.1 * white,
        b: 1,
        a: 1,
      });
    }
    const m = Math.round(30 * this.density);
    for (let k = 0; k < m; k++) {
      const t = this.rand() * len;
      const x = src.pos.x + ax * t;
      const z = src.pos.z + az * t;
      this.mist.emit(this.uTime.value, {
        x,
        y: this.groundY(x, z) + 0.6,
        z,
        vx: 0,
        vy: 1 + this.rand(),
        vz: 0,
        drag: 0.6,
        life: 1.4 + this.rand() * 0.6,
        size0: 2.4,
        size1: 5,
        r: 0.82,
        g: 0.94,
        b: 1,
        a: 0.45,
      });
    }
    this.kick(src.pos.x + ax * len * 0.5, src.pos.z + az * len * 0.5, 18, 0.2, 0, 0);
  }

  /** The water head floods the venom (a green surge) or the ice freezes it
   *  (a frost puff), at every pool near the Hydra. */
  private splashPools(src: EntityView, freeze: boolean): void {
    const world = this.world;
    if (!world) return;
    for (const e of world.entities.values()) {
      const t = e.templateId;
      if (
        t !== VENOM_POOL_TEMPLATE &&
        t !== VENOM_CURRENT_TEMPLATE &&
        t !== RIME_CRYSTAL_TEMPLATE &&
        t !== BRINE_SPIT_TEMPLATE
      )
        continue;
      if (Math.hypot(e.pos.x - src.pos.x, e.pos.z - src.pos.z) > 70) continue;
      const y = this.groundY(e.pos.x, e.pos.z);
      const n = Math.round(46 * this.density);
      for (let k = 0; k < n; k++) {
        const a = this.rand() * Math.PI * 2;
        const s = 2 + this.rand() * 5;
        const hot = this.rand();
        this.glow.emit(this.uTime.value, {
          x: e.pos.x + Math.sin(a) * 0.8,
          y: y + 0.3,
          z: e.pos.z + Math.cos(a) * 0.8,
          vx: Math.sin(a) * s,
          vy: 3 + this.rand() * 5,
          vz: Math.cos(a) * s,
          ay: -12,
          drag: 0.9,
          life: 0.7 + this.rand() * 0.5,
          size0: 0.45 + this.rand() * 0.4,
          size1: 0.1,
          r: freeze ? 0.7 + 0.3 * hot : 0.3 + 0.3 * hot,
          g: 0.95,
          b: freeze ? 1 : 0.4 + 0.5 * hot,
          a: 1,
        });
      }
      const m = Math.round(10 * this.density);
      for (let k = 0; k < m; k++)
        this.mist.emit(this.uTime.value, {
          x: e.pos.x + (this.rand() - 0.5) * 3,
          y: y + 0.5,
          z: e.pos.z + (this.rand() - 0.5) * 3,
          vx: 0,
          vy: 1.2,
          vz: 0,
          drag: 0.6,
          life: 1.1 + this.rand() * 0.4,
          size0: 2,
          size1: 4.5,
          r: freeze ? 0.85 : 0.45,
          g: freeze ? 0.95 : 0.85,
          b: freeze ? 1 : 0.45,
          a: 0.35,
        });
    }
  }

  /** The wave breaks on the ice: foam and shards everywhere, a white flash,
   *  and the wall falls apart into the water. */
  private shatter(slot: WallSlot): void {
    slot.state = 'break';
    slot.age = 0;
    slot.u.uFlash.value = this.calm() ? 0.5 : 1;
    const ax = Math.sin(slot.yaw);
    const az = Math.cos(slot.yaw);
    const n = Math.round(320 * this.density);
    for (let k = 0; k < n; k++) {
      const t = (this.rand() - 0.5) * slot.length;
      const a = this.rand() * Math.PI * 2;
      const s = 4 + this.rand() * 11;
      const white = this.rand();
      this.glow.emit(this.uTime.value, {
        x: slot.x + ax * t,
        y: slot.y + 0.4 + this.rand() * ICE_WALL_HEIGHT,
        z: slot.z + az * t,
        vx: Math.sin(a) * s,
        vy: 3 + this.rand() * 10,
        vz: Math.cos(a) * s,
        ay: -20,
        drag: 0.5,
        life: 0.9 + this.rand() * 0.8,
        size0: 0.35 + this.rand() * 1.1,
        size1: 0.15,
        spin: 8,
        r: 0.7 + 0.3 * white,
        g: 0.92 + 0.08 * white,
        b: 1,
        a: 1,
      });
    }
    const f = Math.round(70 * this.density);
    for (let k = 0; k < f; k++) {
      const t = (this.rand() - 0.5) * slot.length;
      const a = this.rand() * Math.PI * 2;
      this.mist.emit(this.uTime.value, {
        x: slot.x + ax * t,
        y: slot.y + 0.4 + this.rand() * 2,
        z: slot.z + az * t,
        vx: Math.sin(a) * 3,
        vy: 2 + this.rand() * 3,
        vz: Math.cos(a) * 3,
        drag: 0.8,
        life: 1.3 + this.rand() * 0.7,
        size0: 2.6,
        size1: 6.5,
        r: 0.95,
        g: 0.98,
        b: 1,
        a: 0.6,
      });
    }
    this.kick(slot.x, slot.z, 20, 0.35, 45, 0.15);
  }

  private burstCrystal(slot: CrystalSlot): void {
    if (slot.burst >= 0) return;
    slot.burst = 0;
    slot.u.uFlash.value = this.calm() ? 0.5 : 1;
    this.burstAt(slot.x, slot.y, slot.z);
  }

  /** A Toxic Rime crystal bursts: a ring of green and white shards out to its
   *  6 yd edge, a breath of toxic mist, a small kick. */
  private burstAt(x: number, y: number, z: number): void {
    const r = HYDRA_COMBO_TUNING.rimeRadius;
    const n = Math.round(150 * this.density);
    for (let k = 0; k < n; k++) {
      const a = this.rand() * Math.PI * 2;
      const s = r * (1.6 + this.rand() * 0.8);
      const white = this.rand() < 0.35;
      this.glow.emit(this.uTime.value, {
        x,
        y: y + 0.4 + this.rand() * 1.2,
        z,
        vx: Math.sin(a) * s,
        vy: 1.5 + this.rand() * 4,
        vz: Math.cos(a) * s,
        ay: -10,
        drag: 1.4,
        life: 0.55 + this.rand() * 0.4,
        size0: 0.4 + this.rand() * 0.6,
        size1: 0.1,
        spin: 9,
        r: white ? 0.95 : 0.45,
        g: 1,
        b: white ? 0.95 : 0.4,
        a: 1,
      });
    }
    const m = Math.round(26 * this.density);
    for (let k = 0; k < m; k++) {
      const a = this.rand() * Math.PI * 2;
      const d = this.rand() * r;
      this.mist.emit(this.uTime.value, {
        x: x + Math.sin(a) * d,
        y: y + 0.6,
        z: z + Math.cos(a) * d,
        vx: Math.sin(a) * 1.5,
        vy: 0.8,
        vz: Math.cos(a) * 1.5,
        drag: 0.7,
        life: 1.2 + this.rand() * 0.5,
        size0: 2.4,
        size1: 5.5,
        r: 0.45,
        g: 0.85,
        b: 0.4,
        a: 0.45,
      });
    }
    this.kick(x, z, 15, 0.18, 0, 0);
  }

  /** The Hydra's heads (nearest claim) and the combo objects on its pool. */
  private rescan(): void {
    const world = this.world;
    if (!world) return;
    const me = world.entities.get(world.playerId);
    this.heads[0] = null;
    this.heads[1] = null;
    this.heads[2] = null;
    this.waveFacing = null;
    for (const e of world.entities.values()) {
      if (e.templateId === TSUNAMI_TEMPLATES.warn) {
        this.waveFacing = e.facing;
        continue;
      }
      if (e.kind === 'mob') {
        const i = HYDRA_HEAD_TEMPLATES.indexOf(e.templateId);
        if (i < 0) continue;
        const prevId = this.heads[i];
        const prev = prevId !== null ? world.entities.get(prevId) : undefined;
        if (
          !prev ||
          (me &&
            Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z) <
              Math.hypot(prev.pos.x - me.pos.x, prev.pos.z - me.pos.z))
        )
          this.heads[i] = e.id;
        continue;
      }
      if (e.templateId === ICE_WALL_TEMPLATE) this.claimWall(e);
      else if (e.templateId === RIME_CRYSTAL_TEMPLATE) this.claimCrystal(e);
      else if (
        e.templateId === VENOM_CURRENT_TEMPLATE ||
        (this.currentBar &&
          (e.templateId === VENOM_POOL_TEMPLATE || e.templateId === BRINE_SPIT_TEMPLATE))
      )
        this.claimArrow(e);
    }
  }

  private claimWall(e: EntityView): void {
    if (this.walls.some((w) => w.objectId === e.id && w.state !== 'idle')) return;
    const slot =
      this.walls.find((w) => w.state === 'idle') ?? this.walls.find((w) => w.state === 'melt');
    if (!slot) return;
    slot.objectId = e.id;
    slot.state = 'live';
    slot.seenAt = this.clock;
    slot.age = 0;
    slot.u.uFlash.value = 0;
    slot.u.uLee.value = 0;
    slot.vapourDebt = 0;
  }

  private claimCrystal(e: EntityView): void {
    if (this.crystals.some((c) => c.objectId === e.id)) return;
    const slot = this.crystals.find((c) => c.objectId < 0);
    if (!slot) return;
    slot.objectId = e.id;
    slot.seenAt = this.clock;
    slot.burst = -1;
    slot.u.uFlash.value = 0;
  }

  private claimArrow(e: EntityView): void {
    if (this.arrows.some((a) => a.objectId === e.id)) return;
    const slot = this.arrows.find((a) => a.objectId < 0);
    if (!slot) return;
    slot.objectId = e.id;
    slot.sx = e.pos.x;
    slot.sz = e.pos.z;
    const o = instanceOrigin(DUNGEONS.drowned_temple.index, instanceSlotForZ(e.pos.z));
    slot.ox = o.x;
    slot.oz = o.z;
  }

  update(dt: number, clock: number): void {
    this.clock = clock;
    this.uTime.value = clock;
    const world = this.world;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.rescan();
    }
    let busy = this.glow.lastDeath > clock || this.mist.lastDeath > clock;
    if (world && this.updateHeads(world, dt)) busy = true;
    for (const w of this.walls) if (this.updateWall(w, dt)) busy = true;
    for (const a of this.arrows) if (this.updateArrow(a, dt)) busy = true;
    for (const c of this.crystals) if (this.updateCrystal(c, dt)) busy = true;
    this.glow.update(clock);
    this.mist.update(clock);
    // Until the gate has linked the layer it stays drawn (collapsed); after,
    // an idle layer is hidden so it costs no draw anywhere in the world.
    this.root.visible = !this.gated || busy;
  }

  /** The combo bar on the heads: the link (or a lone survivor's ring), and
   *  the Frostlocked Torrent's lane. Returns true while anything shows. */
  private updateHeads(world: IWorld, dt: number): boolean {
    let a: EntityView | null = null;
    let b: EntityView | null = null;
    let ai = -1;
    let bi = -1;
    let castId: string | null = null;
    for (let i = 0; i < 3; i++) {
      const id = this.heads[i];
      const h = id !== null ? world.entities.get(id) : undefined;
      this.dead[i] = !h || h.dead;
      if (!h || h.dead || !h.castingAbility || !COMBO_CASTS.has(h.castingAbility)) continue;
      castId = h.castingAbility;
      if (!a) {
        a = h;
        ai = i;
      } else if (!b) {
        b = h;
        bi = i;
      }
    }
    const kind = hydraComboOf(castId);
    this.currentBar = castId === HYDRA_VENOM_CURRENT;
    let linkOn = false;
    let ringOn = false;
    if (a && kind) {
      const fill = comboFill(a.castRemaining, a.castTotal);
      if (b) {
        const ea = comboHeadElementsInto(kind, ai, this.dead, this.elsA)[0];
        const eb = comboHeadElementsInto(kind, bi, this.dead, this.elsB)[0];
        if (ea && eb) {
          linkOn = true;
          this.paintLink(a, b, ea, eb, fill, dt);
        }
      } else {
        const els = comboHeadElementsInto(kind, ai, this.dead, this.elsA);
        if (els.length >= 2) {
          ringOn = true;
          this.paintRing(a, els[0], els[1], fill, dt);
        }
      }
    }
    this.linkFade = linkOn
      ? Math.min(1, this.linkFade + dt * 5)
      : Math.max(0, this.linkFade - dt * 3);
    this.ringFade = ringOn
      ? Math.min(1, this.ringFade + dt * 5)
      : Math.max(0, this.ringFade - dt * 3);
    this.linkU.uFade.value = this.linkFade;
    this.ringU.uFade.value = this.ringFade;
    if (this.linkFade <= 0.01) this.link.scale.setScalar(COLLAPSED);
    if (this.ringFade <= 0.01) this.ring.scale.setScalar(COLLAPSED);
    // The frozen lane, from the water head down its locked facing (looked
    // up only while a Frostlocked Torrent bar runs).
    const wi = castId === HYDRA_FROSTLOCKED_TORRENT ? waterHead(this.dead) : null;
    const wid = wi !== null ? this.heads[wi] : null;
    const water = wid !== null ? world.entities.get(wid) : undefined;
    const laneOn = !!water && !water.dead && water.castingAbility === HYDRA_FROSTLOCKED_TORRENT;
    if (water && laneOn) {
      const lane = frostlockLaneInto(water.pos.x, water.pos.z, water.facing, this.laneNow);
      const y = this.groundY(lane.x, lane.z);
      this.kit.drapeLane(
        this.lane,
        this.groundY,
        lane.x,
        y,
        lane.z,
        lane.yaw,
        lane.length,
        lane.halfWidth,
        LANE_STYLE,
      );
      this.kit.paintLane(this.lane, {
        fill: comboFill(water.castRemaining, water.castTotal),
        clock: this.clock,
        range: lane.length,
      });
      this.lane.group.visible = true;
    } else if (this.laneOn) this.lane.group.visible = false;
    this.laneOn = laneOn;
    return linkOn || ringOn || laneOn || this.linkFade > 0.01 || this.ringFade > 0.01;
  }

  private paintLink(
    a: EntityView,
    b: EntityView,
    ea: HydraElement,
    eb: HydraElement,
    fill: number,
    dt: number,
  ): void {
    const ya = this.groundY(a.pos.x, a.pos.z);
    const yb = this.groundY(b.pos.x, b.pos.z);
    const dx = b.pos.x - a.pos.x;
    const dz = b.pos.z - a.pos.z;
    const len = Math.max(1, Math.hypot(dx, dz));
    this.link.position.set((a.pos.x + b.pos.x) / 2, (ya + yb) / 2 + 0.25, (a.pos.z + b.pos.z) / 2);
    this.link.rotation.y = Math.atan2(-dz, dx);
    this.link.scale.set(len + 3, 1, 2.6 + 1.4 * fill);
    const ca = COMBO_ELEMENT_RGB[ea];
    const cb = COMBO_ELEMENT_RGB[eb];
    this.linkU.uColA.value.setRGB(ca[0], ca[1], ca[2]);
    this.linkU.uColB.value.setRGB(cb[0], cb[1], cb[2]);
    this.linkU.uFill.value = fill;
    this.linkU.uPhase.value = advancePhase(this.linkU.uPhase.value, (4 + 10 * fill) / 6.2832, dt);
    // Sparks running both ways along the link, each in its head's colour.
    this.linkDebt += (20 + 50 * fill) * this.density * dt;
    while (this.linkDebt >= 1) {
      this.linkDebt -= 1;
      const fromA = this.rand() < 0.5;
      const t = this.rand();
      const c = fromA ? ca : cb;
      const sx = fromA ? a.pos.x : b.pos.x;
      const sz = fromA ? a.pos.z : b.pos.z;
      const dir = fromA ? 1 : -1;
      this.glow.emit(this.uTime.value, {
        x: sx + dx * dir * t * 0.3,
        y: (ya + yb) / 2 + 0.4 + this.rand() * 0.6,
        z: sz + dz * dir * t * 0.3,
        vx: (dx / len) * dir * 9,
        vy: 0.6,
        vz: (dz / len) * dir * 9,
        drag: 0.3,
        life: 0.5 + this.rand() * 0.3,
        size0: 0.5,
        size1: 0.15,
        r: c[0],
        g: c[1],
        b: c[2],
        a: 0.9,
      });
    }
  }

  private paintRing(
    h: EntityView,
    ea: HydraElement,
    eb: HydraElement,
    fill: number,
    dt: number,
  ): void {
    const y = this.groundY(h.pos.x, h.pos.z);
    this.ring.position.set(h.pos.x, y + 0.25, h.pos.z);
    const r = 5 + 1.5 * fill;
    this.ring.scale.set(r * 2, 1, r * 2);
    const ca = COMBO_ELEMENT_RGB[ea];
    const cb = COMBO_ELEMENT_RGB[eb];
    this.ringU.uColA.value.setRGB(ca[0], ca[1], ca[2]);
    this.ringU.uColB.value.setRGB(cb[0], cb[1], cb[2]);
    this.ringU.uFill.value = fill;
    // The halves chase round faster as the bar fills (one turn = 2 pi).
    this.ringU.uPhase.value = advancePhase(
      this.ringU.uPhase.value,
      (1.5 + 2.5 * fill) / 6.2832,
      dt,
    );
  }

  /** Returns true while the slot shows anything. */
  private updateWall(w: WallSlot, dt: number): boolean {
    if (w.state === 'idle') return false;
    const obj = w.objectId >= 0 ? this.world?.entities.get(w.objectId) : undefined;
    if (w.state === 'live') {
      if (!obj || obj.templateId !== ICE_WALL_TEMPLATE) {
        // Gone with no shatter cue (yet): it melts unless the cue follows.
        w.state = 'melt';
        w.age = 0;
      } else {
        w.x = obj.pos.x;
        w.z = obj.pos.z;
        w.y = this.groundY(obj.pos.x, obj.pos.z);
        w.yaw = obj.facing;
        w.length = obj.scale > 0 ? obj.scale : ICE_WALL_LENGTH;
      }
    }
    w.age += dt;
    w.u.uFlash.value = Math.max(0, w.u.uFlash.value - dt * 3.5);
    let rise = 1;
    let fade = 1;
    let sink = 0;
    if (w.state === 'live') rise = iceWallRise(this.clock - w.seenAt);
    else if (w.state === 'melt') {
      const k = iceWallMelt(w.age);
      rise = k;
      fade = k;
      sink = (1 - k) * 1.2;
    } else {
      // Breaking: the wall drops apart into the water.
      const k = Math.min(1, w.age / BREAK_SECONDS);
      rise = 1 - 0.55 * k;
      fade = 1 - k * k;
      sink = k * k * 3.5;
    }
    if (fade <= 0.01 && w.state !== 'live') {
      w.state = 'idle';
      w.objectId = -1;
      w.mesh.scale.setScalar(COLLAPSED);
      w.frost.scale.setScalar(COLLAPSED);
      w.lee.scale.setScalar(COLLAPSED);
      w.u.uFade.value = 0;
      w.leeAlpha.value = 0;
      return false;
    }
    w.u.uFade.value = fade;
    w.mesh.position.set(w.x, w.y - sink, w.z);
    w.mesh.rotation.y = w.yaw;
    w.mesh.scale.set(1, Math.max(COLLAPSED, rise), w.length / ICE_WALL_LENGTH);
    w.frost.position.set(w.x, w.y + 0.06, w.z);
    w.frost.rotation.y = w.yaw;
    w.frost.scale.set(ICE_WALL_HALF_THICKNESS * 2 + 4, 1, w.length + 3);
    w.frostAlpha.value = 0.75 * fade * Math.min(1, rise);
    // The lee shimmer while a Tsunami warns (the shelter, read at a glance).
    const target = w.state === 'live' && this.waveFacing !== null ? 1 : 0;
    w.u.uLee.value += (target - w.u.uLee.value) * Math.min(1, dt * 4);
    w.leeAlpha.value = w.u.uLee.value * fade;
    if (w.u.uLee.value > 0.01 && this.waveFacing !== null) {
      const sign = iceWallLeeSign(w.yaw, this.waveFacing);
      w.lee.position.set(w.x, w.y + 0.08, w.z);
      // Local +x is the wall's +normal at rotation yaw; turned half round for
      // a lee on its -normal side.
      w.lee.rotation.y = sign > 0 ? w.yaw : w.yaw + Math.PI;
      w.lee.scale.set(HYDRA_COMBO_TUNING.wallLeeDepth, 1, w.length);
    } else if (w.u.uLee.value <= 0.01) w.lee.scale.setScalar(COLLAPSED);
    if (w.state === 'live') this.vapour(w, dt);
    return true;
  }

  /** Cold vapour rising off the ice (cosmetic: sheds on low). */
  private vapour(w: WallSlot, dt: number): void {
    w.vapourDebt += 9 * this.density * dt;
    const ax = Math.sin(w.yaw);
    const az = Math.cos(w.yaw);
    while (w.vapourDebt >= 1) {
      w.vapourDebt -= 1;
      const t = (this.rand() - 0.5) * w.length;
      const side = (this.rand() - 0.5) * 2;
      this.mist.emit(this.uTime.value, {
        x: w.x + ax * t + az * side,
        y: w.y + 0.3 + this.rand() * ICE_WALL_HEIGHT * 0.8,
        z: w.z + az * t - ax * side,
        vx: (this.rand() - 0.5) * 0.4,
        vy: 0.5 + this.rand() * 0.5,
        vz: (this.rand() - 0.5) * 0.4,
        drag: 0.4,
        life: 2.2 + this.rand(),
        size0: 1.6,
        size1: 3.8,
        r: 0.82,
        g: 0.94,
        b: 1,
        a: 0.22,
      });
      if (this.rand() < 0.4)
        this.glow.emit(this.uTime.value, {
          x: w.x + ax * t,
          y: w.y + this.rand() * ICE_WALL_HEIGHT,
          z: w.z + az * t,
          vx: 0,
          vy: 0.4,
          vz: 0,
          life: 1.2,
          size0: 0.25,
          size1: 0.05,
          spin: 3,
          r: 0.85,
          g: 0.97,
          b: 1,
          a: 0.9,
        });
    }
  }

  private updateArrow(a: ArrowSlot, dt: number): boolean {
    if (a.objectId < 0) return false;
    const obj = this.world?.entities.get(a.objectId);
    const t = obj?.templateId;
    const sliding = t === VENOM_CURRENT_TEMPLATE;
    const showing =
      sliding || (this.currentBar && (t === VENOM_POOL_TEMPLATE || t === BRINE_SPIT_TEMPLATE));
    if (!showing || !obj) {
      a.alpha.value = Math.max(0, a.alpha.value - dt * 3);
      if (a.alpha.value <= 0.01) {
        a.objectId = -1;
        a.mesh.scale.setScalar(COLLAPSED);
        return false;
      }
      return true;
    }
    // The arrow's heading is read off where the pool was first seen (the sim
    // slides it on the heading of its start).
    const arrow = currentArrowInto(a.sx - a.ox, a.sz - a.oz, this.arrowNow);
    const slid = Math.hypot(obj.pos.x - a.sx, obj.pos.z - a.sz);
    a.left.value = sliding ? currentArrowLeft(slid) : 1;
    a.alpha.value = Math.min(1, a.alpha.value + dt * 5);
    a.mesh.position.set(obj.pos.x, this.groundY(obj.pos.x, obj.pos.z) + 0.1, obj.pos.z);
    a.mesh.rotation.y = arrow.yaw;
    a.mesh.scale.set(ARROW_WIDTH, 1, arrow.length);
    if (sliding) this.bubble(obj, dt);
    return true;
  }

  /** A sliding pool bubbles green and leaves a glowing trail. */
  private bubble(obj: EntityView, dt: number): void {
    this.trailDebt += 26 * this.density * dt;
    const y = this.groundY(obj.pos.x, obj.pos.z);
    const r = Math.max(1, obj.scale);
    while (this.trailDebt >= 1) {
      this.trailDebt -= 1;
      const a = this.rand() * Math.PI * 2;
      const d = this.rand() * r;
      const bubble = this.rand() < 0.5;
      this.glow.emit(this.uTime.value, {
        x: obj.pos.x + Math.sin(a) * d,
        y: y + 0.15,
        z: obj.pos.z + Math.cos(a) * d,
        vx: 0,
        vy: bubble ? 1.2 + this.rand() * 1.5 : 0.1,
        vz: 0,
        drag: 0.4,
        life: bubble ? 0.6 + this.rand() * 0.4 : 1.6 + this.rand() * 0.8,
        size0: bubble ? 0.35 : 0.8,
        size1: bubble ? 0.1 : 0.3,
        r: 0.4,
        g: 1,
        b: bubble ? 0.55 : 0.45,
        a: bubble ? 0.9 : 0.55,
      });
    }
  }

  private updateCrystal(c: CrystalSlot, dt: number): boolean {
    if (c.objectId < 0) return false;
    const obj = this.world?.entities.get(c.objectId);
    // Gone without its cue (a reset): it shatters quietly.
    if (c.burst < 0 && (!obj || obj.templateId !== RIME_CRYSTAL_TEMPLATE)) c.burst = 0;
    if (c.burst < 0 && obj) {
      c.x = obj.pos.x;
      c.z = obj.pos.z;
      c.y = this.groundY(obj.pos.x, obj.pos.z);
      const look = rimeLookInto(this.clock - c.seenAt, this.rime, this.calm());
      c.u.uGlow.value = look.glow;
      // The beat's phase runs on the CPU so a quickening pulse never jumps.
      c.u.uPhase.value = advancePhase(c.u.uPhase.value, look.pulse, dt);
      c.u.uFade.value = 1;
      c.mesh.position.set(c.x, c.y - 0.2, c.z);
      c.mesh.scale.setScalar(Math.max(COLLAPSED, look.grow));
      return true;
    }
    c.burst += dt;
    c.u.uFlash.value = Math.max(0, c.u.uFlash.value - dt * 5);
    const k = Math.min(1, c.burst / 0.18);
    c.u.uFade.value = 1 - k;
    c.mesh.scale.setScalar(Math.max(COLLAPSED, 1 + 0.4 * k));
    if (k >= 1) {
      c.objectId = -1;
      c.burst = -1;
      c.mesh.scale.setScalar(COLLAPSED);
      return false;
    }
    return true;
  }

  dispose(): void {
    this.root.removeFromParent();
    this.glow.dispose();
    this.mist.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
