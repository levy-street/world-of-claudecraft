// The Guardian of the Breath's fight on the Storm Cornice (plan:
// breath_fight_fx_core.ts), hosted by ../rift_death_zone.ts beside the
// guardian's own bars (breath_fx.ts: Storm Lance's lane and the exhale's
// Bellows Gust) and its body (breath_body.ts). Read from IWorld only: the wind
// object's template (phase, bearing, length), the fight's objects (their
// radius in `scale`), the players' and the guardian's auras, the guardian's
// bars and the fight's cues, so offline and online look the same.
//
// On EVERY graphics tier (actionable):
//  - the wind's direction: the whole Cornice floor carries chevrons and
//    streaks racing toward the bearing, building with a sweeping edge as a
//    blow gathers, full through the blow, dying in the calm, turned inward
//    to the guardian while it draws breath and as the storm breaks;
//  - the four gaps' lips, burning the lethal red at all times, flaring when
//    the wind blows their way;
//  - through the shared floor telegraph, at each object's exact radius:
//    Thessaly's circle (the calm's mint: filling as it lands, held, its free
//    seats as pips on its rim, dimming when spent), the vortex (danger), the
//    loose gales (control: they throw), the strikes' spots (danger, filling
//    with their warning), the charged ground (danger), the Thunder's Cradle
//    (the soak's gold, filling with its hold), the leaping bolt's reach round
//    its target while its bar runs, the cradle's spot under its target while
//    its bar runs;
//  - on players: the anchored a mint ring at their feet, the pinned an arc at
//    their feet facing the wall, the marked conductor a beacon of lightning
//    over them, the lifted a crown of storm.
// Cosmetic (thinned on the low tier, shakes off under reduced motion): the
// air's streaks and grit, the gaps' updraft and mist, the calm's landing beam
// and dome, the vortex's and the gales' funnels, the bolts' sparks and
// scorches, the swell's motes.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under one root before its gated attach (the telegraph kit's
// slots too); no light; fixed pools; no per-frame allocation.

import * as THREE from 'three';
import { sfx } from '../../game/sfx';
import { BreathAudio } from '../../game/smith_heart_breath_audio';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import {
  BREATH_AURAS,
  BREATH_CASTS,
  BREATH_CUES,
  BREATH_GUARDIAN,
  BREATH_OBJECTS,
  BREATH_THESSALY_NPC,
  BREATH_TUNING,
  type BreathWindPhase,
  breathWindOf,
  calmOf,
  timedOf,
} from '../../sim/encounters/smith_heart/breath_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { type TelegraphFan, TelegraphKit } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { radialGlowTexture } from '../textures';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  ANCHOR_BEAM_SECONDS,
  bearingDir,
  boltFlare,
  breathClaimOrigin,
  breathFightClaims,
  breathObjectKind,
  BREATH_FIGHT_COLORS as C,
  CORNICE_FLOOR_H,
  calmLook,
  calmSeatsLeft,
  chargedFade,
  corniceOutline,
  cradleLook,
  FORK_BEAM_SECONDS,
  FORK_REACH,
  fxHash01,
  GALE_COLUMN,
  gapLips,
  gapThreat,
  BREATH_FIGHT_POOLS as P,
  PINNED_MARK,
  STRIKE_BOLT_SECONDS,
  STRIKE_SCORCH_SECONDS,
  strikeBoltPath,
  strikeFill,
  VORTEX_FUNNEL,
  type WindFieldLook,
  windFieldLook,
} from './breath_fight_fx_core';

const SCAN_SEC = 0.1;
const BEAM_POINTS = 10;
const T = BREATH_TUNING;

// ---- shaders ---------------------------------------------------------------------------

/** The wind over the Cornice floor: chevrons racing toward the bearing (the
 *  readable direction), streaks of wind, the gather's sweeping edge. Local
 *  instance coords in vLocal (x, z). */
const FIELD_VERT = /* glsl */ `
varying vec2 vLocal;
void main() {
  vLocal = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const FIELD_FRAG = /* glsl */ `
uniform float uTime;
uniform vec2 uDir;
uniform vec2 uFocus;
uniform vec2 uCentre;
uniform float uInward;
uniform float uStrength;
uniform float uChevron;
uniform float uFlowT;
uniform float uFront;
uniform float uDetail;
uniform float uStorm;
uniform vec3 uColor;
uniform vec3 uEdge;
uniform vec3 uStreak;
varying vec2 vLocal;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  vec2 side = vec2(uDir.y, -uDir.x);
  float along = dot(vLocal - uCentre, uDir);
  float across = dot(vLocal - uCentre, side);
  if (uInward > 0.5) {
    // Drawn in: the arrows run down every radius to the guardian's mouth
    // (along grows toward it; across is the arc round it).
    vec2 off = vLocal - uFocus;
    float r = length(off);
    along = -r;
    across = atan(off.y, off.x) * 28.0;
  }
  // Chevrons: rows of arrows pointing downwind, flowing with it.
  float a = along - uFlowT;
  vec2 cell = vec2(fract(a / 9.0), fract(across / 7.0) - 0.5);
  float row = floor(a / 9.0);
  float col = floor(across / 7.0);
  float jig = (h(vec2(row, col)) - 0.5) * 0.18;
  float tip = 0.62 - abs(cell.y) * 0.95 + jig;
  float dist = abs(cell.x - tip);
  float body = (1.0 - smoothstep(0.03, 0.07, dist)) * (1.0 - smoothstep(0.32, 0.4, abs(cell.y)));
  float rim = (1.0 - smoothstep(0.07, 0.1, dist)) * (1.0 - smoothstep(0.34, 0.44, abs(cell.y)));
  // Streaks: wisps stretched along the wind.
  float s1 = n(vec2(a * 0.09, across * 0.9));
  float s2 = n(vec2(a * 0.2 + 7.0, across * 2.3));
  float streak = smoothstep(0.62, 0.9, s1 * 0.65 + s2 * 0.35) * (0.55 + 0.45 * uDetail);
  // The gather's leading edge, sweeping across the plateau toward the bearing.
  float frontPos = mix(-55.0, 55.0, uFront);
  float front = uFront < 0.0 ? 0.0 : exp(-pow((along - frontPos) / 4.5, 2.0)) * 0.8;
  float behind = uFront < 0.0 ? 1.0 : smoothstep(frontPos + 6.0, frontPos - 6.0, along);
  float chev = uChevron * mix(0.35, 1.0, behind);
  vec3 col3 = mix(uColor, uEdge, rim * (1.0 - body) * 0.9);
  float alpha = max(body * 0.62, rim * 0.42) * chev;
  vec3 outc = col3 * alpha + uStreak * streak * uStrength * 0.55 + uEdge * front;
  float outa = clamp(alpha + streak * uStrength * 0.38 + front * 0.6, 0.0, 0.92);
  // The swelling storm: a flicker of lightning light over the floor.
  float flash = uStorm * step(0.985, h(vec2(floor(uTime * 9.0), 3.1))) * 0.35;
  outc += uEdge * flash;
  outa = clamp(outa + flash * 0.3, 0.0, 0.92);
  gl_FragColor = vec4(outc / max(outa, 0.001), outa);
  #include <colorspace_fragment>
}
`;
/** A gap's lethal lip: a curtain of red light standing on the open edge, an
 *  updraft of streaks rising through it. vUv.x along, vUv.y up (0 at the
 *  lip); aThreat per gap via uThreat[gap]. */
const LIP_VERT = /* glsl */ `
attribute float aGap;
varying vec2 vUv;
varying float vGap;
void main() {
  vUv = uv;
  vGap = aGap;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const LIP_FRAG = /* glsl */ `
uniform float uTime;
uniform vec4 uThreat;
uniform vec3 uColor;
uniform vec3 uGlow;
uniform float uFloor;
varying vec2 vUv;
varying float vGap;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float g = vGap < 0.5 ? uThreat.x : vGap < 1.5 ? uThreat.y : vGap < 2.5 ? uThreat.z : uThreat.w;
  float pulse = 0.75 + 0.25 * sin(uTime * (3.0 + g * 5.0));
  float k;
  if (uFloor > 0.5) {
    // The floor band: brightest on the lip, fading inward.
    k = (1.0 - smoothstep(0.0, 1.0, vUv.y)) * (0.55 + 0.45 * pulse);
  } else {
    float rise = n(vec2(vUv.x * 5.0, vUv.y * 3.0 - uTime * (1.4 + g * 2.0)));
    k = (1.0 - smoothstep(0.05, 1.0, vUv.y)) * (0.45 + 0.55 * rise) * pulse;
  }
  vec3 col = mix(uColor, uGlow, g * 0.6 + 0.2);
  float a = clamp(k * (0.6 + 0.4 * g), 0.0, 1.0);
  gl_FragColor = vec4(col * (1.0 + g), a);
  #include <colorspace_fragment>
}
`;
/** A funnel of wind (the vortex, a loose gale): streaks spiralling up. */
const FUNNEL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const FUNNEL_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
uniform float uSpin;
uniform vec3 uWind;
uniform vec3 uShade;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float sp = vUv.x * 6.0 + vUv.y * 3.0 - uTime * uSpin;
  float bands = n(vec2(sp * 3.0, vUv.y * 4.0)) * 0.6 + n(vec2(sp * 7.0, vUv.y * 9.0)) * 0.4;
  float fade = smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.7, 1.0, vUv.y));
  float a = uAlpha * fade * smoothstep(0.38, 0.82, bands);
  gl_FragColor = vec4(mix(uShade, uWind, 0.3 + bands * 0.7), a);
  #include <colorspace_fragment>
}
`;
/** A beam of light (the calm landing, the conductor's beacon): bright core,
 *  soft falling bands. */
const BEAM_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float bands = 0.7 + 0.3 * sin(vUv.y * 22.0 + uTime * 9.0);
  float edge = 1.0 - abs(vUv.x * 2.0 - 1.0);
  float a = uAlpha * bands * (1.0 - smoothstep(0.7, 1.0, vUv.y)) * (0.6 + 0.4 * edge);
  gl_FragColor = vec4(uColor * (1.2 + bands * 0.5), a);
  #include <colorspace_fragment>
}
`;
/** The calm's dome: a fresnel shell of mint light over the circle. */
const DOME_VERT = /* glsl */ `
varying vec3 vN;
varying vec3 vV;
varying float vY;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vN = normalize(mat3(modelMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  vY = position.y;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const DOME_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
uniform vec3 uColor;
varying vec3 vN;
varying vec3 vV;
varying float vY;
void main() {
  float fres = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.6);
  float ripple = 0.8 + 0.2 * sin(vY * 9.0 - uTime * 2.5);
  gl_FragColor = vec4(uColor, uAlpha * (0.05 + fres * 0.7) * ripple);
  #include <colorspace_fragment>
}
`;
/** A bolt or a beam: crossed ribbons, a bright core, a soft edge. */
const BOLT_VERT = /* glsl */ `
attribute float aEdge;
varying float vEdge;
void main() {
  vEdge = aEdge;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const BOLT_FRAG = /* glsl */ `
