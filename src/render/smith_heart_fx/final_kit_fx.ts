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
//     (lethal, frost creeping in to its break) and your own cold's reach in
//     frost; a Storm Orb (the soak's gold), Drawn Lightning's reach and
//     Leaping Bolt's leap in storm; a Tremor Crack, Weight of the Anvil's
//     mark (the soak's gold, turning on Mythic) and Crushed in granite; and
//     the gale's rim band (a ragged storm edge where the safe floor ends);
//   - the reaction and the impact, cosmetic over them: the whirls' twisting
//     funnels of fire with their white-hot cores, the pools' flames, frost at
//     a crack, the gale's streaks and dust, lightning leaping between bodies,
//     the orbs (a crackling fresnel shell, a pulsing core, a turning ring),
//     the great anvil of carved stone and gold crystal hanging over its mark
//     and dropping onto it, the granite shells, the ice round a frozen
//     player, Taking Root's spikes, Heart Unbound's blazing ring of the four
//     veins, the switch's shockwave racing over the floor in the four veins'
//     bands.
// The footprints, the rim band, the ice, the shells, the anvil, the root's
// spikes, the centre's ring and the shockwave draw on every tier; the
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
import { HEART_ROOM, inSmithHeartRoom } from '../../sim/content/smith_heart_layout';
import { DUNGEONS, instanceOrigin, instanceSlotForZ } from '../../sim/data';
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
import { GFX } from '../gfx';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { heartKitMeshes, SMITH_HEART_HEART_KIT_URL } from '../smith_heart/heart_kit';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  anvilDrop,
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
  rootRise,
  shockWave,
  timedFill,
  whirlSpin,
} from './final_kit_fx_core';
import {
  ICE_FRAG,
  KIT_UV_VERT,
  ORB_CORE_FRAG,
  ORB_FRAG,
  RIM_FRAG,
  RIM_VERT,
  SHELL_FRAG,
  SHOCK_FRAG,
  UNBOUND_FRAG,
  WHIRL_FRAG,
  WHIRL_VERT,
} from './final_kit_glsl';
import {
  anvilCrystals,
  anvilStone,
  FINAL_ANVIL_PIECE,
  iceCrust,
  shellStone,
} from './final_kit_shapes';
import {
  coldReachFill,
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

interface WhirlBody {
  outer: THREE.Mesh;
  core: THREE.Mesh;
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
  private readonly orbs: OrbBody[] = [];
  private readonly ice: THREE.Mesh[] = [];
  private readonly shells: THREE.Mesh[] = [];
  private readonly arcsMesh: THREE.InstancedMesh;
  private readonly arcs: Arc[] = [];
  private readonly spikes: THREE.InstancedMesh;
  private readonly anvil = new THREE.Group();
  private readonly anvilStoneMat: THREE.MeshLambertMaterial;
  private readonly anvilCrystalMat: THREE.MeshBasicMaterial;
  private readonly rim: THREE.Mesh;
  private readonly rimMat: THREE.ShaderMaterial;
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
  private readonly galeAt = { x: 0, y: 0, z: 0 };
  private galeBlowing = false;
  private rosterSeen = Number.NaN;
  private scanTimer = 0;
  private bossId = -1;
  private clock = 0;
  private seed = 0x3c71;
  private active = false;
  private disposed = false;
  private originX = 0;
  private originZ = 0;
  private windHeading = 0;

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
    // The whirls: a funnel of flame twisting up (narrow at the floor, wide at
    // its lip) round a white-hot core, each its own seed.
    const funnel = new THREE.CylinderGeometry(1.25, 0.32, 1, 28, 18, true).translate(0, 0.5, 0);
    const coreGeo = new THREE.CylinderGeometry(0.5, 0.14, 1, 18, 14, true).translate(0, 0.5, 0);
    this.geometries.push(funnel, coreGeo);
    for (let i = 0; i < P.whirls; i++) {
      const seedU = { value: fxHash(i, 5) * 20 };
      const outerU = {
        uTime: this.uTime,
        uAlpha: { value: 1 },
        uCoreK: { value: 0 },
        uSeed: seedU,
        uTwist: { value: 1.6 },
        uCore: col(C.fireCore),
        uFire: col(C.fire),
      };
      const coreU = {
        ...outerU,
        uAlpha: { value: 1 },
        uCoreK: { value: 1 },
        uTwist: { value: 2.6 },
      };
      const extra = { side: THREE.DoubleSide, blending: THREE.AdditiveBlending } as const;
      const outer = mesh(
        funnel,
        shader('smithHeartFinalWhirl', outerU, WHIRL_VERT, WHIRL_FRAG, extra),
        'smithHeartFinalWhirl',
      );
      const core = mesh(
        coreGeo,
        shader('smithHeartFinalWhirlCore', coreU, WHIRL_VERT, WHIRL_FRAG, extra),
        'smithHeartFinalWhirlCore',
      );
      this.whirls.push({ outer, core, outerU, coreU });
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
    // Taking Root's spikes of rock.
    const spikeGeo = new THREE.ConeGeometry(0.7, 1, 5).translate(0, 0.5, 0);
    this.geometries.push(spikeGeo);
    const spikeMat = new THREE.MeshLambertMaterial({
      name: 'smithHeartFinalRootSpikes',
      color: new THREE.Color(...C.stone).multiplyScalar(0.8),
      flatShading: true,
    });
    this.materials.push(spikeMat);
    this.spikes = new THREE.InstancedMesh(spikeGeo, spikeMat, P.rootSpikes);
    this.spikes.name = 'smithHeartFinalRootSpikes';
    this.spikes.frustumCulled = false;
    this.spikes.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < P.rootSpikes; i++) this.spikes.setMatrixAt(i, _m.makeScale(0, 0, 0));
    this.root.add(this.spikes);
    // The great anvil: carved from one block of granite (its stone toned per
    // vertex, chiselled flat), gold crystals set in its face, heel and
    // flanks, its veins and crystals hotter as it falls. Built-in materials
    // (lit by the room like the rest of the Heart's stone): only their
    // colours move a frame, never their programs.
    const stoneGeo = anvilStone();
    const crystalGeo = anvilCrystals();
    this.geometries.push(stoneGeo, crystalGeo);
    this.anvilStoneMat = new THREE.MeshLambertMaterial({
      name: 'smithHeartFinalAnvilStone',
      vertexColors: true,
      emissive: 0x120804,
    });
    this.anvilCrystalMat = new THREE.MeshBasicMaterial({
      name: 'smithHeartFinalAnvilCrystal',
      color: 0xffb030,
      vertexColors: true,
      toneMapped: false,
    });
    this.materials.push(this.anvilStoneMat, this.anvilCrystalMat);
    // The Blender model when the Heart kit has landed (the interior waits for it,
    // capped), the carved fallback otherwise; the same two materials either way.
    const kitAnvil = hasDom ? heartKitMeshes(SMITH_HEART_HEART_KIT_URL, FINAL_ANVIL_PIECE) : null;
    if (kitAnvil) {
      for (const m of kitAnvil.children) {
        if (!(m instanceof THREE.Mesh)) continue;
        m.material = m.name.endsWith(':glow') ? this.anvilCrystalMat : this.anvilStoneMat;
        m.frustumCulled = false;
      }
      this.anvil.add(kitAnvil);
    } else {
      for (const [geo, mat] of [
        [stoneGeo, this.anvilStoneMat],
        [crystalGeo, this.anvilCrystalMat],
      ] as const) {
        const m = new THREE.Mesh(geo, mat);
        m.frustumCulled = false;
        this.anvil.add(m);
      }
    }
    this.anvil.name = 'smithHeartFinalAnvil';
    this.anvil.visible = false;
    this.root.add(this.anvil);
    // The gale's rim band (every tier): a flat ring from just inside the
    // band's edge to the rim, on its own floor rung.
    const rimGeo = new THREE.RingGeometry(R.rimInner - 2, R.rimOuter, 200, 2).rotateX(-Math.PI / 2);
    this.geometries.push(rimGeo);
    this.rimMat = shader(
      'smithHeartFinalRimBand',
      {
        uTime: this.uTime,
        uAlpha: { value: 0 },
        uHeading: { value: 0 },
        uInner: { value: R.rimInner },
        uOuter: { value: R.rimOuter },
        uDetail: { value: detail ? 1 : 0 },
        uColor: { value: new THREE.Color(FINAL_FOOTPRINTS.rim.color) },
        uStorm: col(C.storm),
      },
      RIM_VERT,
      RIM_FRAG,
      { side: THREE.DoubleSide, blending: THREE.AdditiveBlending },
    );
    this.rim = mesh(rimGeo, this.rimMat, 'smithHeartFinalRimBand');
    this.rim.renderOrder = floorVfxRenderOrder('encounter', F.rim);
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
      else if (ev.ability === FINAL_CUES.freeze) {
        this.sparkAt(x, z, C.frost, 22, 1.6);
        this.particles.shockRing(x, z, 0xbfe6ff, 4, 0.5);
      } else if (ev.ability === FINAL_CUES.shell) this.dustAt(x, z, 10, 1.4);
      else if (ev.ability === FINAL_CUES.root) {
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
        this.anvil.visible = false;
        this.dustAt(x, z, 60, R.anvil);
        this.particles.shockRing(x, z, C.soak, R.anvil * 2.6, 0.9);
        this.particles.shockRing(x, z, 0xffffff, R.anvil * 1.2, 0.35);
        this.sparkAt(x, z, [1, 0.85, 0.5], 40, R.anvil);
        this.shake(x, z, 0.9, 90);
        break;
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
      this.audio.update(null, this.splinterIds, this.lookup, null, null, null);
      this.particles.update(this.clock);
      return;
    }
    this.active = true;
    this.scan(world, dt);
    for (const el of ELEMENTS) for (const s of this.pools[el]) s.seen = false;
    this.paintObjects(world);
    this.paintMarks(world);
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
    this.audio.update(
      boss,
      this.splinterIds,
      this.lookup,
      this.galeBlowing ? this.galeAt : null,
      me ?? null,
      this.centre,
    );
  }

  private scan(world: IWorld, dt: number): void {
    this.scanTimer -= dt;
    if (world.entityRosterVersion === this.rosterSeen && this.scanTimer > 0) return;
    this.scanTimer = SCAN_SEC;
    if (world.entityRosterVersion === this.rosterSeen) return;
    this.rosterSeen = world.entityRosterVersion;
    this.objectIds.length = 0;
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
        if (!kind) continue;
        this.objectIds.push(e.id);
        if (!this.seen.has(e.id)) {
          this.seen.set(e.id, { born: this.clock, kind });
          // A footprint appearing: its warning (a whirl rising, the gale
          // gathering, the ice groaning, an orb, a tremor crack).
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
    let orb = 0;
    let anvilShown = false;
    let wind: Entity | null = null;
    let blowing = false;
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
            w.outer.position.set(x, y, z);
            w.outer.scale.set(R.whirl * 0.95, spin.height, R.whirl * 0.95);
            w.core.position.set(x, y, z);
            w.core.scale.set(R.whirl * 0.8, spin.height * 0.92, R.whirl * 0.8);
            w.outerU.uAlpha.value = live;
            w.coreU.uAlpha.value = live;
            w.outer.visible = true;
            w.core.visible = true;
          }
          if (kind === 'whirl' && this.rand() < 0.8 * this.density)
            this.particles.puff(x, y + 1, z, 2, {
              speed: 3,
              up: 6,
              life: 0.9,
              size: [0.5, 0.1],
              color: C.fire,
              alpha: 1,
              pool: 'glow',
              radius: R.whirl * 0.6,
            });
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
          const fill =
            boss && boss.castingAbility === FINAL_CASTS.anvil
              ? telegraphFillOf(boss.castRemaining, boss.castTotal > 0 ? boss.castTotal : total)
              : timedFill(age, total);
          this.foot(id, 'anvil', FINAL_FOOTPRINTS.anvil, x, z, r, fill, true);
          const drop = anvilDrop(fill);
          this.anvil.position.set(x, y + drop.height, z);
          this.anvil.rotation.y = 0.9 + this.clock * 0.12;
          // Its crystals and the heat in its stone burn hotter as it falls.
          this.anvilCrystalMat.color.setRGB(
            0.8 + 0.7 * drop.glow,
            0.45 + 0.4 * drop.glow,
            0.1 + 0.12 * drop.glow,
          );
          this.anvilStoneMat.emissive.setRGB(0.09 * drop.glow, 0.035 * drop.glow, 0.01);
          // Grit and gold motes falling off it as it hangs and drops.
          if (this.rand() < 0.5 * this.density)
            this.particles.puff(x, y + drop.height + 0.5, z, 1, {
              speed: 0.6,
              up: -3,
              life: 1.2,
              size: [0.3, 0.12],
              color: [1, 0.8, 0.45],
              alpha: 1,
              pool: 'glow',
              radius: R.anvil * 0.6,
            });
          this.anvil.visible = true;
          anvilShown = true;
          break;
        }
        case 'windWarn':
        case 'windBlow':
          wind = e;
          if (kind === 'windBlow') {
            blowing = true;
            this.galeAt.x = x;
            this.galeAt.y = y;
            this.galeAt.z = z;
          }
          break;
        default:
      }
    }
    for (let i = whirl; i < this.whirls.length; i++) {
      this.whirls[i].outer.visible = false;
      this.whirls[i].core.visible = false;
    }
    for (let i = orb; i < this.orbs.length; i++) {
      const ob = this.orbs[i];
      ob.shell.visible = false;
      ob.core.visible = false;
      ob.ring.visible = false;
    }
    if (!anvilShown) this.anvil.visible = false;
    this.galeBlowing = blowing;
    this.paintWind(wind);
  }

  /** The gale: its rim band (every tier) and its streaks racing the way it
   *  blows. */
  private paintWind(wind: Entity | null): void {
    if (!wind) {
      this.rim.visible = false;
      return;
    }
    const blowing = finalObjectKind(wind.templateId) === 'windBlow';
    this.windHeading = wind.facing;
    const cx = this.originX + HEART_ROOM.x;
    const cz = this.originZ + HEART_ROOM.z;
    this.rim.position.set(cx, this.groundY(cx, cz) + 0.08, cz);
    this.rimMat.uniforms.uHeading.value = this.windHeading;
    this.rimMat.uniforms.uAlpha.value = blowing ? 1 : 0.45 + 0.25 * Math.sin(this.clock * 8);
    this.rim.visible = true;
    const n = blowing ? 6 : 1;
    const sx = Math.sin(this.windHeading);
    const sz = Math.cos(this.windHeading);
    for (let i = 0; i < n; i++) {
      if (this.rand() > this.density) continue;
      const a = this.rand() * Math.PI * 2;
      const r = Math.sqrt(this.rand()) * HEART_ROOM.r;
      const x = cx + Math.cos(a) * r;
      const z = cz + Math.sin(a) * r;
      this.particles.puff(x, this.groundY(x, z) + 0.6 + this.rand() * 3, z, 1, {
        speed: blowing ? 20 : 4,
        life: 0.9,
        size: [0.25, 0.08],
        color: C.storm,
        alpha: 0.8,
        pool: 'glow',
        dir: [sx, 0, sz],
        spread: 0.05,
      });
      if (blowing && this.rand() < 0.5)
        this.particles.puff(x, this.groundY(x, z) + 0.3, z, 1, {
          speed: 9,
          life: 1.4,
          size: [1.2, 3],
          color: C.dust,
          alpha: 0.3,
          dir: [sx, 0.05, sz],
          spread: 0.15,
        });
    }
  }

  /** The players' marks: the ember's ring, the lightning's reach, the ice,
   *  the stone, Crushed. */
  private paintMarks(world: IWorld): void {
    let ice = 0;
    let shell = 0;
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
        } else if (a.id === FINAL_AURAS.frozen || a.id === FINAL_AURAS.underIce) {
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
        } else if (a.id === FINAL_AURAS.cold && pid === world.playerId && (a.value ?? 0) > 0) {
          // Your own cold's reach: the ring your two allies must stand in,
          // frost closing in as the cold rises.
          const fill = coldReachFill(a.value ?? 0);
          this.foot(-(pid * 8 + 5), 'cold', FINAL_FOOTPRINTS.cold, x, z, R.cold, fill, true);
        }
      }
    }
    for (let i = ice; i < this.ice.length; i++) this.ice[i].visible = false;
    for (let i = shell; i < this.shells.length; i++) this.shells[i].visible = false;
  }

  /** The boss: Leaping Bolt's target ring, Taking Root's spikes, Heart
   *  Unbound's blaze. */
  private paintBoss(world: IWorld): void {
    const boss = this.bossId >= 0 ? world.entities.get(this.bossId) : undefined;
    if (!boss || boss.dead) {
      this.spikes.visible = false;
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
    let root: Entity['auras'][number] | undefined;
    let unbound: Entity['auras'][number] | undefined;
    for (const a of boss.auras) {
      if (a.id === FINAL_AURAS.root) root = a;
      else if (a.id === FINAL_AURAS.unbound) unbound = a;
    }
    const bossAt = fxAnchor(boss);
    const x = bossAt.x;
    const z = bossAt.z;
    const y = this.groundY(x, z);
    const rise = root ? rootRise(root.remaining) : 0;
    this.spikes.visible = rise > 0.01;
    if (this.spikes.visible) {
      for (let i = 0; i < P.rootSpikes; i++) {
        const a = (i / P.rootSpikes) * Math.PI * 2 + fxHash(i, 9) * 0.4;
        const rr = 5.4 + fxHash(i, 4) * 1.2;
        const h = (2.2 + fxHash(i, 2) * 2.2) * rise;
        _v.set(x + Math.cos(a) * rr, y - 0.4, z + Math.sin(a) * rr);
        _v2.set(Math.cos(a) * 0.35, 1, Math.sin(a) * 0.35).normalize();
        _q.setFromUnitVectors(UP, _v2);
        _m.compose(_v, _q, _s.set(1, Math.max(0.01, h), 1));
        this.spikes.setMatrixAt(i, _m);
      }
      this.spikes.instanceMatrix.needsUpdate = true;
      if (rise > 0.9 && this.rand() < 0.3 * this.density) this.dustAt(x, z, 1, 6);
    }
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
    this.rosterSeen = Number.NaN;
    for (const el of ELEMENTS)
      for (const s of this.pools[el]) {
        s.key = 0;
        s.d.fan.group.visible = false;
      }
    this.slotByKey.clear();
    this.seen.clear();
    for (const w of this.whirls) {
      w.outer.visible = false;
      w.core.visible = false;
    }
    for (const ob of this.orbs) {
      ob.shell.visible = false;
      ob.core.visible = false;
      ob.ring.visible = false;
    }
    for (const m of [...this.ice, ...this.shells]) m.visible = false;
    this.shock.visible = false;
    this.anvil.visible = false;
    this.rim.visible = false;
    this.spikes.visible = false;
    this.unboundRing.visible = false;
    this.arcsMesh.visible = false;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.audio.dispose();
    this.root.removeFromParent();
    this.particles.dispose();
    this.kit.dispose();
    this.arcsMesh.dispose();
    this.spikes.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
  }
}
