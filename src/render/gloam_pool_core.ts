// Gloamveil's shadow pool, the pure half: where the stain lies, how it erupts
// on the entry, how the wake is dropped behind a walking priest, and how many
// floor samples a frame may spend on it.
//
// The pool is a small grid DRAPED on the real floor: every vertex takes the
// ground height under it, so it follows slopes, steps and dock planks instead
// of cutting through them. Three questions decide what one stain does, and all
// three are answered here so a Vitest can ask them:
//   WHERE IT LIES (gloamFloorInto). The sampled ground is the floor unless the
//     wearer STANDS above it on something the sampler does not know (dock
//     planks, a bridge deck, an upper storey), where the stain lies flat at
//     the feet. A wearer in the air keeps the floor it left, and the stain
//     thins out as the body leaves it behind.
//   WHAT A VERTEX DOES (gloamDrapeHeight, gloamDrapeFade). Where the floor
//     breaks away under the grid (a ledge, a wall foot) the stain fades out
//     rather than climbing or hanging in the air.
//   WHAT A LAY COSTS (GloamGround, GloamDrapeBudget). The ground sampler is
//     the expensive part: about ten microseconds a call, so sampling it once
//     per vertex per frame cost a running priest two milliseconds a frame.
//     The floor holds still, so its height is remembered on a world-aligned
//     grid of the pool's own cell and a vertex reads it between four nodes.
//     A pool laid a hand farther on needs only the row of nodes it has just
//     reached, so it can be laid every frame it moves, as exactly as the grid
//     it is drawn on allows. New samples are spent from one per-frame
//     allowance shared by every pool in view; where the allowance runs out a
//     vertex keeps the height it had (a pool rides its wearer on its own
//     floor, so that is exact on any plane) and the lay is finished on a
//     later frame.
//
// Pure core contract: no three import, no DOM, no clocks, no randomness.
// Registered in RENDER_PURE_CORES (tests/architecture.test.ts); tested by
// tests/gloam_pool_core.test.ts.

/** Side of the pool's grid in yards, and of a wake stain's. */
export const GLOAM_POOL_SIZE = 3.9;
export const GLOAM_WAKE_SIZE = 2.1;
/** Side of the entry's shock ring, yards. */
export const GLOAM_RING_SIZE = 15;
/** Yards the stain floats over the floor it is draped on. */
export const GLOAM_POOL_LIFT = 0.04;

/** A vertex whose floor is this far from the pool's own floor has left it. */
export const GLOAM_BREAK_HEIGHT = 0.9;
/** Settled feet this far above the sampled floor stand on something it does
 *  not know (dock planks, a bridge deck, a stair of colliders)... */
export const GLOAM_UNKNOWN_FLOOR_GAP = 0.5;
/** ...and are back on the floor it knows once they are this close to it. Two
 *  thresholds, so a body running a steep slope never flips between the two. */
export const GLOAM_KNOWN_FLOOR_GAP = 0.3;
/** A body this far from its pool's floor has left it: the pool starts to thin... */
export const GLOAM_LEAVE_FADE_FROM = 2.2;
/** ...and is gone by here. */
export const GLOAM_LEAVE_FADE_TO = 4.5;
/** A wearer this far BELOW a flat pool's floor has dropped off what it stood on. */
export const GLOAM_DROP_BELOW = 0.5;

/** The pool is laid again once its wearer has moved this far, yards... */
export const GLOAM_REDRAPE_STEP = 0.08;
/** ...or its feet have risen or dropped this far. */
export const GLOAM_REDRAPE_RISE = 0.25;

/** Yards between wake stains, and the seconds one lasts. */
export const GLOAM_WAKE_STEP = 0.55;
export const GLOAM_WAKE_SECONDS = 1.5;
/** A jump this long between two frames is a teleport: no stain is dropped. */
export const GLOAM_WAKE_TELEPORT = 6;

/** The entry: the pool bursts out past its rest size, then settles. */
export const GLOAM_ERUPT_SECONDS = 0.85;
export const GLOAM_RING_SECONDS = 0.95;
/** Seconds the pool takes to fade in (and out, when its wearer leaves it). */
export const GLOAM_POOL_FADE = 0.2;

/** Ground samples every pool in view may spend between them in one frame:
 *  about a millisecond of the sampler at its measured cost. A pool that has
 *  just appeared fills its grid over two or three frames, while it fades in. */
