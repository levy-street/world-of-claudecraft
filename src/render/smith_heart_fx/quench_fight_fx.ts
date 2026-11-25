// The Guardian of the Quench's fight on the Frozen Lake (plan:
// quench_fight_fx_core.ts; docs/design/raid/smith_heart.md section 7.3),
// hosted by ../rift_death_zone.ts beside QuenchFx (which keeps Quenching
// Breath's and Tempering Strike's own looks) and the blades
// (quench_blades_fx.ts). Presentation only, read from IWorld (the players'
// cold, warmth, freeze and water auras, the fight's objects, the guardian, its
// cues), so offline and online look the same:
//  - the cold: frost creeping up every player's body with their bar (crystals
//    of ice from the feet up, a rime ring on the ice under them), pulsing
//    past three quarters; on EVERY tier;
//  - the huddle's warmth: a warm glow under each huddled player and threads
//    of warm light between them, embers rising: players SEE warmth working;
//  - the freeze: a block of clear ice round the frozen player, cracks
//    climbing it, the shatter's ring at its exact radius on the ice (every
//    tier: allies step out of it); the shatter: shards, mist, a ring;
//  - the ice: a crack's footprint at its hole's exact radius (the shared
//    floor telegraph) under a web of cracks racing out, light in them; the
//    hole of freezing water (dark deep water, a churn, a rim of broken white
//    ice); a trapped player held to the waist in churning water; the
//    plunge's and the climb's splashes;
//  - a slash: its line from the blade through the marked player (the shared floor
//    telegraph, following them until it locks), the flight's wake;
//  - the shore ice: slabs of jagged ice heaving up round the lake at the
//    pull, standing through the fight, sinking and breaking at its end; the
//    lake refreezing over its holes at the guardian's fall.
// Every footprint, mark and the cold's frost draw on every tier; the mist,
// embers, glints and splashes thin on the low tier, the shakes go under
// reduced motion.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under one root attached through `attachSceneGroupGated` (the
// compile gate links it before the first cast); fixed pools, no per-frame
// allocation, no light. Feeds ../../game/smith_heart_quench_audio.ts.

import * as THREE from 'three';
import { sfx } from '../../game/sfx';
import { QuenchAudio } from '../../game/smith_heart_quench_audio';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import {
  bladeStateOf,
  crackOf,
  laneOf,
  QUENCH_AURAS,
  QUENCH_CUES,
  QUENCH_GUARDIAN,
  QUENCH_TUNING as T,
} from '../../sim/encounters/smith_heart/quench_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import { CAMERA_RELATIVE_GLSL } from '../camera_relative_glsl';
import { type TelegraphFan, TelegraphKit, type TelegraphLane } from '../floor_telegraph';
import { FloorTellPool } from '../floor_telegraph/floor_tell';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { heartKitSlotMaterial } from '../smith_heart/heart_kit';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import { CouncilRushArrow } from './council_rush_arrow';
import { QUENCH_TELEGRAPH_GLOW_STEP, type QuenchTelegraphKind } from './painted_telegraph_core';
import { type PaintedFan, QuenchTelegraphs } from './painted_telegraphs';
import {
  QUENCH_FIGHT_COLORS as C,
  crackLook,
  type FrostLook,
  fightHash,
  frostCrystal,
  frostLook,
  holeLook,
  laneDrawnYaw,
  laneLocked,
  laneTargetIndex,
  QUENCH_FIGHT_POOLS as P,
  QUENCH_FIGHT_REACH,
  QUENCH_LAKE_CENTRE,
  quenchClaimOrigin,
  quenchFightClaims,
  quenchObjectKind,
  RIM_SHARDS,
  rimRise,
  rimShard,
  type SlashLaneLook,
  slashLaneLook,
  type WarmBody,
  warmthLinks,
} from './quench_fight_fx_core';
import { QUENCH_FLOOR, quenchParticleSteps } from './quench_floor_ladder_core';
import { QuenchFrostFx } from './quench_frost_fx';
import {
  HOLE_BREAK_FLOOR,
  HOLE_DISC_SCALE,
  HOLE_MIST_RATE,
  HOLE_SHARDS,
  type HoleShard,
  holeHeave,
  holeShard,
} from './quench_hole_core';
import { HOLE_FRAG, HOLE_VERT } from './quench_hole_glsl';
import { QUENCH_RIME_POOLS as RIME_POOLS } from './quench_rime_core';
import { QuenchRimeFx } from './quench_rime_fx';

const SCAN_SEC = 0.1;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const _up = new THREE.Vector3(0, 1, 0);
const _frost: FrostLook = { cover: 0, height: 0, crystals: 0, pulse: 0 };
const _crystal = { a: 0, r: 0, y: 0, size: 0, lean: 0 };
const _shard = { x: 0, z: 0, h: 0, w: 0, lean: 0, yaw: 0 };
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);
const _hs: HoleShard = { x: 0, z: 0, h: 0, w: 0, lean: 0, yaw: 0 };
const _q2 = new THREE.Quaternion();
const _xAxis = new THREE.Vector3(1, 0, 0);

/** The most players a round of slashes marks at once (Mythic's four). */
const QUENCH_MARK_ARROWS = 4;

// ---- shaders ---------------------------------------------------------------------------

