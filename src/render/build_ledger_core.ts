// The main-thread CPU BUILD LEDGER: what the renderer constructed, how long
// each construction took, and how much of it landed in the current frame.
// The GPU-preparation budget already names every long frame that is a shader
// link or a texture upload; the frames that are CPU construction (a composed
// character body, a zone's feature builders) had no owner in a capture, so
// the hitch tracker filed them under `other`. Producers time their own build
// with the renderer's clock and record it here; nothing in this module reads
// a clock or decides anything: the ledger is write-only telemetry read back
// through perfStats().
//
// Kinds are free-form strings with a prefix that names the lane:
// - `view:<class>`: one entity view build (entity_view_policy_core
//   viewBuildClass), main-thread ms, counted in the frame's viewMs;
// - `zone:<step>`: a synchronous zone streaming step (a feature builder),
//   main-thread ms, counted in the frame's zoneMs;
// - `zone-wall:<step>`: a zone prepare stage that WRAPS awaited sliced work
//   (sky, terrain, water). Wall time, not main-thread time, so it is kept per
//   kind for the streaming picture and never enters the frame spend, the
//   worst frame, or the slowest ring, all of which name main-thread work;
// - `view-part:<step>`: a step NESTED inside one `view:<class>` build
//   (build_spans.ts: assemble, materials, halo, far bake, mixer). Its ms is
//   already inside the enclosing build's, so like the wall lane it is kept
//   per kind and never enters the frame spend, the worst frame, or the
//   slowest ring, none of which may count one millisecond twice.
//
// Pure core contract: no three import, no DOM, no clocks (timestamps come
// from the caller), no randomness. Registered in RENDER_PURE_CORES
// (tests/architecture.test.ts).

export type BuildLedgerLane = 'view' | 'zone' | 'wall' | 'part' | 'other';

export const BUILD_LEDGER_VIEW_PREFIX = 'view:';
export const BUILD_LEDGER_ZONE_PREFIX = 'zone:';
export const BUILD_LEDGER_WALL_PREFIX = 'zone-wall:';
export const BUILD_LEDGER_PART_PREFIX = 'view-part:';

/** Smoothing weight of the per-kind moving average. Structural: it says how
 *  much of the newest build the average trusts, and is not tuned to any
 *  machine or frame rate. */
export const BUILD_LEDGER_EMA_ALPHA = 0.2;

/** How many of the slowest single builds the snapshot keeps. */
export const BUILD_LEDGER_SLOWEST_LIMIT = 24;

export interface BuildLedgerKindStats {
  count: number;
  lastMs: number;
  emaMs: number;
  maxMs: number;
  /** When the `maxMs` sample was recorded, so a kind the frame lanes do not
   *  rank (a wall span, a nested part) still names the frame of its worst. */
  maxAtMs: number;
  totalMs: number;
}

export interface BuildLedgerSlowest {
  kind: string;
  ms: number;
  atMs: number;
}

export interface BuildLedgerFrameSpend {
  totalMs: number;
  viewMs: number;
  zoneMs: number;
  count: number;
}

export interface BuildLedgerWorstFrame {
  ms: number;
  count: number;
  /** Timestamp of the first build recorded in that frame. */
  atMs: number;
}

export interface BuildLedgerSnapshot {
  kinds: Record<string, BuildLedgerKindStats>;
  worstFrame: BuildLedgerWorstFrame;
  /** Worst first, at most `slowestLimit` entries. */
  slowest: BuildLedgerSlowest[];
}

export interface BuildLedger {
  /** One build of `kind` that took `ms` of main-thread time, started at `atMs`. */
  record(kind: string, ms: number, atMs: number): void;
  /** Closes the current frame: its spend is compared against the worst frame
   *  and the accumulator restarts. */
  beginFrame(): void;
  /** Spend accumulated since the last beginFrame. The returned object is
   *  ledger-owned and rewritten by the next call: read it before then. */
  frameSpend(): BuildLedgerFrameSpend;
  snapshot(): BuildLedgerSnapshot;
}

