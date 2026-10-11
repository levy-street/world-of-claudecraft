// The Gravewyrm Sanctum's encounter visuals (plan: sanctum_fx_core.ts), hosted
// by ../rift_death_zone.ts:
//  - floor telegraphs filling with their bars, on the shared kit
//    (../floor_telegraph) in the threat palette: the Scaleguard's Cinder
//    Breath cone, the Sledge Tusker's Tusk Sweep cone (from its locked facing,
//    10 yd past its body) and Trample lane (its length recomputed from the
//    instance-local start as the sim measured it, stopping at a drop), a kick
//    glyph under every Warming Rite and Goad;
//  - the encounter objects' edges: the Ice Block Toss ring filling over its
//    bar, and the spilled soulfire patches burning on the ice for their 10 s
//    (violet-green flames inside the edge, a glow under them, steam);
//  - the creature layers it composes: the Tusker's sledge and body
//    (tusker_fx.ts) and the trash (sanctum_trash_fx.ts), through the pooled
//    particles (smoke, glow, soulfire and pyre flames), the shock rings and
//    the ice shards it lends them (sanctum_fx_host.ts).
//
// Rules (src/render/CLAUDE.md): pooled geometry and materials built once,
// attached through the compile gate (the sledge, loaded later, through its
// own gated attach), no per-frame allocation in the pools, no light. The
// telegraphs are ACTIONABLE: their footprint draws on every tier; the
// particles, rings and glows are cosmetic and thin on the low tier. All state
// comes from IWorld entities and events, so offline and online look the same.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../../game/ui_effects_profile';
import {
  SANCTUM_SOULFIRE_PATCH,
  SANCTUM_TOSS_RING,
  SCALEGUARD_ID,
  SLEDGE_TUSKER_ID,
  TUSKER_ENRAGE,
  TUSKER_SPILLED_BRAZIERS,
  TUSKER_TRAMPLE,
  TUSKER_TUSK_SWEEP,
} from '../../sim/encounters/gravewyrm_sanctum/ids';
import {
  SANCTUM_BRANDING_IRON,
  SANCTUM_COUNTERWEIGHT_LASH,
  SANCTUM_FRACTURE,
  SANCTUM_GOAD,
  SANCTUM_HOARFROST_POP,
  SANCTUM_ICE_BLOCK_TOSS,
  SANCTUM_RIME_BREATH,
  SANCTUM_SHATTER,
  SANCTUM_SOULFIRE_STOKE,
  SANCTUM_THAW_THE_HELD,
  SANCTUM_TOPPLE_BRAZIER,
} from '../../sim/mob/trash_kit/sanctum_cast_ids';
import type { Entity, SimEvent } from '../../sim/types';
import type { IWorld } from '../../world_api';
import {
  type TelegraphFan,
  TelegraphKit,
  type TelegraphLane,
  telegraphFillOf,
} from '../floor_telegraph';
import { floorVfxRenderOrder } from '../floor_vfx_layer';
import { attachSceneGroupGated } from '../gated_scene_attach';
import { GFX } from '../gfx';
import {
  DUST_FRAG,
  FIRE_FRAG,
  FIRE_VERT,
  GHOST_RAMP,
  GLOW_FRAG,
  PARTICLE_VERT,
  ParticlePool,
  type ParticleSpec,
} from '../hollow_crypt/crypt_fx_particles';
import { getFlameTex } from '../ignivar_fire_vfx';
import { setRenderCategory } from '../renderer_diagnostics';
import { radialGlowTexture } from '../textures';
import {
  FLAME_HEAT,
  HAULER_ENRAGE_GESTURE,
  isHaulerEnrageCue,
  isSanctumObject,
  objectFill,
  PYRE_RAMP,
  patchPresence,
  rampGlsl,
  SANCTUM_FX_MOBS,
  type SanctumPool,
  type SanctumPuffOptions,
  type SanctumTelegraphSpec,
  SOULFIRE_RAMP,
  sanctumObjectSpecs,
  sanctumTelegraphSpecs,
  shockRingLook,
  telegraphYaw,
  tramplePaintLength,
} from './sanctum_fx_core';
import type { SanctumFxHost } from './sanctum_fx_host';
import { SanctumKitFx } from './sanctum_kit_fx';
import { SanctumShards } from './sanctum_shards';
import { SanctumTrashFx } from './sanctum_trash_fx';
import { TuskerFx } from './tusker_fx';

