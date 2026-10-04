// A heavy cannon shot, drawn: at the muzzle a yellow-orange flash, a flame
// tongue and a grey-brown smoke puff, with the barrel's recoil; a dark iron
// shell in a hot orange glow on its arc, shedding grey smoke and warm sparks;
// at the blast a white-yellow flash, a fireball that cools into rising smoke, a
// brown-grey dust cloud that lingers, a beige ring of dust rolling out along the
// ground, dark dirt clods and tumbling chunks thrown 3 to 5 yd up, hot sparks,
// and a dark scorch draped on the ground that fades over its life; the camera
// shakes by distance. Neutral: the caller passes the blast radius and feeds fire
// and impact events; the curves are cannon_shell_core.ts and cannon_puff_core.ts.
// A caller's own shot may fly before its event (launchOwn): the event adopts the
// shell (adoptOwn), or a refused launch shrinks away with no blast. A
// fragmentation shell fizzes with sparks on its way, bursts in the air (scatter)
// and its bomblets fly to their points on the same instanced shell draw, each
// landing into a small blast with no dust cloud (cannon_frag_core.ts); a slam
// lays a pale cracked mark in the scorch's own draw (markGround,
// cannon_ground_mark_core.ts).
//
// GPU rules (src/render/CLAUDE.md "GPU work"): nothing is built until
// `prepare`, which allocates the shot pools, mints every mesh, named material
// and texture the shot will ever draw and attaches the root behind the compile
// gate, hidden until its programs link; while it is hidden, the renderer's
// boot-prewarmed particles stand in at the muzzle and the blast, beside the
// thrown monsters themselves. The texels of the puff atlas and the scorch are
// built once per page, and with a `texelSlot` in that idle slot rather than on
// the commitment frame (the stand-in holds until they land). Four draws on
// shared materials: the shells and the chunks are instanced, the scorches one
// draped mesh (their fade rides its vertex colours on a subtractive blend),
// every puff one instanced billboard (cannon_puff_mesh.ts); no per-use clone,
// no light, no shadow, and a frame allocates nothing.
//
// Draw order inside the puff draw: far to near by source (the blasts, the
// contact bursts, the shells' wakes, then the muzzle nearest the camera), and
// within each source the dust behind, then smoke and dirt, then light, so a far
// blast's dust never paints over the near muzzle smoke.
//
// Tiers: the low static preset sheds cosmetic counts only (chunks, dirt, dust,
// sparks, smoke), each shed puff's opacity carried by the ones left
// (cannonTierAlpha), so the dust hides no more and no less of a monster on any
// preset; the shell and its wake, the flash, the fireball and the shock ring
// (which draws the blast radius) are the same on every tier. Reduced motion
// drops the camera shake and the FOV punch.
//
// A caller may also launch its own puffs on the same draw (puffBurst: a pooled
// burst, cannon_puff_burst_core.ts, sized at construction), such as the dust a
// thrown monster kicks up, so it never needs a material of its own.
import * as THREE from 'three';
import { resolveUiEffectsProfile } from '../game/ui_effects_profile';
import { BufferUpdateRange } from './buffer_update_range';
import { timeBuildSpan } from './build_spans';
import {
  CANNON_BOMBLET,
  CannonBomblets,
  cannonAirburstCounts,
  cannonBombletKey,
} from './cannon_frag_core';
import {
  CANNON_GROUND_MARK,
  cannonCrackTexels,
  cannonGroundMarkFade,
} from './cannon_ground_mark_core';
import { type CannonPuffBurst, CannonPuffBursts } from './cannon_puff_burst_core';
import {
  CANNON_PUFF_KINDS,
  CANNON_PUFF_LAYERS,
  type CannonPuff,
  type CannonPuffFrame,
  cannonBlastPower,
  cannonPuffAtlasTexels,
  cannonPuffInto,
  cannonPuffLightInto,
  cannonShellGlowInto,
  newCannonPuff,
  newCannonPuffFrame,
} from './cannon_puff_core';
import { CANNON_PUFF_ATLAS_CELL, CannonPuffMesh } from './cannon_puff_mesh';
import {
  CANNON_BLAST,
  CANNON_BLAST_PUFFS,
  CANNON_CHUNKS_PER_IMPACT,
  CANNON_IMPACT_POOL,
  CANNON_MUZZLE,
  CANNON_MUZZLE_POOL,
  CANNON_MUZZLE_PUFFS,
  CANNON_SCORCH_GRID,
  CANNON_SCORCH_LAYERS,
  CANNON_SCORCH_POOL,
  CANNON_SCORCH_VERTS,
  CANNON_SHELL,
  CANNON_SHELL_POOL,
  CANNON_TRAIL_PUFFS,
  type CannonChunkFrame,
  type CannonFiredShot,
  type CannonImpactShot,
  type CannonPoint,
  type CannonScorchSlot,
  type CannonShotCounts,
  CannonShotTimeline,
  cannonChunkInto,
  cannonRecoilOffset,
  cannonScorchDrapeInto,
  cannonScorchFade,
  cannonScorchTexels,
  cannonShakeFalloff,
  cannonShotCounts,
} from './cannon_shell_core';
import { floorVfxRenderOrder } from './floor_vfx_layer';
import { attachSceneGroupGated } from './gated_scene_attach';
import { GFX, type GfxTier } from './gfx';
import { tagVfxSubtree } from './renderer_diagnostics';
import type { Vfx } from './vfx';

/** The renderer services a shot draws with. */
export interface CannonShellHost {
  /** The boot-prewarmed particle cloud: the stand-in while the weapon's gate is pending. */
  readonly vfx: Pick<Vfx, 'burst'>;
  readonly camera: THREE.Camera;
  addShake(amount: number): void;
  punchFov(degrees: number): void;
}