export const GLOAM_DRAPE_BUDGET = 96;
/** Grid nodes one generation of the ground memory holds before it turns over. */
export const GLOAM_GROUND_NODES = 4096;
/** How far ahead of its racing front the entry ring is laid, in seconds of
 *  the front's own run: longer than a slow frame, so the darkness never
 *  reaches ground that is not laid yet, at seven frames a second or sixty. */
export const GLOAM_RING_LEAD_SECONDS = 0.15;
/** The ring is laid this much past where the front will be (a share of its
 *  half side): the band's soft outer edge. */
export const GLOAM_RING_EDGE = 0.05;

function smoothstep(lo: number, hi: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - lo) / (hi - lo)));
  return t * t * (3 - 2 * t);
}

/** Where a stain lies. */
export interface GloamFloor {
  /** Lying flat on a surface the ground sampler does not know. */
  flat: boolean;
  /** The floor's height at the stain's centre. */
  baseY: number;
  /** 1 on the floor, falling to 0 as the wearer leaves it behind. */
  presence: number;
}

export function createGloamFloor(): GloamFloor {
  return { flat: false, baseY: 0, presence: 1 };
}

/**
 * Where the pool lies this frame, written into `out` (which also carries last
 * frame's answer in). `ground` is the sampled floor under the wearer, `feetY`
 * where the body touches what it stands on, and `settled` whether it stands on
 * something at all (not in the air, not swimming).
 */
export function gloamFloorInto(
  ground: number,
  feetY: number,
  settled: boolean,
  out: GloamFloor,
): GloamFloor {
  const gap = feetY - ground;
  if (settled) {
    out.flat = gap > (out.flat ? GLOAM_KNOWN_FLOOR_GAP : GLOAM_UNKNOWN_FLOOR_GAP);
    out.baseY = out.flat ? feetY : ground;
    out.presence = 1;
    return out;
  }
  // In the air or in water. A pool that lay flat on a deck stays on that deck
  // through a jump, until the body drops clearly below it.
  if (out.flat && feetY > out.baseY - GLOAM_DROP_BELOW) {
    out.presence = 1 - smoothstep(GLOAM_LEAVE_FADE_FROM, GLOAM_LEAVE_FADE_TO, feetY - out.baseY);
    return out;
  }
  out.flat = false;
  out.baseY = ground;
  out.presence = 1 - smoothstep(GLOAM_LEAVE_FADE_FROM, GLOAM_LEAVE_FADE_TO, gap);
  return out;
}

/** A draped vertex's height over the pool's floor, held at the break height
 *  where the floor has left it. `rise` is that vertex's floor minus the pool's;
 *  a sampler that answers nothing usable leaves the vertex on the pool's floor. */
export function gloamDrapeHeight(rise: number): number {
  if (!Number.isFinite(rise)) return 0;
  if (Math.abs(rise) <= GLOAM_BREAK_HEIGHT) return rise;
  return Math.sign(rise) * GLOAM_BREAK_HEIGHT;
}

/** 1 where the vertex lies on the pool's floor, 0 where the floor broke away. */
export function gloamDrapeFade(rise: number): number {
  return Math.abs(rise) <= GLOAM_BREAK_HEIGHT ? 1 : 0;
}

/** Whether a pool laid at (drapedX, drapedY, drapedZ) must be laid again. */
export function gloamRedrapeDue(
  x: number,
  y: number,
  z: number,
  drapedX: number,
  drapedY: number,
  drapedZ: number,
): boolean {
  if (Number.isNaN(drapedX)) return true;
  const dx = x - drapedX;
  const dz = z - drapedZ;
  return (
    dx * dx + dz * dz >= GLOAM_REDRAPE_STEP * GLOAM_REDRAPE_STEP ||
    Math.abs(y - drapedY) > GLOAM_REDRAPE_RISE
  );
}

/** How far the pool has grown `age` seconds into an entry: it erupts to half
 *  again its size and settles back. 1 is the rest size. */
export function gloamEruptGrow(age: number): number {
  const erupt = Math.min(1, Math.max(0, age) / GLOAM_ERUPT_SECONDS);
  if (erupt < 0.3) return 0.2 + (1.55 - 0.2) * (erupt / 0.3);
  return 1.55 - 0.55 * (1 - (1 - (erupt - 0.3) / 0.7) ** 3);
}

/** How far the shock ring's front has run `age` seconds in, 0 to 1 of the
 *  ring's half side: fast at first, easing out. 1 once it has passed. */
