// Gloamveil's shadow smoke, the pure half: a fixed pool of puffs, how one is
// taken when the pool is full, and how a puff swells and thins over its life.
//
// The pool is a dense block of parallel typed arrays (slot 0 to count - 1 are
// alive), which is exactly what the painter hands the GPU, so stepping it
// allocates nothing. A puff that dies is replaced by the last live one; a puff
// asked for while the pool is full takes the slot of the one nearest its end,
// which is already nearly invisible.
//
// Pure core contract: no three import, no DOM, no clocks, no randomness (the
// caller supplies each puff's turn and spin). Registered in RENDER_PURE_CORES
// (tests/architecture.test.ts); tested by tests/gloam_smoke_core.test.ts.

/** Share of its life a puff takes to fade in. */
const FADE_IN = 0.14;
/** Share of its life after which a puff starts to thin out. */
const FADE_OUT_FROM = 0.3;
/** Sideways drag, per second. */
const DRAG = 1.6;

/** One puff, as the caller describes it. */
export interface GloamPuff {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Starting world size, and how many times larger it ends. */
  size: number;
  grow: number;
  /** Seconds it lives. */
  life: number;
  /** Its densest opacity. */
  peak: number;
  /** 0 to 1: lifts it from near-black toward violet. */
  tint: number;
  /** Starting turn (radians) and turn rate (radians a second). */
  rot: number;
  spin: number;
}

/** How large a puff is at `age` (0 to 1 of its life): it swells fast, then
 *  keeps drifting wider. */
export function gloamPuffSize(size: number, grow: number, age: number): number {
  const swell = 1 - (1 - age) * (1 - age);
  return size * (1 + (grow - 1) * swell);
}

/** How dense a puff is at `age`: a quick fade in, a long thinning out. */
export function gloamPuffAlpha(peak: number, age: number): number {
  const fadeIn = Math.min(1, age / FADE_IN);
  const fadeOut = 1 - Math.max(0, (age - FADE_OUT_FROM) / (1 - FADE_OUT_FROM));
  return peak * fadeIn * fadeOut * fadeOut;
}

/** The pool. The public arrays are what the painter uploads. */
export class GloamSmokePool {
  readonly position: Float32Array;
  readonly size: Float32Array;
  readonly alpha: Float32Array;
  readonly rot: Float32Array;
  readonly tint: Float32Array;
  private readonly velocity: Float32Array;
  private readonly size0: Float32Array;
  private readonly grow: Float32Array;
  private readonly peak: Float32Array;
  private readonly spin: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private live = 0;

  constructor(readonly capacity: number) {
    this.position = new Float32Array(capacity * 3);
    this.velocity = new Float32Array(capacity * 3);
    this.size = new Float32Array(capacity);
    this.size0 = new Float32Array(capacity);
    this.grow = new Float32Array(capacity);
    this.alpha = new Float32Array(capacity);
    this.peak = new Float32Array(capacity);
    this.rot = new Float32Array(capacity);
    this.spin = new Float32Array(capacity);
    this.tint = new Float32Array(capacity);
    this.life = new Float32Array(capacity);
    this.maxLife = new Float32Array(capacity);
  }

  /** Live puffs: slots 0 to count - 1. */
  get count(): number {
    return this.live;
  }

  /** The slot a new puff takes: the next free one, or the puff with the least
   *  of its life left when the pool is full. */
  private slot(): number {
    if (this.live < this.capacity) return this.live++;
    let best = 0;
    let least = Number.POSITIVE_INFINITY;
    for (let i = 0; i < this.live; i++) {
      const left = this.life[i] / this.maxLife[i];
      if (left < least) {
        least = left;
        best = i;
      }
    }
    return best;
  }

  /** Add one puff and return its slot, or -1 for one that would never show. */
  add(puff: GloamPuff): number {
    if (this.capacity === 0 || !(puff.life > 0)) return -1;
    const i = this.slot();
    this.position[i * 3] = puff.x;
    this.position[i * 3 + 1] = puff.y;
    this.position[i * 3 + 2] = puff.z;
    this.velocity[i * 3] = puff.vx;
    this.velocity[i * 3 + 1] = puff.vy;
    this.velocity[i * 3 + 2] = puff.vz;
    this.size0[i] = puff.size;
    this.size[i] = puff.size;
    this.grow[i] = puff.grow;
    this.peak[i] = puff.peak;
    this.alpha[i] = 0;
    this.rot[i] = puff.rot;
    this.spin[i] = puff.spin;
    this.tint[i] = puff.tint;
    this.life[i] = puff.life;
    this.maxLife[i] = puff.life;
    return i;
  }

  private move(from: number, to: number): void {
    for (let k = 0; k < 3; k++) {
      this.position[to * 3 + k] = this.position[from * 3 + k];
      this.velocity[to * 3 + k] = this.velocity[from * 3 + k];
    }
    this.size[to] = this.size[from];
    this.size0[to] = this.size0[from];
    this.grow[to] = this.grow[from];
    this.alpha[to] = this.alpha[from];
    this.peak[to] = this.peak[from];
    this.rot[to] = this.rot[from];
    this.spin[to] = this.spin[from];
    this.tint[to] = this.tint[from];
    this.life[to] = this.life[from];
    this.maxLife[to] = this.maxLife[from];
  }

  /** Advance every puff by `dt` seconds and drop the ones that ended. */
  step(dt: number): void {
    const drag = Math.exp(-DRAG * dt);
    let i = 0;
    while (i < this.live) {
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.live -= 1;
        if (i !== this.live) this.move(this.live, i);
        continue;
      }
      const age = 1 - this.life[i] / this.maxLife[i];
      this.velocity[i * 3] *= drag;
      this.velocity[i * 3 + 2] *= drag;
      this.position[i * 3] += this.velocity[i * 3] * dt;
      this.position[i * 3 + 1] += this.velocity[i * 3 + 1] * dt;
      this.position[i * 3 + 2] += this.velocity[i * 3 + 2] * dt;
      this.rot[i] += this.spin[i] * dt;
      this.size[i] = gloamPuffSize(this.size0[i], this.grow[i], age);
      this.alpha[i] = gloamPuffAlpha(this.peak[i], age);
      i += 1;
    }
  }

  /** Share of its life slot `i` has left, 0 to 1 (a test and debug reading). */
  remaining(i: number): number {
    return i < this.live ? this.life[i] / this.maxLife[i] : 0;
  }

  clear(): void {
    this.live = 0;
  }
}
