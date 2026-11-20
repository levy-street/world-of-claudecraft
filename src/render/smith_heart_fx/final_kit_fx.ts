// The Masterless Strength's quarter kits' look (plan: final_kit_fx_core.ts;
// design doc 7.5), hosted by ../rift_death_zone.ts beside FinalFx (its body,
// the Overload Burst) and HeatFx (Basalt Fist's spot, its lanes and its
// Molten Swells, which the final reuses whole). Read from IWorld (the fight's
// objects, the boss's bar and auras, the players' marks, the cues), so
// offline and online look the same:
//   - every footprint at the sim's exact radius through the shared floor
//     telegraph on EVERY tier, dressed in its quarter's element at the Heat
//     telegraph's bar (final_telegraphs.ts): a Fire Whirl's, a burning
//     pool's and an Ember Mark's in the molten basalt; a Groaning Ice crack
//     (lethal, frost creeping in to its break) in frost; a Storm Orb (the
//     soak's gold), Drawn Lightning's reach and Leaping Bolt's leap in storm;
//     a Tremor Crack, Weight of the Anvil's mark (the soak's gold, turning on
//     Mythic) and Crushed in granite; and the woken stars' (the rework of
//     2026-11-18): a pillar's rise in granite, a Sky Strike's white storm
//     spot (colder and whiter than Leaping Bolt's violet reach, so the two
//     Breath mechanics read apart) and Arcing Stone's big ring round its
//     pillar (the lethal edge);
//   - the reaction and the impact, cosmetic over them: the whirls' tall
//     turning columns of fire (a smoke-dark sheath over a flame funnel round a
//     white-hot core, embers spiralling up them), the pools' flames, frost at
//     a crack, lightning leaping between bodies, the stars' swords of ice,
//     bolts, rings and columns (final_stars_fx.ts),
//     the orbs (a crackling fresnel shell, a pulsing core, a turning ring),
//     the great anvil of carved stone and gold crystal hanging over its mark
//     and dropping onto it, the granite shells, the ice round a frozen
//     player, Heart Unbound's blazing ring of the four
//     veins, the switch's shockwave racing over the floor in the four veins'
//     bands.
// The footprints, the ice, the shells, the anvil, the
// centre's ring, the shockwave and the stars draw on every tier; the
// footprints' rime, streaks and glints and the particles thin on the low
// tier and the shakes go under reduced motion.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under one root attached through `attachSceneGroupGated`; fixed
// pools, no light, no per-frame allocation past a new object's first sight;
// every floor piece on its own rung (FINAL_KIT_FLOOR); every shader places
// its points through `modelViewMatrix` (camera-relative).

import * as THREE from 'three';
import { sfx } from '../../game/sfx';
import { FinalAudio } from '../../game/smith_heart_final_audio';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import {
  HEART_ROOM,
  inSmithHeartRoom,
  SMITH_HEART_VEIN_COLORS,
} from '../../sim/content/smith_heart_layout';
import { heartQuarterAt } from '../../sim/content/smith_heart_quarters';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
import { ELEMENT_AURAS } from '../../sim/encounters/smith_heart/final_elements_ids';
import {
  FINAL_AURAS,
  FINAL_BOSS,
  FINAL_CASTS,
  FINAL_CUES,
  FINAL_TUNING as T,
} from '../../sim/encounters/smith_heart/final_ids';
import { finalAddVein } from '../../sim/encounters/smith_heart/final_phase_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { fxAnchor } from '../attached_fx_anchor';
import { TelegraphKit, type TelegraphStyle, telegraphFillOf } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX, surfaceMat } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import { CouncilRushArrow } from './council_rush_arrow';
import { anvilFollowsLocal, anvilUnder, easeToward } from './final_anvil_core';
import { FinalAnvilFx } from './final_anvil_fx';
import { finalArrowMark } from './final_arrow_core';
import { FinalElementsFx } from './final_elements_fx';
import { elementFxClaims, elementObjectKind } from './final_elements_fx_core';
import {
  FINAL_KIT_COLORS as C,
  FINAL_KIT_FLOOR as F,
  FINAL_FOOTPRINTS,
  type FinalObjectKind,
  finalKitClaims,
  finalObjectKind,
  finalObjectSeconds,
  orbBob,
  FINAL_KIT_POOLS as P,
  FINAL_REACH as R,
  shockWave,
  timedFill,
  tornadoDebris,
  tornadoProfile,
  whirlSpin,
} from './final_kit_fx_core';
import {
  ICE_FRAG,
  KIT_UV_VERT,
  ORB_CORE_FRAG,
  ORB_FRAG,
  RIM_VERT,
  SHELL_FRAG,
  SHOCK_FRAG,
  UNBOUND_FRAG,
  WHIRL_FRAG,
  WHIRL_VERT,
} from './final_kit_glsl';
import { iceCrust, shellStone } from './final_kit_shapes';
import { FinalStarsFx } from './final_stars_fx';
import {
  FINAL_TELEGRAPH_POOLS,
  type FinalElement,
  type FinalTelegraphKind,
  finalTelegraphElement,
} from './final_telegraph_core';
import { type FinalTelegraphFan, FinalTelegraphs } from './final_telegraphs';
import { fxHash } from './hammer_fx_core';

const SCAN_SEC = 0.25;
/** The switch's shockwave: one ring per vein. */
const VEIN_RINGS: readonly number[] = [C.heat, C.quench, C.breath, C.hammer];
const ELEMENTS: readonly FinalElement[] = ['fire', 'frost', 'storm', 'stone'];
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

interface FootSlot {
  d: FinalTelegraphFan;
  key: number;
  style: TelegraphStyle | null;
  seen: boolean;
}

interface ObjSeen {
  born: number;
  kind: FinalObjectKind;
}

interface Arc {
  from: number;
  to: number;
  born: number;
  seed: number;
}

/** Rocks whirled round each fire tornado. */
const TORNADO_ROCKS = 10;
const _deb = { angle: 0, height: 0, spin: 0 };
const _tm = new THREE.Matrix4();
const _tq = new THREE.Quaternion();
const _te = new THREE.Euler();
const _tp = new THREE.Vector3();
const _ts = new THREE.Vector3();

interface WhirlBody {
  smoke: THREE.Mesh;
  outer: THREE.Mesh;
  core: THREE.Mesh;
  smokeU: { uAlpha: { value: number } };
  outerU: { uAlpha: { value: number } };
  coreU: { uAlpha: { value: number } };
}

interface OrbBody {
  shell: THREE.Mesh;
  core: THREE.Mesh;
  ring: THREE.Mesh;
  crackle: { value: number };
}