export function gloamRingFront(age: number): number {
  const left = 1 - Math.min(1, Math.max(0, age / GLOAM_RING_SECONDS));
  return 1 - left ** 2.4;
}

/** The shock ring at `age` seconds, written into `out`: how far its front has
 *  run (0 to 1 of the ring's half side) and how strong it is. False once it
 *  has passed. */
export function gloamRingAt(age: number, out: { grow: number; alpha: number }): boolean {
  const t = age / GLOAM_RING_SECONDS;
  if (!(t < 1)) return false;
  out.grow = gloamRingFront(age);
  out.alpha = (1 - Math.max(0, t)) ** 1.3;
  return true;
}

/** A wake stain with `left` (1 to 0) of its life: its opacity and its size. */
export function gloamWakeAlpha(left: number): number {
  return left * Math.sqrt(Math.max(0, left)) * 0.8;
}

export function gloamWakeGrow(left: number): number {
  return 0.55 + 0.45 * left;
}

/** The wake behind a walking wearer. */
export interface GloamWake {
  /** Where the wake last reached. */
  x: number;
  z: number;
  /** Where the stain a step just dropped belongs: the point it left. */
  dropX: number;
  dropZ: number;
  /** The stain the next drop takes. */
  cursor: number;
  started: boolean;
}

export function createGloamWake(): GloamWake {
  return { x: 0, z: 0, dropX: 0, dropZ: 0, cursor: 0, started: false };
}

/**
 * Walk the wake to (x, z). Returns the index of the stain to drop, at
 * (`wake.dropX`, `wake.dropZ`), or -1 when the wearer has not gone a full step,
 * has just appeared, has teleported, or has no stains to drop.
 */
export function gloamWakeStep(wake: GloamWake, x: number, z: number, stains: number): number {
  if (!wake.started) {
    wake.started = true;
    wake.x = x;
    wake.z = z;
    return -1;
  }
  const dx = x - wake.x;
  const dz = z - wake.z;
  const d2 = dx * dx + dz * dz;
  if (d2 < GLOAM_WAKE_STEP * GLOAM_WAKE_STEP) return -1;
  wake.dropX = wake.x;
  wake.dropZ = wake.z;
  wake.x = x;
  wake.z = z;
  if (stains <= 0 || d2 > GLOAM_WAKE_TELEPORT * GLOAM_WAKE_TELEPORT) return -1;
  const drop = wake.cursor % stains;
  wake.cursor = (drop + 1) % stains;
  return drop;
}

/** One frame's allowance of ground samples, shared by every pool in view. */
export class GloamDrapeBudget {
  private left = 0;

  constructor(private readonly perFrame = GLOAM_DRAPE_BUDGET) {}

  /** A new frame. */
  refill(): void {
    this.left = this.perFrame;
  }

  /** Spend one sample. False once the frame's allowance is gone. */
  take(): boolean {
    if (this.left <= 0) return false;
    this.left -= 1;
    return true;
  }

  get remaining(): number {
    return Math.max(0, this.left);
  }
}

/** A grid coordinate is offset into a non-negative range and packed in one key. */
const NODE_OFFSET = 2 ** 20;
const NODE_SPAN = 2 ** 21;

/**
 * The floor's height, remembered on a world-aligned grid of one cell size.
 * A node sampled once stays right until the ground itself is swapped (another
 * Rift floor on the same spot), which the owner answers with clear(). Two
 * generations bound the memory without a stall: when the recent one
 * is full it becomes the older one, and a node read from the older one is
 * carried forward, so what a pool is standing on is never forgotten.
 */
export class GloamGround {
  private recent = new Map<number, number>();
  private older = new Map<number, number>();

  constructor(
    readonly cell: number,
    private readonly capacity = GLOAM_GROUND_NODES,
  ) {}