uniform float uAlpha;
uniform vec3 uCore;
uniform vec3 uEdge;
varying float vEdge;
void main() {
  float e = abs(vEdge);
  float core = 1.0 - smoothstep(0.0, 0.35, e);
  float glow = 1.0 - smoothstep(0.2, 1.0, e);
  gl_FragColor = vec4(mix(uEdge, uCore, core) * (0.8 + core * 1.6) * uAlpha, glow * uAlpha);
  #include <colorspace_fragment>
}
`;
const SCORCH_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const SCORCH_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uHeat;
uniform vec3 uDark;
uniform vec3 uGlow;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  float ang = atan(p.y, p.x);
  float rays = 0.6 + 0.4 * h(vec2(floor(ang * 6.0), 1.7));
  float body = 1.0 - smoothstep(0.35 * rays, 1.0 * rays, r);
  float core = 1.0 - smoothstep(0.0, 0.3, r);
  vec3 col = mix(uDark, uGlow * uHeat, core * clamp(uHeat, 0.0, 1.0));
  gl_FragColor = vec4(col, uAlpha * body * 0.85);
  #include <colorspace_fragment>
}
`;

// ---- pooled slots ----------------------------------------------------------------------

interface FanSlot {
  fan: TelegraphFan;
  id: number;
  born: number;
  /** The object's template when first seen (a new template restarts it). */
  template: string;
}

interface Funnel {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
}

interface BoltSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  seconds: number;
  live: boolean;
}

interface BeamSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  geo: THREE.BufferGeometry;
  born: number;
  seconds: number;
  live: boolean;
}

interface ScorchSlot {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  live: boolean;
}

/** One player wearing one of the fight's marks this scan. */
interface PlayerMark {
  id: number;
  fan: TelegraphFan;
  live: boolean;
}

/** A per-player mark pool: ids to their fans, kept stable across scans. */
class MarkPool {
  readonly marks: PlayerMark[] = [];
  constructor(fans: TelegraphFan[]) {
    for (const fan of fans) this.marks.push({ id: -1, fan, live: false });
  }
  begin(): void {
    for (const m of this.marks) m.live = false;
  }
  take(id: number): PlayerMark | null {
    let free: PlayerMark | null = null;
    for (const m of this.marks) {
      if (m.id === id) {
        m.live = true;
        return m;
      }
      if (!free && m.id < 0) free = m;
    }
    if (!free) return null;
    free.id = id;
    free.live = true;
    free.fan.group.visible = true;
    return free;
  }
  end(): void {
    for (const m of this.marks)
      if (!m.live && m.id >= 0) {
        m.id = -1;
        m.fan.group.visible = false;
      }
  }
}

/** The first idle one of a pool, else (all live) its oldest slot. */
function firstIdle<T extends { live: boolean }>(pool: readonly T[]): T {
  for (let i = 0; i < pool.length; i++) if (!pool[i].live) return pool[i];
  return pool[0];
}

