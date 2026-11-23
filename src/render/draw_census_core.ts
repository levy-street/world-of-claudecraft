// The production draw census, pure half: ranking, label bounding, and the
// rolling window behind the perf beacon's `rendererDrawCensus` block.
//
// Why it exists: `renderer.info.render.calls` says HOW MANY draws a frame
// submitted, never WHAT drew them. The ?perfTrace category census
// (render_diagnostics.ts) answers that, but only on a localhost dev build, so
// a fleet regression confined to one zone (the Ignivar raid arena drawing ~45
// calls per visible character where everywhere else draws ~16) had no
// attribution at all. The renderer walks the scene on idle time at a slow
// cadence (draw_census.ts) and this core turns each walk into three short
// rankings (by render category, by top-level scene node, and by category
// plus nearest named node), plus a rolling
// peak sized to the beacon's repeat interval so a 5-minute report carries the
// worst moment it covered, not only the last one.
//
// Three-free and DOM-free (RENDER_PURE_CORES); deterministic for a given input.

/** Idle-time walk cadence. A whole-scene walk is a few milliseconds on a busy
 *  zone, so this stays far slower than the dev census's 2 s. */
export const DRAW_CENSUS_SAMPLE_MS = 15_000;
/** Ranked entries kept per list before the remainder folds into `other`. */
export const DRAW_CENSUS_TOP_N = 10;
/** Samples the rolling peak spans: 20 x 15 s, the beacon's 5-minute repeat. */
export const DRAW_CENSUS_WINDOW_SAMPLES = 20;
/** A label is a scene-node name or category tag; bound it for the beacon. */
export const DRAW_CENSUS_LABEL_MAX = 48;
/** The fold-in label for everything below the top N. */
export const DRAW_CENSUS_OTHER_LABEL = 'other';

export type DrawCensusRanking = Array<[label: string, draws: number]>;

export interface DrawCensusSample {
  /** Estimated draws the main camera would submit (frustum and layer culled,
   *  no shadow or post passes), so it reads beside, not equal to, `calls`. */
  draws: number;
  /** Renderable objects that contributed at least one draw. */
  objects: number;
  /** What the walk itself cost on the main thread, so the fleet sees the
   *  instrument's own price (idle time, but forced after a timeout). */
  walkMs: number;
  /** By `userData.renderCategory`, inherited down the tree. */
  categories: DrawCensusRanking;
  /** By top-level scene child (its name, else its category, else its type). */
  roots: DrawCensusRanking;
  /** By `category>nearest named node`: the finer split inside a category
   *  (which part of a character rig, which pooled effect). */
  nodes: DrawCensusRanking;
}

export interface DrawCensusSnapshot {
  /** Walks completed this session. */
  samples: number;
  latest: DrawCensusSample | null;
  /** The highest-draw sample of the rolling window. */
  peak: DrawCensusSample | null;
}

export function emptyDrawCensusSnapshot(): DrawCensusSnapshot {
  return { samples: 0, latest: null, peak: null };
}

/** The characters a label keeps; anything else becomes `_`. Scene names are
 *  content and asset ids, and this keeps them that way on the wire (no JSON
 *  escapes that inflate the beacon, nothing free-form). */
const DRAW_CENSUS_LABEL_UNSAFE = /[^A-Za-z0-9 :._/>#-]/g;

/** A trailing `:<digits>` is a runtime entity id (`farmFeast:4127`): it
 *  would split one kind of object into a row per entity, so it is dropped. */
const DRAW_CENSUS_ENTITY_ID_SUFFIX = /:\d+$/;

export function drawCensusLabel(raw: string): string {
  const label = raw
    .trim()
    .replace(DRAW_CENSUS_ENTITY_ID_SUFFIX, '')
    .slice(0, DRAW_CENSUS_LABEL_MAX)
    .replace(DRAW_CENSUS_LABEL_UNSAFE, '_');
  if (label.length === 0) return 'unnamed';
  // `other` is the fold-in entry; a node really named that must not merge
  // into (or duplicate) it.
  return label === DRAW_CENSUS_OTHER_LABEL ? `${label}_` : label;
}

/** Highest draws first (ties by label, so the order is stable), the top N
 *  kept and the rest summed into one `other` entry. */
export function rankDrawCounts(
  counts: ReadonlyMap<string, number>,
  topN = DRAW_CENSUS_TOP_N,
): DrawCensusRanking {
  const entries = [...counts.entries()]
    .filter(([, draws]) => draws > 0)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const kept: DrawCensusRanking = entries.slice(0, topN).map(([label, draws]) => [label, draws]);
  let rest = 0;
  for (let i = topN; i < entries.length; i++) rest += entries[i][1];
  if (rest > 0) kept.push([DRAW_CENSUS_OTHER_LABEL, rest]);
  return kept;
}

/** The last N samples and the derived latest/peak view. */
export class DrawCensusWindow {
  private readonly ring: DrawCensusSample[] = [];
  private total = 0;

  constructor(private readonly capacity = DRAW_CENSUS_WINDOW_SAMPLES) {}

  push(sample: DrawCensusSample): void {
    this.total++;
    this.ring.push(sample);
    if (this.ring.length > this.capacity) this.ring.shift();
  }

  snapshot(): DrawCensusSnapshot {
    if (this.ring.length === 0) return emptyDrawCensusSnapshot();
    let peak = this.ring[0];
    // The most recent of equal peaks: it is the one nearest the report.
    for (const sample of this.ring) if (sample.draws >= peak.draws) peak = sample;
    return { samples: this.total, latest: this.ring[this.ring.length - 1], peak };
  }
}
