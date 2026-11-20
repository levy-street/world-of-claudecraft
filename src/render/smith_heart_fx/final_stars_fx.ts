// The Masterless Strength's woken stars' look (plan: final_stars_fx_core.ts;
// the owner's rework of 2026-11-18, design doc 7.5), a part of FinalKitFx
// (final_kit_fx.ts, which owns the root, the particles, the floor telegraph
// and the footprints at the sim's exact radii, and hands them in as the
// host). Read from IWorld through the kit (the fight's objects, the marks, the
// cues), so offline and online look the same:
//   - a Crossing Blade: the Quench guardian's own great sword of ice (the
//     painted Env_IceSword once its kit has landed, else its crystal
//     stand-in), towering, lying level along its line over the rim with its
//     broad face to the sky (read whole from any camera, never end-on), its
//     point at the arena, burning brighter as the line aims, drawn back and
//     blazing as it locks, then flying the line point first, low over the
//     floor, on the sim's own eased curve with a wake of frost and shards; its
//     line on the floor (the shared telegraph's lane in the ice's own cold
//     blue-white, the coordinator's call of 2026-11-18: never the fire's
//     orange, so it is never read as the Heat's), a frost scar after;
//   - a Sky Strike: a storm cloud gathering over its spot through the
//     warning, flickering inside, then a bolt out of the sky (its leader
//     racing down from the cloud, a thick white-hot trunk and its forks, a
//     re-strike flicker), the flash and the floor's impact ring and sparks;
//     a strike laid by a pillar is drawn onto the pillar's crown;
//   - Arcing Stone: through the warning the ring's edge crackles and sparks
//     climb the pillar; as it lands a ring of lightning races out round the
//     pillar to its whole reach, bolts forking from the pillar to the ring;
//   - a Storm-Charged pillar: violet-white arcs crawling up and down its
//     stone all the while (the pillar's own violet sheath is CouncilFx's),
//     and as it pulses the raid, bolts leaping from it to the nearest bodies;
//   - a pillar shattered by a blade: frost and stone bursting out;
//   - a quarter waking: a column of its vein's light standing off the floor.
// The swords, the lines, the bolts, the rings and the columns draw on every
// tier; the sparks, the frost and the shards thin with the host's density,
// the shakes go under reduced motion.
//
// Rules (src/render/CLAUDE.md): every geometry and material is built in the
// constructor under the host's root (one gated attach, the kit's); fixed
// pools; no light; no per-frame allocation; every floor piece on its owner's
// rungs (FINAL_KIT_FLOOR: the lanes on `lane`, the rings on `marks`).

import * as THREE from 'three';
import { lineLength } from '../../sim/encounters/smith_heart/final_blades';
import { finalLaneOf } from '../../sim/encounters/smith_heart/final_ids';
import type { Entity } from '../../sim/types';
import type { TelegraphKit, TelegraphLane, TelegraphStyle } from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import {
  onQuenchEnvKitLanded,
  quenchEnvKitReady,
  quenchEnvMaterial,
  quenchEnvPieceParts,
} from '../smith_heart/quench_env_kit';
import type { EngineParticles } from '../trash_engine_fx/engine_particles';
import { KIT_UV_VERT } from './final_kit_glsl';
import {
  type BladePose,
  bladeFlight,
  boltFlash,
  boltPath,
  STAR_COLORS as C,
  chargedArc,
  easeHeading,
  headingGap,
  laneFill,
  localBladeIndex,
  STAR_POOLS as P,
  ringWave,
  starHash,
} from './final_stars_fx_core';
import {
  COLUMN_FRAG,
  COLUMN_VERT,
  FIELD_FRAG,
  ICE_HALO_FRAG,
  ICE_SWORD_FRAG,
  STAR_RING_FRAG,
  STAR_RING_VERT,
} from './final_stars_glsl';
import { ICE_SWORD_BLADE, iceSwordGeometry } from './final_stars_shapes';
import { BLADE_KIT_LEAN } from './quench_blade_tip_core';

/** What FinalKitFx lends its stars' painter. */
export interface FinalStarsHost {
  root: THREE.Group;
  uTime: { value: number };
  particles: EngineParticles;
  kit: TelegraphKit;
  groundY: (x: number, z: number) => number;
  rand: () => number;
  density: number;
  detail: boolean;
  reducedMotion: () => boolean;
  shake: (x: number, z: number, amount: number, reach?: number) => void;
  geometries: THREE.BufferGeometry[];
  materials: THREE.Material[];
  /** The floor rungs: the lanes' (their curtain two over), the rings'. */
  laneRung: number;
  ringRung: number;
  /** The lines' styles (the threat colour and the frost accent). */
  laneStyle: TelegraphStyle;
  laneLockedStyle: TelegraphStyle;
  /** The sim's flight (seconds) and the line's half width. */
  bladeFly: number;
  bladeHalf: number;
}

interface Bolt {
  alive: boolean;
  born: number;
  life: number;
  x: number;
  y: number;
  z: number;
  /** Ends at (x2, y2, z2) when it is a leap between two points, else it
   *  falls out of the sky. */
  leap: boolean;
  x2: number;
  y2: number;
  z2: number;
  seed: number;
  top: number;
  pts: Float32Array;
  trunk: number;
  count: number;
}

interface Ring {
  mesh: THREE.Mesh;
  u: {
    uFront: { value: number };
    uAlpha: { value: number };
    uWidth: { value: number };
    uCrackle: { value: number };
    uSeed: { value: number };
    uScale: { value: number };
    uColor: { value: THREE.Color };
  };
  born: number;
  radius: number;
  seconds: number;
  strength: number;
  alive: boolean;
}

interface Blade {
  /** The blade object's id (-1 free). */
  id: number;
  seen: boolean;
  holder: THREE.Group;
  sword: THREE.Mesh;
  halo: THREE.Mesh;
  /** The guardian's painted sword (null until its kit lands). */
  painted: THREE.Group | null;
  glow: { value: number };
  lane: TelegraphLane;
  /** The line it flies (from its lane), and its flight's start (-1 aiming). */
  laneId: number;
  fromX: number;
  fromZ: number;
  facing: number;
  length: number;
  laneState: 'warn' | 'lock' | 'fly';
  flyAt: number;
  /** After the flight: the frost scar's end (render time), -1 none. */
  scarUntil: number;
  lastX: number;
  lastZ: number;
  /** Its line was last drawn at the local player's drawn pose (it eases back
   *  onto the server's once it stops). */
  predicted: boolean;
}