const CAST_SLOTS = 10;
const LANE_SLOTS = 2;
const OBJECT_SLOTS = 12;
const RING_SLOTS = 16;
const SHARD_CAPACITY = 220;
const SCAN_SEC = 0.1;

interface CastSlot extends TelegraphFan {
  casterId: number;
  castId: string;
}
interface LaneSlot extends TelegraphLane {
  casterId: number;
  /** The lane's painted length, measured once per bar (-1: not yet). */
  length: number;
}
interface ObjectSlot extends TelegraphFan {
  objectId: number;
  templateId: string;
  since: number;
  emit: number;
  /** The soulfire's glow pooled under a patch. */
  glow: THREE.Mesh;
  drapedX: number;
  drapedZ: number;
  drapedR: number;
}
interface Ring {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  born: number;
  radius: number;
  span: number;
  alive: boolean;
}

const RING_VERT = /* glsl */ `
varying vec3 vLocal;
void main() {
  vLocal = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
/** A shockwave over the ice: a hot leading edge, a broken frosty wake. */
const RING_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uAlpha;
uniform float uSeed;
varying vec3 vLocal;
float h(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float r = length(vLocal.xz);
  float a = atan(vLocal.z, vLocal.x);
  float lead = smoothstep(0.8, 0.96, r) * (1.0 - smoothstep(0.96, 1.0, r));
  float broken = 0.65 + 0.35 * h(floor(a * 11.0) + uSeed);
  float wake = smoothstep(0.35, 0.95, r) * 0.25 * step(r, 1.0);
  gl_FragColor = vec4(uColor * (1.0 + lead * 1.2), (lead * broken + wake) * uAlpha);
}
`;

