// Pure plan of the Masterless Strength's Overload ring (Jose's brief of
// 2026-11-20: "not around the boss; in the middle of the room, where the boss
// stands at the start; something fills showing the percent of the current
// quarter and changes with each quarter"). The HUD's four bars are gone; the
// room's centre carries the bar instead (final_overload_ring.ts paints it):
//   - a great engraved ring inlaid in the floor round the central well fills
//     like a clock hand's sweep (0 to 100 percent) in the colour of the
//     quarter the boss drinks (HEART_QUARTER_PALETTE: the Heat's red-orange,
//     the Quench's ice blue, the Breath's storm violet, the Hammer's sand
//     gold), the well's glow and the light column over it rising with it
//     (no floating text over the well: Jose's playtest of 2026-11-20, the
//     ring's sweep and colour alone read);
//   - from four fifths full (OVERLOAD_RING.warnAt) it flickers, throws sparks
//     and sounds its warning;
//   - a quarter change recolours it at once and shows that quarter's own bar;
//   - with the boss in the centre ring (no quarter: nothing fills), before
//     the final phase, the ring turns red and pulses (the forbidden centre);
//   - through an intermission the bar is held (dimmed, no warning); in the
//     final phase and after it, and out of the fight, it is off.
// Every level is read off the boss's own auras (the bars, the state, the
// phase: encounters/smith_heart/final_ids.ts and
// final_phase_ids.ts), the same fields the HUD read, so offline and online
// read the same and no wire or IWorld field is new.
// Fairness: the fill, its colour, the warning and the centre's
// red draw on EVERY tier (actionable); the low tier sheds the sparks only;
// reduced motion trades the flicker and the pulse for a steady brighter
// light (no strobe), the fill unchanged.
//
// Three-free, DOM-free, deterministic.

import { HEART_ROOM, type SmithHeartVein } from '../../sim/content/smith_heart_layout';
import {
  FINAL_AURAS,
  finalZoneOf,
  overloadAuraId,
} from '../../sim/encounters/smith_heart/final_ids';
import { FINAL_PHASE_AURAS, finalStageOf } from '../../sim/encounters/smith_heart/final_phase_ids';
import { HEART_QUARTER_PALETTE, HEART_RING_LOOK } from '../smith_heart/heart_quarters_core';

/** The ring's measures (yards, room-local) and its thresholds. */
export const OVERLOAD_RING = {
  /** The inlay's inner and outer edge: on the floor just past the well's
   *  raised rim (HEART_RING_LOOK.rimOut), wide enough to read from the far
   *  rim of a quarter. */
  inner: HEART_RING_LOOK.rimOut + 0.9,
  outer: HEART_RING_LOOK.rimOut + 7.4,
  /** The bar's share the warning starts at (four fifths). */
  warnAt: 0.8,
  /** A second, sharper warning (its sound again). */
  warnAgainAt: 0.9,
  /** The centre's forbidden red. */
  centreColor: 0xff2a18,
  /** The held bar's dimming through an intermission. */
  heldDim: 0.45,
} as const;

export type OverloadRingMode = 'off' | 'fill' | 'held' | 'centre';

export interface OverloadRingAura {
  id: string;
  value?: number;
}

export interface OverloadRingBoss {
  dead?: boolean;
  auras: readonly OverloadRingAura[];
}

export interface OverloadRingState {
  mode: OverloadRingMode;
  /** The quarter it drinks (null: the centre, or off). */
  vein: SmithHeartVein | null;
  /** The bar, 0 to 1, and its whole percent. */
  fill: number;
  pct: number;
  /** The ring's colour (hex). */
  color: number;
  /** Four fifths full or more (never while held). */
  warn: boolean;
}

export function newOverloadRingState(): OverloadRingState {
  return { mode: 'off', vein: null, fill: 0, pct: 0, color: 0xffffff, warn: false };
}

function auraOf(auras: readonly OverloadRingAura[], id: string): OverloadRingAura | null {
  for (const a of auras) if (a.id === id) return a;
  return null;
}

