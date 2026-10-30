// The Masterless Strength's part 2 look (plan: final_phase_fx_core.ts; design
// doc 7.5), hosted by ../rift_death_zone.ts beside FinalFx (its body) and
// FinalKitFx (the quarter kits). Read from IWorld (the boss's phase aura, its
// shield, poured and fury auras, the Splinters' bodies and cast bars, the
// Quenching Rings' objects, the players' marks, the cues), so offline and
// online look the same:
//   - actionable, on EVERY tier: Gathered Strength's dome of the four veins
//     round the shielded boss (its plates crackling as the call runs out);
//     every Splinter's sigil in its vein's colour; Shearing Blow's cone at its
//     exact arc and reach in the Splinter's own element, filling with its bar;
//     Bursting Coal's reach round its carrier and the burning coal over them;
//     Gale Pounce's landing on its quarry, the hunt's Buffeting Gale round
//     the Splinter and the storm tether to its quarry; every Quenching Ring at
//     the sim's front with its gaps cut clean (door frames either side); the
//     poured elements' rings round the boss's body; Masterless Fury's flare;
//   - the moments, cosmetic over them: the stride into the centre (a trail of
//     the four veins), each Splinter climbing out in a column of its light, an
//     element pouring into the boss in a thick beam, the shield shattering,
//     the four quarters' columns as the final phase wakes them, the frontal's
//     slash, the coal's burst, the toll's frost nova, the pounce's landing.
// Embers, frost, sparks, grit and dust thin on the low tier; shakes go under
// reduced motion; nothing a player acts on ever thins.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under one root attached through `attachSceneGroupGated`; fixed
// pools, no light, no per-frame allocation past a new object's first sight;
// every floor piece on its own rung (FINAL_PHASE_FLOOR); every shader places
// its points through `modelViewMatrix` (camera-relative).

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import { inSmithHeartRoom, type SmithHeartVein } from '../../sim/content/smith_heart_layout';
import { HEART_QUARTER_ORDER, heartQuarterSpot } from '../../sim/content/smith_heart_quarters';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
import { FINAL_BOSS } from '../../sim/encounters/smith_heart/final_ids';
import {
  FINAL_PHASE_AURAS as A,
  FINAL_PHASE_CASTS as C,
  finalAddVein,
  finalStageOf,
  FINAL_PHASES as P,
  pouredAuraId,
  FINAL_PHASE_CUES as Q,
  quenchRingGaps,
  quenchRingOf,
} from '../../sim/encounters/smith_heart/final_phase_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { TelegraphKit, type TelegraphStyle, telegraphFillOf } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import {
  HEART_REBIRTH_BEATS,
  type HeartCollapseStage,
  heartRebirthBeats,
  newHeartCollapseView,
  readHeartCollapse,
} from '../smith_heart/heart_collapse_core';
import { type HeartQuarterSeed, heartQuarterSeeds } from '../smith_heart/heart_quarters_core';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  awakenSpot,
  FINAL_PHASE_FLOOR as F,
  finalPhaseClaims,
  furyLook,
  PHASE_FOOTPRINTS,
  FINAL_PHASE_POOLS as PL,
  POUR_SECONDS,
  pillarLook,
  pouredOrbit,
  pourLook,
  quenchRingLook,
  PHASE_REACH as R,
  rgbOf,
  SPLINTER_LOOKS,
  SPLINTER_SHEAR_KIND,
  shieldLook,
} from './final_phase_fx_core';
import {
  BEAM_FRAG,
  PHASE_BODY_VERT,
  PHASE_FLOOR_VERT,
  PILLAR_FRAG,
  QRING_FRAG,
  SHIELD_FRAG,
  SIGIL_FRAG,
} from './final_phase_glsl';
import type { FinalElement, FinalTelegraphKind } from './final_telegraph_core';
import { type FinalTelegraphFan, FinalTelegraphs } from './final_telegraphs';
import { fxHash } from './hammer_fx_core';

const SCAN_SEC = 0.25;
const ELEMENTS: readonly FinalElement[] = ['fire', 'frost', 'storm', 'stone'];
const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const VEIN_RGB: Readonly<Record<SmithHeartVein, [number, number, number]>> = {
  heat: rgbOf(SPLINTER_LOOKS.heat.color),
  quench: rgbOf(SPLINTER_LOOKS.quench.color),
  breath: rgbOf(SPLINTER_LOOKS.breath.color),
  hammer: rgbOf(SPLINTER_LOOKS.hammer.color),
};

interface FootSlot {
  d: FinalTelegraphFan;
  key: number;
  style: TelegraphStyle | null;
  arc: number;
  seen: boolean;
}

interface Pillar {
  mesh: THREE.Mesh;
  alpha: { value: number };
  color: { value: THREE.Color };
  born: number;
  life: number;
  radius: number;
  height: number;
}

interface Beam {
  mesh: THREE.Mesh;
  alpha: { value: number };
  color: { value: THREE.Color };
  born: number;
  from: THREE.Vector3;
  bossId: number;
}

interface RingBody {
  mesh: THREE.Mesh;
  u: Record<string, THREE.IUniform>;
}

interface Sigil {
  mesh: THREE.Mesh;
  alpha: { value: number };
  color: { value: THREE.Color };
  spin: { value: number };
}