export function buildLedgerLane(kind: string): BuildLedgerLane {
  if (kind.startsWith(BUILD_LEDGER_WALL_PREFIX)) return 'wall';
  if (kind.startsWith(BUILD_LEDGER_PART_PREFIX)) return 'part';
  if (kind.startsWith(BUILD_LEDGER_VIEW_PREFIX)) return 'view';
  if (kind.startsWith(BUILD_LEDGER_ZONE_PREFIX)) return 'zone';
  return 'other';
}

const roundTenth = (v: number): number => Math.round(v * 10) / 10;

export function createBuildLedger(opts: { slowestLimit?: number } = {}): BuildLedger {
  const slowestLimit = Math.max(1, Math.floor(opts.slowestLimit ?? BUILD_LEDGER_SLOWEST_LIMIT));
  const kinds = new Map<string, BuildLedgerKindStats>();
  // Sorted worst first; once full, the evicted last slot is rewritten in
  // place and bubbled up, so a steady producer allocates nothing here.
  const slowest: BuildLedgerSlowest[] = [];
  const frame: BuildLedgerFrameSpend = { totalMs: 0, viewMs: 0, zoneMs: 0, count: 0 };
  let frameFirstAtMs = 0;
  const worstFrame: BuildLedgerWorstFrame = { ms: 0, count: 0, atMs: 0 };

  const noteSlowest = (kind: string, ms: number, atMs: number): void => {
    let slot: BuildLedgerSlowest;
    if (slowest.length < slowestLimit) {
      slot = { kind, ms, atMs };
      slowest.push(slot);
    } else {
      slot = slowest[slowest.length - 1];
      if (ms <= slot.ms) return;
      slot.kind = kind;
      slot.ms = ms;
      slot.atMs = atMs;
    }
    let i = slowest.length - 1;
    while (i > 0 && slowest[i - 1].ms < slot.ms) {
      slowest[i] = slowest[i - 1];
      i--;
    }
    slowest[i] = slot;
  };

  return {
    record(kind, ms, atMs) {
      if (!(ms >= 0) || !Number.isFinite(ms)) return;
      let stats = kinds.get(kind);
      if (!stats) {
        stats = { count: 0, lastMs: 0, emaMs: ms, maxMs: 0, maxAtMs: 0, totalMs: 0 };
        kinds.set(kind, stats);
      }
      stats.count++;
      stats.lastMs = ms;
      stats.emaMs += (ms - stats.emaMs) * BUILD_LEDGER_EMA_ALPHA;
      if (ms > stats.maxMs) {
        stats.maxMs = ms;
        stats.maxAtMs = atMs;
      }
      stats.totalMs += ms;
      const lane = buildLedgerLane(kind);
      if (lane === 'wall' || lane === 'part') return;
      if (frame.count === 0) frameFirstAtMs = atMs;
      frame.count++;
      frame.totalMs += ms;
      if (lane === 'view') frame.viewMs += ms;
      else if (lane === 'zone') frame.zoneMs += ms;
      noteSlowest(kind, ms, atMs);
    },
    beginFrame() {
      if (frame.totalMs > worstFrame.ms) {
        worstFrame.ms = frame.totalMs;
        worstFrame.count = frame.count;
        worstFrame.atMs = frameFirstAtMs;
      }
      frame.totalMs = 0;
      frame.viewMs = 0;
      frame.zoneMs = 0;
      frame.count = 0;
    },
    frameSpend() {
      return frame;
    },
    snapshot() {
      const kindsOut: Record<string, BuildLedgerKindStats> = {};
      for (const [kind, s] of kinds) {
        kindsOut[kind] = {
          count: s.count,
          lastMs: roundTenth(s.lastMs),
          emaMs: roundTenth(s.emaMs),
          maxMs: roundTenth(s.maxMs),
          maxAtMs: Math.round(s.maxAtMs),
          totalMs: roundTenth(s.totalMs),
        };
      }
      return {
        kinds: kindsOut,
        worstFrame: {
          ms: roundTenth(worstFrame.ms),
          count: worstFrame.count,
          atMs: Math.round(worstFrame.atMs),
        },
        slowest: slowest.map((s) => ({
          kind: s.kind,
          ms: roundTenth(s.ms),
          atMs: Math.round(s.atMs),
        })),
      };
    },
  };
}