interface Column {
  mesh: THREE.Mesh;
  alpha: { value: number };
  color: { value: THREE.Color };
  born: number;
  alive: boolean;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _pose: BladePose = { along: 0, pitch: 0, lift: 0, glow: 0 };
const BOLT_LIFE = 0.75;
/** Seconds a sky bolt's leader takes to race down from the cloud. */
const BOLT_LEADER = 0.07;
/** How high the storm cloud gathers over a strike (yards). */
const CLOUD_Y = 22;
const SCAR_SECONDS = 0.8;
/** The sword's drawn size over its geometry: its blade some 20 yd, towering
 *  over the raid (the coordinator's review of 2026-11-18: the first cut read
 *  as a sliver). */
const SWORD_SCALE = 2.4;
/** The crystal stand-in's extra breadth (its section is slimmer than the
 *  painted sword's). */
const STAND_IN_BREADTH = 1.6;
/** The painted Env_IceSword (quench_env_kit.ts, build_smith_heart_quench_env_kit.py):
 *  16 yd point to crown, its point ENV_SWORD_TIP under its origin, its guard
 *  about ENV_SWORD_GUARD over it; fitted so its guard sits on the stand-in's
 *  and its blade runs the stand-in's length. */
const ENV_SWORD_TIP = 3.2;
const ENV_SWORD_GUARD = 8.3;
const ENV_SWORD_FIT = ICE_SWORD_BLADE / (ENV_SWORD_TIP + ENV_SWORD_GUARD);

export class FinalStarsFx {
  private readonly bolts: Bolt[] = [];
  private readonly coreMesh: THREE.InstancedMesh;
  private readonly glowMesh: THREE.InstancedMesh;
  private readonly rings: Ring[] = [];
  /** The charged pillars' electric grounds (pooled, by pillar id). */
  private readonly fields: { id: number; seen: boolean; mesh: THREE.Mesh }[] = [];
  private readonly blades: Blade[] = [];
  private readonly columns: Column[] = [];
  /** This frame's lines by id (for the blades to find theirs). */
  private readonly lanes = new Map<number, Entity>();
  private markFill = 0;
  private markDuration = 0;
  /** The local player's drawn spot while their own line aims (null: none),
   *  the instance's origin, and the last paint's clock (the hand-back's ease). */
  private localAt: { x: number; z: number } | null = null;
  private readonly _localAt = { x: 0, z: 0 };
  private originX = 0;
  private originZ = 0;
  private bladeClock = 0;
  private readonly aimScan: { fromX: number; fromZ: number; facing: number; aiming: boolean }[] =
    [];
  private clock = 0;
  private readonly fullerMat: THREE.MeshBasicMaterial;
  private stopWaitingForPaint: (() => void) | null = null;

