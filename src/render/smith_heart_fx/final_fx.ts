// The Masterless Strength's body and its effects (plan: final_fx_core.ts),
// hosted by ../rift_death_zone.ts beside the guardians'. Presentation only,
// read from IWorld (the boss's position, facing, cast bar, death, its
// events) and from the seal memory's arrival (`awakeSince`, the seal
// markers' arrival bit), so offline and online look the same, and a raid
// that arrives after the scene sees the body whole:
//  - the body: the Heart kit's rock pieces (torso, hip, head, shoulders,
//    arms, fists, a skirt of shards) floating round the heart, a great
//    crystal with the four veins turning inside it, threads of the veins'
//    light stitching each piece to it; it hovers and breathes, swings at the
//    tank, slams both fists into the floor for Forge Fist, flings its arms
//    up over a gathering bar (Basalt Fist, Weight of the Anvil) and slams
//    them down as it lands, and cups its hands for Leaping Bolt; its seams
//    and its halo burn in the colour of the quarter it drinks (the state
//    aura, encounters/smith_heart/final_ids.ts), white-gold in the ring;
//  - the arrival: the heart rising out of its bed in the chasm and gliding
//    in, each piece trembling, tearing free of the paving with its dust (its
//    socket is carved into the quarter it lay in, phase 2L), spiralling in
//    round the heart and locking with a
//    flash, the shards rising out of the chasm, then the four-colour
//    shockwave and the camera's thud (reduced motion drops the shake). A
//    pull during it runs the scene on to its end at once;
//  - an Overload Burst: the heart's flash and a wall of the quarter's light
//    riding out over the whole Anvil on the trash engine's wave clock, a
//    pulse a low ring of it (the bars themselves are the HUD's, the floor's
//    light the room's);
//  - its own model (phase 2O, final_body_fx.ts): the rigged Quadrant
//    Guardian stands from the arrival's FIRST frame, dormant, and every
//    piece flies into it and is drawn into its stone (final_arrival_core.ts:
//    Jose's playtest of 2026-11-04 saw the old body rebuilt, then a snap to
//    the model); under the shockwave it roars awake, wears the body of the
//    quarter it drinks and transforms as it crosses;
//  - the death: the model's fall, the heart rising out of its chest,
//    flickering dark and sinking into its bed (the room goes dark with it:
//    ../smith_heart/heart_final_core.ts).
// Cosmetic layers thin on the low tier (particles) and under reduced
// motion (the shake); the body, the telegraph and the timelines never do.
//
// Rules (src/render/CLAUDE.md): every material is built in the constructor
// under the root before its gated attach (the kit's rock pieces, which land
// later, draw with the kit's own shared slot materials, linked with the
// interior, and this module's glow); no light; fixed pools, no per-frame
// allocation.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import { HEART_ROOM, SMITH_HEART_VEIN_COLORS } from '../../sim/content/smith_heart_layout';
import { heartFinalPhase } from '../../sim/content/smith_heart_quarters';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
import { FINAL_AURAS, FINAL_CUES, finalZoneOf } from '../../sim/encounters/smith_heart/final_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import { telegraphFillOf } from '../floor_telegraph';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX, sharedUniforms } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { heartCollapseView, noteHeartCollapse } from '../smith_heart/heart_collapse_core';
import { noteHeartFinalDeath } from '../smith_heart/heart_final_core';
import { heartBeamMaterial } from '../smith_heart/heart_fx_materials';
import {
  ensureHeartKit,
  heartKitLoaded,
  heartKitMeshes,
  SMITH_HEART_HEART_KIT_URL,
} from '../smith_heart/heart_kit';
import { noteHeartQuarterBoss } from '../smith_heart/heart_quarters_core';
import { heartVeinGlowMaterial } from '../smith_heart/heart_room_kit';
import { HEART_CORE_BED_Y } from '../smith_heart/heart_room_kit_plan_core';
import { heartSealSlotKey, heartSealView, newHeartSealView } from '../smith_heart/heart_seal_core';
import { radialGlowTexture } from '../textures';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import { NOVA_WAVE_SECONDS, novaWave } from '../trash_engine_fx/trash_engine_fx_core';
import {
  ARRIVAL_KNEEL_HEIGHT,
  arrivalAnchor,
  arrivalForming,
  arrivalModelShown,
  arrivalPieceScale,
} from './final_arrival_core';
import { FINAL_BODY_HEIGHT, finalBodyPoint } from './final_body_core';
import { FinalBodyFx } from './final_body_fx';
import {
  ARRIVAL,
  ARRIVAL_END,
  ARRIVAL_SKIP_SECONDS,
  ARRIVAL_WAVE_AT,
  ARRIVAL_WAVE_LOOK,
  arrivalWave,
  COLOSSUS_ARM,
  COLOSSUS_FIST_IMPACT,
  COLOSSUS_FIST_SECONDS,
  COLOSSUS_PIECES,
  COLOSSUS_RELEASE_SECONDS,
  COLOSSUS_SHARDS,
  COLOSSUS_SLOTS,
  COLOSSUS_SWING_SECONDS,
  type ColossusAction,
  type ColossusPiece,
  colossusArmIk,
  colossusBreath,
  colossusFallPlan,
  colossusFlyPoint,
  colossusLiftHeight,
  colossusLockAt,
  colossusPiecePhase,
  colossusRestPoint,
  colossusRestTilt,
  colossusShardSlot,
  colossusSpin,
  colossusTearAt,
  colossusWristTarget,
  DEATH,
  DEATH_END,
  FINAL_BODY_CASTS,
  FINAL_BOSS,
  FINAL_FX_COLORS,
  FINAL_FX_POOLS,
  FORGE_FIST_CUE,
  finalBossKit,
  HEART_RISE_FROM,
  heartArrivalPoint,
  heartDeathLevel,
  heartSink,
  pourGather,
  type V3,
  wrathBlastLook,
  wrathGather,
} from './final_fx_core';
import { finalPhaseMaskOf } from './final_phase_fx_core';
import { fxHash } from './hammer_fx_core';

const C = FINAL_FX_COLORS;
const SCAN_SEC = 0.25;
const VEINS = [
  SMITH_HEART_VEIN_COLORS.hammer,
  SMITH_HEART_VEIN_COLORS.breath,
  SMITH_HEART_VEIN_COLORS.quench,
  SMITH_HEART_VEIN_COLORS.heat,
];

// ---- the heart --------------------------------------------------------------------------

const HEART_VERT = /* glsl */ `
varying vec3 vShade;
varying vec3 vP;
varying float vRim;
void main() {
  vShade = color;
  vP = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vRim = abs(dot(normalize(normalMatrix * normal), normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}
`;
/** The heart: white-gold crystal, its facets each their own value, the four
 *  veins wound through it in their colours (helices turning slowly), the
 *  whole beating like the core in the chasm; dark and smoky as it dies. */