  /**
   * The floor height at grid node (ix, iz): remembered, or sampled now when
   * `budget` still has a sample to give. NaN when it is unknown and cannot be
   * sampled this frame.
   */
  node(
    ix: number,
    iz: number,
    groundY: (x: number, z: number) => number,
    budget: GloamDrapeBudget,
  ): number {
    const kx = ix + NODE_OFFSET;
    const kz = iz + NODE_OFFSET;
    // Off the keyed range (a world coordinate no zone reaches): sampled, never kept.
    if (!(kx >= 0 && kx < NODE_SPAN && kz >= 0 && kz < NODE_SPAN)) {
      return budget.take() ? groundY(ix * this.cell, iz * this.cell) : Number.NaN;
    }
    const key = kx * NODE_SPAN + kz;
    let height = this.recent.get(key);
    if (height !== undefined) return height;
    height = this.older.get(key);
    if (height === undefined) {
      if (!budget.take()) return Number.NaN;
      height = groundY(ix * this.cell, iz * this.cell);
    }
    if (this.recent.size >= this.capacity) {
      this.older = this.recent;
      this.recent = new Map();
    }
    this.recent.set(key, height);
    return height;
  }

  /** Nodes remembered (at most two generations). */
  get size(): number {
    return this.recent.size + this.older.size;
  }

  clear(): void {
    this.recent.clear();
    this.older.clear();
  }
}

/** The grid nodes under one stain, read out of a GloamGround for one lay. */
export interface GloamWindow {
  /** Row by row along z, `nx` nodes to a row. NaN where the floor is unknown. */
  heights: Float32Array;
  ix0: number;
  iz0: number;
  nx: number;
  nz: number;
  cell: number;
}

/** Yards a window reaches past the stain it is read for. */
const WINDOW_MARGIN = 1e-3;

export function createGloamWindow(): GloamWindow {
  return { heights: new Float32Array(0), ix0: 0, iz0: 0, nx: 0, nz: 0, cell: 1 };
}

/**
 * Read into `out` every grid node the square of half side `half` around (x, z)
 * stands on, from the middle outward: when the allowance runs out it is the
 * rim that is left for a later frame, and a stain is drawn from its middle.
 * Returns how many nodes are still unknown; the lay is whole when it is zero.
 */
export function gloamWindowFill(
  ground: GloamGround,
  x: number,
  z: number,
  half: number,
  groundY: (x: number, z: number) => number,
  budget: GloamDrapeBudget,
  out: GloamWindow,
): number {
  const cell = ground.cell;
  // A hair wider than the stain: its vertices are 32-bit floats, and one a
  // rounding error outside the square must still find its four nodes.
  const reach = half + WINDOW_MARGIN;
  const ix0 = Math.floor((x - reach) / cell);
  const iz0 = Math.floor((z - reach) / cell);
  const nx = Math.floor((x + reach) / cell) + 2 - ix0;
  const nz = Math.floor((z + reach) / cell) + 2 - iz0;
  if (out.heights.length < nx * nz) out.heights = new Float32Array(nx * nz);
  out.ix0 = ix0;
  out.iz0 = iz0;
  out.nx = nx;
  out.nz = nz;
  out.cell = cell;
  let unknown = 0;
  // Square rings round the middle node, nearest first.
  const ci = nx >> 1;
  const cj = nz >> 1;
  const rings = Math.max(ci, nx - 1 - ci, cj, nz - 1 - cj);
  for (let d = 0; d <= rings; d++) {
    for (let j = cj - d; j <= cj + d; j++) {
      if (j < 0 || j >= nz) continue;
      // The ring's top and bottom rows whole, its two sides in between.
      const stride = d === 0 || j === cj - d || j === cj + d ? 1 : 2 * d;
      for (let i = ci - d; i <= ci + d; i += stride) {
        if (i < 0 || i >= nx) continue;
        const height = ground.node(ix0 + i, iz0 + j, groundY, budget);
        if (Number.isNaN(height)) unknown += 1;
        out.heights[j * nx + i] = height;
      }
    }
  }
  return unknown;
}

/**
 * The floor height at (wx, wz), between the four nodes of `read` around it.
 * NaN when one of the four is unknown or the point lies off what was read.
 */
export function gloamWindowHeight(read: GloamWindow, wx: number, wz: number): number {
  const fx = wx / read.cell - read.ix0;
  const fz = wz / read.cell - read.iz0;
  const i = Math.floor(fx);
  const j = Math.floor(fz);
  if (!(i >= 0 && j >= 0 && i < read.nx - 1 && j < read.nz - 1)) return Number.NaN;
  const tx = fx - i;
  const tz = fz - j;
  const row = j * read.nx + i;
  const h = read.heights;
  const near = h[row] + (h[row + 1] - h[row]) * tx;
  const far = h[row + read.nx] + (h[row + read.nx + 1] - h[row + read.nx]) * tx;
  return near + (far - near) * tz;
}
