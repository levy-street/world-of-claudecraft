// The Guardian of the Heat's fight in the Hearth (plan: heat_fight_fx_core.ts;
// docs/design/raid/smith_heart.md section 7.4), hosted by ../rift_death_zone.ts
// beside HeatFx (which keeps Molten Pour's and Searing Knell's own looks) and
// the body (heat_body.ts). Presentation only, read from IWorld (the fight's
// objects, the guardian's resource and auras, the players' burns, the cues),
// so offline and online look the same:
//  - the crystals: each rise spot's footprint (danger) filling over Shed
//    Heat's bar, cracks of light racing through the basalt round it; the
//    Kindled Crystal tearing up out of the floor, white-gold prisms on a bed
//    of column stumps, its reach a ring of the soak's gold at the ray's exact
//    range filling toward each ray (stand in it), its light swelling before
//    each ray, flickering as it fails, shattering as it burns out;
//  - the rays: a thick white-gold beam from the crystal to the player it
//    struck, a flash at the hit, held on them until the next ray (who is
//    being struck is never in doubt); a ray sent back: a deep gold beam
//    driving into the guardian, a flare on it;
//  - Crystal Burn: flames of the first flame climbing a burned player's body
//    with their stacks, a scorch glowing under them, pulsing hard past eight;
//  - the channel: its bed a dull seam of fire across the floor the whole
//    fight; brimming, the bed lights from its head down and its lane (danger,
//    the exact half width) fills; flowing, white-gold fire runs down it and
//    burns, falling off the south lip;
//  - heroic's Knell Embers: a smouldering patch of the first flame at its
//    exact radius, its rim the danger colour;
//  - the heat: the Hearth Pulse's ring rolling out of the guardian, stronger
//    the hotter; from 90 the floor's heat glow beating white and the haze
//    thick over it; Hearthburst's white wave over the whole floor, a shake.
// Every footprint, reach ring, beam, burn, the channel's lane and the
// wind-up's floor glow draw on every tier; sparks, embers, haze and smoke
// thin on the low tier, the shakes go under reduced motion.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under one root attached through `attachSceneGroupGated` (a kit
// that lands later swaps in through the compile gate); fixed pools, no
// per-frame allocation, no light. Feeds ../../game/smith_heart_heat_audio.ts.

import * as THREE from 'three';
import { sfx } from '../../game/sfx';
import { HeatAudio } from '../../game/smith_heart_heat_audio';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import {
  channelOf,
  crystalOf,
  embersOf,
  HEAT_AURAS,
  HEAT_CUES,
  HEAT_GUARDIAN,
  type HeatChannelState,
  riseOf,
  HEAT_TUNING as T,
} from '../../sim/encounters/smith_heart/heat_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import {
  type TelegraphFan,
  TelegraphKit,
  type TelegraphLane,
  type TelegraphPaint,
} from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import {
  ensureHeartKit,
  heartKitLoaded,
  heartKitMeshes,
  heartKitProgramWarmers,
  heartKitSlotMaterial,
} from '../smith_heart/heart_kit';
import { heartVeinGlowMaterial } from '../smith_heart/heart_room_kit';
import { radialGlowTexture } from '../textures';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  BEAM_HOLD,
  type BeamLook,
  type BurnLook,
  beamLook,
  burnLook,
  burstWave,
  HEAT_FIGHT_COLORS as C,
  CHANNEL_LINE,
  type ChannelLook,
  type CrystalLook,
  channelLook,
  crystalLook,
  embersLook,
  HEARTH_CENTRE,
  HEAT_FIGHT_REACH,
  heatClaimOrigin,
  heatFightClaims,
  heatFightHash,
  heatObjectKind,
  HEAT_FIGHT_POOLS as P,
  pulseRing,
  riseLook,
  windupGather,
  windupGlow,
} from './heat_fight_fx_core';

const SCAN_SEC = 0.1;
const HEAT_KIT_URL = '/models/props/smith_heart_heat_kit.glb';
/** How deep a crystal waits under the basalt before it tears up. */
const CRYSTAL_SUNK = 4.6;
/** Where a ray leaves a crystal (yards over its foot) and strikes a body. */
const CRYSTAL_TIP = 4.0;
const BODY_CHEST = 1.25;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _w = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _crystal: CrystalLook = { rise: 0, light: 0, charge: 0, left: 1 };
const _beam: BeamLook = { width: 0, alpha: 0 };
const _burn: BurnLook = { cover: 0, heat: 0, pulse: 0 };
const _channel: ChannelLook = { bed: 0, lit: 0, front: 0, fire: 0, lane: false, fill: 0 };
const _box = new THREE.Box3();
const _size = new THREE.Vector3();
const _centre = new THREE.Vector3();
const SPARK_PUFF = {
  speed: 5,
  up: 2,
  life: 0.5,
  size: [0.3, 0.06] as [number, number],
  color: C.spark,
  alpha: 1,
  pool: 'glow' as const,
  radius: 0.4,
};
const EMBER_PUFF = {
  speed: 0.8,
  up: 2.6,
  life: 1.1,
  size: [0.22, 0.05] as [number, number],
  color: C.ember,
  alpha: 1,
  pool: 'glow' as const,
  radius: 0.5,
};
/** The per-frame looks and paints, written in place (no allocation a frame). */
const _rise = { fill: 0, crack: 0 };
const _ring = { radius: 0, alpha: 0 };
const FAN_PAINT: TelegraphPaint = { fill: 0, clock: 0, range: 0 };
const LANE_PAINT: TelegraphPaint = { fill: 0, clock: 0, range: 0 };
const CHANNEL_STYLE = { color: C.danger, accent: C.accent };

/** The wind-up's embers sucked into the guardian (its direction written in
 *  place: no allocation a frame). */
const GATHER_DIR: [number, number, number] = [0, 0.15, 0];
const GATHER_PUFF = {
  speed: 11,
  up: 0.4,
  life: 1.3,
  size: [0.35, 0.1] as [number, number],
  color: C.spark,
  alpha: 1,
  pool: 'glow' as const,
  dir: GATHER_DIR,
  spread: 0.08,
  radius: 0.6,
};
const HAZE_PUFF = {
  speed: 0.3,
  up: 1.4,
  life: 1.8,
  size: [2.2, 4.4] as [number, number],
  color: C.haze,
  alpha: 0.06,
  drag: 0.8,
  radius: 1,
};
const FLAME_PUFF = {
  speed: 0.8,
  up: 3.2,
  life: 0.6,
  size: [1.1, 0.3] as [number, number],
  color: C.fire,
  alpha: 0.9,
  pool: 'glow' as const,
  radius: 1,
};

/** The embers' flames, written in place (no allocation a frame). */
const EMBERS_FLAME = { ...FLAME_PUFF, radius: 1 };

// ---- shaders ---------------------------------------------------------------------------

const NOISE = /* glsl */ `
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
`;

/** An instanced flat disc: its instance colour carries its parameters. */
const DISC_VERT = /* glsl */ `
varying vec2 vXY;
varying vec3 vP;
void main() {
  vXY = position.xz;
  vP = instanceColor;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}
`;
/** Cracks of the first flame racing through the basalt round a rise spot
 *  (vP: spread, light, seed). */