/** The ring's state for `boss` (the Masterless Strength, or null), engaged
 *  (pulled: its fight runs), written into `out`. */
export function overloadRingState(
  boss: OverloadRingBoss | null,
  engaged: boolean,
  out: OverloadRingState,
): OverloadRingState {
  out.vein = null;
  out.fill = 0;
  out.pct = 0;
  out.warn = false;
  out.color = 0xffffff;
  const state = boss && !boss.dead && engaged ? auraOf(boss.auras, FINAL_AURAS.state) : null;
  if (!boss || !state) {
    out.mode = 'off';
    return out;
  }
  const stage = finalStageOf(auraOf(boss.auras, FINAL_PHASE_AURAS.phase)?.value);
  if (stage === 'final' || stage === 'kneel' || stage === 'rebirth' || stage === 'collapse') {
    out.mode = 'off';
    return out;
  }
  const held = stage === 'leap' || stage === 'call' || stage === 'finalLeap';
  const zone = finalZoneOf(state.value);
  if (zone === 'ring') {
    if (held) {
      out.mode = 'off';
      return out;
    }
    out.mode = 'centre';
    out.color = OVERLOAD_RING.centreColor;
    return out;
  }
  const bar = auraOf(boss.auras, overloadAuraId(zone));
  const pct = Math.max(0, Math.min(100, Math.round(bar?.value ?? 0)));
  out.mode = held ? 'held' : 'fill';
  out.vein = zone;
  out.pct = pct;
  out.fill = pct / 100;
  out.color = HEART_QUARTER_PALETTE[zone].color;
  out.warn = !held && out.fill >= OVERLOAD_RING.warnAt;
  return out;
}

/** The sweep the ring draws (0..1) eased toward the bar: a quarter change
 *  (or the ring first lit) snaps to that quarter's own bar at once; a bar
 *  that drains (a burst) falls fast; one that fills follows smoothly. */