/** A blast event, with the bodies it struck when the caller has them (a core hit reads bigger). */
export interface CannonBlast extends CannonImpactShot {
  readonly hits?: readonly { readonly falloff: number }[];
  /** A charge of its own (a barrel's): the ring's reach and the scorch; the shell's radius when absent. */
  readonly radius?: number;
  /** How much bigger than a shell's the whole blast reads, shake included; 1 when absent. */
  readonly scale?: number;
  /** False: no lingering dust cloud (a bomblet's, so six of them never stack past the smoke cap). */
  readonly cloud?: boolean;
}

/** A fragmentation shell's burst over its point, and where and when each bomblet lands. */
export interface CannonFragBurst {
  readonly shotId: number;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly bomblets: readonly {
    readonly index: number;
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly landTick: number;
  }[];
}

export interface CannonShellOptions {
  blastRadius: number;
  groundAt: (x: number, z: number) => number;
  compileGate?: (target: THREE.Object3D) => Promise<unknown>;
  /** The static graphics preset (never the frame governor). */
  effectsTier?: GfxTier;
  /** Pooled bursts callers launch their own puffs into (puffBurst); none by default. */
  bursts?: { readonly slots: number; readonly puffs: number };
  /** Blasts on the ground at once (a chain of charges adds its own); CANNON_IMPACT_POOL by default. */
  impacts?: number;
  /** Bomblets in flight at once (fragmentation shells); none by default. */
  bomblets?: number;
  /**
   * Resolves when the page's texels may be built (an idle slot): until then the
   * atlas and the scorch are clear and the boot particles stand in. Without it,
   * or once any weapon built them, they are ready at `prepare`.
   */
  texelSlot?: () => Promise<unknown>;
  /**
   * Ticks a shell whose flight is over waits at its blast point for its impact,
   * for a display tick that runs ahead of the clock bringing it; none by default.
   */
  holdTicks?: number;
}

/** The shot's CPU pools: allocated at `prepare`, never for a player who is never seated. */
interface Pools {
  readonly timeline: CannonShotTimeline;
  readonly trailPuffs: CannonPuff[];
  readonly trailAges: Float32Array;
  readonly bursts: CannonPuffBursts;
  readonly bomblets: CannonBomblets;
  readonly frames: CannonPuffFrame[];
}

interface ShotTexels {
  readonly atlas: Uint8Array;
  readonly scorch: Uint8Array;
}

interface Parts {
  readonly geometries: THREE.BufferGeometry[];
  readonly materials: THREE.Material[];
  readonly scorchTexture: THREE.DataTexture;
  readonly shells: THREE.InstancedMesh;
  readonly chunks: THREE.InstancedMesh;
  readonly scorch: THREE.Mesh;
  readonly scorchPosition: THREE.BufferAttribute;
  readonly scorchColor: THREE.BufferAttribute;
  readonly scorchPositionUpload: BufferUpdateRange;
  readonly scorchColorUpload: BufferUpdateRange;
  readonly chunkUpload: BufferUpdateRange;
  readonly puffs: CannonPuffMesh;
}

const SCORCH_TEXELS = 64;
/** The scorch texture's cells side by side: the char, then the cracked mark. */
const SCORCH_CELLS = 2;
/** The draped slots: the scorch pool's, then the ground mark's. */
const MARK_SLOT = CANNON_SCORCH_POOL;
const DRAPED_SLOTS = CANNON_SCORCH_POOL + 1;
const IRON = 0x2b2622;
const SOIL_DARK = new THREE.Color(0x3a2a1c);
const SOIL_LIGHT = new THREE.Color(0x6e5a42);
const SOIL_GRASS = new THREE.Color(0x4d5a2c);
const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
const BLACK = { r: 0, g: 0, b: 0 };
const FORWARD = new THREE.Vector3(0, 0, 1);
const SHOT_PUFF_CAPACITY =
  CANNON_SHELL_POOL * (CANNON_TRAIL_PUFFS + 1) + CANNON_MUZZLE_POOL * CANNON_MUZZLE_PUFFS;
/** Floats of one draped layer (xyz or rgb per vertex) and of one scorch's slice. */
const LAYER_FLOATS = CANNON_SCORCH_VERTS * 3;
const SCORCH_FLOATS = LAYER_FLOATS * CANNON_SCORCH_LAYERS.length;

/** Puff sources in draw order, far to near (see the header). */
const GROUPS = 4;

const materialName = (role: string): string => `cannonShell:${role}`;

let pageTexels: ShotTexels | null = null;

/** The atlas and scorch texels, built once per page (filed in the build ledger). */
function shotTexels(): ShotTexels {
  pageTexels ??= timeBuildSpan('zone:cannon-texels', () => ({
    atlas: cannonPuffAtlasTexels(CANNON_PUFF_ATLAS_CELL),
    scorch: scorchAtlas(cannonScorchTexels(SCORCH_TEXELS), cannonCrackTexels(SCORCH_TEXELS)),
  }));
  return pageTexels;
}

/** The char and the cracked mark, row by row side by side in one texture. */
function scorchAtlas(char: Uint8Array, crack: Uint8Array): Uint8Array {
  const row = SCORCH_TEXELS * 4;
  const out = new Uint8Array(row * SCORCH_CELLS * SCORCH_TEXELS);
  for (let j = 0; j < SCORCH_TEXELS; j++) {
    out.set(char.subarray(j * row, (j + 1) * row), j * row * SCORCH_CELLS);
    out.set(crack.subarray(j * row, (j + 1) * row), j * row * SCORCH_CELLS + row);
  }
  return out;
}

/** Forgets the page's texels, so a test can watch a cold build. */
export function resetCannonShotTexelsForTest(): void {
  pageTexels = null;
}

