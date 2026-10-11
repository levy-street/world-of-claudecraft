// Gloamveil's floor and smoke layer: everything a Shadow priest's form draws
// that is NOT on the body. A living shadow pool under the feet with a wake
// behind it, dark smoke curling off the lower body, a faint violet haze, a
// bubble of shadow that bursts every few seconds, and the entry (a column of
// smoke closing over the body while the pool erupts and a ring races out).
//
// One field per renderer, owned by Vfx (which clears and disposes it with its
// own state). The renderer drives it: one `wearer` call per body in the form
// that it presents, then one `update` to close the frame, which carries the
// viewer's reduced-motion setting. The body (the climbing dark, the halo, the
// rim) is characters/gloam_climb.ts and reaches this layer only through the
// cue the `wearer` call carries.
//
// GPU: three programs (the smoke cloud, the pool, the entry ring), on three
// materials built once here. The root holds a hidden stand-in of each floor
// material and is attached through attachSceneGroupGated, at construction and
// again after a context restore, so nothing under it draws until all three are
// linked, and every drawable is tagged 'vfx', so the boot's cast-VFX warm-up
// links them under the loading cover first (ability_vfx/prewarm.ts walks the
// tag). A pool appearing later mints geometry only, and a pool whose wearer is
// gone is kept for the next one (a bounded few), so a camera that turns away
// from a priest and back mints nothing.
//
// What each tier and the reduced-motion setting keep is the pure
// gloam_field_core.ts; where a stain lies is gloam_pool_core.ts.

import * as THREE from 'three';
import {
  GLOAM_CUE_ENTER,
  GLOAM_CUE_HIDDEN,
  GLOAM_CUE_REST,
  type GloamCue,
} from './characters/gloam_climb_core';
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX, sharedUniforms } from './gfx';
import {
  GLOAM_SPARE_POOLS,
  GLOAM_WEARER_LINGER,
  type GloamPlan,
  GloamRoster,
  gloamDistanceScale,
  gloamEmitCount,
  gloamGovernorScale,
  gloamPlan,
  gloamPoolDraped,
} from './gloam_field_core';
import { buildGloamFloorStandIns, createGloamFloorMaterials, GloamPool } from './gloam_pool';
import { GLOAM_POOL_SIZE, GloamDrapeBudget, GloamGround } from './gloam_pool_core';
import { GloamSmoke } from './gloam_smoke';
import type { GloamPuff } from './gloam_smoke_core';
import type { VfxAnchorResolver } from './vfx_anchor';

/** The additive glints that ride over the smoke: an index into the host's sprites. */
const GLINT_GLOW = 0;
const GLINT_FLASH = 1;
const GLINT_SPARKLE = 2;

/** What the field borrows from the shared additive cloud (vfx.ts). */
export interface GloamCloudHost {
  /** Atlas cells of the soft glow, the flash and the sparkle, in that order. */
  readonly sprites: readonly [number, number, number];
  /** Emit one additive particle. */
  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    color: number,
    size: number,
    lifetime: number,
    gravity: number,
    sprite: number,
  ): void;
  /** The cloud's governor level, 0 to 1. */
  quality(): number;
}

/** The renderer's compile gate, absent where nothing links asynchronously. */
export type GloamCompileGate = (target: THREE.Object3D) => Promise<unknown>;

/** The floor's height at a spot. A sampler whose ground can be swapped under
 *  the same coordinates (rift_ground_sample.ts) says so through `epoch`. */
export type GloamGroundSampler = ((x: number, z: number) => number) & {
  epoch?: () => number;
};

/** Smoke puffs and haze motes a second off one body, at full strength. */
const SMOKE_RATE = 9;
const HAZE_RATE = 5;
/** Seconds between bubbles, on average. */
const BUBBLE_SECONDS = 2.5;
/** The body anchor sits this far above the feet the smoke pools around. */
const ANCHOR_FRACTION = 0.45;
/** The tendril clock under reduced motion: one still shape. */
const STILL_CLOCK = 0;

/** One wearer in view. */
class Wearer {
  pool: GloamPool | null = null;
  reported = false;
  entering = false;
  settled = true;
  d2 = 0;
  /** The body anchor and the feet, as last reported. */
  x = 0;
  y = 0;
  z = 0;
  feetY = 0;
}

const TAU = Math.PI * 2;

