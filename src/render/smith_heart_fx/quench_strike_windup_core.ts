// Tempering Strike's wind-up tell on the Guardian of the Quench, as numbers
// (round 3 of her look, the lead's notes of 2026-11-08: from behind or far to
// the side her raised fists did not read). Through the second between the
// fight's wind-up cue (sim quench_strike_windup.ts, QUENCH_CUES.strikeReady)
// and the swing's outcome, a tell reads from EVERY angle:
//  - a ring of frost closing in over the ice round her whole body, deep blue
//    at its edge and cyan in its crest, while the cleave's own arc in front of
//    her frosts over (the ground under every raider, whatever their side);
//  - cold light spiralling up both forearms into her raised fists, which flare
//    above her crown's silhouette (seen from behind as from the front).
// It ends on the outcome: the slam (the cleave fired) bursts it, a spent swing
// (dodged, parried, missed) lets it fall away, and with no outcome at all (her
// target left her reach) it fades on its own at the hold's end.
// Telegraph-class: every graphics tier draws it whole (meshes and sprites,
// never the tier-thinned particles); reduced motion keeps it (no motion of the
// camera in it). Node-only (RENDER_PURE_CORES): no three.js, no DOM.

const clamp01 = (t: number) => Math.max(0, Math.min(1, t));
const ease = (t: number) => {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
};

export const QUENCH_WINDUP = {
  /** Seconds from the cue to the swing (the sim's `strikeWindup`). */
  lead: 1,
  /** The longest the raised fists wait for an outcome (the StrikeRaise
   *  clip lowers them on its own from here). */
  hold: 1.6,
  /** Seconds the tell takes to come up, and to fall away after its end. */
  rise: 0.12,
  fall: 0.28,
  /** The frost ring's reach round her (yards), and where it closes to (a
   *  share of that reach) as the swing comes. */
  ringRadius: 10,
  ringClose: 0.3,
  /** The spirals: turns round the forearm, their reach below the fist and
   *  their widest radius (her model's units, about a yard each). */
  spiralTurns: 3.2,
  spiralLength: 6,
  spiralRadius: 1.1,
  /** The fists' flare (model units across at full strength). */
  fistFlare: 6,
  /** Round 4: once the downswing begins (StrikeFall) the fists leave the sky
   *  for the ice in front of her: over `fallDim` seconds the spirals let go
   *  of her forearms and the flare shrinks to `fallFist` of itself, so the
   *  falling fists never blot out her face and body. */
  fallDim: 0.12,
  fallFist: 0.25,
} as const;

/** How the wind-up ended (or not yet). */
export type QuenchWindupEnd = 'pending' | 'slam' | 'spent';

export interface QuenchWindupLook {
  /** The whole tell's strength (0..1). */
  alpha: number;
  /** The frost ring's crest, a share of its reach (1 at the rim, closing in). */
  ring: number;
  /** The cleave's arc frosting over (0..1). */
  arc: number;
  /** The spirals' brightness (0..1) and how far up the forearm they climb. */
  spiral: number;
  /** The fists' flare, a share of `fistFlare` (past 1 at the slam's burst). */
  fist: number;
}

export function newWindupLook(): QuenchWindupLook {
  return { alpha: 0, ring: 1, arc: 0, spiral: 0, fist: 0 };
}

/** The tell `t` seconds after the wind-up cue, its `end` seen `sinceEnd`
 *  seconds ago (pending: ignored), the downswing begun `sinceFall` seconds ago
 *  (negative: not yet), written into `out`. */
export function quenchWindupLook(
  t: number,
  end: QuenchWindupEnd,
  sinceEnd: number,
  out: QuenchWindupLook = newWindupLook(),
  sinceFall = -1,
): QuenchWindupLook {
  const W = QUENCH_WINDUP;
  out.alpha = 0;
  out.ring = 1;
  out.arc = 0;
  out.spiral = 0;
  out.fist = 0;
  if (!(t >= 0)) return out;
  // When the tell stops building: the outcome, else the hold's end.
  const stop = end === 'pending' ? W.hold : Math.min(W.hold, Math.max(0, t - sinceEnd));
  const since = Math.max(0, t - stop);
  if (since >= W.fall) return out;
  const k = clamp01(Math.min(t, stop) / W.lead);
  const up = clamp01(Math.min(t, stop) / W.rise);
  const fade = 1 - since / W.fall;
  out.alpha = up * fade;
  out.ring = 1 - (1 - W.ringClose) * ease(k);
  out.arc = ease(Math.min(1, k * 1.25));
  out.spiral = ease(Math.min(1, k * 2.2));
  out.fist = 0.45 + 0.55 * k * k;
  if (sinceFall >= 0) {
    const f = clamp01(sinceFall / W.fallDim);
    out.spiral *= 1 - f;
    out.fist *= 1 - (1 - W.fallFist) * f;
  }
  // The slam bursts the fists' light (down on the ice now) as the tell drops away.
  if (end === 'slam' && since > 0) out.fist *= 1 + 0.8 * fade;
  return out;
}

/** The tell's palette (linear 0..1): lake-deep edges that stand on the white
 *  ice, a cold cyan crest, white-hot at the fists. */
export const QUENCH_WINDUP_COLORS = {
  deep: [0.02, 0.1, 0.32] as const,
  crest: [0.42, 0.93, 1.0] as const,
  hot: [0.88, 1.0, 1.0] as const,
} as const;
