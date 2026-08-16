// Exhaust decisions for a piped vehicle: where the ports are, how hard each
// one should be smoking, and the one moment worth punctuating with fire.
//
// Pure: no Three, no audio. The caller hands over the engine phase and gets
// back rates and a yes/no on the flame.

/** One tailpipe, as a model-space offset from the chassis origin.
 *
 * These are MEASURED off the shipped mesh rather than authored as nodes,
 * because Tripo left the pipes as bare primitives inside the Chassis mesh with
 * no empties to hang a name on. That makes them the one part of this mount that
 * a re-rip does NOT carry forward for free, so `rallycart_exhaust_ports.test.ts`
 * re-finds them in the GLB and fails if they move. If the model is ever
 * re-exported, adding four `Exhaust_*` empties would turn this into the same
 * name-based contract everything else here uses.
 */
export interface ExhaustPort {
  x: number;
  y: number;
  z: number;
  /** Density multiplier for this pipe. Three of the four tubes on this model
   *  are rough, so they smoke harder to break up their outline; the clean one
   *  stays visible. Cosmetic, and the first thing to flatten to 1 if a re-rip
   *  produces four good pipes. */
  weight: number;
}

/** The Rallycart's four pipes, two per side under the rear bumper.
 *
 *  Ordered outer-left, inner-left, inner-right, outer-right in MODEL space
 *  (the car faces +z). Viewed from behind the car the order reverses, because
 *  a viewer looking down +z has their right hand toward -x. */
export const RALLYCART_EXHAUST_PORTS: readonly ExhaustPort[] = [
  // The clean one: right-most as you stand behind the car.
  { x: -0.155, y: 0.114, z: -0.478, weight: 0.6 },
  { x: -0.121, y: 0.114, z: -0.488, weight: 1.15 },
  { x: 0.116, y: 0.114, z: -0.488, weight: 1.15 },
  { x: 0.153, y: 0.114, z: -0.488, weight: 1.1 },
];

/** Smoke spawn attempts per second for the whole car, by engine phase.
 *
 *  These are TOTALS, split across the ports, not per pipe. The particle pool is
 *  a shared ring buffer, so four ports cost nothing over one for the same
 *  count; what costs is the count, and that is this table.
 */
const SMOKE_RATE = {
  /** Parked and running. Present on purpose: the cart idles audibly from
   *  summon onward, and standing still is when a rider actually looks at the
   *  back of it. */
  idle: 5,
  /** Under the windup, climbing with it. */
  starting: 13,
  moving: 16,
  /** Trailing off through the winddown. */
  stopping: 7,
} as const;

/** Reverse is a lower gear and should not read as a second launch. */
const REVERSE_SCALE = 0.55;

/** Turning on the spot: working, but going nowhere. Between idle and moving. */
const PIVOT_SCALE = 1.7;

export type ExhaustPhase = 'idle' | 'starting' | 'moving' | 'stopping';

/**
 * Seconds into the windup take at which the acceleration transient lands.
 *
 * A property of the RECORDING, not a feel value: the take's envelope climbs
 * from -22dB and reaches its plateau at 0.35s, holding through 0.75s with its
 * loudest window at 0.65s. Re-cut the audio and this moves.
 *
 * The take runs 3.63s in total, so this fires early in the launch and NOT at
 * the handoff into the sustain loop, which is a deliberately smooth join with
 * nothing to punctuate.
 */
export const EXHAUST_FLAME_AT = 0.6;

/** Total smoke attempts per second right now. */
export function exhaustSmokeRate(
  phase: ExhaustPhase,
  reversing: boolean,
  pivoting: boolean,
): number {
  const base = SMOKE_RATE[phase];
  if (reversing) return base * REVERSE_SCALE;
  if (pivoting && phase === 'idle') return base * PIVOT_SCALE;
  return base;
}

/**
 * Whether the launch flame should fire this frame.
 *
 * `elapsed` is seconds since the phase began ON THE AUDIO CLOCK, so this lands
 * on the transient itself rather than near it, and stays there through a frame
 * hitch. `fired` is the caller's latch: the burst is one event per launch, not
 * a per-frame test that would keep re-triggering for the rest of the windup.
 */
export function exhaustFlameDue(phase: ExhaustPhase, elapsed: number, fired: boolean): boolean {
  return !fired && phase === 'starting' && elapsed >= EXHAUST_FLAME_AT;
}

/** True once the engine has left the windup, so the latch can re-arm. */
export function exhaustFlameRearms(phase: ExhaustPhase): boolean {
  return phase !== 'starting';
}