export class GloamField {
  private readonly root = new THREE.Group();
  private readonly smoke = new GloamSmoke();
  private readonly materials = createGloamFloorMaterials();
  private readonly standIns: THREE.Mesh[];
  private readonly roster = new GloamRoster<Wearer>();
  private readonly budget = new GloamDrapeBudget();
  /** The floor as the pools have learned it, on the grid of the tier's pool. */
  private ground = new GloamGround(GLOAM_POOL_SIZE);
  private groundEpoch = 0;
  private readonly at = new THREE.Vector3();
  /** One reused description: emitting a puff allocates nothing. */
  private readonly puff: GloamPuff = {
    x: 0,
    y: 0,
    z: 0,
    vx: 0,
    vy: 0,
    vz: 0,
    size: 0,
    grow: 1,
    life: 0,
    peak: 0,
    tint: 0,
    rot: 0,
    spin: 0,
  };
  private clock = 0;
  private turn = 0;
  /** Parked pools waiting for a wearer, at most GLOAM_SPARE_POOLS. */
  private readonly spares: GloamPool[] = [];
  private disposed = false;
  private readonly makeWearer = (): Wearer => new Wearer();
  private readonly releaseWearer = (wearer: Wearer): void => {
    const pool = wearer.pool;
    wearer.pool = null;
    if (!pool) return;
    pool.park();
    if (this.spares.length < GLOAM_SPARE_POOLS) this.spares.push(pool);
    else pool.dispose();
  };

  /**
   * `anchor` resolves a wearer's displayed pose, `cloud` is the shared additive
   * cloud the glints are emitted into, `groundY` is the renderer's seed-bound
   * ground sampler (its `epoch`, when it has one, says the ground was swapped
   * and the remembered floor is forgotten), and `compileGate` holds the layer
   * hidden until its programs are linked.
   */
  constructor(
    private readonly scene: THREE.Scene,
    private readonly anchor: VfxAnchorResolver,
    private readonly cloud: GloamCloudHost,
    private readonly groundY: GloamGroundSampler,
    private readonly compileGate?: GloamCompileGate,
  ) {
    this.root.name = 'gloam_field';
    this.root.add(this.smoke.points);
    this.standIns = buildGloamFloorStandIns(this.materials);
    for (const mesh of this.standIns) this.root.add(mesh);
    this.attach();
  }

  /** Into the scene behind the compile gate: hidden until the three programs
   *  are linked, revealed by the gate, its failure, or the attach watchdog. */
  private attach(): void {
    attachSceneGroupGated(this.scene, this.root, this.compileGate, () => this.disposed).catch(
      () => {
        // Cancelled by dispose while its link was pending: nothing to reveal.
      },
    );
  }

  /**
   * The WebGL context came back. Three rebuilds buffers and programs on its
   * own, but the three programs here are gone with the old context, so the
   * layer goes back behind its gate until they are linked again instead of
   * linking them in the first frame that draws a pool. It goes through the
   * same gated attach as at construction, so a gate that never settles is
   * revealed by the watchdog and leaves an event. The parked pools are let go:
   * nothing of theirs survived the context. The field holds no texture and no
   * render target, so there is nothing else to restore.
   */
  onContextRestored(): void {
    if (this.disposed) return;
    this.dropSpares();
    if (this.compileGate) this.attach();
  }

  private dropSpares(): void {
    for (const pool of this.spares) pool.dispose();
    this.spares.length = 0;
  }

  /** A pool for a new wearer on a `cells` grid: a parked one when it fits. */
  private takePool(cells: number): GloamPool {
    while (this.spares.length > 0) {
      const pool = this.spares.pop() as GloamPool;
      if (pool.cells === cells) {
        pool.revive();
        return pool;
      }
      // Parked on another tier's grid: the preset changed since.
      pool.dispose();
    }
    return new GloamPool(this.root, this.materials, cells);
  }

  /** Same projection scale the additive cloud uses, so puff sizes agree. */
  setViewportScale(scale: number): void {
    this.smoke.setViewportScale(scale);
  }

