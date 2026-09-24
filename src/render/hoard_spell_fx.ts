// Buried Hoard spell effects: the Storm Caller's Lightning Strike (charge, bolt,
// aftermath), Hoarfrost's Whiteout Gust (wind filling the cone, then the blast),
// and Archon Nyxaris's Voidfall, Event Horizon and Singularity Collapse. Every
// number comes from hoard_spell_fx_core.ts.
//
// How it draws: immediate mode over POOLED buffers. Three ribbon pools (one per
// palette) plus small pools of rings, discs and columns are built once in the
// constructor and attached through the scene gate; each active frame rewinds
// the pools and re-emits only what is live. Nothing is created, cloned or
// compiled mid-fight, an idle frame returns before touching anything, and the
// low tier builds none of it (src/render/CLAUDE.md).
//
// Cosmetic only: the floor telegraph in hoard_boss_fx.ts is the warning, and a
// hit is decided in src/sim/rift/ by a plain circle or cone, never by anything
// drawn here.

import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import type { HoardBossCueView } from '../world_api/dungeons';
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX, type GfxTier } from './gfx';
import { hoardHash } from './hoard_boss_dressing_core';
import {
  COLLAPSE_RINGS,
  COLLAPSE_SHARDS,
  collapseBurst,
  collapseRing,
  GUST_STREAKS,
  type GustStreakPlan,
  gustBlast,
  gustStreak,
  HORIZON_STREAK_SEGMENTS,
  HORIZON_STREAK_SWEEP,
  HORIZON_STREAKS,
  type HorizonStreakPlan,
  horizonEye,
  horizonStreak,
  horizonWave,
  SPELL_FLICKER_CALM_HZ,
  SPELL_FLICKER_HZ,
  STRIKE_ARC_POINTS,
  STRIKE_BOLT_HEIGHT,
  STRIKE_BOLT_POINTS,
  STRIKE_BRANCH_POINTS,
  STRIKE_BRANCHES,
  STRIKE_FORK_POINTS,
  STRIKE_GROUND_FORKS,
  STRIKE_RIM_ARCS,
  strikeBolt,
  strikeBranch,
  strikeCharge,
  strikeGroundFork,
  strikeImpact,
  strikeRimArc,
  VOIDFALL_SPLASH_SEC,
  VOIDFALL_SWIRLS,
  voidfallStar,
  voidfallSwirl,
} from './hoard_spell_fx_core';
import { setRenderCategory } from './renderer_diagnostics';

const TRACKED = 12;
const BURSTS = 10;
const RIBBON_SEGMENTS = 420;
const RINGS = 10;
const DISCS = 8;
const COLUMNS = 5;
const LANDED_WITHIN_SEC = 0.3;
const SWIRL_POINTS = 9;

type Palette = 'storm' | 'frost' | 'arcane';
type BurstKind = 'strike' | 'gust' | 'horizon' | 'collapse' | 'voidfall';

const COLORS: Record<Palette, { core: number; halo: number; glow: number }> = {
  storm: { core: 0xf2fdff, halo: 0x3fa2ff, glow: 0x9fe4ff },
  frost: { core: 0xffffff, halo: 0x8fd2ff, glow: 0xdff5ff },
  arcane: { core: 0xf6eaff, halo: 0x8a3cff, glow: 0xc79bff },
};

interface Tracked {
  /** -1 while free. */
  instanceId: number;
  cueId: number;
  variant: string;
  phase: 'warning' | 'hazard';
  x: number;
  y: number;
  z: number;
  radius: number;
  inner: number;
  facing: number;
  halfAngle: number;
  remaining: number;
  total: number;
  seen: boolean;
}

interface Burst {
  /** Negative while free. */
  age: number;
  kind: BurstKind;
  seed: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  inner: number;
  facing: number;
  halfAngle: number;
}

