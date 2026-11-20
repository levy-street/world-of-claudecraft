// Avalanche's look as numbers (Elemental Fusion of the Quench and the Hammer;
// the sim's lanes in src/sim/encounters/smith_heart/final_fusion.ts). Jose's
// playtest of 2026-11-20 read the old cones as "not very AAA": this is the
// eruption he asked for, every beat a pure function of time so a Vitest
// drives it and the painter (final_avalanche_fx.ts) only draws it.
//
//   The spikes   a row of ice crystals and broken stone along each lane, each
//                its own height, girth, lean and turn (hashed off the lane and
//                its index), set off the lane's centreline within its half
//                width; ice two in three, stone the rest.
//   The eruption as the sim's front passes a spike it BURSTS up through the
//                floor with an overshoot (`spikeEruption`), shivers as it
//                holds, then cracks, tilts, sinks and crumbles away, shedding
//                chunks; nothing pops out when the sim's lane object goes
//                (the painter keeps the lane until its last spike is gone,
//                `AVALANCHE_LIFE`).
//   The debris   chunks thrown up and out on each burst and dropping off on
//                the crumble, on a ballistic arc (`debrisAt`).
//   The scar     the floor torn open along the lane behind the front, frost in
//                its cracks, fading once the last spike has crumbled
//                (`scarLook`).
// Imports nothing of three.js; registered in RENDER_PURE_CORES.

/** The eruption's beats (seconds after the front reaches a spike). */
export const AVALANCHE_BEATS = {
  /** The burst up through the floor (an overshoot past full height). */
  burst: 0.16,
  /** How far past its height a spike overshoots at the burst's peak. */
  overshoot: 0.14,
  /** It holds (a faint shiver) until here. */
  hold: 0.95,
  /** Then cracks, tilts, sinks and crumbles away over this long. */
  crumble: 0.8,
} as const;

/** Spikes a lane, chunks a spike (the painter's pools are sized off them). */
export const AVALANCHE_POOLS = {
  lanes: 12,
  spikesPerLane: 14,
  chunksPerSpike: 3,
} as const;

/** How long after its run began a lane is still drawn (its last spike's
 *  crumble and the scar's fade). */
export function avalancheLife(run: number): number {
  return run + AVALANCHE_BEATS.hold + AVALANCHE_BEATS.crumble + SCAR_FADE;
}

/** The scar fades over this long once the last spike has crumbled. */
export const SCAR_FADE = 1.2;

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** A small integer hash to 0..1 (stable across hosts). */
export function avalancheHash(a: number, b: number): number {
  let h = (Math.imul(a | 0, 0x45d9f3b) ^ Math.imul((b | 0) + 0x9e3779b9, 0x119de1f3)) >>> 0;
  h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  return h / 0x100000000;
}

export interface AvalancheSpike {
  /** Yards along the lane from its start. */
  along: number;
  /** Yards off the centreline (signed). */
  side: number;
  /** Full height (yards). */
  height: number;
  /** Girth (the geometry's unit radius scale). */
  girth: number;
  /** Its lean (radians) and the direction it leans (radians round). */
  lean: number;
  leanDir: number;
  /** Its turn about its own axis. */
  yaw: number;
  ice: boolean;
}

/** The `k`-th spike of lane `seed` (`length` yards, `half` its half width).
 *  Two staggered rows, every spike its own. */
export function avalancheSpike(
  seed: number,
  k: number,
  length: number,
  half: number,
): AvalancheSpike {
  const n = AVALANCHE_POOLS.spikesPerLane;
  const h = (j: number) => avalancheHash(seed * 31 + k, j);
  const row = k % 2 === 0 ? -1 : 1;
  const along = ((k + 0.35 + 0.3 * h(1)) / n) * length;
  const side = row * half * (0.25 + 0.4 * h(2));
  const ice = h(3) < 0.67;
  // The stone breaks out lower and broader; the ice stands tall and thin.
  const height = ice ? 3.6 + 2.6 * h(4) : 2.4 + 1.6 * h(4);
  const girth = ice ? 0.95 + 0.45 * h(5) : 1.3 + 0.5 * h(5);
  return {
    along,
    side,
    height,
    girth,
    lean: 0.08 + 0.32 * h(6),
    // Leaning forward along the run, splayed out to its own row's side.
    leanDir: row * (0.6 + 0.6 * h(7)),
    yaw: h(8) * Math.PI * 2,
    ice,
  };
}