export class CannonShellVisuals {
  readonly root = new THREE.Group();
  private readonly counts: Readonly<CannonShotCounts>;
  private readonly blastRadius: number;
  private readonly groundAt: (x: number, z: number) => number;
  private readonly compileGate?: (target: THREE.Object3D) => Promise<unknown>;
  private readonly texelSlot?: () => Promise<unknown>;
  private readonly burstSlots: number;
  private readonly burstPuffs: number;
  private readonly impactPool: number;
  private readonly bombletSlots: number;
  private readonly holdTicks: number;
  private host: CannonShellHost | null = null;
  private pools: Pools | null = null;
  private parts: Parts | null = null;
  private texelsReady = false;
  private disposed = false;
  private barrel: THREE.Object3D | null = null;
  private barrelKicked = false;
  private barrelKick = 1;
  private readonly barrelRest = new THREE.Vector3();
  private readonly barrelAxis = new THREE.Vector3(0, 0, 1);
  private readonly barrelTip = new THREE.Vector3();
  private readonly muzzle = new THREE.Vector3();
  private readonly muzzleDir = new THREE.Vector3(0, 0, 1);
  private readonly point: CannonPoint = { x: 0, y: 0, z: 0 };
  private readonly dir: CannonPoint = { x: 0, y: 0, z: 1 };
  private readonly chunkFrame: CannonChunkFrame = { x: 0, y: 0, z: 0, angle: 0, scale: 0 };
  private readonly puffCapacity: number;
  private frameCount = 0;
  /** Where each source's puffs end in `frames` this frame (GROUPS, far to near). */
  private readonly groupEnds = new Int32Array(GROUPS);
  private readonly low: boolean;
  private readonly byKind = new Int32Array(CANNON_PUFF_KINDS);
  private readonly liveScorches: boolean[] = new Array(DRAPED_SLOTS).fill(false);
  private readonly scorchFades = new Float32Array(DRAPED_SLOTS);
  private readonly cloudless: Readonly<CannonShotCounts>;
  private readonly airburstCounts: ReturnType<typeof cannonAirburstCounts>;
  private readonly liveChunks: boolean[];
  private readonly matrix = new THREE.Matrix4();
  private readonly quat = new THREE.Quaternion();
  private readonly euler = new THREE.Euler();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly axis = new THREE.Vector3();
  private readonly color = new THREE.Color();
  private readonly at = new THREE.Vector3();
  private readonly light = { r: 1, g: 1, b: 1 };
  private hemi: THREE.HemisphereLight | null = null;
  private sun: THREE.DirectionalLight | null = null;
  private lightsSought = false;

  constructor(options: CannonShellOptions) {
    this.blastRadius = options.blastRadius;
    this.groundAt = options.groundAt;
    this.compileGate = options.compileGate;
    this.texelSlot = options.texelSlot;
    const profile = resolveUiEffectsProfile({
      presetLabel: options.effectsTier ?? GFX.tier,
      effectsQuality: 1,
      reduceMotion: false,
    });
    this.low = profile.tier === 'low';
    this.counts = cannonShotCounts(this.low);
    this.cloudless = { ...this.counts, dust: 0 };
    this.airburstCounts = cannonAirburstCounts(this.low);
    this.burstSlots = Math.max(0, options.bursts?.slots ?? 0);
    this.burstPuffs = Math.max(0, options.bursts?.puffs ?? 0);
    this.impactPool = Math.max(1, Math.floor(options.impacts ?? CANNON_IMPACT_POOL));
    this.holdTicks = Math.max(0, options.holdTicks ?? 0);
    this.bombletSlots = Math.max(0, Math.floor(options.bomblets ?? 0));
    this.liveChunks = new Array(this.impactPool).fill(false);
    this.puffCapacity =
      SHOT_PUFF_CAPACITY +
      this.impactPool * CANNON_BLAST_PUFFS +
      this.burstSlots * this.burstPuffs +
      this.bombletSlots * CANNON_BOMBLET.motes;
    this.root.name = 'fire-and-fly-weapon';
  }

  /** The static preset is the low one: callers shed their cosmetic counts too. */
  get lowEffects(): boolean {
    return this.low;
  }

  /** `prepare` ran: the pools and the pieces exist (the texels may still be on their way). */
  get prepared(): boolean {
    return this.pools !== null;
  }

  get hasBarrel(): boolean {
    return this.barrel !== null;
  }

  /** Puffs of `kind` (cannon_puff_core.ts PUFF) the last frame drew. */
  drawnPuffs(kind: number): number {
    return this.byKind[kind] ?? 0;
  }

  setHost(host: CannonShellHost | null): void {
    this.host = host;
  }

  /**
   * A pooled burst for the caller's own puffs, seen at frame seconds `now`:
   * launch into its `puffs`, then set `count`, `life` and, for an event seen
   * late, an earlier `at`. Null before `prepare`, after `dispose`, or without
   * a burst pool.
   */
  puffBurst(now: number): CannonPuffBurst | null {
    if (!this.parts || !this.pools || this.disposed) return null;
    return this.pools.bursts.take(now);
  }

  /**
   * The barrel the muzzle and the recoil follow: `tip` is its muzzle point in
   * the node's own space, and it kicks back along its local +z as it points on
   * the frame (its owner may pitch it), by `kick` of its parent's units at the
   * full kick. Null falls back to the muzzle point each shot supplies. The
   * previous barrel is set back to rest.
   */
  setBarrel(
    node: THREE.Object3D | null,
    tip: CannonPoint,
    kick: number = CANNON_MUZZLE.recoilKick,
  ): void {
    if (node === this.barrel) return;
    this.restBarrel();
    this.barrel = node;
    if (!node) return;
    this.barrelRest.copy(node.position);
    this.barrelTip.set(tip.x, tip.y, tip.z);
    this.barrelKick = kick / CANNON_MUZZLE.recoilKick;
  }

