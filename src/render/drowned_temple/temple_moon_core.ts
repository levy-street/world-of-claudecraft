// Pure plan for Ysolei calling the moon (temple_moon_fx.ts; sim:
// src/sim/encounters/drowned_temple/ysolei_moon.ts): how far the sky's moon
// swells, how low it drops toward the island and how dark its eclipse runs,
// read off her bars and auras; how cracked her Plenilune Ward looks from its
// absorb left; how far a rolling tear has turned; and the timings of the
// comet, the bursts and the shockwave.
//
// Three-free, DOM-free, deterministic (RENDER_PURE_CORES).

/** The sky moon's look (the shared uniforms temple_moon_sky.ts carries): the
 *  disc grows by `swell` (0: its own size, 2: three times), its direction
 *  drops by `drop` toward the horizon, and `eclipse` darkens the disc to a
 *  corona ring. All 0 is the untouched sky. */
export interface MoonSkyLook {
  swell: number;
  drop: number;
  eclipse: number;
}

/** What the moon answers to this frame, read off Ysolei. Bar fractions run 0
 *  as a bar opens to 1 as it lands; null while that bar is not running. */
export interface MoonSkyInput {
  /** The Beckoning Moon's bar fraction. */
  beckoning: number | null;
  /** Moonlight Tears still rolling (the moon stays close while they do). */
  tears: number;
  /** The Falling Moon's bar fraction (the moon descends over it). */
  falling: number | null;
  /** Seconds left on her Eclipsed reel, or 0. */
  eclipsedLeft: number;
  /** Seconds since the moon fell (the column), or a large number. */
  sinceFall: number;
}

/** The moon called close: the swell it holds through the call and the tears. */
export const MOON_CALL_SWELL = 0.6;
/** The full moon's descent: the swell and the drop at the bar's end. */
export const MOON_FALL_SWELL = 2;
export const MOON_FALL_DROP = 0.18;
/** Seconds the moon blazes at its lowest after it falls, before easing home. */
export const MOON_FALL_HOLD = 1.2;
/** The eclipse fades back out over its last seconds. */
export const ECLIPSE_FADE = 1.5;

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Smooth ease in and out on [0, 1]. */
export function easeInOut(t: number): number {
  const k = clamp01(t);
  return k * k * (3 - 2 * k);
}

/** The look the moon is heading for. Reduced motion keeps the swell and the
 *  drop at half (the eclipse, a state, stays whole). Fills `out`. */
export function moonSkyTarget(input: MoonSkyInput, calm: boolean, out: MoonSkyLook): MoonSkyLook {
  let swell = 0;
  let drop = 0;
  if (input.falling !== null) {
    const k = easeInOut(input.falling);
    swell = 0.3 + (MOON_FALL_SWELL - 0.3) * k;
    drop = MOON_FALL_DROP * k;
  } else if (input.sinceFall < MOON_FALL_HOLD) {
    swell = MOON_FALL_SWELL;
    drop = MOON_FALL_DROP;
  } else if (input.beckoning !== null) {
    swell = MOON_CALL_SWELL * easeInOut(input.beckoning);
  } else if (input.tears > 0) {
    swell = MOON_CALL_SWELL;
  }
  const mute = calm ? 0.5 : 1;
  out.swell = swell * mute;
  out.drop = drop * mute;
  out.eclipse = input.eclipsedLeft > 0 ? clamp01(input.eclipsedLeft / ECLIPSE_FADE) : 0;
  return out;
}

/** One frame of an exponential approach of `cur` toward `target` at `rate`
 *  per second (frame-rate independent). */
export function approach(cur: number, target: number, dt: number, rate: number): number {
  const k = 1 - Math.exp(-Math.max(0, dt) * rate);
  const next = cur + (target - cur) * k;
  return Math.abs(next - target) < 1e-4 ? target : next;
}

/** How cracked the Plenilune Ward reads: 0 whole, 1 about to break, from its
 *  absorb left (`value`) and its full size (`value2`). */
export function wardCrack(value: number, full: number | undefined): number {
  if (!full || full <= 0) return 0;
  return 1 - clamp01(value / full);
}

/** How far (radians) a tear of `radius` yards has turned rolling `travelled`
 *  yards over the slabs. */
export function tearRollAngle(travelled: number, radius: number): number {
  return radius > 0 ? travelled / radius : 0;
}

/** A tear's comet falls this long from the sky onto its landing spot. */
export const COMET_SECONDS = 0.25;
/** How high above the island the comet starts (yards). */
export const COMET_HEIGHT = 46;

/** The comet's head above its spot at `age` seconds (accelerating, 0 at impact). */
export function cometHeight(age: number): number {
  const k = clamp01(age / COMET_SECONDS);
  return COMET_HEIGHT * (1 - k * k);
}

/** A burst's look over its life: grows fast (`grow` 0 to 1) and fades out
 *  (`alpha` 1 to 0, squared). Done at `age >= life`. */
export interface BurstEnvelope {
  grow: number;
  alpha: number;
  done: boolean;
}

export function burstEnvelope(age: number, life: number): BurstEnvelope {
  return burstEnvelopeInto(age, life, { grow: 0, alpha: 0, done: false });
}

/** burstEnvelope into a caller-owned record (the per-frame painter's form). */
export function burstEnvelopeInto(age: number, life: number, out: BurstEnvelope): BurstEnvelope {
  const k = life > 0 ? clamp01(age / life) : 1;
  out.grow = 1 - (1 - k) * (1 - k) * (1 - k);
  out.alpha = (1 - k) * (1 - k);
  out.done = k >= 1;
  return out;
}

/** The ward's pulse rate (cycles of 2 pi per second): quicker as it cracks,
 *  slow and steady under reduced motion. Its phase is accumulated by the
 *  painter (phase += rate * dt), so a change of rate never jumps the pulse. */
export function wardPulseRate(crack: number, calm: boolean): number {
  return calm ? 1.5 : 2 + 6 * clamp01(crack);
}

/** The Moonswell halo's brightness for her stacks (0 with none, full at 6). */
export function moonswellGlow(stacks: number): number {
  if (stacks <= 0) return 0;
  return clamp01(0.3 + 0.12 * (stacks - 1));
}

/** The camera kick for a moon impact `d` yards from the local player: the
 *  `near` strength inside `nearR`, `far` inside `farR`, else none. */
export function moonShake(
  d: number,
  near: number,
  nearR: number,
  far: number,
  farR: number,
): number {
  if (d <= nearR) return near;
  if (d <= farR) return far;
  return 0;
}
