// rendererDrawCensus: the client's idle-time draw attribution
// (src/render/draw_census_core.ts), the only beacon field that says WHAT a
// session drew rather than how many calls it submitted. Same JSONB-not-DDL
// treatment as the other raw_summary blocks, and the same reason for a bound:
// the shed ladder keeps it as a core key copied verbatim, so its shape (two
// samples of two short ranked lists) is enforced here rather than trusted.
//
// Host-agnostic and pure: no IO, so a Vitest drives it directly.

/** Ranked entries per list. The client keeps 10 plus one folded `other`. */
export const DRAW_CENSUS_RAW_RANKING_MAX = 11;
export const DRAW_CENSUS_RAW_LABEL_MAX = 48;
/** Generous against any real scene (an urgent-budget frame is ~1,100 calls). */
export const DRAW_CENSUS_RAW_DRAWS_MAX = 1_000_000;
export const DRAW_CENSUS_RAW_SAMPLES_MAX = 10_000_000;
/** A walk is idle-time work; anything past this is a hostile value. */
export const DRAW_CENSUS_RAW_WALK_MS_MAX = 60_000;
/** The client's label charset (draw_census_core.ts), enforced again here:
 *  every label stays a plain id, so no escape can inflate the block. */
const LABEL_UNSAFE = /[^A-Za-z0-9 :._/>#-]/g;

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function countIn(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, Math.round(value)));
}

function sanitizeRanking(value: unknown): Array<[string, number]> {
  if (!Array.isArray(value)) return [];
  const out: Array<[string, number]> = [];
  for (const entry of value) {
    if (out.length >= DRAW_CENSUS_RAW_RANKING_MAX) break;
    if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
    const label = entry[0].slice(0, DRAW_CENSUS_RAW_LABEL_MAX).replace(LABEL_UNSAFE, '_');
    if (label.length === 0) continue;
    out.push([label, countIn(entry[1], DRAW_CENSUS_RAW_DRAWS_MAX)]);
  }
  return out;
}

function sanitizeSample(value: unknown): Raw | null {
  if (!isRecord(value)) return null;
  return {
    draws: countIn(value.draws, DRAW_CENSUS_RAW_DRAWS_MAX),
    objects: countIn(value.objects, DRAW_CENSUS_RAW_DRAWS_MAX),
    walkMs:
      typeof value.walkMs === 'number' && Number.isFinite(value.walkMs)
        ? Math.round(Math.min(DRAW_CENSUS_RAW_WALK_MS_MAX, Math.max(0, value.walkMs)) * 10) / 10
        : 0,
    categories: sanitizeRanking(value.categories),
    roots: sanitizeRanking(value.roots),
    nodes: sanitizeRanking(value.nodes),
  };
}

/** The bounded block, or undefined (the key is then dropped) when the input
 *  is not a census record or carries no sample at all. */
export function sanitizeDrawCensus(value: unknown): Raw | undefined {
  if (!isRecord(value)) return undefined;
  const latest = sanitizeSample(value.latest);
  const peak = sanitizeSample(value.peak);
  if (!latest && !peak) return undefined;
  return { samples: countIn(value.samples, DRAW_CENSUS_RAW_SAMPLES_MAX), latest, peak };
}