export class SanctumFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly specs = sanctumTelegraphSpecs();
  private readonly objectSpecs = sanctumObjectSpecs();
  private readonly casts: CastSlot[] = [];
  private readonly lanes: LaneSlot[] = [];
  private readonly objects: ObjectSlot[] = [];
  private readonly rings: Ring[] = [];
  private readonly kit: TelegraphKit;
  private readonly pools: Record<SanctumPool, ParticlePool>;
  /** The pools as a list (walked every frame without allocating). */
  private readonly poolList: ParticlePool[];
  private readonly shards: SanctumShards;
  private readonly trash: SanctumTrashFx | null;
  /** The trash mechanics pass (tethers, eruption, lash, fracture, topple). */
  private readonly kitFx: SanctumKitFx | null;
  private readonly tusker: TuskerFx | null;
  private readonly uTime = { value: 0 };
  private readonly density: number;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly spec: ParticleSpec = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    life: 1,
    size0: 1,
    size1: 1,
    r: 1,
    g: 1,
    b: 1,
    a: 1,
  };
  private readonly glowTex: THREE.Texture | null;
  private seed = 0x5a7c;
  private scan = 0;
  private clock = 0;
  private inSanctum = false;
  private shown = false;
  private disposed = false;

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    private readonly world?: IWorld,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    private readonly shakeSink?: (amount: number) => void,
    private readonly playGesture?: (entityId: number, gesture: string) => void,
  ) {
    this.root.name = 'gravewyrm-sanctum-fx';
    setRenderCategory(this.root, 'ui3d');
    const detail =
      resolveUiEffectsProfile({ presetLabel: GFX.tier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    this.density = detail ? 1 : 0.4;
    this.kit = new TelegraphKit(this.root, detail);
    for (let i = 0; i < CAST_SLOTS; i++)
      this.casts.push({ ...this.kit.fan(18), casterId: -1, castId: '' });
    for (let i = 0; i < LANE_SLOTS; i++)
      this.lanes.push({ ...this.kit.lane(17), casterId: -1, length: -1 });
    const glowTex = typeof document !== 'undefined' ? radialGlowTexture() : null;
    if (glowTex) glowTex.name = 'sanctumGlow';
    this.glowTex = glowTex;
    const patchGlowMat = new THREE.MeshBasicMaterial({
      map: glowTex,
      color: 0x7ae0a4,
      transparent: true,
      opacity: 0.5,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      name: 'sanctumSoulfireGlow',
    });
    this.materials.push(patchGlowMat);
    const planeGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.geometries.push(planeGeo);
    for (let i = 0; i < OBJECT_SLOTS; i++) {
      const glow = new THREE.Mesh(planeGeo, patchGlowMat);
      glow.visible = false;
      glow.renderOrder = floorVfxRenderOrder('encounter', 3);
      this.root.add(glow);
      this.objects.push({
        ...this.kit.fan(16),
        objectId: -1,
        templateId: '',
        since: 0,
        emit: 0,
        glow,
        drapedX: Number.NaN,
        drapedZ: Number.NaN,
        drapedR: 0,
      });
    }
    // The particle pools: smoke and snow, glowing motes, and the two flames.
    const flameTex = typeof document !== 'undefined' ? getFlameTex() : null;
    const pool = (
      name: string,
      vert: string,
      frag: string,
      blending: THREE.Blending,
      capacity: number,
      order: number,
    ): ParticlePool => {
      const m = new THREE.ShaderMaterial({
        name,
        uniforms: { uTime: this.uTime, uTex: { value: flameTex } },
        vertexShader: vert,
        fragmentShader: frag,
        transparent: true,
        depthWrite: false,
        blending,
      });
      this.materials.push(m);
      const p = new ParticlePool(
        Math.round(capacity * this.density) + 80,
        m,
        floorVfxRenderOrder('encounter', order),
      );
      this.geometries.push(p.mesh.geometry);
      this.root.add(p.mesh);
      return p;
    };
    this.pools = {
      smoke: pool('sanctumFxSmoke', PARTICLE_VERT, DUST_FRAG, THREE.NormalBlending, 1400, 6),
      glow: pool('sanctumFxGlow', PARTICLE_VERT, GLOW_FRAG, THREE.AdditiveBlending, 1200, 8),
      soulfire: pool(
        'sanctumSoulfire',
        FIRE_VERT,
        FIRE_FRAG.replace(GHOST_RAMP, rampGlsl(SOULFIRE_RAMP, 'ghostRamp')),
        THREE.AdditiveBlending,
        900,
        7,
      ),
      pyre: pool(
        'sanctumPyreFire',
        FIRE_VERT,
        FIRE_FRAG.replace(GHOST_RAMP, rampGlsl(PYRE_RAMP, 'ghostRamp')),
        THREE.AdditiveBlending,
        500,
        7,
      ),
    };
    this.poolList = [this.pools.smoke, this.pools.glow, this.pools.soulfire, this.pools.pyre];
    // Shock and pulse rings over the ice.
    const ringGeo = new THREE.CircleGeometry(1, 72).rotateX(-Math.PI / 2);
    this.geometries.push(ringGeo);
    for (let i = 0; i < RING_SLOTS; i++) {
      const mat = new THREE.ShaderMaterial({
        name: 'sanctumFxRing',
        uniforms: {
          uColor: { value: new THREE.Color() },
          uAlpha: { value: 0 },
          uSeed: { value: i * 7.1 },
        },
        vertexShader: RING_VERT,
        fragmentShader: RING_FRAG,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      });
      this.materials.push(mat);
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.frustumCulled = false;
      mesh.visible = false;
      mesh.renderOrder = floorVfxRenderOrder('encounter', 4);
      this.root.add(mesh);
      this.rings.push({ mesh, mat, born: 0, radius: 0, span: 1, alive: false });
    }
    this.shards = new SanctumShards(
      this.root,
      Math.round(SHARD_CAPACITY * (detail ? 1 : 0.5)),
      (x, z) => this.groundY(x, z),
      () => this.rand(),
    );
    const host = this.host();
    this.trash = world ? new SanctumTrashFx(host, world, glowTex) : null;
    this.kitFx = world ? new SanctumKitFx(host, world) : null;
    this.tusker = world
      ? new TuskerFx(scene, host, world, compileGate, playGesture, glowTex ?? undefined)
      : null;
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  /** What the creature layers borrow: this root, kit, pools, rings, shards. */
  private host(): SanctumFxHost {
    return {
      root: this.root,
      kit: this.kit,
      density: this.density,
      uTime: this.uTime,
      groundY: (x, z) => this.groundY(x, z),
      puff: (x, y, z, n, o) => this.puff(x, y, z, n, o),
      shockRing: (x, z, color, radius, seconds) => this.shockRing(x, z, color, radius, seconds),
      rand: () => this.rand(),
      reducedMotion: () => this.reducedMotion(),
      shake: (amount) => this.shakeSink?.(amount),
      gesture: (id, g) => this.playGesture?.(id, g),
      shards: this.shards,
    };
  }

  private rand(): number {
    this.seed = (Math.imul(this.seed, 1664525) + 1013904223) | 0;
    return (this.seed >>> 0) / 4294967296;
  }

  // ---------------------------------------------------------------- particles

  private puff(x: number, y: number, z: number, n: number, o: SanctumPuffOptions): void {
    if (this.reducedMotion() && n > 4) n = Math.ceil(n / 3);
    const pool = this.pools[o.pool ?? 'smoke'];
    const count = n <= 1 ? n : Math.max(1, Math.round(n * this.density));
    const s = this.spec;
    for (let i = 0; i < count; i++) {
      const a = this.rand() * Math.PI * 2;
      const e = (this.rand() - 0.5) * 2;
      let vx = Math.cos(a) * Math.sqrt(1 - e * e);
      let vy = e;
      let vz = Math.sin(a) * Math.sqrt(1 - e * e);
      if (o.dir) {
        const k = o.spread ?? 0.35;
        vx = o.dir[0] + vx * k;
        vy = o.dir[1] + vy * k;
        vz = o.dir[2] + vz * k;
      }
      const sp = o.speed * (0.55 + this.rand() * 0.9);
      const r = o.radius ? Math.sqrt(this.rand()) * o.radius : 0;
      const ra = this.rand() * Math.PI * 2;
      s.x = x + Math.cos(ra) * r;
      s.y = y;
      s.z = z + Math.sin(ra) * r;
      s.vx = vx * sp;
      s.vy = vy * sp + (o.up ?? 0);
      s.vz = vz * sp;
      s.ax = 0;
      s.ay = -(o.gravity ?? 0);
      s.az = 0;
      s.life = o.life * (0.7 + this.rand() * 0.6);
      s.drag = o.drag ?? 1.2;
      s.floor = y - 0.6;
      s.size0 = o.size[0];
      s.size1 = o.size[1];
      s.spin = (this.rand() - 0.5) * 2;
      s.seed = this.rand();
      s.r = o.color[0];
      s.g = o.color[1];
      s.b = o.color[2];
      s.a = o.alpha;
      pool.emit(this.clock, s);
    }
  }

  /** A shock ring racing out to `radius` over `seconds`. */
  private shockRing(x: number, z: number, color: number, radius: number, seconds: number): void {
    const slot = this.rings.find((r) => !r.alive) ?? this.rings[0];
    slot.alive = true;
    slot.born = this.clock;
    slot.radius = radius;
    slot.span = seconds;
    (slot.mat.uniforms.uColor.value as THREE.Color).setHex(color);
    slot.mesh.position.set(x, this.groundY(x, z) + 0.14, z);
    slot.mesh.visible = true;
  }

  // ------------------------------------------------------------------- events

  /** True when the event is one of the Sanctum's own (the renderer then skips
   *  its generic draw of it). */
  handleEvent(ev: SimEvent): boolean {
    if (ev.type !== 'spellfx' || !this.world || this.disposed) return false;
    const src = this.world.entities.get(ev.sourceId);
    if (!src) return false;
    // The Scaleguard's breath lands as the generic fire cone (no ability):
    // the cinders pour down it too, and the generic cone still draws.
    if (ev.fx === 'fireCone' && src.templateId === SCALEGUARD_ID) {
      this.trash?.cinderBreath(src);
      return false;
    }
    // The Sledge-Hauler's frenzy: it beats its chest and roars (the generic
    // enrage nova still draws).
    if (isHaulerEnrageCue(ev, src.templateId)) {
      this.playGesture?.(src.id, HAULER_ENRAGE_GESTURE);
      return false;
    }
    switch (ev.ability) {
      case TUSKER_TUSK_SWEEP:
      case TUSKER_TRAMPLE:
      case TUSKER_SPILLED_BRAZIERS:
      case TUSKER_ENRAGE:
        return this.tusker?.handleEvent(ev, src) ?? false;
      case SANCTUM_GOAD:
      case SANCTUM_SOULFIRE_STOKE:
      case SANCTUM_HOARFROST_POP:
      case SANCTUM_SHATTER:
      case SANCTUM_ICE_BLOCK_TOSS:
        return this.trash?.handleEvent(ev, src) ?? false;
      case SANCTUM_THAW_THE_HELD:
      case SANCTUM_COUNTERWEIGHT_LASH:
      case SANCTUM_BRANDING_IRON:
      case SANCTUM_RIME_BREATH:
      case SANCTUM_FRACTURE:
      case SANCTUM_TOPPLE_BRAZIER:
        return this.kitFx?.handleEvent(ev, src) ?? false;
      default:
        return false;
    }
  }

  // ------------------------------------------------------------------- frame

  update(dt: number): void {
    const world = this.world;
    if (!world || this.disposed) return;
    this.clock += dt;
    this.uTime.value = this.clock;
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = SCAN_SEC;
      this.scanWorld(world);
    }
    if (!this.inSanctum) {
      if (this.shown) {
        this.shown = false;
        for (const c of this.casts) {
          c.casterId = -1;
          c.group.visible = false;
        }
        for (const l of this.lanes) {
          l.casterId = -1;
          l.group.visible = false;
        }
        for (const o of this.objects) this.releaseObject(o);
        this.trash?.hideAll();
        this.kitFx?.hideAll();
        this.tusker?.hideAll();
        this.shards.hideAll();
      }
      for (const p of this.poolList) p.update(this.clock);
      return;
    }
    this.shown = true;
    this.paintCasts(world);
    this.paintLanes(world);
    this.paintObjects(world, dt);
    this.paintRings();
    this.trash?.update(dt, this.clock);
    this.kitFx?.update(dt, this.clock);
    this.tusker?.update(dt, this.clock);
    this.shards.update(dt);
    for (const p of this.poolList) p.update(this.clock);
  }

  private castSpec(castId: string): SanctumTelegraphSpec | undefined {
    return this.specs[castId];
  }

  private paintCasts(world: IWorld): void {
    for (const slot of this.casts) {
      if (slot.casterId < 0) continue;
      const caster = world.entities.get(slot.casterId);
      const spec = this.castSpec(slot.castId);
      if (!caster || caster.dead || caster.castingAbility !== slot.castId || !spec) {
        slot.casterId = -1;
        slot.group.visible = false;
        continue;
      }
      const fill = telegraphFillOf(caster.castRemaining, caster.castTotal);
      const yaw = spec.shape === 'sigil' ? this.clock * 1.4 : telegraphYaw(spec, caster.facing);
      // From the body's centre: the edge the sim tests (the sweep's range is
      // its reach past the Tusker's body plus the body).
      const x = caster.pos.x;
      const z = caster.pos.z;
      this.kit.drapeFan(slot, this.groundY, x, this.groundY(x, z), z, yaw, spec.range);
      this.kit.paintFan(slot, { fill, clock: this.clock, range: spec.range });
    }
  }

  private paintLanes(world: IWorld): void {
    for (const slot of this.lanes) {
      if (slot.casterId < 0) continue;
      const caster = world.entities.get(slot.casterId);
      const spec = this.castSpec(TUSKER_TRAMPLE);
      if (!caster || caster.dead || caster.castingAbility !== TUSKER_TRAMPLE || !spec) {
        slot.casterId = -1;
        slot.length = -1;
        slot.group.visible = false;
        continue;
      }
      const x = caster.pos.x;
      const z = caster.pos.z;
      // The lane runs down its locked facing until the road ends, measured
      // from the instance-local start exactly as the sim measured it.
      if (slot.length < 0) slot.length = tramplePaintLength(x, z, caster.facing);
      this.kit.drapeLane(
        slot,
        this.groundY,
        x,
        this.groundY(x, z),
        z,
        caster.facing,
        slot.length,
        spec.halfWidth ?? 2.5,
        { color: spec.color, accent: spec.accent },
      );
      const fill = telegraphFillOf(caster.castRemaining, caster.castTotal);
      this.kit.paintLane(slot, { fill, clock: this.clock, range: slot.length });
    }
  }

  private paintObjects(world: IWorld, dt: number): void {
    for (const slot of this.objects) {
      if (slot.objectId < 0) continue;
      const obj = world.entities.get(slot.objectId);
      const spec = obj ? this.objectSpecs[obj.templateId] : undefined;
      if (!obj || !spec) {
        this.releaseObject(slot);
        continue;
      }
      const radius = obj.scale;
      const x = obj.pos.x;
      const z = obj.pos.z;
      const gy = this.groundY(x, z);
      const age = this.clock - slot.since;
      if (x !== slot.drapedX || z !== slot.drapedZ || radius !== slot.drapedR) {
        this.kit.drapeFan(slot, this.groundY, x, gy, z, 0, radius);
        slot.drapedX = x;
        slot.drapedZ = z;
        slot.drapedR = radius;
      }
      const patch = obj.templateId === SANCTUM_SOULFIRE_PATCH;
      const presence = patch ? patchPresence(age, spec.seconds ?? 10) : 1;
      this.kit.paintFan(slot, {
        fill: objectFill(age, spec.fillSeconds),
        clock: this.clock,
        range: radius,
        fade: presence,
      });
      if (!patch) continue;
      // The soulfire burning on the ice inside the edge (cosmetic).
      const glow = slot.glow;
      glow.visible = true;
      glow.position.set(x, gy + 0.18, z);
      const g = radius * 2.6 * (0.94 + 0.06 * Math.sin(this.clock * 7 + slot.objectId));
      glow.scale.set(g, 1, g);
      slot.emit += dt * 30 * this.density * presence;
      while (slot.emit >= 1) {
        slot.emit -= 1;
        this.puff(x, gy + 0.05, z, 1, {
          speed: 0.25,
          up: 1.2,
          life: 0.9,
          size: [2.2, 0.8],
          color: FLAME_HEAT,
          alpha: 1,
          pool: 'soulfire',
          radius: radius * 0.85,
        });
        if (this.rand() < 0.35)
          this.puff(x, gy + 0.6, z, 1, {
            speed: 0.4,
            up: 2.4,
            life: 1.2,
            size: [0.16, 0.05],
            color: [0.56, 0.84, 0.63],
            alpha: 1,
            pool: 'glow',
            radius: radius * 0.8,
          });
        if (this.rand() < 0.2) {
          // Steam where the soulfire meets the ice, at the rim.
          const a = this.rand() * Math.PI * 2;
          this.puff(x + Math.cos(a) * radius, gy + 0.1, z + Math.sin(a) * radius, 1, {
            speed: 0.3,
            up: 1,
            life: 2.2,
            size: [0.8, 2.4],
            color: [0.88, 0.9, 0.94],
            alpha: 0.28,
          });
        }
      }
    }
  }

  private releaseObject(slot: ObjectSlot): void {
    slot.objectId = -1;
    slot.group.visible = false;
    slot.glow.visible = false;
  }

  private paintRings(): void {
    for (const r of this.rings) {
      if (!r.alive) continue;
      const elapsed = this.clock - r.born;
      if (elapsed > r.span) {
        r.alive = false;
        r.mesh.visible = false;
        continue;
      }
      const look = shockRingLook(elapsed, r.radius, r.span);
      r.mesh.scale.setScalar(Math.max(0.01, look.radius));
      r.mat.uniforms.uAlpha.value = look.alpha;
    }
  }

  private scanWorld(world: IWorld): void {
    let sanctum = false;
    this.tusker?.beginScan();
    this.tusker?.clearPatches();
    for (const e of world.entities.values()) {
      if (e.kind === 'player') continue;
      if (e.kind !== 'mob') {
        if (isSanctumObject(e.templateId)) {
          sanctum = true;
          this.scanObject(e);
        }
        continue;
      }
      // Any mob may carry a Goad's fury or a brazier's quickening.
      this.trash?.scanMob(e);
      this.kitFx?.scanMob(e);
      if (!SANCTUM_FX_MOBS.has(e.templateId) && !this.castSpec(e.castingAbility ?? '')) continue;
      sanctum = true;
      if (e.templateId === SLEDGE_TUSKER_ID) this.tusker?.scanTusker(e);
      if (e.dead) continue;
      const castId = e.castingAbility;
      const spec = castId ? this.castSpec(castId) : undefined;
      if (!castId || !spec) continue;
      if (spec.shape === 'lane') {
        if (this.lanes.some((l) => l.casterId === e.id)) continue;
        const lane = this.lanes.find((l) => l.casterId < 0);
        if (!lane) continue;
        lane.casterId = e.id;
        lane.length = -1;
        lane.group.visible = true;
        continue;
      }
      if (this.casts.some((t) => t.casterId === e.id)) continue;
      const slot = this.casts.find((t) => t.casterId < 0);
      if (!slot) continue;
      this.kit.layOutFan(slot, spec.arcDeg, {
        color: spec.color,
        accent: spec.accent,
        sigil: spec.shape === 'sigil',
      });
      slot.casterId = e.id;
      slot.castId = castId;
      slot.group.visible = true;
    }
    this.tusker?.endScan();
    this.inSanctum = sanctum;
  }

  private scanObject(e: Entity): void {
    if (e.templateId === SANCTUM_TOSS_RING) this.trash?.scanRing(e);
    if (e.templateId === SANCTUM_SOULFIRE_PATCH) this.tusker?.notePatch(e);
    const spec = this.objectSpecs[e.templateId];
    if (!spec) return;
    if (this.objects.some((o) => o.objectId === e.id)) return;
    const slot = this.objects.find((o) => o.objectId < 0);
    if (!slot) return;
    this.kit.layOutFan(slot, 360, { color: spec.color, accent: spec.accent });
    slot.objectId = e.id;
    slot.templateId = e.templateId;
    slot.since = this.clock;
    slot.emit = 0;
    slot.drapedX = Number.NaN;
    slot.group.visible = true;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    // Best effort: one throwing release never strands the rest.
    const errors: unknown[] = [];
    const attempt = (release: () => void): void => {
      try {
        release();
      } catch (e) {
        errors.push(e);
      }
    };
    attempt(() => this.root.removeFromParent());
    attempt(() => this.kit.dispose());
    attempt(() => this.shards.dispose());
    if (this.trash) {
      const trash = this.trash;
      attempt(() => trash.dispose());
    }
    if (this.kitFx) {
      const kitFx = this.kitFx;
      attempt(() => kitFx.dispose());
    }
    if (this.tusker) {
      const tusker = this.tusker;
      attempt(() => tusker.dispose());
    }
    for (const g of this.geometries) attempt(() => g.dispose());
    for (const m of this.materials) attempt(() => m.dispose());
    if (this.glowTex) {
      const tex = this.glowTex;
      attempt(() => tex.dispose());
    }
    if (errors.length > 0) throw new AggregateError(errors, 'SanctumFx dispose');
  }
}
