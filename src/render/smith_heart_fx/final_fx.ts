// The Masterless Strength's effects round its own model (plan:
// final_fx_core.ts; the model's clips, element bodies and auras are
// final_body_fx.ts's), hosted by ../rift_death_zone.ts beside the guardians'.
// Presentation only, read from IWorld (the boss's position, facing, cast bar,
// death, its events) and from the seal memory's arrival (`awakeSince`, the
// seal markers' arrival bit), so offline and online look the same:
//  - the arrival (final_arrival_core.ts, painted by final_arrival_beam.ts):
//    the boss dormant on its knee like a cracked statue, the four veins'
//    light running across the floor to it, the giant beam they fuse into,
//    its collapse back into the boss, the boss rising and roaring with a
//    four-colour shockwave. A pull during it runs the scene on to its end at
//    once; a raid that first sees the heart already awake sees it standing;
//  - the heart in its chest: its halo, dark while it sleeps, flaring as the
//    beam lands, in the colour of the quarter it drinks (the state aura,
//    encounters/smith_heart/final_ids.ts), white-gold in the ring;
//  - Forge Fist's floor strike: dust and broken stone across its arc, a
//    ring, a short shake;
//  - an Overload Burst: the heart's flash and a wall of the quarter's light
//    riding out over the whole Anvil on the trash engine's wave clock, a
//    pulse a low ring of it (the bars themselves are the HUD's, the floor's
//    light the room's);
//  - the death (final_death_core.ts, painted by final_death_fx.ts): the
//    body kneels and its essence tears free: the heart (the Heart kit's
//    crystal) rips out of its chest and bursts into four comets that race
//    to their altars and down the spiral grooves into the central well,
//    plunging into the pit; the room goes dark with it
//    (../smith_heart/heart_final_core.ts). A dev replay cue
//    (FINAL_DEV_CUES.deathReplay, `/dev heart final death`) plays it on a
//    living body.
// Cosmetic layers thin on the low tier (particles) and under reduced
// motion (the shake); the model, the scene and the timelines never do.
//
// Rules (src/render/CLAUDE.md): every material is built in the constructor
// under the root before its gated attach (the kit's heart crystal, which
// lands later, draws with this module's own heart shader, linked by its
// hidden carrier); no light; fixed pools, no per-frame allocation.

import * as THREE from 'three';
import { SMITH_HEART_VEIN_COLORS, type SmithHeartVein } from '../../sim/content/smith_heart_layout';
import { heartFinalPhase } from '../../sim/content/smith_heart_quarters';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
import {
  FINAL_AURAS,
  FINAL_CUES,
  FINAL_DEV_CUES,
  finalZoneOf,
} from '../../sim/encounters/smith_heart/final_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import { telegraphFillOf } from '../floor_telegraph';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { sharedUniforms } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { noteHeartArrivalLight } from '../smith_heart/heart_arrival_light_core';
import { heartCollapseView, noteHeartCollapse } from '../smith_heart/heart_collapse_core';
import { noteHeartFinalDeath } from '../smith_heart/heart_final_core';
import {
  ensureHeartKit,
  heartKitLoaded,
  heartKitMeshes,
  SMITH_HEART_HEART_KIT_URL,
} from '../smith_heart/heart_kit';
import { noteHeartQuarterBoss } from '../smith_heart/heart_quarters_core';
import { heartSealSlotKey, heartSealView, newHeartSealView } from '../smith_heart/heart_seal_core';
import { radialGlowTexture } from '../textures';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import { NOVA_WAVE_SECONDS, novaWave } from '../trash_engine_fx/trash_engine_fx_core';
import { entranceBudgetNow } from './entrance_budget';
import { FinalArrivalBeam, type FinalArrivalFrame } from './final_arrival_beam';
import {
  ARRIVAL_END,
  ARRIVAL_KNEEL_HEIGHT,
  ARRIVAL_SKIP_SECONDS,
  ARRIVAL_VEINS,
  ARRIVAL_WAVE_AT,
  arrivalAltarLevel,
  arrivalDark,
  arrivalForming,
  arrivalHeartLevel,
  arrivalHeightShare,
  arrivalSkyFlare,
  arrivalStance,
} from './final_arrival_core';
import { FINAL_BODY_HEIGHT, finalBodyPoint } from './final_body_core';
import { FinalBodyFx } from './final_body_fx';
import {
  DEATH_END,
  DEATH_TEAR,
  DEATH_VEINS,
  type DeathCrystalLook,
  deathAltarLevel,
  deathCrystal,
  deathHoverPoint,
  deathKneel,
  deathSceneTime,
  deathSkyFlare,
} from './final_death_core';
import { type FinalDeathFrame, FinalDeathFx } from './final_death_fx';
import {
  COLOSSUS_FIST_IMPACT,
  COLOSSUS_FIST_SECONDS,
  FINAL_BODY_CASTS,
  FINAL_BOSS,
  FINAL_FX_COLORS,
  FORGE_FIST_CUE,
  finalBossKit,
  pourGather,
  wrathBlastLook,
  wrathGather,
} from './final_fx_core';
import { finalPhaseMaskOf } from './final_phase_fx_core';

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
  float a = uAlpha * (1.0 - smoothstep(top - 0.3, top, vUv.y)) * pow(max(1.0 - vUv.y, 0.0), 1.6);
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

