// A per-draw observer (parity harness only). When installed, it is called with
// every value `next()` produces, in draw order. Pure bookkeeping: it MUST NOT
// draw rng or branch simulation behavior.
export type RngObserver = (value: number) => void;

// Deterministic seeded RNG (mulberry32) — all sim randomness must flow through this.
export class Rng {
  private s: number;
  // Default null: zero overhead and byte-identical output, so sim determinism is
  // unchanged unless a test deliberately installs an observer via setObserver().
  private observer: RngObserver | null = null;
  constructor(seed: number) {
    this.s = seed >>> 0;
    if (this.s === 0) this.s = 0x9e3779b9;
  }
  // Parity-harness seam: install (or clear, with null) a per-draw observer. Off
  // by default; the observer never affects the returned value or the state `s`.
  setObserver(observer: RngObserver | null): void {
    this.observer = observer;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    if (this.observer !== null) this.observer(value);
    return value;
  }
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }
  int(min: number, max: number): number {
    // inclusive
    return Math.floor(this.range(min, max + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)];
  }
}

// Stateless hash noise for terrain — deterministic from coordinates + seed.
export function hash2(x: number, y: number, seed: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (x * 374761393), 668265263);
  h = Math.imul(h ^ (y * 1274126177), 461845907);
  h ^= h >>> 13;
  h = Math.imul(h, 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

// Value noise in [0,1]
export function noise2(x: number, y: number, seed: number): number {
  const xi = Math.floor(x),
    yi = Math.floor(y);
  const xf = x - xi,
    yf = y - yi;
  const a = hash2(xi, yi, seed);
  const b = hash2(xi + 1, yi, seed);
  const c = hash2(xi, yi + 1, seed);
  const d = hash2(xi + 1, yi + 1, seed);
  const u = smooth(xf),
    v = smooth(yf);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

// Fractal noise in [0,1]
export function fbm2(x: number, y: number, seed: number, octaves = 4): number {
  let sum = 0,
    amp = 0.5,
    freq = 1,
    total = 0;
  for (let i = 0; i < octaves; i++) {
    sum += noise2(x * freq, y * freq, seed + i * 1013) * amp;
    total += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / total;
}
