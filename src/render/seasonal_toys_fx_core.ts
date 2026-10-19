// Hester's toys' visual plan (sim: src/sim/seasonal/seasonal_toys.ts; the Three half is
// seasonal_toys_fx.ts). Pure: no Three, no DOM, no clock, so a Vitest reads every curve.
//
// Each toy is a `seasonal_cosmetic` aura on a player (the prank's on its target), so the
// render reads it off the ordinary aura wire and every client agrees. This core answers:
// which toy looks a body wears and how far through each it is; where the thrown pumpkin
// is along its arc; where the ghost circles; where each bat of the swarm flies; how the
// candle's light breathes and where its three dancing shadows fall; and how the
// Gurglegreen Cauldron's brew bubbles and how the drink's green fizz boils off a drinker.
import { GOURDLIGHT_TOYS, type GourdlightToyEffect } from '../sim/content/gourdlight_eve';

/** The thrown pumpkin's flight (s): the head appears and the splat lands at its end. */
export const PRANK_FLIGHT_SEC = 0.65;
/** Its arc's height above the straight line between the hands and the head (yd). */
export const PRANK_ARC_HEIGHT = 2.2;
/** Bats in one swarm, and the pool's cap (three swarms at once). */
export const BAT_COUNT = 26;
export const BAT_CAP = BAT_COUNT * 3;
/** Ghosts, lanterns, candles and cauldrons drawn at once (each pool's cap). */
export const TOY_CAP = 8;
/** Thrown pumpkins in the air at once. */
export const PRANK_CAP = 6;
/** The prank's splat (played on landing, not on the throw). */
export const PRANK_SPLAT_SFX = 'impact_prank_pumpkin_splat';
/** The cauldron's bubbling, looped at its spot while it stands. */
export const CAULDRON_BUBBLE_SFX = 'gurglegreen_bubble_loop';
/** The Gurglegreen Cauldron as drawn: its scale against the authored pot (whose rim sits at
 *  CAULDRON_RIM_Y and whose belly bulges to CAULDRON_BELLY_R), and the drawn rim height and
 *  belly radius in yards that its click volume must wrap (pick_only_objects.ts). Round 11
 *  (owner playtest): a proper witch's cauldron, its rim about a player's waist, where round
 *  10's knee-high pot (1.25) was easy to lose in the grass and fiddly to click. */
export const CAULDRON_SCALE = 2.3;
export const CAULDRON_RIM_Y = 0.5;
export const CAULDRON_RIM_R = 0.3;
export const CAULDRON_BELLY_R = 0.39;
export const CAULDRON_DRAWN = Object.freeze({
  rimHeight: CAULDRON_RIM_Y * CAULDRON_SCALE,
  bellyRadius: CAULDRON_BELLY_R * CAULDRON_SCALE,
});
/** The mist's radius on the ground round the candle (yd). */
export const CANDLE_MIST_RADIUS = 3.4;

const BY_AURA: ReadonlyMap<string, GourdlightToyEffect> = new Map(
  GOURDLIGHT_TOYS.map((toy) => [toy.auraId, toy.effect]),
);
/** The prank's aura id (the head the thrown pumpkin leaves). */
export const PRANK_AURA_ID: string =
  GOURDLIGHT_TOYS.find((toy) => toy.effect === 'prank')?.auraId ?? '';

interface AuraLike {
  id: string;
  kind: string;
  remaining?: number;
  duration?: number;
  sourceId?: number;
  value2?: number;
  value3?: number;
}

/** One toy look a body wears right now. */
export interface ToyLook {
  effect: GourdlightToyEffect;
  auraId: string;
  /** Seconds since it began (from the aura's own timer). */
  elapsed: number;
  remaining: number;
  duration: number;
  sourceId: number;
  /** The lantern's or candle's spot, when it was set down. */
  spotX?: number;
  spotZ?: number;
}

/** The toy effect an aura id draws, or null for any other aura. */
export function toyEffectOf(auraId: string): GourdlightToyEffect | null {
  return BY_AURA.get(auraId) ?? null;
}