  /**
   * Allocates the pools, mints every piece and attaches the root under `parent`
   * behind the compile gate; the texels land now or in the texel slot.
   */
  prepare(parent: THREE.Object3D): void {
    if (this.pools || this.disposed) return;
    this.pools = {
      timeline: new CannonShotTimeline(this.impactPool, this.holdTicks),
      trailPuffs: Array.from({ length: CANNON_TRAIL_PUFFS }, newCannonPuff),
      trailAges: new Float32Array(CANNON_TRAIL_PUFFS),
      bursts: new CannonPuffBursts(this.burstSlots, this.burstPuffs),
      bomblets: new CannonBomblets(this.bombletSlots, this.holdTicks),
      frames: Array.from({ length: this.puffCapacity }, newCannonPuffFrame),
    };
    const ready = pageTexels ?? (this.texelSlot ? null : shotTexels());
    this.parts = this.build(ready);
    this.texelsReady = ready !== null;
    tagVfxSubtree(this.root);
    void attachSceneGroupGated(parent, this.root, this.compileGate, () => this.disposed).catch(
      () => {},
    );
    const slot = this.texelSlot;
    if (!this.texelsReady && slot) {
      const land = (): void => this.landTexels();
      slot().then(land, land);
    }
  }

  /**
   * A shell leaves the barrel (or `fallback` when there is none) toward the blast
   * point. Without its `report` (an own shot's report already played on the
   * click) it flies with no muzzle, no recoil and no camera kick.
   */
  fire(
    shot: CannonFiredShot,
    fallback: CannonPoint,
    time: number,
    reducedMotion: boolean,
    report = true,
  ): void {
    if (this.disposed) return;
    this.aimMuzzle(fallback, shot.x, shot.z);
    this.pools?.timeline.fired(shot, this.point, this.dir, time, this.counts.smoke, report);
    if (report) this.kick(reducedMotion);
  }

  /**
   * The caller's own shot, ahead of its event: the muzzle, the recoil and a shell
   * toward `target` on a predicted flight from `firedTick` to `impactTick` (display
   * ticks). `adoptOwn` hands it the event's flight; a launch the caller's `refused`
   * names (update) shrinks away instead, with no blast. A fragmentation shell's
   * (`fizz`) wake fizzes from the muzzle.
   */
  launchOwn(
    serial: number,
    target: CannonPoint,
    firedTick: number,
    impactTick: number,
    fallback: CannonPoint,
    time: number,
    reducedMotion: boolean,
    fizz = false,
  ): void {
    if (this.disposed) return;
    this.aimMuzzle(fallback, target.x, target.z);
    this.pools?.timeline.launchOwn(
      serial,
      target,
      firedTick,
      impactTick,
      this.point,
      this.dir,
      time,
      this.counts.smoke,
      fizz,
    );
    this.kick(reducedMotion);
  }

  /**
   * The event of own launch `serial`, seen at display `tick`: its shell keeps
   * flying and lands on the event's impact tick at the event's point. False when
   * no shell of that launch still flies (the caller draws the event's own).
   */
  adoptOwn(serial: number, shot: CannonFiredShot, tick: number): boolean {
    return !this.disposed && !!this.pools?.timeline.adoptOwn(serial, shot, tick);
  }

  /** The shell lands: its blast, chunks, puffs, scorch and shake. */
  impact(shot: CannonBlast, time: number, reducedMotion: boolean): void {
    if (this.disposed) return;
    const power = cannonBlastPower(shot.hits) * (shot.scale ?? 1);
    const pools = this.pools;
    if (pools) {
      const index = pools.timeline.impact(
        shot,
        time,
        shot.cloud === false ? this.cloudless : this.counts,
        shot.radius ?? this.blastRadius,
        power,
        this.groundAt,
      );
      this.paintImpactColours(pools, index);
      this.placeScorch(pools);
    }
    const host = this.host;
    if (!host) return;
    const { x, y, z } = shot;
    if (!this.revealed()) {
      host.vfx.burst(this.at.set(x, y + 0.6, z), 'fire', 16, 1.2);
      host.vfx.burst(this.at.set(x, y + 0.4, z), 'blood', 20, 1.3, 0x5b4632, 0.9);
    }
    if (reducedMotion) return;
    const eye = host.camera.position;
    const falloff = cannonShakeFalloff(Math.hypot(x - eye.x, y - eye.y, z - eye.z));
    if (falloff > 0) host.addShake(CANNON_BLAST.shake * falloff * power);
  }

  /**
   * A fragmentation shell bursts over its point, seen at display tick
   * `burstTick`: its shell is gone, the airburst flashes, and each bomblet flies
   * from the burst to its point, landing on its tick; `landBomblet` ends a flight.
   */
  scatter(burst: CannonFragBurst, burstTick: number, time: number): void {
    if (this.disposed) return;
    const pools = this.pools;
    if (pools) {
      const index = pools.timeline.airburst(
        burst.shotId,
        burst.x,
        burst.y,
        burst.z,
        time,
        this.airburstCounts,
      );
      this.paintImpactColours(pools, index);
      for (const b of burst.bomblets) {
        this.at.set(b.x, b.y, b.z);
        pools.bomblets.launch(
          cannonBombletKey(burst.shotId, b.index),
          burst,
          this.at,
          burstTick,
          b.landTick,
        );
      }
    }
    if (!this.revealed())
      this.host?.vfx.burst(this.at.set(burst.x, burst.y, burst.z), 'fire', 10, 0.8);
  }

  /** Bomblet `index` of shot `shotId` blasted: its flight is over. */
  landBomblet(shotId: number, index: number): void {
    this.pools?.bomblets.land(cannonBombletKey(shotId, index));
  }

  /**
   * A slam's pale cracked mark `half` yards around (x, y, z), laid now in the
   * scorch's draw and fading over CANNON_GROUND_MARK.life; a newer slam's
   * takes its place.
   */
  markGround(seed: number, x: number, y: number, z: number, half: number, time: number): void {
    const parts = this.parts;
    const pools = this.pools;
    if (!parts || !pools || this.disposed) return;
    const mark = pools.timeline.groundMark;
    pools.timeline.markGround(seed, x, y, z, half, time, this.groundAt);
    this.drape(parts, MARK_SLOT, mark);
  }

