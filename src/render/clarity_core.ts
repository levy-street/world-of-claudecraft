// Clarity: the pure half. The output grade can push each pixel away from the mean of its
// neighbourhood (an unsharp mask a few pixels wide), which is what makes a painted wall, a
// roof's tiles or a meadow's blades read crisply instead of soft.
//
// This file only decides the session's settings; the GLSL is post_clarity_glsl.ts and the
// grade pass compiles it in under CLARITY_GRADE (post_output_grade.ts).

export interface ClaritySettings {
  /** How far a pixel is pushed from its neighbourhood's mean (CLARITY_DEFAULTS is the tuned
   *  look). */
  readonly amount: number;
  /** Radius of the neighbourhood, as a fraction of the picture's height (5 pixels at 720). */
  readonly radius: number;
  /** The most any channel may move, in display units: stops a hard silhouette from ringing. */
  readonly limit: number;
}

// Tuned in the running game. The clamp is what keeps it a painting: with it open, more
// strength or a wider radius rings every roof and silhouette with a halo, which reads as
// an over-processed photograph, and with it held tighter than this extra strength buys
// nothing. Under this clamp the strength itself had room left: 1.4 reads crisper than 1.0
// with the halo no wider and no brighter, where 2.0 adds nothing over 1.4 and a radius of
// 8 pixels spreads a pale aura round every tree against the sky. So this is the strongest
// setting that still looks like the painting.
export const CLARITY_DEFAULTS: ClaritySettings = {
  amount: 1.4,
  radius: 5 / 720,
  limit: 0.16,
};

function readNumber(
  params: URLSearchParams,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = params.get(key);
  if (raw === null || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

/**
 * The session's clarity from a `location.search` string, or null for none. On by default;
 * `clarity=off` (or `0`) turns it off, `clarity=<amount>` sets the strength, `clarityr=<px>`
 * the radius in pixels of a 720-high picture and `claritylimit` the clamp.
 */
export function clarityFromQuery(search: string): ClaritySettings | null {
  const params = new URLSearchParams(search);
  const mode = params.get('clarity');
  if (mode === 'off' || mode === '0') return null;
  const d = CLARITY_DEFAULTS;
  const amount = readNumber(params, 'clarity', d.amount, 0, 3);
  if (amount <= 0) return null;
  return {
    amount,
    radius: readNumber(params, 'clarityr', d.radius * 720, 0.5, 16) / 720,
    limit: readNumber(params, 'claritylimit', d.limit, 0.02, 1),
  };
}

/**
 * Which output grade carries the clarity arm. Each of its eight taps resolves a whole
 * display colour (bloom, tone map and transfer), a cost the leaner tiers do not have to
 * spare; and on a tier whose grade fuses its edge AA, the taps would read the picture from
 * BEFORE that AA and sharpen back the stair-steps it had just smoothed. So clarity rides
 * only the grade of the tiers that anti-alias in a tail pass after it (SMAA), and never the
 * post shed's FXAA twin: the rung that sheds SMAA sheds clarity with it, which is the lever
 * the render budget needs over a cosmetic step. Low draws no standard materials and keeps
 * its lean grade either way.
 */
export function clarityForGrade(
  settings: ClaritySettings | null,
  chain: { readonly standardMaterials: boolean; readonly gradeFxaa: boolean },
): ClaritySettings | null {
  return settings && chain.standardMaterials && !chain.gradeFxaa ? settings : null;
}