const HEART_FRAG = /* glsl */ `
uniform float uTime;
uniform float uLevel;
uniform float uFlare;
uniform vec3 uV0;
uniform vec3 uV1;
uniform vec3 uV2;
uniform vec3 uV3;
varying vec3 vShade;
varying vec3 vP;
varying float vRim;
void main() {
  float shade = vShade.r;
  float rim = (1.0 - vRim) * (1.0 - vRim);
  float ph = fract(uTime / 2.2);
  float beat = exp(-(ph - 0.08) * (ph - 0.08) * 480.0) + 0.6 * exp(-(ph - 0.24) * (ph - 0.24) * 480.0);
  float a = atan(vP.x, vP.z);
  vec3 veins = vec3(0.0);
  vec3 vc[4];
  vc[0] = uV0; vc[1] = uV1; vc[2] = uV2; vc[3] = uV3;
  for (int i = 0; i < 4; i++) {
    float off = float(i) * 1.5707963;
    float hlx = sin(a * 1.0 + off + vP.y * 1.1 - uTime * (0.55 + float(i) * 0.07));
    float band = smoothstep(0.82, 0.98, hlx);
    veins += vc[i] * band;
  }
  vec3 deep = vec3(0.55, 0.3, 0.1);
  vec3 gold = vec3(1.0, 0.78, 0.42);
  vec3 core = vec3(1.0, 0.96, 0.86);
  vec3 lit = mix(deep, gold, smoothstep(0.35, 0.8, shade));
  lit = mix(lit, core, smoothstep(0.85, 1.0, shade) * 0.7 + beat * 0.25);
  lit += veins * (0.9 + beat * 0.6);
  lit += core * rim * (0.6 + beat * 0.5);
  lit *= 1.05 + beat * 0.35;
  vec3 dark = mix(vec3(0.05, 0.045, 0.05), vec3(0.16, 0.12, 0.09), shade) + vec3(0.25, 0.13, 0.05) * rim * 0.3;
  vec3 col = mix(dark, lit, clamp(uLevel, 0.0, 1.0));
  col += vec3(1.0, 0.97, 0.9) * uFlare;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

// ---- the pour's floor fire ------------------------------------------------------------------

/** The wall of light riding out with an Overload Burst, rising off the floor. */
const WALL_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
uniform vec3 uCore;
uniform vec3 uGold;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  float t = n(vec2(vUv.x * 64.0, vUv.y * 2.0 - uTime * 3.0)) * 0.6 + n(vec2(vUv.x * 140.0, vUv.y * 4.0)) * 0.4;
  float top = 0.35 + 0.6 * t;
  // A bright lip low down fading fast upward, ragged: a wall of light you
  // read the wave by, never a sheet that hides the floor.
  float a = uAlpha * (1.0 - smoothstep(top - 0.3, top, vUv.y)) * pow(1.0 - vUv.y, 1.6);
  a *= 0.55 + 0.45 * t;
  if (a <= 0.003) discard;
  gl_FragColor = vec4(mix(uGold, uCore, 1.0 - vUv.y) * a * 1.4, a);
  #include <colorspace_fragment>
}
`;
const UV_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// ---- per-frame scratch (no allocation a frame) -----------------------------------------------

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const X_AXIS = new THREE.Vector3(1, 0, 0);

interface PieceRig {
  def: ColossusPiece;
  index: number;
  holder: THREE.Group | null;
  rubble: THREE.Group | null;
  /** Its pose this frame (room-local), for the threads and the fall. */
  pos: THREE.Vector3;
  quat: THREE.Quaternion;
  /** Its pose as the body died (the fall starts there). */
  diedPos: THREE.Vector3;
  diedQuat: THREE.Quaternion;
  fall: { land: V3; chasm: boolean; start: number } | null;
  landed: boolean;
  /** Where on the model it flies in (room-local, final_arrival_core.ts). */
  target: THREE.Vector3;
}

