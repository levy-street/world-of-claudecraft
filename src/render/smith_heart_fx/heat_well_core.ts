// The Guardian of the Heat's wellspring as numbers (the painter is
// heat_well_fx.ts, the plan of its look per phase heat_fight_fx_core.ts
// wellLook): how the molten pool moves and how its bubbles live.
//
// Why the flow is a two-phase flow map. The first pool advected its noise by
// `flow(p) * t`, with a flow that turned with the angle round the middle: the
// sample point's spread between two neighbouring pixels grew with the render
// clock, so after a minute the noise was sampled tens of cells apart across a
// pixel's width of angle and the pool tore into rays (a sunburst, worse the
// longer the session ran). Here each phase carries the field only over one
// `period` and restarts while its weight is zero, so the warp is bounded by
// `speed * period` yards whatever the clock: the same pool at second 5 and at
// hour 5.
//
// The flow: convection. The molten rock wells up under the guardian, spreads
// out to the lip with a slow turn, slows and cools there (the crust thickens
// toward the lip) and sinks. Its bubbles swell, then pop with a spark.
//
// Three-free, DOM-free, deterministic (the bubbles draw through the caller's
// rng, a cosmetic one).

/** The pool's flow: a phase's length (seconds), the outward speed and the
 *  turn (yards a second). */
export const WELL_FLOW = { period: 6, speed: 0.6, swirl: 0.18 } as const;

export interface WellFlowPhases {
  /** Each phase's age over its period (0..1). */
  a: number;
  b: number;
  /** Phase a's weight (b's is 1 - wa): zero when a restarts. */
  wa: number;
}

const fract = (v: number) => v - Math.floor(v);
const smooth = (e0: number, e1: number, x: number) => {
  const k = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return k * k * (3 - 2 * k);
};

/** The two phases at render time `t` (mirrors the pool shader). */
export function wellFlowPhases(
  t: number,
  out: WellFlowPhases = { a: 0, b: 0, wa: 0 },
): WellFlowPhases {
  out.a = fract(t / WELL_FLOW.period);
  out.b = fract(t / WELL_FLOW.period + 0.5);
  out.wa = 1 - Math.abs(1 - 2 * out.a);
  return out;
}

/** The outward speed at `rn` (0 the middle, 1 the lip), yards a second:
 *  still at the upwelling, fastest across the open pool, slowing at the lip
 *  (mirrors the shader). */
export function wellOutflow(rn: number): number {
  return WELL_FLOW.speed * smooth(0, 0.25, rn) * (1 - 0.6 * smooth(0.6, 1, rn));
}

/** The flow at (`lx`, `lz`) yards from the middle of a pool `r` yards
 *  across (yards a second, written into `out`): out with the convection,
 *  turning with the swirl (mirrors the shader's wellFlow). */
export function wellFlowAt(
  lx: number,
  lz: number,
  r: number,
  out: { x: number; z: number } = { x: 0, z: 0 },
): { x: number; z: number } {
  const d = Math.max(Math.hypot(lx, lz), 1e-3);
  const rn = d / Math.max(r, 1e-3);
  const dx = lx / d;
  const dz = lz / d;
  const o = wellOutflow(rn);
  const sw = WELL_FLOW.swirl * smooth(0, 0.3, rn);
  out.x = dx * o - dz * sw;
  out.z = dz * o + dx * sw;
  return out;
}

/** The furthest a phase ever drags the field (yards): bounded, at any clock. */
export function wellFlowMaxDrift(): number {
  return Math.hypot(WELL_FLOW.speed, WELL_FLOW.swirl) * WELL_FLOW.period;
}

/** How thick the crust lies at `rn` (0..1 of the surface plated), at heat
 *  `heat` (the plan's 0.7..1.45) and surge (0..1): thin over the upwelling,
 *  thick at the lip; a hotter pool and an overflow break it (mirrors the
 *  shader). */
export function wellCrust(rn: number, heat: number, surge: number): number {
  const k = Math.max(0, Math.min(1, (rn - 0.12) / 0.8));
  const lip = k * k * (3 - 2 * k);
  const base = 0.42 + 0.48 * lip;
  const hot = Math.max(0, Math.min(1, (heat - 0.7) / 0.75));
  return Math.max(0, base * (1 - 0.3 * hot) * (1 - 0.65 * surge));
}

// ---- the bubbles ------------------------------------------------------------------------

/** How many bubbles the pool keeps at once (the shader's array). */
export const WELL_BUBBLES = 8;

/** A bubble's life: it swells for most of it, pops over the last `pop`. */
export const WELL_BUBBLE = { life: [1.1, 2.1], size: [0.45, 1.25], pop: 0.14 } as const;

export interface WellBubble {
  /** Yards from the pool's middle. */
  x: number;
  z: number;
  /** Seconds lived, its life (age < 0: the slot is free). */
  age: number;
  life: number;
  /** Its full radius (yards). */
  size: number;
}

export function wellBubbleSlots(): WellBubble[] {
  return Array.from({ length: WELL_BUBBLES }, () => ({ x: 0, z: 0, age: -1, life: 1, size: 1 }));
}

/** A bubble's shape at its age: its radius now (yards) and its pop (0 while
 *  it swells, 0..1 over the burst). */
export function wellBubbleLook(
  b: WellBubble,
  out: { radius: number; pop: number } = { radius: 0, pop: 0 },
): { radius: number; pop: number } {
  if (b.age < 0) {
    out.radius = 0;
    out.pop = 0;
    return out;
  }
  const k = Math.max(0, Math.min(1, b.age / b.life));
  const swell = 1 - WELL_BUBBLE.pop;
  const g = Math.min(1, k / swell);
  out.radius = b.size * (0.25 + 0.75 * g * g * (3 - 2 * g));
  out.pop = k <= swell ? 0 : (k - swell) / WELL_BUBBLE.pop;
  return out;
}

/**
 * One frame of the bubbles: each ages; one past its life pops (`onPop` with
 * its spot, its size) and frees its slot; free slots refill at `rate` a
 * second (the plan's boil times the tier's density) somewhere over the open
 * pool (inside `r * 0.82` yards, never on the lip's stumps). Returns how many
 * popped.
 */
export function stepWellBubbles(
  slots: WellBubble[],
  dt: number,
  rate: number,
  r: number,
  rand: () => number,
  onPop: (x: number, z: number, size: number) => void,
): number {
  let popped = 0;
  for (const b of slots) {
    if (b.age < 0) continue;
    b.age += dt;
    if (b.age >= b.life) {
      onPop(b.x, b.z, b.size);
      b.age = -1;
      popped++;
    }
  }
  if (rate <= 0) return popped;
  for (const b of slots) {
    if (b.age >= 0) continue;
    if (rand() >= dt * rate) continue;
    const a = rand() * Math.PI * 2;
    const rr = Math.sqrt(rand()) * r * 0.82;
    b.x = Math.sin(a) * rr;
    b.z = Math.cos(a) * rr;
    b.age = 0;
    b.life = WELL_BUBBLE.life[0] + (WELL_BUBBLE.life[1] - WELL_BUBBLE.life[0]) * rand();
    b.size = WELL_BUBBLE.size[0] + (WELL_BUBBLE.size[1] - WELL_BUBBLE.size[0]) * rand();
    break;
  }
  return popped;
}