/** An instanced flat disc: its instance colour carries its parameters. */
const DISC_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
varying vec2 vXY;
varying vec3 vP;
void main() {
  vXY = position.xz;
  vP = instanceColor;
  // Camera-relative (world x ~ 119000: see quench_floor_ladder_core.ts).
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;
/** A web of cracks racing out under a lingering huddle (vP: spread, light,
 *  seed): white-hot lines at their running front, the vein's pale light. */
const CRACK_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uLight;
varying vec2 vXY;
varying vec3 vP;
float h(float p) { return fract(sin(p * 127.1) * 43758.5453); }
void main() {
  float r = length(vXY);
  if (r > 1.0) discard;
  float a = atan(vXY.y, vXY.x);
  float seed = vP.z * 91.0;
  float spread = vP.x;
  // Eleven jagged radial cracks, a ring crack round the middle.
  float k = a / 6.28318 * 11.0 + seed;
  float id = floor(k);
  float wob = (h(id + floor(r * 9.0)) - 0.5) * 0.35;
  float line = abs(fract(k) - 0.5 + wob * 0.4);
  float radial = 1.0 - smoothstep(0.0, 0.045 + 0.02 * (1.0 - r), line * (0.4 + r));
  radial *= step(r, spread * (0.75 + 0.25 * h(id + 3.0)));
  float ring = 1.0 - smoothstep(0.0, 0.025, abs(r - spread * 0.55 - 0.04 * sin(a * 7.0 + seed)));
  ring *= step(0.3, spread);
  float front = smoothstep(spread - 0.15, spread, r) * step(r, spread);
  float c = max(radial, ring * 0.8);
  vec3 col = uLight * (1.0 + front * 1.6 + vP.y * 0.6);
  gl_FragColor = vec4(col, c * (0.55 + 0.45 * vP.y));
  #include <colorspace_fragment>
}
`;
/** The rime ring under a cold body (vP: cover, pulse, seed). */
const RIME_FRAG = /* glsl */ `
uniform vec3 uFrost;
uniform vec3 uDeep;
varying vec2 vXY;
varying vec3 vP;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  float r = length(vXY);
  if (r > 1.0) discard;
  float a = atan(vXY.y, vXY.x);
  float feather = h(floor(vec2(a * 9.0, r * 7.0) + vP.z * 13.0));
  float k = (1.0 - smoothstep(0.55, 1.0, r)) * (0.5 + 0.5 * feather) * vP.x;
  vec3 col = mix(uDeep, uFrost, 0.55 + 0.45 * feather) * (1.0 + vP.y * 0.8);
  gl_FragColor = vec4(col, k * (0.7 + 0.3 * vP.y));
  #include <colorspace_fragment>
}
`;
/** The huddle's warm glow on the ice (vP.x: strength). */
const WARM_FRAG = /* glsl */ `
uniform vec3 uWarm;
uniform float uTime;
varying vec2 vXY;
varying vec3 vP;
void main() {
  float r = length(vXY);
  if (r > 1.0) discard;
  float glow = pow(max(1.0 - r, 0.0), 1.6);
  float flick = 0.85 + 0.15 * sin(uTime * 5.0 + vP.z * 40.0);
  gl_FragColor = vec4(uWarm * glow * vP.x * flick, glow * vP.x);
  #include <colorspace_fragment>
}
`;
/** An instanced body-frame mesh (the water's collars) with its parameters. */
const BODY_VERT = /* glsl */ `
${CAMERA_RELATIVE_GLSL}
varying vec3 vN;
varying vec3 vV;
varying vec3 vL;
varying vec3 vP;
void main() {
  vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vL = position;
  vP = instanceColor;
  vN = normalize(mat3(modelMatrix) * mat3(instanceMatrix) * normal);
  vV = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * wocCamRelView(wp.xyz);
}
`;
/** The churning freezing water round a trapped player's waist. */
const COLLAR_FRAG = /* glsl */ `
uniform float uTime;
uniform vec3 uDeep;
uniform vec3 uLit;
uniform vec3 uFoam;
varying vec3 vN;
varying vec3 vV;
varying vec3 vL;
varying vec3 vP;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float a = atan(vL.z, vL.x);
  vec2 q = vec2(a * 2.0, vL.y * 4.0 - uTime * 1.2);
  float churn = n(q + vP.z * 9.0);
  float foam = smoothstep(0.62, 0.9, n(q * 2.0 + vec2(uTime * 0.5, 0.0))) * smoothstep(0.55, 0.95, vL.y);
  float fres = pow(max(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0), 1.5);
  vec3 col = mix(uDeep, uLit, churn * 0.6 + fres * 0.3);
  col = mix(col, uFoam, foam);
  float top = 1.0 - smoothstep(0.85, 1.0, vL.y);
  gl_FragColor = vec4(col, (0.86 + 0.1 * fres) * top);
  #include <colorspace_fragment>
}
`;

// ---- the slots ------------------------------------------------------------------------

interface FanSlot {
  fan: TelegraphFan;
  id: number;
  born: number;
  template: string;
}

interface ObjectSlot {
  id: number;
  born: number;
  template: string;
}

/** The first idle one of a pool, else (all live) its first slot. */
function slotFor<S extends { id: number }>(pool: S[], id: number): S | null {
  for (const s of pool) if (s.id === id) return s;
  for (const s of pool) if (s.id < 0) return s;
  return null;
}

export class QuenchFightFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly detail: boolean;
  private readonly density: number;
  private readonly particles: EngineParticles;
  private readonly kit: TelegraphKit;
  private readonly markArrows: CouncilRushArrow;
  /** The marked players this scan, and their sim and drawn spots this frame
   *  (laneDrawnYaw reads them; filled once a frame on the first line). */
  private readonly markedIds: number[] = [];
  private readonly markedSpots: {
    id: number;
    simX: number;
    simZ: number;
    drawnX: number;
    drawnZ: number;
  }[] = [];
  private markedSeen = false;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly audio = new QuenchAudio(sfx);
  /** The frost pass on the bodies (quench_frost_fx.ts). */
  private readonly frost: QuenchFrostFx;
  /** Living Rime on its carriers (quench_rime_fx.ts). */
  readonly rime: QuenchRimeFx;
  // The footprints (every tier).
  private readonly crackFans: FanSlot[] = [];
  /** The shared AVOID tell over each crack's footprint (chevrons pointing
   *  out, its rim throbbing outward: floor_telegraph/floor_tell.ts), every
   *  tier (the team's playtest of 2026-11-25: the breaking ice must read). */
  private readonly crackTells: FloorTellPool;
  private readonly splashFans: FanSlot[] = [];
  private readonly lanes: {
    lane: TelegraphLane;
    id: number;
    born: number;
    /** The render time its blade was first seen flying (-1 while it warns). */
    flewAt: number;
    paint: PaintedFan<QuenchTelegraphKind>;
  }[] = [];
  /** The slash lines' paint (its live lock light, painted_telegraphs.ts). */
  private readonly lanePaints: QuenchTelegraphs;
  private readonly laneLook: SlashLaneLook = { fill: 0, lock: 0, fade: 1 };
  // The instanced pools.
  private readonly holes: THREE.InstancedMesh;
  private readonly holeSlots: ObjectSlot[] = [];
  private readonly cracks: THREE.InstancedMesh;
  private readonly rimes: THREE.InstancedMesh;
  private readonly crystals: THREE.InstancedMesh;
  private readonly holeShards: THREE.InstancedMesh;
  /** The players already in the water (a new one plunges: the big splash). */
  private readonly plunged = new Set<number>();
  private readonly warms: THREE.InstancedMesh;
  private readonly links: THREE.InstancedMesh;
  private readonly collars: THREE.InstancedMesh;
  private readonly rim: THREE.InstancedMesh;
  /** The shore ice's slabs by object id, and when each appeared. */
  private readonly rimSlots: ObjectSlot[] = [];
  private rimFalling = -1;
  // The scan's findings (ids, reused arrays).
  private readonly candidateIds: number[] = [];
  private readonly objectIds: number[] = [];
  readonly coldIds: number[] = [];
  readonly warmIds: number[] = [];
  readonly frozenIds: number[] = [];
  private readonly trappedIds: number[] = [];
  private readonly rimeIds: number[] = [];
  private readonly warmBodies: WarmBody[] = [];
  private readonly linkPairs = new Int16Array(P.links * 2);
  /** When each frozen player was first seen frozen (id to clock). */
  readonly frozenSince = new Map<number, number>();
  private guardianId = -1;
  private rosterSeen = Number.NaN;
  private origin: { x: number; z: number } | null = null;
  private readonly lookup = (id: number): Entity | undefined => this.world?.entities.get(id);
  private readonly groundAt = (x: number, z: number): number => this.groundY(x, z);
  private scanTimer = 0;
  private clock = 0;
  private seed = 0x2f61;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
  ) {
    this.root.name = 'smith-heart-quench-fight-fx';
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
      quenchParticleSteps('quench_fight_fx'),
    );
    this.kit = new TelegraphKit(this.root, this.detail);
    // The blades' marks: the Rush's red arrow over each marked player (the
    // owner's heroic run of 2026-11-17: a mark needed a call over the head
    // that the whole raid sees), up to a round's whole count.
    this.markArrows = new CouncilRushArrow(
      this.root,
      this.uTime,
      this.geometries,
      this.materials,
      QUENCH_AURAS.marked,
      QUENCH_MARK_ARROWS,
    );
    this.frost = new QuenchFrostFx(
      this.root,
      this.uTime,
      this.particles,
      (x, z) => this.groundY(x, z),
      this.density,
      () => this.rand(),
      this.detail,
    );
    // Every footprint dressed in the frost paint (painted_telegraphs.ts:
    // Jose's playtest of 2026-11-04 read them as generic red circles): the
    // crack opening to black water, the shatter's ring, the slash's groove.
    const paints = new QuenchTelegraphs(QUENCH_TELEGRAPH_GLOW_STEP, this.materials);
    this.lanePaints = paints;
    const fans = (
      n: number,
      order: number,
      out: FanSlot[],
      arc: number,
      color: number,
      kind: QuenchTelegraphKind,
    ) => {
      for (let i = 0; i < n; i++) {
        const fan = this.kit.fan(order);
        this.kit.layOutFan(fan, arc, { color, accent: C.accent });
        fan.group.visible = false;
        paints.dress(fan, kind);
        out.push({ fan, id: -1, born: 0, template: '' });
      }
    };
    // Every telegraph's char on the ladder's one telegraph rung (they
    // commute), its glow on the glow rung (quench_floor_ladder_core.ts).
    const tele = QUENCH_FLOOR.telegraphChar.step;
    fans(P.cracks, tele, this.crackFans, 360, C.danger, 'crack');
    fans(P.frozen, tele, this.splashFans, 360, C.danger, 'splash');
    // Living Rime's ring is the shatter's (one language: cold about to burst).
    this.rime = new QuenchRimeFx(
      this.root,
      this.kit,
      () => {
        const fan = this.kit.fan(QUENCH_FLOOR.telegraphChar.step);
        this.kit.layOutFan(fan, 360, { color: C.danger, accent: C.accent });
        paints.dress(fan, 'splash');
        return fan;
      },
      this.particles,
      (x, z) => this.groundY(x, z),
    );
    this.crackTells = new FloorTellPool(this.root, P.cracks, this.geometries, this.materials);
    for (let i = 0; i < P.lanes; i++) {
      const lane = this.kit.lane(QUENCH_FLOOR.telegraphChar.step);
      lane.group.visible = false;
      const paint = paints.dress(lane, 'slash');
      this.lanes.push({ lane, id: -1, born: 0, flewAt: -1, paint });
    }

    // ---- the instanced floor discs ----
    const disc = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
    this.geometries.push(disc);
    const discMat = (
      name: string,
      frag: string,
      uniforms: Record<string, THREE.IUniform>,
      additive: boolean,
      vert: string = DISC_VERT,
    ) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: { uTime: this.uTime, ...uniforms },
        vertexShader: vert,
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
      // Idle pools draw nothing (shown while they hold an instance).
      mesh.visible = false;
      this.root.add(mesh);
      return mesh;
    };
    this.holes = instanced(
      disc,
      discMat(
        'smithHeartQuenchHole',
        HOLE_FRAG,
        {
          uDeep: { value: new THREE.Color(...C.water) },
          uLit: { value: new THREE.Color(...C.waterLit) },
          uRim: { value: new THREE.Color(0.86, 0.94, 1.0) },
        },
        false,
        HOLE_VERT,
      ),
      P.holes,
      'smithHeartQuenchHoles',
      QUENCH_FLOOR.holes.step,
    );
    for (let i = 0; i < P.holes; i++) this.holeSlots.push({ id: -1, born: 0, template: '' });
    this.cracks = instanced(
      disc,
      discMat(
        'smithHeartQuenchCrackWeb',
        CRACK_FRAG,
        { uLight: { value: new THREE.Color(...C.crackLight) } },
        true,
      ),
      P.cracks,
      'smithHeartQuenchCrackWebs',
      QUENCH_FLOOR.crackWebs.step,
    );
    this.rimes = instanced(
      disc,
      discMat(
        'smithHeartQuenchRime',
        RIME_FRAG,
        {
          uFrost: { value: new THREE.Color(...C.frost) },
          uDeep: { value: new THREE.Color(...C.frostDeep) },
        },
        false,
      ),
      P.bodies,
      'smithHeartQuenchRimes',
      QUENCH_FLOOR.rimes.step,
    );
    this.warms = instanced(
      disc,
      discMat(
        'smithHeartQuenchWarmth',
        WARM_FRAG,
        { uWarm: { value: new THREE.Color(C.warm) } },
        true,
      ),
      P.warm,
      'smithHeartQuenchWarmth',
      QUENCH_FLOOR.warmth.step,
    );

    // ---- the frost crystals on bodies, the threads of warmth ----
    const crystalGeo = new THREE.ConeGeometry(0.22, 1, 5, 1).translate(0, 0.5, 0);
    {
      const pos = crystalGeo.getAttribute('position') as THREE.BufferAttribute;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const k = Math.min(1, pos.getY(i));
        col.set([0.42 + 0.5 * k, 0.62 + 0.34 * k, 0.82 + 0.18 * k], i * 3);
      }
      crystalGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      crystalGeo.computeVertexNormals();
    }
    this.geometries.push(crystalGeo);
    const iceMat = heartKitSlotMaterial('ice');
    this.crystals = new THREE.InstancedMesh(crystalGeo, iceMat, P.bodies * P.crystalsPer);
    this.crystals.name = 'smithHeartQuenchFrostCrystals';
    this.crystals.frustumCulled = false;
    this.crystals.castShadow = false;
    this.crystals.visible = false;
    this.crystals.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < P.bodies * P.crystalsPer; i++) this.crystals.setMatrixAt(i, _zero);
    this.root.add(this.crystals);
    // The broken ice heaved up round each hole's lip (quench_hole_core.ts):
    // faceted shards of lake ice, opaque (no floor rung to fight).
    const holeShardGeo = new THREE.ConeGeometry(0.5, 1, 4, 1).translate(0, 0.5, 0);
    {
      const pos = holeShardGeo.getAttribute('position') as THREE.BufferAttribute;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        const k = Math.min(1, Math.max(0, pos.getY(i)));
        col.set([0.5 + 0.45 * k, 0.7 + 0.28 * k, 0.88 + 0.12 * k], i * 3);
      }
      holeShardGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      holeShardGeo.computeVertexNormals();
    }
    this.geometries.push(holeShardGeo);
    this.holeShards = new THREE.InstancedMesh(holeShardGeo, iceMat, P.holes * HOLE_SHARDS);
    this.holeShards.name = 'smithHeartQuenchHoleShards';
    this.holeShards.frustumCulled = false;
    this.holeShards.castShadow = false;
    this.holeShards.visible = false;
    this.holeShards.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < P.holes * HOLE_SHARDS; i++) this.holeShards.setMatrixAt(i, _zero);
    this.root.add(this.holeShards);
    const linkGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
    this.geometries.push(linkGeo);
    const linkMat = new THREE.MeshBasicMaterial({
      color: C.warm,
      transparent: true,
      opacity: 0.75,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      name: 'smithHeartQuenchWarmThreads',
    });
    this.materials.push(linkMat);
    this.links = new THREE.InstancedMesh(linkGeo, linkMat, P.links);
    this.links.name = 'smithHeartQuenchWarmThreads';
    this.links.frustumCulled = false;
    this.links.visible = false;
    this.links.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < P.links; i++) this.links.setMatrixAt(i, _zero);
    this.root.add(this.links);

    // ---- the water's collars (the freeze's encasement is QuenchFrostFx's) ----
    const collarGeo = new THREE.CylinderGeometry(1.05, 1.2, 1.2, 24, 2, true).translate(0, 0.6, 0);
    this.geometries.push(collarGeo);
    const bodyMat = (name: string, frag: string, uniforms: Record<string, THREE.IUniform>) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: { uTime: this.uTime, ...uniforms },
        vertexShader: BODY_VERT,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
      });
      this.materials.push(m);
      return m;
    };
    this.collars = instanced(
      collarGeo,
      bodyMat('smithHeartQuenchWaterCollar', COLLAR_FRAG, {
        uDeep: { value: new THREE.Color(...C.water) },
        uLit: { value: new THREE.Color(...C.waterLit) },
        uFoam: { value: new THREE.Color(0.86, 0.94, 1.0) },
      }),
      P.trapped,
      'smithHeartQuenchWaterCollars',
      0,
    );
    // Body meshes are scene objects, never floor marks.
    this.collars.renderOrder = 0;

    // ---- the shore ice ----
    // A heaved shard of lake ice: a faceted blade-like prism, flat-faced (each
    // face its own shade), deep blue in its heart, clear above, a rime tip.
    const shardGeo = new THREE.CylinderGeometry(0.12, 0.8, 1, 5, 3)
      .translate(0, 0.5, 0)
      .toNonIndexed();
    {
      const pos = shardGeo.getAttribute('position') as THREE.BufferAttribute;
      const col = new Float32Array(pos.count * 3);
      for (let i = 0; i < pos.count; i++) {
        // Flatten it a little across, into a slab's shard rather than a cone.
        pos.setZ(i, pos.getZ(i) * 0.62);
        const k = Math.min(1, Math.max(0, pos.getY(i)));
        const face = 0.8 + 0.35 * fightHash(Math.floor(i / 3), 17);
        const tip = Math.max(0, (k - 0.82) / 0.18);
        const r = (0.12 + 0.34 * k) * face + tip * 0.3;
        const g = (0.33 + 0.39 * k) * face + tip * 0.18;
        const b = (0.52 + 0.36 * k) * face + tip * 0.1;
        col.set([Math.min(1, r), Math.min(1, g), Math.min(1, b)], i * 3);
      }
      shardGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      shardGeo.computeVertexNormals();
    }
    this.geometries.push(shardGeo);
    this.rim = new THREE.InstancedMesh(shardGeo, iceMat, P.rimSlabs * RIM_SHARDS);
    this.rim.name = 'smithHeartQuenchShoreIce';
    this.rim.frustumCulled = false;
    this.rim.castShadow = true;
    this.rim.visible = false;
    this.rim.receiveShadow = true;
    this.rim.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < P.rimSlabs * RIM_SHARDS; i++) this.rim.setMatrixAt(i, _zero);
    this.root.add(this.rim);
    for (let i = 0; i < P.rimSlabs; i++) this.rimSlots.push({ id: -1, born: 0, template: '' });

    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
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
    this.frost.event(ev, this.world, this.clock);
    this.rime.event(ev, this.world);
    if (ev.type === 'spellfxAt') {
      if (!quenchFightClaims(ev.ability)) return false;
      const r = ev.radius ?? 3;
      if (ev.ability === QUENCH_CUES.shatter) this.shatterAt(ev.x, ev.z, r);
      else if (ev.ability === QUENCH_CUES.hole) this.holeOpens(ev.x, ev.z, r);
      else if (ev.ability === QUENCH_CUES.cross) this.crossing(ev.x, ev.z, r);
      return true;
    }
    if (ev.type !== 'spellfx' || !quenchFightClaims(ev.ability)) return false;
    const dst = this.world.entities.get(ev.targetId);
    if (ev.ability === QUENCH_CUES.plunge && dst)
      this.splash(fxAnchor(dst).x, fxAnchor(dst).z, 1.4);
    else if (ev.ability === QUENCH_CUES.climb && dst)
      this.splash(fxAnchor(dst).x, fxAnchor(dst).z, 0.7);
    else if (ev.ability === QUENCH_CUES.freeze && dst) this.freezeBurst(dst);
    else if (ev.ability === QUENCH_CUES.rim && dst)
      this.particles.shockRing(fxAnchor(dst).x, fxAnchor(dst).z, 0xe0f4ff, 40, 1.4);
    else if (ev.ability === QUENCH_CUES.thaw && dst) this.thaw(dst);
    // The blades' waking is drawn by the blades and the body.
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
      this.audio.update(null, null, null);
      this.particles.update(this.clock);
      return;
    }
    this.paintObjects(world, dt);
    this.paintBodies(world, dt);
    this.frost.frame(world, this, dt, this.clock);
    this.rime.frame(world, this.rimeIds, this.clock);
    this.paintRim(world);
    this.markArrows.update(world.entities, this.clock, this.reducedMotion());
    this.particles.update(this.clock);
    const guardian = this.guardianId >= 0 ? (world.entities.get(this.guardianId) ?? null) : null;
    const me = world.entities.get(world.playerId) ?? null;
    let cold: number | null = null;
    if (me) for (const a of me.auras) if (a.id === QUENCH_AURAS.cold) cold = a.value;
    this.audio.update(guardian, me, cold);
  }

  // ---- the scan -------------------------------------------------------------------------

  private scan(world: IWorld): void {
    const me = world.entities.get(world.playerId);
    const origin = me ? quenchClaimOrigin(me.pos.x, me.pos.z) : null;
    const near =
      origin !== null &&
      me !== undefined &&
      Math.hypot(
        me.pos.x - origin.x - QUENCH_LAKE_CENTRE.x,
        me.pos.z - origin.z - QUENCH_LAKE_CENTRE.z,
      ) <
        QUENCH_FIGHT_REACH + 40;
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
    this.coldIds.length = 0;
    this.warmIds.length = 0;
    this.frozenIds.length = 0;
    this.trappedIds.length = 0;
    this.rimeIds.length = 0;
    this.guardianId = -1;
    this.markArrows.beginScan();
    this.markedIds.length = 0;
    for (let i = 0; i < this.candidateIds.length; i++) {
      const e = world.entities.get(this.candidateIds[i]);
      if (!e) continue;
      if (e.kind === 'object') {
        if (quenchObjectKind(e.templateId)) this.objectIds.push(e.id);
      } else if (e.kind === 'mob') {
        this.guardianId = e.id;
      } else if (e.kind === 'player' && !e.dead) {
        if (Math.abs(e.pos.x - origin.x) > 300 || Math.abs(e.pos.z - origin.z) > 260) continue;
        for (const a of e.auras) {
          if (a.id === QUENCH_AURAS.cold && this.coldIds.length < P.bodies) this.coldIds.push(e.id);
          else if (a.id === QUENCH_AURAS.warmth && this.warmIds.length < P.warm)
            this.warmIds.push(e.id);
          else if (a.id === QUENCH_AURAS.frozen && this.frozenIds.length < P.frozen)
            this.frozenIds.push(e.id);
          else if (a.id === QUENCH_AURAS.trapped && this.trappedIds.length < P.trapped)
            this.trappedIds.push(e.id);
          else if (a.id === QUENCH_AURAS.rime && this.rimeIds.length < RIME_POOLS.carriers)
            this.rimeIds.push(e.id);
          else if (a.id === QUENCH_AURAS.marked) {
            this.markArrows.see(e.id);
            if (this.markedIds.length < QUENCH_MARK_ARROWS) this.markedIds.push(e.id);
          }
        }
      }
    }
    this.markArrows.endScan();
    for (const id of this.frozenSince.keys())
      if (!this.frozenIds.includes(id)) this.frozenSince.delete(id);
    for (const id of this.frozenIds)
      if (!this.frozenSince.has(id)) this.frozenSince.set(id, this.clock);
    this.assign(world);
  }

  /** The roster walk: every entity the fight could draw. */
  private discover(world: IWorld, origin: { x: number; z: number }): void {
    const ids = this.candidateIds;
    ids.length = 0;
    for (const e of world.entities.values()) {
      if (e.kind === 'player') {
        ids.push(e.id);
        continue;
      }
      if (Math.abs(e.pos.x - origin.x) > 300 || Math.abs(e.pos.z - origin.z) > 260) continue;
      if (e.kind === 'object' || (e.kind === 'mob' && e.templateId === QUENCH_GUARDIAN))
        ids.push(e.id);
    }
  }

  /** Every fight object to its slot (released when gone). */
  private assign(world: IWorld): void {
    const live = this.objectIds;
    for (const pool of [this.crackFans])
      for (const s of pool)
        if (s.id >= 0 && !live.includes(s.id)) {
          s.id = -1;
          s.fan.group.visible = false;
        }
    for (const s of this.holeSlots) if (s.id >= 0 && !live.includes(s.id)) s.id = -1;
    let rimLost = false;
    for (const s of this.rimSlots)
      if (s.id >= 0 && !live.includes(s.id)) {
        s.id = -1;
        rimLost = true;
      }
    if (rimLost && this.rimFalling < 0) this.beginRimFall();
    for (const l of this.lanes)
      if (l.id >= 0 && !live.includes(l.id)) {
        l.id = -1;
        l.lane.group.visible = false;
      }
    for (const id of live) {
      const e = world.entities.get(id);
      if (!e) continue;
      const kind = quenchObjectKind(e.templateId);
      if (kind === 'crack') {
        const slot = slotFor(this.crackFans, id);
        if (!slot) continue;
        if (slot.id !== id) {
          slot.id = id;
          slot.born = this.clock;
          slot.template = e.templateId;
          slot.fan.group.visible = true;
          this.audio.crack(e.pos.x, this.groundY(e.pos.x, e.pos.z), e.pos.z);
        } else if (slot.template !== e.templateId) {
          slot.template = e.templateId;
          slot.born = this.clock;
        }
      } else if (kind === 'hole') {
        const slot = slotFor(this.holeSlots, id);
        if (slot && slot.id !== id) {
          slot.id = id;
          slot.born = this.clock;
          slot.template = '';
        }
      } else if (kind === 'rim' || kind === 'rimRise') {
        const slot = slotFor(this.rimSlots, id);
        if (slot && slot.id !== id) {
          slot.id = id;
          // A ring already standing when first seen (arriving late) is up.
          slot.born = kind === 'rim' ? this.clock - T.rimRise : this.clock;
          slot.template = '';
          this.rimFalling = -1;
        }
      } else if (kind === 'lane') {
        // A new line starts its warning; the line following its mark goes on with it.
        const slot = slotFor(this.lanes, id);
        if (slot && slot.id !== id) {
          slot.id = id;
          slot.born = this.clock;
          slot.flewAt = -1;
        }
      }
    }
  }

  private leave(): void {
    this.origin = null;
    this.markArrows.beginScan();
    this.markArrows.endScan();
    this.rosterSeen = Number.NaN;
    this.candidateIds.length = 0;
    for (const s of [...this.crackFans, ...this.splashFans]) {
      s.id = -1;
      s.fan.group.visible = false;
    }
    for (let i = 0; i < this.crackFans.length; i++) this.crackTells.hide(i);
    for (const l of this.lanes) {
      l.id = -1;
      l.lane.group.visible = false;
    }
    for (const s of this.holeSlots) s.id = -1;
    for (const s of this.rimSlots) {
      s.id = -1;
      s.template = '';
    }
    this.rimFalling = -1;
    this.frost.clear();
    this.rime.clear();
    for (const mesh of [
      this.holes,
      this.cracks,
      this.rimes,
      this.warms,
      this.crystals,
      this.links,
      this.collars,
      this.rim,
    ]) {
      for (let i = 0; i < mesh.count; i++) mesh.setMatrixAt(i, _zero);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = false;
    }
  }

  // ---- the fight's objects --------------------------------------------------------------

  private paintObjects(world: IWorld, dt: number): void {
    // The cracks: the hole's footprint filling, its web racing out, the
    // avoid tell over it and the strain snapping higher to the break.
    let n = 0;
    for (let ci = 0; ci < this.crackFans.length; ci++) {
      const s = this.crackFans[ci];
      const e = s.id >= 0 ? world.entities.get(s.id) : undefined;
      if (!e) {
        this.crackTells.hide(ci);
        continue;
      }
      const warn = crackOf(e.templateId) ?? T.crackWarn;
      const elapsed = this.clock - s.born;
      const look = crackLook(elapsed, warn);
      const r = e.scale > 0 ? e.scale : T.holeR;
      const y = this.groundY(e.pos.x, e.pos.z);
      this.kit.drapeFan(s.fan, this.groundY, e.pos.x, y, e.pos.z, 0, r);
      this.kit.paintFan(s.fan, { fill: look.fill, clock: this.clock, range: r });
      this.crackTells.paint(ci, {
        kind: 'avoid',
        x: e.pos.x,
        y,
        z: e.pos.z,
        radius: r,
        color: C.danger,
        hot: look.flash > 0.5 ? 0xffffff : C.accent,
        fill: look.fill,
        clock: this.clock,
        reduced: this.reducedMotion(),
        rim: true,
      });
      this.audio.crackStrain(ci, e.id, e.pos.x, y, e.pos.z, elapsed, warn);
      _v.set(e.pos.x, y + 0.06, e.pos.z);
      _s.set(r * 1.15, 1, r * 1.15);
      this.cracks.setMatrixAt(n, _m.compose(_v, _q.identity(), _s));
      this.cracks.setColorAt(
        n,
        _c.setRGB(look.spread, Math.min(1, look.light), fightHash(e.id, 3)),
      );
      n++;
      // Ice dust jumping off the cracks as they run.
      if (this.rand() < 0.08 * this.density) {
        const a = this.rand() * Math.PI * 2;
        const d = r * look.spread * this.rand();
        this.particles.puff(e.pos.x + Math.sin(a) * d, y + 0.2, e.pos.z + Math.cos(a) * d, 1, {
          speed: 1.5,
          up: 2,
          life: 0.5,
          size: [0.22, 0.06],
          color: C.shard,
          alpha: 1,
          pool: 'glow',
          gravity: 8,
        });
      }
    }
    for (let i = n; i < P.cracks; i++) this.cracks.setMatrixAt(i, _zero);
    this.cracks.instanceMatrix.needsUpdate = true;
    this.cracks.visible = n > 0;
    if (this.cracks.instanceColor) this.cracks.instanceColor.needsUpdate = true;
    // The holes of freezing water.
    let h = 0;
    for (const s of this.holeSlots) {
      const e = s.id >= 0 ? world.entities.get(s.id) : undefined;
      if (!e) continue;
      const age = this.clock - s.born;
      const look = holeLook(age);
      const r = e.scale > 0 ? e.scale : T.holeR;
      const gy = this.groundY(e.pos.x, e.pos.z);
      _v.set(e.pos.x, gy + 0.035, e.pos.z);
      _s.set(r * HOLE_DISC_SCALE, 1, r * HOLE_DISC_SCALE);
      this.holes.setMatrixAt(h, _m.compose(_v, _q.identity(), _s));
      this.holes.setColorAt(h, _c.setRGB(look.churn, look.fresh, fightHash(e.id, 7)));
      // The shards heaved up round its lip, bursting up as it breaks.
      const heave = holeHeave(age);
      const seed = fightHash(e.id, 11) * 1e6;
      for (let k = 0; k < HOLE_SHARDS; k++) {
        holeShard(seed, k, r, _hs);
        _v.set(e.pos.x + _hs.x, gy - 0.25 * (1 - heave), e.pos.z + _hs.z);
        _q.setFromAxisAngle(_up, _hs.yaw);
        _q2.setFromAxisAngle(_xAxis, _hs.lean * heave);
        _q.multiply(_q2);
        _s.set(_hs.w, _hs.h * (0.2 + 0.8 * heave), _hs.w * 0.7);
        this.holeShards.setMatrixAt(h * HOLE_SHARDS + k, _m.compose(_v, _q, _s));
      }
      // The break: ice bursting up and a white boil of spray the moment it opens.
      if (s.template !== 'broke') {
        s.template = 'broke';
        this.breakHole(e.pos.x, e.pos.z, r);
      }
      // Cold mist breathing up over the lip (never over the open middle).
      if (this.rand() < dt * HOLE_MIST_RATE * this.density) {
        const a = this.rand() * Math.PI * 2;
        const d = r * (0.95 + 0.25 * this.rand());
        this.particles.puff(e.pos.x + Math.sin(a) * d, gy + 0.1, e.pos.z + Math.cos(a) * d, 1, {
          speed: 0.15,
          up: 1.4,
          life: 2.2,
          size: [0.6, 1.6],
          color: C.mist,
          alpha: 0.26,
        });
      }
      h++;
    }
    for (let i = h * HOLE_SHARDS; i < P.holes * HOLE_SHARDS; i++)
      this.holeShards.setMatrixAt(i, _zero);
    this.holeShards.instanceMatrix.needsUpdate = true;
    this.holeShards.visible = h > 0;
    for (let i = h; i < P.holes; i++) this.holes.setMatrixAt(i, _zero);
    this.holes.instanceMatrix.needsUpdate = true;
    this.holes.visible = h > 0;
    if (this.holes.instanceColor) this.holes.instanceColor.needsUpdate = true;
    // The slashes' lines, each from its blade along its facing (riding the
    // marked player's drawn body while it still follows them).
    this.markedSeen = false;
    for (let li = 0; li < this.lanes.length; li++) {
      const l = this.lanes[li];
      const lane = l.id >= 0 ? world.entities.get(l.id) : undefined;
      const lof = lane ? laneOf(lane.templateId) : null;
      if (!lane || !lof) {
        l.lane.group.visible = false;
        if (!lane) this.audio.noLine(li);
        continue;
      }
      // The flight: the line stays, full and burning, fading as the blade
      // runs down it (it vanished the moment the blade flew before).
      if (lof.state === 'fly' && l.flewAt < 0) l.flewAt = this.clock;
      const look = slashLaneLook(
        this.clock - l.born,
        lof.seconds,
        lof.lock,
        lof.state === 'fly' ? this.clock - l.flewAt : null,
        T.slashFly,
        this.laneLook,
      );
      // Its warning as it is drawn and its lock, at the blade (the sound's).
      const ly = this.groundY(lane.pos.x, lane.pos.z);
      // Its sound in the marked player's own ear only (the line and the arrow
      // over them are the raid's).
      const marked = this.markedAt(world);
      const target = laneTargetIndex(lane.pos.x, lane.pos.z, lane.facing, marked);
      const mine = target >= 0 && marked[target].id === world.playerId;
      if (lof.state === 'warn')
        this.audio.line(
          li,
          l.id,
          lane.pos.x,
          ly,
          lane.pos.z,
          this.clock - l.born,
          lof.seconds,
          lof.lock,
          mine,
        );
      this.kit.drapeLane(
        l.lane,
        this.groundY,
        lane.pos.x,
        ly,
        lane.pos.z,
        laneDrawnYaw(
          lane.pos.x,
          lane.pos.z,
          lane.facing,
          this.markedAt(world),
          lof.state !== 'warn' || laneLocked(this.clock - l.born, lof.seconds, lof.lock),
        ),
        lof.length,
        T.laneHalf,
        { color: C.danger, accent: C.accent },
      );
      // The fill completes as the blade flies; once it locks, its edge burns
      // white-hot (the paint's live light) and the warning pulse runs hard.
      this.lanePaints.live(l.paint, look.lock);
      this.kit.paintLane(l.lane, {
        fill: look.fill,
        clock: this.clock,
        range: lof.length,
        fade: look.fade,
      });
      l.lane.group.visible = true;
    }
  }

  // ---- the bodies: cold, warmth, the freeze, the water ----------------------------------

  private paintBodies(world: IWorld, dt: number): void {
    // The cold creeping up each body, the rime under it.
    let ci = 0;
    let ri = 0;
    for (const id of this.coldIds) {
      const e = world.entities.get(id);
      if (!e || e.dead) continue;
      const eAt = fxAnchor(e);
      let cold = 0;
      for (const a of e.auras) if (a.id === QUENCH_AURAS.cold) cold = a.value;
      const look = frostLook(cold, this.clock, P.crystalsPer, _frost);
      if (look.cover <= 0.02) continue;
      const floor = this.groundY(eAt.x, eAt.z);
      _v.set(eAt.x, floor + 0.04, eAt.z);
      const rr = 0.9 + 0.8 * look.cover;
      _s.set(rr, 1, rr);
      this.rimes.setMatrixAt(ri, _m.compose(_v, _q.identity(), _s));
      this.rimes.setColorAt(ri, _c.setRGB(look.cover, look.pulse, fightHash(id, 5)));
      ri++;
      const bodyH = 1.9;
      for (let k = 0; k < look.crystals && ci < P.bodies * P.crystalsPer; k++) {
        frostCrystal(k + id * 31, _crystal);
        const y = floor + _crystal.y * look.height * bodyH;
        _v.set(
          eAt.x + Math.sin(_crystal.a) * _crystal.r,
          y,
          eAt.z + Math.cos(_crystal.a) * _crystal.r,
        );
        _e.set(Math.cos(_crystal.a) * _crystal.lean, 0, -Math.sin(_crystal.a) * _crystal.lean);
        _q.setFromEuler(_e);
        const grow = (0.6 + 0.4 * look.cover) * (1 + look.pulse * 0.25);
        _s.set(_crystal.size * grow, _crystal.size * 2.6 * grow, _crystal.size * grow);
        this.crystals.setMatrixAt(ci++, _m.compose(_v, _q, _s));
      }
      // Rime breath off a body past three quarters (cosmetic).
      if (look.pulse > 0 && this.rand() < dt * 6 * this.density) {
        this.particles.puff(eAt.x, floor + 1.6, eAt.z, 1, {
          speed: 0.8,
          up: 0.6,
          life: 0.9,
          size: [0.3, 0.9],
          color: C.mist,
          alpha: 0.4,
        });
      }
    }
    for (let i = ri; i < P.bodies; i++) this.rimes.setMatrixAt(i, _zero);
    for (let i = ci; i < P.bodies * P.crystalsPer; i++) this.crystals.setMatrixAt(i, _zero);
    this.rimes.instanceMatrix.needsUpdate = true;
    this.rimes.visible = ri > 0;
    if (this.rimes.instanceColor) this.rimes.instanceColor.needsUpdate = true;
    this.crystals.instanceMatrix.needsUpdate = true;
    this.crystals.visible = ci > 0;
    // The huddle's warmth: a glow under each warm body, threads between.
    this.warmBodies.length = 0;
    let wi = 0;
    for (const id of this.warmIds) {
      const e = world.entities.get(id);
      if (!e || e.dead) continue;
      const eAt = fxAnchor(e);
      const floor = this.groundY(eAt.x, eAt.z);
      _v.set(eAt.x, floor + 0.05, eAt.z);
      _s.set(T.warmR * 0.55, 1, T.warmR * 0.55);
      this.warms.setMatrixAt(wi, _m.compose(_v, _q.identity(), _s));
      this.warms.setColorAt(wi, _c.setRGB(0.75, 0, fightHash(id, 9)));
      wi++;
      this.warmBodies.push(this.warmBodyOf(this.warmBodies.length, e));
      if (this.rand() < dt * 5 * this.density) {
        this.particles.puff(
          eAt.x + (this.rand() - 0.5) * 1.6,
          floor + 0.4,
          eAt.z + (this.rand() - 0.5) * 1.6,
          1,
          {
            speed: 0.4,
            up: 1.6,
            life: 1.4,
            size: [0.16, 0.05],
            color: C.ember,
            alpha: 0.9,
            pool: 'glow',
          },
        );
      }
    }
    for (let i = wi; i < P.warm; i++) this.warms.setMatrixAt(i, _zero);
    this.warms.instanceMatrix.needsUpdate = true;
    this.warms.visible = wi > 0;
    if (this.warms.instanceColor) this.warms.instanceColor.needsUpdate = true;
    const links = warmthLinks(this.warmBodies, this.linkPairs, P.links);
    for (let i = 0; i < links; i++) {
      const a = this.warmBodies[this.linkPairs[i * 2]];
      const b = this.warmBodies[this.linkPairs[i * 2 + 1]];
      const ya = this.groundY(a.x, a.z) + 1.1;
      const yb = this.groundY(b.x, b.z) + 1.1;
      _v.set(a.x, ya, a.z);
      _s.set(b.x - a.x, yb - ya, b.z - a.z);
      const len = _s.length();
      _q.setFromUnitVectors(_up, _s.divideScalar(Math.max(1e-4, len)));
      const w = 0.05 + 0.02 * Math.sin(this.clock * 6 + i);
      _s.set(w, len, w);
      this.links.setMatrixAt(i, _m.compose(_v, _q, _s));
    }
    for (let i = links; i < P.links; i++) this.links.setMatrixAt(i, _zero);
    this.links.instanceMatrix.needsUpdate = true;
    this.links.visible = links > 0;
    // The freeze: the shatter's ring round each frozen body (its encasement
    // is QuenchFrostFx's).
    let bi = 0;
    for (const s of this.splashFans) s.id = -1;
    for (const id of this.frozenIds) {
      const e = world.entities.get(id);
      if (!e || e.dead) continue;
      const eAt = fxAnchor(e);
      let radius = 6;
      for (const a of e.auras) if (a.id === QUENCH_AURAS.frozen && a.value > 0) radius = a.value;
      const since = this.clock - (this.frozenSince.get(id) ?? this.clock);
      const floor = this.groundY(eAt.x, eAt.z);
      const fan = this.splashFans[bi];
      fan.id = id;
      fan.fan.group.visible = true;
      this.kit.drapeFan(fan.fan, this.groundY, eAt.x, floor, eAt.z, 0, radius);
      this.kit.paintFan(fan.fan, {
        fill: Math.min(1, since / T.freezeSeconds),
        clock: this.clock,
        range: radius,
      });
      bi++;
    }
    for (let i = bi; i < P.frozen; i++) this.splashFans[i].fan.group.visible = false;
    // The water: a churning collar round each trapped body's waist.
    let wa = 0;
    for (const id of this.plunged) if (!this.trappedIds.includes(id)) this.plunged.delete(id);
    for (const id of this.trappedIds) {
      const e = world.entities.get(id);
      if (!e || e.dead) continue;
      const eAt = fxAnchor(e);
      // A body just gone through the ice: the plunge's big splash.
      if (!this.plunged.has(id)) {
        this.plunged.add(id);
        this.plunge(eAt.x, eAt.z);
      }
      const floor = this.groundY(eAt.x, eAt.z);
      _v.set(eAt.x, floor - 0.25, eAt.z);
      _s.set(1, 1, 1);
      this.collars.setMatrixAt(wa, _m.compose(_v, _q.identity(), _s));
      this.collars.setColorAt(wa, _c.setRGB(0, 0, fightHash(id, 6)));
      wa++;
      if (this.rand() < dt * 4 * this.density) this.splash(eAt.x, eAt.z, 0.35);
    }
    for (let i = wa; i < P.trapped; i++) this.collars.setMatrixAt(i, _zero);
    this.collars.instanceMatrix.needsUpdate = true;
    this.collars.visible = wa > 0;
    if (this.collars.instanceColor) this.collars.instanceColor.needsUpdate = true;
  }

  /** A warm body record (the pool's own, rewritten in place). */
  private readonly warmPool: WarmBody[] = Array.from({ length: P.warm }, () => ({
    id: -1,
    x: 0,
    z: 0,
  }));
  private warmBodyOf(i: number, e: Entity): WarmBody {
    const w = this.warmPool[i];
    w.id = e.id;
    const eAt = fxAnchor(e);
    w.x = eAt.x;
    w.z = eAt.z;
    return w;
  }

  // ---- the shore ice --------------------------------------------------------------------

  private paintRim(world: IWorld): void {
    if (this.rimFalling >= 0) {
      this.paintRimFall();
      return;
    }
    // A slab is posed while it rises, then left alone ('up'); a gone slab's
    // shards are zeroed once ('gone').
    let dirty = false;
    let standing = 0;
    for (let i = 0; i < this.rimSlots.length; i++) {
      const slot = this.rimSlots[i];
      const e = slot.id >= 0 ? world.entities.get(slot.id) : undefined;
      if (!e) {
        if (slot.template !== 'gone') {
          for (let k = 0; k < RIM_SHARDS; k++) this.rim.setMatrixAt(i * RIM_SHARDS + k, _zero);
          slot.template = 'gone';
          dirty = true;
        }
        continue;
      }
      standing++;
      if (slot.template === 'up') continue;
      const rise = rimRise(this.clock - slot.born);
      const floor = this.groundY(e.pos.x, e.pos.z);
      const c = Math.cos(e.facing);
      const sn = Math.sin(e.facing);
      for (let k = 0; k < RIM_SHARDS; k++) {
        rimShard(i, k, _shard);
        // The slab's frame: local x along the ring (rotY of the facing).
        const wx = e.pos.x + _shard.x * c + _shard.z * sn;
        const wz = e.pos.z - _shard.x * sn + _shard.z * c;
        _v.set(wx, floor - (1 - rise) * _shard.h - 0.3, wz);
        _e.set(_shard.lean, e.facing + _shard.yaw, 0, 'YXZ');
        _q.setFromEuler(_e);
        _s.set(_shard.w, _shard.h, _shard.w * 0.8);
        this.rim.setMatrixAt(i * RIM_SHARDS + k, _m.compose(_v, _q, _s));
      }
      dirty = true;
      if (rise >= 1) slot.template = 'up';
      if (rise < 1 && this.rand() < 0.12 * this.density) {
        this.particles.puff(e.pos.x, floor + 0.3, e.pos.z, 2, {
          speed: 2.5,
          up: 3,
          life: 0.8,
          size: [0.28, 0.08],
          color: C.shard,
          alpha: 1,
          pool: 'glow',
          gravity: 10,
          radius: 2,
        });
      }
    }
    if (dirty) this.rim.instanceMatrix.needsUpdate = true;
    this.rim.visible = standing > 0;
  }

  /** The ring's slabs went (a wipe, the kill): they sink and break apart. */
  private beginRimFall(): void {
    this.rimFalling = this.clock;
    if (!this.origin) return;
    const cx = this.origin.x + QUENCH_LAKE_CENTRE.x;
    const cz = this.origin.z + QUENCH_LAKE_CENTRE.z;
    this.particles.shockRing(cx, cz, 0xe0f4ff, 38, 1.4);
  }

  private paintRimFall(): void {
    const t = (this.clock - this.rimFalling) / 1.2;
    if (t >= 1) {
      for (let i = 0; i < P.rimSlabs * RIM_SHARDS; i++) this.rim.setMatrixAt(i, _zero);
      this.rim.instanceMatrix.needsUpdate = true;
      this.rim.visible = false;
      this.rimFalling = -1;
      return;
    }
    // Each standing shard sinks back under the ice.
    for (let i = 0; i < P.rimSlabs * RIM_SHARDS; i++) {
      this.rim.getMatrixAt(i, _m);
      _m.decompose(_v, _q, _s);
      if (_s.y <= 0) continue;
      _v.y -= 0.05 + t * 0.12;
      this.rim.setMatrixAt(i, _m.compose(_v, _q, _s));
    }
    this.rim.instanceMatrix.needsUpdate = true;
  }

  // ---- the moments ----------------------------------------------------------------------

  private freezeBurst(e: Entity): void {
    const eAt = fxAnchor(e);
    const y = this.groundY(eAt.x, eAt.z);
    this.particles.puff(eAt.x, y + 1.2, eAt.z, 14, {
      speed: 2.5,
      life: 0.6,
      size: [0.28, 0.08],
      color: C.shard,
      alpha: 1,
      pool: 'glow',
      radius: 0.8,
    });
    this.particles.puff(eAt.x, y + 0.8, eAt.z, 6, {
      speed: 1,
      up: 0.5,
      life: 1.4,
      size: [1, 2.6],
      color: C.mist,
      alpha: 0.42,
    }); // The rime slamming shut: a ring of frost racing over the ice.
    this.particles.shockRing(eAt.x, eAt.z, 0xd8f4ff, 3, 0.4);
    this.shakeNear(eAt.x, eAt.z, 0.18, 14);
  }

  private shatterAt(x: number, z: number, r: number): void {
    const y = this.groundY(x, z);
    this.particles.puff(x, y + 1.2, z, 34, {
      speed: 9,
      up: 4,
      life: 1,
      size: [0.4, 0.12],
      color: C.shard,
      alpha: 1,
      pool: 'glow',
      gravity: 14,
      radius: 0.8,
    });
    this.particles.puff(x, y + 1, z, 14, {
      speed: r * 0.9,
      life: 1.1,
      size: [1.2, 3.6],
      color: C.mist,
      alpha: 0.5,
      drag: 1.6,
    });
    this.particles.shockRing(x, z, 0xe8f8ff, r, 0.5);
    this.particles.shockRing(x, z, 0x8fd2f4, r * 0.6, 0.35);
    this.shakeNear(x, z, 0.3, 20);
  }

  private holeOpens(x: number, z: number, r: number): void {
    const y = this.groundY(x, z);
    // The ice bursting up and the water thrown out of the hole.
    this.particles.puff(x, y + 0.4, z, 30, {
      speed: 6,
      up: 7,
      life: 1.1,
      size: [0.45, 0.14],
      color: C.shard,
      alpha: 1,
      pool: 'glow',
      gravity: 15,
      radius: r * 0.8,
    });
    this.particles.puff(x, y + 0.5, z, 16, {
      speed: 3,
      up: 4,
      life: 1.3,
      size: [0.9, 2.4],
      color: C.mist,
      alpha: 0.5,
      gravity: 2,
      radius: r * 0.6,
    });
    this.particles.shockRing(x, z, 0xe0f4ff, r * 1.6, 0.5);
    this.shakeNear(x, z, 0.35, 30);
  }

  /** The marked players' sim and drawn spots this frame (allocation-free
   *  after the first frames). */
  private markedAt(world: IWorld): readonly {
    id: number;
    simX: number;
    simZ: number;
    drawnX: number;
    drawnZ: number;
  }[] {
    if (this.markedSeen) return this.markedSpots;
    this.markedSeen = true;
    let n = 0;
    for (const id of this.markedIds) {
      const e = world.entities.get(id);
      if (!e || e.dead) continue;
      const at = fxAnchor(e);
      if (n >= this.markedSpots.length)
        this.markedSpots.push({ id: -1, simX: 0, simZ: 0, drawnX: 0, drawnZ: 0 });
      const m = this.markedSpots[n++];
      m.id = id;
      m.simX = e.pos.x;
      m.simZ = e.pos.z;
      m.drawnX = at.x;
      m.drawnZ = at.z;
    }
    this.markedSpots.length = n;
    return this.markedSpots;
  }

  /** The ice breaking open: shards and spray burst up, a ring of white water. */
  /** The ice gives way (the team's playtest of 2026-11-25: the break must be
   *  a moment): a white flash ring and a slower blue one, slabs of ice
   *  bursting up and out, a geyser of freezing water and its mist, the
   *  ground jolting near it. Its floor of shards and water never thins below
   *  HOLE_BREAK_FLOOR on any preset (the low tier sheds the rest). */
  private breakHole(x: number, z: number, r: number): void {
    const y = this.groundY(x, z);
    this.particles.shockRing(x, z, 0xffffff, r * 1.6, 0.45);
    this.particles.shockRing(x, z, 0x7fd0ff, r * 2.4, 0.9);
    this.particles.puff(x, y + 0.2, z, HOLE_BREAK_FLOOR + Math.round(22 * this.density), {
      speed: 6,
      up: 8,
      life: 1.1,
      size: [0.5, 0.12],
      color: C.shard,
      alpha: 1,
      pool: 'glow',
      gravity: 16,
      radius: r * 0.85,
    });
    // The water bursting up through the break: a tall geyser and its spray.
    this.particles.puff(x, y + 0.3, z, HOLE_BREAK_FLOOR + Math.round(16 * this.density), {
      speed: 2.4,
      up: 11,
      life: 1.2,
      size: [0.42, 0.14],
      color: [0.62, 0.86, 1.0],
      alpha: 1,
      gravity: 18,
      radius: r * 0.45,
    });
    this.splash(x, z, 2);
    this.shakeNear(x, z, 0.32, 24);
  }

  /** A body plunging through the ice: a tall burst of water and a ring. */
  private plunge(x: number, z: number): void {
    const y = this.groundY(x, z);
    this.particles.shockRing(x, z, 0xbfe6ff, 2.4, 0.7);
    this.particles.puff(x, y + 0.2, z, Math.round(26 * this.density) + 6, {
      speed: 3.2,
      up: 7.5,
      life: 1.1,
      size: [0.36, 0.1],
      color: [0.8, 0.92, 1.0],
      alpha: 1,
      gravity: 16,
      radius: 0.5,
    });
    this.splash(x, z, 1);
  }

  private splash(x: number, z: number, size: number): void {
    const y = this.groundY(x, z);
    this.particles.puff(x, y + 0.2, z, Math.round(12 * size), {
      speed: 3 * size,
      up: 4 * size,
      life: 0.8,
      size: [0.3 * size, 0.1],
      color: [0.75, 0.88, 1.0],
      alpha: 0.95,
      gravity: 12,
      radius: 0.6,
    });
    this.particles.puff(x, y + 0.3, z, Math.round(4 * size), {
      speed: 1,
      up: 1,
      life: 1.2,
      size: [0.8, 1.8 * size],
      color: C.mist,
      alpha: 0.22,
    });
  }

  /** A blade flies its line. */
  private crossing(x: number, z: number, half: number): void {
    const y = this.groundY(x, z);
    this.particles.shockRing(x, z, 0xbfeaff, half, 0.8);
    this.particles.puff(x, y + 1, z, 12, {
      speed: 4,
      life: 1,
      size: [1.2, 3.2],
      color: C.mist,
      alpha: 0.4,
      radius: half * 0.6,
    });
  }

  /** The guardian fell: the lake refreezes whole, a wave of frost over it. */
  private thaw(e: Entity): void {
    const eAt = fxAnchor(e);
    this.particles.shockRing(eAt.x, eAt.z, 0xe8f9ff, 34, 2.2);
    this.particles.shockRing(eAt.x, eAt.z, 0x9ad8ff, 24, 1.6);
    this.shakeNear(eAt.x, eAt.z, 0.4, 60);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.audio.dispose();
    this.root.removeFromParent();
    this.particles.dispose();
    this.frost.dispose();
    this.rime.dispose();
    this.kit.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const mesh of [
      this.holes,
      this.cracks,
      this.rimes,
      this.warms,
      this.crystals,
      this.links,
      this.collars,
      this.rim,
    ])
      mesh.dispose();
  }
}