export class FinalKitFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly particles: EngineParticles;
  private readonly kit: TelegraphKit;
  private readonly tele: FinalTelegraphs;
  private readonly pools: Record<FinalElement, FootSlot[]> = {
    fire: [],
    frost: [],
    storm: [],
    stone: [],
  };
  private readonly slotByKey = new Map<number, FootSlot>();
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly whirls: WhirlBody[] = [];
  /** The Breath's Dust Devils: the same bodies in wind. */
  private readonly devils: WhirlBody[] = [];
  private readonly tornadoRocks: THREE.InstancedMesh;
  private readonly orbs: OrbBody[] = [];
  private readonly ice: THREE.Mesh[] = [];
  private readonly shells: THREE.Mesh[] = [];
  private readonly arcsMesh: THREE.InstancedMesh;
  private readonly arcs: Arc[] = [];
  /** Weight of the Anvil's whole look past its mark (final_anvil_fx.ts). */
  private readonly anvilFx: FinalAnvilFx;
  /** The players' places this frame for the Anvil's count (pooled). */
  private readonly underPool: { x: number; z: number; dead: boolean }[] = [];
  private readonly underPts: { x: number; z: number; dead: boolean }[] = [];
  private readonly unboundRing: THREE.Mesh;
  private readonly unboundK = { value: 0 };
  private readonly shock: THREE.Mesh;
  private readonly shockFront = { value: 0 };
  private readonly shockAlpha = { value: 0 };
  private shockAt = -99;
  private readonly seen = new Map<number, ObjSeen>();
  private readonly objectIds: number[] = [];
  private readonly playerIds: number[] = [];
  /** The living Splinters (their bars are the sound's). */
  private readonly splinterIds: number[] = [];
  /** The whole fight's sound (game/smith_heart_final_audio.ts): every final
   *  cue, the footprints as they appear, the bars, the Overload, the marks. */
  private readonly audio = new FinalAudio(sfx);
  private readonly lookup = (id: number): Entity | undefined => this.world?.entities.get(id);
  private readonly groundAt = (x: number, z: number): number => this.groundY(x, z);
  private readonly centre = { x: 0, y: 0, z: 0 };
  /** The woken stars' swords, lines, bolts, rings and columns. */
  private readonly stars: FinalStarsFx;
  /** Its own elements (final_elements_fx.ts): the strike, the fusion, the
   *  combos, the polarity marks; and their objects this roster. */
  private readonly elements: FinalElementsFx;
  private readonly elementIds: number[] = [];
  /** The bodies a charged pillar's pulse leaps to (pooled). */
  private readonly near: { x: number; y: number; z: number; d: number }[] = [];
  private rosterSeen = Number.NaN;
  private scanTimer = 0;
  private bossId = -1;
  private clock = 0;
  private seed = 0x3c71;
  private active = false;
  private disposed = false;
  private originX = 0;
  private originZ = 0;
  /** The personal arrow over the LOCAL player while a mark singles them out
   *  (final_arrow_core.ts: the Anvil, the blade, the strike, the embers, the
   *  lightning, the coal, the tether), drawn for them alone. */
  private readonly arrow: CouncilRushArrow;
  /** Weight of the Anvil's drawn spot (the local follow, its hand-back). */
  private readonly anvilDraw = { id: -1, x: 0, z: 0, local: false, clock: 0 };

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
  ) {
    this.root.name = 'smith-heart-final-kit-fx';
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
      F.particles,
    );
    this.arrow = new CouncilRushArrow(
      this.root,
      this.uTime,
      this.geometries,
      this.materials,
      finalArrowMark,
      1,
    );
    // Every footprint: pooled fans per element, each dressed in its paint
    // (a full ring), every tier.
    this.kit = new TelegraphKit(this.root, detail);
    this.tele = new FinalTelegraphs(
      this.kit,
      { char: F.telegraphChar, glow: F.telegraphGlow, curtain: F.telegraphCurtain },
      this.materials,
    );
    for (const el of ELEMENTS)
      for (let i = 0; i < FINAL_TELEGRAPH_POOLS[el]; i++)
        this.pools[el].push({
          d: this.tele.fan(el, F.telegraphChar),
          key: 0,
          style: null,
          seen: false,
        });
    const col = (c: readonly [number, number, number]) => ({ value: new THREE.Color(...c) });
    const shader = (
      name: string,
      uniforms: Record<string, THREE.IUniform>,
      vertexShader: string,
      fragmentShader: string,
      extra: Partial<THREE.ShaderMaterialParameters> = {},
    ) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        ...extra,
      });
      this.materials.push(m);
      return m;
    };
    const mesh = (geo: THREE.BufferGeometry, mat: THREE.Material, name: string) => {
      const m = new THREE.Mesh(geo, mat);
      m.name = name;
      m.visible = false;
      m.frustumCulled = false;
      this.root.add(m);
      return m;
    };
    // The whirls (the Heat's star since the rework of 2026-11-18): a fire
    // TORNADO (the coordinator's review of 2026-11-18): a funnel narrow at
    // its throat on the floor and flaring wide at its top (tornadoProfile),
    // streaks of flame winding up it round a white-hot core, a dark sheath of
    // smoke and dust dragged round its outside, a ring of fire at its foot,
    // embers spiralling up it and rocks whirled round it; each its own seed.
    const lathe = (rings: number, around: number) => {
      const pts: THREE.Vector2[] = [];
      for (let j = 0; j <= rings; j++)
        pts.push(new THREE.Vector2(tornadoProfile(j / rings), j / rings));
      return new THREE.LatheGeometry(pts, around);
    };
    const funnel = lathe(28, 40);
    const coreGeo = lathe(22, 28);
    const smokeGeo = lathe(20, 36);
    this.geometries.push(funnel, coreGeo, smokeGeo);
    const rockGeo = new THREE.DodecahedronGeometry(0.55, 0);
    this.geometries.push(rockGeo);
    const rockMat = surfaceMat({ color: 0x5a4636, roughness: 0.95, flatShading: true });
    this.materials.push(rockMat);
    this.tornadoRocks = new THREE.InstancedMesh(rockGeo, rockMat, P.whirls * TORNADO_ROCKS);
    this.tornadoRocks.name = 'smithHeartFinalTornadoRocks';
    this.tornadoRocks.frustumCulled = false;
    this.tornadoRocks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < P.whirls * TORNADO_ROCKS; i++)
      this.tornadoRocks.setMatrixAt(i, _tm.makeScale(0, 0, 0));
    this.tornadoRocks.visible = false;
    this.root.add(this.tornadoRocks);
    // The Breath's Dust Devils (Jose's playtest of 2026-11-19) are the same
    // tornado in wind: its own pool, white, sky blue and grey dust.
    for (let i = 0; i < P.whirls + P.devils; i++) {
      const wind = i >= P.whirls;
      const seedU = { value: fxHash(i, 5) * 20 };
      const outerU = {
        uTime: this.uTime,
        uAlpha: { value: 1 },
        uCoreK: { value: 0 },
        uSeed: seedU,
        uTwist: { value: wind ? 2.1 : 1.6 },
        uCore: col(wind ? C.windCore : C.fireCore),
        uFire: col(wind ? C.wind : C.fire),
        uWind: { value: wind ? 1 : 0 },
        uDust: col(C.windDust),
      };
      const coreU = {
        ...outerU,
        uAlpha: { value: 1 },
        uCoreK: { value: 1 },
        uTwist: { value: 2.6 },
      };
      const smokeU = {
        ...outerU,
        uAlpha: { value: 1 },
        uCoreK: { value: -1 },
        uTwist: { value: 1.2 },
      };
      const extra = { side: THREE.DoubleSide, blending: THREE.AdditiveBlending } as const;
      const smoke = mesh(
        smokeGeo,
        shader('smithHeartFinalWhirlSmoke', smokeU, WHIRL_VERT, WHIRL_FRAG, {
          side: THREE.DoubleSide,
        }),
        wind ? 'smithHeartFinalDevilSmoke' : 'smithHeartFinalWhirlSmoke',
      );
      const outer = mesh(
        funnel,
        shader('smithHeartFinalWhirl', outerU, WHIRL_VERT, WHIRL_FRAG, extra),
        wind ? 'smithHeartFinalDevil' : 'smithHeartFinalWhirl',
      );
      const core = mesh(
        coreGeo,
        shader('smithHeartFinalWhirlCore', coreU, WHIRL_VERT, WHIRL_FRAG, extra),
        wind ? 'smithHeartFinalDevilCore' : 'smithHeartFinalWhirlCore',
      );
      (wind ? this.devils : this.whirls).push({ smoke, outer, core, smokeU, outerU, coreU });
    }
    // The Storm Orbs: a fresnel shell of storm light, a pulsing core, a ring
    // turning round it.
    const orbGeo = new THREE.SphereGeometry(1, 32, 20);
    const orbCoreGeo = new THREE.SphereGeometry(0.42, 16, 12);
    const orbRingGeo = new THREE.TorusGeometry(1.35, 0.045, 6, 48);
    this.geometries.push(orbGeo, orbCoreGeo, orbRingGeo);
    const ringMat = new THREE.MeshBasicMaterial({
      name: 'smithHeartFinalOrbRing',
      color: 0xd8ccff,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.materials.push(ringMat);
    for (let i = 0; i < P.orbs; i++) {
      const crackle = { value: 0.4 };
      const u = { uTime: this.uTime, uCrackle: crackle, uStorm: col(C.storm) };
      const extra = { blending: THREE.AdditiveBlending } as const;
      const shell = mesh(
        orbGeo,
        shader('smithHeartFinalOrb', u, KIT_UV_VERT, ORB_FRAG, extra),
        'smithHeartFinalOrb',
      );
      const core = mesh(
        orbCoreGeo,
        shader('smithHeartFinalOrbCore', u, KIT_UV_VERT, ORB_CORE_FRAG, extra),
        'smithHeartFinalOrbCore',
      );
      const ring = mesh(orbRingGeo, ringMat, 'smithHeartFinalOrbRing');
      this.orbs.push({ shell, core, ring, crackle });
    }
    // The ice round the frozen, the granite round the shelled.
    const iceGeo = iceCrust();
    const shellGeo = shellStone();
    this.geometries.push(iceGeo, shellGeo);
    const iceMat = shader(
      'smithHeartFinalIce',
      { uTime: this.uTime, uFrost: col(C.frost) },
      KIT_UV_VERT,
      ICE_FRAG,
    );
    for (let i = 0; i < P.ice; i++) this.ice.push(mesh(iceGeo, iceMat, 'smithHeartFinalIce'));
    const shellMat = shader(
      'smithHeartFinalShell',
      { uTime: this.uTime, uStone: col(C.stone), uGold: col([1.0, 0.78, 0.36]) },
      KIT_UV_VERT,
      SHELL_FRAG,
    );
    for (let i = 0; i < P.shells; i++)
      this.shells.push(mesh(shellGeo, shellMat, 'smithHeartFinalShell'));
    // The lightning: thin segments between the bodies it leaps through.
    const arcGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0);
    this.geometries.push(arcGeo);
    const arcMat = new THREE.MeshBasicMaterial({
      name: 'smithHeartFinalArcs',
      color: 0xe6dcff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.materials.push(arcMat);
    this.arcsMesh = new THREE.InstancedMesh(arcGeo, arcMat, P.arcs * P.arcSegments);
    this.arcsMesh.name = 'smithHeartFinalArcs';
    this.arcsMesh.frustumCulled = false;
    this.arcsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < P.arcs * P.arcSegments; i++)
      this.arcsMesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
    this.root.add(this.arcsMesh);
    // Weight of the Anvil: the great anvil, its countdown, its strike.
    this.anvilFx = new FinalAnvilFx(
      {
        groundY: (x, z) => this.groundY(x, z),
        particles: this.particles,
        density: this.density,
        detail,
        reducedMotion: () => this.reducedMotion(),
        me: () => {
          const me = this.world?.entities.get(this.world.playerId);
          return me ? me.pos : null;
        },
        shakeSink: this.shakeSink,
        rand: () => this.rand(),
        hasDom,
      },
      this.uTime,
    );
    this.root.add(this.anvilFx.group);
    const veins = {
      uHeat: { value: new THREE.Color(C.heat) },
      uQuench: { value: new THREE.Color(C.quench) },
      uBreath: { value: new THREE.Color(C.breath) },
      uHammer: { value: new THREE.Color(C.hammer) },
    };
    // Heart Unbound's blazing ring round the boss in the centre.
    const ringGeo = new THREE.RingGeometry(2.5, 14, 96, 3).rotateX(-Math.PI / 2);
    this.geometries.push(ringGeo);
    this.unboundRing = mesh(
      ringGeo,
      shader(
        'smithHeartFinalUnbound',
        { uTime: this.uTime, uK: this.unboundK, ...veins },
        RIM_VERT,
        UNBOUND_FRAG,
        { side: THREE.DoubleSide, blending: THREE.AdditiveBlending },
      ),
      'smithHeartFinalUnbound',
    );
    this.unboundRing.renderOrder = floorVfxRenderOrder('encounter', F.marks);
    // The switch's shockwave over the floor (every tier).
    const shockGeo = new THREE.CircleGeometry(100, 160).rotateX(-Math.PI / 2);
    this.geometries.push(shockGeo);
    this.shock = mesh(
      shockGeo,
      shader(
        'smithHeartFinalShock',
        { uFront: this.shockFront, uAlpha: this.shockAlpha, ...veins },
        RIM_VERT,
        SHOCK_FRAG,
        { side: THREE.DoubleSide, blending: THREE.AdditiveBlending },
      ),
      'smithHeartFinalShock',
    );
    this.shock.renderOrder = floorVfxRenderOrder('encounter', F.shock);
    // The woken stars (the rework of 2026-11-18): their swords, lines, bolts,
    // rings and columns, under this root.
    this.stars = new FinalStarsFx({
      root: this.root,
      uTime: this.uTime,
      particles: this.particles,
      kit: this.kit,
      groundY: (x, z) => this.groundY(x, z),
      rand: () => this.rand(),
      density: this.density,
      detail,
      reducedMotion: () => this.reducedMotion(),
      shake: (x, z, amount, reach) => this.shake(x, z, amount, reach),
      geometries: this.geometries,
      materials: this.materials,
      laneRung: F.lane,
      ringRung: F.marks,
      laneStyle: FINAL_FOOTPRINTS.lane,
      laneLockedStyle: FINAL_FOOTPRINTS.laneLocked,
      bladeFly: T.bladeFly,
      bladeHalf: T.bladeHalf,
    });
    // Its own elements (Jose's brief of 2026-11-19 (b)), under this root.
    this.elements = new FinalElementsFx({
      root: this.root,
      uTime: this.uTime,
      particles: this.particles,
      kit: this.kit,
      groundY: (x, z) => this.groundY(x, z),
      rand: () => this.rand(),
      density: this.density,
      reducedMotion: () => this.reducedMotion(),
      shake: (x, z, amount, reach) => this.shake(x, z, amount, reach),
      geometries: this.geometries,
      materials: this.materials,
      foot: (key, kind, style, x, z, radius, fill, moving) =>
        this.foot(key, kind, style, x, z, radius, fill, moving),
      leap: (x, y, z, x2, y2, z2, life, jag) => this.stars.leapBolt(x, y, z, x2, y2, z2, life, jag),
      wave: (x, z, radius, seconds, color) => this.stars.waveRing(x, z, radius, seconds, color),
      sound: (kind, x, y, z) => this.audio.footprint(kind, x, y, z),
      laneRung: F.lane,
      crustRung: F.crust,
      tele: this.tele,
      charRung: F.telegraphChar,
    });
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1103515245) + 12345) >>> 0;
    return this.seed / 0x100000000;
  }

  private shake(x: number, z: number, amount: number, reach = 60): void {
    if (!this.shakeSink || this.reducedMotion() || !this.world) return;
    const me = this.world.entities.get(this.world.playerId);
    if (!me) return;
    const d = Math.hypot(me.pos.x - x, me.pos.z - z);
    if (d < reach) this.shakeSink(amount * (1 - d / reach));
  }

  // ---- the cues ---------------------------------------------------------------------

  /** Claims the final's own cues (they are drawn here and in FinalFx). */
  handleEvent(ev: SimEvent): boolean {
    if (!this.world || this.disposed) return false;
    if (ev.type !== 'spellfx' && ev.type !== 'spellfxAt') return false;
    if (this.active) this.audio.event(ev, this.lookup, this.groundAt);
    // Its own elements' cues (final_elements_fx.ts).
    if (elementFxClaims(ev.ability)) {
      if (this.active) this.elements.handle(ev, this.world);
      return true;
    }
    if (!finalKitClaims(ev.ability)) return false;
    if (!this.active) return true;
    if (ev.type === 'spellfx') {
      const target = this.world.entities.get(ev.targetId);
      const source = this.world.entities.get(ev.sourceId);
      if (ev.ability === FINAL_CUES.bolt || ev.ability === FINAL_CUES.arc) {
        this.addArc(ev.sourceId, ev.targetId);
        if (target) this.sparkAt(fxAnchor(target).x, fxAnchor(target).z, C.storm, 10, 1.6);
        return true;
      }
      if (!target) return true;
      const x = fxAnchor(target).x;
      const z = fxAnchor(target).z;
      if (ev.ability === FINAL_CUES.whirl) this.sparkAt(x, z, C.fire, 14, 1.4);
      else if (ev.ability === FINAL_CUES.devil) {
        // Thrown by a Dust Devil: a burst of dust and a pale gust ring.
        this.dustAt(x, z, 18, 2.2);
        this.particles.shockRing(x, z, 0xdcecff, 4.5, 0.4);
      } else if (ev.ability === FINAL_CUES.shell) this.dustAt(x, z, 10, 1.4);
      else if (ev.ability === FINAL_CUES.charged) this.chargedPulse(target);
      else if (ev.ability === FINAL_CUES.chargedHit || ev.ability === FINAL_CUES.chargedZone) {
        // The pulse (or the ground) strikes a player: a violet-white crack on
        // them, a small ring at their feet, a bolt from the pillar for the pulse.
        const big = ev.ability === FINAL_CUES.chargedHit;
        this.sparkAt(x, z, C.storm, big ? 16 : 6, big ? 1.5 : 0.9);
        this.particles.shockRing(x, z, 0xe2d4ff, big ? 3 : 1.8, big ? 0.35 : 0.25);
        if (big && source) this.addArc(source.id, target.id);
      } else if (ev.ability === FINAL_CUES.rise) {
        this.dustAt(x, z, 30, 3.5);
        this.particles.shockRing(x, z, 0xe8c070, R.rise * 1.6, 0.5);
        this.shake(x, z, 0.35, 45);
      } else if (ev.ability === FINAL_CUES.thrum) {
        this.dustAt(x, z, 14, 2.6);
        this.particles.shockRing(x, z, 0xe8c070, 9, 0.6);
        this.shake(x, z, 0.2, 60);
      } else if (ev.ability === FINAL_CUES.shift) {
        this.dustAt(x, z, 26, 5);
        this.particles.shockRing(x, z, 0xe8c070, 7, 0.6);
        this.shake(x, z, 0.25);
      } else if (ev.ability === FINAL_CUES.unbound && source)
        this.sparkAt(x, z, [1, 0.85, 0.55], 8, 6);
      return true;
    }
    const x = ev.x;
    const z = ev.z;
    const y = this.groundY(x, z);
    switch (ev.ability) {
      case FINAL_CUES.shock:
        this.veinShockAt(x, z);
        break;
      case FINAL_CUES.embers:
      case FINAL_CUES.forgeFire:
        this.particles.puff(x, y + 9, z, Math.round(26 * this.density) + 6, {
          speed: 2,
          up: -12,
          life: 0.8,
          size: [0.7, 0.2],
          color: C.fire,
          alpha: 1,
          pool: 'pyre',
          radius: ev.radius ?? 3,
        });
        this.particles.shockRing(x, z, 0xff9a3a, ev.radius ?? 4, 0.5);
        break;
      case FINAL_CUES.iceBreak:
        this.particles.shockRing(x, z, 0xbfe6ff, R.crack * 1.4, 0.6);
        for (let i = 0; i < Math.round(26 * this.density) + 6; i++) {
          const a = this.rand() * Math.PI * 2;
          const r = this.rand() * R.crack;
          this.particles.puff(x + Math.cos(a) * r, y + 0.2, z + Math.sin(a) * r, 1, {
            speed: 3,
            up: 8,
            life: 1.1,
            size: [0.5, 0.2],
            color: C.frost,
            alpha: 1,
            pool: 'glow',
            gravity: 18,
          });
        }
        this.shake(x, z, 0.3);
        break;
      case FINAL_CUES.orbTaken:
        this.sparkAt(x, z, C.storm, 18, 1.2);
        this.particles.shockRing(x, z, 0xc8b8ff, 4, 0.4);
        break;
      case FINAL_CUES.orbBurst:
        this.sparkAt(x, z, C.storm, 50, 3);
        this.particles.shockRing(x, z, 0xc8b8ff, 30, 1.0);
        this.shake(x, z, 0.5, 90);
        break;
      case FINAL_CUES.tremor:
        this.dustAt(x, z, 24, R.tremor);
        this.particles.shockRing(x, z, 0xe8c070, R.tremor * 1.3, 0.5);
        this.shake(x, z, 0.3);
        break;
      case FINAL_CUES.anvil:
        this.anvilFx.land(x, z, ev.radius ?? R.anvil);
        break;
      case FINAL_CUES.strike:
        this.stars.boltAt(x, z, ev.radius ?? R.strike);
        break;
      case FINAL_CUES.arcingStone:
        this.stars.arcingAt(x, z, ev.radius ?? R.arc);
        break;
      case FINAL_CUES.shatter:
        this.stars.shatterAt(x, z, ev.radius ?? 3.7);
        break;
      case FINAL_CUES.wake: {
        const zone = heartQuarterAt(x - this.originX, z - this.originZ);
        const color = zone === 'ring' ? 0xffe2a0 : SMITH_HEART_VEIN_COLORS[zone];
        this.stars.wakeAt(x, z, color);
        break;
      }
      default:
    }
    return true;
  }

  private sparkAt(
    x: number,
    z: number,
    color: readonly [number, number, number],
    n: number,
    radius: number,
  ): void {
    const y = this.groundY(x, z);
    this.particles.puff(x, y + 1, z, Math.round(n * this.density) + 2, {
      speed: 7,
      up: 5,
      life: 0.7,
      size: [0.45, 0.08],
      color,
      alpha: 1,
      pool: 'glow',
      radius,
      drag: 1,
    });
  }

  private dustAt(x: number, z: number, n: number, radius: number): void {
    const y = this.groundY(x, z);
    this.particles.puff(x, y + 0.4, z, Math.round(n * this.density) + 3, {
      speed: 5,
      up: 3,
      life: 1.5,
      size: [1.2, 3.6],
      color: C.dust,
      alpha: 0.45,
      drag: 1.2,
      radius,
    });
  }

  /** The switch's shockwave: rings of the four veins' light racing out over
   *  the whole Anvil from where the boss crossed. */
  private veinShockAt(x: number, z: number): void {
    // The floor wave (every tier): four bands racing out over the Anvil.
    this.shockAt = this.clock;
    this.shock.position.set(x, this.groundY(x, z) + 0.06, z);
    this.shock.visible = true;
    for (let i = 0; i < VEIN_RINGS.length; i++)
      this.particles.shockRing(x, z, VEIN_RINGS[i], 30 + i * 9, 0.9 + i * 0.15);
    this.sparkAt(x, z, [1, 0.9, 0.7], 40, 6);
    this.dustAt(x, z, 30, 8);
    this.shake(x, z, 0.7, 120);
  }

  /** A Storm-Charged pillar pulses the raid: its bolts leap to the nearest
   *  bodies (four at most). */
  private chargedPulse(pillar: Entity): void {
    const world = this.world;
    if (!world) return;
    const near = this.near;
    near.length = 0;
    for (const pid of this.playerIds) {
      const p = world.entities.get(pid);
      if (!p || p.dead) continue;
      const a = fxAnchor(p);
      const d = Math.hypot(a.x - pillar.pos.x, a.z - pillar.pos.z);
      if (d > 40) continue;
      near.push({ x: a.x, y: this.groundY(a.x, a.z), z: a.z, d });
    }
    near.sort((a, b) => a.d - b.d);
    this.stars.chargedPulse(pillar, near);
  }

  private addArc(from: number, to: number): void {
    let slot = this.arcs.find((a) => this.clock - a.born > 0.4);
    if (!slot) {
      if (this.arcs.length >= P.arcs) slot = this.arcs[0];
      else {
        slot = { from, to, born: this.clock, seed: 0 };
        this.arcs.push(slot);
      }
    }
    slot.from = from;
    slot.to = to;
    slot.born = this.clock;
    slot.seed = this.rand() * 1000;
  }

  // ---- the frame ----------------------------------------------------------------------

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.clock += dt;
    this.uTime.value = this.clock;
    const me = world.entities.get(world.playerId);
    const def = DUNGEONS.smith_heart;
    let inHeart = false;
    if (me && def) {
      const o = instanceOrigin(def.index, instanceSlotForZ(me.pos.z));
      inHeart =
        Math.abs(me.pos.x - o.x) < 300 &&
        Math.abs(me.pos.z - o.z) < 260 &&
        inSmithHeartRoom(me.pos.x - o.x, me.pos.z - o.z);
      this.originX = o.x;
      this.originZ = o.z;
    }
    if (!inHeart) {
      if (this.active) this.leave();
      this.audio.update(null, this.splinterIds, this.lookup, null, null);
      this.particles.update(this.clock);
      return;
    }
    this.active = true;
    this.scan(world, dt);
    for (const el of ELEMENTS) for (const s of this.pools[el]) s.seen = false;
    this.anvilFx.begin(this.clock, dt);
    this.stars.begin(this.clock);
    this.elements.begin(this.clock, dt);
    this.paintObjects(world);
    this.paintElements(world);
    this.anvilFx.end();
    this.paintMarks(world);
    this.stars.end();
    // The marked player's own arrow (final_arrow_core.ts).
    this.arrow.beginScan();
    if (me && !me.dead && finalArrowMark(me)) this.arrow.see(me.id);
    this.arrow.endScan();
    this.arrow.update(world.entities, this.clock, this.reducedMotion());
    this.paintBoss(world);
    for (const el of ELEMENTS)
      for (const s of this.pools[el])
        if (!s.seen && s.key !== 0) {
          this.slotByKey.delete(s.key);
          s.key = 0;
          s.d.fan.group.visible = false;
        }
    this.paintArcs(world);
    this.paintShock();
    this.particles.update(this.clock);
    const boss = this.bossId >= 0 ? (world.entities.get(this.bossId) ?? null) : null;
    this.centre.x = this.originX + HEART_ROOM.x;
    this.centre.z = this.originZ + HEART_ROOM.z;
    this.centre.y = this.groundY(this.centre.x, this.centre.z);
    this.audio.update(boss, this.splinterIds, this.lookup, me ?? null, this.centre);
  }

  private scan(world: IWorld, dt: number): void {
    this.scanTimer -= dt;
    if (world.entityRosterVersion === this.rosterSeen && this.scanTimer > 0) return;
    this.scanTimer = SCAN_SEC;
    if (world.entityRosterVersion === this.rosterSeen) return;
    this.rosterSeen = world.entityRosterVersion;
    this.objectIds.length = 0;
    this.elementIds.length = 0;
    this.playerIds.length = 0;
    this.splinterIds.length = 0;
    this.bossId = -1;
    for (const e of world.entities.values()) {
      if (e.kind === 'player') this.playerIds.push(e.id);
      else if (e.kind === 'mob' && e.templateId === FINAL_BOSS) this.bossId = e.id;
      else if (e.kind === 'mob' && finalAddVein(e.templateId) !== null) {
        if (this.splinterIds.length < 4) this.splinterIds.push(e.id);
      } else if (e.kind === 'object') {
        const kind = finalObjectKind(e.templateId);
        if (!kind) {
          if (elementObjectKind(e.templateId)) this.elementIds.push(e.id);
          continue;
        }
        this.objectIds.push(e.id);
        if (!this.seen.has(e.id)) {
          this.seen.set(e.id, { born: this.clock, kind });
          // A footprint appearing: its warning (a whirl rising, the ice
          // groaning, an orb, a tremor crack).
          this.audio.footprint(kind, e.pos.x, this.groundY(e.pos.x, e.pos.z), e.pos.z);
        }
      }
    }
    for (const id of this.seen.keys()) if (!world.entities.has(id)) this.seen.delete(id);
  }

  /** The fan for `key` this frame in `kind`'s element paint, styled and
   *  draped at (x, z). */
  private foot(
    key: number,
    kind: FinalTelegraphKind,
    style: TelegraphStyle,
    x: number,
    z: number,
    radius: number,
    fill: number,
    moving: boolean,
  ): void {
    let s = this.slotByKey.get(key);
    let fresh = false;
    if (!s) {
      s = this.pools[finalTelegraphElement(kind)].find((q) => q.key === 0);
      if (!s) return;
      s.key = key;
      this.slotByKey.set(key, s);
      fresh = true;
    }
    s.seen = true;
    this.tele.setLook(s.d, kind);
    if (s.style !== style) {
      this.kit.layOutFan(s.d.fan, 360, style);
      s.style = style;
    }
    if (fresh || moving) {
      const y = this.groundY(x, z);
      this.kit.drapeFan(s.d.fan, this.groundY, x, y, z, 0, radius);
    }
    this.kit.paintFan(s.d.fan, { fill, clock: this.clock, range: radius });
    s.d.fan.group.visible = true;
  }

  private paintObjects(world: IWorld): void {
    let whirl = 0;
    let devil = 0;
    let rocksUsed = 0;
    let orb = 0;
    for (const id of this.objectIds) {
      const e = world.entities.get(id);
      const info = this.seen.get(id);
      if (!e || !info) continue;
      const kind = finalObjectKind(e.templateId) ?? info.kind;
      const age = this.clock - info.born;
      const r = e.scale || 1;
      const eAt = fxAnchor(e);
      const x = eAt.x;
      const z = eAt.z;
      const y = this.groundY(x, z);
      switch (kind) {
        case 'whirlWarn':
        case 'whirl': {
          const warn = kind === 'whirlWarn' ? timedFill(age, T.whirlWarn) : 1;
          this.foot(id, 'whirl', FINAL_FOOTPRINTS.whirl, x, z, R.whirl, warn, true);
          const w = this.whirls[whirl++];
          if (w) {
            const spin = whirlSpin(this.clock, warn);
            const live = kind === 'whirl' ? 1 : 0.35 + 0.5 * warn;
            const height = spin.height;
            const lip = R.whirl * 2;
            w.smoke.position.set(x, y, z);
            w.smoke.scale.set(lip * 1.2, height * 1.06, lip * 1.2);
            w.outer.position.set(x, y, z);
            w.outer.scale.set(lip, height, lip);
            w.core.position.set(x, y, z);
            w.core.scale.set(lip * 0.5, height * 0.94, lip * 0.5);
            w.smokeU.uAlpha.value = live;
            w.outerU.uAlpha.value = live;
            w.coreU.uAlpha.value = live;
            w.smoke.visible = true;
            w.outer.visible = true;
            w.core.visible = true;
            // Rocks torn up and whirled round its funnel.
            const base = (whirl - 1) * TORNADO_ROCKS;
            for (let k = 0; k < TORNADO_ROCKS; k++) {
              const d = tornadoDebris(this.clock, k, TORNADO_ROCKS, (id % 97) * 0.37, _deb);
              const r = lip * tornadoProfile(d.height) * 1.08 + 0.4;
              const s = (0.6 + ((k * 13) % 7) * 0.12) * live;
              _tp.set(
                x + Math.cos(d.angle) * r,
                y + d.height * height * 0.9 + 0.3,
                z + Math.sin(d.angle) * r,
              );
              _tq.setFromEuler(_te.set(d.spin, d.spin * 0.7, 0));
              this.tornadoRocks.setMatrixAt(base + k, _tm.compose(_tp, _tq, _ts.set(s, s, s)));
            }
            rocksUsed = whirl;
            // Its foot: a ring of fire licking up where it tears the floor.
            if (this.rand() < (kind === 'whirl' ? 1 : warn) * this.density) {
              const a = this.rand() * Math.PI * 2;
              const rr = R.whirl * (0.4 + 0.6 * this.rand());
              this.particles.puff(x + Math.cos(a) * rr, y + 0.2, z + Math.sin(a) * rr, 1, {
                speed: 1.5,
                up: 4 + this.rand() * 3,
                life: 0.7,
                size: [1.6, 0.5],
                color: C.fire,
                alpha: 1,
                pool: 'pyre',
                dir: [-Math.sin(a), 0.4, Math.cos(a)],
                spread: 0.3,
              });
            }
            // Embers spiralling up the funnel, flung out at its lip.
            for (let e2 = 0; e2 < 2; e2++) {
              if (this.rand() > (kind === 'whirl' ? 1 : warn) * this.density) continue;
              const a = this.clock * 7 + this.rand() * Math.PI * 2;
              const hh = this.rand() * 0.5;
              const rr = lip * tornadoProfile(hh);
              this.particles.puff(x + Math.cos(a) * rr, y + hh * height, z + Math.sin(a) * rr, 1, {
                speed: 5,
                up: 9 + this.rand() * 6,
                life: 1.4,
                size: [0.5, 0.1],
                color: C.fire,
                alpha: 1,
                pool: 'glow',
                dir: [-Math.sin(a), 0.5, Math.cos(a)],
                spread: 0.15,
              });
            }
            if (kind === 'whirl' && this.rand() < 0.5 * this.density) {
              const a = this.rand() * Math.PI * 2;
              this.particles.puff(
                x + Math.cos(a) * R.whirl,
                y + 0.3,
                z + Math.sin(a) * R.whirl,
                1,
                {
                  speed: 4,
                  up: 2,
                  life: 0.9,
                  size: [1.0, 2.6],
                  color: C.dust,
                  alpha: 0.35,
                  dir: [-Math.sin(a), 0.2, Math.cos(a)],
                  spread: 0.3,
                },
              );
            }
          }
          break;
        }
        case 'devilWarn':
        case 'devil': {
          // A Breath Dust Devil (Jose's playtest of 2026-11-19): the fire
          // tornado in wind, smaller and lower, dust whipped round its foot and
          // streaks of wind thrown off it; it throws whoever it touches.
          const warn = kind === 'devilWarn' ? timedFill(age, T.devilWarn) : 1;
          this.foot(id, 'devil', FINAL_FOOTPRINTS.devil, x, z, R.devil, warn, true);
          const w = this.devils[devil++];
          if (w) {
            const spin = whirlSpin(this.clock, warn);
            const live = kind === 'devil' ? 1 : 0.35 + 0.5 * warn;
            // Smaller than a fire tornado (about two raiders tall, its lip
            // its reach): the player and the boss stay readable beside it.
            const height = spin.height * 0.5;
            const lip = R.devil * 1.6;
            w.smoke.position.set(x, y, z);
            w.smoke.scale.set(lip * 1.25, height * 1.06, lip * 1.25);
            w.outer.position.set(x, y, z);
            w.outer.scale.set(lip, height, lip);
            w.core.position.set(x, y, z);
            w.core.scale.set(lip * 0.45, height * 0.94, lip * 0.45);
            w.smokeU.uAlpha.value = live;
            w.outerU.uAlpha.value = live;
            w.coreU.uAlpha.value = live;
            w.smoke.visible = true;
            w.outer.visible = true;
            w.core.visible = true;
            const on = (kind === 'devil' ? 1 : warn) * this.density;
            // Dust scoured up round its foot, whipped round.
            for (let k = 0; k < 2; k++) {
              if (this.rand() > on) continue;
              const a = this.rand() * Math.PI * 2;
              const rr = R.devil * (0.5 + 0.7 * this.rand());
              this.particles.puff(x + Math.cos(a) * rr, y + 0.25, z + Math.sin(a) * rr, 1, {
                speed: 4.5,
                up: 2.5 + this.rand() * 2,
                life: 1.1,
                size: [1.1, 2.8],
                color: C.windDust,
                alpha: 0.4,
                dir: [-Math.sin(a), 0.35, Math.cos(a)],
                spread: 0.25,
              });
            }
            // Streaks of wind spiralling up and flung off its lip.
            for (let k = 0; k < 2; k++) {
              if (this.rand() > on) continue;
              const a = this.clock * 9 + this.rand() * Math.PI * 2;
              const hh = 0.15 + this.rand() * 0.6;
              const rr = lip * tornadoProfile(hh);
              this.particles.puff(x + Math.cos(a) * rr, y + hh * height, z + Math.sin(a) * rr, 1, {
                speed: 7,
                up: 3 + this.rand() * 3,
                life: 0.8,
                size: [0.35, 0.08],
                color: C.windCore,
                alpha: 0.9,
                pool: 'glow',
                dir: [-Math.sin(a), 0.25, Math.cos(a)],
                spread: 0.1,
              });
            }
          }
          break;
        }
        case 'emberPool':
        case 'forgePool': {
          this.foot(id, 'pool', FINAL_FOOTPRINTS.pool, x, z, r, 1, false);
          if (this.rand() < (kind === 'emberPool' ? 0.9 : 0.7) * this.density)
            this.particles.puff(x, y + 0.2, z, 2, {
              speed: 0.6,
              up: 2.8,
              life: 1.1,
              size: [1.0, 0.3],
              color: C.fire,
              alpha: 1,
              pool: 'pyre',
              radius: r * 0.85,
            });
          break;
        }
        case 'crack': {
          const fill = timedFill(age, finalObjectSeconds(e.templateId));
          this.foot(id, 'crack', FINAL_FOOTPRINTS.crack, x, z, r, fill, false);
          if (this.rand() < 0.5 * this.density)
            this.particles.puff(x, y + 0.2, z, 1, {
              speed: 1,
              up: 1.5,
              life: 1.2,
              size: [0.8, 1.6],
              color: C.frost,
              alpha: 0.35,
              radius: r,
            });
          break;
        }
        case 'tremor': {
          const fill = timedFill(age, finalObjectSeconds(e.templateId));
          this.foot(id, 'tremor', FINAL_FOOTPRINTS.tremor, x, z, r, fill, false);
          if (this.rand() < fill * 0.7 * this.density)
            this.particles.puff(x, y + 0.2, z, 1, {
              speed: 1.2,
              up: 2,
              life: 0.8,
              size: [0.3, 0.2],
              color: C.stone,
              alpha: 1,
              radius: r,
              gravity: 9,
            });
          break;
        }
        case 'orb': {
          const life = finalObjectSeconds(e.templateId) || T.orbLife;
          const left = 1 - timedFill(age, life);
          this.foot(id, 'orb', FINAL_FOOTPRINTS.orb, x, z, r + 0.5, 1 - left, false);
          const ob = this.orbs[orb++];
          if (ob) {
            const bob = orbBob(this.clock + id, left);
            const size = 1.5 + 0.12 * Math.sin(this.clock * 9 + id);
            ob.shell.position.set(x, y + bob.y, z);
            ob.shell.scale.setScalar(size);
            ob.core.position.copy(ob.shell.position);
            ob.core.scale.setScalar(size * (0.9 + 0.25 * bob.crackle));
            ob.ring.position.copy(ob.shell.position);
            ob.ring.scale.setScalar(size);
            ob.ring.rotation.set(
              1.1 + 0.3 * Math.sin(this.clock * 0.7 + id),
              this.clock * 2.2 + id,
              0,
            );
            ob.crackle.value = bob.crackle;
            ob.shell.visible = true;
            ob.core.visible = true;
            ob.ring.visible = true;
            if (this.rand() < bob.crackle * 0.35 * this.density)
              this.sparkAt(x, z, C.storm, 1, 1.4);
          }
          break;
        }
        case 'anvil': {
          const boss = this.bossId >= 0 ? world.entities.get(this.bossId) : undefined;
          const total = finalObjectSeconds(e.templateId) || T.anvilCast;
          // My own Anvil (the playtest of 2026-11-19, the Crossing Blade's
          // rule): while it follows me it is drawn at my DRAWN pose, the
          // server's circle a round trip late; once it plants it eases onto
          // the server's spot.
          const spot = this.anvilSpot(world, id, x, z, total - age);
          const ax = spot.x;
          const az = spot.z;
          const ay = this.groundY(ax, az);
          const fill =
            boss && boss.castingAbility === FINAL_CASTS.anvil
              ? telegraphFillOf(boss.castRemaining, boss.castTotal > 0 ? boss.castTotal : total)
              : timedFill(age, total);
          this.foot(id, 'anvil', FINAL_FOOTPRINTS.anvil, ax, az, r, fill, true);
          // How many stand under it (its runes say whether that is a full share).
          const pts = this.underPts;
          pts.length = 0;
          for (const pid of this.playerIds) {
            const p = world.entities.get(pid);
            if (!p) continue;
            const pAt = fxAnchor(p);
            const slot = this.underPool[pts.length] ?? { x: 0, z: 0, dead: false };
            this.underPool[pts.length] = slot;
            slot.x = pAt.x;
            slot.z = pAt.z;
            slot.dead = p.dead;
            pts.push(slot);
          }
          this.anvilFx.hang(id, ax, ay, az, fill, anvilUnder(pts, ax, az, r), r);
          break;
        }
        // ---- the woken stars ----
        case 'rise': {
          const fill = timedFill(age, finalObjectSeconds(e.templateId) || T.pillarWarn);
          this.foot(id, 'rise', FINAL_FOOTPRINTS.rise, x, z, r, fill, false);
          if (this.rand() < fill * this.density)
            this.particles.puff(x, y + 0.2, z, 1, {
              speed: 1.5,
              up: 3,
              life: 0.7,
              size: [0.35, 0.25],
              color: C.stone,
              alpha: 1,
              radius: r * 0.8,
              gravity: 12,
            });
          break;
        }
        case 'strike': {
          const fill = timedFill(age, finalObjectSeconds(e.templateId) || T.skyWarn);
          this.foot(id, 'strike', FINAL_FOOTPRINTS.strike, x, z, r, fill, false);
          this.stars.strikeCharge(x, y, z, fill);
          break;
        }
        case 'arcRing': {
          const fill = timedFill(age, finalObjectSeconds(e.templateId) || T.skyWarn);
          this.foot(id, 'arcRing', FINAL_FOOTPRINTS.arcRing, x, z, r, fill, false);
          this.stars.arcWarn(x, y, z, r, fill);
          break;
        }
        case 'blade':
          this.stars.seeBlade(e);
          break;
        case 'lane':
          this.stars.seeLane(e);
          break;
        case 'pillarCharged':
          // Its electric ground (Jose's playtest of 2026-11-19): only a thin
          // danger rim at the sim's reach (the raid's threat colour); the
          // ground itself is the stars' lightning field (final_stars_fx.ts).
          this.foot(
            -(id * 4 + 3),
            'chargedZone',
            FINAL_FOOTPRINTS.chargedZone,
            x,
            z,
            R.chargedZone,
            0,
            false,
          );
          this.stars.chargedPillar(e, R.chargedZone);
          break;
        default:
      }
    }
    for (let i = rocksUsed * TORNADO_ROCKS; i < this.whirls.length * TORNADO_ROCKS; i++)
      this.tornadoRocks.setMatrixAt(i, _tm.makeScale(0, 0, 0));
    this.tornadoRocks.instanceMatrix.needsUpdate = true;
    this.tornadoRocks.visible = rocksUsed > 0;
    for (let i = whirl; i < this.whirls.length; i++) {
      this.whirls[i].smoke.visible = false;
      this.whirls[i].outer.visible = false;
      this.whirls[i].core.visible = false;
    }
    for (let i = devil; i < this.devils.length; i++) {
      this.devils[i].smoke.visible = false;
      this.devils[i].outer.visible = false;
      this.devils[i].core.visible = false;
    }
    for (let i = orb; i < this.orbs.length; i++) {
      const ob = this.orbs[i];
      ob.shell.visible = false;
      ob.core.visible = false;
      ob.ring.visible = false;
    }
  }

  /** The players' marks: the ember's ring, the lightning's reach, the ice,
   *  the stone, Crushed. */
  private paintMarks(world: IWorld): void {
    let ice = 0;
    let shell = 0;
    let bladeLeft = 0;
    let bladeTotal = 0;
    for (const pid of this.playerIds) {
      const p = world.entities.get(pid);
      if (!p || p.dead) continue;
      const pAt = fxAnchor(p);
      const x = pAt.x;
      const z = pAt.z;
      const y = this.groundY(x, z);
      for (const a of p.auras) {
        if (a.id === FINAL_AURAS.ember) {
          const fill = a.duration > 0 ? 1 - a.remaining / a.duration : 1;
          this.foot(-(pid * 8 + 1), 'ember', FINAL_FOOTPRINTS.ember, x, z, R.ember, fill, true);
          if (this.rand() < 0.5 * this.density)
            this.particles.puff(x, y + 2.2, z, 1, {
              speed: 1,
              up: 2,
              life: 0.6,
              size: [0.4, 0.1],
              color: C.fire,
              alpha: 1,
              pool: 'glow',
              radius: 0.5,
            });
        } else if (a.id === FINAL_AURAS.drawn) {
          this.foot(-(pid * 8 + 2), 'drawn', FINAL_FOOTPRINTS.drawn, x, z, R.drawn, 0, true);
          if (this.rand() < 0.6 * this.density) this.sparkAt(x, z, C.storm, 1, 0.6);
        } else if (a.id === FINAL_AURAS.bladeMark) {
          bladeLeft = a.remaining;
          bladeTotal = a.duration;
        } else if (a.id === FINAL_AURAS.underIce || a.id === ELEMENT_AURAS.frozen) {
          const m = this.ice[ice++];
          if (m) {
            m.position.set(x, y, z);
            m.rotation.y = fxHash(pid, 3) * Math.PI;
            m.visible = true;
          }
        } else if (a.id === FINAL_AURAS.shell) {
          const m = this.shells[shell++];
          if (m) {
            m.position.set(x, y, z);
            m.rotation.y = this.clock * 0.2 + pid;
            m.visible = true;
          }
        } else if (a.id === FINAL_AURAS.crushed) {
          const fill = a.duration > 0 ? 1 - a.remaining / a.duration : 1;
          this.foot(
            -(pid * 8 + 4),
            'crushed',
            FINAL_FOOTPRINTS.crushed,
            x,
            z,
            R.crushed,
            fill,
            true,
          );
        }
      }
    }
    this.stars.bladeMark(bladeLeft, bladeTotal);
    // My own line while it aims: drawn at my DRAWN pose (online the server's
    // line is a round trip late: Jose's playtest of 2026-11-19).
    const me = world.entities.get(world.playerId);
    let aiming = false;
    if (me && !me.dead)
      for (const a of me.auras)
        if (a.id === FINAL_AURAS.bladeMark && (a.value ?? 1) < 2) aiming = true;
    this.stars.localBlade(aiming && me ? fxAnchor(me) : null, this.originX, this.originZ);
    for (let i = ice; i < this.ice.length; i++) this.ice[i].visible = false;
    for (let i = shell; i < this.shells.length; i++) this.shells[i].visible = false;
  }

  /** Its own elements this frame (final_elements_fx.ts): their objects, the
   *  players' stacks and marks, the boss's fusion. */
  private paintElements(world: IWorld): void {
    for (const id of this.elementIds) {
      const e = world.entities.get(id);
      if (!e) continue;
      const kind = elementObjectKind(e.templateId);
      if (kind) this.elements.seeObject(e, kind);
    }
    for (const pid of this.playerIds) {
      const p = world.entities.get(pid);
      if (p) this.elements.seePlayer(p);
    }
    const boss = this.bossId >= 0 ? world.entities.get(this.bossId) : undefined;
    if (boss) this.elements.seeBoss(boss);
    this.elements.end();
  }

  /** Where Weight of the Anvil `id` is drawn this frame: at the local
   *  player's drawn pose while it follows them (they wear its mark and more
   *  than `anvilLock` of its bar is left), eased onto the server's spot
   *  (x, z) once it plants or for anyone else's. */
  private anvilSpot(
    world: IWorld,
    id: number,
    x: number,
    z: number,
    left: number,
  ): { x: number; z: number } {
    const me = world.entities.get(world.playerId);
    let mine = false;
    if (me && !me.dead) for (const a of me.auras) if (a.id === FINAL_AURAS.anvilMark) mine = true;
    const d = this.anvilDraw;
    const dt = Math.max(0, this.clock - d.clock);
    d.clock = this.clock;
    if (d.id !== id) {
      d.id = id;
      d.x = x;
      d.z = z;
      d.local = false;
    }
    if (me && anvilFollowsLocal(mine, left, T.anvilLock)) {
      const at = fxAnchor(me);
      d.x = at.x;
      d.z = at.z;
      d.local = true;
    } else if (d.local) {
      const k = easeToward(dt, 14);
      d.x += (x - d.x) * k;
      d.z += (z - d.z) * k;
      if (Math.hypot(x - d.x, z - d.z) < 0.02) d.local = false;
    } else {
      d.x = x;
      d.z = z;
    }
    return d;
  }

  /** The boss: Leaping Bolt's target ring, Heart Unbound's blaze. */
  private paintBoss(world: IWorld): void {
    const boss = this.bossId >= 0 ? world.entities.get(this.bossId) : undefined;
    if (!boss || boss.dead) {
      this.unboundRing.visible = false;
      return;
    }
    if (boss.castingAbility === FINAL_CASTS.bolt && boss.castTargetId !== null) {
      const t = world.entities.get(boss.castTargetId);
      if (t) {
        const fill = telegraphFillOf(
          boss.castRemaining,
          boss.castTotal > 0 ? boss.castTotal : T.boltCast,
        );
        const tAt = fxAnchor(t);
        this.foot(-(t.id * 8 + 3), 'bolt', FINAL_FOOTPRINTS.bolt, tAt.x, tAt.z, R.bolt, fill, true);
        if (this.rand() < 0.7 * this.density) this.sparkAt(tAt.x, tAt.z, C.storm, 1, 1);
      }
    }
    let unbound: Entity['auras'][number] | undefined;
    for (const a of boss.auras) if (a.id === FINAL_AURAS.unbound) unbound = a;
    const bossAt = fxAnchor(boss);
    const x = bossAt.x;
    const z = bossAt.z;
    const y = this.groundY(x, z);
    const stacks = unbound?.stacks ?? 0;
    this.unboundRing.visible = stacks > 0;
    if (stacks > 0) {
      const k = Math.min(1, stacks / 10);
      this.unboundRing.position.set(x, y + 0.1, z);
      this.unboundRing.scale.setScalar(1 + 0.25 * k + 0.03 * Math.sin(this.clock * 10));
      this.unboundK.value = k;
      if (this.rand() < (0.4 + k) * this.density) this.sparkAt(x, z, [1, 0.8, 0.45], 2, 7);
    }
  }

  private paintArcs(world: IWorld): void {
    let n = 0;
    for (const a of this.arcs) {
      const age = this.clock - a.born;
      if (age > 0.35) continue;
      const s = world.entities.get(a.from);
      const t = world.entities.get(a.to);
      if (!s || !t) continue;
      // Both ends ride the drawn bodies.
      const sa = fxAnchor(s);
      const ta = fxAnchor(t);
      const sy = this.groundY(sa.x, sa.z) + (s.templateId === FINAL_BOSS ? 12 : 1.4);
      const ty = this.groundY(ta.x, ta.z) + 1.4;
      let px = sa.x;
      let py = sy;
      let pz = sa.z;
      const w = 0.09 * (1 - age / 0.35) + 0.03;
      for (let k = 1; k <= P.arcSegments; k++) {
        const f = k / P.arcSegments;
        const j = k === P.arcSegments ? 0 : 1.2;
        const nx = sa.x + (ta.x - sa.x) * f + (fxHash(a.seed + k, this.clock * 30) - 0.5) * j;
        const ny = sy + (ty - sy) * f + (fxHash(a.seed + k, 7) - 0.5) * j;
        const nz = sa.z + (ta.z - sa.z) * f + (fxHash(a.seed + k, this.clock * 31) - 0.5) * j;
        _v.set(nx - px, ny - py, nz - pz);
        const len = _v.length();
        _v.normalize();
        _q.setFromUnitVectors(UP, _v);
        _m.compose(_v2.set(px, py, pz), _q, _s.set(w, len, w));
        this.arcsMesh.setMatrixAt(n++, _m);
        px = nx;
        py = ny;
        pz = nz;
      }
    }
    for (let i = n; i < P.arcs * P.arcSegments; i++)
      this.arcsMesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
    this.arcsMesh.instanceMatrix.needsUpdate = true;
    this.arcsMesh.visible = n > 0;
  }

  /** The switch's floor wave, riding out and fading. */
  private paintShock(): void {
    if (!this.shock.visible) return;
    const w = shockWave(this.clock - this.shockAt);
    if (w.alpha <= 0) {
      this.shock.visible = false;
      return;
    }
    this.shockFront.value = w.front;
    this.shockAlpha.value = w.alpha;
  }

  private leave(): void {
    this.active = false;
    this.arrow.beginScan();
    this.arrow.endScan();
    this.rosterSeen = Number.NaN;
    this.stars.hide();
    this.elements.hide();
    for (const el of ELEMENTS)
      for (const s of this.pools[el]) {
        s.key = 0;
        s.d.fan.group.visible = false;
      }
    this.slotByKey.clear();
    this.seen.clear();
    for (const w of [...this.whirls, ...this.devils]) {
      w.smoke.visible = false;
      w.outer.visible = false;
      w.core.visible = false;
    }
    this.tornadoRocks.visible = false;
    for (const ob of this.orbs) {
      ob.shell.visible = false;
      ob.core.visible = false;
      ob.ring.visible = false;
    }
    for (const m of [...this.ice, ...this.shells]) m.visible = false;
    this.shock.visible = false;
    this.anvilFx.hide();
    this.unboundRing.visible = false;
    this.arcsMesh.visible = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.audio.dispose();
    this.root.removeFromParent();
    this.particles.dispose();
    this.stars.dispose();
    this.elements.dispose();
    this.anvilFx.dispose();
    this.kit.dispose();
    this.arcsMesh.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