export class FinalPhaseFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly detail: boolean;
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
  private readonly shield: THREE.Mesh;
  private readonly shieldU: { uAlpha: { value: number }; uUrgent: { value: number } };
  private shieldSince = -1;
  private readonly rings: RingBody[] = [];
  private readonly sigils: Sigil[] = [];
  private readonly pillars: Pillar[] = [];
  private readonly beams: Beam[] = [];
  private readonly tethers: THREE.InstancedMesh;
  private readonly coals: THREE.Mesh[] = [];
  private readonly coalMat: THREE.MeshBasicMaterial;
  private readonly poured: THREE.Mesh[] = [];
  private readonly pouredMats: THREE.MeshBasicMaterial[] = [];
  private readonly fury: THREE.Mesh;
  private readonly furyMat: THREE.MeshBasicMaterial;
  private readonly seen = new Map<number, number>();
  private readonly ringIds: number[] = [];
  private readonly addIds: number[] = [];
  private readonly playerIds: number[] = [];
  private rosterSeen = Number.NaN;
  private scanTimer = 0;
  private bossId = -1;
  private clock = 0;
  private seed = 0x51ad;
  private lastDt = 0;
  private readonly hiddenView = newHeartCollapseView();
  private hiddenStage: HeartCollapseStage = 'none';
  private hiddenClock = 0;
  private hiddenBeats = 0;
  private warnTick = 0;
  /** A few spots on each quarter's floor (instance-local), for its rock and dust. */
  private readonly quarterSeeds: Record<SmithHeartVein, HeartQuarterSeed[]> = {
    breath: heartQuarterSeeds('breath', 14, 53),
    quench: heartQuarterSeeds('quench', 14, 53),
    hammer: heartQuarterSeeds('hammer', 14, 53),
    heat: heartQuarterSeeds('heat', 14, 53),
  };
  private active = false;
  private disposed = false;
  private originX = 0;
  private originZ = 0;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
  ) {
    this.root.name = 'smith-heart-final-phase-fx';
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
      F.particles,
    );
    this.kit = new TelegraphKit(this.root, this.detail);
    this.tele = new FinalTelegraphs(
      this.kit,
      { char: F.telegraphChar, glow: F.telegraphGlow, curtain: F.telegraphCurtain },
      this.materials,
    );
    for (const el of ELEMENTS)
      for (let i = 0; i < PL.fans[el]; i++)
        this.pools[el].push({
          d: this.tele.fan(el, F.telegraphChar),
          key: 0,
          style: null,
          arc: 0,
          seen: false,
        });
    const veins = {
      uHeat: { value: new THREE.Color(SPLINTER_LOOKS.heat.color) },
      uQuench: { value: new THREE.Color(SPLINTER_LOOKS.quench.color) },
      uBreath: { value: new THREE.Color(SPLINTER_LOOKS.breath.color) },
      uHammer: { value: new THREE.Color(SPLINTER_LOOKS.hammer.color) },
    };
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
        blending: THREE.AdditiveBlending,
        toneMapped: false,
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
    // Gathered Strength: a dome of the four veins round the boss.
    const dome = new THREE.SphereGeometry(1, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
    this.geometries.push(dome);
    this.shieldU = { uAlpha: { value: 0 }, uUrgent: { value: 0 } };
    this.shield = mesh(
      dome,
      shader(
        'smithHeartFinalShield',
        { uTime: this.uTime, ...this.shieldU, ...veins },
        PHASE_BODY_VERT,
        SHIELD_FRAG,
        { side: THREE.DoubleSide },
      ),
      'smithHeartFinalShield',
    );
    // The Quenching Rings: one flat disc each, its band cut in the shader.
    const ringGeo = new THREE.RingGeometry(1, P.ringReach + 2, 224, 1).rotateX(-Math.PI / 2);
    this.geometries.push(ringGeo);
    for (let i = 0; i < PL.rings; i++) {
      const u: Record<string, THREE.IUniform> = {
        uTime: this.uTime,
        uFront: { value: 0 },
        uAlpha: { value: 0 },
        uGapHalf: { value: (P.ringGapDeg * Math.PI) / 360 },
        uGapN: { value: 0 },
        uGaps: { value: new THREE.Vector4() },
        uDetail: { value: this.detail ? 1 : 0.35 },
        uFrost: { value: new THREE.Color(0.7, 0.88, 1) },
        uThreat: { value: new THREE.Color(PHASE_FOOTPRINTS.buffet.color) },
      };
      const m = mesh(
        ringGeo,
        shader('smithHeartFinalQuenchRing', u, PHASE_FLOOR_VERT, QRING_FRAG, {
          side: THREE.DoubleSide,
        }),
        'smithHeartFinalQuenchRing',
      );
      m.renderOrder = floorVfxRenderOrder('encounter', F.ring);
      this.rings.push({ mesh: m, u });
    }
    // The Splinters' sigils on the floor.
    const sigilGeo = new THREE.CircleGeometry(1, 64).rotateX(-Math.PI / 2);
    this.geometries.push(sigilGeo);
    for (let i = 0; i < PL.splinters; i++) {
      const alpha = { value: 0 };
      const color = { value: new THREE.Color() };
      const spin = { value: 0.4 };
      const m = mesh(
        sigilGeo,
        shader(
          'smithHeartFinalSigil',
          { uTime: this.uTime, uAlpha: alpha, uColor: color, uSpin: spin },
          PHASE_FLOOR_VERT,
          SIGIL_FRAG,
          { side: THREE.DoubleSide },
        ),
        'smithHeartFinalSigil',
      );
      m.renderOrder = floorVfxRenderOrder('encounter', F.sigil);
      this.sigils.push({ mesh: m, alpha, color, spin });
    }
    // The columns of light (a Splinter rising, the quarters waking).
    const pillarGeo = new THREE.CylinderGeometry(1, 1.15, 1, 28, 10, true).translate(0, 0.5, 0);
    this.geometries.push(pillarGeo);
    for (let i = 0; i < PL.pillars; i++) {
      const alpha = { value: 0 };
      const color = { value: new THREE.Color() };
      const m = mesh(
        pillarGeo,
        shader(
          'smithHeartFinalPillar',
          { uTime: this.uTime, uAlpha: alpha, uColor: color, uSeed: { value: i * 3.7 } },
          PHASE_BODY_VERT,
          PILLAR_FRAG,
          { side: THREE.DoubleSide },
        ),
        'smithHeartFinalPillar',
      );
      this.pillars.push({ mesh: m, alpha, color, born: -99, life: 1, radius: 1, height: 1 });
    }
    // The pours: a thick flowing beam from a Splinter into the boss.
    const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 18, 1, true).translate(0, 0.5, 0);
    this.geometries.push(beamGeo);
    for (let i = 0; i < PL.beams; i++) {
      const alpha = { value: 0 };
      const color = { value: new THREE.Color() };
      const m = mesh(
        beamGeo,
        shader(
          'smithHeartFinalPour',
          { uTime: this.uTime, uAlpha: alpha, uColor: color },
          PHASE_BODY_VERT,
          BEAM_FRAG,
          { side: THREE.DoubleSide },
        ),
        'smithHeartFinalPour',
      );
      this.beams.push({ mesh: m, alpha, color, born: -99, from: new THREE.Vector3(), bossId: -1 });
    }
    // The storm tether from the Breath Splinter to its quarry.
    const segGeo = new THREE.CylinderGeometry(1, 1, 1, 5, 1, true).translate(0, 0.5, 0);
    this.geometries.push(segGeo);
    const tetherMat = new THREE.MeshBasicMaterial({
      name: 'smithHeartFinalTether',
      color: 0xd8ccff,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      fog: false,
    });
    this.materials.push(tetherMat);
    this.tethers = new THREE.InstancedMesh(segGeo, tetherMat, PL.tethers * PL.tetherSegments);
    this.tethers.name = 'smithHeartFinalTether';
    this.tethers.frustumCulled = false;
    this.tethers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < PL.tethers * PL.tetherSegments; i++)
      this.tethers.setMatrixAt(i, _m.makeScale(0, 0, 0));
    this.root.add(this.tethers);
    // The coal over its carrier.
    const coalGeo = new THREE.IcosahedronGeometry(0.55, 1);
    this.geometries.push(coalGeo);
    this.coalMat = new THREE.MeshBasicMaterial({
      name: 'smithHeartFinalCoal',
      color: 0xffa040,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.materials.push(this.coalMat);
    for (let i = 0; i < PL.coals; i++)
      this.coals.push(mesh(coalGeo, this.coalMat, 'smithHeartFinalCoal'));
    // The poured elements' rings round the boss's body.
    const torus = new THREE.TorusGeometry(1, 0.07, 8, 96);
    this.geometries.push(torus);
    for (let i = 0; i < PL.poured; i++) {
      const mat = new THREE.MeshBasicMaterial({
        name: 'smithHeartFinalPoured',
        color: 0xffffff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      this.materials.push(mat);
      this.pouredMats.push(mat);
      this.poured.push(mesh(torus, mat, 'smithHeartFinalPoured'));
    }
    // Masterless Fury: a red-white crown round its feet.
    const furyGeo = new THREE.TorusGeometry(1, 0.12, 8, 96).rotateX(Math.PI / 2);
    this.geometries.push(furyGeo);
    this.furyMat = new THREE.MeshBasicMaterial({
      name: 'smithHeartFinalFury',
      color: 0xff4a3a,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    this.materials.push(this.furyMat);
    this.fury = mesh(furyGeo, this.furyMat, 'smithHeartFinalFury');
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1103515245) + 12345) >>> 0;
    return this.seed / 0x100000000;
  }

  private shake(x: number, z: number, amount: number, reach = 70): void {
    if (!this.shakeSink || this.reducedMotion() || !this.world) return;
    const me = this.world.entities.get(this.world.playerId);
    if (!me) return;
    const d = Math.hypot(me.pos.x - x, me.pos.z - z);
    if (d < reach) this.shakeSink(amount * (1 - d / reach));
  }

  // ---- the cues ---------------------------------------------------------------------

  /** Claims part 2's own cues (they are drawn here). */
  handleEvent(ev: SimEvent): boolean {
    if (!this.world || this.disposed) return false;
    if (ev.type !== 'spellfx' && ev.type !== 'spellfxAt') return false;
    if (!finalPhaseClaims(ev.ability)) return false;
    if (!this.active) return true;
    if (ev.type === 'spellfxAt') {
      const x = ev.x;
      const z = ev.z;
      if (ev.ability && this.hiddenMoment(ev.ability, x, z)) return true;
      switch (ev.ability) {
        case Q.leap:
          this.dustAt(x, z, 40, 10);
          for (const v of HEART_QUARTER_ORDER)
            this.particles.shockRing(x, z, SPLINTER_LOOKS[v].color, 18, 0.9);
          this.shake(x, z, 0.5, 100);
          break;
        case Q.rise: {
          const vein = this.veinNear(x, z);
          const look = SPLINTER_LOOKS[vein];
          this.pillarAt(x, z, look.color, 2.2, 24, 2.6);
          this.particles.shockRing(x, z, look.color, 12, 0.8);
          this.dustAt(x, z, 30, 4);
          this.motesAt(x, z, vein, 40, 3);
          this.shake(x, z, 0.35);
          break;
        }
        case Q.coal:
          this.particles.puff(x, this.groundY(x, z) + 1.5, z, Math.round(46 * this.density) + 8, {
            speed: 9,
            up: 6,
            life: 0.9,
            size: [1.1, 0.3],
            color: [1, 0.6, 0.22],
            alpha: 1,
            pool: 'pyre',
            radius: 2,
          });
          this.particles.shockRing(x, z, 0xff8a3a, P.coalReach * 1.2, 0.6);
          this.particles.shockRing(x, z, 0xfff0c0, P.coalReach * 0.5, 0.3);
          this.shake(x, z, 0.45);
          break;
        case Q.pounce:
          this.sparkAt(x, z, VEIN_RGB.breath, 30, 2.5);
          this.particles.shockRing(x, z, SPLINTER_LOOKS.breath.color, 7, 0.5);
          this.dustAt(x, z, 18, 3);
          this.shake(x, z, 0.3);
          break;
        case Q.awaken:
          for (const v of HEART_QUARTER_ORDER) {
            const s = awakenSpot(heartQuarterSpot(v));
            const wx = this.originX + s.x;
            const wz = this.originZ + s.z;
            this.pillarAt(wx, wz, SPLINTER_LOOKS[v].color, 3, 44, 4.5);
            this.motesAt(wx, wz, v, 40, 5);
          }
          for (let i = 0; i < HEART_QUARTER_ORDER.length; i++)
            this.particles.shockRing(
              x,
              z,
              SPLINTER_LOOKS[HEART_QUARTER_ORDER[i]].color,
              40 + i * 12,
              1.1 + i * 0.15,
            );
          this.shake(x, z, 0.9, 140);
          break;
        default:
      }
      return true;
    }
    const target = this.world.entities.get(ev.targetId);
    const source = this.world.entities.get(ev.sourceId);
    if (ev.ability === Q.pour) {
      if (source && target) this.pourFrom(source, target);
      return true;
    }
    if (!target) return true;
    const x = target.pos.x;
    const z = target.pos.z;
    const vein = finalAddVein(target.templateId);
    switch (ev.ability) {
      case Q.shield:
        this.shieldSince = this.clock;
        this.particles.shockRing(x, z, 0xfff0d0, R.shield * 1.6, 0.7);
        break;
      case Q.release:
        this.shatterAt(x, z);
        break;
      case Q.shear:
        if (vein) this.slashAt(target, vein);
        break;
      case Q.toll:
        for (let i = 0; i < 3; i++)
          this.particles.shockRing(x, z, 0xbfe6ff, 14 + i * 10, 0.6 + i * 0.25);
        this.motesAt(x, z, 'quench', 50, 6);
        this.shake(x, z, 0.4);
        break;
      case Q.buffet:
        this.particles.shockRing(x, z, SPLINTER_LOOKS.breath.color, R.buffet, 0.45);
        this.sparkAt(x, z, VEIN_RGB.breath, 6, R.buffet * 0.6);
        break;
      case Q.splinter:
        if (vein) this.particles.shockRing(x, z, SPLINTER_LOOKS[vein].color, 6, 0.4);
        break;
      case Q.fury:
        this.particles.shockRing(x, z, 0xff4a3a, 30, 0.7);
        this.sparkAt(x, z, [1, 0.45, 0.3], 30, 6);
        this.shake(x, z, 0.35, 120);
        break;
      default:
    }
    return true;
  }

  /** The vein of the quarter whose rise spot is nearest (x, z) (world). */
  private veinNear(x: number, z: number): SmithHeartVein {
    let best: SmithHeartVein = 'heat';
    let bestD = Number.POSITIVE_INFINITY;
    for (const v of HEART_QUARTER_ORDER) {
      const s = heartQuarterSpot(v);
      const d = Math.hypot(this.originX + s.x - x, this.originZ + s.z - z);
      if (d < bestD) {
        bestD = d;
        best = v;
      }
    }
    return best;
  }

  private sparkAt(
    x: number,
    z: number,
    color: readonly [number, number, number],
    n: number,
    radius: number,
  ): void {
    this.particles.puff(x, this.groundY(x, z) + 1, z, Math.max(1, n), {
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
    this.particles.puff(x, this.groundY(x, z) + 0.4, z, Math.max(1, n), {
      speed: 5,
      up: 3,
      life: 1.5,
      size: [1.2, 3.6],
      color: [0.42, 0.38, 0.33],
      alpha: 0.45,
      drag: 1.2,
      radius,
    });
  }

  /** A vein's own motes round (x, z): embers rising, frost drifting down,
   *  storm sparks, grit falling. */
  private motesAt(x: number, z: number, vein: SmithHeartVein, n: number, radius: number): void {
    const L = SPLINTER_LOOKS[vein];
    this.particles.puff(
      x,
      this.groundY(x, z) + 1 + (vein === 'quench' ? 3 : 0),
      z,
      Math.max(1, n),
      {
        speed: vein === 'breath' ? 6 : 1.5,
        up: L.rise,
        life: 1.4,
        size: [0.5, 0.12],
        color: L.mote,
        alpha: 1,
        pool: vein === 'heat' ? 'pyre' : 'glow',
        radius,
        gravity: L.gravity,
      },
    );
  }

  private pillarAt(
    x: number,
    z: number,
    color: number,
    radius: number,
    height: number,
    life: number,
  ): void {
    const slot =
      this.pillars.find((p) => this.clock - p.born > p.life) ??
      this.pillars.reduce((a, b) => (a.born < b.born ? a : b));
    slot.born = this.clock;
    slot.life = life;
    slot.radius = radius;
    slot.height = height;
    slot.color.value.setHex(color);
    slot.mesh.position.set(x, this.groundY(x, z) - 0.2, z);
    slot.mesh.visible = true;
  }

  private pourFrom(src: Entity, boss: Entity): void {
    const vein = finalAddVein(src.templateId) ?? 'heat';
    this.pourAt(src.pos.x, src.pos.z, vein, boss);
    this.pillarAt(src.pos.x, src.pos.z, SPLINTER_LOOKS[vein].color, 1.8, 16, 1.4);
    this.motesAt(src.pos.x, src.pos.z, vein, 50, 3);
    this.particles.shockRing(boss.pos.x, boss.pos.z, SPLINTER_LOOKS[vein].color, 14, 0.8);
    this.shake(boss.pos.x, boss.pos.z, 0.4, 100);
  }

  /** A beam of `vein`'s light from world (x, z) into the boss. */
  private pourAt(x: number, z: number, vein: SmithHeartVein, boss: Entity): void {
    const slot =
      this.beams.find((b) => this.clock - b.born > POUR_SECONDS) ??
      this.beams.reduce((a, b) => (a.born < b.born ? a : b));
    slot.born = this.clock;
    slot.bossId = boss.id;
    slot.from.set(x, this.groundY(x, z) + 2.5, z);
    slot.color.value.setHex(SPLINTER_LOOKS[vein].color);
    slot.mesh.visible = true;
  }

  /** Mythic's hidden phase (cues): the moments, cosmetic over the room's own
   *  collapse (../smith_heart/heart_collapse.ts). True when it was one. */
  private hiddenMoment(ability: string, x: number, z: number): boolean {
    switch (ability) {
      case Q.kneel:
        this.dustAt(x, z, 30, 8);
        this.shake(x, z, 0.5, 140);
        return true;
      case Q.rebirth:
        return true;
      case Q.unmade:
        for (let i = 0; i < HEART_QUARTER_ORDER.length; i++)
          this.particles.shockRing(
            x,
            z,
            SPLINTER_LOOKS[HEART_QUARTER_ORDER[i]].color,
            46 + i * 14,
            1.2 + i * 0.2,
          );
        this.dustAt(x, z, 60, 26);
        this.shake(x, z, 1.1, 160);
        return true;
      case Q.quarterCrack: {
        const v = this.veinNear(x, z);
        this.particles.shockRing(x, z, SPLINTER_LOOKS[v].color, 26, 1);
        this.dustAt(x, z, 50, 22);
        this.shake(x, z, 0.55, 160);
        return true;
      }
      case Q.quarterFall: {
        const v = this.veinNear(x, z);
        this.fallBurst(v);
        this.shake(x, z, 1.2, 180);
        return true;
      }
      case Q.bodyFall:
        this.dustAt(x, z, 14, 3);
        return true;
      case Q.ringCrack:
        this.particles.shockRing(x, z, 0xffc070, 18, 1);
        this.dustAt(x, z, 40, 14);
        this.shake(x, z, 0.8, 160);
        return true;
      case Q.ringBreak:
        for (let i = 0; i < 4; i++)
          this.particles.shockRing(x, z, 0xffc070, 18 + i * 16, 0.8 + i * 0.25);
        this.dustAt(x, z, 80, 16);
        this.shake(x, z, 1.4, 200);
        return true;
      default:
        return false;
    }
  }

  /** A quarter breaks: dust and sparks of its element up off the whole floor. */
  private fallBurst(vein: SmithHeartVein): void {
    for (const s of this.quarterSeeds[vein]) {
      const x = this.originX + s.x;
      const z = this.originZ + s.z;
      this.dustAt(x, z, 8, 5);
      this.sparkAt(x, z, VEIN_RGB[vein], 4, 4);
    }
  }

  /** One frame of the hidden phase: the Heart's beats pouring the four quarters
   *  into the boss, the warned quarter shaking itself apart. */
  private paintHidden(boss: Entity): void {
    readHeartCollapse(boss.auras, this.hiddenView);
    const h = this.hiddenView;
    if (h.stage !== this.hiddenStage) {
      this.hiddenStage = h.stage;
      this.hiddenClock = 0;
      this.hiddenBeats = 0;
    }
    if (h.stage === 'none') return;
    this.hiddenClock += this.lastDt;
    const x = boss.pos.x;
    const z = boss.pos.z;
    if (h.stage === 'rebirth') {
      const beats = heartRebirthBeats(this.hiddenClock);
      if (beats > this.hiddenBeats) {
        this.hiddenBeats = beats;
        const k = beats / HEART_REBIRTH_BEATS.length;
        for (const v of HEART_QUARTER_ORDER) {
          const s = heartQuarterSpot(v);
          const wx = this.originX + s.x;
          const wz = this.originZ + s.z;
          this.pourAt(wx, wz, v, boss);
          this.particles.shockRing(x, z, SPLINTER_LOOKS[v].color, 10 + 34 * k, 0.8);
          if (beats === 1 || beats === HEART_REBIRTH_BEATS.length)
            this.pillarAt(wx, wz, SPLINTER_LOOKS[v].color, 2.6, 26, 2.2);
        }
        this.shake(x, z, 0.3 + 0.9 * k, 160);
      }
      return;
    }
    if (h.stage !== 'collapse') return;
    // The warned quarter: rock shaking loose, a growl in the camera each second.
    const next = h.next;
    if (next && next !== 'ring' && h.seconds <= P.fallWarn) {
      const seeds = this.quarterSeeds[next];
      if (this.rand() < 0.7 * this.density) {
        const s = seeds[Math.floor(this.rand() * seeds.length) % seeds.length];
        this.dustAt(this.originX + s.x, this.originZ + s.z, 3, 3);
        this.sparkAt(this.originX + s.x, this.originZ + s.z, VEIN_RGB[next], 2, 2);
      }
      this.warnTick -= this.lastDt;
      if (this.warnTick <= 0) {
        this.warnTick = 1;
        this.shake(x, z, 0.16 + 0.1 * (P.fallWarn - h.seconds), 180);
      }
    } else if (next === 'ring') {
      this.warnTick -= this.lastDt;
      if (this.warnTick <= 0) {
        this.warnTick = 0.8;
        this.shake(x, z, 0.5, 180);
        this.dustAt(x, z, 6, 12);
      }
    }
  }

  private shatterAt(x: number, z: number): void {
    const y = this.groundY(x, z);
    for (const v of HEART_QUARTER_ORDER) {
      this.particles.puff(x, y + 5, z, Math.round(24 * this.density) + 4, {
        speed: 12,
        up: 4,
        life: 1.1,
        size: [0.6, 0.1],
        color: VEIN_RGB[v],
        alpha: 1,
        pool: 'glow',
        radius: R.shield * 0.8,
        gravity: 10,
      });
    }
    this.particles.shockRing(x, z, 0xfff0d0, R.shield * 2.4, 0.8);
    this.shake(x, z, 0.6, 110);
  }

  /** Shearing Blow's slash: a crescent of its element swept through its arc. */
  private slashAt(e: Entity, vein: SmithHeartVein): void {
    const L = SPLINTER_LOOKS[vein];
    const y = this.groundY(e.pos.x, e.pos.z) + 1.2;
    const half = (R.shearArc * Math.PI) / 360;
    const n = Math.round(18 * this.density) + 6;
    for (let i = 0; i < n; i++) {
      const a = e.facing - half + (2 * half * i) / Math.max(1, n - 1);
      const r = 2 + this.rand() * (R.shear - 2);
      const x = e.pos.x + Math.sin(a) * r;
      const z = e.pos.z + Math.cos(a) * r;
      this.particles.puff(x, y, z, 1, {
        speed: 6,
        up: 2,
        life: 0.55,
        size: [0.9, 0.15],
        color: L.mote,
        alpha: 1,
        pool: vein === 'heat' ? 'pyre' : 'glow',
        dir: [Math.sin(a), 0.1, Math.cos(a)],
        spread: 0.2,
      });
    }
    this.dustAt(e.pos.x + Math.sin(e.facing) * 5, e.pos.z + Math.cos(e.facing) * 5, 14, 4);
    this.shake(e.pos.x, e.pos.z, 0.3, 40);
  }

  // ---- the frame ----------------------------------------------------------------------

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.clock += dt;
    this.lastDt = dt;
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
      this.particles.update(this.clock);
      return;
    }
    this.active = true;
    this.scan(world, dt);
    for (const el of ELEMENTS) for (const s of this.pools[el]) s.seen = false;
    this.paintBoss(world);
    this.paintSplinters(world);
    this.paintMarks(world);
    this.paintRings(world);
    this.paintPillars();
    this.paintBeams(world);
    for (const el of ELEMENTS)
      for (const s of this.pools[el])
        if (!s.seen && s.key !== 0) {
          this.slotByKey.delete(s.key);
          s.key = 0;
          s.d.fan.group.visible = false;
        }
    this.particles.update(this.clock);
  }

  private scan(world: IWorld, dt: number): void {
    this.scanTimer -= dt;
    if (world.entityRosterVersion === this.rosterSeen && this.scanTimer > 0) return;
    this.scanTimer = SCAN_SEC;
    if (world.entityRosterVersion === this.rosterSeen) return;
    this.rosterSeen = world.entityRosterVersion;
    this.ringIds.length = 0;
    this.addIds.length = 0;
    this.playerIds.length = 0;
    this.bossId = -1;
    for (const e of world.entities.values()) {
      if (e.kind === 'player') this.playerIds.push(e.id);
      else if (e.kind === 'mob' && e.templateId === FINAL_BOSS) this.bossId = e.id;
      else if (e.kind === 'mob' && finalAddVein(e.templateId)) this.addIds.push(e.id);
      else if (e.kind === 'object' && quenchRingOf(e.templateId)) {
        this.ringIds.push(e.id);
        if (!this.seen.has(e.id)) this.seen.set(e.id, this.clock);
      }
    }
    for (const id of this.seen.keys()) if (!world.entities.has(id)) this.seen.delete(id);
  }

  /** The fan for `key` this frame in `kind`'s element paint, at `arc`
   *  degrees, styled and draped at (x, z) facing `yaw`. */
  private foot(
    key: number,
    kind: FinalTelegraphKind,
    element: FinalElement,
    style: TelegraphStyle,
    x: number,
    z: number,
    yaw: number,
    radius: number,
    arc: number,
    fill: number,
  ): void {
    let s = this.slotByKey.get(key);
    if (!s) {
      s = this.pools[element].find((q) => q.key === 0);
      if (!s) return;
      s.key = key;
      this.slotByKey.set(key, s);
    }
    s.seen = true;
    this.tele.setLook(s.d, kind);
    if (s.style !== style || s.arc !== arc) {
      this.kit.layOutFan(s.d.fan, arc, style);
      s.style = style;
      s.arc = arc;
    }
    this.kit.drapeFan(s.d.fan, this.groundY, x, this.groundY(x, z), z, yaw, radius);
    this.kit.paintFan(s.d.fan, { fill, clock: this.clock, range: radius });
    s.d.fan.group.visible = true;
  }

  /** The boss: its shield, its poured rings, its fury, its stride's trail. */
  private paintBoss(world: IWorld): void {
    const boss = this.bossId >= 0 ? world.entities.get(this.bossId) : undefined;
    if (!boss || boss.dead) {
      this.shield.visible = false;
      this.fury.visible = false;
      for (const m of this.poured) m.visible = false;
      this.shieldSince = -1;
      return;
    }
    let phase: Entity['auras'][number] | undefined;
    let shield = false;
    let fury = 0;
    for (const a of boss.auras) {
      if (a.id === A.phase) phase = a;
      else if (a.id === A.shield) shield = true;
      else if (a.id === A.fury) fury = Math.round(a.value || a.stacks || 1);
    }
    const stage = finalStageOf(phase?.value);
    this.paintHidden(boss);
    const x = boss.pos.x;
    const z = boss.pos.z;
    const y = this.groundY(x, z);
    // Gathered Strength.
    if (shield) {
      if (this.shieldSince < 0) this.shieldSince = this.clock;
      const look = shieldLook(
        this.clock - this.shieldSince,
        stage === 'call' ? Math.max(0, phase?.value3 ?? 0) : 0,
      );
      this.shieldU.uAlpha.value = look.alpha;
      this.shieldU.uUrgent.value = look.urgent;
      this.shield.position.set(x, y - 0.3, z);
      this.shield.scale.set(R.shield, R.shield * 1.25, R.shield);
      this.shield.visible = true;
    } else {
      this.shield.visible = false;
      this.shieldSince = -1;
    }
    // The stride: a trail of the four veins behind it.
    if ((stage === 'leap' || stage === 'finalLeap') && this.rand() < 0.9 * this.density) {
      const v = HEART_QUARTER_ORDER[Math.floor(this.rand() * 4) % 4];
      this.particles.puff(x, y + 2 + this.rand() * 6, z, 3, {
        speed: 2,
        up: 2,
        life: 1.0,
        size: [0.9, 0.2],
        color: VEIN_RGB[v],
        alpha: 1,
        pool: 'glow',
        radius: 3,
      });
      if (this.rand() < 0.4) this.dustAt(x, z, 2, 3);
    }
    // The poured elements: one ring of each round its body.
    let n = 0;
    const pouredVeins: SmithHeartVein[] = [];
    for (const v of HEART_QUARTER_ORDER)
      if (boss.auras.some((a) => a.id === pouredAuraId(v))) pouredVeins.push(v);
    for (const v of pouredVeins) {
      const m = this.poured[n];
      if (!m) break;
      const o = pouredOrbit(n, pouredVeins.length, this.clock);
      m.position.set(x, y + o.height, z);
      m.scale.setScalar(o.radius);
      m.rotation.set(o.tilt, o.spin, 0.3 * Math.sin(o.spin * 0.5));
      this.pouredMats[n].color.setHex(SPLINTER_LOOKS[v].color);
      this.pouredMats[n].opacity = 0.75 + 0.25 * Math.sin(this.clock * 4 + n);
      m.visible = true;
      if (this.rand() < 0.25 * this.density) {
        const a = o.spin * 1.3;
        this.motesAt(x + Math.cos(a) * o.radius, z + Math.sin(a) * o.radius, v, 1, 0.5);
      }
      n++;
    }
    for (let i = n; i < this.poured.length; i++) this.poured[i].visible = false;
    // Masterless Fury.
    const k = furyLook(fury, this.clock);
    this.fury.visible = k > 0;
    if (k > 0) {
      this.fury.position.set(x, y + 0.2, z);
      this.fury.scale.setScalar(8 + 1.5 * Math.sin(this.clock * 7));
      this.furyMat.opacity = k;
      if (this.rand() < k * this.density) this.sparkAt(x, z, [1, 0.4, 0.3], 2, 7);
    }
  }

  /** Every Splinter: its sigil and motes, its rising column, its bars'
   *  footprints, the hunt's ring and tether. */
  private paintSplinters(world: IWorld): void {
    let sig = 0;
    let tether = 0;
    for (const id of this.addIds) {
      const e = world.entities.get(id);
      if (!e || e.dead) continue;
      const vein = finalAddVein(e.templateId);
      if (!vein) continue;
      const L = SPLINTER_LOOKS[vein];
      const x = e.pos.x;
      const z = e.pos.z;
      const y = this.groundY(x, z);
      const rising = e.auras.some((a) => a.id === A.rising);
      const s = this.sigils[sig++];
      if (s) {
        s.mesh.position.set(x, y + 0.05, z);
        s.mesh.scale.setScalar(R.sigil);
        s.color.value.setHex(L.color);
        s.alpha.value = rising ? 0.6 + 0.4 * Math.sin(this.clock * 9) : 0.85;
        s.spin.value = vein === 'breath' ? 1.2 : 0.4;
        s.mesh.visible = true;
      }
      if (rising && this.rand() < 0.8 * this.density) this.motesAt(x, z, vein, 3, 2.5);
      else if (this.rand() < 0.35 * this.density) this.motesAt(x, z, vein, 1, 1.6);
      // Its bars.
      const total = e.castTotal > 0 ? e.castTotal : 1;
      if (e.castingAbility === C.shear) {
        const fill = telegraphFillOf(e.castRemaining, total);
        this.foot(
          -(id * 8 + 1),
          SPLINTER_SHEAR_KIND[vein],
          L.element,
          PHASE_FOOTPRINTS.shear,
          x,
          z,
          e.facing,
          R.shear,
          R.shearArc,
          fill,
        );
      } else if (e.castingAbility === C.toll && this.rand() < 0.9 * this.density) {
        // The toll gathers: frost drawn into the Splinter.
        const a = this.rand() * Math.PI * 2;
        this.particles.puff(x + Math.sin(a) * 6, y + 1.5, z + Math.cos(a) * 6, 1, {
          speed: 6,
          life: 0.9,
          size: [0.4, 0.1],
          color: L.mote,
          alpha: 1,
          pool: 'glow',
          dir: [-Math.sin(a), 0.1, -Math.cos(a)],
          spread: 0.1,
        });
      } else if (e.castingAbility === C.pounce && e.castTargetId !== null) {
        const t = world.entities.get(e.castTargetId);
        if (t)
          this.foot(
            -(id * 8 + 2),
            'pounce',
            'storm',
            PHASE_FOOTPRINTS.pounce,
            t.pos.x,
            t.pos.z,
            0,
            R.pounce,
            360,
            telegraphFillOf(e.castRemaining, total),
          );
      }
      // The hunt: its quarry carries Wind-Tethered from it.
      if (vein === 'breath') {
        const quarry = this.quarryOf(world, id);
        if (quarry && e.castingAbility !== C.pounce) {
          this.foot(
            -(id * 8 + 3),
            'buffet',
            'storm',
            PHASE_FOOTPRINTS.buffet,
            x,
            z,
            0,
            R.buffet,
            360,
            0.5 + 0.5 * Math.sin(this.clock * 6),
          );
          if (tether < PL.tethers) this.tetherTo(tether++, e, quarry);
          if (this.rand() < 0.6 * this.density) this.sparkAt(x, z, VEIN_RGB.breath, 2, R.buffet);
        }
      }
    }
    for (let i = sig; i < this.sigils.length; i++) this.sigils[i].mesh.visible = false;
    for (let i = tether * PL.tetherSegments; i < PL.tethers * PL.tetherSegments; i++)
      this.tethers.setMatrixAt(i, _m.makeScale(0, 0, 0));
    this.tethers.instanceMatrix.needsUpdate = true;
    this.tethers.visible = tether > 0;
  }

  /** The player a Breath Splinter hunts (Wind-Tethered from it), or null. */
  private quarryOf(world: IWorld, addId: number): Entity | null {
    for (const pid of this.playerIds) {
      const p = world.entities.get(pid);
      if (!p || p.dead) continue;
      for (const a of p.auras) if (a.id === A.tether && a.sourceId === addId) return p;
    }
    return null;
  }

  /** A jittering storm tether from `from` to `to` (slot `k`). */
  private tetherTo(k: number, from: Entity, to: Entity): void {
    const sy = this.groundY(from.pos.x, from.pos.z) + 3;
    const ty = this.groundY(to.pos.x, to.pos.z) + 1.3;
    let px = from.pos.x;
    let py = sy;
    let pz = from.pos.z;
    const seg = PL.tetherSegments;
    for (let i = 1; i <= seg; i++) {
      const f = i / seg;
      const j = i === seg ? 0 : 0.9;
      const nx =
        from.pos.x + (to.pos.x - from.pos.x) * f + (fxHash(k * 31 + i, this.clock * 24) - 0.5) * j;
      const ny = sy + (ty - sy) * f + (fxHash(k * 17 + i, this.clock * 19) - 0.5) * j;
      const nz =
        from.pos.z + (to.pos.z - from.pos.z) * f + (fxHash(k * 13 + i, this.clock * 27) - 0.5) * j;
      _v.set(nx - px, ny - py, nz - pz);
      const len = _v.length();
      _v.normalize();
      _q.setFromUnitVectors(UP, _v);
      _m.compose(_v2.set(px, py, pz), _q, _s.set(0.07, len, 0.07));
      this.tethers.setMatrixAt(k * seg + i - 1, _m);
      px = nx;
      py = ny;
      pz = nz;
    }
  }

  /** The players' marks: Bursting Coal's reach and its coal. */
  private paintMarks(world: IWorld): void {
    let coal = 0;
    for (const pid of this.playerIds) {
      const p = world.entities.get(pid);
      if (!p || p.dead) continue;
      for (const a of p.auras) {
        if (a.id !== A.coal) continue;
        const fill = a.duration > 0 ? 1 - a.remaining / a.duration : 1;
        this.foot(
          -(pid * 8 + 6),
          'coal',
          'fire',
          PHASE_FOOTPRINTS.coal,
          p.pos.x,
          p.pos.z,
          0,
          R.coal,
          360,
          fill,
        );
        const m = this.coals[coal++];
        if (m) {
          const y = this.groundY(p.pos.x, p.pos.z);
          const throb = 1 + 0.25 * fill + 0.12 * Math.sin(this.clock * (8 + 14 * fill));
          m.position.set(p.pos.x, y + 3.2, p.pos.z);
          m.scale.setScalar(throb);
          m.rotation.y = this.clock * 2;
          m.visible = true;
          if (this.rand() < 0.7 * this.density)
            this.particles.puff(p.pos.x, y + 3.2, p.pos.z, 1, {
              speed: 1,
              up: 2.5,
              life: 0.6,
              size: [0.5, 0.1],
              color: [1, 0.6, 0.25],
              alpha: 1,
              pool: 'pyre',
              radius: 0.4,
            });
        }
      }
    }
    for (let i = coal; i < this.coals.length; i++) this.coals[i].visible = false;
    this.coalMat.color.setRGB(1, 0.55 + 0.2 * Math.sin(this.clock * 9), 0.2);
  }

  /** Every Quenching Ring at the sim's front, its gaps cut clean. */
  private paintRings(world: IWorld): void {
    let n = 0;
    for (const id of this.ringIds) {
      const e = world.entities.get(id);
      const born = this.seen.get(id);
      if (!e || born === undefined) continue;
      const info = quenchRingOf(e.templateId);
      if (!info) continue;
      const look = quenchRingLook(this.clock - born);
      if (!look.alive) continue;
      const r = this.rings[n++];
      if (!r) break;
      const gaps = quenchRingGaps(info.seed, info.gaps);
      const g = r.u.uGaps.value as THREE.Vector4;
      g.set(gaps[0] ?? 0, gaps[1] ?? 0, gaps[2] ?? 0, gaps[3] ?? 0);
      r.u.uGapN.value = gaps.length;
      r.u.uFront.value = look.front;
      r.u.uAlpha.value = look.alpha;
      r.mesh.position.set(e.pos.x, this.groundY(e.pos.x, e.pos.z) + 0.07, e.pos.z);
      r.mesh.visible = true;
      // Frost thrown up off its front (cosmetic).
      if (this.rand() < 0.8 * this.density) {
        const a = this.rand() * Math.PI * 2;
        const fx = e.pos.x + Math.sin(a) * look.front;
        const fz = e.pos.z + Math.cos(a) * look.front;
        this.particles.puff(fx, this.groundY(fx, fz) + 0.3, fz, 1, {
          speed: 1,
          up: 2,
          life: 0.7,
          size: [0.5, 0.15],
          color: [0.8, 0.93, 1],
          alpha: 1,
          pool: 'glow',
          radius: 0.5,
        });
      }
    }
    for (let i = n; i < this.rings.length; i++) this.rings[i].mesh.visible = false;
  }

  private paintPillars(): void {
    for (const p of this.pillars) {
      if (!p.mesh.visible) continue;
      const look = pillarLook(this.clock - p.born, p.life);
      if (look.alpha <= 0) {
        p.mesh.visible = false;
        continue;
      }
      p.alpha.value = look.alpha;
      p.mesh.scale.set(p.radius, Math.max(0.01, p.height * look.height), p.radius);
    }
  }

  private paintBeams(world: IWorld): void {
    for (const b of this.beams) {
      if (!b.mesh.visible) continue;
      const look = pourLook(this.clock - b.born);
      const boss = world.entities.get(b.bossId);
      if (look.alpha <= 0 || !boss) {
        b.mesh.visible = false;
        continue;
      }
      const to = _v2.set(boss.pos.x, this.groundY(boss.pos.x, boss.pos.z) + 8, boss.pos.z);
      _v.copy(to).sub(b.from);
      const len = _v.length();
      _v.normalize();
      _q.setFromUnitVectors(UP, _v);
      b.mesh.position.copy(b.from);
      b.mesh.quaternion.copy(_q);
      b.mesh.scale.set(look.width, len, look.width);
      b.alpha.value = look.alpha;
      // Motes racing along it into the boss.
      if (this.rand() < 0.9 * this.density) {
        const f = this.rand();
        this.particles.puff(
          b.from.x + _v.x * len * f,
          b.from.y + _v.y * len * f,
          b.from.z + _v.z * len * f,
          1,
          {
            speed: 14,
            life: 0.4,
            size: [0.6, 0.1],
            color: [b.color.value.r, b.color.value.g, b.color.value.b],
            alpha: 1,
            pool: 'glow',
            dir: [_v.x, _v.y, _v.z],
            spread: 0.05,
          },
        );
      }
    }
  }

  private leave(): void {
    this.active = false;
    this.rosterSeen = Number.NaN;
    for (const el of ELEMENTS)
      for (const s of this.pools[el]) {
        s.key = 0;
        s.d.fan.group.visible = false;
      }
    this.slotByKey.clear();
    this.seen.clear();
    this.shield.visible = false;
    this.fury.visible = false;
    this.tethers.visible = false;
    for (const m of [...this.poured, ...this.coals]) m.visible = false;
    for (const r of this.rings) r.mesh.visible = false;
    for (const s of this.sigils) s.mesh.visible = false;
    for (const p of this.pillars) p.mesh.visible = false;
    for (const b of this.beams) b.mesh.visible = false;
    this.shieldSince = -1;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.particles.dispose();
    this.kit.dispose();
    this.tethers.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