  /** Stops every shot, blast and scorch, and sets the barrel back to rest. */
  clear(): void {
    this.pools?.timeline.clear();
    this.pools?.bomblets.clear();
    this.restBarrel();
    const parts = this.parts;
    const pools = this.pools;
    if (!parts || !pools) return;
    parts.shells.count = 0;
    parts.shells.visible = false;
    parts.chunks.count = 0;
    parts.chunks.visible = false;
    this.liveChunks.fill(false);
    pools.bursts.clear();
    for (let i = 0; i < DRAPED_SLOTS; i++) {
      if (this.liveScorches[i]) this.retireScorch(parts, pools, i);
    }
    parts.scorch.visible = false;
    this.byKind.fill(0);
    parts.puffs.begin();
    parts.puffs.end();
  }

  /**
   * `tick` is the display tick the monsters are sampled on; `time` the frame
   * seconds; `refused` names the own launches no event will confirm.
   */
  update(tick: number, time: number, refused?: (serial: number) => boolean): void {
    const parts = this.parts;
    const pools = this.pools;
    if (!parts || !pools || this.disposed) return;
    if (refused) pools.timeline.fadeRefused(refused, time);
    pools.timeline.settleFades(tick, time);
    this.recoil(pools, time);
    this.frameCount = 0;
    this.lightPuffs(parts);
    this.gatherBlasts(pools, time);
    this.groupEnds[0] = this.frameCount;
    this.gatherBursts(pools, time);
    this.groupEnds[1] = this.frameCount;
    this.drawShells(parts, pools, tick, time);
    this.groupEnds[2] = this.frameCount;
    this.gatherMuzzles(pools, time);
    this.groupEnds[3] = this.frameCount;
    this.drawPuffs(parts, pools);
    this.drawChunks(parts, pools, time);
    this.drawScorches(parts, pools, time);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.restBarrel();
    this.barrel = null;
    this.root.removeFromParent();
    const parts = this.parts;
    this.parts = null;
    this.pools = null;
    if (!parts) return;
    const errors: unknown[] = [];
    const resources: { dispose(): void }[] = [
      parts.shells,
      parts.chunks,
      ...parts.geometries,
      ...parts.materials,
      parts.scorchTexture,
      parts.puffs,
    ];
    for (const resource of resources) {
      try {
        resource.dispose();
      } catch (error) {
        errors.push(error);
      }
    }
    if (errors.length > 0) throw new AggregateError(errors, 'Cannon shot failed to dispose');
  }

  /** The gate has revealed the weapon's own pieces with their texels (false while either is on its way). */
  private revealed(): boolean {
    return (
      this.parts !== null && this.texelsReady && this.root.visible && this.root.parent !== null
    );
  }

  /** The texel slot resolved: the page's texels fill the atlas and the scorch built clear. */
  private landTexels(): void {
    const parts = this.parts;
    if (!parts || this.disposed || this.texelsReady) return;
    const texels = shotTexels();
    parts.puffs.setAtlas(texels.atlas);
    parts.scorchTexture.image.data = texels.scorch;
    parts.scorchTexture.needsUpdate = true;
    this.texelsReady = true;
  }

  private restBarrel(): void {
    if (this.barrel && this.barrelKicked) this.barrel.position.copy(this.barrelRest);
    this.barrelKicked = false;
  }

  private recoil(pools: Pools, time: number): void {
    const barrel = this.barrel;
    if (!barrel) return;
    const kick = cannonRecoilOffset(time - pools.timeline.muzzleAt) * this.barrelKick;
    if (kick !== 0) {
      this.barrelAxis.copy(FORWARD).applyQuaternion(barrel.quaternion);
      barrel.position.copy(this.barrelRest).addScaledVector(this.barrelAxis, -kick);
      this.barrelKicked = true;
    } else if (this.barrelKicked) {
      barrel.position.copy(this.barrelRest);
      this.barrelKicked = false;
    }
  }

  private aimMuzzle(fallback: CannonPoint, towardX: number, towardZ: number): void {
    this.muzzleInto(fallback, towardX, towardZ);
    this.point.x = this.muzzle.x;
    this.point.y = this.muzzle.y;
    this.point.z = this.muzzle.z;
    this.dir.x = this.muzzleDir.x;
    this.dir.y = this.muzzleDir.y;
    this.dir.z = this.muzzleDir.z;
  }

  /** The report's camera kick, and the boot particles' flash while the pieces are gated. */
  private kick(reducedMotion: boolean): void {
    const host = this.host;
    if (!host) return;
    if (!this.revealed()) host.vfx.burst(this.muzzle, 'fire', 10, 0.8);
    if (reducedMotion) return;
    host.punchFov(CANNON_MUZZLE.fovPunch);
    host.addShake(CANNON_MUZZLE.shake);
  }

  private muzzleInto(fallback: CannonPoint, towardX: number, towardZ: number): void {
    const barrel = this.barrel;
    if (barrel) {
      this.restBarrel();
      barrel.updateWorldMatrix(true, false);
      this.muzzle.copy(this.barrelTip).applyMatrix4(barrel.matrixWorld);
      this.muzzleDir.setFromMatrixColumn(barrel.matrixWorld, 2);
      if (this.muzzleDir.lengthSq() > 1e-8 && Number.isFinite(this.muzzle.x)) {
        this.muzzleDir.normalize();
        return;
      }
    }
    this.muzzle.set(fallback.x, fallback.y, fallback.z);
    this.muzzleDir.set(towardX - fallback.x, 0, towardZ - fallback.z);
    if (this.muzzleDir.lengthSq() < 1e-8) this.muzzleDir.copy(FORWARD);
    this.muzzleDir.normalize();
  }

