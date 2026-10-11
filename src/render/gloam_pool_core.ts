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
//   WHEN IT IS LAID (GloamDrapeBudget). Draping samples the ground once per
//     vertex, so every pool in view draws on one per-frame allowance; a pool
//     the allowance cannot serve this frame slides with its wearer on the
//     drape it has and is laid properly on a later frame.
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

/** Ground samples every pool in view may spend between them in one frame. */
export const GLOAM_DRAPE_BUDGET = 420;

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

/** The shock ring at `age` seconds, written into `out`: how far its front has
 *  run (0 to 1 of the ring's half side) and how strong it is. False once it
 *  has passed. */
export function gloamRingAt(age: number, out: { grow: number; alpha: number }): boolean {
  const t = age / GLOAM_RING_SECONDS;
  if (!(t < 1)) return false;
  const left = 1 - Math.max(0, t);
  out.grow = 1 - left ** 2.4;
  out.alpha = left ** 1.3;
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

  /**
   * Spend `samples`. The first request of a frame is always served, whatever
   * its size, so one pool can never be starved by a budget smaller than its
   * own grid; after that a request the allowance cannot cover is refused.
   */
  take(samples: number): boolean {
    if (this.left <= 0) return false;
    if (samples > this.left && this.left < this.perFrame) return false;
    this.left -= samples;
    return true;
  }

  get remaining(): number {
    return Math.max(0, this.left);
  }
}