const _e = new THREE.Euler();
const ARRIVAL_LIGHT = {
  veins: { hammer: 1, breath: 1, quench: 1, heat: 1 } as Record<SmithHeartVein, number>,
  flare: 0,
};

export class FinalFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly body = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly density: number;
  /** The tier draws the arrival's cosmetic doubles (entrance_budget_core.ts). */
  private readonly secondary: boolean;
  private readonly particles: EngineParticles;
  private readonly sim = finalBossKit();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
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
  private readonly wrathWall: THREE.Mesh;
  private readonly wrathMat: THREE.ShaderMaterial;
  private readonly view = newHeartSealView();
  private readonly heartPos = new THREE.Vector3();
  /** The fake death's kneel, 0 to 1. */
  private kneel = 0;
  private built = false;
  private bossId = -1;
  private scanTimer = 0;
  private clock = 0;
  private seed = 0x5a17;
  private disposed = false;
  private originX = 0;
  private originZ = 0;
  private slotKey = '';
  private prevArrival = -1;
  private skipAt = -1;
  private skipFrom = 0;
  /** When the body died on this clock (it may be negative: a corpse first
   *  seen dead is dated long before), and whether it is dead at all. */
  private deadAt = 0;
  private deadKnown = false;
  private seenAlive = false;
  private castId: string | null = null;
  private castProgress = 0;
  /** The pose the running bar holds ('wrath' arms up, 'pour' cupped). */
  private castPose: 'wrath' | 'pour' | null = null;
  private burstAt = -99;
  /** The heart's colour easing toward the quarter it drinks. */
  private readonly seamTint = new THREE.Color(C.seam);
  private readonly seamTarget = new THREE.Color(C.seam);
  private readonly burstTint = new THREE.Color(C.seam);
  private fistImpactDue = -1;
  private bossHitAt = -99;
  /** Its own model: the element bodies, the transformation, the auras. */
  private readonly bodyFx: FinalBodyFx;
  /** The arrival's veins, beam and moments, and the frame handed to them
   *  (one object, refilled each update). */
  private readonly arrival: FinalArrivalBeam;
  private readonly frame: FinalArrivalFrame = {
    t: -1,
    prev: -1,
    ox: 0,
    oz: 0,
    footX: 0,
    footY: 0,
    footZ: 0,
    chestY: 0,
    eyeX: 0,
    eyeY: 0,
    eyeZ: 0,
    facing: 0,
    dead: true,
    dt: 0,
  };
  private readonly heartAt = { x: 0, y: 0, z: 0 };
  private readonly eyeAt = { x: 0, y: 0, z: 0 };
  private zone: ReturnType<typeof finalZoneOf> = 'ring';
  /** The chest the crystal tears from (instance-local), held from the death. */
  private readonly diedHeart = new THREE.Vector3();
  private diedHeartSet = false;
  /** The death: its painter, its clock (seconds into the scene, -1 none)
   *  and last frame's, a dev replay's start, the frame handed over. */
  private readonly death: FinalDeathFx;
  private deathT = -1;
  private prevDeath = -1;
  private replayAt = -1;
  private readonly crystal: DeathCrystalLook = {
    shown: false,
    lift: 0,
    scale: 1,
    spin: 0,
    level: 1,
    flare: 0,
    halo: 0,
  };
  private readonly hover = { x: 0, y: 0, z: 0 };
  private crystalSpin = 0;
  private readonly deathFrame: FinalDeathFrame = {
    t: -1,
    prev: -1,
    replay: false,
    bossId: -1,
    ox: 0,
    oz: 0,
    footX: 0,
    footY: 0,
    footZ: 0,
    chestX: 0,
    chestY: 0,
    chestZ: 0,
    facing: 0,
    dt: 0,
  };

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
    // The fight's richness rides the arrival's tier: one budget
    // (entrance_budget_core.ts), the arrival's sky crown and beam sheath its
    // cosmetic doubles (final_arrival_beam.ts `rich`).
    const budget = entranceBudgetNow('final');
    this.density = budget.share;
    this.secondary = budget.secondary;
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
    // The heart's own shader, with a hidden carrier so the compile gate
    // links it before the kit lands.
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
    this.materials.push(this.heartMat);
    const carrierGeo = new THREE.BufferGeometry();
    carrierGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    carrierGeo.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3),
    );
    carrierGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(9).fill(1), 3));
    this.geometries.push(carrierGeo);
    const carrier = new THREE.Mesh(carrierGeo, this.heartMat);
    carrier.visible = false;
    carrier.frustumCulled = false;
    carrier.name = 'smithHeartColossusCarrier';
    this.root.add(carrier);
    // The heart's halo and the flashes (the scene's beats, the blast).
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
    this.heartHalo.name = 'smithHeartColossusHalo';
    this.heartHalo.visible = false;
    this.root.add(this.heartHalo);
    for (let i = 0; i < 10; i++) {
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
    this.body.name = 'smithHeartColossus';
    this.body.visible = false;
    this.root.add(this.body);
    const host = {
      particles: this.particles,
      density: this.density,
      secondary: this.secondary,
      flash: (x: number, y: number, z: number, size: number, span: number, color: number) =>
        this.flash(x, y, z, size, span, color),
      shakeNear: (x: number, z: number, amount: number, reach?: number) =>
        this.shakeNear(x, z, amount, reach),
      rand: () => this.rand(),
      groundY: (x: number, z: number) => this.groundY(x, z),
    };
    this.bodyFx = new FinalBodyFx(this.root, host, playGesture);
    this.arrival = new FinalArrivalBeam(this.root, host);
    this.death = new FinalDeathFx(this.root, {
      ...host,
      reducedMotion: () => this.reducedMotion(),
      playGesture,
    });
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
    // The heart crystal is the Heart kit's: built the moment it has landed.
    if (heartKitLoaded(SMITH_HEART_HEART_KIT_URL)) this.buildHeart();
    else if (hasDom)
      void ensureHeartKit(SMITH_HEART_HEART_KIT_URL).then(() => {
        if (!this.disposed && heartKitLoaded(SMITH_HEART_HEART_KIT_URL)) this.buildHeart();
      });
  }

  /** The heart crystal (the kit's mesh on this module's heart shader): it
   *  shows only as it rises out of the fallen body's chest. */
  private buildHeart(): void {
    if (this.built) return;
    this.built = true;
    const g = heartKitMeshes(SMITH_HEART_HEART_KIT_URL, 'Kit_HeartCrystal');
    if (!g) return;
    for (const m of g.children)
      if (m instanceof THREE.Mesh) {
        if (m.name.endsWith(':glow')) m.material = this.heartMat;
        m.castShadow = false;
      }
    g.name = 'smithHeartColossusHeart';
    g.visible = false;
    this.heartMesh = g;
    this.body.add(g);
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

  /** Claims only the dev replay cue (a presentation trigger with no draw of
   *  its own); the fight's cues are never claimed, the renderer's own draws
   *  still play under these. */
  handleEvent(ev: SimEvent): boolean {
    if (!this.world || this.disposed) return false;
    if (ev.type === 'spellfx' && ev.ability === FINAL_DEV_CUES.deathReplay) {
      const e = this.world.entities.get(ev.sourceId);
      if (e && e.templateId === FINAL_BOSS && !e.dead) this.replayAt = this.clock;
      return true;
    }
    if (ev.type === 'damage') {
      if (ev.sourceId === this.bossId || ev.targetId === this.bossId) this.bossHitAt = this.clock;
      return false;
    }
    if (ev.type !== 'spellfx') return false;
    const e = this.world.entities.get(ev.sourceId);
    if (!e || e.templateId !== FINAL_BOSS) return false;
    if (ev.fx === 'windup' && ev.ability === FORGE_FIST_CUE) {
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
      if (this.slotKey) noteHeartArrivalLight(this.slotKey, null);
      this.arrival.hide();
      this.death.hide();
      this.particles.update(this.clock);
      return;
    }
    const def = DUNGEONS.smith_heart;
    if (!def) return;
    const o = instanceOrigin(def.index, instanceSlotForZ(boss.pos.z));
    if (o.x !== this.originX || o.z !== this.originZ || !this.slotKey) {
      if (this.slotKey) noteHeartArrivalLight(this.slotKey, null);
      this.originX = o.x;
      this.originZ = o.z;
      this.slotKey = heartSealSlotKey(o.x, o.z);
      this.prevArrival = -1;
      this.skipAt = -1;
      this.deadKnown = false;
      this.seenAlive = false;
      this.replayAt = -1;
      this.prevDeath = -1;
    }
    this.body.visible = true;
    this.body.position.set(o.x, 0, o.z);
    const now = sharedUniforms.uTime.value;
    heartSealView(this.slotKey, now, this.view);
    // The death: first seen already dead, the fall has long settled.
    if (boss.dead) {
      if (!this.deadKnown) {
        this.deadKnown = true;
        this.deadAt = this.seenAlive ? this.clock : this.clock - DEATH_END - 1;
        this.replayAt = -1;
      }
    } else {
      this.deadKnown = false;
      this.seenAlive = true;
    }
    const dead = this.deadKnown;
    // The death's clock (a dev replay plays it on the living body).
    this.deathT = deathSceneTime(this.clock, this.deadAt, this.replayAt, dead);
    const replaying = !dead && this.deathT >= 0;
    if (!dead && !replaying) this.replayAt = -1;
    noteHeartFinalDeath(this.slotKey, this.deathT >= 0 ? now - this.deathT : null);
    // The arrival's clock: a heart asleep is -1. Engaged: online a mob's
    // in-combat bit is not mirrored, so a cast, a wound or a blow traded with
    // it counts too.
    const engaged =
      boss.inCombat ||
      !!boss.castingAbility ||
      boss.hp < boss.maxHp ||
      this.clock - this.bossHitAt < 1;
    let t = this.view.awakeSince;
    if (t < 0) {
      // Fought (or fallen) with no arrival seen (the markers' bit out of
      // view): it stands, lit and whole, never a dormant statue in a fight.
      if (dead || engaged) t = ARRIVAL_END + 1;
      else this.skipAt = -1;
    } else if (this.skipAt >= 0 || (t < ARRIVAL_END && engaged)) {
      // A pull during the scene runs it on to its end at once, and once
      // running on it never runs back (a blow's flicker online, a reset).
      if (this.skipAt < 0) {
        this.skipAt = this.clock;
        this.skipFrom = t;
      }
      t = Math.max(
        t,
        Math.min(
          ARRIVAL_END,
          this.skipFrom +
            ((this.clock - this.skipAt) / ARRIVAL_SKIP_SECONDS) * (ARRIVAL_END - this.skipFrom),
        ),
      );
    }
    // The quarter it stands in wakes (phase 2K, the interior paints it):
    // only once it has roared awake and while it stands; the final look only
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
    const falseDeath = !dead && hidden?.stage === 'kneel';
    this.poseHeart(boss, t, dt, falseDeath);
    // The room's altars and sky through the scene (the interior reads it):
    // the death's while it plays, else the arrival's.
    if (this.deathT >= 0 && this.deathT < DEATH_END) {
      for (let i = 0; i < DEATH_VEINS.length; i++)
        ARRIVAL_LIGHT.veins[DEATH_VEINS[i]] = deathAltarLevel(this.deathT, i);
      ARRIVAL_LIGHT.flare = deathSkyFlare(this.deathT);
      noteHeartArrivalLight(this.slotKey, ARRIVAL_LIGHT);
    } else if (!dead && t < ARRIVAL_END) {
      for (let i = 0; i < ARRIVAL_VEINS.length; i++)
        ARRIVAL_LIGHT.veins[ARRIVAL_VEINS[i]] = arrivalAltarLevel(t, i);
      ARRIVAL_LIGHT.flare = arrivalSkyFlare(t);
      noteHeartArrivalLight(this.slotKey, ARRIVAL_LIGHT);
    } else noteHeartArrivalLight(this.slotKey, null);
    const at = fxAnchor(boss);
    const fr = this.frame;
    fr.t = t;
    fr.prev = this.prevArrival;
    fr.ox = o.x;
    fr.oz = o.z;
    fr.footX = at.x;
    fr.footY = this.groundY(at.x, at.z);
    fr.footZ = at.z;
    fr.chestY = this.heartAt.y;
    fr.eyeX = this.originX + this.eyeAt.x;
    fr.eyeY = this.eyeAt.y;
    fr.eyeZ = this.originZ + this.eyeAt.z;
    fr.facing = boss.facing;
    fr.dead = dead;
    fr.dt = dt;
    this.arrival.update(fr);
    this.prevArrival = t;
    const df = this.deathFrame;
    df.t = this.deathT;
    df.prev = this.prevDeath;
    df.replay = replaying;
    df.bossId = boss.id;
    df.ox = o.x;
    df.oz = o.z;
    df.footX = at.x;
    df.footY = fr.footY;
    df.footZ = at.z;
    df.chestX = this.diedHeart.x;
    df.chestY = this.diedHeart.y;
    df.chestZ = this.diedHeart.z;
    df.facing = boss.facing;
    df.dt = dt;
    this.death.update(df);
    this.prevDeath = this.deathT;
    this.updateFlashes();
    this.updateTint(boss, dt);
    this.bodyFx.update({
      boss,
      zone: this.zone,
      whole: dead || t >= ARRIVAL_WAVE_AT,
      forming: arrivalForming(t, dead),
      // A dev replay kneels the living body (its Kneel clip, the corpse's
      // death clip too) and stands it back up at its end.
      stance: arrivalStance(t, dead, falseDeath || replaying),
      dark: arrivalDark(t, dead),
      dead: dead || replaying,
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
        // The arms are already up: the slam lands a moment after the bar.
        this.fistImpactDue = this.clock + (COLOSSUS_FIST_IMPACT - 0.2) * COLOSSUS_FIST_SECONDS;
      }
    }
    this.castId = null;
    this.castPose = null;
    this.castProgress = 0;
  }

  // ---- the heart ------------------------------------------------------------------------------

  /** The heart in the model's chest (and its eyes) this frame, its halo, and
   *  the crystal rising out of the fallen body. */
  private poseHeart(boss: Entity, t: number, dt: number, falseDeath: boolean): void {
    const dying = this.deathT >= 0;
    const dead = this.deadKnown;
    // The false death (Mythic) sinks it to its knee; the rebirth lifts it.
    // Dying (or a replay), it drops to its knee with its Kneel clip.
    const hv = heartCollapseView(this.slotKey);
    const kneelTo = falseDeath ? 1 : dying ? deathKneel(this.deathT) : 0;
    const kneelRate = hv?.stage === 'rebirth' ? 0.2 : kneelTo === 1 ? 0.9 : 1.5;
    const kneelD = kneelTo - this.kneel;
    this.kneel += Math.sign(kneelD) * Math.min(Math.abs(kneelD), kneelRate * dt);
    const share = arrivalHeightShare(t, dead) * (1 - this.kneel * (1 - ARRIVAL_KNEEL_HEIGHT));
    const at = fxAnchor(boss);
    const height = FINAL_BODY_HEIGHT * (boss.scale > 0 ? boss.scale : 1) * share;
    const lx = at.x - this.originX;
    const lz = at.z - this.originZ;
    const ly = this.groundY(at.x, at.z);
    finalBodyPoint('heart', lx, ly, lz, boss.facing, height, this.heartAt);
    finalBodyPoint('head', lx, ly, lz, boss.facing, height, this.eyeAt);
    // Dying: the crystal tears from the chest it knelt with (held from the
    // tear, so the comets leave from where it hung).
    const held = dying && this.deathT >= DEATH_TEAR;
    if (!held || !this.diedHeartSet) {
      this.diedHeart.set(this.heartAt.x, this.heartAt.y, this.heartAt.z);
      this.diedHeartSet = held;
    }
    this.heartPos.copy(this.diedHeart);
    let heartLevel = 1;
    let flare = 0;
    const cr = deathCrystal(this.deathT, this.crystal);
    if (dying) {
      // The struggle throbs in the chest; torn out, it climbs to its hover
      // point spinning and blazing, then bursts (the painter's comets).
      deathHoverPoint(this.diedHeart, this.hover);
      this.heartPos.y += (this.hover.y - this.diedHeart.y) * cr.lift;
      heartLevel = cr.level;
      flare = cr.flare;
      this.crystalSpin += cr.spin * dt;
    } else if (t < ARRIVAL_END) {
      const lv = arrivalHeartLevel(t);
      heartLevel = Math.min(1, lv);
      flare = Math.max(0, lv - 1);
    } else {
      const c =
        this.castPose === 'wrath'
          ? wrathGather(this.castProgress).glow
          : this.castPose === 'pour'
            ? pourGather(this.castProgress) * 0.7
            : 0;
      flare = c * 0.35 + Math.max(0, 1 - (this.clock - this.burstAt) / 0.4) * 0.8;
    }
    // The fake death dims the heart; each beat of the rebirth flares it, hard.
    if (!dead && hv && hv.stage !== 'none') {
      if (hv.stage === 'kneel') heartLevel *= 1 - 0.8 * this.kneel;
      if (hv.stage === 'rebirth') {
        heartLevel *= 0.5 + 0.5 * Math.min(1, hv.beats / 6);
        flare = Math.max(flare, hv.beat * 1.5);
      }
    }
    this.heartMat.uniforms.uLevel.value = heartLevel;
    this.heartMat.uniforms.uFlare.value = flare;
    if (this.heartMesh) {
      this.heartMesh.position.copy(this.heartPos);
      _e.set(
        0.25 * Math.sin(this.crystalSpin * 0.3),
        this.clock * 0.3 + this.crystalSpin,
        0.1 * Math.sin(this.clock * 0.7),
      );
      this.heartMesh.quaternion.setFromEuler(_e);
      this.heartMesh.scale.setScalar(cr.shown ? cr.scale : 1.5);
      // The model's own gem is the heart while it stands; the crystal tears
      // out of its chest at its death.
      this.heartMesh.visible = cr.shown;
    }
    // The halo is in the root's frame (world); the body's group is offset.
    // Asleep it is all but out; the model's gem carries its own light.
    // Dying, it is the struggle's throb and the torn crystal's blaze, gone
    // with the burst (and on a husk long dead).
    const halo = dying
      ? cr.halo
      : (14 + flare * 16) * Math.max(0.15, heartLevel) * (dead ? 1 : 0.5);
    this.heartHalo.visible = dying ? cr.halo > 0 : heartLevel > 0.05 || flare > 0;
    this.heartHalo.position.set(
      this.originX + this.heartPos.x,
      this.heartPos.y,
      this.originZ + this.heartPos.z,
    );
    this.heartHalo.scale.set(halo, halo, 1);
    (this.heartHalo.material as THREE.SpriteMaterial).opacity =
      0.55 * Math.min(1, Math.max(0.1, heartLevel) + flare * 0.3);
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

  // ---- the quarter it drinks --------------------------------------------------------------

  /** The heart's light takes the colour of the quarter it stands in
   *  (white-gold in the ring). */
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
    if (this.slotKey) noteHeartArrivalLight(this.slotKey, null);
    this.root.removeFromParent();
    this.particles.dispose();
    this.bodyFx.dispose();
    this.arrival.dispose();
    this.death.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