  constructor(private readonly h: FinalStarsHost) {
    // ---- the bolts: a white-hot core and a wide storm glow, instanced ----
    const segGeo = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true).translate(0, 0.5, 0);
    h.geometries.push(segGeo);
    const basic = (name: string, color: readonly [number, number, number], opacity: number) => {
      const m = new THREE.MeshBasicMaterial({
        name,
        color: new THREE.Color(...color),
        transparent: true,
        opacity,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
        fog: false,
      });
      h.materials.push(m);
      return m;
    };
    const n = P.bolts * P.boltSegments;
    this.coreMesh = new THREE.InstancedMesh(segGeo, basic('smithHeartStarBolt', C.boltCore, 1), n);
    this.glowMesh = new THREE.InstancedMesh(
      segGeo,
      basic('smithHeartStarBoltGlow', C.boltGlow, 0.5),
      n,
    );
    for (const m of [this.coreMesh, this.glowMesh]) {
      m.frustumCulled = false;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < n; i++) m.setMatrixAt(i, _m.makeScale(0, 0, 0));
      m.visible = false;
      h.root.add(m);
    }
    this.coreMesh.name = 'smithHeartStarBolts';
    this.glowMesh.name = 'smithHeartStarBoltGlow';
    for (let i = 0; i < P.bolts; i++)
      this.bolts.push({
        alive: false,
        born: 0,
        life: BOLT_LIFE,
        x: 0,
        y: 0,
        z: 0,
        leap: false,
        x2: 0,
        y2: 0,
        z2: 0,
        seed: 0,
        top: 40,
        pts: new Float32Array(P.boltSegments * 3 + 6),
        trunk: 0,
        count: 0,
      });
    // ---- the floor rings ----
    const discGeo = new THREE.CircleGeometry(1, 120).rotateX(-Math.PI / 2);
    h.geometries.push(discGeo);
    for (let i = 0; i < P.rings; i++) {
      const u = {
        uTime: h.uTime,
        uFront: { value: 0 },
        uAlpha: { value: 0 },
        uWidth: { value: 1.2 },
        uCrackle: { value: 1 },
        uSeed: { value: i * 7.3 },
        uScale: { value: 1 },
        uColor: { value: new THREE.Color(C.arcHex) },
      };
      const mat = new THREE.ShaderMaterial({
        name: 'smithHeartStarRing',
        uniforms: u,
        vertexShader: STAR_RING_VERT,
        fragmentShader: STAR_RING_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      h.materials.push(mat);
      const mesh = new THREE.Mesh(discGeo, mat);
      mesh.name = 'smithHeartStarRing';
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', h.ringRung);
      h.root.add(mesh);
      this.rings.push({ mesh, u, born: -99, radius: 1, seconds: 1, strength: 1, alive: false });
    }
    // ---- the charged pillars' electric ground (2026-11-19) ----
    for (let i = 0; i < P.fields; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'smithHeartStarField',
        uniforms: {
          uTime: h.uTime,
          uSeed: { value: i * 5.1 },
          uPillar: { value: 0.3 },
          uEdge: { value: new THREE.Color(...C.fieldEdge) },
          uArc: { value: new THREE.Color(...C.fieldArc) },
        },
        vertexShader: STAR_RING_VERT,
        fragmentShader: FIELD_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      h.materials.push(mat);
      const mesh = new THREE.Mesh(discGeo, mat);
      mesh.name = 'smithHeartStarField';
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', h.ringRung);
      h.root.add(mesh);
      this.fields.push({ id: -1, seen: false, mesh });
    }
    // ---- the blades: the Smith's sword of ice, its cold light, its line ----
    const swordGeo = iceSwordGeometry();
    h.geometries.push(swordGeo);
    for (let i = 0; i < P.blades; i++) {
      const glow = { value: 0.4 };
      const swordMat = new THREE.ShaderMaterial({
        name: 'smithHeartStarIceSword',
        uniforms: {
          uTime: h.uTime,
          uGlow: glow,
          uLength: { value: ICE_SWORD_BLADE },
          uIce: { value: new THREE.Color(0.22, 0.52, 0.86) },
          uCore: { value: new THREE.Color(...C.iceCore) },
        },
        vertexShader: KIT_UV_VERT,
        fragmentShader: ICE_SWORD_FRAG,
        transparent: true,
      });
      const haloMat = new THREE.ShaderMaterial({
        name: 'smithHeartStarIceHalo',
        uniforms: { uTime: h.uTime, uGlow: glow, uCore: { value: new THREE.Color(...C.iceCore) } },
        vertexShader: KIT_UV_VERT,
        fragmentShader: ICE_HALO_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.BackSide,
        toneMapped: false,
      });
      h.materials.push(swordMat, haloMat);
      const holder = new THREE.Group();
      holder.name = 'smithHeartStarBlade';
      holder.visible = false;
      const sword = new THREE.Mesh(swordGeo, swordMat);
      sword.name = 'smithHeartStarIceSword';
      sword.castShadow = h.detail;
      sword.scale.set(STAND_IN_BREADTH, 1, STAND_IN_BREADTH);
      const halo = new THREE.Mesh(swordGeo, haloMat);
      halo.name = 'smithHeartStarIceHalo';
      halo.scale.set(1.35 * STAND_IN_BREADTH, 1.03, 1.9 * STAND_IN_BREADTH);
      holder.add(sword, halo);
      holder.scale.setScalar(SWORD_SCALE);
      h.root.add(holder);
      const lane = h.kit.lane(h.laneRung);
      this.blades.push({
        id: -1,
        seen: false,
        holder,
        sword,
        halo,
        painted: null,
        glow,
        lane,
        laneId: -1,
        fromX: 0,
        fromZ: 0,
        facing: 0,
        length: 0,
        laneState: 'warn',
        flyAt: -1,
        scarUntil: -1,
        lastX: 0,
        lastZ: 0,
        predicted: false,
      });
    }
    // The painted sword's fuller light (its own, built now: the painted
    // stone's materials are the lake kit's, already linked by the Quench's
    // room and its blades).
    this.fullerMat = new THREE.MeshBasicMaterial({
      name: 'smithHeartStarIceFuller',
      color: new THREE.Color(...C.iceCore),
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    h.materials.push(this.fullerMat);
    this.stopWaitingForPaint = onQuenchEnvKitLanded(() => this.fitPainted());
    // ---- the wake columns ----
    const colGeo = new THREE.CylinderGeometry(6, 9, 1, 40, 8, true).translate(0, 0.5, 0);
    h.geometries.push(colGeo);
    for (let i = 0; i < P.columns; i++) {
      const alpha = { value: 0 };
      const color = { value: new THREE.Color(1, 1, 1) };
      const mat = new THREE.ShaderMaterial({
        name: 'smithHeartStarWakeColumn',
        uniforms: { uTime: h.uTime, uAlpha: alpha, uColor: color },
        vertexShader: COLUMN_VERT,
        fragmentShader: COLUMN_FRAG,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        toneMapped: false,
      });
      h.materials.push(mat);
      const mesh = new THREE.Mesh(colGeo, mat);
      mesh.name = 'smithHeartStarWakeColumn';
      mesh.visible = false;
      mesh.frustumCulled = false;
      h.root.add(mesh);
      this.columns.push({ mesh, alpha, color, born: -99, alive: false });
    }
  }

  // ---- the frame's objects ------------------------------------------------------------

  /** The frame begins (the kit's scan feeds the objects after). */
  begin(clock: number): void {
    this.clock = clock;
    this.lanes.clear();
    for (const b of this.blades) b.seen = false;
    for (const f of this.fields) f.seen = false;
  }

  /** The local player's drawn spot while their own Crossing Blade mark
   *  aims (world yards), the instance's origin; null otherwise. */
  localBlade(at: { x: number; z: number } | null, ox: number, oz: number): void {
    if (at) {
      this._localAt.x = at.x;
      this._localAt.z = at.z;
    }
    this.localAt = at ? this._localAt : null;
    this.originX = ox;
    this.originZ = oz;
  }

  /** The Crossing Blade mark's run down this frame (any player's: one line at
   *  a time); `duration` 0 when nobody wears it. */
  bladeMark(remaining: number, duration: number): void {
    this.markFill = remaining;
    this.markDuration = duration;
  }

  /** A line object this frame. */
  seeLane(e: Entity): void {
    this.lanes.set(e.id, e);
  }

  /** A blade object this frame. */
  seeBlade(e: Entity): void {
    let b = this.blades.find((s) => s.id === e.id);
    if (!b) {
      b = this.blades.find((s) => s.id < 0 && s.scarUntil < this.clock);
      if (!b) return;
      b.id = e.id;
      b.laneId = -1;
      b.flyAt = -1;
      b.predicted = false;
      b.scarUntil = -1;
      b.laneState = 'warn';
      b.facing = e.facing;
      b.fromX = e.pos.x;
      b.fromZ = e.pos.z;
      b.holder.visible = true;
      // Rising out of the floor in a burst of frost.
      this.frostAt(e.pos.x, e.pos.z, 16, 1.6);
    }
    b.seen = true;
    b.lastX = e.pos.x;
    b.lastZ = e.pos.z;
    if (b.flyAt < 0) {
      b.facing = e.facing;
      b.fromX = e.pos.x;
      b.fromZ = e.pos.z;
    }
    if (e.templateId.endsWith('fly') && b.flyAt < 0) {
      b.flyAt = this.clock;
      this.h.shake(e.pos.x, e.pos.z, 0.3, 50);
    }
  }

  /** The storm gathering over a Sky Strike's spot (`fill` 0..1): a dark
   *  cloud rolling in, flickering inside as it fills, the hair-raising
   *  sparks off the floor at the end. Never a ball of light (the
   *  coordinator's review of 2026-11-18: the first cut's glow puffs read as
   *  yellow orbs over the raid). */
  strikeCharge(x: number, y: number, z: number, fill: number): void {
    const H = this.h;
    const top = y + CLOUD_Y;
    if (H.rand() < (0.5 + fill) * H.density)
      H.particles.puff(x + (H.rand() - 0.5) * 6, top + H.rand() * 3, z + (H.rand() - 0.5) * 6, 1, {
        speed: 1.2,
        up: -0.3,
        life: 1.2,
        size: [3.5, 7],
        color: [0.16, 0.15, 0.24],
        alpha: 0.55,
        radius: 2,
        drag: 1,
      });
    // Lightning flickering inside the cloud as the charge builds.
    if (fill > 0.3 && H.rand() < fill * 0.35) {
      const a = H.rand() * Math.PI * 2;
      this.leap(
        x + Math.cos(a) * 3,
        top + H.rand() * 2,
        z + Math.sin(a) * 3,
        x - Math.cos(a) * 3,
        top + H.rand() * 2,
        z - Math.sin(a) * 3,
        0.09,
        1.1,
      );
    }
    if (fill > 0.6 && H.rand() < fill * 0.5 * H.density)
      H.particles.puff(x, y + 0.3, z, 1, {
        speed: 1.5,
        up: 2.5,
        life: 0.3,
        size: [0.22, 0.04],
        color: C.boltCore,
        alpha: 1,
        pool: 'glow',
        radius: 2.5,
      });
  }

  /** Arcing Stone's warning round a pillar: its edge crackling, sparks
   *  climbing the stone (`fill` 0..1). */
  arcWarn(x: number, y: number, z: number, r: number, fill: number): void {
    const H = this.h;
    const n = (1 + fill * 3) * H.density;
    for (let i = 0; i < n; i++) {
      if (H.rand() > 0.6) continue;
      const a = H.rand() * Math.PI * 2;
      H.particles.puff(x + Math.cos(a) * r, y + 0.25, z + Math.sin(a) * r, 1, {
        speed: 3,
        up: 2,
        life: 0.25,
        size: [0.45, 0.06],
        color: C.charged,
        alpha: 1,
        pool: 'glow',
      });
    }
    if (H.rand() < (0.3 + fill) * H.density)
      H.particles.puff(x, y + 1 + H.rand() * 9, z, 1, {
        speed: 2.5,
        up: 3,
        life: 0.3,
        size: [0.5, 0.08],
        color: C.boltCore,
        alpha: 1,
        pool: 'glow',
        radius: 2.4,
      });
  }

  /** A Storm-Charged pillar this frame (its crawling arcs). */
  chargedPillar(e: Entity, zoneR = 0): void {
    const H = this.h;
    const y0 = H.groundY(e.pos.x, e.pos.z);
    // Its electric ground (the playtest of 2026-11-19): the field's disc (its
    // edge ring, arcs crawling over it, a flicker), bolts leaping out over the
    // floor from the pillar's foot to the edge, the edge spitting.
    if (zoneR > 0) {
      // Its own field, else the first free one.
      let f: (typeof this.fields)[number] | null = null;
      let free: (typeof this.fields)[number] | null = null;
      for (const k of this.fields) {
        if (k.id === e.id) f = k;
        else if (free === null && k.id < 0) free = k;
      }
      f ??= free;
      if (f) {
        f.id = e.id;
        f.seen = true;
        f.mesh.position.set(e.pos.x, y0 + 0.1, e.pos.z);
        f.mesh.scale.setScalar(zoneR);
        (f.mesh.material as THREE.ShaderMaterial).uniforms.uPillar.value = 2.4 / zoneR;
        f.mesh.visible = true;
      }
      if (H.rand() < 0.45) {
        const a = H.rand() * Math.PI * 2;
        const b = a + (H.rand() - 0.5) * 0.9;
        const r0 = 2.4 + H.rand();
        this.leap(
          e.pos.x + Math.cos(a) * r0,
          y0 + 0.15,
          e.pos.z + Math.sin(a) * r0,
          e.pos.x + Math.cos(b) * zoneR,
          y0 + 0.15,
          e.pos.z + Math.sin(b) * zoneR,
          0.12,
          0.55,
        );
      }
      if (H.rand() < 0.7 * H.density) {
        const a = H.rand() * Math.PI * 2;
        H.particles.puff(
          e.pos.x + Math.cos(a) * zoneR,
          y0 + 0.2,
          e.pos.z + Math.sin(a) * zoneR,
          1,
          {
            speed: 2.5,
            up: 1.2,
            life: 0.25,
            size: [0.35, 0.05],
            color: C.charged,
            alpha: 1,
            pool: 'glow',
            gravity: 6,
          },
        );
      }
    }
    // Arcs climbing the stone: from low on its face up and round it.
    for (let k = 0; k < 3; k++) {
      const arc = chargedArc(this.clock, e.id, k);
      if (!arc.on) continue;
      if (H.rand() > 0.6) continue;
      const r = 2.5;
      const ax = e.pos.x + Math.cos(arc.angle) * r;
      const az = e.pos.z + Math.sin(arc.angle) * r;
      const bx = e.pos.x + Math.cos(arc.angle + 0.9) * r;
      const bz = e.pos.z + Math.sin(arc.angle + 0.9) * r;
      this.leap(ax, y0 + 10 * arc.from, az, bx, y0 + 10 * arc.to, bz, 0.16, 0.7);
    }
    // Sparks spitting off its face, a crackle at its crown.
    if (H.rand() < 0.8 * H.density)
      H.particles.puff(e.pos.x, y0 + 0.5 + H.rand() * 10, e.pos.z, 2, {
        speed: 4,
        up: 1.5,
        life: 0.3,
        size: [0.4, 0.05],
        color: C.charged,
        alpha: 1,
        pool: 'glow',
        radius: 2.5,
        gravity: 6,
      });
    if (H.rand() < 0.12) {
      const a = H.rand() * Math.PI * 2;
      this.leap(
        e.pos.x,
        y0 + 10.2,
        e.pos.z,
        e.pos.x + Math.cos(a) * 2.6,
        y0 + 11.5 + H.rand() * 2,
        e.pos.z + Math.sin(a) * 2.6,
        0.12,
        0.6,
      );
    }
  }

  /** The frame ends: the blades and their lines, the bolts, the rings and
   *  the columns. */
  end(): void {
    for (const f of this.fields)
      if (!f.seen && f.id >= 0) {
        f.id = -1;
        f.mesh.visible = false;
      }
    this.paintBlades();
    this.paintBolts();
    this.paintRings();
    this.paintColumns();
  }

  // ---- the cues --------------------------------------------------------------------------

  /** A Sky Strike falls at (x, z): the bolt out of the cloud, the flash,
   *  the impact. */
  boltAt(x: number, z: number, r: number): void {
    const H = this.h;
    const y = H.groundY(x, z);
    this.fall(x, y, z, CLOUD_Y + 2);
    this.fall(x + 0.8, y, z - 0.5, CLOUD_Y - 2);
    this.impact(x, y, z, r);
  }

  /** A bolt's landing: the white flash, the floor's ring and scorch, the
   *  sparks and the thud. */
  private impact(x: number, y: number, z: number, r: number): void {
    const H = this.h;
    this.ring(x, z, r * 1.8, 0.6, C.strikeHex, 0.9, 1.1);
    H.particles.shockRing(x, z, C.strikeHex, r * 1.6, 0.5);
    // The flash is the floor's own (a hot white ring racing out under the
    // bolt): never a sprite ball over the spot (the coordinator's review of
    // 2026-11-18 read the glow sprites as yellow orbs).
    this.ring(x, z, r * 1.1, 0.25, C.strikeHex, 0, 2.2);
    H.particles.puff(x, y + 0.6, z, Math.round(26 * H.density) + 6, {
      speed: 11,
      up: 7,
      life: 0.6,
      size: [0.5, 0.08],
      color: C.boltCore,
      alpha: 1,
      pool: 'glow',
      radius: 0.8,
      drag: 1.2,
    });
    // The scorched smoke off the floor.
    H.particles.puff(x, y + 0.4, z, Math.round(6 * H.density) + 2, {
      speed: 2,
      up: 2,
      life: 1.4,
      size: [1.4, 3.6],
      color: [0.2, 0.19, 0.22],
      alpha: 0.4,
      radius: r * 0.5,
      drag: 1,
    });
    H.shake(x, z, 0.4, 45);
  }

  /** Arcing Stone rings out round the pillar at (x, z) to `r`. */
  arcingAt(x: number, z: number, r: number): void {
    const H = this.h;
    const y = H.groundY(x, z);
    this.ring(x, z, r, 0.9, C.arcHex, 2, 1.4);
    this.ring(x, z, r * 0.7, 0.6, C.strikeHex, 1.2, 1.2);
    // Forks leaping from the stone out to the ring's edge.
    const forks = 9;
    for (let k = 0; k < forks; k++) {
      const a = (k / forks) * Math.PI * 2 + H.rand() * 0.4;
      this.leap(
        x,
        y + 4 + H.rand() * 5,
        z,
        x + Math.cos(a) * r,
        y + 0.2,
        z + Math.sin(a) * r,
        0.4,
        1,
      );
    }
    // The lightning sought the stone: a bolt out of the cloud onto its crown,
    // the flash on it.
    this.fall(x, y + 10, z, CLOUD_Y - 8);
    this.fall(x - 0.5, y + 10, z + 0.4, CLOUD_Y - 10);
    H.particles.puff(x, y + 10, z, Math.round(14 * H.density) + 4, {
      speed: 7,
      up: 3,
      life: 0.35,
      size: [0.45, 0.06],
      color: C.charged,
      alpha: 1,
      pool: 'glow',
      radius: 1.2,
    });
    H.particles.puff(x, y + 1, z, Math.round(40 * H.density) + 8, {
      speed: 14,
      up: 4,
      life: 0.7,
      size: [0.5, 0.08],
      color: C.charged,
      alpha: 1,
      pool: 'glow',
      radius: 2.5,
      drag: 1,
    });
    H.shake(x, z, 0.55, 70);
  }

  /** A charged pillar pulses the raid: bolts from its crown to the nearest
   *  bodies (`targets`, at most four), and a violet nova round it. */
  chargedPulse(pillar: Entity, targets: readonly { x: number; y: number; z: number }[]): void {
    const H = this.h;
    const y = H.groundY(pillar.pos.x, pillar.pos.z);
    for (let i = 0; i < targets.length && i < 4; i++) {
      const t = targets[i];
      this.leap(pillar.pos.x, y + 9.5, pillar.pos.z, t.x, t.y + 1.3, t.z, 0.3, 0.75);
    }
    H.particles.shockRing(pillar.pos.x, pillar.pos.z, C.chargedHex, 12, 0.55);
    // The pulse rolling out over the floor to the whole raid (Jose's playtest
    // of 2026-11-19: it must be felt and seen): a bright ring racing across
    // the room, a second one on its heels, a flash up the pillar.
    this.ring(pillar.pos.x, pillar.pos.z, 46, 1.2, 0x8fc4ff, 1, 2.4);
    this.ring(pillar.pos.x, pillar.pos.z, 30, 0.9, 0xb49cff, 0.6, 1.6);
    for (let k = 0; k < 3; k++)
      this.leap(
        pillar.pos.x,
        y + 0.5,
        pillar.pos.z,
        pillar.pos.x + (H.rand() - 0.5) * 1.5,
        y + 11,
        pillar.pos.z + (H.rand() - 0.5) * 1.5,
        0.25,
        0.9,
      );
    H.shake(pillar.pos.x, pillar.pos.z, 0.18, 40);
  }

  /** A pillar shattered by a blade: frost and stone bursting out. */
  shatterAt(x: number, z: number, r: number): void {
    const H = this.h;
    this.ring(x, z, r * 2.2, 0.5, C.frostHex, 0, 0.8);
    this.frostAt(x, z, 34, r);
    H.shake(x, z, 0.4, 50);
  }

  /** A quarter's star wakes: a column of its vein's light off the floor. */
  wakeAt(x: number, z: number, color: number): void {
    const c = this.columns.find((k) => !k.alive) ?? this.columns[0];
    c.alive = true;
    c.born = this.clock;
    c.color.value.setHex(color);
    c.mesh.position.set(x, this.h.groundY(x, z) - 0.2, z);
    c.mesh.visible = true;
    this.ring(x, z, 22, 1.1, color, 0.3, 0.9);
  }

  /** The guardian's painted sword in every blade once the lake's kit has
   *  landed (the crystal stand-in until then): its lean taken out, its point
   *  turned to the blade's +y, its guard on the stand-in's. */
  private fitPainted(): void {
    if (!quenchEnvKitReady()) return;
    const parts = quenchEnvPieceParts('Env_IceSword');
    if (!parts) return;
    for (const b of this.blades) {
      if (b.painted) continue;
      const wrap = new THREE.Group();
      wrap.name = 'smithHeartStarPaintedSword';
      const upright = new THREE.Group();
      upright.rotation.z = BLADE_KIT_LEAN;
      for (const [painting, geo] of parts) {
        const glow = painting === 'glow';
        const m = new THREE.Mesh(geo, glow ? this.fullerMat : quenchEnvMaterial(painting));
        m.name = `Env_IceSword:${painting}`;
        m.castShadow = !glow && this.h.detail;
        upright.add(m);
      }
      wrap.add(upright);
      wrap.rotation.x = Math.PI;
      wrap.scale.setScalar(ENV_SWORD_FIT);
      wrap.position.y = ENV_SWORD_GUARD * ENV_SWORD_FIT;
      b.holder.add(wrap);
      b.painted = wrap;
      b.sword.visible = false;
    }
  }

  /** Everything hidden (out of the Heart). */
  hide(): void {
    for (const b of this.bolts) b.alive = false;
    this.coreMesh.visible = false;
    this.glowMesh.visible = false;
    for (const r of this.rings) {
      r.alive = false;
      r.mesh.visible = false;
    }
    for (const f of this.fields) {
      f.id = -1;
      f.mesh.visible = false;
    }
    for (const b of this.blades) {
      b.id = -1;
      b.scarUntil = -1;
      b.holder.visible = false;
      b.lane.group.visible = false;
    }
    for (const c of this.columns) {
      c.alive = false;
      c.mesh.visible = false;
    }
  }

  // ---- the pieces ------------------------------------------------------------------------

  private frostAt(x: number, z: number, n: number, radius: number): void {
    const H = this.h;
    const y = H.groundY(x, z);
    H.particles.puff(x, y + 0.5, z, Math.round(n * H.density) + 4, {
      speed: 8,
      up: 7,
      life: 1,
      size: [0.5, 0.15],
      color: C.frost,
      alpha: 1,
      pool: 'glow',
      radius,
      gravity: 16,
    });
    H.particles.puff(x, y + 0.4, z, Math.round(n * 0.4 * H.density) + 2, {
      speed: 3,
      up: 1.5,
      life: 1.6,
      size: [1.4, 3.2],
      color: C.frost,
      alpha: 0.3,
      radius,
      drag: 1,
    });
  }

  /** A bolt out of the sky onto (x, y, z). */
  private fall(x: number, y: number, z: number, top: number): void {
    const b = this.bolts.find((k) => !k.alive) ?? this.oldestBolt();
    b.alive = true;
    b.born = this.clock;
    b.life = BOLT_LIFE;
    b.leap = false;
    b.x = x;
    b.y = y;
    b.z = z;
    b.top = top;
    b.seed = Math.floor(this.h.rand() * 1e6);
    b.trunk = boltPath(b.seed, top, b.pts, 10, 4, 2.4);
    b.count = 14;
  }

  /** A bolt leaping between two points. */
  private leap(
    x: number,
    y: number,
    z: number,
    x2: number,
    y2: number,
    z2: number,
    life: number,
    jag: number,
  ): void {
    const b = this.bolts.find((k) => !k.alive) ?? this.oldestBolt();
    b.alive = true;
    b.born = this.clock;
    b.life = life;
    b.leap = true;
    b.x = x;
    b.y = y;
    b.z = z;
    b.x2 = x2;
    b.y2 = y2;
    b.z2 = z2;
    b.seed = Math.floor(this.h.rand() * 1e6);
    // A straight run between the two, jagged sideways.
    const n = 7;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const j = i === 0 || i === n - 1 ? 0 : jag;
      b.pts[i * 3] = x + (x2 - x) * t + (starHash(b.seed, i) - 0.5) * 2 * j;
      b.pts[i * 3 + 1] = y + (y2 - y) * t + (starHash(b.seed, i + 9) - 0.5) * 2 * j;
      b.pts[i * 3 + 2] = z + (z2 - z) * t + (starHash(b.seed, i + 19) - 0.5) * 2 * j;
    }
    b.trunk = n;
    b.count = n;
  }

  private oldestBolt(): Bolt {
    let best = this.bolts[0];
    for (const b of this.bolts) if (b.born < best.born) best = b;
    return best;
  }

  private ring(
    x: number,
    z: number,
    radius: number,
    seconds: number,
    color: number,
    crackle: number,
    strength: number,
  ): void {
    const r = this.rings.find((k) => !k.alive) ?? this.rings[0];
    r.alive = true;
    r.born = this.clock;
    r.radius = radius;
    r.seconds = seconds;
    r.strength = strength;
    r.u.uColor.value.setHex(color);
    r.u.uCrackle.value = Math.min(1, crackle);
    r.u.uWidth.value = Math.max(0.6, radius * 0.06);
    r.u.uScale.value = radius;
    r.mesh.scale.setScalar(radius);
    r.mesh.position.set(x, this.h.groundY(x, z) + 0.12, z);
    r.mesh.visible = true;
  }

  private paintRings(): void {
    for (const r of this.rings) {
      if (!r.alive) continue;
      const w = ringWave(this.clock - r.born, r.radius, r.seconds);
      if (w.alpha <= 0) {
        r.alive = false;
        r.mesh.visible = false;
        continue;
      }
      r.u.uFront.value = w.front;
      r.u.uAlpha.value = w.alpha * r.strength;
    }
  }

  private paintBolts(): void {
    let n = 0;
    const cap = P.bolts * P.boltSegments;
    for (const b of this.bolts) {
      if (!b.alive) continue;
      const age = this.clock - b.born;
      const k = boltFlash(age, b.life);
      if (k <= 0) {
        b.alive = false;
        continue;
      }
      // A sky bolt re-jags as it flickers (the same seed's next path).
      if (!b.leap && Math.floor(age * 30) % 3 === 0)
        boltPath(b.seed + Math.floor(age * 30), b.top, b.pts, 10, 4, 2.4);
      const w = (b.leap ? 0.1 : 0.42) * (0.55 + 0.45 * k);
      // A sky bolt's leader races down from the cloud before it lights whole.
      const shown = b.leap
        ? b.trunk
        : Math.max(2, Math.ceil(b.trunk * Math.min(1, age / BOLT_LEADER)));
      const add = (i0: number, i1: number) => {
        if (n >= cap) return;
        const ox = b.leap ? 0 : b.x;
        const oy = b.leap ? 0 : b.y;
        const oz = b.leap ? 0 : b.z;
        const ax = ox + b.pts[i0 * 3];
        const ay = oy + b.pts[i0 * 3 + 1];
        const az = oz + b.pts[i0 * 3 + 2];
        _v.set(ox + b.pts[i1 * 3] - ax, oy + b.pts[i1 * 3 + 1] - ay, oz + b.pts[i1 * 3 + 2] - az);
        const len = _v.length();
        if (len < 1e-4) return;
        _v.multiplyScalar(1 / len);
        _q.setFromUnitVectors(UP, _v);
        _m.compose(_v2.set(ax, ay, az), _q, _s.set(w, len, w));
        this.coreMesh.setMatrixAt(n, _m);
        _m.compose(_v2, _q, _s.set(w * (b.leap ? 6 : 4.5), len, w * (b.leap ? 6 : 4.5)));
        this.glowMesh.setMatrixAt(n, _m);
        n++;
      };
      for (let i = 0; i + 1 < shown; i++) add(i, i + 1);
      if (!b.leap && shown >= b.trunk) {
        const from = Math.max(1, Math.floor(b.trunk / 3));
        add(from, b.trunk);
        for (let i = b.trunk; i + 1 < b.count; i++) add(i, i + 1);
      }
    }
    for (let i = n; i < cap; i++) {
      this.coreMesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
      this.glowMesh.setMatrixAt(i, _m);
    }
    this.coreMesh.instanceMatrix.needsUpdate = true;
    this.glowMesh.instanceMatrix.needsUpdate = true;
    this.coreMesh.visible = n > 0;
    this.glowMesh.visible = n > 0;
  }

  private paintColumns(): void {
    for (const c of this.columns) {
      if (!c.alive) continue;
      const age = this.clock - c.born;
      const life = 2.2;
      if (age >= life) {
        c.alive = false;
        c.mesh.visible = false;
        continue;
      }
      const rise = Math.min(1, age / 0.35);
      c.mesh.scale.set(1, 4 + 46 * rise, 1);
      c.alpha.value = Math.min(1, age / 0.15) * (1 - age / life) ** 1.2;
    }
  }

  private paintBlades(): void {
    const H = this.h;
    const dt = Math.max(0, this.clock - this.bladeClock);
    this.bladeClock = this.clock;
    // The local player's own line (the playtest of 2026-11-19): while it aims
    // it is drawn from its blade to the player's DRAWN pose, the server's line
    // (a round trip late) only picking which blade is theirs; once it locks it
    // eases back onto the server's.
    let mine = -1;
    if (this.localAt) {
      // One scratch row a blade, kept (no allocation a frame).
      while (this.aimScan.length < this.blades.length)
        this.aimScan.push({ fromX: 0, fromZ: 0, facing: 0, aiming: false });
      for (let i = 0; i < this.blades.length; i++) {
        const b = this.blades[i];
        const lane = b.laneId >= 0 ? this.lanes.get(b.laneId) : undefined;
        const info = lane ? finalLaneOf(lane.templateId) : null;
        const row = this.aimScan[i];
        row.fromX = b.fromX;
        row.fromZ = b.fromZ;
        row.facing = lane ? lane.facing : b.facing;
        row.aiming = b.id >= 0 && b.seen && b.flyAt < 0 && info?.state === 'warn';
      }
      mine = localBladeIndex(this.aimScan, this.localAt.x, this.localAt.z);
    }
    for (let bi = 0; bi < this.blades.length; bi++) {
      const b = this.blades[bi];
      if (b.id < 0) {
        // The frost scar a moment after its flight.
        if (b.scarUntil >= this.clock) this.paintScar(b);
        else if (b.lane.group.visible) b.lane.group.visible = false;
        continue;
      }
      // Its line: the lane whose start is this blade's rise.
      if (b.laneId < 0 || !this.lanes.has(b.laneId)) {
        b.laneId = -1;
        for (const [id, lane] of this.lanes) {
          const info = finalLaneOf(lane.templateId);
          if (!info) continue;
          const sx = lane.pos.x - Math.sin(lane.facing) * info.length * 0.5;
          const sz = lane.pos.z - Math.cos(lane.facing) * info.length * 0.5;
          if (Math.hypot(sx - b.fromX, sz - b.fromZ) < 3) {
            b.laneId = id;
            break;
          }
        }
      }
      const lane = b.laneId >= 0 ? this.lanes.get(b.laneId) : undefined;
      const info = lane ? finalLaneOf(lane.templateId) : null;
      if (lane && info) {
        b.length = info.length;
        b.laneState = info.state;
        if (b.flyAt < 0) {
          const me = bi === mine ? this.localAt : null;
          if (me) {
            b.predicted = true;
            b.facing = Math.atan2(me.x - b.fromX, me.z - b.fromZ);
            // The full line to the far rim, unless the server cut it short
            // (Mythic's fallen quarter): then its own length.
            const from = { x: b.fromX - this.originX, z: b.fromZ - this.originZ };
            const full = lineLength(from, lane.facing);
            if (Math.abs(full - info.length) < 0.75) b.length = lineLength(from, b.facing);
          } else if (b.predicted) {
            // Handing back to the server's (locked) line: eased, never a snap.
            b.facing = easeHeading(b.facing, lane.facing, 14, dt);
            if (headingGap(b.facing, lane.facing) < 0.005) b.predicted = false;
          } else b.facing = lane.facing;
        }
      }
      if (!b.seen) {
        // Gone: its flight is done (a frost scar on its line), or its mark fell.
        b.id = -1;
        b.holder.visible = false;
        b.scarUntil = b.flyAt >= 0 ? this.clock + SCAR_SECONDS : -1;
        continue;
      }
      const flying = b.flyAt >= 0;
      const aim = this.markDuration > 0 ? 1 - this.markFill / this.markDuration : 0.5;
      const fly = flying ? (this.clock - b.flyAt) / Math.max(0.05, H.bladeFly) : 0;
      bladeFlight(this.clock, flying, aim, b.laneState === 'lock', fly, _pose);
      const dx = Math.sin(b.facing);
      const dz = Math.cos(b.facing);
      // It hovers astride the rim as it aims (its guard out over the edge,
      // half its blade over the floor, seen from the raid), then its point
      // runs the line to the far rim.
      const reach = ICE_SWORD_BLADE * SWORD_SCALE;
      const along = _pose.along * b.length + reach * 0.5;
      const x = b.fromX + dx * (along - reach);
      const z = b.fromZ + dz * (along - reach);
      const tipX = b.fromX + dx * along;
      const tipZ = b.fromZ + dz * along;
      const y = H.groundY(tipX, tipZ) + _pose.lift;
      b.holder.position.set(x, y, z);
      // Level along its line, broad face up (the blade's +y laid on the
      // line, its nose a little down), rocking gently as it hovers.
      b.holder.rotation.set(0, b.facing, 0, 'YXZ');
      b.holder.rotateX(Math.PI / 2 + _pose.pitch);
      if (!flying) b.holder.rotateY(Math.sin(this.clock * 1.3 + b.id) * 0.1);
      b.glow.value = _pose.glow;
      this.fullerMat.opacity = 0.45 + 0.55 * _pose.glow;
      // The wake of its flight: frost and shards along what it crossed.
      if (flying && fly <= 1.05) {
        // A cold streak along its whole sweep and ice shards thrown off it.
        const n = Math.round(30 * H.density) + 4;
        const swept = Math.max(4, along);
        for (let i = 0; i < n; i++) {
          const back = H.rand() * Math.min(swept, 24);
          const px = tipX - dx * back;
          const pz = tipZ - dz * back;
          H.particles.puff(px, H.groundY(px, pz) + 0.8 + H.rand() * 3, pz, 1, {
            speed: 3,
            up: 2.5,
            life: 1.1,
            size: [0.9, 0.15],
            color: C.frost,
            alpha: 1,
            pool: 'glow',
            radius: H.bladeHalf,
            gravity: 6,
          });
        }
        if (H.rand() < 0.8 * H.density)
          H.particles.puff(tipX, y, tipZ, 3, {
            speed: 7,
            up: 5,
            life: 0.9,
            size: [0.5, 0.25],
            color: [0.85, 0.95, 1],
            alpha: 1,
            radius: 1.2,
            gravity: 20,
          });
      } else if (!flying && H.rand() < 0.9 * H.density) {
        // Rime falling off the hovering blade.
        const k = H.rand() * reach;
        H.particles.puff(x + dx * k, y - 0.5, z + dz * k, 1, {
          speed: 0.8,
          up: -0.5,
          life: 1.2,
          size: [0.35, 0.08],
          color: C.frost,
          alpha: 0.9,
          pool: 'glow',
          radius: 0.8,
        });
      }
      b.holder.visible = true;
      // Its line on the floor (every tier).
      if (lane && info) this.paintLane(b, info.state);
      else b.lane.group.visible = false;
    }
  }

  private paintLane(b: Blade, state: 'warn' | 'lock' | 'fly'): void {
    const H = this.h;
    const style = state === 'warn' ? H.laneStyle : H.laneLockedStyle;
    H.kit.drapeLane(
      b.lane,
      H.groundY,
      b.fromX,
      H.groundY(b.fromX, b.fromZ),
      b.fromZ,
      b.facing,
      b.length,
      H.bladeHalf,
      style,
    );
    const fill = laneFill(state, this.markFill, this.markDuration);
    // Frost creeping along the line as it aims: rime motes rising off it.
    const motes = (state === 'warn' ? 2 : 4) * H.density;
    for (let i = 0; i < motes; i++) {
      if (H.rand() > 0.7) continue;
      const t = H.rand() * b.length;
      const side = (H.rand() - 0.5) * 2 * H.bladeHalf;
      const px = b.fromX + Math.sin(b.facing) * t + Math.cos(b.facing) * side;
      const pz = b.fromZ + Math.cos(b.facing) * t - Math.sin(b.facing) * side;
      H.particles.puff(px, H.groundY(px, pz) + 0.2, pz, 1, {
        speed: 0.6,
        up: 1.6,
        life: 1.1,
        size: [0.4, 0.12],
        color: C.frost,
        alpha: 0.9,
        pool: 'glow',
      });
    }
    H.kit.paintLane(b.lane, {
      fill,
      clock: this.clock,
      range: b.length,
      front: state === 'fly' ? 1.6 : undefined,
    });
    b.lane.group.visible = true;
  }

  private paintScar(b: Blade): void {
    const H = this.h;
    const left = (b.scarUntil - this.clock) / SCAR_SECONDS;
    H.kit.paintLane(b.lane, { fill: 1, clock: this.clock, range: b.length, fade: left });
    b.lane.group.visible = left > 0;
  }

  dispose(): void {
    this.stopWaitingForPaint?.();
    this.stopWaitingForPaint = null;
    this.coreMesh.dispose();
    this.glowMesh.dispose();
  }
}