const CRACK_FRAG = /* glsl */ `
uniform vec3 uLight;
varying vec2 vXY;
varying vec3 vP;
float hh(float p) { return fract(sin(p * 127.1) * 43758.5453); }
void main() {
  float r = length(vXY);
  if (r > 1.0) discard;
  float a = atan(vXY.y, vXY.x);
  float seed = vP.z * 91.0;
  float k = a / 6.28318 * 7.0 + seed;
  float id = floor(k);
  float wob = (hh(id + floor(r * 7.0)) - 0.5) * 0.4;
  float line = abs(fract(k) - 0.5 + wob * 0.4);
  float radial = 1.0 - smoothstep(0.0, 0.05 + 0.03 * (1.0 - r), line * (0.4 + r));
  radial *= step(r, vP.x * (0.7 + 0.3 * hh(id + 3.0)));
  // A hexagonal ring: the column joints the crystal breaks through.
  float hex = abs(cos(a * 3.0)) * 0.08;
  float ring = 1.0 - smoothstep(0.0, 0.035, abs(r - 0.42 - hex));
  float core = smoothstep(0.42, 0.0, r) * vP.y * 0.5;
  float c = max(max(radial, ring * step(0.25, vP.x)), core);
  gl_FragColor = vec4(uLight * (1.2 + vP.y * 1.4), c * (0.5 + 0.5 * vP.y));
  #include <colorspace_fragment>
}
`;
/** Knell Embers: a smouldering patch of the first flame, its rim the danger
 *  colour (vP: burn, seed, unused). */
const EMBERS_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uFire;
uniform vec3 uCore;
uniform vec3 uCrust;
uniform vec3 uRim;
varying vec2 vXY;
varying vec3 vP;
${NOISE}
void main() {
  float r = length(vXY);
  if (r > 1.0) discard;
  vec2 q = vXY * 3.0 + vec2(vP.y * 17.0);
  float boil = n(q + vec2(uTime * 0.6, -uTime * 0.4)) * 0.6 + n(q * 2.3 - vec2(uTime, uTime * 0.7)) * 0.4;
  float cracks = smoothstep(0.55, 0.85, n(q * 1.6 + vec2(0.0, uTime * 0.2)));
  vec3 col = mix(uCrust, uFire, smoothstep(0.35, 0.8, boil) * vP.x);
  col = mix(col, uCore, cracks * vP.x * 0.8);
  float rim = smoothstep(0.86, 0.94, r) * (1.0 - smoothstep(0.97, 1.0, r));
  col = mix(col, uRim, rim);
  float a = (1.0 - smoothstep(0.9, 1.0, r)) * (0.55 + 0.4 * vP.x) + rim * 0.9;
  gl_FragColor = vec4(col, clamp(a, 0.0, 0.95));
  #include <colorspace_fragment>
}
`;
/** A scorch glowing under a burned body (vP: heat, pulse, seed). */
const SCORCH_FRAG = /* glsl */ `
uniform vec3 uFire;
varying vec2 vXY;
varying vec3 vP;
void main() {
  float r = length(vXY);
  if (r > 1.0) discard;
  float glow = pow(1.0 - r, 1.8) * (vP.x + vP.y * 0.6);
  gl_FragColor = vec4(uFire * glow * 1.4, glow);
  #include <colorspace_fragment>
}
`;
/** The wind-up's heat over the whole floor (uniform strength): a warm wash
 *  beating white, ripples of heat racing out from the hall's middle, a
 *  shimmer in them (never a pattern that reads as a footprint). */
const FLOOR_FRAG = /* glsl */ `
uniform float uTime;
uniform float uStrength;
uniform vec3 uFire;
uniform vec3 uCore;
varying vec2 vXY;
varying vec3 vP;
${NOISE}
void main() {
  float r = length(vXY);
  if (r > 1.0 || uStrength <= 0.001) discard;
  float fall = 1.0 - smoothstep(0.6, 1.0, r);
  float shimmer = n(vXY * 9.0 + vec2(uTime * 0.9, -uTime * 0.6)) * 0.5 + 0.5;
  float ripple = pow(0.5 + 0.5 * sin(r * 26.0 - uTime * 7.0), 6.0) * (0.6 + 0.4 * shimmer);
  float wash = 0.35 + 0.25 * shimmer;
  vec3 col = mix(uFire, uCore, uStrength * 0.8);
  float a = (wash + ripple * 0.9) * uStrength * fall;
  gl_FragColor = vec4(col * a, a * 0.85);
  #include <colorspace_fragment>
}
`;
/** Hearthburst's white wave racing out over the floor (uniform alpha). */
const WAVE_FRAG = /* glsl */ `
uniform float uAlpha;
uniform vec3 uCore;
varying vec2 vXY;
varying vec3 vP;
void main() {
  float r = length(vXY);
  if (r > 1.0) discard;
  float band = smoothstep(0.7, 0.95, r) * (1.0 - smoothstep(0.95, 1.0, r));
  float inner = (1.0 - r) * 0.25;
  float a = (band + inner) * uAlpha;
  gl_FragColor = vec4(uCore * a * 1.6, a);
  #include <colorspace_fragment>
}
`;
/** The channel's bed and its fire (uv.y 0 at its head, the north wall). */
const CHANNEL_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const CHANNEL_FRAG = /* glsl */ `
uniform float uTime;
uniform float uBed;
uniform float uLit;
uniform float uFront;
uniform float uFire;
uniform float uLen;
uniform vec3 uCore;
uniform vec3 uGold;
uniform vec3 uDeep;
uniform vec3 uCrust;
varying vec2 vUv;
${NOISE}
void main() {
  float along = vUv.y;
  float across = abs(vUv.x - 0.5) * 2.0;
  float y = along * uLen;
  float rag = n(vec2(y * 0.6, vUv.x * 4.0)) * 0.12;
  if (across > 1.0 - rag) discard;
  // The bed: a dark glassy skin of the cooled pour, a seam of light down its
  // middle; lit from the head down while it brims.
  float seam = 1.0 - smoothstep(0.0, 0.18 + 0.1 * n(vec2(y * 0.8, 1.0)), across);
  float litMask = smoothstep(uLit, uLit - 0.04, along);
  float bedGlow = uBed * (0.25 + 0.75 * litMask);
  vec3 col = uCrust + uDeep * seam * bedGlow * 1.2 + uGold * seam * litMask * uLit * 0.8;
  float alpha = 0.55 + 0.35 * seam;
  // The fire: running down behind its front, rippling, white in its veins.
  if (uFire > 0.0 && along < uFront) {
    float rip = n(vec2(y * 0.45 - uTime * 5.0, vUv.x * 5.0)) * 0.6 + n(vec2(y * 1.3 - uTime * 8.0, vUv.x * 11.0)) * 0.4;
    vec3 hot = mix(uDeep, uGold, smoothstep(0.2, 0.75, rip));
    hot = mix(hot, uCore, smoothstep(0.7, 0.92, rip) * (1.0 - across) * 0.9);
    float lead = smoothstep(uFront - 0.05, uFront, along) * step(uFront, 0.995);
    hot += uCore * lead * 0.8;
    col = mix(col, hot * 1.25, uFire);
    alpha = mix(alpha, 0.95, uFire);
  }
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}
`;
/** A ray's beam: a cylinder from the crystal to its target, white at its
 *  heart, gold at its skin, the fire racing along it. */
const BEAM_VERT = /* glsl */ `
varying vec2 vUv;
varying float vFace;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 nrm = normalize(mat3(modelMatrix) * normal);
  vFace = abs(dot(nrm, normalize(cameraPosition - wp.xyz)));
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const BEAM_FRAG = /* glsl */ `
uniform float uTime;
uniform float uAlpha;
uniform float uBack;
uniform vec3 uCore;
uniform vec3 uGold;
uniform vec3 uDeep;
varying vec2 vUv;
varying float vFace;
${NOISE}
void main() {
  float run = n(vec2(vUv.y * 9.0 - uTime * 14.0 * (1.0 - 2.0 * uBack), vUv.x * 6.0));
  // A white-hot core inside a softer gold sheath (the face toward the eye
  // is the beam's middle).
  float core = pow(vFace, 6.0);
  float sheath = pow(vFace, 1.4);
  vec3 col = mix(mix(uGold, uDeep, uBack), uCore, core * (0.75 + 0.25 * run));
  float a = (0.15 + 0.55 * sheath + 0.6 * core) * (0.8 + 0.2 * run) * uAlpha;
  gl_FragColor = vec4(col * a * 3.2, min(1.0, a));
  #include <colorspace_fragment>
}
`;
/** Crystal Burn's flames climbing a body (vP: cover, heat, seed). */
const BURN_VERT = /* glsl */ `
varying vec2 vUv;
varying vec3 vP;
varying float vFace;
void main() {
  vUv = uv;
  vP = instanceColor;
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vec3 nrm = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vFace = abs(dot(nrm, normalize(cameraPosition - wp.xyz)));
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;
const BURN_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uFire;
uniform vec3 uCore;
uniform vec3 uDeep;
varying vec2 vUv;
varying vec3 vP;
varying float vFace;
${NOISE}
void main() {
  float seed = vP.z * 31.0;
  vec2 q = vec2(vUv.x * 9.0 + seed, vUv.y * 4.0 - uTime * 2.6);
  float tongues = n(q) * 0.65 + n(q * 2.2 + vec2(0.0, -uTime * 1.5)) * 0.35;
  float top = vP.x * (0.8 + 0.35 * tongues);
  if (vUv.y > top) discard;
  float lick = smoothstep(top, top - 0.18, vUv.y);
  vec3 col = mix(uDeep, uFire, tongues);
  col = mix(col, uCore, smoothstep(0.65, 0.9, tongues) * vP.y);
  float a = lick * (0.35 + 0.55 * tongues) * (0.4 + 0.6 * vP.y) * (0.5 + 0.5 * vFace);
  gl_FragColor = vec4(col * a * 1.5, a);
  #include <colorspace_fragment>
}
`;

