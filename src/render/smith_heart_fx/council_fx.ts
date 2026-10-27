// The Hammer Council's effects (plan: council_fx_core.ts), hosted by
// ../rift_death_zone.ts beside the guardians'. Presentation only, read from
// IWorld (the pillar, rubble and rise-spot objects, the auras on the players,
// the council's bars and energy, its events), so offline and online look the
// same:
//  - the pillars: the quarry's carved columns and the Slabwright's raised
//    stone (the Hammer and rock kits' own pieces), each showing its integrity
//    on the model on every tier: a network of seams that cracks open and
//    burns hotter as it loses pieces, a lean that grows, the crown split
//    loose at the last piece, three pips round its foot that go dark one by
//    one; a risen pillar bursts out of the floor with dust and shards; a
//    fallen one tips, breaks and sinks into its rubble, which lies as a
//    hazard footprint until it is gone; the council's fall sinks the risen
//    ones;
//  - the marks: Wake the Stone's circle round its player (the knockback's
//    reach, the control colour) with the ghost of the pillar it will raise
//    growing in it; the heir's rising stone locked on the floor; the Falling
//    Rock's soak (gold: gather in it) with the boulder dropping out of the
//    sky over its last moments and its impact; Resonance's ring round its
//    player (the reach a pillar's face must be within) and, while it
//    cracks one, the thread of light to that pillar and the pillar humming;
//    Hammer's Weight's slam on the tank and its mark at the tank's feet;
//  - the Seam Singer's bolt (an ochre shard), the heroic pillars' pulse
//    rings, the inheritance's stream of stone light from the fallen to each
//    survivor, and the Wrath holder's energy gathering round it.
// Every footprint, ring, pip, crack and lean draws on every tier (the static
// preset sheds only the dust, grit and debris); reduced motion drops the
// shakes.
//
// Rules (src/render/CLAUDE.md): every material is built in the constructor
// under one root before its gated attach (the kits' pieces, which land later,
// draw with the kits' shared slot materials, linked with the interior); no
// light; fixed pools, no per-frame allocation; the footprints ride the floor
// ladder's encounter band through the shared floor telegraph.

import * as THREE from 'three';
import { sfx } from '../../game/sfx';
import { CouncilAudio } from '../../game/smith_heart_council_audio';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import {
  type CouncilRole,
  COUNCIL_TUNING as T,
} from '../../sim/encounters/smith_heart/council_ids';
import type { Aura, Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import { type TelegraphFan, TelegraphKit } from '../floor_telegraph';
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
  SMITH_HEART_HAMMER_KIT_URL,
  SMITH_HEART_HEART_KIT_URL,
  SMITH_HEART_ROCK_KIT_URL,
} from '../smith_heart/heart_kit';
import { radialGlowTexture } from '../textures';
import { EngineParticles } from '../trash_engine_fx/engine_particles';
import {
  BOLT_SECONDS,
  COUNCIL_FX_COLORS as C,
  COUNCIL_AURAS,
  COUNCIL_CASTS,
  COUNCIL_CUES,
  COUNCIL_MARK_SPECS,
  COUNCIL_RUBBLE,
  councilClaims,
  councilPillarOf,
  councilRiseSpotSeconds,
  councilRoleOf,
  councilSoulOf,
  energyLook,
  INHERIT_SECONDS,
  inheritArc,
  inSmithHeartClaim,
  markFill,
  COUNCIL_FX_POOLS as POOLS,
  RISE_SPOT_SPEC,
  resonanceRing,
  rockFall,
  SOUL_COLORS,
  SOUL_TAKE_SECONDS,
  WEIGHT_DROP_SECONDS,
  wakeGhost,
} from './council_fx_core';
import { type CouncilFxHost, CouncilPillarsFx, RISEN_HEIGHT } from './council_pillars_fx';
import { CouncilShelters } from './council_shelter_fx';
import { CouncilSoakFx } from './council_soak_fx';
import { CouncilSoulFx } from './council_soul_fx';
import { chunkGeometry, Rubble } from './hammer_fx';

/** What a soul pillar is to the council's sound. */
const SOUL_SOUND = { guardian: 'echo', slabwright: 'slab', singer: 'song' } as const;

const SCAN_SEC = 0.1;
// ---- a soft additive band (the ghost pillar, Resonance, the threads) -----------------------