export interface SpikeEruption {
  /** Height share (0 underground, 1 full, past 1 at the burst's peak). */
  rise: number;
  /** Girth share (it swells out of the floor). */
  swell: number;
  /** Extra tilt as it cracks and topples (radians). */
  topple: number;
  /** How deep it has sunk back into the floor (share of its height). */
  sink: number;
  /** 0..1 through the crumble (0 before it). */
  crumble: number;
  /** Drawn at all. */
  shown: boolean;
}

const OUT: SpikeEruption = { rise: 0, swell: 0, topple: 0, sink: 0, crumble: 0, shown: false };

/** A spike `since` seconds after the front reached it (negative: still to
 *  come). Writes and returns one shared record (never allocates). */
export function spikeEruption(since: number): SpikeEruption {
  const B = AVALANCHE_BEATS;
  const o = OUT;
  o.topple = 0;
  o.sink = 0;
  o.crumble = 0;
  if (since < 0 || since > B.hold + B.crumble) {
    o.rise = 0;
    o.swell = 0;
    o.shown = false;
    return o;
  }
  o.shown = true;
  if (since < B.burst) {
    // An ease-out-back: fast out of the floor, past its height, settling.
    const t = since / B.burst;
    const c = 1.70158 * (1 + B.overshoot * 4);
    const u = t - 1;
    o.rise = 1 + (c + 1) * u * u * u + c * u * u;
    o.swell = 0.55 + 0.45 * t;
    return o;
  }
  if (since < B.hold) {
    const t = (since - B.burst) / (B.hold - B.burst);
    // Settling back from the overshoot with a fading shiver.
    o.rise = 1 + 0.03 * Math.sin(since * 46) * (1 - t);
    o.swell = 1;
    return o;
  }
  const t = clamp01((since - B.hold) / B.crumble);
  o.crumble = t;
  o.rise = 1 - 0.15 * t;
  o.swell = 1 - 0.55 * t * t;
  o.topple = 0.35 * t * t;
  o.sink = 0.65 * t * t;
  return o;
}

/** One chunk's offset from its spike's foot and its spin, `t` seconds after
 *  it was thrown (`kind` 0 the burst's, 1 the crumble's), or null once it
 *  has landed and gone. Writes `out` (x along the lane's side, y up, z
 *  along). */
export function debrisAt(
  seed: number,
  k: number,
  kind: 0 | 1,
  t: number,
  height: number,
  out: { x: number; y: number; z: number; spin: number; size: number },
): boolean {
  const life = kind === 0 ? 0.85 : 0.7;
  if (t < 0 || t > life) return false;
  const h = (j: number) => avalancheHash(seed * 7 + k * 13 + kind * 101, j);
  const a = h(1) * Math.PI * 2;
  const out0 = kind === 0 ? 3 + 4 * h(2) : 1 + 1.5 * h(2);
  const up = kind === 0 ? 6 + 6 * h(3) : 0.5 + 1.5 * h(3);
  const y0 = kind === 0 ? 0.3 : height * (0.3 + 0.5 * h(4));
  const g = 24;
  out.x = Math.cos(a) * out0 * t;
  out.z = Math.sin(a) * out0 * t;
  out.y = Math.max(0, y0 + up * t - 0.5 * g * t * t);
  out.spin = (h(5) - 0.5) * 14 * t;
  // Shrinking as it falls off (it breaks up).
  out.size = (0.25 + 0.35 * h(6)) * (1 - 0.6 * (t / life));
  return true;
}

/** The scar's look: how far along the lane it is torn (0..1 of its length),
 *  its opacity and its frost glow, `sinceRun` seconds after the run began. */
export function scarLook(
  sinceRun: number,
  run: number,
): { front: number; alpha: number; glow: number } {
  const B = AVALANCHE_BEATS;
  const front = clamp01(sinceRun / Math.max(0.05, run));
  const end = run + B.hold + B.crumble;
  const alpha = sinceRun < end ? 1 : clamp01(1 - (sinceRun - end) / SCAR_FADE);
  // The cracks glow hot-cold as they open, then cool to frost.
  const glow = 0.35 + 0.65 * clamp01(1 - (sinceRun - run) / 1.4);
  return { front, alpha: sinceRun < 0 ? 0 : alpha, glow };
}