  /**
   * One wearer presented this frame (the entity loop calls this once per body
   * in the form that it draws). `cue` comes from the rig (hidden under a ghost
   * or stealth body, entering on the frame the shift is seen, resting in
   * water), `settled` is false in the air and in water, `d2` is the squared
   * distance to the viewer, and `feetY` is where the body touches what it
   * stands on (the mount's hooves for a rider, never the saddle).
   */
  wearer(id: number, cue: GloamCue, settled: boolean, d2: number, feetY: number): void {
    if (this.disposed) return;
    if (cue === GLOAM_CUE_HIDDEN) {
      // Nothing may mark a ghosted or stealthed body: gone at once, no fade.
      this.roster.drop(id, this.releaseWearer);
      return;
    }
    // Resting: nothing is reported, so the pool fades where it lay and the
    // wearer is forgotten after the linger, like a form that ended.
    if (cue === GLOAM_CUE_REST) return;
    const at = this.anchor(id, ANCHOR_FRACTION, this.at);
    if (!at) return;
    const wearer = this.admit(id, d2);
    if (!wearer) return;
    wearer.x = at.x;
    wearer.y = at.y;
    wearer.z = at.z;
    wearer.feetY = feetY;
    wearer.reported = true;
    wearer.settled = settled;
    wearer.d2 = d2;
    if (cue === GLOAM_CUE_ENTER) wearer.entering = true;
  }

  /** The tracked wearer `id`, admitted if there is room. When the roster is
   *  full the nearest keep their place: a newcomer closer than the farthest
   *  tracked wearer takes it (that one's pool is a few pixels across). */
  private admit(id: number, d2: number): Wearer | undefined {
    const wearer = this.roster.touch(id, this.clock, this.makeWearer);
    if (wearer) return wearer;
    let far = -1;
    for (let i = 0; i < this.roster.size; i++) {
      if (far < 0 || this.roster.at(i).d2 > this.roster.at(far).d2) far = i;
    }
    if (far < 0 || !(this.roster.at(far).d2 > d2)) return undefined;
    this.roster.drop(this.roster.idAt(far), this.releaseWearer);
    return this.roster.touch(id, this.clock, this.makeWearer);
  }

  /**
   * Once a frame, after every wearer was reported. `reducedMotion` is the
   * viewer's setting, passed by the renderer and never inferred from who
   * reported: a pool fading out after its wearer stopped reporting stays as
   * still as it was.
   */
  update(dt: number, reducedMotion: boolean): void {
    if (this.disposed) return;
    this.clock += dt;
    const plan = gloamPlan(GFX.effectsTier, reducedMotion);
    this.materials.clock.value = plan.living ? sharedUniforms.uTime.value : STILL_CLOCK;
    // The floor is remembered on the pool's own grid: another tier, another grid.
    const cell = GLOAM_POOL_SIZE / plan.poolCells;
    if (this.ground.cell !== cell) this.ground = new GloamGround(cell);
    // Another Rift floor (or leaving one) lifts the same spot to another height.
    const epoch = this.groundY.epoch?.() ?? 0;
    if (epoch !== this.groundEpoch) {
      this.groundEpoch = epoch;
      this.ground.clear();
      for (let i = 0; i < this.roster.size; i++) this.roster.at(i).pool?.forgetLay();
    }
    this.budget.refill();
    // Whoever was served first last frame goes last this one, so a crowd of
    // moving pools shares the ground-sample allowance instead of starving its tail.
    const size = this.roster.size;
    this.turn = size > 0 ? (this.turn + 1) % size : 0;
    for (let k = 0; k < size; k++) this.step(this.roster.at((this.turn + k) % size), dt, plan);
    this.roster.sweep(this.clock, GLOAM_WEARER_LINGER, this.releaseWearer);
    this.smoke.update(dt);
    this.smoke.points.visible = this.smoke.count > 0;
  }

  private step(wearer: Wearer, dt: number, plan: GloamPlan): void {
    if (wearer.reported) {
      wearer.reported = false;
      // A pool laid for another tier's grid (the preset changed): replaced.
      if (wearer.pool && wearer.pool.cells !== plan.poolCells) {
        wearer.pool.dispose();
        wearer.pool = null;
      }
      wearer.pool ??= this.takePool(plan.poolCells);
      if (wearer.entering) {
        wearer.entering = false;
        if (plan.entry > 0) {
          wearer.pool.enter(plan.ring);
          this.emitEntry(wearer, plan);
        }
      }
      wearer.pool.follow(
        wearer.x,
        wearer.feetY,
        wearer.z,
        wearer.settled,
        gloamPoolDraped(wearer.d2),
        plan.wakeStains,
        this.ground,
        this.groundY,
        this.budget,
      );
      this.emitAmbient(wearer, dt, plan);
    }
    wearer.pool?.animate(dt);
  }

