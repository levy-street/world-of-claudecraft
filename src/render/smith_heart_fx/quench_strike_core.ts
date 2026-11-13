// Tempering Strike on the Guardian of the Quench, as numbers (round 2 of her
// look, the lead's notes of 2026-11-08: the two-fisted gesture was invisible
// because its cue fires on the hit). The fight now cues her wind-up a second
// ahead of the cleaving swing (sim quench_strike_windup.ts, QUENCH_CUES
// .strikeReady): her fists rise over her head as the cold gathers on her
// bracers (`quenchStrikeWindLook`), then hammer down on the ice on the clip's
// beat, where the lake cracks open (`quenchStrikeCrackLook`, painted by
// quench_strike_cracks.ts) and shards are thrown. No white-out: the flash is
// on the fists only (QUENCH_BURST).
// Node-only (RENDER_PURE_CORES): no three.js, no DOM, deterministic.

import { QUENCH_TUNING } from '../../sim/encounters/smith_heart/quench_ids';

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** Seconds from the wind-up cue to the fists on the ice (the StrikeWind
 *  clip's contact, frame 30 at 30 fps; the sim cues it this far ahead). */
export const QUENCH_STRIKE_WIND = QUENCH_TUNING.strikeWindup;

/** A wind-up seen this recently owns the swing's outcome (round 3): the
 *  cleave's own cue then plays the slam from her raised fists (StrikeSlam), an
 *  avoided swing's cue a plain swing (StrikeSpent). Past it the raise has
 *  lowered on its own (the StrikeRaise clip's hold). */
export const QUENCH_STRIKE_WIND_OWNS = 1.6;

/** Round 4: her fists meet the ice on the frame the cleave lands. The fight
 *  cues the wind-up exactly `strikeWindup` seconds before the swing (a fixed
 *  countdown of her swing timer), so the body starts the downswing
 *  (StrikeFall) `lead` seconds ahead of it: on the swing her fists are low
 *  over the ice in front of her, crouched. The cleave's cue then finishes the
 *  blow on its own frame (StrikeSlam's contact is its first frame, faded in
 *  over `slamFade`); an avoided swing's cue sweeps them aside over the ice
 *  without touching it (StrikeSpent, no cracks). No outcome `grace` seconds
 *  past the swing (her target left her reach, a bar took her): she lets the
 *  blow go the same plain way. The sim's damage is never delayed: only the
 *  downswing's start moves earlier. */
export const QUENCH_STRIKE_FALL = {
  lead: 6 / 30,
  grace: 0.35,
  slamFade: 0.02,
  spentFade: 0.08,
} as const;

/** What the downswing does `sinceWind` seconds after the wind-up cue, for a
 *  wind-up still waiting on its swing: 'fall' once (the downswing begins),
 *  'release' once the swing is overdue (let the blow go), else null. */
export function quenchStrikeFallStep(
  sinceWind: number,
  fallen: boolean,
  casting: boolean,
): 'fall' | 'release' | null {
  if (!fallen) {
    if (casting) return null;
    return sinceWind >= QUENCH_STRIKE_WIND - QUENCH_STRIKE_FALL.lead ? 'fall' : null;
  }
  return sinceWind >= QUENCH_STRIKE_WIND + QUENCH_STRIKE_FALL.grace ? 'release' : null;
}

/** Has the downswing begun `sinceWind` seconds after the wind-up cue (so the
 *  outcome lands from her low fists, StrikeSlam / StrikeSpent), or does the
 *  outcome come early and play from her raised fists (the High clips)? */
export function quenchStrikeFallen(sinceWind: number): boolean {
  return sinceWind >= QUENCH_STRIKE_WIND - QUENCH_STRIKE_FALL.lead;
}

/** Tempering Strike's spikes ripple out behind the cracks (round 3: the
 *  cracks were hidden under spikes that all stood at once): the first spike
 *  waits `lead` seconds after the fists land (the cracks open first), the
 *  farthest `lead + sweep`. */
export const QUENCH_STRIKE_RIPPLE = { lead: 0.16, sweep: 0.32 } as const;

/** Seconds after the fists land that a spike `reach` (0..1 of the strike's
 *  range) out begins to rise. */
export function quenchStrikeSpikeDelay(reach: number): number {
  return QUENCH_STRIKE_RIPPLE.lead + QUENCH_STRIKE_RIPPLE.sweep * clamp01(reach);
}

/** The wind-up `t` seconds after its cue: the cold gathering on her bracers
 *  (0..1, building to the slam) and their glow (past 1 blazing). */
export function quenchStrikeWindLook(
  t: number,
  out: { gather: number; bracers: number } = { gather: 0, bracers: 0 },
): { gather: number; bracers: number } {
  if (t < 0 || t >= QUENCH_STRIKE_WIND) {
    out.gather = 0;
    out.bracers = 0;
    return out;
  }
  const k = clamp01(t / QUENCH_STRIKE_WIND);
  out.gather = clamp01(k * 1.4) * (1 - clamp01((k - 0.9) / 0.1) * 0.5);
  out.bracers = 0.8 + 2.2 * k * k;
  return out;
}

/** The cracks: their reach (yards), the rays. */
export const QUENCH_STRIKE_CRACKS = {
  radius: 9,
  rays: 9,
  open: 0.18,
  hold: 1.5,
  fade: 0.9,
  pool: 2,
} as const;

/** The cracks `age` seconds after the fists landed: how far open (0..1),
 *  their strength and the cold light in them. */
export function quenchStrikeCrackLook(
  age: number,
  out: { open: number; alpha: number; glow: number } = { open: 0, alpha: 0, glow: 0 },
): { open: number; alpha: number; glow: number } {
  const K = QUENCH_STRIKE_CRACKS;
  if (age < 0 || age > K.open + K.hold + K.fade) {
    out.open = 0;
    out.alpha = 0;
    out.glow = 0;
    return out;
  }
  out.open = 1 - (1 - clamp01(age / K.open)) ** 3;
  out.alpha = clamp01(1 - (age - K.open - K.hold) / K.fade);
  out.glow = 0.45 + 0.55 * clamp01(1 - age / (K.open + K.hold));
  return out;
}

/** The cracks' palette (linear 0..1): lake-deep edges, a cold cyan light. */
export const QUENCH_STRIKE_COLORS = {
  crackDeep: [0.02, 0.08, 0.24] as const,
  crackCore: [0.4, 0.9, 1.0] as const,
  crackHot: [0.85, 1.0, 1.0] as const,
  gather: [0.5, 0.92, 1.0] as const,
} as const;