/** Every toy look in `auras`, in aura order (one per toy: the sim never stacks one). */
export function toyLooksOf(auras: readonly AuraLike[]): ToyLook[] {
  const out: ToyLook[] = [];
  for (const a of auras) {
    if (a.kind !== 'seasonal_cosmetic') continue;
    const effect = BY_AURA.get(a.id);
    if (!effect) continue;
    const duration = a.duration ?? 0;
    const remaining = Math.max(0, a.remaining ?? 0);
    const look: ToyLook = {
      effect,
      auraId: a.id,
      elapsed: Math.max(0, duration - remaining),
      remaining,
      duration,
      sourceId: a.sourceId ?? 0,
    };
    if (typeof a.value2 === 'number' && typeof a.value3 === 'number') {
      look.spotX = a.value2;
      look.spotZ = a.value3;
    }
    out.push(look);
  }
  return out;
}

/** Whether a body's auras carry a landed prank head (the flight is over). */
export function wearsPrankHead(auras: readonly AuraLike[]): boolean {
  for (const a of auras) {
    if (a.id !== PRANK_AURA_ID || a.kind !== 'seasonal_cosmetic') continue;
    const elapsed = (a.duration ?? 0) - (a.remaining ?? 0);
    if (elapsed >= PRANK_FLIGHT_SEC - 1e-6) return true;
  }
  return false;
}

/** The fade in and out of a look that lasts `duration` (0 to 1). */
export function lookFade(elapsed: number, remaining: number, fadeIn = 0.6, fadeOut = 1.2): number {
  const a = Math.min(1, Math.max(0, elapsed / fadeIn));
  const b = Math.min(1, Math.max(0, remaining / fadeOut));
  return a * b;
}

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/** The thrown pumpkin at `u` (0 at the hand, 1 on the head): a lob over a parabola, and
 *  its spin (radians) so it tumbles end over end. */
export function prankArc(from: Vec3Like, to: Vec3Like, u: number): Vec3Like & { spin: number } {
  const k = Math.min(1, Math.max(0, u));
  return {
    x: from.x + (to.x - from.x) * k,
    y: from.y + (to.y - from.y) * k + PRANK_ARC_HEIGHT * 4 * k * (1 - k),
    z: from.z + (to.z - from.z) * k,
    spin: k * Math.PI * 3,
  };
}

/** The ghost's offset from its keeper at time `t` (s since it came out): it circles at
 *  shoulder height, bobbing, leaning into its turn, and faces along its path. */
export function ghostOrbit(t: number, phase = 0): Vec3Like & { yaw: number; bob: number } {
  const w = 0.9;
  const a = t * w + phase;
  const r = 1.35 + 0.18 * Math.sin(t * 0.7 + phase);
  const bob = Math.sin(t * 2.1 + phase) * 0.16;
  return {
    x: Math.sin(a) * r,
    y: 1.55 + bob + 0.1 * Math.sin(t * 0.43),
    z: Math.cos(a) * r,
    // tangent of the circle (the direction of travel)
    yaw: a + Math.PI / 2,
    bob,
  };
}

/** A small deterministic hash in [0, 1) for bat `i` of a swarm (no rng: the look only). */
export function batHash(i: number, salt: number): number {
  const v = Math.sin(i * 127.1 + salt * 311.7) * 43758.5453;
  return v - Math.floor(v);
}

/** Bat `i` of a swarm `t` seconds after the sack opens: it bursts up out of the sack in
 *  a tight spiral round its opener, then scatters out and away; `alpha` fades it out at
 *  the end and `flap` is its wing beat (radians). Null once it has flown off. */
export function batFlight(
  i: number,
  t: number,
  life: number,
): (Vec3Like & { yaw: number; flap: number; alpha: number; scale: number }) | null {
  if (t < 0 || t > life) return null;
  const h0 = batHash(i, 1);
  const h1 = batHash(i, 2);
  const h2 = batHash(i, 3);
  const delay = h0 * 0.35;
  const s = t - delay;
  if (s < 0) return null;
  const spiral = Math.min(s / 1.6, 1);
  const out = Math.max(0, s - 1.1);
  const a = h1 * Math.PI * 2 + s * (4.2 + h2 * 2.2) * (1 - 0.5 * spiral);
  const r = 0.3 + 1.6 * spiral + out * (3.2 + h0 * 3);
  const y = 0.9 + 2.4 * spiral ** 0.8 + out * (1.2 + h1 * 1.8) + Math.sin(s * 6 + i) * 0.15;
  const flapRate = 22 + h2 * 10;
  const tail = life - delay;
  const alpha = Math.min(1, s / 0.15) * Math.min(1, Math.max(0, (tail - s) / 0.8));
  return {
    x: Math.sin(a) * r,
    y,
    z: Math.cos(a) * r,
    yaw: a + Math.PI / 2,
    flap: Math.sin(s * flapRate) * 0.9,
    alpha,
    scale: 0.75 + 0.5 * h1,
  };
}