  private glint(
    sprite: number,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    color: number,
    size: number,
    lifetime: number,
    gravity: number,
  ): void {
    const cell = this.cloud.sprites[sprite];
    this.cloud.spawn(x, y, z, vx, vy, vz, color, size, lifetime, gravity, cell);
  }

  private emitPuff(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    size: number,
    grow: number,
    life: number,
    peak: number,
    tint: number,
  ): void {
    const puff = this.puff;
    puff.x = x;
    puff.y = y;
    puff.z = z;
    puff.vx = vx;
    puff.vy = vy;
    puff.vz = vz;
    puff.size = size;
    puff.grow = grow;
    puff.life = life;
    puff.peak = peak;
    puff.tint = tint;
    puff.rot = Math.random() * TAU;
    puff.spin = (Math.random() - 0.5) * 0.9;
    this.smoke.puff(puff);
  }

  /** The smoke off the body, the haze close to it, and now and then a bubble. */
  private emitAmbient(wearer: Wearer, dt: number, plan: GloamPlan): void {
    if (plan.smoke <= 0) return;
    const { x, y, z } = wearer;
    const near = gloamDistanceScale(wearer.d2);
    const scale = near * gloamGovernorScale(this.cloud.quality());
    const smoke = gloamEmitCount(SMOKE_RATE * plan.smoke * scale, dt, Math.random());
    for (let k = 0; k < smoke; k++) {
      const a = Math.random() * TAU;
      const r = 0.18 + Math.random() * 0.26;
      this.emitPuff(
        x + Math.sin(a) * r,
        // low on the body: the smoke pools where the dark is
        y - 1.05 + Math.random() * Math.random() * 1.5,
        z + Math.cos(a) * r,
        -Math.cos(a) * 0.2,
        0.3 + Math.random() * 0.4,
        Math.sin(a) * 0.2,
        0.45 + Math.random() * 0.25,
        2.2,
        1.5 + Math.random() * 0.9,
        0.42 + Math.random() * 0.2,
        Math.random() < 0.25 ? 0.6 : 0,
      );
    }
    if (plan.haze) {
      const haze = gloamEmitCount(HAZE_RATE * scale, dt, Math.random());
      for (let k = 0; k < haze; k++) {
        const a = Math.random() * TAU;
        const r = 0.12 + Math.random() * 0.2;
        this.glint(
          GLINT_GLOW,
          x + Math.sin(a) * r,
          y - 1.0 + Math.random() * 1.1,
          z + Math.cos(a) * r,
          0,
          0.12 + Math.random() * 0.15,
          0,
          0x22113f,
          0.8,
          0.9 + Math.random() * 0.4,
          -0.1,
        );
      }
    }
    // The bubble: about one every 2.5 seconds, frame-rate independent, and
    // only where the pool is still draped (close enough to read).
    if (!plan.bubbles || !gloamPoolDraped(wearer.d2)) return;
    if (Math.random() >= (dt / BUBBLE_SECONDS) * near) return;
    const ba = Math.random() * TAU;
    const br = 0.3 + Math.random() * 0.1;
    const bx = x + Math.sin(ba) * br;
    const by = y - 0.85 + Math.random() * 1.15;
    const bz = z + Math.cos(ba) * br;
    // the bubble itself: one dense blob that swells and thins
    this.emitPuff(bx, by, bz, 0, 0.2, 0, 0.35, 3.4, 0.9, 0.95, 0.3);
    this.glint(GLINT_GLOW, bx, by, bz, 0, 0.2, 0, 0x4a2890, 0.9, 0.45, 0);
    const puffs = 7 + Math.floor(Math.random() * 4);
    for (let k = 0; k < puffs; k++) {
      const a = ba + (Math.random() - 0.5) * 2.4;
      const speed = 0.5 + Math.random() * 0.8;
      this.emitPuff(
        bx,
        by,
        bz,
        Math.sin(a) * speed,
        0.5 + Math.random() * 0.9,
        Math.cos(a) * speed,
        0.3 + Math.random() * 0.2,
        2.6,
        1.1 + Math.random() * 0.7,
        0.6 + Math.random() * 0.25,
        k % 3 === 0 ? 0.8 : 0.1,
      );
    }
    if (!plan.sparkles) return;
    for (let k = 0; k < 4; k++) {
      const a = ba + (Math.random() - 0.5) * 2.4;
      this.glint(
        GLINT_SPARKLE,
        bx,
        by,
        bz,
        Math.sin(a) * 0.7,
        0.7 + Math.random() * 0.8,
        Math.cos(a) * 0.7,
        0xa070ff,
        0.2,
        0.7 + Math.random() * 0.4,
        -0.3,
      );
    }
  }