const BAND_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
const BAND_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
uniform float uFlow;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  float rise = 1.0 - vUv.y;
  float ripple = 0.6 + 0.4 * sin(vUv.y * 22.0 - uTime * uFlow + vUv.x * 6.2831853 * 3.0);
  float a = uAlpha * rise * ripple;
  gl_FragColor = vec4(uColor * (0.8 + 0.6 * ripple), a);
  #include <colorspace_fragment>
}
`;

// ---- a flat ring on the floor (Resonance's reach, the Weight's mark) ------------------------

const RING_VERT = /* glsl */ `
varying vec2 vXZ;
void main() {
  vXZ = position.xz;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** A ring of `uNotches` dashes (0: whole) turning with time; `uFill` of it
 *  lit (the Weight's time left), the rest dim. */
const RING_FRAG = /* glsl */ `
uniform float uAlpha;
uniform float uTime;
uniform float uNotches;
uniform float uSpin;
uniform float uFill;
uniform vec3 uColor;
varying vec2 vXZ;
void main() {
  float a = atan(vXZ.x, vXZ.y);
  float t = fract(a / 6.2831853 + 0.5 + uTime * uSpin);
  float dash = uNotches > 0.5 ? step(0.35, fract(t * uNotches)) : 1.0;
  float lit = step(fract(a / 6.2831853 + 0.5), uFill);
  float a2 = uAlpha * mix(0.25, 1.0, dash) * mix(0.35, 1.0, lit);
  gl_FragColor = vec4(uColor, a2);
  #include <colorspace_fragment>
}
`;

interface MarkSlot {
  key: string;
  playerId: number;
  auraId: string;
  fan: TelegraphFan;
  ghost: THREE.Mesh;
  ghostMat: THREE.ShaderMaterial;
  seen: boolean;
  /** Where the fan was last draped (NaN: not yet). */
  drapedX: number;
  drapedZ: number;
}

interface SpotSlot {
  id: number;
  fan: TelegraphFan;
  ghost: THREE.Mesh;
  ghostMat: THREE.ShaderMaterial;
  born: number;
  /** Its warning (the spot's template carries it: mythic's is shorter). */
  seconds: number;
  seen: boolean;
  x: number;
  y: number;
  z: number;
}

interface RockSlot {
  playerId: number;
  mesh: THREE.Group;
  spinAxis: THREE.Vector3;
  seen: boolean;
}

interface RingSlot {
  playerId: number;
  ring: THREE.Mesh;
  ringMat: THREE.ShaderMaterial;
  band: THREE.Mesh;
  bandMat: THREE.ShaderMaterial;
  thread: THREE.Mesh;
  threadMat: THREE.ShaderMaterial;
  seen: boolean;
}

interface WeightSlot {
  playerId: number;
  ring: THREE.Mesh;
  ringMat: THREE.ShaderMaterial;
  stone: THREE.Group | null;
  seen: boolean;
}

interface BoltSlot {
  alive: boolean;
  born: number;
  sourceId: number;
  targetId: number;
  from: THREE.Vector3;
  mesh: THREE.Mesh;
}

interface StreamSlot {
  alive: boolean;
  born: number;
  sourceId: number;
  targetId: number;
  from: THREE.Vector3;
  acc: number;
  /** Mythic: a soul flowing into its pillar (its colour, its arrival). */
  soul: CouncilRole | null;
}

interface DropSlot {
  alive: boolean;
  born: number;
  targetId: number;
  mesh: THREE.Group | null;
}

const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _m = new THREE.Matrix4();
const _s = new THREE.Vector3();
const _id = new THREE.Quaternion();
/** Per-frame scratch (the frame allocates nothing). */
const _paint = { fill: 0, clock: 0, range: 0 };
const _arc = { along: 0, lift: 0 };
const _moteColor: [number, number, number] = [1, 0.8, 0.36];
const _moteDir: [number, number, number] = [0, 1, 0];
const MOTE_GATHER = [1, 0.82, 0.4] as const;
const _markMote = {
  speed: 0,
  up: 0,
  life: 0.9,
  size: [0.3, 0.1] as const,
  color: _moteColor as readonly [number, number, number],
  alpha: 0.85,
  pool: 'glow' as const,
  dir: _moteDir as readonly [number, number, number],
  spread: 0.2,
};
const _beadMote = {
  speed: 0.6,
  life: 0.6,
  size: [0.6, 0.15] as const,
  color: _moteColor as readonly [number, number, number],
  alpha: 0.95,
  pool: 'glow' as const,
};
const _ember = {
  speed: 0.6,
  up: 0,
  life: 1,
  size: [0.3, 0.08] as const,
  color: _moteColor as readonly [number, number, number],
  alpha: 0.9,
  pool: 'glow' as const,
};
const ROCK_GRIT = {
  speed: 0.5,
  life: 0.7,
  size: [0.8, 2.2] as const,
  color: C.dust,
  alpha: 0.45,
};

/** An entity's aura by id (an indexed loop: no closure a frame). */
function auraById(e: Entity | undefined, id: string): Aura | undefined {
  if (!e) return undefined;
  const auras = e.auras;
  for (let i = 0; i < auras.length; i++) if (auras[i].id === id) return auras[i];
  return undefined;
}

/** The one reused paint of a fan (fill, clock, range). */
function paint(fill: number, clock: number, range: number): typeof _paint {
  _paint.fill = fill;
  _paint.clock = clock;
  _paint.range = range;
  return _paint;
}
/** Beads in one inheritance stream. */
const BEADS = 26;
const _beadColor = new THREE.Color();
/** A soul's colour as particle rgb (0..1), built once per soul. */
const SOUL_RGB_CACHE: Partial<Record<CouncilRole, [number, number, number]>> = {};
function _soulRgb(soul: CouncilRole): [number, number, number] {
  let c = SOUL_RGB_CACHE[soul];
  if (!c) {
    const hex = SOUL_COLORS[soul].hex;
    c = [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255];
    SOUL_RGB_CACHE[soul] = c;
  }
  return c;
}

export class CouncilFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly detail: boolean;
  private readonly particles: EngineParticles;
  private readonly debris: Rubble;
  private readonly kit: TelegraphKit;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly pillarsFx: CouncilPillarsFx;
  private readonly soulFx: CouncilSoulFx;
  /** The real safe shadows behind the pillars, for the Wrath and the Echo. */
  private readonly shelters: CouncilShelters;
  /** The soak's countdown rim, beacon and the rock's shadow. */
  private readonly soak: CouncilSoakFx;
  /** When the Wrath's shelters were last laid (the host clock), or -1. */
  private wrathLaidAt = -1;
  /** The council's sounds (game/smith_heart_council_audio.ts), fed by this
   *  painter's cues, scan and frame. */
  private readonly audio = new CouncilAudio(sfx);
  private readonly marks: MarkSlot[] = [];
  private readonly spots: SpotSlot[] = [];
  private readonly rocks: RockSlot[] = [];
  private readonly rings: RingSlot[] = [];
  private readonly weights: WeightSlot[] = [];
  private readonly bolts: BoltSlot[] = [];
  private readonly streams: StreamSlot[] = [];
  private readonly drops: DropSlot[] = [];
  private readonly halo: THREE.Sprite;
  private readonly haloMat: THREE.SpriteMaterial;
  /** The energy's gauge on the floor round its holder (every tier). */
  private readonly gauge: THREE.Mesh;
  private readonly gaugeMat: THREE.ShaderMaterial;
  /** The inheritance's beads of stone light (one instanced draw). */
  private readonly beads: THREE.InstancedMesh;
  private haloHolder = -1;
  private readonly glowTex: THREE.Texture | null;
  private seed = 0x3c11;
  private scanTimer = 0;
  private clock = 0;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
  ) {
    this.root.name = 'smith-heart-council-fx';
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
    const chunk = chunkGeometry();
    this.geometries.push(chunk);
    this.debris = new Rubble(
      this.root,
      Math.round(POOLS.debris * (this.detail ? 1 : 0.5)),
      chunk,
      (x, z) => this.groundY(x, z),
      () => this.rand(),
    );
    this.kit = new TelegraphKit(this.root, this.detail);
    // A one-triangle carrier for every material that waits on a kit's piece.
    const carrier = new THREE.BufferGeometry();
    carrier.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    carrier.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(6), 2));
    carrier.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]), 3),
    );
    this.geometries.push(carrier);
    const host: CouncilFxHost = {
      root: this.root,
      entity: (id) => this.world?.entities.get(id),
      uTime: this.uTime,
      particles: this.particles,
      debris: this.debris,
      kit: this.kit,
      groundY: (x, z) => this.groundY(x, z),
      rand: () => this.rand(),
      now: () => this.clock,
      density: this.density,
      detail: this.detail,
      reducedMotion: () => this.reducedMotion(),
      shakeNear: (x, z, amount, reach) => this.shakeNear(x, z, amount, reach),
      geometries: this.geometries,
      materials: this.materials,
    };
    this.pillarsFx = new CouncilPillarsFx(host, carrier);
    this.shelters = new CouncilShelters(host, this.pillarsFx);
    this.soak = new CouncilSoakFx(this.root, this.uTime, this.geometries, this.materials);
    this.soulFx = new CouncilSoulFx(host, this.pillarsFx, this.shelters);
    const bandGeo = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true).translate(0, 0.5, 0);
    const ringGeo = new THREE.RingGeometry(0.93, 1, 96, 1).rotateX(-Math.PI / 2);
    const threadGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true)
      .translate(0, 0.5, 0)
      .rotateX(Math.PI / 2);
    const shardGeo = new THREE.OctahedronGeometry(0.5, 0).scale(0.45, 0.45, 1.6);
    this.geometries.push(bandGeo, ringGeo, threadGeo, shardGeo);
    // ---- the marks and the heir's spots (a footprint and a ghost pillar) ----
    const ghostMat = (name: string, color: number) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: {
          uAlpha: { value: 0 },
          uTime: this.uTime,
          uFlow: { value: 3 },
          uColor: { value: new THREE.Color(color) },
        },
        vertexShader: BAND_VERT,
        fragmentShader: BAND_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      this.materials.push(m);
      return m;
    };
    for (let i = 0; i < POOLS.marks; i++) {
      const fan = this.kit.fan(14);
      fan.group.visible = false;
      const gm = ghostMat('smithHeartWakeGhost', C.ochre);
      const ghost = new THREE.Mesh(bandGeo, gm);
      ghost.name = 'smithHeartWakeGhost';
      ghost.visible = false;
      ghost.frustumCulled = false;
      this.root.add(ghost);
      this.marks.push({
        key: '',
        playerId: -1,
        auraId: '',
        fan,
        ghost,
        ghostMat: gm,
        seen: false,
        drapedX: Number.NaN,
        drapedZ: Number.NaN,
      });
    }
    for (let i = 0; i < POOLS.spots; i++) {
      const fan = this.kit.fan(14);
      this.kit.layOutFan(fan, 360, { color: RISE_SPOT_SPEC.color, accent: RISE_SPOT_SPEC.accent });
      fan.group.visible = false;
      const gm = ghostMat('smithHeartRiseGhost', C.ochre);
      const ghost = new THREE.Mesh(bandGeo, gm);
      ghost.name = 'smithHeartRiseGhost';
      ghost.visible = false;
      ghost.frustumCulled = false;
      this.root.add(ghost);
      this.spots.push({
        id: -1,
        fan,
        ghost,
        ghostMat: gm,
        born: -99,
        seconds: RISE_SPOT_SPEC.seconds,
        seen: false,
        x: 0,
        y: 0,
        z: 0,
      });
    }
    // ---- the falling rocks (a boulder of the rock kit once it lands) ----
    for (let i = 0; i < POOLS.rocks; i++) {
      const mesh = new THREE.Group();
      mesh.name = 'smithHeartFallingRock';
      mesh.visible = false;
      this.root.add(mesh);
      this.rocks.push({
        playerId: -1,
        mesh,
        spinAxis: new THREE.Vector3(1, 0.3, 0.2).normalize(),
        seen: false,
      });
    }
    // ---- Resonance: the ring, the shimmer round the body, the thread ----
    const ringMat = (name: string, color: number) => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: {
          uAlpha: { value: 0 },
          uTime: this.uTime,
          uNotches: { value: 0 },
          uSpin: { value: 0 },
          uFill: { value: 1 },
          uColor: { value: new THREE.Color(color) },
        },
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      this.materials.push(m);
      return m;
    };
    for (let i = 0; i < POOLS.rings; i++) {
      const rm = ringMat('smithHeartResonanceRing', C.resonance);
      rm.uniforms.uNotches.value = 12;
      rm.uniforms.uSpin.value = 0.08;
      const ring = new THREE.Mesh(ringGeo, rm);
      ring.name = 'smithHeartResonanceRing';
      ring.renderOrder = floorVfxRenderOrder('encounter', 22);
      ring.visible = false;
      ring.frustumCulled = false;
      this.root.add(ring);
      const bm = ghostMat('smithHeartResonanceBand', C.resonance);
      bm.uniforms.uFlow.value = 6;
      const band = new THREE.Mesh(bandGeo, bm);
      band.name = 'smithHeartResonanceBand';
      band.visible = false;
      band.frustumCulled = false;
      this.root.add(band);
      const tm = ghostMat('smithHeartResonanceThread', C.resonance);
      tm.uniforms.uFlow.value = 14;
      const thread = new THREE.Mesh(threadGeo, tm);
      thread.name = 'smithHeartResonanceThread';
      thread.visible = false;
      thread.frustumCulled = false;
      this.root.add(thread);
      this.rings.push({
        playerId: -1,
        ring,
        ringMat: rm,
        band,
        bandMat: bm,
        thread,
        threadMat: tm,
        seen: false,
      });
    }
    // ---- Hammer's Weight: the mark at the tank's feet and the stone over it ----
    for (let i = 0; i < POOLS.weights; i++) {
      const rm = ringMat('smithHeartWeightRing', C.weight);
      rm.uniforms.uNotches.value = 6;
      rm.uniforms.uSpin.value = -0.05;
      const ring = new THREE.Mesh(ringGeo, rm);
      ring.name = 'smithHeartWeightRing';
      ring.renderOrder = floorVfxRenderOrder('encounter', 23);
      ring.visible = false;
      ring.frustumCulled = false;
      this.root.add(ring);
      this.weights.push({ playerId: -1, ring, ringMat: rm, stone: null, seen: false });
    }
    for (let i = 0; i < POOLS.weights; i++) {
      this.drops.push({ alive: false, born: -99, targetId: -1, mesh: null });
    }
    // ---- the Seam Bolts ----
    const boltMat = new THREE.MeshBasicMaterial({
      color: 0xffd27a,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      name: 'smithHeartSeamBolt',
    });
    this.materials.push(boltMat);
    for (let i = 0; i < POOLS.bolts; i++) {
      const mesh = new THREE.Mesh(shardGeo, boltMat);
      mesh.name = 'smithHeartSeamBolt';
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.bolts.push({
        alive: false,
        born: -99,
        sourceId: -1,
        targetId: -1,
        from: new THREE.Vector3(),
        mesh,
      });
    }
    for (let i = 0; i < POOLS.streams; i++) {
      this.streams.push({
        alive: false,
        born: -99,
        sourceId: -1,
        targetId: -1,
        from: new THREE.Vector3(),
        acc: 0,
        soul: null,
      });
    }
    // ---- the Wrath holder's gathering energy ----
    const glowTex = hasDom ? radialGlowTexture() : null;
    this.glowTex = glowTex;
    this.haloMat = new THREE.SpriteMaterial({
      map: glowTex,
      color: 0xffb860,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: false,
      name: 'smithHeartCouncilEnergy',
    });
    this.materials.push(this.haloMat);
    this.halo = new THREE.Sprite(this.haloMat);
    this.halo.visible = false;
    this.root.add(this.halo);
    this.gaugeMat = ringMat('smithHeartCouncilEnergyGauge', C.ochre);
    this.gaugeMat.uniforms.uNotches.value = 20;
    const gaugeGeo = new THREE.RingGeometry(0.86, 1, 120, 1).rotateX(-Math.PI / 2);
    this.geometries.push(gaugeGeo);
    this.gauge = new THREE.Mesh(gaugeGeo, this.gaugeMat);
    this.gauge.name = 'smithHeartCouncilEnergyGauge';
    this.gauge.renderOrder = floorVfxRenderOrder('encounter', 21);
    this.gauge.visible = false;
    this.gauge.frustumCulled = false;
    this.root.add(this.gauge);
    const beadGeo = new THREE.IcosahedronGeometry(0.42, 1);
    this.geometries.push(beadGeo);
    // White, tinted per bead (the inheritance's ochre, a soul's own colour):
    // every instance carries its colour from the start, so the program is
    // the same one the gate linked.
    const beadMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
      name: 'smithHeartInheritBeads',
    });
    this.materials.push(beadMat);
    this.beads = new THREE.InstancedMesh(beadGeo, beadMat, POOLS.streams * BEADS);
    this.beads.name = 'smithHeartInheritBeads';
    this.beads.frustumCulled = false;
    this.beads.visible = false;
    this.beads.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    const ochre = new THREE.Color(0xffc070);
    for (let i = 0; i < POOLS.streams * BEADS; i++) {
      this.beads.setMatrixAt(i, _m.makeScale(0, 0, 0));
      this.beads.setColorAt(i, ochre);
    }
    this.root.add(this.beads);
    // The kit's slot programs, so a council piece that shows before the
    // interior's gate settles links nothing in a live frame.
    this.root.add(heartKitProgramWarmers());
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
    if (hasDom) {
      for (const url of [
        SMITH_HEART_HAMMER_KIT_URL,
        SMITH_HEART_ROCK_KIT_URL,
        SMITH_HEART_HEART_KIT_URL,
      ])
        void ensureHeartKit(url);
    }
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

  // ---- kit pieces ----------------------------------------------------------------------------

  // ---- events -------------------------------------------------------------------------------

  /** Claims the council's own cues (the renderer's generic draw is skipped). */
  handleEvent(ev: SimEvent): boolean {
    if (!this.world || this.disposed) return false;
    const world = this.world;
    this.audio.event(
      ev,
      (id) => world.entities.get(id),
      (x, z) => this.groundY(x, z),
    );
    if (ev.type === 'spellfxAt') {
      if (!councilClaims(ev.ability)) return false;
      if (ev.ability === COUNCIL_CUES.collapse)
        this.pillarsFx.collapseAt(ev.x, ev.z, ev.radius ?? 4);
      else if (ev.ability === COUNCIL_CUES.soulBurst) this.pillarsFx.soulBurstAt(ev.x, ev.z);
      else if (ev.ability === COUNCIL_CUES.rockImpact) this.rockImpact(ev.x, ev.z, ev.radius ?? 6);
      else if (ev.ability === COUNCIL_CUES.settle) this.pillarsFx.settleAt(ev.x, ev.z);
      return true;
    }
    if (ev.type !== 'spellfx' || !councilClaims(ev.ability)) return false;
    const ability = ev.ability;
    if (ability === COUNCIL_CUES.rise) this.pillarsFx.rise(ev.sourceId);
    else if (ability === COUNCIL_CUES.crack) this.pillarsFx.cracked(ev.sourceId);
    else if (ability === COUNCIL_CUES.pulse) this.pillarsFx.pulse(ev.sourceId);
    else if (ability === COUNCIL_CUES.inherit) {
      this.startStream(ev.sourceId, ev.targetId, null);
    } else if (ability === COUNCIL_CUES.soulTake) {
      const src = this.world.entities.get(ev.sourceId);
      const role = src ? councilRoleOf(src.templateId) : null;
      this.startStream(ev.sourceId, ev.targetId, role ?? 'guardian');
    } else if (ability === COUNCIL_CUES.soulPip) this.pillarsFx.soulPip(ev.sourceId);
    else if (ability === COUNCIL_CUES.echoBlast) this.soulFx.echoBlast(ev.sourceId);
    else if (ability === COUNCIL_CUES.songPulse) this.soulFx.songPulse(ev.sourceId);
    else if (ability === COUNCIL_CUES.slabCrush) this.soulFx.slabCrush(ev.targetId);
    else if (ability === COUNCIL_CASTS.bolt) {
      this.startBolt(ev.sourceId, ev.targetId);
    } else if (ability === COUNCIL_CASTS.weight) {
      this.startDrop(ev.targetId);
    }
    return true;
  }

  // ---- the frame ----------------------------------------------------------------------------

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
    this.updateHumming(world);
    this.soulFx.update(dt, this.clock);
    this.pillarsFx.update(dt);
    this.updateMarks(world);
    this.updateSpots();
    this.updateRocks(world);
    this.updateRings(world);
    this.updateWeights(world);
    this.updateDrops(world);
    this.updateBolts(world, dt);
    this.updateStreams(world, dt);
    this.updateEnergy(world, dt);
    this.updateWrathShelters(world);
    this.audio.update(dt, (id) => world.entities.get(id));
    this.debris.update(dt);
    this.particles.update(this.clock);
  }

  /** In the Smith's Heart at all (one cheap read of the local player). */
  private inRaid(world: IWorld): boolean {
    const me = world.entities.get(world.playerId);
    return !!me && inSmithHeartClaim(me.pos.x, me.pos.z);
  }

  private scan(world: IWorld): void {
    const here = this.inRaid(world);
    // The pillars and the rubble.
    this.pillarsFx.beginScan();
    this.soulFx.beginScan();
    this.audio.beginScan();
    for (const m of this.marks) m.seen = false;
    for (const r of this.rocks) r.seen = false;
    for (const r of this.rings) r.seen = false;
    for (const w of this.weights) w.seen = false;
    for (const sp of this.spots) sp.seen = false;
    // The Wrath holder (the member whose energy is not empty), found here at
    // the scan's pace, never by a walk a frame.
    let holder = -1;
    if (here) {
      for (const e of world.entities.values()) {
        if (e.kind === 'mob') {
          if (!e.dead && councilRoleOf(e.templateId) !== null) this.audio.see(e, 'member');
          if (
            holder < 0 &&
            !e.dead &&
            e.resourceType === 'energy' &&
            e.resource > 0 &&
            councilRoleOf(e.templateId) !== null
          )
            holder = e.id;
          continue;
        }
        if (e.kind === 'object') {
          const pillar = councilPillarOf(e.templateId);
          const soul = pillar ? null : councilSoulOf(e.templateId);
          if (pillar) this.pillarsFx.seePillar(e, pillar.integrity, pillar.risen);
          else if (soul) {
            this.pillarsFx.seePillar(e, soul.pips, soul.risen, soul.role);
            this.soulFx.seeSoul(e, soul.role);
            this.audio.see(e, SOUL_SOUND[soul.role]);
          } else if (e.templateId === COUNCIL_RUBBLE) this.pillarsFx.seeRubble(e);
          else if (councilRiseSpotSeconds(e.templateId) !== null) this.seeSpot(e);
          continue;
        }
        if (e.kind !== 'player' || e.dead || e.auras.length === 0) continue;
        for (const a of e.auras) {
          if (a.id === COUNCIL_AURAS.wakeMark || a.id === COUNCIL_AURAS.rockMark)
            this.seeMark(e, a.id);
          if (a.id === COUNCIL_AURAS.rockMark) {
            this.seeRock(e);
            this.audio.see(e, 'rock');
          } else if (a.id === COUNCIL_AURAS.resonance) this.seeRing(e);
          else if (a.id === COUNCIL_AURAS.weight) this.seeWeight(e);
        }
      }
    }
    this.haloHolder = holder;
    // What the scan no longer saw.
    this.pillarsFx.endScan();
    this.soulFx.endScan();
    this.audio.endScan();
    for (const m of this.marks) {
      if (m.playerId >= 0 && !m.seen) this.freeMark(m);
    }
    for (const r of this.rocks) {
      if (r.playerId >= 0 && !r.seen) {
        r.playerId = -1;
        r.mesh.visible = false;
      }
    }
    for (const r of this.rings) {
      if (r.playerId >= 0 && !r.seen) this.freeRing(r);
    }
    for (const w of this.weights) {
      if (w.playerId >= 0 && !w.seen) {
        w.playerId = -1;
        w.ring.visible = false;
        if (w.stone) w.stone.visible = false;
      }
    }
    for (const sp of this.spots) {
      if (sp.id >= 0 && !sp.seen) {
        sp.id = -1;
        sp.fan.group.visible = false;
        sp.ghost.visible = false;
      }
    }
  }

  // ---- the pillars ----------------------------------------------------------------------------

  /** The Resonance cracking each pillar now (from the marked players' auras). */
  private updateHumming(world: IWorld): void {
    const humming = this.pillarsFx.humming;
    humming.clear();
    for (const r of this.rings) {
      if (r.playerId < 0) continue;
      const p = world.entities.get(r.playerId);
      const a = auraById(p, COUNCIL_AURAS.resonance);
      if (!a?.value2 || a.value <= 0) continue;
      humming.set(a.value2, Math.max(humming.get(a.value2) ?? 0, a.value));
    }
  }

  // ---- the marks ----------------------------------------------------------------------------

  private seeMark(e: Entity, auraId: string): void {
    const key = `${e.id}|${auraId}`;
    let m = this.marks.find((q) => q.key === key);
    if (!m) {
      m = this.marks.find((q) => q.playerId < 0);
      if (!m) return;
      const spec = COUNCIL_MARK_SPECS[auraId];
      if (!spec) return;
      m.key = key;
      m.playerId = e.id;
      m.auraId = auraId;
      this.kit.layOutFan(m.fan, 360, { color: spec.color, accent: spec.accent });
      m.fan.group.visible = true;
      m.ghost.visible = auraId === COUNCIL_AURAS.wakeMark;
    }
    m.seen = true;
  }

  private freeMark(m: MarkSlot): void {
    m.key = '';
    m.drapedX = Number.NaN;
    m.drapedZ = Number.NaN;
    m.playerId = -1;
    m.fan.group.visible = false;
    m.ghost.visible = false;
  }

  private updateMarks(world: IWorld): void {
    for (const m of this.marks) {
      if (m.playerId < 0) continue;
      const p = world.entities.get(m.playerId);
      const a = auraById(p, m.auraId);
      if (!p || !a) continue;
      const spec = COUNCIL_MARK_SPECS[m.auraId];
      const fill = markFill(a.remaining, a.duration);
      const y = this.groundY(p.pos.x, p.pos.z);
      // Re-drape over the floor only once the player has moved.
      if (!(Math.abs(p.pos.x - m.drapedX) <= 0.05 && Math.abs(p.pos.z - m.drapedZ) <= 0.05)) {
        this.kit.drapeFan(m.fan, this.groundY, p.pos.x, y, p.pos.z, 0, spec.radius);
        m.drapedX = p.pos.x;
        m.drapedZ = p.pos.z;
      }
      this.kit.paintFan(m.fan, paint(fill, this.clock, spec.radius));
      if (m.ghost.visible) {
        const g = wakeGhost(fill);
        m.ghost.position.set(p.pos.x, y, p.pos.z);
        m.ghost.scale.set(T.risenR, RISEN_HEIGHT * g.height, T.risenR);
        m.ghostMat.uniforms.uAlpha.value = 0.55 * g.glow;
      }
      // The soak's motes stream in (gather); the wake's rise like dust.
      if (this.density > 0.5 && this.rand() < 0.4) {
        const ang = this.rand() * Math.PI * 2;
        const r = spec.radius * (0.9 + this.rand() * 0.1);
        _markMote.speed = spec.gather ? 2.4 : 0.6;
        _markMote.up = spec.gather ? 0.6 : 1.8;
        const tint = spec.gather ? MOTE_GATHER : C.flash;
        _moteColor[0] = tint[0];
        _moteColor[1] = tint[1];
        _moteColor[2] = tint[2];
        _moteDir[0] = spec.gather ? -Math.sin(ang) : 0;
        _moteDir[1] = spec.gather ? 0 : 1;
        _moteDir[2] = spec.gather ? -Math.cos(ang) : 0;
        const mx = p.pos.x + Math.sin(ang) * r;
        this.particles.puff(mx, y + 0.2, p.pos.z + Math.cos(ang) * r, 1, _markMote);
      }
    }
  }

  private seeSpot(e: Entity): void {
    let sp = this.spots.find((q) => q.id === e.id);
    if (!sp) {
      sp = this.spots.find((q) => q.id < 0);
      if (!sp) return;
      sp.id = e.id;
      sp.x = e.pos.x;
      sp.z = e.pos.z;
      sp.y = this.groundY(sp.x, sp.z);
      sp.born = this.clock;
      sp.seconds = councilRiseSpotSeconds(e.templateId) ?? RISE_SPOT_SPEC.seconds;
      sp.fan.group.visible = true;
      sp.ghost.visible = true;
      this.kit.drapeFan(sp.fan, this.groundY, sp.x, sp.y, sp.z, 0, RISE_SPOT_SPEC.radius);
    }
    sp.seen = true;
  }

  private updateSpots(): void {
    for (const sp of this.spots) {
      if (sp.id < 0) continue;
      const fill = Math.min(1, (this.clock - sp.born) / sp.seconds);
      this.kit.paintFan(sp.fan, paint(fill, this.clock, RISE_SPOT_SPEC.radius));
      const g = wakeGhost(fill);
      sp.ghost.position.set(sp.x, sp.y, sp.z);
      sp.ghost.scale.set(T.risenR, RISEN_HEIGHT * g.height, T.risenR);
      sp.ghostMat.uniforms.uAlpha.value = 0.6 * g.glow;
    }
  }

  private seeRock(e: Entity): void {
    let r = this.rocks.find((q) => q.playerId === e.id);
    if (!r) {
      r = this.rocks.find((q) => q.playerId < 0);
      if (!r) return;
      r.playerId = e.id;
    }
    // Dressed on any scan the kit is in (it may land after the mark).
    if (r.mesh.children.length === 0 && heartKitLoaded(SMITH_HEART_ROCK_KIT_URL)) {
      const b = heartKitMeshes(SMITH_HEART_ROCK_KIT_URL, 'Kit_BoulderA');
      if (b) {
        const box = this.pillarsFx.boxOf(SMITH_HEART_ROCK_KIT_URL, 'Kit_BoulderA');
        const size = box ? Math.max(box.max.x - box.min.x, box.max.z - box.min.z) : 4;
        b.scale.setScalar(3.4 / Math.max(0.1, size));
        r.mesh.add(b);
      }
    }
    r.seen = true;
  }

  private updateRocks(world: IWorld): void {
    for (let i = 0; i < this.rocks.length; i++) {
      const r = this.rocks[i];
      if (r.playerId < 0) {
        this.soak.hide(i);
        continue;
      }
      const p = world.entities.get(r.playerId);
      const a = auraById(p, COUNCIL_AURAS.rockMark);
      if (!p || !a) {
        r.mesh.visible = false;
        this.soak.hide(i);
        continue;
      }
      const y = this.groundY(p.pos.x, p.pos.z);
      const duration = a.duration > 0 ? a.duration : T.rockMarkSeconds;
      this.soak.paint(i, p.pos.x, y, p.pos.z, T.rockRadius, a.remaining, duration);
      const fall = rockFall(a.remaining, duration);
      r.mesh.visible = fall.visible;
      if (!fall.visible) continue;
      r.mesh.position.set(p.pos.x, y + 1.6 + fall.height, p.pos.z);
      r.mesh.quaternion.setFromAxisAngle(r.spinAxis, fall.spin);
      // A trail of grit off the falling stone.
      if (this.density > 0.5 && this.rand() < 0.6)
        this.particles.puff(
          r.mesh.position.x,
          r.mesh.position.y + 1,
          r.mesh.position.z,
          1,
          ROCK_GRIT,
        );
    }
  }

  private rockImpact(x: number, z: number, radius: number): void {
    const y = this.groundY(x, z);
    for (const r of this.rocks) if (r.mesh.visible && r.playerId < 0) r.mesh.visible = false;
    const n = Math.round(40 * this.density * (this.reducedMotion() ? 0.5 : 1));
    for (let i = 0; i < n; i++) {
      const a = this.rand() * Math.PI * 2;
      const sp = 6 + this.rand() * 12;
      this.debris.throw(
        x + Math.sin(a),
        y + 1,
        z + Math.cos(a),
        Math.sin(a) * sp,
        5 + this.rand() * 9,
        Math.cos(a) * sp,
        0.3 + this.rand() * 0.8,
      );
    }
    this.particles.shockRing(x, z, C.soak, radius, 0.45);
    this.particles.shockRing(x, z, 0xc89a66, radius * 1.6, 0.9);
    this.particles.puff(x, y + 1.5, z, 14, {
      speed: 5,
      life: 0.45,
      size: [3, 7],
      color: C.flash,
      alpha: 0.75,
      pool: 'glow',
    });
    this.particles.puff(x, y + 0.6, z, 26, {
      speed: 8,
      up: 2,
      life: 2.4,
      size: [2.5, 7],
      color: C.dust,
      alpha: 0.55,
      drag: 1.5,
      radius: radius * 0.5,
    });
    this.shakeNear(x, z, 0.7, 45);
  }

  // ---- Resonance --------------------------------------------------------------------------------

  private seeRing(e: Entity): void {
    let r = this.rings.find((q) => q.playerId === e.id);
    if (!r) {
      r = this.rings.find((q) => q.playerId < 0);
      if (!r) return;
      r.playerId = e.id;
      r.ring.visible = true;
      r.band.visible = true;
    }
    r.seen = true;
  }

  private freeRing(r: RingSlot): void {
    r.playerId = -1;
    r.ring.visible = false;
    r.band.visible = false;
    r.thread.visible = false;
  }

  private updateRings(world: IWorld): void {
    for (const r of this.rings) {
      if (r.playerId < 0) continue;
      const p = world.entities.get(r.playerId);
      const a = auraById(p, COUNCIL_AURAS.resonance);
      if (!p || !a) continue;
      const cracking = a.value > 0 && !!a.value2;
      const look = resonanceRing(this.clock, cracking);
      const y = this.groundY(p.pos.x, p.pos.z);
      r.ring.position.set(p.pos.x, y + 0.09, p.pos.z);
      r.ring.scale.setScalar(look.radius);
      r.ringMat.uniforms.uAlpha.value = (cracking ? 0.95 : 0.7) * (0.6 + 0.4 * look.pulse);
      r.band.position.set(p.pos.x, y, p.pos.z);
      r.band.scale.set(0.9, 2.4, 0.9);
      r.bandMat.uniforms.uAlpha.value = 0.35 + 0.35 * look.pulse + (cracking ? 0.25 : 0);
      // The thread to the pillar it is cracking.
      const pillar = cracking && a.value2 ? this.pillarsFx.standing(a.value2) : null;
      if (pillar) {
        _v.set(p.pos.x, y + 1.4, p.pos.z);
        _v2.set(pillar.x, pillar.y + Math.min(4, pillar.height * 0.35), pillar.z);
        const len = _v.distanceTo(_v2);
        r.thread.position.copy(_v);
        r.thread.lookAt(_v2);
        r.thread.scale.set(0.12 + 0.08 * look.pulse, 0.12 + 0.08 * look.pulse, len);
        r.threadMat.uniforms.uAlpha.value = 0.5 + 0.5 * a.value;
        r.thread.visible = true;
      } else r.thread.visible = false;
    }
  }

  // ---- Hammer's Weight ---------------------------------------------------------------------------

  private seeWeight(e: Entity): void {
    let w = this.weights.find((q) => q.playerId === e.id);
    if (!w) {
      w = this.weights.find((q) => q.playerId < 0);
      if (!w) return;
      w.playerId = e.id;
      w.ring.visible = true;
      if (w.stone) w.stone.visible = true;
    }
    // Dressed on any scan the kit is in (it may land after the mark).
    if (!w.stone && heartKitLoaded(SMITH_HEART_HAMMER_KIT_URL)) {
      const s = heartKitMeshes(SMITH_HEART_HAMMER_KIT_URL, 'Kit_SlabChunkB');
      if (s) {
        s.scale.setScalar(0.9);
        for (const c of s.children) if (c instanceof THREE.Mesh) c.castShadow = false;
        this.root.add(s);
        w.stone = s;
      }
    }
    w.seen = true;
  }

  private updateWeights(world: IWorld): void {
    for (const w of this.weights) {
      if (w.playerId < 0) continue;
      const p = world.entities.get(w.playerId);
      const a = auraById(p, COUNCIL_AURAS.weight);
      if (!p || !a) continue;
      const y = this.groundY(p.pos.x, p.pos.z);
      w.ring.position.set(p.pos.x, y + 0.1, p.pos.z);
      w.ring.scale.setScalar(1.7);
      w.ringMat.uniforms.uFill.value = a.duration > 0 ? a.remaining / a.duration : 1;
      w.ringMat.uniforms.uAlpha.value = 0.9;
      if (w.stone) {
        w.stone.position.set(p.pos.x, y + 3.6 + Math.sin(this.clock * 1.6) * 0.15, p.pos.z);
        w.stone.rotation.y = this.clock * 0.5;
      }
    }
  }

  private startDrop(targetId: number): void {
    const d = this.drops.find((q) => !q.alive) ?? this.drops[0];
    d.alive = true;
    d.born = this.clock;
    d.targetId = targetId;
    if (!d.mesh && heartKitLoaded(SMITH_HEART_HAMMER_KIT_URL)) {
      const m = heartKitMeshes(SMITH_HEART_HAMMER_KIT_URL, 'Kit_SlabChunkA');
      if (m) {
        m.scale.setScalar(1.6);
        this.root.add(m);
        d.mesh = m;
      }
    }
    if (d.mesh) d.mesh.visible = true;
  }

  private updateDrops(world: IWorld): void {
    for (const d of this.drops) {
      if (!d.alive) continue;
      const t = (this.clock - d.born) / WEIGHT_DROP_SECONDS;
      const p = world.entities.get(d.targetId);
      if (!p) {
        d.alive = false;
        if (d.mesh) d.mesh.visible = false;
        continue;
      }
      const y = this.groundY(p.pos.x, p.pos.z);
      if (t < 1) {
        if (d.mesh) {
          d.mesh.position.set(p.pos.x, y + 7 * (1 - t * t) + 0.8, p.pos.z);
          d.mesh.rotation.set(0.4, this.clock, 0.2);
        }
        continue;
      }
      d.alive = false;
      if (d.mesh) d.mesh.visible = false;
      const n = Math.round(26 * this.density);
      for (let i = 0; i < n; i++) {
        const a = this.rand() * Math.PI * 2;
        const sp = 4 + this.rand() * 8;
        this.debris.throw(
          p.pos.x,
          y + 1.2,
          p.pos.z,
          Math.sin(a) * sp,
          4 + this.rand() * 6,
          Math.cos(a) * sp,
          0.25 + this.rand() * 0.6,
        );
      }
      this.particles.shockRing(p.pos.x, p.pos.z, C.weight, 4.5, 0.4);
      this.particles.puff(p.pos.x, y + 1, p.pos.z, 16, {
        speed: 5,
        up: 1,
        life: 1.6,
        size: [1.5, 4.5],
        color: C.dust,
        alpha: 0.5,
      });
      this.particles.puff(p.pos.x, y + 1.6, p.pos.z, 8, {
        speed: 3,
        life: 0.35,
        size: [2, 4],
        color: [1, 0.55, 0.35],
        alpha: 0.7,
        pool: 'glow',
      });
      this.shakeNear(p.pos.x, p.pos.z, 0.45, 30);
    }
  }

  // ---- Seam Bolt ----------------------------------------------------------------------------------

  private startBolt(sourceId: number, targetId: number): void {
    const src = this.world?.entities.get(sourceId);
    if (!src) return;
    const b = this.bolts.find((q) => !q.alive) ?? this.bolts[0];
    b.alive = true;
    b.born = this.clock;
    b.sourceId = sourceId;
    b.targetId = targetId;
    b.from.set(src.pos.x, this.groundY(src.pos.x, src.pos.z) + 4, src.pos.z);
    b.mesh.visible = true;
  }

  private updateBolts(world: IWorld, dt: number): void {
    for (const b of this.bolts) {
      if (!b.alive) continue;
      const t = (this.clock - b.born) / BOLT_SECONDS;
      const target = world.entities.get(b.targetId);
      if (!target) {
        b.alive = false;
        b.mesh.visible = false;
        continue;
      }
      _v2.set(target.pos.x, this.groundY(target.pos.x, target.pos.z) + 1.3, target.pos.z);
      if (t >= 1) {
        b.alive = false;
        b.mesh.visible = false;
        this.particles.puff(_v2.x, _v2.y, _v2.z, 12, {
          speed: 5,
          life: 0.4,
          size: [0.4, 0.1],
          color: [1, 0.78, 0.4],
          alpha: 1,
          pool: 'glow',
        });
        this.particles.puff(_v2.x, _v2.y, _v2.z, 4, {
          speed: 1.5,
          life: 0.6,
          size: [1.2, 2.6],
          color: C.dust,
          alpha: 0.4,
        });
        continue;
      }
      const e = t * t * (3 - 2 * t);
      _v.lerpVectors(b.from, _v2, e);
      _v.y += Math.sin(t * Math.PI) * 1.6;
      b.mesh.position.copy(_v);
      b.mesh.lookAt(_v2);
      b.mesh.rotateZ(this.clock * 9);
      if (this.rand() < dt * 70 * this.density) {
        this.particles.puff(_v.x, _v.y, _v.z, 1, {
          speed: 0.4,
          life: 0.35,
          size: [0.35, 0.05],
          color: [1, 0.74, 0.32],
          alpha: 0.9,
          pool: 'glow',
        });
      }
    }
  }

  // ---- the stone remembers ------------------------------------------------------------------------

  private startStream(sourceId: number, targetId: number, soul: CouncilRole | null): void {
    const src = this.world?.entities.get(sourceId);
    if (!src) return;
    const s = this.streams.find((q) => !q.alive) ?? this.streams[0];
    s.alive = true;
    s.born = this.clock;
    s.sourceId = sourceId;
    s.targetId = targetId;
    s.acc = 0;
    s.soul = soul;
    s.from.set(src.pos.x, this.groundY(src.pos.x, src.pos.z) + 2.5, src.pos.z);
    // The beads take the stream's colour (one write per stream, not a frame).
    _beadColor.setHex(soul ? SOUL_COLORS[soul].hex : 0xffc070);
    const base = this.streams.indexOf(s) * BEADS;
    for (let i = 0; i < BEADS; i++) this.beads.setColorAt(base + i, _beadColor);
    if (this.beads.instanceColor) this.beads.instanceColor.needsUpdate = true;
    // The fallen gives up its light (a soul tears free: brighter, its colour).
    this.particles.puff(s.from.x, s.from.y, s.from.z, soul ? 30 : 16, {
      speed: soul ? 5 : 3,
      up: 2,
      life: 1,
      size: [1.6, 3.6],
      color: soul ? _soulRgb(soul) : C.flash,
      alpha: 0.7,
      pool: 'glow',
    });
    this.particles.shockRing(s.from.x, s.from.z, soul ? SOUL_COLORS[soul].hex : C.ochre, 6, 0.7);
  }

  private updateStreams(world: IWorld, dt: number): void {
    let any = false;
    for (let k = 0; k < this.streams.length; k++) {
      const s = this.streams[k];
      const base = k * BEADS;
      const age = this.clock - s.born;
      const span = s.soul ? SOUL_TAKE_SECONDS : INHERIT_SECONDS;
      const target = s.alive ? world.entities.get(s.targetId) : undefined;
      if (!s.alive || !target || age > span) {
        if (s.alive && target && s.soul) {
          // The soul arrives: its stone wakes.
          this.pillarsFx.soulAwake(s.targetId, s.soul);
        } else if (s.alive && target) {
          // It arrives: the survivor flares with the fallen one's light.
          const y = this.groundY(target.pos.x, target.pos.z) + 3;
          this.particles.puff(target.pos.x, y, target.pos.z, 24, {
            speed: 5,
            up: 1,
            life: 0.8,
            size: [2, 5],
            color: [1, 0.76, 0.38],
            alpha: 0.85,
            pool: 'glow',
          });
          this.particles.shockRing(target.pos.x, target.pos.z, C.ochre, 7, 0.7);
          this.shakeNear(target.pos.x, target.pos.z, 0.2, 30);
        }
        s.alive = false;
        for (let i = 0; i < BEADS; i++) this.beads.setMatrixAt(base + i, _m.makeScale(0, 0, 0));
        continue;
      }
      any = true;
      _v2.set(
        target.pos.x,
        this.groundY(target.pos.x, target.pos.z) + (s.soul ? 6 : 3),
        target.pos.z,
      );
      // A river of beads of stone light along the arc, its head racing out
      // to the survivor and its tail still leaving the fallen (every tier:
      // it is the inheritance's tell).
      const head = Math.min(1.25, age / (span * 0.7));
      for (let i = 0; i < BEADS; i++) {
        const u = head - i * 0.05;
        if (u < 0 || u > 1) {
          this.beads.setMatrixAt(base + i, _m.makeScale(0, 0, 0));
          continue;
        }
        const arc = inheritArc(u, _arc);
        _v.lerpVectors(s.from, _v2, arc.along);
        _v.y += arc.lift + Math.sin(this.clock * 9 + i) * 0.15;
        const size = (1.9 - (i / BEADS) * 1.3) * (0.85 + 0.15 * Math.sin(this.clock * 14 + i));
        _s.setScalar(size);
        this.beads.setMatrixAt(base + i, _m.compose(_v, _id, _s));
      }
      s.acc += dt * 30 * this.density;
      while (s.acc >= 1) {
        s.acc -= 1;
        const arc = inheritArc(Math.min(1, Math.max(0, head - this.rand() * 0.4)), _arc);
        _v.lerpVectors(s.from, _v2, arc.along);
        _v.y += arc.lift;
        if (s.soul) {
          const c = _soulRgb(s.soul);
          _moteColor[0] = c[0];
          _moteColor[1] = c[1];
          _moteColor[2] = c[2];
        } else {
          _moteColor[0] = 1;
          _moteColor[1] = 0.72 + this.rand() * 0.2;
          _moteColor[2] = 0.36;
        }
        this.particles.puff(_v.x, _v.y, _v.z, 1, _beadMote);
      }
    }
    this.beads.visible = any;
    if (any) this.beads.instanceMatrix.needsUpdate = true;
  }

  // ---- the energy -----------------------------------------------------------------------------------

  private updateEnergy(world: IWorld, dt: number): void {
    // The holder comes from the scan; the frame only re-reads that one body.
    const e = this.haloHolder >= 0 ? world.entities.get(this.haloHolder) : undefined;
    if (!e || e.dead || e.resource <= 0) {
      this.halo.visible = false;
      this.gauge.visible = false;
      return;
    }
    const look = energyLook(e.resource);
    const y = this.groundY(e.pos.x, e.pos.z);
    // The gauge round its feet fills with the energy, white-hot near full.
    this.gauge.position.set(e.pos.x, y + 0.08, e.pos.z);
    this.gauge.scale.setScalar(Math.max(4, (e.scale ?? 1) * 1.7));
    this.gaugeMat.uniforms.uFill.value = e.resource / T.energyMax;
    (this.gaugeMat.uniforms.uColor.value as THREE.Color).setHex(look.crackle ? 0xfff0c8 : C.ochre);
    this.gaugeMat.uniforms.uAlpha.value = look.crackle
      ? 0.75 + 0.25 * Math.sin(this.clock * 12)
      : 0.7;
    this.gauge.visible = true;
    const tall = (e.scale ?? 1) * 1.6;
    // Over its head (a halo inside the body would be hidden by it).
    this.halo.position.set(e.pos.x, y + tall * 1.9, e.pos.z);
    const size = 3 + look.glow * 6 + (look.crackle ? Math.sin(this.clock * 20) * 0.6 : 0);
    this.halo.scale.set(size, size, 1);
    this.haloMat.opacity = 0.15 + look.glow * 0.55;
    this.halo.visible = true;
    if (this.rand() < dt * look.embers * this.density) {
      const a = this.rand() * Math.PI * 2;
      const r = 1 + this.rand() * 2.5;
      _ember.up = 2.4 + look.glow * 3;
      _moteColor[0] = 1;
      _moteColor[1] = look.crackle ? 0.92 : 0.7;
      _moteColor[2] = look.crackle ? 0.7 : 0.32;
      this.particles.puff(e.pos.x + Math.sin(a) * r, y + 0.4, e.pos.z + Math.cos(a) * r, 1, _ember);
    }
  }

  /** Mountain's Wrath's bar on its holder: the real shadow behind every
   *  pillar that covers from it, laid as the bar begins and again as the
   *  pillars change, fading in over the bar's first moments. */
  private updateWrathShelters(world: IWorld): void {
    const e = this.haloHolder >= 0 ? world.entities.get(this.haloHolder) : undefined;
    const casting = !!e && !e.dead && e.castingAbility === COUNCIL_CASTS.wrath && e.castTotal > 0;
    if (!casting || !e) {
      if (this.wrathLaidAt >= 0) {
        this.shelters.hide('wrath');
        this.wrathLaidAt = -1;
      }
      return;
    }
    if (this.wrathLaidAt < 0 || this.clock - this.wrathLaidAt > 0.25) {
      this.wrathLaidAt = this.clock;
      this.shelters.lay('wrath', e.pos.x, e.pos.z, T.wrathRadius);
    }
    const fill = Math.max(0, Math.min(1, 1 - e.castRemaining / e.castTotal));
    this.shelters.paint('wrath', Math.min(0.92, 0.45 + fill * 2));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    this.particles.dispose();
    this.kit.dispose();
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    this.debris.mesh.dispose();
    this.beads.dispose();
    this.glowTex?.dispose();
    this.audio.dispose();
  }
}