/** The candle's mist strength (0 to 1): it spreads out over the first two seconds and
 *  thins away over the last three. */
export function candleMist(
  elapsed: number,
  remaining: number,
): { strength: number; radius: number } {
  const grow = Math.min(1, Math.max(0, elapsed / 2));
  const fade = Math.min(1, Math.max(0, remaining / 3));
  return { strength: grow * fade, radius: CANDLE_MIST_RADIUS * (0.35 + 0.65 * grow ** 0.7) };
}

/** A candle flame's flicker (0.7 to 1.15) at time `t`. */
export function candleFlicker(t: number, phase = 0): number {
  return 0.92 + 0.12 * Math.sin(t * 13 + phase) + 0.08 * Math.sin(t * 29.3 + phase * 2.1);
}

/** The candle's glow column (round of 2026-10-19): a soft green light standing over the dish and
 *  pale wisps climbing out of the flames, so the candle still shows where the grass hides
 *  its dish and its ground mist. Follows the mist's own grow and fade. */
export function candleGlowColumn(
  elapsed: number,
  remaining: number,
): { opacity: number; height: number; wispRate: number } {
  const { strength } = candleMist(elapsed, remaining);
  return { opacity: 0.16 * strength, height: 0.55 + 0.25 * strength, wispRate: 6 * strength };
}

/** Halo slots an accent glow leaves free for the pumpkin flights and their splats. */
export const HALO_PRANK_RESERVE = PRANK_CAP * 2;

/** Whether the glow pool (`used` of `size` handed out this frame) still has a slot: an
 *  accent (a candle's column, a cauldron's steam glow) never eats into the slots the
 *  pranks ask for last, so a crowded square keeps every pumpkin's flight and splat. */
export function haloSlotFree(used: number, size: number, accent: boolean): boolean {
  return used < (accent ? size - HALO_PRANK_RESERVE : size);
}

/** The three shadow shapes the candle's flames throw on the ground (round 10): a sitting
 *  cat, a bat on the wing, a witch with her broom. Index = the atlas cell. */
export const CANDLE_SHADOW_FIGURES = ['cat', 'bat', 'witch'] as const;
export type CandleShadowFigure = (typeof CANDLE_SHADOW_FIGURES)[number];

/** One dancing shadow, in the candle's ground frame: its bearing from the candle
 *  (radians, 0 = +z, measured toward +x), where its foot sits from the flame (yd), how
 *  long it is thrown (yd, along the bearing, away from the flame), how wide, and how dark
 *  (0 to 1). A shadow is cast AWAY from its light, so the foot is always nearest the
 *  flame and the head farthest: the tell that a candle is throwing it. */
export interface CandleShadow {
  figure: CandleShadowFigure;
  bearing: number;
  foot: number;
  length: number;
  width: number;
  alpha: number;
}

const SHADOW_SHAPE: Readonly<
  Record<CandleShadowFigure, { foot: number; length: number; width: number; drift: number }>
> = {
  // the cat sits close to the flame and is thrown long; it strolls slowly round
  cat: { foot: 0.8, length: 3.1, width: 1.7, drift: 0.22 },
  // the bat flits the other way, off the ground (its foot floats out from the flame)
  bat: { foot: 1.5, length: 2.1, width: 2.6, drift: -0.55 },
  // the witch is the tallest shadow, swaying as she circles
  witch: { foot: 0.75, length: 3.9, width: 1.8, drift: 0.16 },
};

/** The three shadows at `t` (s since the candle was lit). `flick` is the flames' flicker
 *  (candleFlicker, 0.7 to 1.15): every shadow stretches and shrinks with it, the way a
 *  shadow does when the flame behind it jumps. `fade` (0 to 1) is the look's own fade.
 *  Deterministic and pure: the same candle dances the same on every client. */