  // Entering Gloamveil: a column of darkness closes over the body, a skirt of
  // smoke rolls out along the ground and a burst of violet light breaks through
  // it. One shot, on the frame the shift is seen.
  private emitEntry(wearer: Wearer, plan: GloamPlan): void {
    const { x, y, z } = wearer;
    const feet = y - 1.1;
    const column = Math.round(46 * plan.entry);
    for (let k = 0; k < column; k++) {
      const a = Math.random() * TAU;
      const r = 0.15 + Math.random() * 0.4;
      this.emitPuff(
        x + Math.sin(a) * r,
        feet + Math.random() * 2.6,
        z + Math.cos(a) * r,
        Math.sin(a) * 0.35,
        1.6 + Math.random() * 2.4,
        Math.cos(a) * 0.35,
        0.7 + Math.random() * 0.4,
        2.4,
        0.8 + Math.random() * 0.5,
        0.8 + Math.random() * 0.15,
        k % 4 === 0 ? 0.7 : 0.1,
      );
    }
    const skirt = Math.round(20 * plan.entry);
    for (let k = 0; k < skirt; k++) {
      const a = (k / skirt) * TAU + Math.random() * 0.3;
      const speed = 2.6 + Math.random() * 2.2;
      this.emitPuff(
        x + Math.sin(a) * 0.3,
        feet + 0.15,
        z + Math.cos(a) * 0.3,
        Math.sin(a) * speed,
        0.25 + Math.random() * 0.3,
        Math.cos(a) * speed,
        0.55,
        3,
        0.7 + Math.random() * 0.4,
        0.7,
        0.3,
      );
    }
    this.glint(GLINT_GLOW, x, y, z, 0, 0.4, 0, 0x7a3df0, 3.4, 0.38, 0);
    this.glint(GLINT_FLASH, x, y + 0.5, z, 0, 0.8, 0, 0xb48cff, 1.6, 0.25, 0);
    if (!plan.sparkles) return;
    for (let k = 0; k < 28; k++) {
      const a = Math.random() * TAU;
      const speed = 1.8 + Math.random() * 3.4;
      this.glint(
        GLINT_SPARKLE,
        x,
        feet + 0.4 + Math.random() * 1.6,
        z,
        Math.sin(a) * speed,
        0.6 + Math.random() * 2.6,
        Math.cos(a) * speed,
        k % 3 === 0 ? 0xd9c2ff : 0x9a5df0,
        0.2 + Math.random() * 0.12,
        0.6 + Math.random() * 0.5,
        0.9,
      );
    }
  }

  /** Wearers tracked, stains they hold, pools parked, puffs alive, floor nodes
   *  remembered and what is left of this frame's ground samples. Read by the
   *  tests, and from the page by whoever measures the layer; it is not part of
   *  the `?perf` readout. */
  stats(): {
    wearers: number;
    stains: number;
    spares: number;
    puffs: number;
    groundNodes: number;
    samplesLeft: number;
  } {
    let stains = 0;
    for (let i = 0; i < this.roster.size; i++) stains += this.roster.at(i).pool?.stainCount ?? 0;
    return {
      wearers: this.roster.size,
      stains,
      spares: this.spares.length,
      puffs: this.smoke.count,
      groundNodes: this.ground.size,
      samplesLeft: this.budget.remaining,
    };
  }

  /** Drop every wearer and every puff (a zone change, a renderer reset). The
   *  parked pools stay: they are bounded, and the next zone has priests too. */
  clear(): void {
    this.roster.clear(this.releaseWearer);
    this.smoke.clear();
    this.ground.clear();
  }

  /** Terminal: the field owns its three materials and every geometry it made,
   *  in the scene or parked. */
  dispose(): void {
    if (this.disposed) return;
    this.clear();
    this.dropSpares();
    this.disposed = true;
    this.root.removeFromParent();
    for (const mesh of this.standIns) mesh.geometry.dispose();
    this.smoke.dispose();
    this.materials.pool.dispose();
    this.materials.ring.dispose();
  }
}