function boltRibbon(pts: readonly THREE.Vector3[], width: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const edge: number[] = [];
  const idx: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  const side = new THREE.Vector3();
  const d = new THREE.Vector3();
  for (let pass = 0; pass < 2; pass++) {
    const base = pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      d.copy(pts[Math.min(pts.length - 1, i + 1)])
        .sub(pts[Math.max(0, i - 1)])
        .normalize();
      if (Math.abs(d.y) > 0.95) side.set(pass === 0 ? 1 : 0, 0, pass === 0 ? 0 : 1);
      else if (pass === 0) side.crossVectors(d, up).normalize();
      else side.crossVectors(d, up).normalize().cross(d).normalize();
      const w = width * (i === pts.length - 1 ? 0.4 : 1);
      for (const s of [-1, 1]) {
        pos.push(pts[i].x + side.x * w * s, pts[i].y + side.y * w * s, pts[i].z + side.z * w * s);
        edge.push(s);
      }
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + i * 2;
      idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aEdge', new THREE.Float32BufferAttribute(edge, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

export class BreathFightFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  /** Everything laid in instance-local coordinates, at the claim's origin. */
  private readonly local = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly detail: boolean;
  private readonly density: number;
  private readonly particles: EngineParticles;
  private readonly kit: TelegraphKit;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly audio = new BreathAudio(sfx);
  private readonly glowTex: THREE.Texture | null;
  // The wind's field and the gaps' lips (instance-local, under `local`).
  private readonly field: THREE.Mesh;
  private readonly fieldMat: THREE.ShaderMaterial;
  private readonly lipMat: THREE.ShaderMaterial;
  private readonly lipFloorMat: THREE.ShaderMaterial;
  private readonly lips = gapLips();
  private readonly windLook: WindFieldLook = {
    strength: 0,
    chevron: 0,
    speed: 0,
    front: -1,
    inward: false,
  };
  private flowAt = 0;
  // The objects' footprints.
  private readonly calmFans: FanSlot[] = [];
  private readonly vortexFans: FanSlot[] = [];
  private readonly galeFans: FanSlot[] = [];
  private readonly strikeFans: FanSlot[] = [];
  private readonly chargedFans: FanSlot[] = [];
  private readonly cradleFans: FanSlot[] = [];
  private readonly barFans: FanSlot[] = [];
  /** The object footprint pools, in one list (built once, walked by assign). */
  private readonly footprintPools: readonly FanSlot[][] = [
    this.calmFans,
    this.vortexFans,
    this.galeFans,
    this.strikeFans,
    this.chargedFans,
    this.cradleFans,
  ];
  // The players' marks.
  private readonly anchorMarks: MarkPool;
  private readonly pinnedMarks: MarkPool;
  private readonly drawnMarks: MarkPool;
  // Cosmetic and every-tier extras.
  private readonly vortexFunnel: Funnel;
  private readonly galeFunnels: Funnel[] = [];
  private readonly calmBeams: Funnel[] = [];
  private readonly calmDomes: Funnel[] = [];
  private readonly seatPips: THREE.Sprite[] = [];
  private readonly seatMat: THREE.SpriteMaterial;
  private readonly seatSpentMat: THREE.SpriteMaterial;
  private readonly beacons: Funnel[] = [];
  private readonly beaconGlows: THREE.Sprite[] = [];
  private readonly crown: THREE.Group = new THREE.Group();
  private readonly crownMat: THREE.SpriteMaterial;
  private readonly crownSparks: THREE.Sprite[] = [];
  private readonly bolts: BoltSlot[] = [];
  private readonly beams: BeamSlot[] = [];
  private readonly scorches: ScorchSlot[] = [];
  // The scan's findings (ids, reused arrays).
  private guardianId = -1;
  private thessalyId = -1;
  private windId = -1;
  private windTemplate = '';
  private windSince = 0;
  private windPhase: BreathWindPhase | null = null;
  private windBearing = 0;
  private windFill = 0;
  private readonly objectIds: number[] = [];
  /** Every entity the roster walk found the fight could draw (re-read on
   *  the scan's clock; re-walked on a roster change only). */
  private readonly candidateIds: number[] = [];
  /** The roster version the last walk saw (NaN: walk on the next scan). */
  private rosterSeen = Number.NaN;
  /** The wind's bearing as a direction (rewritten in place each frame). */
  private readonly windDir = { x: 0, z: 1 };
  /** The audio's entity and ground reads, bound once (not per event). */
  private readonly lookup = (id: number): Entity | undefined => this.world?.entities.get(id);
  private readonly groundAt = (x: number, z: number): number => this.groundY(x, z);
  private readonly cradledIds: number[] = [];
  private origin: { x: number; z: number } | null = null;
  private floorY = 0;
  private swell = 0;
  private scanTimer = 0;
  private clock = 0;
  private seed = 0x51b7;
  private disposed = false;
  private readonly v = new THREE.Vector3();
  private readonly v2 = new THREE.Vector3();

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
  ) {
    this.root.name = 'smith-heart-breath-fight-fx';
    setRenderCategory(this.root, 'ui3d');
    this.detail =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    this.density = this.detail ? 1 : 0.4;
    const hasDom = typeof document !== 'undefined';
    this.particles = new EngineParticles(
      this.root,
      this.uTime,
      this.density,
      (x, z) => this.groundY(x, z),
      () => this.rand(),
      () => this.reducedMotion(),
      hasDom ? getFlameTex() : null,
    );
    this.glowTex = hasDom ? radialGlowTexture() : null;
    this.kit = new TelegraphKit(this.root, this.detail);
    this.local.name = 'smithHeartBreathLocal';
    this.local.visible = false;
    this.root.add(this.local);

    // ---- the wind's field over the Cornice floor (every tier) ----
    const outline = corniceOutline();
    const contour = outline.map(([x, z]) => new THREE.Vector2(x, z));
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const fieldGeo = new THREE.BufferGeometry();
    const fp = new Float32Array(outline.length * 3);
    outline.forEach(([x, z], i) => {
      fp.set([x, 0, z], i * 3);
    });
    fieldGeo.setAttribute('position', new THREE.BufferAttribute(fp, 3));
    fieldGeo.setIndex(tris.flat());
    fieldGeo.computeBoundingSphere();
    this.geometries.push(fieldGeo);
    this.fieldMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathWindField',
      uniforms: {
        uTime: this.uTime,
        uDir: { value: new THREE.Vector2(0, 1) },
        uFocus: { value: new THREE.Vector2(0, 196) },
        uCentre: { value: new THREE.Vector2(0, 196) },
        uInward: { value: 0 },
        uStrength: { value: 0 },
        uChevron: { value: 0 },
        uFlowT: { value: 0 },
        uFront: { value: -1 },
        uDetail: { value: this.detail ? 1 : 0 },
        uStorm: { value: 0 },
        uColor: { value: new THREE.Color(C.chevron) },
        uEdge: { value: new THREE.Color(C.chevronEdge) },
        uStreak: { value: new THREE.Color(C.streak) },
      },
      vertexShader: FIELD_VERT,
      fragmentShader: FIELD_FRAG,
      transparent: true,
      depthWrite: false,
      // The outline's triangulation winds either way: draw both faces.
      side: THREE.DoubleSide,
    });
    this.materials.push(this.fieldMat);
    this.field = new THREE.Mesh(fieldGeo, this.fieldMat);
    this.field.name = 'smithHeartBreathWindField';
    this.field.position.y = CORNICE_FLOOR_H + 0.08;
    this.field.frustumCulled = false;
    this.field.renderOrder = floorVfxRenderOrder('encounter', 2);
    this.local.add(this.field);

    // ---- the gaps' lethal lips (every tier) ----
    const lipUniforms = (floor: number) => ({
      uTime: this.uTime,
      uThreat: { value: new THREE.Vector4() },
      uColor: { value: new THREE.Color(C.lip) },
      uGlow: { value: new THREE.Color(C.lipGlow) },
      uFloor: { value: floor },
    });
    this.lipMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathGapLip',
      uniforms: lipUniforms(0),
      vertexShader: LIP_VERT,
      fragmentShader: LIP_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.lipFloorMat = new THREE.ShaderMaterial({
      name: 'smithHeartBreathGapLipFloor',
      uniforms: lipUniforms(1),
      vertexShader: LIP_VERT,
      fragmentShader: LIP_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    });
    this.materials.push(this.lipMat, this.lipFloorMat);
    const { curtain, floor } = this.lipGeometries();
    const lipCurtain = new THREE.Mesh(curtain, this.lipMat);
    const lipFloor = new THREE.Mesh(floor, this.lipFloorMat);
    lipCurtain.name = 'smithHeartBreathGapLip';
    lipFloor.name = 'smithHeartBreathGapLipFloor';
    lipFloor.renderOrder = floorVfxRenderOrder('encounter', 4);
    for (const m of [lipCurtain, lipFloor]) {
      m.frustumCulled = false;
      this.local.add(m);
    }

    // ---- the footprints (every tier) ----
    const fans = (n: number, order: number, out: FanSlot[]) => {
      for (let i = 0; i < n; i++) {
        const fan = this.kit.fan(order);
        fan.group.visible = false;
        out.push({ fan, id: -1, born: 0, template: '' });
      }
    };
    fans(P.calm, 6, this.calmFans);
    fans(P.vortex, 10, this.vortexFans);
    fans(P.gales, 10, this.galeFans);
    fans(P.strikes, 12, this.strikeFans);
    fans(P.charged, 8, this.chargedFans);
    fans(P.cradles, 9, this.cradleFans);
    fans(1, 11, this.barFans);
    for (const s of this.calmFans) this.layOut(s, 360, C.calm, C.calmEdge);
    for (const s of this.vortexFans) this.layOut(s, 360, C.danger, C.accent);
    for (const s of this.galeFans) this.layOut(s, 360, C.control, C.accent);
    for (const s of this.strikeFans) this.layOut(s, 360, C.danger, C.accent);
    for (const s of this.chargedFans) this.layOut(s, 360, C.danger, C.accent);
    for (const s of this.cradleFans) this.layOut(s, 360, C.soak, C.accent);
    const markFans = (n: number, arc: number, color: number) => {
      const out: TelegraphFan[] = [];
      for (let i = 0; i < n; i++) {
        const f = this.kit.fan(13);
        this.kit.layOutFan(f, arc, { color, accent: C.accent });
        f.group.visible = false;
        out.push(f);
      }
      return out;
    };
    this.anchorMarks = new MarkPool(markFans(6, 360, C.calm));
    this.pinnedMarks = new MarkPool(markFans(10, PINNED_MARK.arcDeg, C.danger));
    this.drawnMarks = new MarkPool(markFans(2, 360, C.lethal));

    // ---- funnels, beams, domes ----
    const funnelMat = (name: string, spin: number) =>
      new THREE.ShaderMaterial({
        name,
        uniforms: {
          uAlpha: { value: 0 },
          uTime: this.uTime,
          uSpin: { value: spin },
          uWind: { value: new THREE.Color(...C.wind) },
          uShade: { value: new THREE.Color(0.5, 0.58, 0.66) },
        },
        vertexShader: FUNNEL_VERT,
        fragmentShader: FUNNEL_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
    const funnelGeo = new THREE.CylinderGeometry(1, 1, 1, 40, 6, true).translate(0, 0.5, 0);
    // Wider at the top: the column's mouth opening to the sky.
    {
      const p = funnelGeo.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p.count; i++) {
        const y = p.getY(i);
        const k = 0.45 + y * (GALE_COLUMN.topScale - 0.45);
        p.setXYZ(i, p.getX(i) * k, y, p.getZ(i) * k);
      }
    }
    this.geometries.push(funnelGeo);
    const funnel = (name: string, spin: number): Funnel => {
      const mat = funnelMat(name, spin);
      this.materials.push(mat);
      const mesh = new THREE.Mesh(funnelGeo, mat);
      mesh.name = name;
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      return { mesh, mat };
    };
    this.vortexFunnel = funnel('smithHeartBreathVortex', VORTEX_FUNNEL.spin);
    for (let i = 0; i < P.gales; i++)
      this.galeFunnels.push(funnel('smithHeartBreathGale', GALE_COLUMN.spin));
    const beamGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 18, 1, true).translate(0, 0.5, 0);
    const domeGeo = new THREE.SphereGeometry(1, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    this.geometries.push(beamGeo, domeGeo);
    const beamMat = (name: string, color: number) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: {
          uAlpha: { value: 0 },
          uTime: this.uTime,
          uColor: { value: new THREE.Color(color) },
        },
        vertexShader: FUNNEL_VERT,
        fragmentShader: BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(m);
      return m;
    };
    for (let i = 0; i < P.calm; i++) {
      const bm = beamMat('smithHeartBreathCalmBeam', C.calm);
      const beam = new THREE.Mesh(beamGeo, bm);
      const dm = new THREE.ShaderMaterial({
        name: 'smithHeartBreathCalmDome',
        uniforms: {
          uAlpha: { value: 0 },
          uTime: this.uTime,
          uColor: { value: new THREE.Color(C.calm) },
        },
        vertexShader: DOME_VERT,
        fragmentShader: DOME_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(dm);
      const dome = new THREE.Mesh(domeGeo, dm);
      beam.name = 'smithHeartBreathCalmBeam';
      dome.name = 'smithHeartBreathCalmDome';
      for (const m of [beam, dome]) {
        m.visible = false;
        m.frustumCulled = false;
        this.root.add(m);
      }
      this.calmBeams.push({ mesh: beam, mat: bm });
      this.calmDomes.push({ mesh: dome, mat: dm });
    }
    const sprite = (color: number, opacity: number, name: string) => {
      const m = new THREE.SpriteMaterial({
        map: this.glowTex,
        color,
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        name,
      });
      this.materials.push(m);
      return m;
    };
    this.seatMat = sprite(C.calmEdge, 0.95, 'smithHeartBreathSeat');
    this.seatSpentMat = sprite(0x2a5a4a, 0.5, 'smithHeartBreathSeatSpent');
    for (let i = 0; i < P.seats * P.calm; i++) {
      const s = new THREE.Sprite(this.seatMat);
      s.scale.set(0.9, 0.9, 1);
      s.visible = false;
      s.name = 'smithHeartBreathSeat';
      this.root.add(s);
      this.seatPips.push(s);
    }
    const spentCarrier = new THREE.Sprite(this.seatSpentMat);
    spentCarrier.visible = false;
    this.root.add(spentCarrier);
    for (let i = 0; i < P.beacons; i++) {
      const bm = beamMat('smithHeartBreathBeacon', C.accent);
      const mesh = new THREE.Mesh(beamGeo, bm);
      mesh.name = 'smithHeartBreathBeacon';
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.beacons.push({ mesh, mat: bm });
      const glow = new THREE.Sprite(sprite(0xe6faff, 0.9, 'smithHeartBreathBeaconGlow'));
      glow.scale.set(2.6, 2.6, 1);
      glow.visible = false;
      this.root.add(glow);
      this.beaconGlows.push(glow);
    }
    // The Thunder's Cradle's crown over the lifted player.
    this.crownMat = sprite(0xe6faff, 0.9, 'smithHeartBreathCrown');
    this.crown.name = 'smithHeartBreathCrown';
    this.crown.visible = false;
    const core = new THREE.Sprite(this.crownMat);
    core.scale.set(3.4, 3.4, 1);
    this.crown.add(core);
    for (let i = 0; i < 8; i++) {
      const s = new THREE.Sprite(this.crownMat);
      s.scale.set(0.8, 0.8, 1);
      this.crown.add(s);
      this.crownSparks.push(s);
    }
    this.root.add(this.crown);

    // ---- the bolts from the cloud, the beams between players, scorches ----
    const boltMat = (name: string) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: {
          uAlpha: { value: 0 },
          uCore: { value: new THREE.Color(...C.boltCore) },
          uEdge: { value: new THREE.Color(...C.boltEdge) },
        },
        vertexShader: BOLT_VERT,
        fragmentShader: BOLT_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(m);
      return m;
    };
    for (let b = 0; b < P.bolts; b++) {
      const pts = strikeBoltPath(0x91 + b * 23, 42, 2.2).map(
        (p) => new THREE.Vector3(p.x, p.y, p.z),
      );
      const geo = boltRibbon(pts, 0.55);
      this.geometries.push(geo);
      const mat = boltMat('smithHeartBreathStrikeBolt');
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.bolts.push({ mesh, mat, born: -99, seconds: STRIKE_BOLT_SECONDS, live: false });
    }
    for (let b = 0; b < P.beams; b++) {
      const geo = boltRibbon(
        Array.from({ length: BEAM_POINTS }, (_, i) => new THREE.Vector3(0, 0, i)),
        0.22,
      );
      (geo.getAttribute('position') as THREE.BufferAttribute).setUsage(THREE.DynamicDrawUsage);
      this.geometries.push(geo);
      const mat = boltMat('smithHeartBreathBeam');
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.beams.push({ mesh, mat, geo, born: -99, seconds: FORK_BEAM_SECONDS, live: false });
    }
    const scorchGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.geometries.push(scorchGeo);
    for (let i = 0; i < P.scorches; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'smithHeartBreathScorch',
        uniforms: {
          uAlpha: { value: 0 },
          uHeat: { value: 0 },
          uDark: { value: new THREE.Color(...C.scorch) },
          uGlow: { value: new THREE.Color(...C.boltEdge) },
        },
        vertexShader: SCORCH_VERT,
        fragmentShader: SCORCH_FRAG,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(scorchGeo, mat);
      mesh.renderOrder = floorVfxRenderOrder('encounter', 16);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.scorches.push({ mesh, mat, born: -99, live: false });
    }
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  /** The lips' curtain and floor band (instance-local), one gap index per
   *  vertex. */
  private lipGeometries(): { curtain: THREE.BufferGeometry; floor: THREE.BufferGeometry } {
    const cp: number[] = [];
    const cu: number[] = [];
    const cg: number[] = [];
    const ci: number[] = [];
    const fp: number[] = [];
    const fu: number[] = [];
    const fg: number[] = [];
    const fi: number[] = [];
    const H = CORNICE_FLOOR_H;
    this.lips.forEach((lip, gap) => {
      let along = 0;
      for (const s of lip.segments) {
        const len = Math.hypot(s.bx - s.ax, s.bz - s.az);
        // The curtain: standing on the lip, a hand out over the drop.
        const ox = s.nx * 0.15;
        const oz = s.nz * 0.15;
        const b = cp.length / 3;
        cp.push(
          s.ax + ox,
          H - 0.6,
          s.az + oz,
          s.bx + ox,
          H - 0.6,
          s.bz + oz,
          s.ax + ox,
          H + 2.2,
          s.az + oz,
          s.bx + ox,
          H + 2.2,
          s.bz + oz,
        );
        cu.push(along / 4, 0, (along + len) / 4, 0, along / 4, 1, (along + len) / 4, 1);
        cg.push(gap, gap, gap, gap);
        ci.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
        // The floor band: from the lip inward a yard and a half.
        const ix = -s.nx * 1.6;
        const iz = -s.nz * 1.6;
        const f = fp.length / 3;
        fp.push(s.ax, H, s.az, s.bx, H, s.bz, s.ax + ix, H, s.az + iz, s.bx + ix, H, s.bz + iz);
        fu.push(0, 0, 1, 0, 0, 1, 1, 1);
        fg.push(gap, gap, gap, gap);
        fi.push(f, f + 1, f + 2, f + 1, f + 3, f + 2);
        along += len;
      }
    });
    const build = (p: number[], u: number[], g: number[], i: number[]) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(u, 2));
      geo.setAttribute('aGap', new THREE.Float32BufferAttribute(g, 1));
      geo.setIndex(i);
      geo.computeBoundingSphere();
      this.geometries.push(geo);
      return geo;
    };
    return { curtain: build(cp, cu, cg, ci), floor: build(fp, fu, fg, fi) };
  }

  private layOut(s: FanSlot, arc: number, color: number, accent: number): void {
    this.kit.layOutFan(s.fan, arc, { color, accent });
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  private shakeNear(x: number, z: number, amount: number, reach = 50): void {
    if (!this.shakeSink || !this.world || this.reducedMotion()) return;
    const me = this.world.entities.get(this.world.playerId);
    if (!me) return;
    const d = Math.hypot(me.pos.x - x, me.pos.z - z);
    if (d < reach) this.shakeSink(amount * (1 - (d / reach) * 0.7));
  }

  // ---- events ---------------------------------------------------------------------------

  /** Claims the fight's own cues (the renderer's generic draw is skipped). */
  handleEvent(ev: SimEvent): boolean {
    if (!this.world || this.disposed) return false;
    const world = this.world;
    this.audio.event(ev, this.lookup, this.groundAt);
    if (ev.type === 'spellfxAt') {
      if (!breathFightClaims(ev.ability)) return false;
      const r = ev.radius ?? 3;
      if (ev.ability === BREATH_CUES.strike) this.strike(ev.x, ev.z, r, 1);
      else if (ev.ability === BREATH_CUES.discharge) this.strike(ev.x, ev.z, r, 2.2);
      else if (ev.ability === BREATH_CUES.calmLand) this.calmLand(ev.x, ev.z, r);
      else if (ev.ability === BREATH_CUES.fall) this.fall(ev.x, ev.z);
      return true;
    }
    if (ev.type !== 'spellfx' || !breathFightClaims(ev.ability)) return false;
    const src = world.entities.get(ev.sourceId);
    const dst = world.entities.get(ev.targetId);
    if (ev.ability === BREATH_CUES.fork && dst) {
      this.beam(
        src ?? dst,
        dst,
        FORK_BEAM_SECONDS,
        src && src.templateId === BREATH_GUARDIAN ? 4.5 : 1.3,
      );
      this.sparksAt(dst.pos.x, dst.pos.y + 1.2, dst.pos.z, 10);
    } else if (ev.ability === BREATH_CUES.anchor && src && dst) {
      this.beam(src, dst, ANCHOR_BEAM_SECONDS, 1.4, C.calm);
    } else if (ev.ability === BREATH_CUES.toss && dst) {
      this.particles.puff(dst.pos.x, dst.pos.y + 0.6, dst.pos.z, Math.round(16 * this.density), {
        speed: 9,
        up: 4,
        life: 0.8,
        size: [0.5, 1.6],
        color: C.grit,
        alpha: 0.6,
        drag: 1.2,
        radius: 0.8,
      });
      this.particles.shockRing(dst.pos.x, dst.pos.z, C.control, 3.5, 0.45);
    } else if (ev.ability === BREATH_CUES.swell && src) {
      // The storm swells: a ring rolling over the whole Cornice.
      this.particles.shockRing(src.pos.x, src.pos.z, 0xbfefff, 46, 1.6);
      this.particles.shockRing(src.pos.x, src.pos.z, 0x47b8ff, 30, 1.1);
      this.sparksAt(src.pos.x, src.pos.y + 6, src.pos.z, 14);
    } else if (ev.ability === BREATH_CUES.tear && src) {
      // The storm tears open (the body flies apart: breath_body.ts): the
      // floor takes the flash, a ring races to the rim.
      this.particles.shockRing(src.pos.x, src.pos.z, 0xe6faff, 55, 1.4);
      this.shakeNear(src.pos.x, src.pos.z, 0.6, 80);
    }
    return true;
  }

  // ---- the frame ------------------------------------------------------------------------

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.clock += dt;
    this.uTime.value = this.clock;
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = SCAN_SEC;
      this.scan(world);
    }
    if (!this.origin) {
      this.audio.update(null, null, null, null);
      this.particles.update(this.clock);
      this.updateBolts();
      return;
    }
    this.readWind(world);
    this.paintField(dt);
    this.paintObjects(world, dt);
    this.paintMarks(world, dt);
    this.paintBars(world);
    this.updateBolts();
    this.particles.update(this.clock);
    const guardian = this.guardianId >= 0 ? (world.entities.get(this.guardianId) ?? null) : null;
    const wind = this.windId >= 0 ? world.entities.get(this.windId) : undefined;
    let gale: { x: number; y: number; z: number } | null = null;
    const me = world.entities.get(world.playerId);
    let best = 1e9;
    for (const s of this.galeFans) {
      if (s.id < 0 || !me) continue;
      const e = world.entities.get(s.id);
      if (!e) continue;
      const d = Math.hypot(e.pos.x - me.pos.x, e.pos.z - me.pos.z);
      if (d < best) {
        best = d;
        gale = e.pos;
      }
    }
    this.audio.update(this.windPhase, wind ? wind.pos : null, guardian, gale);
  }

  // ---- the scan -------------------------------------------------------------------------

  private scan(world: IWorld): void {
    const me = world.entities.get(world.playerId);
    const origin = me ? breathClaimOrigin(me.pos.x, me.pos.z) : null;
    // Only on the Cornice's side of the claim: no walk of the world elsewhere.
    const near =
      origin !== null &&
      me !== undefined &&
      Math.hypot(me.pos.x - origin.x, me.pos.z - origin.z - 196) < 140;
    if (!near || !origin) {
      if (this.origin) this.leave();
      return;
    }
    if (!this.origin || this.origin.x !== origin.x || this.origin.z !== origin.z) {
      this.origin = origin;
      this.floorY = this.groundY(origin.x, origin.z + 196);
      this.local.position.set(origin.x, this.floorY - CORNICE_FLOOR_H, origin.z);
      this.fieldMat.uniforms.uCentre.value.set(0, 196);
      this.rosterSeen = Number.NaN;
    }
    this.local.visible = true;
    // The roster walk runs on a membership change only (an entity added or
    // dropped: src/render/CLAUDE.md "Performance discipline"); the scan's
    // clock re-reads only the few candidates it found.
    if (world.entityRosterVersion !== this.rosterSeen) {
      this.rosterSeen = world.entityRosterVersion;
      this.discover(world, origin);
    }
    this.objectIds.length = 0;
    this.cradledIds.length = 0;
    this.guardianId = -1;
    this.thessalyId = -1;
    this.windId = -1;
    this.anchorMarks.begin();
    this.pinnedMarks.begin();
    this.drawnMarks.begin();
    for (let i = 0; i < this.candidateIds.length; i++) {
      const e = world.entities.get(this.candidateIds[i]);
      if (!e) continue;
      if (e.kind === 'object') {
        const kind = breathObjectKind(e.templateId);
        if (kind === 'wind') this.windId = e.id;
        else if (kind) this.objectIds.push(e.id);
      } else if (e.kind === 'mob') {
        this.guardianId = e.id;
        let stacks = 0;
        for (const a of e.auras) if (a.id === BREATH_AURAS.swell) stacks = a.stacks ?? 1;
        this.swell = e.dead ? 0 : stacks;
      } else if (e.kind === 'npc') {
        this.thessalyId = e.id;
      } else if (e.kind === 'player' && !e.dead) {
        // Players move: the claim's box is checked on every pass.
        if (Math.abs(e.pos.x - origin.x) > 300 || Math.abs(e.pos.z - origin.z) > 260) continue;
        for (const a of e.auras) {
          if (a.id === BREATH_AURAS.anchor) this.anchorMarks.take(e.id);
          else if (a.id === BREATH_AURAS.pinned) this.pinnedMarks.take(e.id);
          else if (a.id === BREATH_AURAS.drawn) this.drawnMarks.take(e.id);
          else if (a.id === BREATH_AURAS.cradled) this.cradledIds.push(e.id);
        }
      }
    }
    this.anchorMarks.end();
    this.pinnedMarks.end();
    this.drawnMarks.end();
    this.assign(world);
  }

  /** The roster walk: every entity the fight could draw (the claim's
   *  objects, its guardian, Thessaly, and every player, who may walk in). */
  private discover(world: IWorld, origin: { x: number; z: number }): void {
    const ids = this.candidateIds;
    ids.length = 0;
    for (const e of world.entities.values()) {
      if (e.kind === 'player') {
        ids.push(e.id);
        continue;
      }
      if (Math.abs(e.pos.x - origin.x) > 300 || Math.abs(e.pos.z - origin.z) > 260) continue;
      if (
        e.kind === 'object' ||
        (e.kind === 'mob' && e.templateId === BREATH_GUARDIAN) ||
        (e.kind === 'npc' && e.templateId === BREATH_THESSALY_NPC)
      )
        ids.push(e.id);
    }
  }

  /** Every fight object to its footprint slot (released when gone). */
  private assign(world: IWorld): void {
    for (const pool of this.footprintPools)
      for (const s of pool)
        if (s.id >= 0 && !this.objectIds.includes(s.id)) {
          s.id = -1;
          s.fan.group.visible = false;
        }
    for (const id of this.objectIds) {
      const e = world.entities.get(id);
      if (!e) continue;
      const kind = breathObjectKind(e.templateId);
      const pool =
        kind === 'calm'
          ? this.calmFans
          : kind === 'vortex'
            ? this.vortexFans
            : kind === 'gale'
              ? this.galeFans
              : kind === 'strike'
                ? this.strikeFans
                : kind === 'charged'
                  ? this.chargedFans
                  : kind === 'cradle'
                    ? this.cradleFans
                    : null;
      if (!pool) continue;
      let slot: FanSlot | null = null;
      for (const s of pool) if (s.id === id) slot = s;
      if (!slot) {
        for (const s of pool) if (s.id < 0) slot = s;
        if (!slot) continue;
        slot.id = id;
        slot.born = this.clock;
        slot.template = e.templateId;
        slot.fan.group.visible = true;
      } else if (slot.template !== e.templateId) {
        // A new state (the circle landing, then holding): its clock restarts.
        slot.template = e.templateId;
        slot.born = this.clock;
      }
    }
  }

  private leave(): void {
    this.origin = null;
    this.rosterSeen = Number.NaN;
    this.candidateIds.length = 0;
    this.local.visible = false;
    for (const pool of [
      this.calmFans,
      this.vortexFans,
      this.galeFans,
      this.strikeFans,
      this.chargedFans,
      this.cradleFans,
      this.barFans,
    ])
      for (const s of pool) {
        s.id = -1;
        s.fan.group.visible = false;
      }
    for (const p of [this.anchorMarks, this.pinnedMarks, this.drawnMarks]) {
      p.begin();
      p.end();
    }
    this.vortexFunnel.mesh.visible = false;
    for (const f of [...this.galeFunnels, ...this.calmBeams, ...this.calmDomes, ...this.beacons])
      f.mesh.visible = false;
    for (const s of [...this.seatPips, ...this.beaconGlows]) s.visible = false;
    this.crown.visible = false;
    this.windPhase = null;
  }

  // ---- the wind ---------------------------------------------------------------------------

  private readWind(world: IWorld): void {
    const w = this.windId >= 0 ? world.entities.get(this.windId) : undefined;
    const of = w ? breathWindOf(w.templateId) : null;
    if (!w || !of) {
      this.windPhase = null;
      this.windFill = 0;
      return;
    }
    if (w.templateId !== this.windTemplate) {
      this.windTemplate = w.templateId;
      this.windSince = this.clock;
    }
    this.windPhase = of.phase;
    this.windBearing = of.bearingDeg;
    this.windFill = of.seconds > 0 ? Math.min(1, (this.clock - this.windSince) / of.seconds) : 0;
  }

  private paintField(dt: number): void {
    const look = windFieldLook(this.windPhase, this.windFill, this.windLook);
    const u = this.fieldMat.uniforms;
    const d = bearingDir(this.windBearing, this.windDir);
    u.uDir.value.set(d.x, d.z);
    u.uInward.value = look.inward ? 1 : 0;
    // The flow integrates its own speed, so a change of speed never jumps.
    this.flowAt = (this.flowAt + look.speed * dt) % 9000;
    u.uFlowT.value = this.flowAt;
    u.uStrength.value += (look.strength - u.uStrength.value) * Math.min(1, dt * 4);
    u.uChevron.value += (look.chevron - u.uChevron.value) * Math.min(1, dt * 5);
    u.uFront.value = look.front;
    const world = this.world;
    const g = world && this.guardianId >= 0 ? world.entities.get(this.guardianId) : undefined;
    if (g && this.origin) u.uFocus.value.set(g.pos.x - this.origin.x, g.pos.z - this.origin.z);
    this.field.visible = u.uChevron.value > 0.01 || u.uStrength.value > 0.01 || look.front >= 0;
    // The gaps' lips flare when the wind blows their way.
    const th = this.lipMat.uniforms.uThreat.value as THREE.Vector4;
    th.set(this.lipThreat(0), this.lipThreat(1), this.lipThreat(2), this.lipThreat(3));
    (this.lipFloorMat.uniforms.uThreat.value as THREE.Vector4).copy(th);
    // The swelling storm's flicker over the floor.
    const stacks = this.swell;
    u.uStorm.value = Math.min(1, stacks / 20);
    this.windDressing(look, d, dt);
  }

  /** One gap's lip's threat (0 for a lip the field has none of). */
  private lipThreat(i: number): number {
    const lip = this.lips[i];
    return lip ? gapThreat(lip, this.windPhase, this.windBearing) : 0;
  }

  /** The air's streaks and grit riding the wind round the player, the
   *  updraft and mist at the gaps (cosmetic). */
  private windDressing(look: WindFieldLook, d: { x: number; z: number }, dt: number): void {
    const world = this.world;
    const me = world?.entities.get(world.playerId);
    if (!me || !this.origin) return;
    if (look.strength > 0.2 && !look.inward) {
      const rate = 8 * look.strength * this.density;
      for (let i = 0; i < 3; i++) {
        if (this.rand() > dt * rate) continue;
        // Born upwind of the player, carried past them.
        const across = (this.rand() - 0.5) * 50;
        const back = 12 + this.rand() * 18;
        const x = me.pos.x - d.x * back + d.z * across;
        const z = me.pos.z - d.z * back - d.x * across;
        this.particles.puff(x, me.pos.y + 0.4 + this.rand() * 4, z, 1, {
          speed: 16 + look.strength * 8,
          life: 1.4,
          size: [0.7, 0.2],
          color: C.wind,
          alpha: 0.22,
          dir: [d.x, 0.02, d.z],
          spread: 0.04,
          drag: 0.1,
        });
      }
      if (this.rand() < dt * 18 * look.strength * this.density) {
        const across = (this.rand() - 0.5) * 30;
        const x = me.pos.x - d.x * 8 + d.z * across;
        const z = me.pos.z - d.z * 8 - d.x * across;
        this.particles.puff(x, this.groundY(x, z) + 0.2, z, 2, {
          speed: 12,
          up: 0.6,
          life: 1.1,
          size: [0.18, 0.1],
          color: C.grit,
          alpha: 0.8,
          dir: [d.x, 0.1, d.z],
          spread: 0.2,
          gravity: 3,
        });
      }
    }
    if (look.inward && look.strength > 0.2) {
      const g = this.guardianId >= 0 ? world?.entities.get(this.guardianId) : undefined;
      if (g && this.rand() < dt * 16 * look.strength * this.density) {
        const a = this.rand() * Math.PI * 2;
        const r = 10 + this.rand() * 26;
        const x = g.pos.x + Math.sin(a) * r;
        const z = g.pos.z + Math.cos(a) * r;
        this.particles.puff(x, this.groundY(x, z) + 0.5 + this.rand() * 2.5, z, 1, {
          speed: 14 + look.speed,
          life: 1.1,
          size: [0.8, 0.2],
          color: C.wind,
          alpha: 0.28,
          dir: [-Math.sin(a) + Math.cos(a) * 0.35, 0, -Math.cos(a) - Math.sin(a) * 0.35],
          spread: 0.06,
        });
      }
    }
    // The updraft through every gap: mist rising off the void.
    if (this.rand() < dt * 6 * this.density) {
      const lip = this.lips[Math.floor(this.rand() * this.lips.length)];
      const seg = lip?.segments[Math.floor(this.rand() * (lip?.segments.length ?? 0))];
      if (lip && seg) {
        const t = this.rand();
        const x = this.origin.x + seg.ax + (seg.bx - seg.ax) * t + seg.nx * 1.5;
        const z = this.origin.z + seg.az + (seg.bz - seg.az) * t + seg.nz * 1.5;
        this.particles.puff(x, this.floorY - 3, z, 1, {
          speed: 1,
          up: 4.5,
          life: 2.4,
          size: [1.4, 3.6],
          color: C.mist,
          alpha: 0.3,
          drag: 0.6,
        });
      }
    }
  }

  // ---- the objects -----------------------------------------------------------------------

  private drape(s: FanSlot, e: Entity, r: number, fill: number, fade = 1, front?: number): void {
    const y = this.groundY(e.pos.x, e.pos.z);
    this.kit.drapeFan(s.fan, this.groundY, e.pos.x, y, e.pos.z, 0, r);
    this.kit.paintFan(s.fan, { fill, clock: this.clock, range: r, fade, front });
  }

  private paintObjects(world: IWorld, dt: number): void {
    // Thessaly's circles.
    for (let i = 0; i < this.calmFans.length; i++) {
      const s = this.calmFans[i];
      const beam = this.calmBeams[i];
      const dome = this.calmDomes[i];
      const e = s.id >= 0 ? world.entities.get(s.id) : undefined;
      const of = e ? calmOf(e.templateId) : null;
      if (!e || !of) {
        beam.mesh.visible = false;
        dome.mesh.visible = false;
        for (let k = 0; k < P.seats; k++) this.seatPips[i * P.seats + k].visible = false;
        continue;
      }
      const r = e.scale > 0 ? e.scale : T.circleR;
      const age = this.clock - s.born;
      const look = calmLook(of.state, of.seconds > 0 ? age / of.seconds : 1);
      this.drape(s, e, r, look.fill, look.fade);
      const y = this.groundY(e.pos.x, e.pos.z);
      beam.mesh.visible = look.beam > 0.02;
      if (beam.mesh.visible) {
        // The light falls from the sky onto where it will land.
        const h = 30 * (1 - 0.7 * (of.seconds > 0 ? Math.min(1, age / of.seconds) : 1));
        beam.mesh.position.set(e.pos.x, y, e.pos.z);
        beam.mesh.scale.set(r * 0.55, h + 2, r * 0.55);
        beam.mat.uniforms.uAlpha.value = look.beam * 0.75;
      }
      dome.mesh.visible = this.detail && look.dome > 0.02;
      if (dome.mesh.visible) {
        dome.mesh.position.set(e.pos.x, y, e.pos.z);
        dome.mesh.scale.set(r, r * 0.8, r);
        dome.mat.uniforms.uAlpha.value = look.dome * look.fade;
      }
      // The seats: three pips on its rim, a free one lit (every tier).
      let inside = 0;
      if (of.state !== 'land') {
        for (const m of this.anchorMarks.marks) {
          if (m.id < 0) continue;
          const p = world.entities.get(m.id);
          if (p && Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z) <= r + 0.6) inside++;
        }
      }
      const left = of.state === 'spent' ? 0 : calmSeatsLeft(inside);
      for (let k = 0; k < P.seats; k++) {
        const pip = this.seatPips[i * P.seats + k];
        const a = (k / P.seats) * Math.PI * 2 + this.clock * 0.4;
        pip.visible = of.state !== 'land' || look.fill > 0.6;
        pip.position.set(e.pos.x + Math.sin(a) * r, y + 0.45, e.pos.z + Math.cos(a) * r);
        pip.material = k < left ? this.seatMat : this.seatSpentMat;
      }
      if (of.state === 'hold' && this.rand() < dt * 10 * this.density) {
        const a = this.rand() * Math.PI * 2;
        const rr = this.rand() * r;
        this.particles.puff(e.pos.x + Math.sin(a) * rr, y + 0.2, e.pos.z + Math.cos(a) * rr, 1, {
          speed: 0.3,
          up: 1.4,
          life: 1.4,
          size: [0.25, 0.05],
          color: C.calmMote,
          alpha: 0.8,
          pool: 'glow',
        });
      }
    }
    // The vortex.
    {
      const s = this.vortexFans[0];
      const e = s && s.id >= 0 ? world.entities.get(s.id) : undefined;
      const f = this.vortexFunnel;
      if (!e) f.mesh.visible = false;
      else {
        const r = e.scale > 0 ? e.scale : T.vortexR;
        this.drape(s, e, r, 1, 0.85 + 0.15 * Math.sin(this.clock * 9));
        f.mesh.visible = true;
        f.mesh.position.set(e.pos.x, this.groundY(e.pos.x, e.pos.z), e.pos.z);
        f.mesh.scale.set(r * 0.8, VORTEX_FUNNEL.height, r * 0.8);
        f.mat.uniforms.uAlpha.value = this.detail ? 0.75 : 0.55;
        if (this.rand() < dt * 30 * this.density) {
          const a = this.rand() * Math.PI * 2;
          this.particles.puff(
            e.pos.x + Math.sin(a) * r,
            e.pos.y + 0.3,
            e.pos.z + Math.cos(a) * r,
            1,
            {
              speed: 6,
              up: 3,
              life: 0.6,
              size: [0.3, 0.15],
              color: C.grit,
              alpha: 0.8,
              dir: [Math.cos(a), 0.6, -Math.sin(a)],
              spread: 0.2,
            },
          );
        }
      }
    }
    // The loose gales.
    for (let i = 0; i < this.galeFans.length; i++) {
      const s = this.galeFans[i];
      const f = this.galeFunnels[i];
      const e = s.id >= 0 ? world.entities.get(s.id) : undefined;
      if (!e) {
        f.mesh.visible = false;
        continue;
      }
      const r = e.scale > 0 ? e.scale : T.galeR;
      this.drape(s, e, r, 1, 0.9);
      f.mesh.visible = true;
      f.mesh.position.set(e.pos.x, this.groundY(e.pos.x, e.pos.z), e.pos.z);
      f.mesh.scale.set(r, GALE_COLUMN.height, r);
      f.mesh.rotation.y = this.clock * 2;
      f.mat.uniforms.uAlpha.value = this.detail ? 0.85 : 0.65;
      if (this.rand() < dt * 24 * this.density) {
        const a = this.rand() * Math.PI * 2;
        this.particles.puff(
          e.pos.x + Math.sin(a) * r,
          e.pos.y + 0.5,
          e.pos.z + Math.cos(a) * r,
          1,
          {
            speed: 5,
            up: 6,
            life: 1,
            size: [0.35, 0.2],
            color: C.grit,
            alpha: 0.85,
            dir: [Math.cos(a), 0.8, -Math.sin(a)],
            spread: 0.25,
          },
        );
      }
    }
    // The strikes' spots, the charged ground, the cradle.
    for (const s of this.strikeFans) {
      const e = s.id >= 0 ? world.entities.get(s.id) : undefined;
      if (!e) continue;
      const warn = timedOf(BREATH_OBJECTS.strikePrefix, e.templateId) ?? T.strikeWarn;
      const fill = strikeFill(this.clock - s.born, warn);
      this.drape(s, e, e.scale > 0 ? e.scale : T.strikeR, fill);
      if (this.rand() < dt * 14 * this.density * (0.3 + fill)) {
        // The charge gathering in the cloud over it.
        this.particles.puff(e.pos.x, e.pos.y + 10 + this.rand() * 4, e.pos.z, 2, {
          speed: 4,
          life: 0.25,
          size: [0.6, 0.12],
          color: C.spark,
          alpha: 0.9,
          pool: 'glow',
        });
      }
    }
    for (const s of this.chargedFans) {
      const e = s.id >= 0 ? world.entities.get(s.id) : undefined;
      if (!e) continue;
      const life = timedOf(BREATH_OBJECTS.chargedPrefix, e.templateId) ?? T.chargedSeconds;
      const r = e.scale > 0 ? e.scale : T.chargedR;
      this.drape(s, e, r, 1, chargedFade(this.clock - s.born, life));
      if (this.rand() < dt * 12 * this.density) {
        const a = this.rand() * Math.PI * 2;
        const rr = Math.sqrt(this.rand()) * r;
        this.particles.puff(
          e.pos.x + Math.sin(a) * rr,
          e.pos.y + 0.15,
          e.pos.z + Math.cos(a) * rr,
          2,
          {
            speed: 2.5,
            up: 1.2,
            life: 0.22,
            size: [0.35, 0.06],
            color: C.spark,
            alpha: 1,
            pool: 'glow',
          },
        );
      }
    }
    for (const s of this.cradleFans) {
      const e = s.id >= 0 ? world.entities.get(s.id) : undefined;
      if (!e) continue;
      const hold = timedOf(BREATH_OBJECTS.cradlePrefix, e.templateId) ?? T.cradleHold;
      const look = cradleLook(this.clock - s.born, hold);
      this.drape(s, e, e.scale > 0 ? e.scale : T.cradleR, look.fill);
    }
    // The lifted player's crown of storm.
    const lifted = this.cradledIds.length > 0 ? world.entities.get(this.cradledIds[0]) : undefined;
    this.crown.visible = lifted !== undefined;
    if (lifted) {
      const s = this.cradleFans[0];
      const hold =
        s && s.id >= 0
          ? (timedOf(BREATH_OBJECTS.cradlePrefix, world.entities.get(s.id)?.templateId ?? '') ??
            T.cradleHold)
          : T.cradleHold;
      const charge = s && s.id >= 0 ? cradleLook(this.clock - s.born, hold).charge : 0.6;
      this.crown.position.set(lifted.pos.x, lifted.pos.y + 1.1, lifted.pos.z);
      this.crownMat.opacity = 0.5 + 0.5 * charge * (0.8 + 0.2 * Math.sin(this.clock * 17));
      for (let k = 0; k < this.crownSparks.length; k++) {
        const a = (k / this.crownSparks.length) * Math.PI * 2 + this.clock * (2 + charge * 3);
        const rr = 1.3 + 0.25 * Math.sin(this.clock * 5 + k);
        this.crownSparks[k].position.set(
          Math.sin(a) * rr,
          0.4 * Math.sin(this.clock * 7 + k),
          Math.cos(a) * rr,
        );
      }
      if (this.rand() < dt * 16 * this.density)
        this.sparksAt(lifted.pos.x, lifted.pos.y + 1, lifted.pos.z, 3);
    }
  }

  // ---- the players' marks -----------------------------------------------------------------

  private paintMarks(world: IWorld, dt: number): void {
    for (const m of this.anchorMarks.marks) {
      if (m.id < 0) continue;
      const p = world.entities.get(m.id);
      if (!p) continue;
      const y = this.groundY(p.pos.x, p.pos.z);
      this.kit.drapeFan(m.fan, this.groundY, p.pos.x, y, p.pos.z, 0, 1.15);
      this.kit.paintFan(m.fan, { fill: 1, clock: this.clock, range: 1.15 });
      if (this.rand() < dt * 6 * this.density)
        this.particles.puff(p.pos.x, y + 0.2, p.pos.z, 1, {
          speed: 0.2,
          up: 2.2,
          life: 1,
          size: [0.3, 0.05],
          color: C.calmMote,
          alpha: 0.8,
          pool: 'glow',
          radius: 0.5,
        });
    }
    // The pinned: an arc at their feet facing the wall they are pressed to.
    const d = bearingDir(this.windBearing, this.windDir);
    const yaw = Math.atan2(d.x, d.z);
    for (const m of this.pinnedMarks.marks) {
      if (m.id < 0) continue;
      const p = world.entities.get(m.id);
      if (!p) continue;
      const y = this.groundY(p.pos.x, p.pos.z);
      this.kit.drapeFan(m.fan, this.groundY, p.pos.x, y, p.pos.z, yaw, PINNED_MARK.r);
      this.kit.paintFan(m.fan, {
        fill: 0.6 + 0.4 * Math.abs(Math.sin(this.clock * 4)),
        clock: this.clock,
        range: PINNED_MARK.r,
      });
      if (this.rand() < dt * 20 * this.density)
        this.particles.puff(p.pos.x + d.x * 0.6, y + 0.4, p.pos.z + d.z * 0.6, 2, {
          speed: 5,
          up: 2,
          life: 0.5,
          size: [0.3, 0.9],
          color: C.grit,
          alpha: 0.6,
          dir: [-d.z, 0.4, d.x],
          spread: 0.8,
          drag: 1.2,
        });
    }
    // The conductor: a beacon of lightning over them, a ring at their feet.
    let b = 0;
    for (const m of this.drawnMarks.marks) {
      if (m.id < 0) continue;
      const p = world.entities.get(m.id);
      if (!p) continue;
      const y = this.groundY(p.pos.x, p.pos.z);
      this.kit.drapeFan(m.fan, this.groundY, p.pos.x, y, p.pos.z, 0, 1.4);
      this.kit.paintFan(m.fan, { fill: 1, clock: this.clock, range: 1.4 });
      if (b < this.beacons.length) {
        const beacon = this.beacons[b];
        const glow = this.beaconGlows[b];
        beacon.mesh.visible = true;
        beacon.mesh.position.set(p.pos.x, p.pos.y + 2.4, p.pos.z);
        beacon.mesh.scale.set(0.35, 14, 0.35);
        beacon.mat.uniforms.uAlpha.value = 0.55 + 0.45 * Math.abs(Math.sin(this.clock * 11));
        glow.visible = true;
        glow.position.set(p.pos.x, p.pos.y + 2.6, p.pos.z);
        b++;
      }
    }
    for (; b < this.beacons.length; b++) {
      this.beacons[b].mesh.visible = false;
      this.beaconGlows[b].visible = false;
    }
  }

  /** The bars' footprints round their target: the leaping bolt's jump reach,
   *  the cradle's spot, the conductor's mark, while each bar runs. */
  private paintBars(world: IWorld): void {
    const g = this.guardianId >= 0 ? world.entities.get(this.guardianId) : undefined;
    const slot = this.barFans[0];
    const id = g?.castingAbility;
    const target = g && g.castTargetId !== null ? world.entities.get(g.castTargetId) : undefined;
    const r =
      id === BREATH_CASTS.fork
        ? FORK_REACH
        : id === BREATH_CASTS.cradle
          ? T.cradleR
          : id === BREATH_CASTS.drawn
            ? T.drawnR
            : 0;
    if (!g || g.dead || !target || r <= 0) {
      slot.fan.group.visible = false;
      slot.id = -1;
      return;
    }
    if (slot.template !== id) {
      slot.template = id ?? '';
      const color =
        id === BREATH_CASTS.fork ? C.danger : id === BREATH_CASTS.cradle ? C.soak : C.lethal;
      this.kit.layOutFan(slot.fan, 360, { color, accent: C.accent });
    }
    slot.fan.group.visible = true;
    const fill = g.castTotal > 0 ? Math.max(0, Math.min(1, 1 - g.castRemaining / g.castTotal)) : 1;
    const y = this.groundY(target.pos.x, target.pos.z);
    this.kit.drapeFan(slot.fan, this.groundY, target.pos.x, y, target.pos.z, 0, r);
    this.kit.paintFan(slot.fan, { fill, clock: this.clock, range: r });
  }

  // ---- the strikes, the beams --------------------------------------------------------------

  private strike(lx: number, lz: number, r: number, size: number): void {
    const x = lx;
    const z = lz;
    const y = this.groundY(x, z);
    const b = firstIdle(this.bolts);
    b.born = this.clock;
    b.live = true;
    b.seconds = STRIKE_BOLT_SECONDS * (size > 1 ? 1.6 : 1);
    b.mesh.position.set(x, y, z);
    b.mesh.scale.set(size, size > 1 ? 1.15 : 1, size);
    b.mesh.rotation.y = this.rand() * Math.PI * 2;
    b.mesh.visible = true;
    const sc = firstIdle(this.scorches);
    sc.born = this.clock;
    sc.live = true;
    sc.mesh.position.set(x, y + 0.05, z);
    sc.mesh.scale.set(r * 2, 1, r * 2);
    sc.mesh.rotation.y = this.rand() * Math.PI * 2;
    sc.mesh.visible = true;
    this.sparksAt(x, y + 0.5, z, Math.round(12 * size));
    this.particles.puff(x, y + 0.4, z, Math.round(6 * size * this.density) + 2, {
      speed: 3,
      up: 1.4,
      life: 1.4,
      size: [1, 3],
      color: [0.5, 0.55, 0.6],
      alpha: 0.35,
      drag: 1.4,
      radius: r * 0.5,
    });
    this.particles.shockRing(x, z, 0xd8f6ff, r * 1.2, 0.45);
    this.shakeNear(x, z, 0.18 * size, 30);
  }

  private sparksAt(x: number, y: number, z: number, n: number): void {
    this.particles.puff(x, y, z, Math.max(1, Math.round(n * this.density)), {
      speed: 6,
      up: 2,
      life: 0.35,
      size: [0.3, 0.06],
      color: C.spark,
      alpha: 1,
      pool: 'glow',
    });
  }

  /** A beam between two bodies (a fork's leg, Thessaly's anchor). */
  private beam(from: Entity, to: Entity, seconds: number, fromLift: number, color?: number): void {
    const b = firstIdle(this.beams);
    b.born = this.clock;
    b.seconds = seconds;
    b.live = true;
    const core = b.mat.uniforms.uCore.value as THREE.Color;
    const edge = b.mat.uniforms.uEdge.value as THREE.Color;
    if (color !== undefined) {
      core.setHex(0xf2fff8);
      edge.setHex(color);
    } else {
      core.setRGB(...C.boltCore);
      edge.setRGB(...C.boltEdge);
    }
    this.v.set(from.pos.x, from.pos.y + fromLift, from.pos.z);
    this.v2.set(to.pos.x, to.pos.y + 1.2, to.pos.z);
    const pos = b.geo.getAttribute('position') as THREE.BufferAttribute;
    const jag = color !== undefined ? 0.15 : 0.7;
    const salt = Math.floor(this.rand() * 9999);
    for (let pass = 0; pass < 2; pass++) {
      const base = pass * BEAM_POINTS * 2;
      for (let i = 0; i < BEAM_POINTS; i++) {
        const t = i / (BEAM_POINTS - 1);
        const j = i === 0 || i === BEAM_POINTS - 1 ? 0 : jag;
        const arc = color !== undefined ? Math.sin(Math.PI * t) * 1.5 : 0;
        const x = this.v.x + (this.v2.x - this.v.x) * t + (fxHash01(salt, i) - 0.5) * j;
        const y = this.v.y + (this.v2.y - this.v.y) * t + (fxHash01(salt, i + 20) - 0.5) * j + arc;
        const z = this.v.z + (this.v2.z - this.v.z) * t + (fxHash01(salt, i + 40) - 0.5) * j;
        const w = 0.2;
        const ox = pass === 0 ? w : 0;
        const oy = pass === 0 ? 0 : w;
        pos.setXYZ(base + i * 2, x - ox, y - oy, z);
        pos.setXYZ(base + i * 2 + 1, x + ox, y + oy, z);
      }
    }
    pos.needsUpdate = true;
    b.geo.computeBoundingSphere();
    b.mesh.visible = true;
  }

  private updateBolts(): void {
    for (const b of this.bolts) {
      if (!b.live) continue;
      const a = boltFlare(this.clock - b.born, b.seconds);
      b.mat.uniforms.uAlpha.value = a;
      if (a <= 0) {
        b.live = false;
        b.mesh.visible = false;
      }
    }
    for (const b of this.beams) {
      if (!b.live) continue;
      const a = boltFlare(this.clock - b.born, b.seconds);
      b.mat.uniforms.uAlpha.value = a;
      if (a <= 0) {
        b.live = false;
        b.mesh.visible = false;
      }
    }
    for (const s of this.scorches) {
      if (!s.live) continue;
      const t = this.clock - s.born;
      const heat = Math.max(0, 1.2 * (1 - t / 0.8));
      s.mat.uniforms.uHeat.value = heat;
      s.mat.uniforms.uAlpha.value = Math.max(0, 1 - t / STRIKE_SCORCH_SECONDS);
      if (t > STRIKE_SCORCH_SECONDS) {
        s.live = false;
        s.mesh.visible = false;
      }
    }
  }

  private calmLand(x: number, z: number, r: number): void {
    const y = this.groundY(x, z);
    this.particles.shockRing(x, z, C.calm, r * 1.6, 0.6);
    this.particles.puff(x, y + 0.4, z, Math.round(20 * this.density) + 4, {
      speed: 3,
      up: 2.5,
      life: 1.1,
      size: [0.35, 0.06],
      color: C.calmMote,
      alpha: 1,
      pool: 'glow',
      radius: r * 0.8,
    });
  }

  private fall(x: number, z: number): void {
    const y = this.groundY(x, z);
    this.particles.puff(x, y + 0.5, z, Math.round(14 * this.density) + 3, {
      speed: 4,
      up: -2,
      life: 1.2,
      size: [0.8, 2.4],
      color: C.mist,
      alpha: 0.45,
      drag: 0.8,
      radius: 1,
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.audio.dispose();
    this.particles.dispose();
    this.kit.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.glowTex?.dispose();
  }
}