export class FinalFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly particles: EngineParticles;
  private readonly sim = finalBossKit();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly seamGlow: THREE.ShaderMaterial;
  private readonly heartMat: THREE.ShaderMaterial;
  private heartMesh: THREE.Group | null = null;
  private readonly heartHalo: THREE.Sprite;
  private readonly flashes: {
    sprite: THREE.Sprite;
    born: number;
    size: number;
    span: number;
    peak: number;
  }[] = [];
  private readonly threads: THREE.InstancedMesh;
  private readonly threadColor = new THREE.Color();
  private readonly wrathWall: THREE.Mesh;
  private readonly wrathMat: THREE.ShaderMaterial;
  private readonly riseBeam: THREE.Mesh;
  private readonly riseMat: THREE.ShaderMaterial;
  private readonly pieces: PieceRig[];
  private readonly view = newHeartSealView();
  private readonly heartPos = new THREE.Vector3();
  /** The fake death's kneel, 0 to 1. */
  private kneel = 0;
  private readonly wrist = [new THREE.Vector3(), new THREE.Vector3()];
  private readonly elbow = [new THREE.Vector3(), new THREE.Vector3()];
  private built = false;
  private bossId = -1;
  private scanTimer = 0;
  private clock = 0;
  private seed = 0x5a17;
  private disposed = false;
  private originX = 0;
  private originZ = 0;
  private slotKey = '';
  private facing = 0;
  private lean = 0;
  private prevArrival = -1;
  private skipAt = -1;
  private skipFrom = 0;
  private deadAt = -1;
  private seenAlive = false;
  private action: ColossusAction = 'idle';
  private actionAt = -99;
  private swingSide: -1 | 1 = 1;
  private castId: string | null = null;
  private castProgress = 0;
  /** The pose the running bar holds ('wrath' arms up, 'pour' cupped). */
  private castPose: 'wrath' | 'pour' | null = null;
  private pourAt = -99;
  private wrathAt = -99;
  private burstAt = -99;
  /** The seams' colour easing toward the quarter it drinks. */
  private readonly seamTint = new THREE.Color(C.seam);
  private readonly seamTarget = new THREE.Color(C.seam);
  private readonly burstTint = new THREE.Color(C.seam);
  private fistImpactDue = -1;
  private bossHitAt = -99;
  /** Its own model: the element bodies, the transformation, the auras. */
  private readonly bodyFx: FinalBodyFx;
  private readonly heartAt = { x: 0, y: 0, z: 0 };
  /** The model's chest (room-local) this frame, while it is shown. */
  private readonly modelHeart = new THREE.Vector3();
  private bossNow: Entity | null = null;
  private readonly anchorAt = { x: 0, y: 0, z: 0 };
  private zone: ReturnType<typeof finalZoneOf> = 'ring';
  private readonly diedHeart = new THREE.Vector3();
  private diedHeartSet = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
    playGesture?: (entityId: number, gesture: string) => void,
  ) {
    this.root.name = 'smith-heart-final-fx';
    setRenderCategory(this.root, 'ui3d');
    const detail =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    this.density = detail ? 1 : 0.4;
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
    // The body's glow (its seams) and the heart's own shader, each with a
    // hidden carrier so the compile gate links them before the kit lands.
    this.seamGlow = heartVeinGlowMaterial(C.seam, 'smithHeartColossusSeams');
    // The heart's light in the body's cracks burns hotter than the room's.
    (this.seamGlow.uniforms.uColor.value as THREE.Color).multiplyScalar(1.8);
    this.heartMat = new THREE.ShaderMaterial({
      name: 'smithHeartColossusHeart',
      vertexColors: true,
      fog: false,
      toneMapped: false,
      uniforms: {
        uTime: sharedUniforms.uTime,
        uLevel: { value: 1 },
        uFlare: { value: 0 },
        uV0: { value: new THREE.Color(VEINS[0]) },
        uV1: { value: new THREE.Color(VEINS[1]) },
        uV2: { value: new THREE.Color(VEINS[2]) },
        uV3: { value: new THREE.Color(VEINS[3]) },
      },
      vertexShader: HEART_VERT,
      fragmentShader: HEART_FRAG,
    });
    this.materials.push(this.seamGlow, this.heartMat);
    const carrierGeo = new THREE.BufferGeometry();
    carrierGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    carrierGeo.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3),
    );
    carrierGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(1), 3));
    this.geometries.push(carrierGeo);
    for (const m of [this.seamGlow, this.heartMat]) {
      const carrier = new THREE.Mesh(carrierGeo, m);
      carrier.visible = false;
      carrier.frustumCulled = false;
      carrier.name = 'smithHeartColossusCarrier';
      this.root.add(carrier);
    }
    // The heart's halo and the flashes (locks, the shockwave, the blast).
    const glowTex = hasDom ? radialGlowTexture() : null;
    const haloMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: 0xffd8a0,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      name: 'smithHeartColossusHalo',
    });
    this.materials.push(haloMat);
    this.heartHalo = new THREE.Sprite(haloMat);
    this.heartHalo.visible = false;
    this.root.add(this.heartHalo);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.SpriteMaterial({
        map: glowTex,
        color: 0xffeed0,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
        name: 'smithHeartColossusFlash',
      });
      this.materials.push(m);
      const sprite = new THREE.Sprite(m);
      sprite.visible = false;
      this.root.add(sprite);
      this.flashes.push({ sprite, born: -99, size: 1, span: 0.4, peak: 1 });
    }
    // The threads of the veins' light: one instanced draw.
    const threadGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
    this.geometries.push(threadGeo);
    const threadMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
      name: 'smithHeartColossusThreads',
    });
    this.materials.push(threadMat);
    this.threads = new THREE.InstancedMesh(threadGeo, threadMat, FINAL_FX_POOLS.threads);
    this.threads.name = 'smithHeartColossusThreads';
    this.threads.frustumCulled = false;
    this.threads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < FINAL_FX_POOLS.threads; i++) {
      this.threads.setMatrixAt(i, _m.makeScale(0, 0, 0));
      this.threads.setColorAt(i, this.threadColor.setHex(0xffffff));
    }
    this.root.add(this.threads);
    // The Overload Burst's wall of light riding out over the whole Anvil.
    const col = (c: readonly [number, number, number]) => ({ value: new THREE.Color(...c) });
    const wallGeo = new THREE.CylinderGeometry(1, 1, 1, 96, 1, true).translate(0, 0.5, 0);
    this.geometries.push(wallGeo);
    this.wrathMat = new THREE.ShaderMaterial({
      name: 'smithHeartOverloadWall',
      uniforms: { uAlpha: { value: 0 }, uTime: this.uTime, uCore: col(C.core), uGold: col(C.gold) },
      vertexShader: UV_VERT,
      fragmentShader: WALL_FRAG,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    this.materials.push(this.wrathMat);
    this.wrathWall = new THREE.Mesh(wallGeo, this.wrathMat);
    this.wrathWall.name = 'smithHeartOverloadWall';
    this.wrathWall.visible = false;
    this.wrathWall.frustumCulled = false;
    this.root.add(this.wrathWall);
    // The pillar of the heart's light it rises up out of the chasm on.
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0);
    this.geometries.push(beamGeo);
    this.riseMat = heartBeamMaterial(0xffdca0, 'smithHeartColossusRise', 1.6);
    this.materials.push(this.riseMat);
    this.riseBeam = new THREE.Mesh(beamGeo, this.riseMat);
    this.riseBeam.name = 'smithHeartColossusRise';
    this.riseBeam.visible = false;
    this.riseBeam.frustumCulled = false;
    this.root.add(this.riseBeam);
    this.body.name = 'smithHeartColossus';
    this.body.visible = false;
    this.root.add(this.body);
    this.pieces = COLOSSUS_PIECES.map((def, index) => ({
      def,
      index,
      holder: null,
      rubble: null,
      pos: new THREE.Vector3(),
      quat: new THREE.Quaternion(),
      diedPos: new THREE.Vector3(),
      diedQuat: new THREE.Quaternion(),
      fall: null,
      landed: false,
      target: new THREE.Vector3(),
    }));
    for (const s of [-1, 1] as const) {
      const w = this.wrist[s < 0 ? 0 : 1];
      w.set(s * COLOSSUS_ARM.idle.x, COLOSSUS_ARM.idle.y, COLOSSUS_ARM.idle.z);
    }
    this.bodyFx = new FinalBodyFx(
      this.root,
      {
        particles: this.particles,
        density: this.density,
        flash: (x, y, z, size, span, color) => this.flash(x, y, z, size, span, color),
        shakeNear: (x, z, amount, reach) => this.shakeNear(x, z, amount, reach),
        rand: () => this.rand(),
        groundY: (x, z) => this.groundY(x, z),
      },
      playGesture,
    );
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
    // The body's rock is the Heart kit's: built the moment it has landed.
    if (heartKitLoaded(SMITH_HEART_HEART_KIT_URL)) this.buildBody();
    else if (hasDom)
      void ensureHeartKit(SMITH_HEART_HEART_KIT_URL).then(() => {
        if (!this.disposed && heartKitLoaded(SMITH_HEART_HEART_KIT_URL)) this.buildBody();
      });
  }

  /** The rock pieces, the heart and the rubble (the kit's meshes,
   *  the seams on this module's glow). */
  private buildBody(): void {
    if (this.built) return;
    this.built = true;
    const kitGroup = (piece: string, glow: THREE.Material | null): THREE.Group | null => {
      const g = heartKitMeshes(SMITH_HEART_HEART_KIT_URL, piece);
      if (!g) return null;
      for (const m of g.children)
        if (m instanceof THREE.Mesh && m.name.endsWith(':glow') && glow) m.material = glow;
      return g;
    };
    for (const p of this.pieces) {
      p.holder = kitGroup(p.def.piece, this.seamGlow);
      if (p.holder) {
        p.holder.name = `colossus:${p.def.id}`;
        if (p.def.joint === 'shoulder' && p.def.side < 0) p.holder.scale.set(-1, 1, 1);
        p.holder.scale.multiplyScalar(p.def.scale);
        this.body.add(p.holder);
      }
      if (p.def.joint !== 'shard') {
        // Its socket is the quarter's own (the kit carves it, phase 2L).
        p.rubble = kitGroup('Kit_RubbleScatter', null);
        if (p.rubble) {
          p.rubble.visible = false;
          for (const m of p.rubble.children) if (m instanceof THREE.Mesh) m.castShadow = false;
          this.body.add(p.rubble);
        }
        if (p.rubble) p.rubble.scale.setScalar(0.6 + p.def.size * 0.1);
      }
    }
    this.heartMesh = kitGroup('Kit_HeartCrystal', this.heartMat);
    if (this.heartMesh) {
      this.heartMesh.name = 'smithHeartColossusHeart';
      for (const m of this.heartMesh.children) if (m instanceof THREE.Mesh) m.castShadow = false;
      this.body.add(this.heartMesh);
    }
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  private shakeNear(x: number, z: number, amount: number, reach = 70): void {
    if (!this.shakeSink || !this.world || this.reducedMotion()) return;
    const me = this.world.entities.get(this.world.playerId);
    if (!me) return;
    const d = Math.hypot(me.pos.x - x, me.pos.z - z);
    if (d < reach) this.shakeSink(amount * (1 - (d / reach) * 0.6));
  }

  private flash(
    x: number,
    y: number,
    z: number,
    size: number,
    span: number,
    color = 0xffeed0,
    peak = 1,
  ): void {
    const f = this.flashes.find((q) => this.clock - q.born > q.span) ?? this.flashes[0];
    f.born = this.clock;
    f.size = size;
    f.span = span;
    f.peak = peak;
    (f.sprite.material as THREE.SpriteMaterial).color.setHex(color);
    f.sprite.position.set(x, y, z);
    f.sprite.visible = true;
  }

  /** Never claims an event: the renderer's own draws still play under these. */
  handleEvent(ev: SimEvent): boolean {
    if (!this.world || this.disposed) return false;
    if (ev.type === 'damage') {
      if (ev.sourceId === this.bossId || ev.targetId === this.bossId) this.bossHitAt = this.clock;
      if (ev.sourceId === this.bossId && ev.ability === null && this.action === 'idle') {
        this.action = 'swing';
        this.actionAt = this.clock;
        this.swingSide = this.swingSide === 1 ? -1 : 1;
      }
      return false;
    }
    if (ev.type !== 'spellfx') return false;
    const e = this.world.entities.get(ev.sourceId);
    if (!e || e.templateId !== FINAL_BOSS) return false;
    if (ev.fx === 'windup' && ev.ability === FORGE_FIST_CUE) {
      this.action = 'fist';
      this.actionAt = this.clock;
      this.fistImpactDue = this.clock + COLOSSUS_FIST_IMPACT * COLOSSUS_FIST_SECONDS;
    } else if (ev.ability === FINAL_CUES.burst && ev.fx === 'nova') {
      this.burstLands(e, 1);
    } else if (ev.ability === FINAL_CUES.pulse && ev.fx === 'nova') {
      this.burstLands(e, 0);
    }
    return false;
  }

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.clock += dt;
    this.uTime.value = this.clock;
    this.scanTimer -= dt;
    if (this.scanTimer <= 0) {
      this.scanTimer = SCAN_SEC;
      this.bossId = -1;
      for (const e of world.entities.values()) {
        if (e.templateId === FINAL_BOSS) {
          this.bossId = e.id;
          break;
        }
      }
    }
    const boss = this.bossId >= 0 ? world.entities.get(this.bossId) : undefined;
    if (!boss) {
      this.bodyFx.lost();
      this.body.visible = false;
      this.heartHalo.visible = false;
      this.riseBeam.visible = false;
      this.particles.update(this.clock);
      return;
    }
    const def = DUNGEONS.smith_heart;
    if (!def) return;
    const o = instanceOrigin(def.index, instanceSlotForZ(boss.pos.z));
    if (o.x !== this.originX || o.z !== this.originZ || !this.slotKey) {
      this.originX = o.x;
      this.originZ = o.z;
      this.slotKey = heartSealSlotKey(o.x, o.z);
      this.prevArrival = -1;
      this.deadAt = -1;
      this.seenAlive = false;
    }
    this.body.visible = true;
    this.body.position.set(o.x, 0, o.z);
    const now = sharedUniforms.uTime.value;
    heartSealView(this.slotKey, now, this.view);
    // The death: first seen already dead, the fall has long settled.
    if (boss.dead) {
      if (this.deadAt < 0) {
        this.deadAt = this.seenAlive ? this.clock : this.clock - DEATH_END - 1;
        this.startFall(this.clock - this.deadAt);
      }
    } else {
      if (this.deadAt >= 0) this.resetFall();
      this.deadAt = -1;
      this.seenAlive = true;
    }
    noteHeartFinalDeath(this.slotKey, this.deadAt < 0 ? null : now - (this.clock - this.deadAt));
    // The arrival's clock: a heart asleep is -1; a pull during the scene runs
    // it on to its end at once.
    let t = this.view.awakeSince;
    if (t < 0 && this.deadAt >= 0) t = ARRIVAL_END + 1;
    // Engaged: online a mob's in-combat bit is not mirrored, so a cast, a
    // wound or a blow traded with it counts too.
    const engaged =
      boss.inCombat ||
      !!boss.castingAbility ||
      boss.hp < boss.maxHp ||
      this.clock - this.bossHitAt < 1;
    if (t >= 0 && t < ARRIVAL_END && engaged) {
      if (this.skipAt < 0) {
        this.skipAt = this.clock;
        this.skipFrom = t;
      }
      t = Math.min(
        ARRIVAL_END,
        this.skipFrom +
          ((this.clock - this.skipAt) / ARRIVAL_SKIP_SECONDS) * (ARRIVAL_END - this.skipFrom),
      );
    } else if (t < 0) {
      this.skipAt = -1;
    }
    // The quarter it stands in wakes (phase 2K, the interior paints it):
    // only once the body is whole and while it stands; the final look only
    // in its final phase (phase 2L).
    // Mythic's hidden phase: the room's collapse reads the same auras.
    noteHeartCollapse(this.slotKey, boss.auras);
    const hidden = heartCollapseView(this.slotKey);
    noteHeartQuarterBoss(
      this.slotKey,
      boss.pos.x - o.x,
      boss.pos.z - o.z,
      engaged,
      !boss.dead && t >= ARRIVAL_WAVE_AT,
      engaged && (heartFinalPhase(boss.hp, boss.maxHp) || hidden?.stage === 'collapse'),
      // Part 2: the quarters whose Splinters live through a call.
      finalPhaseMaskOf(boss),
    );
    this.readCast(boss);
    this.poseBody(boss, t, dt);
    this.arrivalMoments(t);
    this.prevArrival = t;
    this.updateThreads(t);
    this.updateFlashes();
    this.updateTint(boss, dt);
    this.bodyFx.update({
      boss,
      zone: this.zone,
      whole: t >= ARRIVAL_WAVE_AT,
      forming: arrivalForming(t, ARRIVAL_WAVE_AT, this.deadAt >= 0),
      dead: this.deadAt >= 0,
      kneeling: heartCollapseView(this.slotKey)?.stage === 'kneel',
      clock: this.clock,
      dt,
    });
    this.updateWrath();
    if (this.fistImpactDue > 0 && this.clock >= this.fistImpactDue) {
      this.fistImpactDue = -1;
      this.fistLands(boss);
    }
    this.particles.update(this.clock);
  }

  /** Forge Fist strikes the floor ahead: the stone bursts in its arc. */
  private fistLands(boss: Entity): void {
    const k = this.sim;
    const f = boss.facing;
    const reach = Math.min(k.fistRange - 0.6, 8.2);
    const x = boss.pos.x + Math.sin(f) * reach;
    const z = boss.pos.z + Math.cos(f) * reach;
    const y = this.groundY(x, z);
    this.particles.puff(x, y + 0.4, z, Math.round(22 * this.density) + 4, {
      speed: 6,
      up: 2.5,
      life: 1.5,
      size: [1.4, 4.2],
      color: C.dust,
      alpha: 0.45,
      drag: 1.2,
      radius: 2,
    });
    const half = (k.fistArcDeg * Math.PI) / 360;
    for (let i = 0; i < Math.round(18 * this.density) + 4; i++) {
      const a = f + (this.rand() * 2 - 1) * half;
      const r = 2 + this.rand() * (k.fistRange - 2);
      this.particles.puff(boss.pos.x + Math.sin(a) * r, y + 0.3, boss.pos.z + Math.cos(a) * r, 1, {
        speed: 4,
        up: 7,
        life: 1.0,
        size: [0.45, 0.25],
        color: C.dustDark,
        alpha: 1,
        gravity: 20,
      });
    }
    this.particles.shockRing(x, z, C.ring, k.fistRange * 0.8, 0.45);
    this.flash(x, y + 1, z, 9, 0.3, 0xffd8a0);
    this.shakeNear(x, z, 0.45);
  }

  // ---- the body ------------------------------------------------------------------------------

  /** Room-local yards for a point of the body's frame (the boss's feet, its
   *  facing, its bob, the upper body leaning about the hip). */
  private bodyPoint(
    boss: Entity,
    x: number,
    y: number,
    z: number,
    upper: boolean,
    out: THREE.Vector3,
  ): THREE.Vector3 {
    let ly = y;
    let lz = z;
    if (upper && this.lean !== 0) {
      const hy = COLOSSUS_SLOTS.hip.y;
      const hz = COLOSSUS_SLOTS.hip.z;
      const c = Math.cos(this.lean);
      const s = Math.sin(this.lean);
      const dy = y - hy;
      const dz = z - hz;
      ly = hy + dy * c - dz * s;
      lz = hz + dy * s + dz * c;
    }
    const cf = Math.cos(this.facing);
    const sf = Math.sin(this.facing);
    const bossAt = fxAnchor(boss);
    const bx = bossAt.x - this.originX;
    const bz = bossAt.z - this.originZ;
    const by = this.groundY(bossAt.x, bossAt.z);
    return out.set(
      bx + x * cf + lz * sf,
      by + ly + colossusBreath(this.clock).bob,
      bz - x * sf + lz * cf,
    );
  }

  /** The bar it holds (final_fx_core.ts FINAL_BODY_CASTS: arms raised or
   *  hands cupped) and its fill; a raising bar's end slams both fists into
   *  the floor. */
  private readCast(boss: Entity): void {
    const id = boss.castingAbility ?? null;
    const body = id ? FINAL_BODY_CASTS[id] : undefined;
    if (id && body) {
      this.castProgress = telegraphFillOf(
        boss.castRemaining,
        boss.castTotal > 0 ? boss.castTotal : 1,
      );
      this.castId = id;
      this.castPose = body.pose;
      return;
    }
    if (this.castId) {
      const was = FINAL_BODY_CASTS[this.castId];
      if (was?.slam && !boss.dead) {
        // The arms are already up: the slam starts at the top of its arc.
        this.action = 'fist';
        this.actionAt = this.clock - 0.2 * COLOSSUS_FIST_SECONDS;
        this.fistImpactDue = this.clock + (COLOSSUS_FIST_IMPACT - 0.2) * COLOSSUS_FIST_SECONDS;
      } else if (was?.pose === 'pour') {
        this.pourAt = this.clock;
      }
    }
    this.castId = null;
    this.castPose = null;
    this.castProgress = 0;
  }

  /** The action the body plays this frame and its own clock (0..1). */
  private actionNow(): { action: ColossusAction; k: number } {
    if (this.castPose) return { action: this.castPose, k: this.castProgress };
    const age = this.clock - this.actionAt;
    if (this.action === 'fist' && age < COLOSSUS_FIST_SECONDS)
      return { action: 'fist', k: age / COLOSSUS_FIST_SECONDS };
    if (this.action === 'swing' && age < COLOSSUS_SWING_SECONDS)
      return { action: 'swing', k: age / COLOSSUS_SWING_SECONDS };
    // A released cast eases back from its last pose.
    if (this.clock - this.pourAt < COLOSSUS_RELEASE_SECONDS)
      return { action: 'pour', k: 1 - (this.clock - this.pourAt) / COLOSSUS_RELEASE_SECONDS };
    if (this.clock - this.wrathAt < COLOSSUS_RELEASE_SECONDS)
      return { action: 'wrath', k: 1 - (this.clock - this.wrathAt) / COLOSSUS_RELEASE_SECONDS };
    this.action = 'idle';
    return { action: 'idle', k: 0 };
  }

  /** Every piece's slot this frame (room-local), into its rig's pose. */
  private slotPoses(boss: Entity, dt: number): void {
    // The facing eases round (a colossus turns heavily).
    let df = boss.facing - this.facing;
    df = Math.atan2(Math.sin(df), Math.cos(df));
    this.facing += df * Math.min(1, dt * 4);
    const { action, k } = this.actionNow();
    const fast = action === 'fist' || action === 'swing';
    const follow = Math.min(1, dt * (fast ? 18 : 7));
    let lean = 0;
    for (const s of [-1, 1] as const) {
      const tgt = colossusWristTarget(action, s, k, this.swingSide);
      lean = tgt.lean;
      const w = this.wrist[s < 0 ? 0 : 1];
      w.x += (tgt.wrist.x - w.x) * follow;
      w.y += (tgt.wrist.y - w.y) * follow;
      w.z += (tgt.wrist.z - w.z) * follow;
    }
    // The fake death: it sinks to its knees, bowed; the rebirth lifts it.
    const stage = heartCollapseView(this.slotKey)?.stage;
    const kneelTo = this.deadAt < 0 && stage === 'kneel' ? 1 : 0;
    const kneelRate = stage === 'rebirth' ? 0.2 : kneelTo === 1 ? 0.9 : 1.5;
    const kneelD = kneelTo - this.kneel;
    this.kneel += Math.sign(kneelD) * Math.min(Math.abs(kneelD), kneelRate * dt);
    this.body.position.y = -3.6 * this.kneel * this.kneel * (3 - 2 * this.kneel);
    lean += 0.75 * this.kneel;
    this.lean += (lean - this.lean) * Math.min(1, dt * 6);
    const breath = colossusBreath(this.clock);
    const part =
      action === 'wrath' && this.castPose === 'wrath' ? wrathGather(this.castProgress).part : 0;
    const drift = breath.drift + part;
    const R = COLOSSUS_ARM;
    for (const p of this.pieces) {
      const d = p.def;
      const side = d.side;
      // The piece's drift off its joint (the light stretching between).
      const dx = side * drift * 0.6;
      if (d.joint === 'torso' || d.joint === 'hip' || d.joint === 'head') {
        const s = COLOSSUS_SLOTS[d.joint];
        const lift = d.joint === 'head' ? drift * 0.7 : d.joint === 'hip' ? -drift * 0.5 : 0;
        this.bodyPoint(boss, s.x, s.y + lift, s.z, d.joint !== 'hip', p.pos);
        _e.set(d.joint === 'hip' ? 0 : this.lean, this.facing, 0, 'YXZ');
        p.quat.setFromEuler(_e);
        continue;
      }
      if (d.joint === 'shoulder') {
        const s = COLOSSUS_SLOTS.shoulder;
        this.bodyPoint(boss, side * (s.x + drift * 0.5), s.y + drift * 0.3, s.z, true, p.pos);
        _e.set(this.lean, this.facing, side * -0.12, 'YXZ');
        p.quat.setFromEuler(_e);
        continue;
      }
      if (d.joint === 'shard') {
        const i = p.index - (COLOSSUS_PIECES.length - COLOSSUS_SHARDS.skirt - COLOSSUS_SHARDS.back);
        const s = colossusShardSlot(i, this.clock);
        this.bodyPoint(
          boss,
          s.x * (1 + part * 0.2),
          s.y,
          s.z * (1 + part * 0.2),
          i >= COLOSSUS_SHARDS.skirt,
          p.pos,
        );
        _e.set(
          this.clock * (0.3 + 0.2 * fxHash(7, i)),
          this.clock * 0.25 + i,
          this.clock * 0.2,
          'XYZ',
        );
        p.quat.setFromEuler(_e);
        continue;
      }
      // The arm: its root, the IK to the wrist, the piece on its bone.
      const wl = this.wrist[side < 0 ? 0 : 1];
      const ik = colossusArmIk(
        { x: side * R.root.x + dx, y: R.root.y, z: R.root.z },
        wl,
        R.upper,
        R.fore,
        { x: side * 0.6, y: -0.2, z: -1 },
      );
      const sp = R.root;
      let a: V3;
      let b: V3;
      if (d.joint === 'upper') {
        a = { x: side * sp.x + dx, y: sp.y, z: sp.z };
        b = ik.elbow;
      } else {
        a = ik.elbow;
        b = ik.wrist;
      }
      // The piece's centre along its bone (the fist at the wrist, a breath
      // past it).
      const tm = d.joint === 'fist' ? 1.18 : 0.5;
      const cx = a.x + (b.x - a.x) * tm;
      const cy = a.y + (b.y - a.y) * tm;
      const cz = a.z + (b.z - a.z) * tm;
      this.bodyPoint(boss, cx, cy, cz, true, p.pos);
      // Its axis (+Y) up the bone toward the shoulder.
      this.bodyPoint(boss, a.x, a.y, a.z, true, _v);
      this.bodyPoint(boss, b.x, b.y, b.z, true, _v2);
      _v.sub(_v2).normalize();
      p.quat.setFromUnitVectors(UP, _v);
      _q2.setFromAxisAngle(UP, this.facing);
      p.quat.multiply(_q2);
    }
    // The heart in its socket.
    const h = COLOSSUS_SLOTS.heart;
    const flare =
      action === 'wrath' && this.castPose === 'wrath' ? wrathGather(this.castProgress).glow : 0;
    this.bodyPoint(boss, h.x, h.y + flare * 0.4, h.z + drift * 0.2, true, this.heartPos);
  }

  private poseBody(boss: Entity, t: number, dt: number): void {
    this.bossNow = boss;
    this.slotPoses(boss, dt);
    const dead = this.deadAt >= 0;
    // The model stands whole: the heart is the gem in its chest. It stands
    // from the arrival's first frame (final_arrival_core.ts), so the heart
    // glides into its chest even while it forms.
    const modelWhole = dead || t >= ARRIVAL_WAVE_AT;
    const shown = arrivalModelShown(t, dead);
    // The heart sits in the model's chest (its gem): whole, or glided in.
    const inChest = !dead && (modelWhole || (shown && t >= ARRIVAL.glideEnd));
    if (shown) {
      const at = fxAnchor(boss);
      const h = finalBodyPoint(
        'heart',
        at.x - this.originX,
        this.groundY(at.x, at.z) + this.body.position.y,
        at.z - this.originZ,
        boss.facing,
        FINAL_BODY_HEIGHT *
          (boss.scale > 0 ? boss.scale : 1) *
          (modelWhole ? 1 : ARRIVAL_KNEEL_HEIGHT),
        this.heartAt,
      );
      this.modelHeart.set(h.x, h.y, h.z);
      // Dead: the heart starts from the chest it stood in as it fell.
      if (modelWhole) {
        if (!dead || !this.diedHeartSet) {
          this.diedHeart.set(h.x, h.y, h.z);
          this.diedHeartSet = dead;
        }
        this.heartPos.copy(this.diedHeart);
      }
    }
    if (!dead) this.diedHeartSet = false;
    const deathT = dead ? this.clock - this.deadAt : 0;
    // The heart.
    let heartLevel = 1;
    let flare = 0;
    if (dead) {
      heartLevel = heartDeathLevel(deathT);
      const sink = heartSink(deathT);
      const bed = HEART_CORE_BED_Y + 1;
      this.heartPos.set(
        this.heartPos.x + (HEART_ROOM.x - this.heartPos.x) * sink,
        this.heartPos.y + (bed - this.heartPos.y) * sink - Math.min(1, deathT / 1.2) * 1.5,
        this.heartPos.z + (HEART_ROOM.z - this.heartPos.z) * sink,
      );
    } else if (t < ARRIVAL_END) {
      const slot = shown
        ? { x: this.modelHeart.x, y: this.modelHeart.y, z: this.modelHeart.z }
        : { x: this.heartPos.x, y: this.heartPos.y, z: this.heartPos.z };
      const a = heartArrivalPoint(Math.max(0, t), slot);
      if (t < 0) {
        a.p = { x: HEART_ROOM.x, y: HEART_CORE_BED_Y, z: HEART_ROOM.z };
        a.glow = 0.35;
      }
      this.heartPos.set(a.p.x, a.p.y, a.p.z);
      heartLevel = a.glow;
      const w = arrivalWave(t);
      if (w >= 0) flare = Math.max(0, 1 - w * 3) * 0.8;
      // The pillar of light it rises on, out of its bed: up to the heart,
      // fading once it glides in.
      const pillar =
        t < ARRIVAL.hold
          ? Math.max(0, t - ARRIVAL.hold + 0.6) / 0.6
          : t < ARRIVAL.riseEnd
            ? 1
            : Math.max(0, 1 - (t - ARRIVAL.riseEnd) / 1.2);
      if (t >= 0 && pillar > 0.01) {
        const bx =
          this.originX + (a.rising || t < ARRIVAL.hold ? this.heartPos.x : HEART_RISE_FROM.x);
        const bz =
          this.originZ + (a.rising || t < ARRIVAL.hold ? this.heartPos.z : HEART_RISE_FROM.z);
        // Its foot a little under the rim (its brightest part in the raid's
        // view), the chasm's own glow under it.
        const y0 = HEART_ROOM.h - 14;
        // A column of the heart's light standing up out of the chasm, far
        // over the platform's rim, the heart riding up it.
        const top = HEART_ROOM.h + 70;
        this.riseBeam.position.set(bx, y0, bz);
        this.riseBeam.scale.set(4.2, top - y0, 4.2);
        this.riseMat.uniforms.uK.value = 1.5 * pillar;
        this.riseBeam.visible = true;
      } else {
        this.riseBeam.visible = false;
      }
      flare = Math.max(flare, a.rising ? 0.35 : 0);
      if (a.rising && this.rand() < dt * 30 * this.density) {
        const wx = this.originX + this.heartPos.x;
        const wz = this.originZ + this.heartPos.z;
        this.particles.puff(wx, this.heartPos.y - 1, wz, 2, {
          speed: 2,
          up: -3,
          life: 1.4,
          size: [0.6, 0.12],
          color: C.spark,
          alpha: 1,
          pool: 'glow',
          radius: 1.6,
        });
      }
    } else {
      this.riseBeam.visible = false;
      const c =
        this.castPose === 'wrath'
          ? wrathGather(this.castProgress).glow
          : this.castPose === 'pour'
            ? pourGather(this.castProgress) * 0.7
            : 0;
      flare = c * 0.35 + Math.max(0, 1 - (this.clock - this.burstAt) / 0.4) * 0.8;
    }
    // The fake death dims the heart; each beat of the rebirth flares it, hard.
    const hv = heartCollapseView(this.slotKey);
    if (!dead && hv && hv.stage !== 'none') {
      if (hv.stage === 'kneel') heartLevel *= 1 - 0.8 * this.kneel;
      if (hv.stage === 'rebirth') {
        heartLevel *= 0.5 + 0.5 * Math.min(1, hv.beats / 6);
        flare = Math.max(flare, hv.beat * 1.5);
      }
    }
    this.heartMat.uniforms.uLevel.value = heartLevel;
    this.heartMat.uniforms.uFlare.value = flare;
    this.seamGlow.uniforms.uLevel.value = dead
      ? Math.max(0, heartLevel * 0.8)
      : 0.4 + 0.6 * heartLevel;
    if (this.heartMesh) {
      this.heartMesh.position.copy(this.heartPos);
      _e.set(0, this.clock * 0.3, 0.1 * Math.sin(this.clock * 0.7));
      this.heartMesh.quaternion.setFromEuler(_e);
      // Swollen with light as it rises, settling into the body's socket.
      const swell =
        dead || t >= ARRIVAL.glideEnd || t < 0
          ? 0
          : t < ARRIVAL.riseEnd
            ? 1
            : 1 - (t - ARRIVAL.riseEnd) / (ARRIVAL.glideEnd - ARRIVAL.riseEnd);
      this.heartMesh.scale.setScalar(1.5 + 1.3 * swell);
      // The model's own gem is the heart while it stands; the crystal shows
      // through the arrival and rises out of its chest at its death.
      // Glided into the forming model's chest, its gem takes over too.
      this.heartMesh.visible = !inChest;
    }
    this.heartHalo.visible = true;
    // The halo is in the root's frame (world); the body's group is offset.
    this.heartHalo.position.set(
      this.originX + this.heartPos.x,
      this.heartPos.y,
      this.originZ + this.heartPos.z,
    );
    // The model's gem carries its own light: the halo only warms it.
    const halo =
      (14 + flare * (inChest ? 12 : 30) + (t >= 0 && t < ARRIVAL.glideEnd ? 16 : 0)) *
      Math.max(0.15, heartLevel) *
      (inChest ? 0.5 : 1);
    this.heartHalo.scale.set(halo, halo, 1);
    (this.heartHalo.material as THREE.SpriteMaterial).opacity = 0.55 * Math.max(0.1, heartLevel);
    // Every piece.
    for (const p of this.pieces) {
      const h = p.holder;
      if (modelWhole) {
        // The pieces have locked into the model under the shockwave.
        if (h) h.visible = false;
        if (p.rubble) p.rubble.visible = false;
        continue;
      }
      if (t < 0 || t < ARRIVAL_END) {
        this.poseArrival(p, t, dt);
      } else if (h) {
        h.position.copy(p.pos);
        h.quaternion.copy(p.quat);
        h.visible = true;
      }
      if (p.rubble) p.rubble.visible = false;
    }
  }

  private poseArrival(p: PieceRig, t: number, _dt: number): void {
    const h = p.holder;
    const rest = colossusRestPoint(p.def);
    const tilt = colossusRestTilt(p.def);
    const restY =
      p.def.joint === 'shard'
        ? rest.y
        : this.groundY(this.originX + rest.x, this.originZ + rest.z) + p.def.size * 0.22;
    const ph = t < 0 ? { phase: 'rest' as const, k: 0 } : colossusPiecePhase(p.def, t);
    if (!h) return;
    // Where on the model it flies in (final_arrival_core.ts): the old body
    // is never assembled; a piece is drawn into the stone and gone at its lock.
    const boss = this.bossNow;
    if (boss) {
      const at = fxAnchor(boss);
      finalBodyPoint(
        arrivalAnchor(p.def.joint, p.def.side, p.index),
        at.x - this.originX,
        this.groundY(at.x, at.z) + this.body.position.y,
        at.z - this.originZ,
        boss.facing,
        FINAL_BODY_HEIGHT *
          (boss.scale > 0 ? boss.scale : 1) *
          (arrivalForming(t, ARRIVAL_WAVE_AT, false) ? ARRIVAL_KNEEL_HEIGHT : 1),
        this.anchorAt,
      );
      p.target.set(this.anchorAt.x, this.anchorAt.y, this.anchorAt.z);
    } else p.target.copy(p.pos);
    const mirror = p.def.joint === 'shoulder' && p.def.side < 0 ? -1 : 1;
    h.scale.set(mirror * p.def.scale, p.def.scale, p.def.scale);
    h.visible = true;
    if (ph.phase === 'locked') {
      h.visible = false;
      return;
    }
    _e.set(tilt.x, tilt.y, tilt.z, 'YXZ');
    _q.setFromEuler(_e);
    if (ph.phase === 'rest' || ph.phase === 'tremble') {
      const j = ph.phase === 'tremble' ? 0.12 * ph.k : 0;
      h.position.set(
        rest.x + j * Math.sin(this.clock * 61),
        restY - p.def.size * 0.32 + j * Math.sin(this.clock * 47) * 0.5,
        rest.z + j * Math.cos(this.clock * 53),
      );
      h.quaternion.copy(_q);
      // Shards wait out of sight in the chasm.
      if (p.def.joint === 'shard' && ph.phase === 'rest') h.visible = t >= 0;
      return;
    }
    const lifted = colossusLiftHeight(p.def);
    if (ph.phase === 'lift') {
      const e = 1 - (1 - ph.k) ** 2;
      h.position.set(rest.x, restY - p.def.size * 0.32 + lifted * e, rest.z);
      _q2.setFromAxisAngle(X_AXIS, ph.k * 0.6);
      h.quaternion.copy(_q).multiply(_q2);
      return;
    }
    // Flying in round the heart, tumbling, easing into its slot.
    const from = { x: rest.x, y: restY - p.def.size * 0.32 + lifted, z: rest.z };
    const to = { x: p.target.x, y: p.target.y, z: p.target.z };
    const sink = arrivalPieceScale(ph.k);
    h.scale.multiplyScalar(Math.max(0.001, sink));
    h.visible = sink > 0.01;
    const c = { x: this.heartPos.x, y: this.heartPos.y, z: this.heartPos.z };
    const f = colossusFlyPoint(from, to, c, ph.k, 1.1 + fxHash(23, p.index) * 0.6);
    h.position.set(f.x, f.y, f.z);
    // A trail of the veins' light and grit behind it.
    if (this.rand() < 0.45 * this.density) {
      this.particles.puff(this.originX + f.x, f.y, this.originZ + f.z, 1, {
        speed: 0.6,
        life: 0.9,
        size: [p.def.joint === 'shard' ? 0.5 : 0.9, 0.1],
        color: C.spark,
        alpha: 0.9,
        pool: 'glow',
        radius: p.def.size * 0.3,
      });
    }
    const spin = colossusSpin(ph.k) * this.clock * Math.PI * 2;
    _e.set(spin * 0.7, spin, spin * 0.4, 'XYZ');
    _q2.setFromEuler(_e);
    _q.multiply(_q2);
    h.quaternion.copy(_q);
  }

  /** The arrival's moments as they happen (never replayed for a raid that
   *  sees the heart already awake). */
  private arrivalMoments(t: number): void {
    const prev = this.prevArrival;
    if (prev < 0 || t <= prev || this.deadAt >= 0) return;
    const crossed = (at: number) => prev < at && t >= at && t - at < 0.5;
    const ox = this.originX;
    const oz = this.originZ;
    if (crossed(ARRIVAL.hold)) {
      // The heart stirs in its bed: the chasm flares.
      this.flash(ox + HEART_ROOM.x, HEART_CORE_BED_Y + 4, oz + HEART_ROOM.z, 60, 1.2, 0xffc878);
      this.shakeNear(ox + HEART_ROOM.x, oz + HEART_ROOM.z, 0.25, 120);
    }
    for (const p of this.pieces) {
      const d = p.def;
      const rest = colossusRestPoint(d);
      const wx = ox + rest.x;
      const wz = oz + rest.z;
      const gy = this.groundY(wx, wz);
      const tear = colossusTearAt(d);
      const liftAt = tear + (d.joint === 'shard' ? 0 : ARRIVAL.tremble);
      if (d.joint !== 'shard' && t > tear && t < liftAt && this.rand() < 0.5 * this.density) {
        // Trembling: grit and dust shaken off its foot.
        this.particles.puff(wx, gy + 0.3, wz, 1, {
          speed: 1.2,
          up: 1.2,
          life: 1.1,
          size: [0.8, 2.2],
          color: C.dust,
          alpha: 0.35,
          radius: d.size * 0.5,
        });
      }
      if (crossed(liftAt) && d.joint !== 'shard') {
        // Torn free: a burst of dust and broken stone, a ring, a thud.
        this.particles.puff(wx, gy + 0.4, wz, Math.round(16 + d.size * 3), {
          speed: 5,
          up: 3,
          life: 1.6,
          size: [1.4, 4.5],
          color: C.dust,
          alpha: 0.45,
          drag: 1.1,
          radius: d.size * 0.4,
        });
        this.particles.puff(wx, gy + 0.6, wz, Math.round(10 + d.size), {
          speed: 7,
          up: 6,
          life: 1.2,
          size: [0.35, 0.2],
          color: C.dustDark,
          alpha: 1,
          gravity: 18,
          radius: d.size * 0.3,
        });
        this.particles.shockRing(wx, wz, C.ring, d.size * 1.3, 0.6);
        this.flash(wx, gy + 1, wz, d.size * 2.2, 0.35, 0xffd890);
        this.shakeNear(wx, wz, 0.18 + d.size * 0.02);
      }
      if (crossed(colossusLockAt(d))) {
        // Drawn into the model: a flash and sparks where it sank in, the
        // stone's cracks flaring with it (final_arrival_core.ts).
        const px = ox + p.target.x;
        const pz = oz + p.target.z;
        this.flash(
          px,
          p.target.y,
          pz,
          d.joint === 'shard' ? 4 : 7 + d.size,
          0.45,
          VEINS[p.index % 4],
        );
        if (d.joint !== 'shard') this.bodyFx.pieceDrawnIn();
        this.particles.puff(px, p.target.y, pz, d.joint === 'shard' ? 4 : 12, {
          speed: 6,
          life: 0.6,
          size: [0.3, 0.08],
          color: C.spark,
          alpha: 1,
          pool: 'glow',
          drag: 0.6,
        });
        if (d.joint !== 'shard') this.shakeNear(px, pz, 0.12);
      }
    }
    if (crossed(ARRIVAL_WAVE_AT)) {
      // Whole: the four-colour shockwave across the platform and the chasm.
      const cx = ox + this.heartPos.x;
      const cz = oz + this.heartPos.z;
      // Five crests, the stone showing through the air they leave (the
      // floor is pale: a filled wake or a full flash burns it out flat).
      const W = ARRIVAL_WAVE_LOOK;
      for (let i = 0; i < 4; i++)
        this.particles.shockRing(cx, cz, VEINS[i], 36 + i * 14, 1.2 + i * 0.3, W.ring);
      this.particles.shockRing(cx, cz, C.ring, 90, 2.2, W.ring);
      this.flash(cx, this.heartPos.y, cz, 80, 1.1, 0xffeed0, W.flash);
      this.flash(cx, this.heartPos.y + 6, cz, 40, 0.5, 0xffffff, W.core);
      // The veins' light flung out of the heart in every direction.
      for (let i = 0; i < Math.round(70 * this.density) + 10; i++) {
        const a = this.rand() * Math.PI * 2;
        this.particles.puff(cx, this.heartPos.y, cz, 1, {
          speed: 26 + this.rand() * 16,
          life: 1.1,
          size: [0.6, 0.12],
          color: C.spark,
          alpha: 1,
          pool: 'glow',
          dir: [Math.cos(a), -0.15 + this.rand() * 0.5, Math.sin(a)],
          spread: 0.12,
          drag: 0.7,
        });
      }
      this.particles.puff(cx, this.groundY(cx, cz) + 0.5, cz, 40, {
        speed: 16,
        up: 1,
        life: 1.6,
        size: [2, 6],
        color: C.dust,
        alpha: 0.4,
        drag: 1.4,
        radius: 4,
      });
      this.shakeNear(cx, cz, 1.0, 140);
    }
  }

  // ---- the threads ------------------------------------------------------------------------------

  private updateThreads(t: number): void {
    const dead = this.deadAt >= 0;
    if (dead || t >= ARRIVAL_WAVE_AT) {
      // The model stands whole: no piece to stitch.
      if (this.threads.visible) {
        for (const p of this.pieces) this.threads.setMatrixAt(p.index, _m.makeScale(0, 0, 0));
        this.threads.instanceMatrix.needsUpdate = true;
        this.threads.visible = false;
      }
      return;
    }
    const deathT = dead ? this.clock - this.deadAt : 0;
    const hx = this.originX + this.heartPos.x;
    const hz = this.originZ + this.heartPos.z;
    const hy = this.heartPos.y;
    let any = false;
    for (const p of this.pieces) {
      const lockAt = colossusLockAt(p.def);
      let k = 0;
      if (dead) {
        const plan = p.fall;
        k = plan && deathT < plan.start ? 1 : 0;
      } else if (t >= lockAt) {
        // Drawn into the model's stone: nothing left to stitch.
        k = 0;
      } else if (t >= 0) {
        // Reaching for a flying piece: a thin thread already.
        const ph = colossusPiecePhase(p.def, t);
        if (ph.phase === 'fly') k = ph.k * 0.5;
      }
      if (k <= 0.001 || !p.holder) {
        this.threads.setMatrixAt(p.index, _m.makeScale(0, 0, 0));
        continue;
      }
      any = true;
      const px = this.originX + p.holder.position.x;
      const pz = this.originZ + p.holder.position.z;
      const py = p.holder.position.y;
      _v.set(px - hx, py - hy, pz - hz);
      const len = _v.length();
      _v.normalize();
      _q.setFromUnitVectors(UP, _v);
      const w =
        (p.def.joint === 'shard' ? 0.07 : 0.16) * (0.8 + 0.4 * Math.sin(this.clock * 3 + p.index));
      _m.compose(_v2.set(hx, hy, hz), _q, _s.set(w, len * 0.92, w));
      this.threads.setMatrixAt(p.index, _m);
      const pulse = 0.55 + 0.45 * Math.sin(this.clock * 4.1 - len * 0.5 + p.index * 1.3);
      this.threadColor.setHex(VEINS[p.index % 4]).multiplyScalar(k * pulse * 1.2);
      this.threads.setColorAt(p.index, this.threadColor);
    }
    this.threads.visible = any;
    this.threads.instanceMatrix.needsUpdate = true;
    if (this.threads.instanceColor) this.threads.instanceColor.needsUpdate = true;
  }

  private updateFlashes(): void {
    for (const f of this.flashes) {
      const age = this.clock - f.born;
      if (age > f.span) {
        f.sprite.visible = false;
        continue;
      }
      const k = age / f.span;
      const s = f.size * (0.6 + 0.6 * k);
      f.sprite.scale.set(s, s, 1);
      (f.sprite.material as THREE.SpriteMaterial).opacity = f.peak * (1 - k) * (1 - k);
    }
  }

  // ---- the death ------------------------------------------------------------------------------

  private startFall(alreadyFor: number): void {
    for (const p of this.pieces) {
      p.diedPos.copy(p.holder ? p.holder.position : p.pos);
      p.diedQuat.copy(p.holder ? p.holder.quaternion : p.quat);
      p.fall = colossusFallPlan(p.def, { x: p.diedPos.x, y: p.diedPos.y, z: p.diedPos.z }, p.index);
      p.landed = alreadyFor > p.fall.start + DEATH.fallSeconds;
    }
    if (alreadyFor < 0.5) {
      const cx = this.originX + this.heartPos.x;
      const cz = this.originZ + this.heartPos.z;
      this.flash(cx, this.heartPos.y, cz, 30, 0.8, 0xffd8a0);
      this.shakeNear(cx, cz, 0.6, 120);
    }
  }

  private resetFall(): void {
    for (const p of this.pieces) {
      p.fall = null;
      p.landed = false;
      if (p.rubble) p.rubble.visible = false;
    }
  }

  // ---- the quarter it drinks --------------------------------------------------------------

  /** The seams burn in the colour of the quarter it stands in (white-gold in
   *  the ring): the strength it drinks reads on its body from anywhere in the
   *  room, on every tier. */
  private updateTint(boss: Entity, dt: number): void {
    let state: Entity['auras'][number] | undefined;
    for (const a of boss.auras)
      if (a.id === FINAL_AURAS.state) {
        state = a;
        break;
      }
    const zone = finalZoneOf(state?.value);
    this.zone = zone;
    if (zone === 'ring') this.seamTarget.setHex(C.seam);
    else this.seamTarget.setHex(SMITH_HEART_VEIN_COLORS[zone]);
    this.seamTint.lerp(this.seamTarget, Math.min(1, dt * 2.5));
    const u = this.seamGlow.uniforms.uColor.value as THREE.Color;
    u.copy(this.seamTint).multiplyScalar(1.8);
    (this.heartHalo.material as THREE.SpriteMaterial).color.copy(this.seamTint);
  }

  // ---- the Overload Burst and its pulses ---------------------------------------------------

  /** A bar's burst (`big` 1: the wall of light over the whole Anvil, the
   *  heart's flash, the camera's thud) or a pulse (`big` 0: a low ring of the
   *  quarter's light off the body). */
  private burstLands(e: Entity, big: 0 | 1): void {
    const hx = this.originX + this.heartPos.x;
    const hz = this.originZ + this.heartPos.z;
    this.burstTint.copy(this.seamTarget);
    const tint = this.burstTint.getHex();
    if (!big) {
      this.particles.shockRing(e.pos.x, e.pos.z, tint, 16, 0.55);
      this.flash(hx, this.heartPos.y, hz, 22, 0.35, tint);
      return;
    }
    this.burstAt = this.clock;
    const y = this.groundY(e.pos.x, e.pos.z);
    this.wrathWall.position.set(e.pos.x, y, e.pos.z);
    (this.wrathMat.uniforms.uGold.value as THREE.Color).copy(this.burstTint);
    this.wrathWall.visible = true;
    // The heart's flash: bright and short, sized to the heart, not the room
    // (Jose's playtest: the old 70 yd flash hid the whole screen).
    this.flash(hx, this.heartPos.y, hz, 18, 0.35, tint);
    // Two rings off the body; the wall of light carries the wave over the
    // rest of the Anvil. (A ring the room's size laid its pale wake over the
    // whole floor: Jose's playtest, the disc that hid the screen.)
    this.particles.shockRing(e.pos.x, e.pos.z, tint, 14, 0.6);
    this.particles.shockRing(e.pos.x, e.pos.z, tint, 26, 0.7);
    for (let i = 0; i < Math.round(70 * this.density); i++) {
      const a = this.rand() * Math.PI * 2;
      this.particles.puff(hx, this.heartPos.y, hz, 1, {
        speed: 22 + this.rand() * 16,
        life: 0.9,
        size: [0.55, 0.1],
        color: C.spark,
        alpha: 1,
        pool: 'glow',
        dir: [Math.cos(a), -0.25 + this.rand() * 0.3, Math.sin(a)],
        spread: 0.1,
        drag: 0.6,
      });
    }
    this.shakeNear(e.pos.x, e.pos.z, 0.8, this.sim.burstRadius + 30);
  }

  private updateWrath(): void {
    // Over a raising bar: the light drawn into the heart.
    if (this.castPose === 'wrath' && this.rand() < 0.9 * this.density) {
      const g = wrathGather(this.castProgress);
      const hx = this.originX + this.heartPos.x;
      const hz = this.originZ + this.heartPos.z;
      const a = this.rand() * Math.PI * 2;
      const r = 10 + this.rand() * 16;
      this.particles.puff(
        hx + Math.cos(a) * r,
        this.heartPos.y - 4 + this.rand() * 8,
        hz + Math.sin(a) * r,
        1,
        {
          speed: r * 1.4,
          life: 0.7,
          size: [0.45, 0.12],
          color: C.spark,
          alpha: g.glow,
          pool: 'glow',
          dir: [-Math.cos(a), 0, -Math.sin(a)],
          spread: 0.05,
          drag: 0.2,
        },
      );
    }
    if (!this.wrathWall.visible) return;
    const R = this.sim.burstRadius;
    const age = this.clock - this.burstAt;
    const wave = novaWave(age, R);
    const look = wrathBlastLook(age, wave.front / R);
    if (age > NOVA_WAVE_SECONDS + 1.2) {
      this.wrathWall.visible = false;
      return;
    }
    const r = Math.max(0.5, wave.front);
    this.wrathWall.scale.set(r, 4 + 5 * look.glow, r);
    this.wrathMat.uniforms.uAlpha.value = look.wall * wave.alpha * 0.6;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.particles.dispose();
    this.bodyFx.dispose();
    this.threads.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