  /** Every piece, on the page's texels, or on clear ones the texel slot fills later. */
  private build(texels: ShotTexels | null): Parts {
    const geometries: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];
    const geometry = <T extends THREE.BufferGeometry>(g: T): T => {
      geometries.push(g);
      return g;
    };
    const scorchTexture = new THREE.DataTexture(
      texels?.scorch ?? new Uint8Array(SCORCH_TEXELS * SCORCH_CELLS * SCORCH_TEXELS * 4),
      SCORCH_TEXELS * SCORCH_CELLS,
      SCORCH_TEXELS,
      THREE.RGBAFormat,
    );
    scorchTexture.name = materialName('scorch');
    scorchTexture.magFilter = THREE.LinearFilter;
    scorchTexture.minFilter = THREE.LinearMipmapLinearFilter;
    scorchTexture.generateMipmaps = true;
    scorchTexture.needsUpdate = true;
    const shellMaterial = new THREE.MeshBasicMaterial({ name: materialName('shell'), color: IRON });
    const chunkMaterial = new THREE.MeshLambertMaterial({
      name: materialName('chunk'),
      color: 0xffffff,
    });
    // Subtractive: the ground under it darkens by the texel times the fade in
    // its vertex colours, so a spent scorch darkens nothing.
    const scorchMaterial = new THREE.MeshBasicMaterial({
      name: materialName('scorch'),
      map: scorchTexture,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.SubtractiveBlending,
      premultipliedAlpha: true,
      fog: false,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    });
    materials.push(shellMaterial, chunkMaterial, scorchMaterial);
    const shells = this.instanced(
      'shell',
      geometry(new THREE.IcosahedronGeometry(0.2, 1)),
      shellMaterial,
      CANNON_SHELL_POOL + this.bombletSlots,
      false,
    );
    const chunks = this.instanced(
      'chunk',
      geometry(new THREE.DodecahedronGeometry(1, 0)),
      chunkMaterial,
      this.impactPool * CANNON_CHUNKS_PER_IMPACT,
      true,
    );
    for (let i = 0; i < chunks.instanceMatrix.count; i++) chunks.setMatrixAt(i, ZERO);
    const scorchGeometry = geometry(this.scorchGeometry());
    const scorch = new THREE.Mesh(scorchGeometry, scorchMaterial);
    scorch.name = materialName('scorch');
    scorch.frustumCulled = false;
    scorch.castShadow = false;
    scorch.receiveShadow = false;
    scorch.visible = false;
    scorch.renderOrder = floorVfxRenderOrder('ground', 1);
    const puffs = new CannonPuffMesh(
      this.puffCapacity,
      materialName('puff'),
      texels?.atlas ?? null,
    );
    // Airborne, but it must paint after the scorch it rises over and under every
    // telegraph and the aim reticle: the player band's upper rungs.
    puffs.mesh.renderOrder = floorVfxRenderOrder('player', 4);
    this.root.add(scorch, puffs.mesh);
    const scorchPosition = scorchGeometry.getAttribute('position') as THREE.BufferAttribute;
    const scorchColor = scorchGeometry.getAttribute('color') as THREE.BufferAttribute;
    return {
      geometries,
      materials,
      scorchTexture,
      shells,
      chunks,
      scorch,
      scorchPosition,
      scorchColor,
      scorchPositionUpload: new BufferUpdateRange(scorchPosition),
      scorchColorUpload: new BufferUpdateRange(scorchColor),
      chunkUpload: new BufferUpdateRange(chunks.instanceMatrix),
      puffs,
    };
  }

  /** Every scorch's draped layers in one mesh, collapsed to a point until it is laid; the ground mark's last, on the texture's second cell. */
  private scorchGeometry(): THREE.BufferGeometry {
    const grid = CANNON_SCORCH_GRID;
    const layers = CANNON_SCORCH_LAYERS.length;
    const grids = DRAPED_SLOTS * layers;
    const verts = grids * CANNON_SCORCH_VERTS;
    const positions = new Float32Array(verts * 3);
    const colors = new Float32Array(verts * 3);
    const uvs = new Float32Array(verts * 2);
    const index = new Uint16Array(grids * grid * grid * 6);
    let u = 0;
    let q = 0;
    for (let s = 0; s < grids; s++) {
      const base = s * CANNON_SCORCH_VERTS;
      const cell = Math.floor(s / layers) === MARK_SLOT ? 1 : 0;
      for (let j = 0; j <= grid; j++) {
        for (let i = 0; i <= grid; i++) {
          uvs[u++] = (cell + i / grid) / SCORCH_CELLS;
          uvs[u++] = j / grid;
        }
      }
      for (let j = 0; j < grid; j++) {
        for (let i = 0; i < grid; i++) {
          const a = base + j * (grid + 1) + i;
          const b = a + 1;
          const c = a + grid + 1;
          const d = c + 1;
          index[q++] = a;
          index[q++] = c;
          index[q++] = b;
          index[q++] = b;
          index[q++] = c;
          index[q++] = d;
        }
      }
    }
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(positions, 3);
    position.setUsage(THREE.DynamicDrawUsage);
    const color = new THREE.BufferAttribute(colors, 3);
    color.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', position);
    geometry.setAttribute('color', color);
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(index, 1));
    return geometry;
  }

  private instanced(
    role: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    count: number,
    coloured: boolean,
  ): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    mesh.name = materialName(role);
    mesh.frustumCulled = false;
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // The colour attribute is a program key bit: it exists from the build, so
    // the gate links the very program the first blast draws.
    if (coloured) for (let i = 0; i < count; i++) mesh.setColorAt(i, this.color.setRGB(1, 1, 1));
    mesh.count = 0;
    mesh.visible = false;
    this.root.add(mesh);
    return mesh;
  }

  private paintImpactColours(pools: Pools, index: number): void {
    const parts = this.parts;
    if (!parts) return;
    const slot = pools.timeline.impacts[index];
    const base = index * CANNON_CHUNKS_PER_IMPACT;
    for (let i = 0; i < slot.chunkCount; i++) {
      const shade = slot.chunks[i].shade;
      if (shade > 0.84) this.color.copy(SOIL_GRASS);
      else this.color.copy(SOIL_DARK).lerp(SOIL_LIGHT, shade / 0.84);
      parts.chunks.setColorAt(base + i, this.color);
    }
    for (let i = slot.chunkCount; i < CANNON_CHUNKS_PER_IMPACT; i++) {
      parts.chunks.setMatrixAt(base + i, ZERO);
    }
    const colors = parts.chunks.instanceColor;
    if (colors) colors.needsUpdate = true;
    parts.chunks.instanceMatrix.needsUpdate = true;
    this.liveChunks[index] = slot.chunkCount > 0;
  }

  /**
   * The newest scorch is draped once, where it lands, every layer over the
   * ground its impact sampled once per vertex; only its fade changes after.
   */
  private placeScorch(pools: Pools): void {
    const parts = this.parts;
    const newest = pools.timeline.lastScorch;
    if (!parts || newest < 0) return;
    this.drape(parts, newest, pools.timeline.scorches[newest]);
  }

  /** Lays draped slot `slot` over its sampled ground, not yet darkening anything. */
  private drape(parts: Parts, slot: number, s: CannonScorchSlot): void {
    for (let layer = 0; layer < CANNON_SCORCH_LAYERS.length; layer++) {
      cannonScorchDrapeInto(
        parts.scorchPosition.array as Float32Array,
        slot * SCORCH_FLOATS + layer * LAYER_FLOATS,
        s.x,
        s.z,
        s.yaw,
        s.half,
        CANNON_SCORCH_LAYERS[layer].lift,
        s.heights,
      );
    }
    parts.scorchPositionUpload.mark(slot * SCORCH_FLOATS, SCORCH_FLOATS);
    this.setScorchFade(parts, slot, 0);
    this.liveScorches[slot] = true;
  }

  /** A scorch darkens grey by its fade; the ground mark by its fade in its own tint. */
  private setScorchFade(parts: Parts, slot: number, fade: number): void {
    const colors = parts.scorchColor.array as Float32Array;
    const tint = slot === MARK_SLOT ? CANNON_GROUND_MARK.tint : null;
    for (let layer = 0; layer < CANNON_SCORCH_LAYERS.length; layer++) {
      const from = slot * SCORCH_FLOATS + layer * LAYER_FLOATS;
      const amount = fade * CANNON_SCORCH_LAYERS[layer].strength;
      if (!tint) {
        colors.fill(amount, from, from + LAYER_FLOATS);
        continue;
      }
      for (let at = from; at < from + LAYER_FLOATS; at += 3) {
        colors[at] = amount * tint[0];
        colors[at + 1] = amount * tint[1];
        colors[at + 2] = amount * tint[2];
      }
    }
    parts.scorchColorUpload.mark(slot * SCORCH_FLOATS, SCORCH_FLOATS);
    this.scorchFades[slot] = fade;
  }

  private retireScorch(parts: Parts, pools: Pools, slot: number): void {
    const positions = parts.scorchPosition.array as Float32Array;
    positions.fill(0, slot * SCORCH_FLOATS, (slot + 1) * SCORCH_FLOATS);
    parts.scorchPositionUpload.mark(slot * SCORCH_FLOATS, SCORCH_FLOATS);
    this.setScorchFade(parts, slot, 0);
    this.draped(pools, slot).active = false;
    this.liveScorches[slot] = false;
  }

  private draped(pools: Pools, slot: number): CannonScorchSlot {
    return slot === MARK_SLOT ? pools.timeline.groundMark : pools.timeline.scorches[slot];
  }

  /**
   * Smoke and dust take the scene's hemisphere and sun as graded this frame
   * (day, dusk, night): read-only, found once among the scene's own children.
   */
  private lightPuffs(parts: Parts): void {
    if (!this.lightsSought && this.root.parent) {
      this.lightsSought = true;
      let top: THREE.Object3D = this.root;
      while (top.parent) top = top.parent;
      for (const child of top.children) {
        const light = child as THREE.HemisphereLight & THREE.DirectionalLight;
        if (light.isHemisphereLight && !this.hemi) this.hemi = light;
        else if (light.isDirectionalLight && !this.sun) this.sun = light;
      }
    }
    const hemi = this.hemi;
    const sun = this.sun;
    if (!hemi && !sun) return;
    cannonPuffLightInto(
      hemi ? hemi.color : BLACK,
      hemi ? hemi.groundColor : BLACK,
      hemi ? hemi.intensity : 0,
      sun ? sun.color : BLACK,
      sun ? sun.intensity : 0,
      this.light,
    );
    parts.puffs.setLight(this.light.r, this.light.g, this.light.b);
  }

  private nextFrame(pools: Pools): CannonPuffFrame | null {
    return this.frameCount < pools.frames.length ? pools.frames[this.frameCount] : null;
  }

  private gather(pools: Pools, puff: CannonPuff, age: number): void {
    const frame = this.nextFrame(pools);
    if (frame && cannonPuffInto(puff, age, frame)) this.frameCount++;
  }

  private drawShells(parts: Parts, pools: Pools, tick: number, time: number): void {
    const timeline = pools.timeline;
    let shells = 0;
    for (let i = 0; i < CANNON_SHELL_POOL; i++) {
      const size = timeline.shellScale(i, time);
      if (size > 0 && timeline.shellAt(i, tick, this.point)) {
        const age = timeline.shellAge(i, tick);
        this.pos.set(this.point.x, this.point.y, this.point.z);
        this.euler.set(CANNON_SHELL.spinX * age, CANNON_SHELL.spinY * age, 0);
        this.quat.setFromEuler(this.euler);
        this.matrix.compose(this.pos, this.quat, this.scale.setScalar(size));
        parts.shells.setMatrixAt(shells++, this.matrix);
        const glow = this.nextFrame(pools);
        if (glow) {
          cannonShellGlowInto(this.point.x, this.point.y, this.point.z, age, glow);
          if (size < 1) {
            glow.size *= size;
            glow.a *= size;
          }
          this.frameCount++;
        }
      }
      const n = timeline.trailPuffsInto(i, tick, pools.trailPuffs, pools.trailAges);
      for (let k = 0; k < n; k++) this.gather(pools, pools.trailPuffs[k], pools.trailAges[k]);
    }
    const bomblets = pools.bomblets;
    for (let i = 0; i < bomblets.flights.length; i++) {
      if (!bomblets.at(i, tick, this.point)) continue;
      const age = bomblets.age(i, tick);
      this.pos.set(this.point.x, this.point.y, this.point.z);
      this.euler.set(CANNON_SHELL.spinX * age, CANNON_SHELL.spinY * age, 0);
      this.quat.setFromEuler(this.euler);
      this.matrix.compose(this.pos, this.quat, this.scale.setScalar(CANNON_BOMBLET.scale));
      parts.shells.setMatrixAt(shells++, this.matrix);
      const n = bomblets.motesInto(i, tick, pools.trailPuffs, pools.trailAges);
      for (let k = 0; k < n; k++) this.gather(pools, pools.trailPuffs[k], pools.trailAges[k]);
    }
    parts.shells.count = shells;
    parts.shells.visible = shells > 0;
    if (shells > 0) parts.shells.instanceMatrix.needsUpdate = true;
  }

  private gatherMuzzles(pools: Pools, time: number): void {
    for (const slot of pools.timeline.muzzles) {
      if (!slot.active) continue;
      const age = time - slot.at;
      if (age >= CANNON_MUZZLE.life) {
        slot.active = false;
        continue;
      }
      for (let i = 0; i < slot.puffCount; i++) this.gather(pools, slot.puffs[i], age);
    }
  }

  private gatherBlasts(pools: Pools, time: number): void {
    for (const slot of pools.timeline.impacts) {
      if (!slot.active) continue;
      const age = time - slot.at;
      if (age >= CANNON_BLAST.life) {
        slot.active = false;
        continue;
      }
      for (let i = 0; i < slot.puffCount; i++) this.gather(pools, slot.puffs[i], age);
    }
  }

  private gatherBursts(pools: Pools, time: number): void {
    if (!pools.bursts.sweep(time)) return;
    for (const burst of pools.bursts.slots) {
      if (!burst.active) continue;
      const age = time - burst.at;
      for (let i = 0; i < burst.count; i++) this.gather(pools, burst.puffs[i], age);
    }
  }

  /** Source by source, far to near, and inside each the dust behind, then smoke, fireball and dirt, then the light. */
  private drawPuffs(parts: Parts, pools: Pools): void {
    const mesh = parts.puffs;
    this.byKind.fill(0);
    mesh.begin();
    let from = 0;
    for (let group = 0; group < GROUPS; group++) {
      const to = this.groupEnds[group];
      for (let layer = 0; layer < CANNON_PUFF_LAYERS; layer++) {
        for (let i = from; i < to; i++) {
          const frame = pools.frames[i];
          if (frame.layer !== layer) continue;
          const before = mesh.drawn;
          mesh.push(frame);
          if (mesh.drawn > before) this.byKind[frame.kind]++;
        }
      }
      from = to;
    }
    mesh.end();
  }

  private drawChunks(parts: Parts, pools: Pools, time: number): void {
    const impacts = pools.timeline.impacts;
    // Only the slots written are uploaded, and only up to the last live one is drawn:
    // a pool sized for a whole frag ripple must not cost its full size per blast.
    let lastLive = -1;
    let firstWritten = -1;
    let lastWritten = -1;
    for (let s = 0; s < impacts.length; s++) {
      if (!this.liveChunks[s]) continue;
      const slot = impacts[s];
      const age = time - slot.at;
      const base = s * CANNON_CHUNKS_PER_IMPACT;
      let live = false;
      for (let i = 0; i < slot.chunkCount; i++) {
        const chunk = slot.chunks[i];
        if (!slot.active || !cannonChunkInto(chunk, age, this.chunkFrame)) {
          parts.chunks.setMatrixAt(base + i, ZERO);
          continue;
        }
        live = true;
        const f = this.chunkFrame;
        this.axis.set(chunk.axisX, chunk.axisY, chunk.axisZ);
        this.quat.setFromAxisAngle(this.axis, f.angle);
        this.pos.set(f.x, f.y, f.z);
        this.scale.set(f.scale * (0.8 + 0.4 * chunk.shade), f.scale * 0.7, f.scale);
        this.matrix.compose(this.pos, this.quat, this.scale);
        parts.chunks.setMatrixAt(base + i, this.matrix);
      }
      if (firstWritten < 0) firstWritten = s;
      lastWritten = s;
      this.liveChunks[s] = live;
      if (live) lastLive = s;
    }
    if (firstWritten >= 0) {
      parts.chunkUpload.mark(
        firstWritten * CANNON_CHUNKS_PER_IMPACT * 16,
        (lastWritten - firstWritten + 1) * CANNON_CHUNKS_PER_IMPACT * 16,
      );
    }
    parts.chunks.count = lastLive < 0 ? 0 : (lastLive + 1) * CANNON_CHUNKS_PER_IMPACT;
    parts.chunks.visible = lastLive >= 0;
  }

  private drawScorches(parts: Parts, pools: Pools, time: number): void {
    let any = false;
    for (let i = 0; i < DRAPED_SLOTS; i++) {
      if (!this.liveScorches[i]) continue;
      const s = this.draped(pools, i);
      const age = time - s.at;
      const mark = i === MARK_SLOT;
      if (!s.active || age >= (mark ? CANNON_GROUND_MARK.life : CANNON_BLAST.scorchLife)) {
        this.retireScorch(parts, pools, i);
        continue;
      }
      any = true;
      const fade = mark ? cannonGroundMarkFade(age) : cannonScorchFade(age);
      // A held scorch keeps its colours: only a fade that moved is uploaded.
      if (Math.abs(fade - this.scorchFades[i]) > 1 / 512) this.setScorchFade(parts, i, fade);
    }
    parts.scorch.visible = any;
  }
}