// ---- the slots ------------------------------------------------------------------------

interface FanSlot {
  fan: TelegraphFan;
  id: number;
  born: number;
}

interface CrystalSlot {
  id: number;
  born: number;
  life: number;
  holder: THREE.Group;
  /** The stand-in prisms (the kit's cluster replaces them when it lands). */
  standIn: THREE.Group;
  kit: THREE.Group | null;
  mat: THREE.ShaderMaterial;
  halo: THREE.Sprite;
  reach: FanSlot;
  x: number;
  z: number;
}

interface BeamSlot {
  crystalId: number;
  targetId: number;
  at: number;
  back: boolean;
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  impact: THREE.Sprite;
}

interface ObjectSlot {
  id: number;
  born: number;
}

function slotFor<S extends { id: number }>(pool: S[], id: number): S | null {
  for (const s of pool) if (s.id === id) return s;
  for (const s of pool) if (s.id < 0) return s;
  return null;
}

export class HeatFightFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly detail: boolean;
  private readonly density: number;
  private readonly particles: EngineParticles;
  private readonly kit: TelegraphKit;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly audio = new HeatAudio(sfx);
  private readonly compileGate?: (target: THREE.Object3D) => Promise<unknown>;
  private readonly glowTex: THREE.Texture | null;
  // The footprints (every tier).
  private readonly riseFans: FanSlot[] = [];
  private readonly crystals: CrystalSlot[] = [];
  private readonly lane: TelegraphLane;
  /** The channel object the lane was last draped for (it never moves). */
  private lanedFor = -1;
  // The instanced pools.
  private readonly cracks: THREE.InstancedMesh;
  private readonly embers: THREE.InstancedMesh;
  private readonly emberSlots: ObjectSlot[] = [];
  private readonly scorches: THREE.InstancedMesh;
  private readonly burns: THREE.InstancedMesh;
  private readonly beams: BeamSlot[] = [];
  // The channel, the floor's heat, Hearthburst's wave.
  private readonly channel: THREE.Mesh;
  private readonly channelMat: THREE.ShaderMaterial;
  private readonly floor: THREE.Mesh;
  private readonly floorMat: THREE.ShaderMaterial;
  private readonly wave: THREE.Mesh;
  private readonly waveMat: THREE.ShaderMaterial;
  private channelId = -1;
  private channelState: HeatChannelState | null = null;
  private channelBorn = 0;
  private waveAt = -99;
  private kitBuilt = false;
  // The scan's findings (ids, reused arrays).
  private readonly candidateIds: number[] = [];
  private readonly objectIds: number[] = [];
  private readonly burnIds: number[] = [];
  private guardianId = -1;
  private rosterSeen = Number.NaN;
  private origin: { x: number; z: number } | null = null;
  private readonly lookup = (id: number): Entity | undefined => this.world?.entities.get(id);
  private readonly groundAt = (x: number, z: number): number => this.groundY(x, z);
  private scanTimer = 0;
  private clock = 0;
  private seed = 0x6a21;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
  ) {
    this.compileGate = compileGate;
    this.root.name = 'smith-heart-heat-fight-fx';
    setRenderCategory(this.root, 'ui3d');
    this.detail =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    this.density = this.detail ? 1 : 0.35;
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
    this.kit = new TelegraphKit(this.root, this.detail);
    for (let i = 0; i < P.rises; i++) {
      const fan = this.kit.fan(8);
      this.kit.layOutFan(fan, 360, { color: C.danger, accent: C.accent });
      fan.group.visible = false;
      this.riseFans.push({ fan, id: -1, born: 0 });
    }
    this.lane = this.kit.lane(10);
    this.lane.group.visible = false;

    const glowTex = hasDom ? radialGlowTexture() : null;
    this.glowTex = glowTex;
    const sprite = (color: number, name: string) => {
      const m = new THREE.SpriteMaterial({
        map: glowTex,
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        name,
      });
      this.materials.push(m);
      return m;
    };

    // ---- the crystals: a stand-in cluster of prisms on column stumps ----
    const prism = new THREE.CylinderGeometry(0.32, 0.38, 1, 6, 1).translate(0, 0.5, 0);
    const tip = new THREE.ConeGeometry(0.32, 0.55, 6, 1).translate(0, 1.27, 0);
    const stump = new THREE.CylinderGeometry(0.55, 0.62, 0.7, 6, 1).translate(0, 0.35, 0);
    for (const g of [prism, tip, stump]) {
      const pos = g.getAttribute('position') as THREE.BufferAttribute;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const k = Math.min(1, Math.max(0, pos.getY(i) / 1.5));
        const shade = g === stump ? 0.55 + 0.3 * k : 0.6 + 0.4 * k;
        col.set([shade, shade, shade], i * 3);
      }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      this.geometries.push(g);
    }
    const stoneMat = heartKitSlotMaterial('stone');
    const carrierGeo = new THREE.BufferGeometry();
    carrierGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    carrierGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(1), 3));
    this.geometries.push(carrierGeo);
    for (let i = 0; i < P.crystals; i++) {
      const mat = heartVeinGlowMaterial(0xffd27a, 'smithHeartHeatKindledCrystal');
      this.materials.push(mat);
      const carrier = new THREE.Mesh(carrierGeo, mat);
      carrier.visible = false;
      carrier.frustumCulled = false;
      this.root.add(carrier);
      const holder = new THREE.Group();
      holder.name = 'smithHeartHeatCrystal';
      holder.visible = false;
      const standIn = new THREE.Group();
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + heatFightHash(i, k) * 0.6;
        const r = k === 0 ? 0 : 0.55 + heatFightHash(i, k + 9) * 0.35;
        const tall = k === 0 ? 4.0 : 1.8 + heatFightHash(i, k + 17) * 1.6;
        const lean = k === 0 ? 0 : 0.25 + heatFightHash(i, k + 23) * 0.25;
        const p = new THREE.Group();
        p.position.set(Math.sin(a) * r, 0.35, Math.cos(a) * r);
        p.rotation.set(Math.cos(a) * lean, 0, -Math.sin(a) * lean);
        p.scale.set(k === 0 ? 1.3 : 0.9, tall, k === 0 ? 1.3 : 0.9);
        const body = new THREE.Mesh(prism, mat);
        const point = new THREE.Mesh(tip, mat);
        p.add(body, point);
        standIn.add(p);
      }
      for (let k = 0; k < 4; k++) {
        const a = (k / 4) * Math.PI * 2 + 0.4;
        const s = new THREE.Mesh(stump, stoneMat);
        s.position.set(Math.sin(a) * 0.9, 0, Math.cos(a) * 0.9);
        s.scale.set(1, 0.6 + heatFightHash(i, k + 31) * 0.6, 1);
        s.castShadow = true;
        standIn.add(s);
      }
      holder.add(standIn);
      const halo = new THREE.Sprite(sprite(0xffd27a, 'smithHeartHeatCrystalHalo'));
      halo.position.set(0, 2.8, 0);
      halo.scale.set(6, 6, 1);
      holder.add(halo);
      this.root.add(holder);
      const fan = this.kit.fan(6);
      this.kit.layOutFan(fan, 360, { color: C.soak, accent: C.soakEdge });
      fan.group.visible = false;
      this.crystals.push({
        id: -1,
        born: 0,
        life: T.crystalLife,
        holder,
        standIn,
        kit: null,
        mat,
        halo,
        reach: { fan, id: -1, born: 0 },
        x: 0,
        z: 0,
      });
    }

    // ---- the rays ----
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).translate(0, 0.5, 0);
    this.geometries.push(beamGeo);
    for (let i = 0; i < P.beams; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'smithHeartHeatRay',
        uniforms: {
          uTime: this.uTime,
          uAlpha: { value: 0 },
          uBack: { value: 0 },
          uCore: { value: new THREE.Color(...C.core) },
          uGold: { value: new THREE.Color(...C.fire) },
          uDeep: { value: new THREE.Color(...C.back) },
        },
        vertexShader: BEAM_VERT,
        fragmentShader: BEAM_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(beamGeo, mat);
      mesh.name = 'smithHeartHeatRay';
      mesh.frustumCulled = false;
      mesh.visible = false;
      this.root.add(mesh);
      const impact = new THREE.Sprite(sprite(0xfff2d0, 'smithHeartHeatRayImpact'));
      impact.visible = false;
      this.root.add(impact);
      this.beams.push({ crystalId: -1, targetId: -1, at: -99, back: false, mesh, mat, impact });
    }

    // ---- the instanced floor discs ----
    const disc = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
    this.geometries.push(disc);
    const discMat = (
      name: string,
      frag: string,
      uniforms: Record<string, THREE.IUniform>,
      additive: boolean,
    ) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: { uTime: this.uTime, ...uniforms },
        vertexShader: DISC_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        ...(additive ? { blending: THREE.AdditiveBlending } : {}),
      });
      this.materials.push(m);
      return m;
    };
    const instanced = (
      geo: THREE.BufferGeometry,
      mat: THREE.Material,
      n: number,
      name: string,
      order: number,
    ) => {
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      mesh.name = name;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < n; i++) {
        mesh.setMatrixAt(i, _zero);
        mesh.setColorAt(i, _c.setRGB(0, 0, 0));
      }
      if (mesh.instanceColor) mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      mesh.renderOrder = floorVfxRenderOrder('encounter', order);
      mesh.castShadow = false;
      mesh.receiveShadow = false;
      mesh.visible = false;
      this.root.add(mesh);
      return mesh;
    };
    this.cracks = instanced(
      disc,
      discMat(
        'smithHeartHeatRiseCracks',
        CRACK_FRAG,
        { uLight: { value: new THREE.Color(...C.fire) } },
        true,
      ),
      P.rises,
      'smithHeartHeatRiseCracks',
      9,
    );
    this.embers = instanced(
      disc,
      discMat(
        'smithHeartHeatKnellEmbers',
        EMBERS_FRAG,
        {
          uFire: { value: new THREE.Color(...C.fire) },
          uCore: { value: new THREE.Color(...C.core) },
          uCrust: { value: new THREE.Color(...C.crust) },
          uRim: { value: new THREE.Color(C.danger) },
        },
        false,
      ),
      P.embers,
      'smithHeartHeatKnellEmbers',
      4,
    );
    for (let i = 0; i < P.embers; i++) this.emberSlots.push({ id: -1, born: 0 });
    this.scorches = instanced(
      disc,
      discMat(
        'smithHeartHeatScorch',
        SCORCH_FRAG,
        { uFire: { value: new THREE.Color(...C.ember) } },
        true,
      ),
      P.bodies,
      'smithHeartHeatScorches',
      5,
    );
    const sheathGeo = new THREE.CylinderGeometry(0.62, 0.5, 2.2, 16, 4, true).translate(0, 1.1, 0);
    this.geometries.push(sheathGeo);
    const burnMat = new THREE.ShaderMaterial({
      name: 'smithHeartHeatBurn',
      uniforms: {
        uTime: this.uTime,
        uFire: { value: new THREE.Color(...C.fire) },
        uCore: { value: new THREE.Color(...C.core) },
        uDeep: { value: new THREE.Color(...C.deep) },
      },
      vertexShader: BURN_VERT,
      fragmentShader: BURN_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    this.materials.push(burnMat);
    this.burns = instanced(sheathGeo, burnMat, P.bodies, 'smithHeartHeatBurns', 0);
    // The sheaths ride the bodies, not the floor: back to the default order 0
    // that instanced() replaced with the encounter band.
    this.burns.renderOrder = 0;

    // ---- the channel's bed and fire ----
    const len = CHANNEL_LINE.length;
    const width = T.channelHalf * 2 + 0.6;
    const chGeo = new THREE.PlaneGeometry(width, len, 1, 1).rotateX(-Math.PI / 2);
    // uv.y 0 at the head (the north wall, +z): the plane's v runs -z to +z,
    // so flip it.
    const uv = chGeo.getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - uv.getY(i));
    this.geometries.push(chGeo);
    this.channelMat = new THREE.ShaderMaterial({
      name: 'smithHeartHeatChannel',
      uniforms: {
        uTime: this.uTime,
        uBed: { value: 0.3 },
        uLit: { value: 0 },
        uFront: { value: 0 },
        uFire: { value: 0 },
        uLen: { value: len },
        uCore: { value: new THREE.Color(...C.core) },
        uGold: { value: new THREE.Color(...C.fire) },
        uDeep: { value: new THREE.Color(...C.deep) },
        uCrust: { value: new THREE.Color(...C.crust) },
      },
      vertexShader: CHANNEL_VERT,
      fragmentShader: CHANNEL_FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.materials.push(this.channelMat);
    this.channel = new THREE.Mesh(chGeo, this.channelMat);
    this.channel.name = 'smithHeartHeatChannel';
    this.channel.renderOrder = floorVfxRenderOrder('encounter', 2);
    this.channel.frustumCulled = false;
    this.channel.visible = false;
    this.root.add(this.channel);

    // ---- the floor's heat, Hearthburst's wave ----
    const big = new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2);
    this.geometries.push(big);
    const flat = (name: string, frag: string, uniforms: Record<string, THREE.IUniform>) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: { uTime: this.uTime, ...uniforms },
        vertexShader: /* glsl */ `
varying vec2 vXY;
varying vec3 vP;
void main() {
  vXY = position.xz;
  vP = vec3(0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
      });
      this.materials.push(m);
      return m;
    };
    this.floorMat = flat('smithHeartHeatFloorGlow', FLOOR_FRAG, {
      uStrength: { value: 0 },
      uFire: { value: new THREE.Color(...C.fire) },
      uCore: { value: new THREE.Color(...C.core) },
    });
    this.floor = new THREE.Mesh(big, this.floorMat);
    this.floor.name = 'smithHeartHeatFloorGlow';
    this.floor.renderOrder = floorVfxRenderOrder('encounter', 1);
    this.floor.frustumCulled = false;
    this.floor.visible = false;
    this.root.add(this.floor);
    this.waveMat = flat('smithHeartHeatBurstWave', WAVE_FRAG, {
      uAlpha: { value: 0 },
      uCore: { value: new THREE.Color(...C.core) },
    });
    this.wave = new THREE.Mesh(big, this.waveMat);
    this.wave.name = 'smithHeartHeatBurstWave';
    this.wave.renderOrder = floorVfxRenderOrder('encounter', 12);
    this.wave.frustumCulled = false;
    this.wave.visible = false;
    this.root.add(this.wave);

    this.root.add(heartKitProgramWarmers());
    const kitIn = heartKitLoaded(HEAT_KIT_URL);
    if (kitIn) this.fitKits(null);
    this.kitBuilt = kitIn;
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
    if (!kitIn && hasDom)
      void ensureHeartKit(HEAT_KIT_URL)
        .then(() => {
          if (!this.disposed && heartKitLoaded(HEAT_KIT_URL)) this.upgradeKit();
        })
        .catch(() => {});
  }

  /** Each crystal slot's cluster from the Heat kit (its scenery's own fire
   *  crystal, A tall and B broad by turns), its glow slot this slot's light. */
  private fitKits(staging: THREE.Group | null): (THREE.Group | null)[] {
    const out: (THREE.Group | null)[] = [];
    for (let i = 0; i < this.crystals.length; i++) {
      const slot = this.crystals[i];
      const kit = heartKitMeshes(
        HEAT_KIT_URL,
        i % 2 === 0 ? 'Kit_FireCrystalA' : 'Kit_FireCrystalB',
      );
      if (!kit) {
        out.push(null);
        continue;
      }
      for (const m of kit.children)
        if (m instanceof THREE.Mesh && m.name.endsWith(':glow')) m.material = slot.mat;
      _box.setFromObject(kit);
      _box.getSize(_size);
      _box.getCenter(_centre);
      // About five and a half yards tall (three players), on its bed.
      const s = 5.5 / Math.max(1e-3, _size.y);
      kit.scale.setScalar(s);
      kit.position.set(-_centre.x * s, -_box.min.y * s, -_centre.z * s);
      const content = new THREE.Group();
      content.name = 'smithHeartHeatCrystalKit';
      content.add(kit);
      out.push(content);
      if (staging) staging.add(content);
      else this.swapKit(slot, content);
    }
    return out;
  }

  private swapKit(slot: CrystalSlot, content: THREE.Group): void {
    slot.standIn.visible = false;
    slot.kit = content;
    slot.holder.add(content);
  }

  /** The kit landed after the painter was built: fit the clusters into one
   *  hidden staging group, link it through the compile gate, then swap. */
  private upgradeKit(): void {
    if (this.kitBuilt || this.disposed) return;
    this.kitBuilt = true;
    const staging = new THREE.Group();
    staging.name = 'smithHeartHeatCrystalStaging';
    staging.visible = false;
    const fitted = this.fitKits(staging);
    this.root.add(staging);
    const linked = this.compileGate ? this.compileGate(staging).catch(() => {}) : Promise.resolve();
    void linked.then(() => {
      staging.removeFromParent();
      if (this.disposed) return;
      for (let i = 0; i < this.crystals.length; i++) {
        const content = fitted[i];
        if (content) this.swapKit(this.crystals[i], content);
      }
    });
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  private shakeNear(x: number, z: number, amount: number, reach = 45): void {
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
    this.audio.event(ev, this.lookup, this.groundAt);
    if (ev.type === 'spellfxAt') {
      if (!heatFightClaims(ev.ability)) return false;
      const r = ev.radius ?? 2;
      if (ev.ability === HEAT_CUES.rise) this.riseBurst(ev.x, ev.z);
      else if (ev.ability === HEAT_CUES.fade) this.fadeBurst(ev.x, ev.z, r);
      else if (ev.ability === HEAT_CUES.flow) this.flowBurst(ev.x, ev.z);
      else if (ev.ability === HEAT_CUES.embers) this.embersBurst(ev.x, ev.z, r);
      return true;
    }
    if (ev.type !== 'spellfx' || !heatFightClaims(ev.ability)) return false;
    const src = this.world.entities.get(ev.sourceId);
    if (ev.ability === HEAT_CUES.beam || ev.ability === HEAT_CUES.beamBack)
      this.ray(ev.sourceId, ev.targetId, ev.ability === HEAT_CUES.beamBack);
    else if (ev.ability === HEAT_CUES.pulse && src) this.pulse(src);
    else if (ev.ability === HEAT_CUES.overheat && src) this.burst(src);
    else if (ev.ability === HEAT_CUES.windup && src)
      this.particles.shockRing(src.pos.x, src.pos.z, C.white, 24, 0.9);
    else if (ev.ability === HEAT_CUES.stoke && src) {
      this.particles.shockRing(src.pos.x, src.pos.z, C.ringGold, 14, 0.9);
      this.particles.puff(src.pos.x, src.pos.y + 3, src.pos.z, 18, { ...SPARK_PUFF, radius: 2 });
    } else if (ev.ability === HEAT_CUES.settle && src)
      this.particles.shockRing(src.pos.x, src.pos.z, C.ringGold, 30, 1.6);
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
      this.audio.update(null, null, 0);
      this.particles.update(this.clock);
      return;
    }
    const guardian = this.guardianId >= 0 ? (world.entities.get(this.guardianId) ?? null) : null;
    this.paintRises(world);
    this.paintCrystals(world, dt);
    this.paintBeams(world);
    this.paintChannel(world);
    this.paintEmbers(world, dt);
    this.paintBurns(world, dt);
    this.paintHeat(guardian, dt);
    this.particles.update(this.clock);
    const me = world.entities.get(world.playerId) ?? null;
    let burn = 0;
    if (me) for (const a of me.auras) if (a.id === HEAT_AURAS.burn) burn = a.stacks ?? 1;
    this.audio.update(guardian, me, burn);
  }

  // ---- the scan -------------------------------------------------------------------------

  private scan(world: IWorld): void {
    const me = world.entities.get(world.playerId);
    const origin = me ? heatClaimOrigin(me.pos.x, me.pos.z) : null;
    const near =
      origin !== null &&
      me !== undefined &&
      Math.hypot(me.pos.x - origin.x - HEARTH_CENTRE.x, me.pos.z - origin.z - HEARTH_CENTRE.z) <
        HEAT_FIGHT_REACH + 40;
    if (!near || !origin) {
      if (this.origin) this.leave();
      return;
    }
    if (!this.origin || this.origin.x !== origin.x || this.origin.z !== origin.z) {
      this.origin = origin;
      this.rosterSeen = Number.NaN;
    }
    if (world.entityRosterVersion !== this.rosterSeen) {
      this.rosterSeen = world.entityRosterVersion;
      this.discover(world, origin);
    }
    this.objectIds.length = 0;
    this.burnIds.length = 0;
    this.guardianId = -1;
    for (let i = 0; i < this.candidateIds.length; i++) {
      const e = world.entities.get(this.candidateIds[i]);
      if (!e) continue;
      if (e.kind === 'object') {
        if (heatObjectKind(e.templateId)) this.objectIds.push(e.id);
      } else if (e.kind === 'mob') {
        this.guardianId = e.id;
      } else if (e.kind === 'player' && !e.dead) {
        if (Math.abs(e.pos.x - origin.x) > 300 || Math.abs(e.pos.z - origin.z) > 260) continue;
        if (this.burnIds.length >= P.bodies) continue;
        for (const a of e.auras)
          if (a.id === HEAT_AURAS.burn) {
            this.burnIds.push(e.id);
            break;
          }
      }
    }
    this.assign(world);
  }

  private discover(world: IWorld, origin: { x: number; z: number }): void {
    const ids = this.candidateIds;
    ids.length = 0;
    for (const e of world.entities.values()) {
      if (e.kind === 'player') {
        ids.push(e.id);
        continue;
      }
      if (Math.abs(e.pos.x - origin.x) > 300 || Math.abs(e.pos.z - origin.z) > 260) continue;
      if (e.kind === 'object' || (e.kind === 'mob' && e.templateId === HEAT_GUARDIAN))
        ids.push(e.id);
    }
  }

  /** Every fight object to its slot (released when gone). */
  private assign(world: IWorld): void {
    const live = this.objectIds;
    for (const s of this.riseFans)
      if (s.id >= 0 && !live.includes(s.id)) {
        s.id = -1;
        s.fan.group.visible = false;
      }
    for (const s of this.crystals)
      if (s.id >= 0 && !live.includes(s.id)) {
        s.id = -1;
        s.holder.visible = false;
        s.reach.fan.group.visible = false;
      }
    for (const s of this.emberSlots) if (s.id >= 0 && !live.includes(s.id)) s.id = -1;
    if (this.channelId >= 0 && !live.includes(this.channelId)) {
      this.channelId = -1;
      this.channelState = null;
      this.channel.visible = false;
      this.lane.group.visible = false;
    }
    for (const id of live) {
      const e = world.entities.get(id);
      if (!e) continue;
      const kind = heatObjectKind(e.templateId);
      if (kind === 'rise') {
        const slot = slotFor(this.riseFans, id);
        if (slot && slot.id !== id) {
          slot.id = id;
          slot.born = this.clock;
          slot.fan.group.visible = true;
          const y = this.groundY(e.pos.x, e.pos.z);
          this.kit.drapeFan(slot.fan, this.groundY, e.pos.x, y, e.pos.z, 0, e.scale || T.crystalR);
        }
      } else if (kind === 'crystal') {
        const slot = slotFor(this.crystals, id);
        if (slot && slot.id !== id) {
          slot.id = id;
          slot.born = this.clock;
          slot.life = crystalOf(e.templateId) ?? T.crystalLife;
          slot.x = e.pos.x;
          slot.z = e.pos.z;
          slot.holder.visible = true;
          slot.holder.rotation.y = heatFightHash(id, 5) * Math.PI * 2;
          slot.reach.fan.group.visible = true;
          const y = this.groundY(e.pos.x, e.pos.z);
          this.kit.drapeFan(slot.reach.fan, this.groundY, e.pos.x, y, e.pos.z, 0, T.rayRange);
        }
      } else if (kind === 'embers') {
        const slot = slotFor(this.emberSlots, id);
        if (slot && slot.id !== id) {
          slot.id = id;
          slot.born = this.clock;
        }
      } else if (kind === 'channel') {
        const of = channelOf(e.templateId);
        if (!of) continue;
        if (this.channelId !== id || this.channelState !== of.state) {
          const brims = this.channelId === id && of.state === 'warn';
          this.channelId = id;
          this.channelState = of.state;
          this.channelBorn = this.clock;
          this.channel.visible = true;
          if (brims)
            this.audio.brim(
              e.pos.x,
              this.groundY(e.pos.x, e.pos.z),
              e.pos.z + CHANNEL_LINE.length / 2,
            );
        }
      }
    }
  }

  private leave(): void {
    this.origin = null;
    this.rosterSeen = Number.NaN;
    this.candidateIds.length = 0;
    for (const s of this.riseFans) {
      s.id = -1;
      s.fan.group.visible = false;
    }
    for (const s of this.crystals) {
      s.id = -1;
      s.holder.visible = false;
      s.reach.fan.group.visible = false;
    }
    for (const s of this.emberSlots) s.id = -1;
    for (const b of this.beams) {
      b.crystalId = -1;
      b.mesh.visible = false;
      b.impact.visible = false;
    }
    this.channelId = -1;
    this.channelState = null;
    this.channel.visible = false;
    this.lane.group.visible = false;
    this.floor.visible = false;
    this.wave.visible = false;
    for (const mesh of [this.cracks, this.embers, this.scorches, this.burns]) {
      for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, _zero);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = false;
    }
  }

  // ---- the crystals ---------------------------------------------------------------------

  private paintRises(world: IWorld): void {
    let n = 0;
    for (const s of this.riseFans) {
      const e = s.id >= 0 ? world.entities.get(s.id) : undefined;
      if (!e) continue;
      const seconds = riseOf(e.templateId) ?? T.shedCast;
      const look = riseLook(this.clock - s.born, seconds, _rise);
      const r = e.scale > 0 ? e.scale : T.crystalR;
      FAN_PAINT.fill = look.fill;
      FAN_PAINT.clock = this.clock;
      FAN_PAINT.range = r;
      this.kit.paintFan(s.fan, FAN_PAINT);
      _v.set(e.pos.x, this.groundY(e.pos.x, e.pos.z) + 0.06, e.pos.z);
      _s.set(r * 1.7, 1, r * 1.7);
      this.cracks.setMatrixAt(n, _m.compose(_v, _q.identity(), _s));
      this.cracks.setColorAt(n, _c.setRGB(look.crack, look.fill, heatFightHash(e.id, 3)));
      n++;
      if (this.rand() < 0.15 * this.density * (0.3 + look.fill))
        this.particles.puff(_v.x, _v.y + 0.2, _v.z, 1, EMBER_PUFF);
    }
    for (let i = n; i < P.rises; i++) this.cracks.setMatrixAt(i, _zero);
    this.cracks.instanceMatrix.needsUpdate = true;
    if (this.cracks.instanceColor) this.cracks.instanceColor.needsUpdate = true;
    this.cracks.visible = n > 0;
  }

  private paintCrystals(world: IWorld, dt: number): void {
    for (const s of this.crystals) {
      if (s.id < 0) continue;
      const e = world.entities.get(s.id);
      if (!e) continue;
      const age = this.clock - s.born;
      const look = crystalLook(age, s.life, _crystal);
      const y = this.groundY(e.pos.x, e.pos.z);
      const sink = (1 - look.rise) * CRYSTAL_SUNK;
      const shake = look.rise < 1 ? (this.rand() - 0.5) * 0.15 : 0;
      s.holder.position.set(e.pos.x + shake, y - sink, e.pos.z + shake);
      const grow = 0.6 + 0.4 * look.rise;
      s.holder.scale.setScalar(grow);
      (s.mat.uniforms.uColor.value as THREE.Color)
        .setRGB(C.fire[0], C.fire[1], C.fire[2])
        .lerp(_c.setRGB(C.core[0], C.core[1], C.core[2]), Math.min(1, look.charge * 0.8))
        .multiplyScalar(0.9 + 1.4 * look.light);
      const haloMat = s.halo.material as THREE.SpriteMaterial;
      haloMat.opacity = Math.min(0.85, 0.2 + 0.45 * look.light);
      const hs = 5 + 3 * look.charge * look.charge;
      s.halo.scale.set(hs, hs, 1);
      // The reach: the soak's gold at the ray's exact range, filling to the
      // next ray (every tier).
      FAN_PAINT.fill = 0.08 + 0.5 * look.charge;
      FAN_PAINT.clock = this.clock;
      FAN_PAINT.range = T.rayRange;
      this.kit.paintFan(s.reach.fan, FAN_PAINT);
      // Sparks and the first flame's tongues off it (cosmetic).
      if (look.rise >= 1 && this.rand() < dt * 9 * this.density)
        this.particles.puff(
          e.pos.x + (this.rand() - 0.5) * 1.6,
          y + 1 + this.rand() * 2.5,
          e.pos.z + (this.rand() - 0.5) * 1.6,
          1,
          EMBER_PUFF,
        );
    }
  }

  /** A ray struck (or went back): its beam from the crystal held on the
   *  target until the next ray. */
  private ray(crystalId: number, targetId: number, back: boolean): void {
    let slot: BeamSlot | null = null;
    for (const b of this.beams) if (b.crystalId === crystalId) slot = b;
    if (!slot) for (const b of this.beams) if (b.crystalId < 0) slot = b;
    if (!slot) {
      slot = this.beams[0];
      for (const b of this.beams) if (b.at < slot.at) slot = b;
    }
    slot.crystalId = crystalId;
    slot.targetId = targetId;
    slot.at = this.clock;
    slot.back = back;
    const dst = this.world?.entities.get(targetId);
    if (dst) {
      const y = dst.pos.y + (back ? 4 : BODY_CHEST);
      this.particles.puff(dst.pos.x, y, dst.pos.z, back ? 16 : 10, SPARK_PUFF);
      if (back) this.particles.shockRing(dst.pos.x, dst.pos.z, C.ringGold, 6, 0.6);
    }
  }

  private paintBeams(world: IWorld): void {
    for (const b of this.beams) {
      if (b.crystalId < 0) continue;
      const since = this.clock - b.at;
      const src = world.entities.get(b.crystalId);
      const dst = world.entities.get(b.targetId);
      const look = beamLook(since, b.back, _beam);
      if (!src || !dst || dst.dead || look.alpha <= 0.01 || since > BEAM_HOLD + 0.2) {
        b.crystalId = -1;
        b.mesh.visible = false;
        b.impact.visible = false;
        continue;
      }
      _v.set(src.pos.x, this.groundY(src.pos.x, src.pos.z) + CRYSTAL_TIP, src.pos.z);
      _w.set(dst.pos.x, dst.pos.y + (b.back ? 4 : BODY_CHEST), dst.pos.z);
      _s.subVectors(_w, _v);
      const len = _s.length();
      if (len < 0.1) continue;
      _q.setFromUnitVectors(_up, _s.divideScalar(len));
      b.mesh.position.copy(_v);
      b.mesh.quaternion.copy(_q);
      b.mesh.scale.set(look.width, len, look.width);
      b.mat.uniforms.uAlpha.value = look.alpha;
      b.mat.uniforms.uBack.value = b.back ? 1 : 0;
      b.mesh.visible = true;
      b.impact.position.copy(_w);
      const is = 1.4 + look.width * 3;
      b.impact.scale.set(is, is, 1);
      (b.impact.material as THREE.SpriteMaterial).opacity = Math.min(0.95, look.alpha);
      b.impact.visible = true;
    }
  }

  private riseBurst(x: number, z: number): void {
    const y = this.groundY(x, z);
    this.particles.puff(x, y + 0.4, z, 22, { ...SPARK_PUFF, speed: 8, up: 6, radius: 1.2 });
    this.particles.puff(x, y + 0.3, z, 8, {
      speed: 2,
      up: 1.5,
      life: 1.2,
      size: [0.8, 2.2],
      color: C.smoke,
      alpha: 0.4,
      drag: 1.2,
      radius: 1.4,
    });
    this.particles.shockRing(x, z, C.ringGold, 4, 0.6);
    this.shakeNear(x, z, 0.25, 25);
  }

  private fadeBurst(x: number, z: number, r: number): void {
    const y = this.groundY(x, z);
    this.particles.puff(x, y + 1.6, z, 26, {
      speed: 7,
      up: 2,
      life: 0.8,
      size: [0.35, 0.08],
      color: C.core,
      alpha: 1,
      pool: 'glow',
      gravity: 9,
      radius: r * 0.6,
    });
    this.particles.shockRing(x, z, C.ring, r * 2, 0.5);
  }

  // ---- the channel ----------------------------------------------------------------------

  private paintChannel(world: IWorld): void {
    const e = this.channelId >= 0 ? world.entities.get(this.channelId) : undefined;
    const of = e ? channelOf(e.templateId) : null;
    if (!e || !of) {
      this.channel.visible = false;
      this.lane.group.visible = false;
      return;
    }
    const look = channelLook(of.state, this.clock - this.channelBorn, of.seconds, _channel);
    const y = this.groundY(e.pos.x, e.pos.z);
    this.channel.position.set(e.pos.x, y + 0.05, e.pos.z);
    const u = this.channelMat.uniforms;
    u.uBed.value = look.bed;
    u.uLit.value = look.lit;
    u.uFront.value = look.front;
    u.uFire.value = look.fire;
    this.channel.visible = true;
    const half = e.scale > 0 ? e.scale : T.channelHalf;
    if (look.lane) {
      // From its head (the north wall) down to the south lip.
      // The channel never moves: its lane is draped once per channel.
      if (this.lanedFor !== e.id) {
        this.lanedFor = e.id;
        const hz = e.pos.z + CHANNEL_LINE.length / 2;
        this.kit.drapeLane(
          this.lane,
          this.groundY,
          e.pos.x,
          this.groundY(e.pos.x, hz),
          hz,
          Math.PI,
          CHANNEL_LINE.length,
          half,
          CHANNEL_STYLE,
        );
      }
      LANE_PAINT.fill = look.fill;
      LANE_PAINT.clock = this.clock;
      LANE_PAINT.range = CHANNEL_LINE.length;
      const flowing = of.state === 'flow';
      LANE_PAINT.fade = flowing ? 0.55 + 0.45 * look.fire : undefined;
      LANE_PAINT.front = flowing ? 0 : undefined;
      this.kit.paintLane(this.lane, LANE_PAINT);
      this.lane.group.visible = true;
    } else this.lane.group.visible = false;
    if (of.state === 'flow' && look.fire > 0.1 && this.rand() < 0.9 * this.density) {
      // Flames licking up off the flowing fire (cosmetic).
      const t = this.rand() * look.front;
      const z = e.pos.z + CHANNEL_LINE.length / 2 - t * CHANNEL_LINE.length;
      this.particles.puff(e.pos.x + (this.rand() - 0.5) * half * 1.4, y + 0.3, z, 1, FLAME_PUFF);
    } else if (of.state === 'warn' && this.rand() < 0.4 * this.density) {
      const z = e.pos.z + CHANNEL_LINE.length / 2 - look.lit * CHANNEL_LINE.length;
      this.particles.puff(e.pos.x, y + 0.2, z, 1, EMBER_PUFF);
    }
  }

  private flowBurst(x: number, z: number): void {
    const y = this.groundY(x, z);
    this.particles.puff(x, y + 1.5, z, 30, { ...SPARK_PUFF, speed: 9, up: 5, radius: 2 });
    this.particles.puff(x, y + 0.5, z, 10, { ...FLAME_PUFF, radius: 2.5 });
    this.shakeNear(x, z, 0.35, 60);
  }

  // ---- Knell Embers ----------------------------------------------------------------------

  private paintEmbers(world: IWorld, dt: number): void {
    let n = 0;
    for (const s of this.emberSlots) {
      const e = s.id >= 0 ? world.entities.get(s.id) : undefined;
      if (!e) continue;
      const life = embersOf(e.templateId) ?? T.embersLife;
      const burn = embersLook(this.clock - s.born, life);
      const r = e.scale > 0 ? e.scale : T.embersR;
      _v.set(e.pos.x, this.groundY(e.pos.x, e.pos.z) + 0.05, e.pos.z);
      _s.set(r, 1, r);
      this.embers.setMatrixAt(n, _m.compose(_v, _q.identity(), _s));
      this.embers.setColorAt(n, _c.setRGB(Math.max(0.25, burn), heatFightHash(e.id, 7), 0));
      n++;
      if (this.rand() < dt * 6 * this.density * burn) {
        EMBERS_FLAME.radius = r * 0.7;
        this.particles.puff(_v.x, _v.y + 0.2, _v.z, 1, EMBERS_FLAME);
      }
    }
    for (let i = n; i < P.embers; i++) this.embers.setMatrixAt(i, _zero);
    this.embers.instanceMatrix.needsUpdate = true;
    if (this.embers.instanceColor) this.embers.instanceColor.needsUpdate = true;
    this.embers.visible = n > 0;
  }

  private embersBurst(x: number, z: number, r: number): void {
    const y = this.groundY(x, z);
    this.particles.puff(x, y + 0.3, z, 12, { ...SPARK_PUFF, radius: r * 0.8 });
  }

  // ---- Crystal Burn on bodies ------------------------------------------------------------

  private paintBurns(world: IWorld, dt: number): void {
    let n = 0;
    for (const id of this.burnIds) {
      const p = world.entities.get(id);
      if (!p || p.dead) continue;
      let stacks = 0;
      for (const a of p.auras) if (a.id === HEAT_AURAS.burn) stacks = a.stacks ?? 1;
      const look = burnLook(stacks, this.clock + id * 0.37, _burn);
      if (look.cover <= 0) continue;
      const y = this.groundY(p.pos.x, p.pos.z);
      _v.set(p.pos.x, p.pos.y, p.pos.z);
      _s.set(1 + look.pulse * 0.08, 1, 1 + look.pulse * 0.08);
      this.burns.setMatrixAt(n, _m.compose(_v, _q.identity(), _s));
      this.burns.setColorAt(n, _c.setRGB(look.cover, look.heat, heatFightHash(id, 11)));
      _v.set(p.pos.x, y + 0.06, p.pos.z);
      const sr = 0.9 + look.cover * 0.8;
      _s.set(sr, 1, sr);
      this.scorches.setMatrixAt(n, _m.compose(_v, _q.identity(), _s));
      this.scorches.setColorAt(n, _c.setRGB(look.heat, look.pulse, 0));
      n++;
      if (this.rand() < dt * (3 + stacks) * this.density)
        this.particles.puff(p.pos.x, p.pos.y + 0.6 + look.cover * 1.4, p.pos.z, 1, EMBER_PUFF);
    }
    for (let i = n; i < P.bodies; i++) {
      this.burns.setMatrixAt(i, _zero);
      this.scorches.setMatrixAt(i, _zero);
    }
    this.burns.instanceMatrix.needsUpdate = true;
    if (this.burns.instanceColor) this.burns.instanceColor.needsUpdate = true;
    this.burns.visible = n > 0;
    this.scorches.instanceMatrix.needsUpdate = true;
    if (this.scorches.instanceColor) this.scorches.instanceColor.needsUpdate = true;
    this.scorches.visible = n > 0;
  }

  // ---- the heat over the floor ------------------------------------------------------------

  private pulse(src: Entity): void {
    const heat = src.maxResource > 0 ? src.resource / src.maxResource : 0;
    const ring = pulseRing(heat);
    this.particles.shockRing(
      src.pos.x,
      src.pos.z,
      heat > 0.8 ? C.ring : C.ringGold,
      ring.radius,
      0.7,
    );
    if (heat > 0.5)
      this.particles.puff(src.pos.x, src.pos.y + 3, src.pos.z, Math.round(4 + 10 * heat), {
        ...SPARK_PUFF,
        speed: 6 + 6 * heat,
        radius: 2,
      });
  }

  private burst(src: Entity): void {
    this.waveAt = this.clock;
    this.particles.shockRing(src.pos.x, src.pos.z, C.white, 55, 1.4);
    this.particles.puff(src.pos.x, src.pos.y + 2, src.pos.z, 40, {
      ...FLAME_PUFF,
      speed: 14,
      up: 4,
      life: 1,
      radius: 4,
    });
    this.shakeNear(src.pos.x, src.pos.z, 1.2, 90);
  }

  private paintHeat(guardian: Entity | null, dt: number): void {
    const alive = guardian !== null && !guardian.dead;
    let overheating = false;
    if (alive)
      for (const a of guardian.auras) if (a.id === HEAT_AURAS.overheating) overheating = true;
    const heat = alive && guardian.maxResource > 0 ? guardian.resource / guardian.maxResource : 0;
    const glow = alive && guardian.inCombat ? windupGlow(overheating, heat, this.clock) : 0;
    const o = this.origin;
    if (o && glow > 0.001) {
      const cx = o.x + HEARTH_CENTRE.x;
      const cz = o.z + HEARTH_CENTRE.z;
      this.floor.position.set(cx, this.groundY(cx, cz) + 0.04, cz);
      this.floor.scale.set(46, 1, 46);
      this.floorMat.uniforms.uStrength.value = glow;
      this.floor.visible = true;
      // The haze thick over the floor (cosmetic).
      if (this.detail && this.rand() < dt * 30 * glow)
        this.particles.puff(
          cx + (this.rand() - 0.5) * 70,
          this.groundY(cx, cz) + 1 + this.rand() * 4,
          cz + (this.rand() - 0.5) * 70,
          1,
          HAZE_PUFF,
        );
    } else this.floor.visible = false;
    const age = this.clock - this.waveAt;
    if (guardian && age >= 0 && age < 1.5) {
      const w = burstWave(age, _ring);
      this.wave.position.set(
        guardian.pos.x,
        this.groundY(guardian.pos.x, guardian.pos.z) + 0.1,
        guardian.pos.z,
      );
      this.wave.scale.set(w.radius, 1, w.radius);
      this.waveMat.uniforms.uAlpha.value = w.alpha;
      this.wave.visible = true;
    } else if (guardian && overheating && guardian.inCombat && this.detail) {
      // The wind-up: rings of heat drawn in over the floor into the
      // guardian, quicker as the top nears (the wave's own disc, inverted).
      const g = windupGather(this.clock, heat, _ring);
      this.wave.position.set(
        guardian.pos.x,
        this.groundY(guardian.pos.x, guardian.pos.z) + 0.1,
        guardian.pos.z,
      );
      this.wave.scale.set(g.radius, 1, g.radius);
      this.waveMat.uniforms.uAlpha.value = g.alpha;
      this.wave.visible = g.alpha > 0.01;
      // Embers sucked toward it (cosmetic).
      if (this.rand() < dt * 40) {
        const a = this.rand() * Math.PI * 2;
        const r = 14 + this.rand() * 16;
        GATHER_DIR[0] = -Math.sin(a);
        GATHER_DIR[2] = -Math.cos(a);
        this.particles.puff(
          guardian.pos.x + Math.sin(a) * r,
          this.groundY(guardian.pos.x, guardian.pos.z) + 0.6 + this.rand() * 2.5,
          guardian.pos.z + Math.cos(a) * r,
          1,
          GATHER_PUFF,
        );
      }
    } else this.wave.visible = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.particles.dispose();
    this.kit.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const mesh of [this.cracks, this.embers, this.scorches, this.burns]) mesh.dispose();
    this.glowTex?.dispose();
  }
}