export function easeSweep(shown: number, target: number, dt: number, snap: boolean): number {
  if (snap) return target;
  const rate = target < shown ? 12 : 6;
  return shown + (target - shown) * Math.min(1, dt * rate);
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp01((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export interface OverloadRingLook {
  /** 0 hides the whole ring. */
  shown: number;
  /** The filled share of the ring (its sweep). */
  sweep: number;
  /** The inlay's light (its filled arc), the well's glow and the column's
   *  height share (0..1 each). */
  light: number;
  well: number;
  column: number;
  /** The warning's level (0 under four fifths, 1 full), its flicker (a
   *  multiplier on the light, 1 steady) and sparks a second. */
  warn: number;
  flicker: number;
  sparks: number;
  /** The centre's red pulse (0..1; steady under reduced motion). */
  pulse: number;
}

export function newOverloadRingLook(): OverloadRingLook {
  return {
    shown: 0,
    sweep: 0,
    light: 0,
    well: 0,
    column: 0,
    warn: 0,
    flicker: 1,
    sparks: 0,
    pulse: 0,
  };
}

/** How the ring looks at render time `t` for `s` and its eased `sweep`.
 *  `low`: the low tier (sheds the sparks only). `reducedMotion`: no flicker
 *  and no pulse, a steady brighter light instead. */
export function overloadRingLook(
  s: OverloadRingState,
  sweep: number,
  t: number,
  low: boolean,
  reducedMotion: boolean,
  out: OverloadRingLook,
): OverloadRingLook {
  out.sweep = 0;
  out.warn = 0;
  out.flicker = 1;
  out.sparks = 0;
  out.pulse = 0;
  if (s.mode === 'off') {
    out.shown = 0;
    out.light = 0;
    out.well = 0;
    out.column = 0;
    return out;
  }
  out.shown = 1;
  if (s.mode === 'centre') {
    // The forbidden centre: the whole ring red, pulsing (steady and bright
    // under reduced motion); the well and the column burn red with it.
    const beat = 0.5 + 0.5 * Math.sin(t * 5.2);
    out.pulse = reducedMotion ? 0.85 : 0.45 + 0.55 * beat;
    out.sweep = 1;
    out.light = 0.75 + 0.25 * out.pulse;
    out.well = 0.6 + 0.4 * out.pulse;
    out.column = 0.55;
    return out;
  }
  const f = clamp01(sweep);
  out.sweep = f;
  const dim = s.mode === 'held' ? OVERLOAD_RING.heldDim : 1;
  out.light = (0.55 + 0.45 * f) * dim;
  out.well = (0.25 + 0.75 * f) * dim;
  out.column = (0.12 + 0.88 * f) * dim;
  if (s.warn) {
    out.warn = 0.35 + 0.65 * smooth(OVERLOAD_RING.warnAt, 1, f);
    if (reducedMotion) out.light = Math.min(1.25, out.light + 0.25);
    else {
      // A ragged flicker that quickens toward full: never dark, so the fill
      // stays readable through it.
      const rate = 9 + 14 * out.warn;
      const n = 0.5 + 0.25 * Math.sin(t * rate) + 0.25 * Math.sin(t * rate * 2.37 + 1.3);
      out.flicker = 1 - 0.38 * out.warn * n;
    }
    out.sparks = low ? 0 : 18 + 52 * out.warn;
  }
  return out;
}

/** The ring's own sound beat: the bar crossing nine tenths in the same
 *  quarter (a quarter change into a bar already past it stays silent: the
 *  recolour is its cue). The first warning, at four fifths, is the fight's
 *  own (game/smith_heart_final_audio_core.ts FINAL_OVERLOAD_RISING, its
 *  threshold this ring's warnAt), so the two never sound twice. */
export function ringWarnBeat(
  prevVein: SmithHeartVein | null,
  prevFill: number,
  vein: SmithHeartVein | null,
  fill: number,
): boolean {
  if (!vein || vein !== prevVein) return false;
  return prevFill < OVERLOAD_RING.warnAgainAt && fill >= OVERLOAD_RING.warnAgainAt;
}

// ---- the 100 percent explosion -----------------------------------------------------------

/** The explosion when a bar reaches 100 percent (Jose's playtest of
 *  2026-11-20: "when it hits 100 it should explode"). The sim's own signal
 *  drives it: its Overload Burst cue (FINAL_CUES.burst, a `spellfx` nova on
 *  the boss, final_rules.ts burstBar) as the bar empties and strikes the
 *  raid, the same event FinalFx already reads for the body's wall of light,
 *  so offline and online play it alike and nothing new crosses the wire.
 *  The beats, in seconds from the cue (yards room-local):
 *    - a white-hot flash over the well, the quarter's colour round it;
 *    - a shockwave racing out over the floor from the ring's outer edge to
 *      the platform's rim, a hot crest and a scorched wake; a thinner, faster
 *      second ring ahead of it;
 *    - the column surging up its full height, a bright front climbing it;
 *    - the ring flaring full, holding a breath, then draining back to empty
 *      round the dial so the raid sees the bar reset;
 *    - debris and sparks thrown off the ring and up the column (cosmetic:
 *      the low tier sheds them; the flash, the shockwave, the surge and the
 *      drain draw on every tier, the raid reads the hit off them). */
export const OVERLOAD_BURST = {
  /** The whole explosion, past which it is done. */
  span: 2.8,
  /** The flash's rise and its fade. */
  flashRise: 0.05,
  flashSpan: 0.55,
  /** Reduced motion: the flash's peak (no full white-out). */
  flashCalm: 0.55,
  /** The main shockwave: where it starts (the ring's outer edge), where it
   *  ends (the platform's rim), its run, its crest's width (yards). */
  shockFrom: OVERLOAD_RING.outer,
  shockTo: HEART_ROOM.r,
  shockSpan: 1.15,
  shockWidth: 2.2,
  /** The second ring: from the well's rim, a little faster. */
  shock2From: HEART_RING_LOOK.rimOut,
  shock2Span: 0.8,
  /** The column's surge: up over this long, fading over the span. */
  surgeRise: 0.32,
  surgeSpan: 1.6,
  /** The ring held full a breath, then drained over this long. */
  hold: 0.25,
  drain: 1.05,
  /** The high tier's debris and sparks (thinned by the tier's share; none
   *  on the low tier). */
  debris: 48,
  sparks: 120,
} as const;

export interface OverloadBurstLook {
  /** The explosion is playing. */
  live: boolean;
  /** The flash's level (0..1). */
  flash: number;
  /** The main shockwave's front (yards from the centre) and its level. */
  shockR: number;
  shockAlpha: number;
  /** The second ring's front and level. */
  shock2R: number;
  shock2Alpha: number;
  /** The column's surge (0..1) and its bright front's height share. */
  surge: number;
  surgeFront: number;
  /** The share of the full ring still lit (1 full, 0 empty): the drain. */
  drain: number;
  /** The ring's flare over its own light (0..1). */
  flare: number;
}

export function newOverloadBurstLook(): OverloadBurstLook {
  return {
    live: false,
    flash: 0,
    shockR: 0,
    shockAlpha: 0,
    shock2R: 0,
    shock2Alpha: 0,
    surge: 0,
    surgeFront: 0,
    drain: 0,
    flare: 0,
  };
}

/** The explosion `age` seconds after the cue (negative or past its span:
 *  not live). `reducedMotion` caps the flash (no white-out); every other
 *  beat is the same. */
export function overloadBurstLook(
  age: number,
  reducedMotion: boolean,
  out: OverloadBurstLook,
): OverloadBurstLook {
  const B = OVERLOAD_BURST;
  if (!(age >= 0 && age < B.span)) {
    out.live = false;
    out.flash = 0;
    out.shockAlpha = 0;
    out.shock2Alpha = 0;
    out.surge = 0;
    out.surgeFront = 0;
    out.drain = 0;
    out.flare = 0;
    return out;
  }
  out.live = true;
  const flash =
    age < B.flashRise ? age / B.flashRise : Math.max(0, 1 - (age - B.flashRise) / B.flashSpan) ** 2;
  out.flash = flash * (reducedMotion ? B.flashCalm : 1);
  // The fronts ease out: a slam that slows as it spreads.
  const k = clamp01(age / B.shockSpan);
  out.shockR = B.shockFrom + (B.shockTo - B.shockFrom) * (1 - (1 - k) ** 2.4);
  out.shockAlpha = age < B.shockSpan ? (1 - smooth(0.55, 1, k)) * Math.min(1, age / 0.04) : 0;
  const k2 = clamp01(age / B.shock2Span);
  out.shock2R = B.shock2From + (B.shockTo + 6 - B.shock2From) * (1 - (1 - k2) ** 1.8);
  out.shock2Alpha = age < B.shock2Span ? 0.7 * (1 - k2) : 0;
  out.surge =
    age < B.surgeRise
      ? smooth(0, 1, age / B.surgeRise)
      : Math.max(0, 1 - (age - B.surgeRise) / (B.surgeSpan - B.surgeRise)) ** 1.5;
  out.surgeFront = clamp01(age / (B.surgeRise * 1.6));
  out.drain = age < B.hold ? 1 : 1 - smooth(0, 1, (age - B.hold) / B.drain);
  out.flare = age < B.hold ? 1 : Math.max(0, 1 - (age - B.hold) / (B.drain * 0.6));
  return out;
}

/** How many pieces of debris and sparks the explosion throws: none on the
 *  low tier (cosmetic), the high tier's count thinned by its share. */
export function overloadBurstPieces(
  low: boolean,
  share: number,
): { debris: number; sparks: number } {
  if (low) return { debris: 0, sparks: 0 };
  const s = Math.max(0, Math.min(1, share));
  return {
    debris: Math.round(OVERLOAD_BURST.debris * s),
    sparks: Math.round(OVERLOAD_BURST.sparks * s),
  };
}