export function candleShadows(
  t: number,
  phase: number,
  flick: number,
  fade: number,
): CandleShadow[] {
  const grow = Math.min(1, Math.max(0, (t - 0.25) / 1.2));
  const out: CandleShadow[] = [];
  CANDLE_SHADOW_FIGURES.forEach((figure, i) => {
    const shape = SHADOW_SHAPE[figure];
    const sway = 0.32 * Math.sin(t * (1.1 + 0.37 * i) + phase + i);
    const bearing = phase + (i * Math.PI * 2) / 3 + t * shape.drift + sway;
    let foot = shape.foot;
    let length = shape.length;
    let width = shape.width;
    if (figure === 'cat') {
      // a little hop now and then: the shadow lurches longer off the ground
      length *= 1 + 0.12 * Math.max(0, Math.sin(t * 2.6 + phase)) ** 3;
    } else if (figure === 'bat') {
      // the wings beat: the shadow's span pumps, and it bobs in and out from the flame
      width *= 0.72 + 0.28 * Math.abs(Math.sin(t * 8.5 + phase));
      foot += 0.35 * Math.sin(t * 1.9 + phase);
    } else {
      length *= 1 + 0.06 * Math.sin(t * 1.7 + phase);
    }
    const stretch = 0.82 + (0.3 * (flick - 0.7)) / 0.45;
    out.push({
      figure,
      bearing,
      foot: foot * (0.9 + 0.1 * stretch),
      length: length * stretch * (0.35 + 0.65 * grow),
      width: width * (0.85 + 0.15 * stretch),
      alpha: Math.min(1, 0.8 * fade * grow * (0.82 + 0.18 * stretch)),
    });
  });
  return out;
}

/** The pool of candle light the shadows dance in: its radius (yd) and strength (0 to 1).
 *  It is what lets a dark shadow read at night (a shadow needs light round it). */
export function candleLightPool(
  elapsed: number,
  remaining: number,
  flick: number,
): { radius: number; strength: number } {
  const { strength } = candleMist(elapsed, remaining);
  return { radius: 4.6 + 0.4 * (flick - 0.92), strength: strength * (0.85 + 0.15 * flick) };
}

/** Bubbles a cauldron's brew swells and pops on its surface at once. */
export const CAULDRON_BUBBLES = 7;

/** Bubble `i` on the brew at `t` (s): where on the surface it rises (unit-disc x, z), how
 *  big it has swelled (0 to 1; it pops at the top of its life) and whether it just popped
 *  this cycle's frame band (`pop` near 1 for the last tenth of its life). Pure hash: every
 *  client bubbles the same cauldron alike. */
export function cauldronBubble(
  i: number,
  t: number,
): { x: number; z: number; size: number; pop: number } {
  const life = 0.7 + batHash(i, 7) * 0.9;
  const cycle = t / life + batHash(i, 8);
  const k = cycle - Math.floor(cycle);
  const n = Math.floor(cycle);
  const a = batHash(i * 13 + n, 9) * Math.PI * 2;
  const r = Math.sqrt(batHash(i * 7 + n, 10)) * 0.78;
  return {
    x: Math.cos(a) * r,
    z: Math.sin(a) * r,
    size: Math.sin(Math.min(1, k / 0.9) * Math.PI * 0.5) * (k < 0.9 ? 1 : 1 - (k - 0.9) / 0.1),
    pop: k > 0.9 ? (k - 0.9) / 0.1 : 0,
  };
}

/** How long the drink's green fizz plays over the drinker (s): the bubbles boil off them
 *  while the goblin body takes over, then the goblin is just a goblin (round 11; before, the
 *  green glow lasted the whole look). */
export const BREW_FIZZ_SEC = 2.6;

/** The drink's green fizz on the drinker (its strength, 0 to 1): it floods in at once (the
 *  gulp), holds while the body changes, and drains to nothing by BREW_FIZZ_SEC, so the
 *  goblin's own colours read for the rest of the look. */
export function brewGlow(elapsed: number, t: number): number {
  if (elapsed < 0 || elapsed >= BREW_FIZZ_SEC) return 0;
  const flood = Math.min(1, elapsed / 0.12);
  const drain = elapsed < 1.2 ? 1 : 1 - (elapsed - 1.2) / (BREW_FIZZ_SEC - 1.2);
  // held well under a full emissive flood: the body stays readable under the green wash
  return flood * drain * (0.22 + 0.05 * Math.sin(t * 5.2) + 0.02 * Math.sin(t * 12.7));
}