function additive(color: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({
    color,
    opacity: 1,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

/** Quads rewritten in place each active frame; the draw range is the cursor, so
 *  unused capacity costs nothing and is never cleared. */
class RibbonPool {
  readonly core: THREE.Mesh;
  readonly halo: THREE.Mesh;
  private readonly corePosition: THREE.BufferAttribute;
  private readonly haloPosition: THREE.BufferAttribute;
  private cursor = 0;
  private last = 0;

  constructor(
    palette: Palette,
    own: <T extends THREE.BufferGeometry>(geometry: T) => T,
    keep: <T extends THREE.Material>(material: T) => T,
  ) {
    const indices: number[] = [];
    for (let segment = 0; segment < RIBBON_SEGMENTS; segment++) {
      const base = segment * 4;
      indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2);
    }
    const build = (color: number, opacity: number, order: number): THREE.Mesh => {
      const geometry = own(new THREE.BufferGeometry());
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(new Float32Array(RIBBON_SEGMENTS * 12), 3).setUsage(
          THREE.DynamicDrawUsage,
        ),
      );
      geometry.setIndex(indices);
      geometry.setDrawRange(0, 0);
      const material = keep(additive(color));
      material.opacity = opacity;
      const mesh = new THREE.Mesh(geometry, material);
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      return mesh;
    };
    this.halo = build(COLORS[palette].halo, 0.42, 24);
    this.core = build(COLORS[palette].core, 0.95, 25);
    this.corePosition = this.core.geometry.getAttribute('position') as THREE.BufferAttribute;
    this.haloPosition = this.halo.geometry.getAttribute('position') as THREE.BufferAttribute;
  }

  begin(): void {
    this.cursor = 0;
  }

  /** One segment a to b, widened by `width` along the unit vector (wx, wy, wz).
   *  The halo is the same quad four times as wide. */
  quad(
    ax: number,
    ay: number,
    az: number,
    bx: number,
    by: number,
    bz: number,
    wx: number,
    wy: number,
    wz: number,
    width: number,
  ): void {
    if (this.cursor >= RIBBON_SEGMENTS || width <= 0.0005) return;
    const vertex = this.cursor * 4;
    this.cursor++;
    for (let pass = 0; pass < 2; pass++) {
      const attribute = pass === 0 ? this.corePosition : this.haloPosition;
      const w = pass === 0 ? width : width * 4;
      attribute.setXYZ(vertex, ax + wx * w, ay + wy * w, az + wz * w);
      attribute.setXYZ(vertex + 1, ax - wx * w, ay - wy * w, az - wz * w);
      attribute.setXYZ(vertex + 2, bx + wx * w, by + wy * w, bz + wz * w);
      attribute.setXYZ(vertex + 3, bx - wx * w, by - wy * w, bz - wz * w);
    }
  }

  /** A segment lying near the ground, widened sideways in the ground plane. */
  flat(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number) {
    const dx = bx - ax;
    const dz = bz - az;
    const length = Math.hypot(dx, dz) || 1;
    this.quad(ax, ay, az, bx, by, bz, -dz / length, 0, dx / length, width);
  }

  /** A segment standing in the air: two crossed quads, so it reads from any side. */
  cross(ax: number, ay: number, az: number, bx: number, by: number, bz: number, width: number) {
    this.quad(ax, ay, az, bx, by, bz, 1, 0, 0, width);
    this.quad(ax, ay, az, bx, by, bz, 0, 0, 1, width);
  }

  end(): void {
    if (this.cursor === 0 && this.last === 0) return;
    this.core.geometry.setDrawRange(0, this.cursor * 6);
    this.halo.geometry.setDrawRange(0, this.cursor * 6);
    if (this.cursor > 0) {
      this.corePosition.needsUpdate = true;
      this.haloPosition.needsUpdate = true;
    }
    this.last = this.cursor;
  }
}

/** A small pool of identical meshes, each with its own material, handed out
 *  per frame and hidden again at the next begin(). */
class ShapePool {
  private readonly meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshBasicMaterial>[] = [];
  private cursor = 0;
  private last = 0;

  constructor(
    root: THREE.Group,
    geometry: THREE.BufferGeometry,
    count: number,
    order: number,
    keep: <T extends THREE.Material>(material: T) => T,
  ) {
    for (let index = 0; index < count; index++) {
      const mesh = new THREE.Mesh(geometry, keep(additive(0xffffff)));
      mesh.visible = false;
      mesh.frustumCulled = false;
      mesh.renderOrder = order;
      root.add(mesh);
      this.meshes.push(mesh);
    }
  }

  begin(): void {
    this.cursor = 0;
  }

  take(color: number, opacity: number): THREE.Mesh | null {
    if (opacity <= 0.004 || this.cursor >= this.meshes.length) return null;
    const mesh = this.meshes[this.cursor++];
    mesh.visible = true;
    mesh.material.color.setHex(color);
    mesh.material.opacity = Math.min(1, opacity);
    return mesh;
  }

  end(): void {
    for (let index = this.cursor; index < this.last; index++) this.meshes[index].visible = false;
    this.last = this.cursor;
  }
}

export class HoardSpellFx {
  readonly readyForEntry: Promise<void>;
  private readonly root = new THREE.Group();
  private readonly enabled: boolean;
  private readonly geometries: THREE.BufferGeometry[] = [];
  private readonly materials: THREE.Material[] = [];
  private readonly tracked: Tracked[] = [];
  private readonly bursts: Burst[] = [];
  private ribbons!: Record<Palette, RibbonPool>;
  private rings!: ShapePool;
  private discs!: ShapePool;
  private columns!: ShapePool;
  private liveTracked = 0;
  private liveBursts = 0;
  private drewLastFrame = false;
  private clock = 0;
  private disposed = false;
  private readonly scratchA: number[] = [];
  private readonly scratchB: number[] = [];
  private readonly gust: GustStreakPlan = { bearing: 0, head: 0, tail: 0, lift: 0, opacity: 0 };
  private readonly horizon: HorizonStreakPlan = {
    angle: 0,
    head: 0,
    tail: 0,
    lift: 0,
    opacity: 0,
  };

  constructor(
    scene: THREE.Scene,
    private readonly groundY: (x: number, z: number) => number,
    compileGate?: (target: THREE.Object3D) => Promise<unknown>,
    private readonly reducedMotion: () => boolean = () => false,
    effectsTier: GfxTier = GFX.tier,
  ) {
    this.root.name = 'hoard-spell-fx';
    // Attributed like the telegraphs it accompanies, but deliberately NOT actionable.
    setRenderCategory(this.root, 'ui3d');
    this.enabled =
      resolveUiEffectsProfile({ presetLabel: effectsTier, effectsQuality: 1, reduceMotion: false })
        .tier !== 'low';
    if (!this.enabled) {
      this.readyForEntry = Promise.resolve();
      return;
    }
    const own = <T extends THREE.BufferGeometry>(geometry: T): T => {
      this.geometries.push(geometry);
      return geometry;
    };
    const keep = <T extends THREE.Material>(material: T): T => {
      this.materials.push(material);
      return material;
    };
    this.ribbons = {
      storm: new RibbonPool('storm', own, keep),
      frost: new RibbonPool('frost', own, keep),
      arcane: new RibbonPool('arcane', own, keep),
    };
    for (const pool of Object.values(this.ribbons)) this.root.add(pool.halo, pool.core);
    const ring = own(new THREE.RingGeometry(0.9, 1, 64));
    ring.rotateX(-Math.PI / 2);
    const disc = own(new THREE.CircleGeometry(1, 48));
    disc.rotateX(-Math.PI / 2);
    const column = own(new THREE.CylinderGeometry(1, 1, 1, 24, 1, true));
    column.translate(0, 0.5, 0);
    this.rings = new ShapePool(this.root, ring, RINGS, 23, keep);
    this.discs = new ShapePool(this.root, disc, DISCS, 22, keep);
    this.columns = new ShapePool(this.root, column, COLUMNS, 22, keep);
    for (let index = 0; index < TRACKED; index++) {
      this.tracked.push({
        instanceId: -1,
        cueId: -1,
        variant: '',
        phase: 'warning',
        x: 0,
        y: 0,
        z: 0,
        radius: 0,
        inner: 0,
        facing: 0,
        halfAngle: 0,
        remaining: 0,
        total: 1,
        seen: false,
      });
    }
    for (let index = 0; index < BURSTS; index++) {
      this.bursts.push({
        age: -1,
        kind: 'strike',
        seed: 0,
        x: 0,
        y: 0,
        z: 0,
        radius: 0,
        inner: 0,
        facing: 0,
        halfAngle: 0,
      });
    }
    this.readyForEntry = attachSceneGroupGated(scene, this.root, compileGate, () => this.disposed)
      .then(() => {})
      .catch(() => {});
  }

  private static wants(variant: string | undefined): boolean {
    return (
      variant === 'storm-strike' ||
      variant === 'frost-gust' ||
      variant === 'arcane-horizon' ||
      variant === 'arcane-collapse' ||
      variant === 'arcane-voidfall'
    );
  }

  /** Follow the cues this module dresses; one that runs its fuse out bursts. */
  sync(cues: readonly HoardBossCueView[]): void {
    if (!this.enabled) return;
    if (cues.length === 0 && this.liveTracked === 0) return;
    for (const slot of this.tracked) slot.seen = false;
    for (let index = 0; index < cues.length; index++) {
      const cue = cues[index];
      if (!HoardSpellFx.wants(cue.variant)) continue;
      let slot: Tracked | null = null;
      let free: Tracked | null = null;
      for (const candidate of this.tracked) {
        if (candidate.instanceId === cue.instanceId && candidate.cueId === cue.cueId) {
          slot = candidate;
          break;
        }
        if (candidate.instanceId === -1 && !free) free = candidate;
      }
      if (!slot) {
        if (!free) continue;
        slot = free;
        slot.instanceId = cue.instanceId;
        slot.cueId = cue.cueId;
        slot.phase = cue.phase;
        // The ground is sampled once, when the cue is first seen.
        slot.y = this.groundY(cue.x, cue.z);
        this.liveTracked++;
      }
      // A Voidfall mark turning from warning into its pool is the star landing.
      if (slot.phase === 'warning' && cue.phase === 'hazard' && cue.variant === 'arcane-voidfall')
        this.burst('voidfall', slot);
      slot.variant = cue.variant ?? '';
      slot.phase = cue.phase;
      slot.x = cue.x;
      slot.z = cue.z;
      slot.radius = cue.radius;
      slot.inner = cue.innerRadius ?? 0;
      slot.facing = cue.facing ?? 0;
      slot.halfAngle = cue.halfAngle ?? 0;
      slot.remaining = cue.remaining;
      slot.total = cue.total > 0 ? cue.total : 1;
      slot.seen = true;
    }
    for (const slot of this.tracked) {
      if (slot.instanceId === -1 || slot.seen) continue;
      // Vanished with its fuse spent: it landed. Vanished early: it was
      // interrupted, its caster died or the fight reset, and nothing bursts.
      if (slot.phase === 'warning' && slot.remaining <= LANDED_WITHIN_SEC) {
        if (slot.variant === 'storm-strike') this.burst('strike', slot);
        else if (slot.variant === 'frost-gust') this.burst('gust', slot);
        else if (slot.variant === 'arcane-horizon') this.burst('horizon', slot);
        else if (slot.variant === 'arcane-collapse') this.burst('collapse', slot);
      }
      slot.instanceId = -1;
      this.liveTracked--;
    }
  }

  private burst(kind: BurstKind, from: Tracked): void {
    let slot = this.bursts[0];
    for (const candidate of this.bursts) {
      if (candidate.age < 0) {
        slot = candidate;
        break;
      }
      if (candidate.age > slot.age) slot = candidate;
    }
    if (slot.age < 0) this.liveBursts++;
    slot.age = 0;
    slot.kind = kind;
    slot.seed = from.cueId;
    slot.x = from.x;
    slot.y = from.y;
    slot.z = from.z;
    slot.radius = from.radius;
    slot.inner = from.inner;
    slot.facing = from.facing;
    slot.halfAngle = from.halfAngle;
  }

  update(dt: number): void {
    if (!this.enabled) return;
    if (this.liveTracked === 0 && this.liveBursts === 0 && !this.drewLastFrame) return;
    this.clock += dt;
    const calm = this.reducedMotion();
    const bucket = Math.floor(this.clock * (calm ? SPELL_FLICKER_CALM_HZ : SPELL_FLICKER_HZ));
    this.ribbons.storm.begin();
    this.ribbons.frost.begin();
    this.ribbons.arcane.begin();
    this.rings.begin();
    this.discs.begin();
    this.columns.begin();

    for (const slot of this.tracked) {
      if (slot.instanceId === -1) continue;
      const progress = 1 - slot.remaining / slot.total;
      if (slot.variant === 'storm-strike') this.drawStrikeCharge(slot, progress, bucket);
      else if (slot.variant === 'frost-gust') this.drawGust(slot, progress);
      else if (slot.variant === 'arcane-horizon') this.drawHorizon(slot, progress, calm);
      else if (slot.variant === 'arcane-collapse') this.drawCollapse(slot, progress);
      else if (slot.variant === 'arcane-voidfall') this.drawVoidfall(slot, progress);
    }
    for (const burst of this.bursts) {
      if (burst.age < 0) continue;
      let done = false;
      if (burst.kind === 'strike') done = this.drawStrikeImpact(burst, bucket);
      else if (burst.kind === 'gust') done = this.drawGustBlast(burst);
      else if (burst.kind === 'horizon') done = this.drawHorizonWave(burst);
      else if (burst.kind === 'collapse') done = this.drawCollapseBurst(burst);
      else done = this.drawVoidfallSplash(burst);
      burst.age += dt;
      if (done) {
        burst.age = -1;
        this.liveBursts--;
      }
    }

    this.ribbons.storm.end();
    this.ribbons.frost.end();
    this.ribbons.arcane.end();
    this.rings.end();
    this.discs.end();
    this.columns.end();
    this.drewLastFrame = this.liveTracked > 0 || this.liveBursts > 0;
  }

  private place(mesh: THREE.Mesh | null, x: number, y: number, z: number, sx: number, sy = sx) {
    if (!mesh) return;
    mesh.position.set(x, y, z);
    mesh.scale.set(sx, sy, sx);
  }

  // ------------------------------------------------------------ Lightning Strike

  private drawStrikeCharge(slot: Tracked, progress: number, bucket: number): void {
    const plan = strikeCharge(progress);
    const pool = this.ribbons.storm;
    const y = slot.y + 0.3;
    // Arcs hug the rim and dip inward: they never cover the boundary itself.
    for (let arc = 0; arc < plan.arcs && arc < STRIKE_RIM_ARCS; arc++) {
      const points = strikeRimArc(slot.cueId, arc, bucket, plan.reach, this.scratchA);
      for (let point = 0; point < STRIKE_ARC_POINTS - 1; point++) {
        pool.flat(
          slot.x + points[point * 2] * slot.radius,
          y,
          slot.z + points[point * 2 + 1] * slot.radius,
          slot.x + points[point * 2 + 2] * slot.radius,
          y,
          slot.z + points[point * 2 + 3] * slot.radius,
          0.05 * plan.arcOpacity,
        );
      }
    }
    this.place(
      this.discs.take(COLORS.storm.glow, plan.coreOpacity * 0.5 + plan.preFlash * 0.5),
      slot.x,
      slot.y + 0.2,
      slot.z,
      slot.radius * (plan.coreScale + plan.preFlash * 0.6),
    );
    // The leader: a thin thread feeling its way down from the sky.
    if (plan.leader > 0) {
      const trunk = strikeBolt(slot.cueId, bucket, this.scratchA);
      const reach = Math.floor(plan.leader * (STRIKE_BOLT_POINTS - 1));
      for (let point = 0; point < reach; point++) {
        pool.cross(
          slot.x + trunk[point * 3] * STRIKE_BOLT_HEIGHT,
          slot.y + trunk[point * 3 + 1] * STRIKE_BOLT_HEIGHT,
          slot.z + trunk[point * 3 + 2] * STRIKE_BOLT_HEIGHT,
          slot.x + trunk[point * 3 + 3] * STRIKE_BOLT_HEIGHT,
          slot.y + trunk[point * 3 + 4] * STRIKE_BOLT_HEIGHT,
          slot.z + trunk[point * 3 + 5] * STRIKE_BOLT_HEIGHT,
          0.025 + plan.preFlash * 0.03,
        );
      }
    }
  }

  private drawStrikeImpact(burst: Burst, bucket: number): boolean {
    const plan = strikeImpact(burst.age);
    const pool = this.ribbons.storm;
    if (plan.bolt > 0) {
      // The bolt holds one shape for its first frames (a strike, not a flicker),
      // then re-rolls for the return stroke.
      const shape = burst.age < 0.14 ? 0 : 1;
      const trunk = strikeBolt(burst.seed, shape, this.scratchA);
      for (let point = 0; point < STRIKE_BOLT_POINTS - 1; point++) {
        pool.cross(
          burst.x + trunk[point * 3] * STRIKE_BOLT_HEIGHT,
          burst.y + trunk[point * 3 + 1] * STRIKE_BOLT_HEIGHT,
          burst.z + trunk[point * 3 + 2] * STRIKE_BOLT_HEIGHT,
          burst.x + trunk[point * 3 + 3] * STRIKE_BOLT_HEIGHT,
          burst.y + trunk[point * 3 + 4] * STRIKE_BOLT_HEIGHT,
          burst.z + trunk[point * 3 + 5] * STRIKE_BOLT_HEIGHT,
          0.26 * plan.bolt,
        );
      }
      for (let branch = 0; branch < STRIKE_BRANCHES; branch++) {
        const fork = strikeBranch(burst.seed, branch, shape, trunk, this.scratchB);
        for (let point = 0; point < STRIKE_BRANCH_POINTS - 1; point++) {
          pool.cross(
            burst.x + fork[point * 3] * STRIKE_BOLT_HEIGHT,
            burst.y + fork[point * 3 + 1] * STRIKE_BOLT_HEIGHT,
            burst.z + fork[point * 3 + 2] * STRIKE_BOLT_HEIGHT,
            burst.x + fork[point * 3 + 3] * STRIKE_BOLT_HEIGHT,
            burst.y + fork[point * 3 + 4] * STRIKE_BOLT_HEIGHT,
            burst.z + fork[point * 3 + 5] * STRIKE_BOLT_HEIGHT,
            0.09 * plan.bolt * (1 - point / STRIKE_BRANCH_POINTS),
          );
        }
      }
    }
    // Forks race out along the ground, then crackle as residue.
    const live = Math.max(plan.forks, plan.residue * 0.6);
    if (live > 0) {
      const y = burst.y + 0.3;
      for (let fork = 0; fork < STRIKE_GROUND_FORKS; fork++) {
        const points = strikeGroundFork(burst.seed, fork, bucket, this.scratchB);
        const reach = burst.radius * 1.5 * plan.forkReach;
        for (let point = 0; point < STRIKE_FORK_POINTS - 1; point++) {
          pool.flat(
            burst.x + points[point * 2] * reach,
            y,
            burst.z + points[point * 2 + 1] * reach,
            burst.x + points[point * 2 + 2] * reach,
            y,
            burst.z + points[point * 2 + 3] * reach,
            0.085 * live * (1 - (point / STRIKE_FORK_POINTS) * 0.7),
          );
        }
      }
    }
    this.place(
      this.discs.take(COLORS.storm.core, plan.flash),
      burst.x,
      burst.y + 0.22,
      burst.z,
      burst.radius * plan.flashScale,
    );
    this.place(
      this.rings.take(COLORS.storm.glow, plan.ring),
      burst.x,
      burst.y + 0.26,
      burst.z,
      burst.radius * plan.ringScale,
    );
    this.place(
      this.columns.take(COLORS.storm.halo, plan.afterglow),
      burst.x,
      burst.y,
      burst.z,
      burst.radius * 0.1,
      STRIKE_BOLT_HEIGHT,
    );
    return plan.done;
  }

  // --------------------------------------------------------------- Whiteout Gust

  private drawGust(slot: Tracked, progress: number): void {
    const pool = this.ribbons.frost;
    for (let index = 0; index < GUST_STREAKS; index++) {
      const streak = gustStreak(slot.cueId, index, this.clock, progress, this.gust);
      if (streak.opacity <= 0.02) continue;
      const bearing = slot.facing + streak.bearing * slot.halfAngle;
      const sx = Math.sin(bearing);
      const sz = Math.cos(bearing);
      pool.flat(
        slot.x + sx * streak.tail * slot.radius,
        slot.y + streak.lift,
        slot.z + sz * streak.tail * slot.radius,
        slot.x + sx * streak.head * slot.radius,
        slot.y + streak.lift,
        slot.z + sz * streak.head * slot.radius,
        0.07 * streak.opacity,
      );
    }
  }

  private drawGustBlast(burst: Burst): boolean {
    const plan = gustBlast(burst.age);
    const pool = this.ribbons.frost;
    // A white wall spanning the cone, racing from the boss to its far edge.
    const segments = 14;
    const reach = burst.radius * plan.front;
    for (let layer = 0; layer < 3; layer++) {
      const y = burst.y + 0.5 + layer * 1.1;
      const trail = reach * (1 - layer * 0.07);
      for (let segment = 0; segment < segments; segment++) {
        const a = burst.facing - burst.halfAngle + (segment / segments) * burst.halfAngle * 2;
        const b = burst.facing - burst.halfAngle + ((segment + 1) / segments) * burst.halfAngle * 2;
        pool.flat(
          burst.x + Math.sin(a) * trail,
          y,
          burst.z + Math.cos(a) * trail,
          burst.x + Math.sin(b) * trail,
          y,
          burst.z + Math.cos(b) * trail,
          0.3 * plan.opacity,
        );
      }
    }
    return plan.done;
  }

  // -------------------------------------------------------------- Archon Nyxaris

  private drawHorizon(slot: Tracked, progress: number, calm: boolean): void {
    const pool = this.ribbons.arcane;
    const eyeFraction = slot.radius > 0 ? slot.inner / slot.radius : 0.2;
    for (let index = 0; index < HORIZON_STREAKS; index++) {
      const streak = horizonStreak(
        slot.cueId,
        index,
        this.clock,
        progress,
        eyeFraction,
        this.horizon,
      );
      if (streak.opacity <= 0.02) continue;
      // Drawn as a short chain along the spiral, so it CURVES into the eye
      // instead of reading as a straight bar.
      for (let part = 0; part < HORIZON_STREAK_SEGMENTS; part++) {
        const t0 = part / HORIZON_STREAK_SEGMENTS;
        const t1 = (part + 1) / HORIZON_STREAK_SEGMENTS;
        const a0 = streak.angle - HORIZON_STREAK_SWEEP * (1 - t0);
        const a1 = streak.angle - HORIZON_STREAK_SWEEP * (1 - t1);
        const r0 = (streak.tail + (streak.head - streak.tail) * t0) * slot.radius;
        const r1 = (streak.tail + (streak.head - streak.tail) * t1) * slot.radius;
        pool.flat(
          slot.x + Math.sin(a0) * r0,
          slot.y + streak.lift * (1 - t0 * 0.4),
          slot.z + Math.cos(a0) * r0,
          slot.x + Math.sin(a1) * r1,
          slot.y + streak.lift * (1 - t1 * 0.4),
          slot.z + Math.cos(a1) * r1,
          // Thin at the tail, bright at the head: a comet, not a plank.
          0.06 * streak.opacity * (0.35 + 0.65 * t1),
        );
      }
    }
    // The eye: the one calm place, lit so nobody has to guess where to run.
    const eye = horizonEye(progress, this.clock, calm);
    this.place(
      this.rings.take(COLORS.arcane.core, eye.ringOpacity),
      slot.x,
      slot.y + 0.3,
      slot.z,
      slot.inner,
    );
    this.place(
      this.columns.take(COLORS.arcane.halo, eye.columnOpacity),
      slot.x,
      slot.y,
      slot.z,
      slot.inner * 0.96,
      eye.columnHeight,
    );
  }

  private drawHorizonWave(burst: Burst): boolean {
    const eyeFraction = burst.radius > 0 ? burst.inner / burst.radius : 0.2;
    const plan = horizonWave(burst.age, eyeFraction);
    this.place(
      this.rings.take(COLORS.arcane.halo, plan.opacity),
      burst.x,
      burst.y + 0.4,
      burst.z,
      burst.radius * plan.scale,
    );
    this.place(
      this.rings.take(COLORS.arcane.core, plan.opacity * 0.7),
      burst.x,
      burst.y + 0.45,
      burst.z,
      burst.radius * plan.scale * 0.94,
    );
    return plan.done;
  }

  private drawCollapse(slot: Tracked, progress: number): void {
    let core = 0;
    for (let ring = 0; ring < COLLAPSE_RINGS; ring++) {
      const plan = collapseRing(ring, this.clock, progress);
      core = plan.core;
      this.place(
        this.rings.take(COLORS.arcane.glow, plan.opacity),
        slot.x,
        slot.y + 0.3 + ring * 0.04,
        slot.z,
        slot.radius * plan.scale,
      );
    }
    this.place(
      this.discs.take(COLORS.arcane.halo, core),
      slot.x,
      slot.y + 0.24,
      slot.z,
      slot.radius * (0.2 + progress * 0.25),
    );
  }

  private drawCollapseBurst(burst: Burst): boolean {
    const plan = collapseBurst(burst.age);
    const pool = this.ribbons.arcane;
    this.place(
      this.discs.take(COLORS.arcane.core, plan.flash),
      burst.x,
      burst.y + 0.24,
      burst.z,
      burst.radius * (0.5 + plan.ringScale * 0.4),
    );
    this.place(
      this.rings.take(COLORS.arcane.glow, plan.ring),
      burst.x,
      burst.y + 0.3,
      burst.z,
      burst.radius * plan.ringScale,
    );
    this.place(
      this.columns.take(COLORS.arcane.halo, plan.pillar),
      burst.x,
      burst.y,
      burst.z,
      burst.radius * 0.2,
      22,
    );
    if (plan.shards > 0) {
      for (let shard = 0; shard < COLLAPSE_SHARDS; shard++) {
        const angle = (shard / COLLAPSE_SHARDS) * Math.PI * 2 + hoardHash(burst.seed, shard, 1);
        const reach = burst.radius * (0.4 + hoardHash(burst.seed, shard, 2) * 1.1);
        const head = reach * plan.shardReach;
        const tail = head * 0.55;
        const lift = 0.5 + hoardHash(burst.seed, shard, 3) * 5 * plan.shardReach;
        pool.flat(
          burst.x + Math.sin(angle) * tail,
          burst.y + lift * 0.6,
          burst.z + Math.cos(angle) * tail,
          burst.x + Math.sin(angle) * head,
          burst.y + lift,
          burst.z + Math.cos(angle) * head,
          0.12 * plan.shards,
        );
      }
    }
    return plan.done;
  }

  private drawVoidfall(slot: Tracked, progress: number): void {
    const pool = this.ribbons.arcane;
    if (slot.phase === 'hazard') {
      // The pool: slow arms of void turning round the mark.
      const fade = Math.min(1, slot.remaining / 0.6);
      for (let arm = 0; arm < VOIDFALL_SWIRLS; arm++) {
        const points = voidfallSwirl(arm, this.clock, SWIRL_POINTS, this.scratchA);
        for (let point = 0; point < SWIRL_POINTS - 1; point++) {
          pool.flat(
            slot.x + points[point * 2] * slot.radius,
            slot.y + 0.3,
            slot.z + points[point * 2 + 1] * slot.radius,
            slot.x + points[point * 2 + 2] * slot.radius,
            slot.y + 0.3,
            slot.z + points[point * 2 + 3] * slot.radius,
            0.07 * fade * (0.4 + (point / SWIRL_POINTS) * 0.6),
          );
        }
      }
      return;
    }
    const star = voidfallStar(progress);
    const top = slot.y + star.height + star.trail;
    pool.cross(slot.x, top, slot.z, slot.x, slot.y + star.height, slot.z, 0.16 * star.opacity);
    this.place(
      this.discs.take(COLORS.arcane.glow, 0.05 + 0.16 * progress),
      slot.x,
      slot.y + 0.22,
      slot.z,
      slot.radius * (0.25 + 0.45 * progress),
    );
  }

  private drawVoidfallSplash(burst: Burst): boolean {
    const t = Math.min(1, burst.age / VOIDFALL_SPLASH_SEC);
    this.place(
      this.discs.take(COLORS.arcane.core, (1 - t) ** 2),
      burst.x,
      burst.y + 0.24,
      burst.z,
      burst.radius * (0.6 + t * 0.6),
    );
    this.place(
      this.rings.take(COLORS.arcane.halo, (1 - t) * 0.9),
      burst.x,
      burst.y + 0.3,
      burst.z,
      burst.radius * (0.4 + (1 - (1 - t) ** 3) * 1.3),
    );
    this.place(
      this.columns.take(COLORS.arcane.glow, (1 - t) * 0.4),
      burst.x,
      burst.y,
      burst.z,
      burst.radius * 0.3,
      12,
    );
    return burst.age >= VOIDFALL_SPLASH_SEC;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.root.removeFromParent();
    for (const geometry of this.geometries) geometry.dispose();
    for (const material of this.materials) material.dispose();
  }
}
