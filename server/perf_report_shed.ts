// The raw_summary byte cap as a priority shed ladder.
//
// The client perf beacon's raw_summary is a jsonb column capped in bytes. The
// cap used to be enforced in two stages: an over-cap blob was rebuilt from an
// allowlist, and if THAT still exceeded the cap the whole blob was replaced by
// a bare `{truncated: true}`. Production measured 0% of 0.42.x reports under
// the cap, 43% surviving the allowlist, and 57% stripped bare, on rows that
// skew toward the worse sessions: the detail vanished exactly where a hitch
// hunt looks. The surviving blobs were dominated by three big blocks (the
// prewarm summary, the GPU queue, the quality buckets) while every diagnostic
// key weighs under half a kilobyte.
//
// This ladder sheds one rung at a time, cheapest-to-lose first, re-measuring
// after every rung that removed something and stopping at the first fit. The
// small diagnostic keys sit at the tail and are reachable only by a hostile
// payload that inflates one of them. Every shed rung is recorded under
// `dropped`, so a reader can tell "absent" from "shed", and the whole-blob
// drop no longer exists.
//
// Host-agnostic: no IO, and no import from perf_report.ts (which imports this
// module); the prewarm compactor it needs is injected.

export const RAW_SUMMARY_RESERVED_KEYS = ['truncated', 'dropped'] as const;

/** Every top-level key the client sends (src/game/perf_reporter.ts
 *  payloadFromSnapshot, the rawSummary block). Anything else is shed first. */
export const RAW_SUMMARY_KNOWN_KEYS = [
  'graphicsConfigVersion',
  'seconds',
  'visibleSeconds',
  'frames',
  'hiddenPresentSkips',
  'windows',
  'mainMs',
  'rendererPhaseMs',
  'rendererFoliage',
  'rendererBudget',
  'rendererQualityBuckets',
  'rendererDrawingBuffer',
  'rendererDiagnostics',
  'rendererPrewarmSummary',
  'rendererPrewarm',
  'rendererGpuQueue',
  'entryReveal',
  'postRevealLinks',
  'bootPhases',
  'shaderWarm',
  'assets',
  'input',
  'hud',
  'netPipeline',
  'heapSawtooth',
  'browser',
  'devTrace',
] as const;

/** The scalar keys shed together as the very last rung. */
export const RAW_SUMMARY_SCALAR_KEYS = [
  'graphicsConfigVersion',
  'seconds',
  'visibleSeconds',
  'frames',
  'hiddenPresentSkips',
] as const;

export interface RawSummaryShedDeps {
  /** The prewarm summary's field-by-field compact rebuild (perf_report.ts
   *  compactPrewarmSummary): fewer list members, every field re-shaped. */
  compactPrewarm: (value: unknown) => Record<string, unknown> | null;
}

type Raw = Record<string, unknown>;

interface ShedRung {
  id: string;
  /** The top-level keys this rung may touch, read BEFORE it runs: the byte
   *  accounting measures only those members, never the whole blob. */
  keys: (value: Raw) => readonly string[];
  /** Remove the rung's content; true when something was actually removed. */
  apply: (value: Raw, deps: RawSummaryShedDeps) => boolean;
}

function isRecord(value: unknown): value is Raw {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

// Own keys only, never `in`: a client key named like an Object.prototype
// member (`constructor`, `toString`) would still read as present after its
// deletion, and serializing the inherited function would throw.
function has(value: Raw, key: string): boolean {
  return Object.hasOwn(value, key);
}

export function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value));
}

function dropKey(key: string): ShedRung {
  return {
    id: key,
    keys: () => [key],
    apply: (value) => {
      if (!has(value, key)) return false;
      delete value[key];
      return true;
    },
  };
}

function dropKeys(id: string, keys: readonly string[]): ShedRung {
  return {
    id,
    keys: () => keys,
    apply: (value) => {
      let changed = false;
      for (const key of keys) {
        if (!has(value, key)) continue;
        delete value[key];
        changed = true;
      }
      return changed;
    },
  };
}

/** Delete `subKeys` inside the record at `key`; `deeper` names one more
 *  nested record whose own sub-keys go too (the GPU queue's recent lanes). */
function dropSubKeys(
  id: string,
  key: string,
  subKeys: readonly string[],
  deeper?: { key: string; subKeys: readonly string[] },
): ShedRung {
  return {
    id,
    keys: () => [key],
    apply: (value) => {
      const block = value[key];
      if (!isRecord(block)) return false;
      let changed = false;
      for (const subKey of subKeys) {
        if (!has(block, subKey)) continue;
        delete block[subKey];
        changed = true;
      }
      const nested = deeper ? block[deeper.key] : undefined;
      if (deeper && isRecord(nested)) {
        for (const subKey of deeper.subKeys) {
          if (!has(nested, subKey)) continue;
          delete nested[subKey];
          changed = true;
        }
      }
      return changed;
    },
  };
}

const KNOWN_KEY_SET: ReadonlySet<string> = new Set(RAW_SUMMARY_KNOWN_KEYS);

// Cheapest to lose first. The byte figures in the comments are the production
// averages measured on surviving 0.42.1 blobs (2026-09-11).
const RUNGS: readonly ShedRung[] = [
  // Local-only data on the loopback dev path; policy-stripped before the ladder
  // on the public path, so it never shows in a fleet row's `dropped`.
  dropKey('devTrace'),
  // Nothing on the server knows how to read a key outside the vocabulary.
  {
    id: 'unlisted',
    keys: (value) => Object.keys(value).filter((key) => !KNOWN_KEY_SET.has(key)),
    apply: (value) => {
      let changed = false;
      for (const key of Object.keys(value)) {
        if (KNOWN_KEY_SET.has(key)) continue;
        delete value[key];
        changed = true;
      }
      return changed;
    },
  },
  // Material and object name lists, unbounded in shape, dev-oriented.
  dropKey('rendererDiagnostics'),
  // One-time boot preload timings.
  dropKey('assets'),
  // The legacy twin of the prewarm summary an older client still sends: a
  // duplicate when the summary is present, the source when it is not (its
  // unconditional whole-key rung sits further down, so a twin that is not a
  // record at all still has a rung that removes it).
  {
    id: 'rendererPrewarm.twin',
    keys: () => ['rendererPrewarm'],
    apply: (value) => {
      if (!has(value, 'rendererPrewarm') || !isRecord(value.rendererPrewarmSummary)) return false;
      delete value.rendererPrewarm;
      return true;
    },
  },
  // ~7.1 KB, the biggest block: the compact rebuild keeps the failed and
  // slowest units, the pacer's last transitions, and every scalar.
  {
    id: 'rendererPrewarmSummary.lists',
    keys: () => ['rendererPrewarmSummary', 'rendererPrewarm'],
    apply: (value, deps) => {
      const source = value.rendererPrewarmSummary ?? value.rendererPrewarm;
      if (!isRecord(source)) return false;
      const compact = deps.compactPrewarm(source);
      if (!compact) return false;
      value.rendererPrewarmSummary = compact;
      delete value.rendererPrewarm;
      return true;
    },
  },
  // ~1.4 KB of the 2.1 KB block: static per tier and config version, both of
  // which the row carries in typed columns.
  dropSubKeys('rendererQualityBuckets.bands', 'rendererQualityBuckets', ['bands', 'baseline']),
  // The completed manifest entries are already summarized by manifestCompleted;
  // the partial, timed-out, skipped and failed ones are the diagnostic.
  {
    id: 'rendererPrewarmSummary.entries',
    keys: () => ['rendererPrewarmSummary'],
    apply: (value) => {
      const prewarm = value.rendererPrewarmSummary;
      if (!isRecord(prewarm) || !Array.isArray(prewarm.entries)) return false;
      const kept = prewarm.entries.filter(
        (entry) => !isRecord(entry) || entry.status !== 'completed',
      );
      if (kept.length === prewarm.entries.length) return false;
      prewarm.entries = kept;
      return true;
    },
  },
  // ~1 KB of foliage draw stats.
  dropKey('rendererFoliage'),
  // ~1.2 KB: the wedge signal (active, stalls, pending) stays; rankings go.
  dropSubKeys('rendererGpuQueue.rankings', 'rendererGpuQueue', ['slowest', 'blockiest']),
  // ~0.8 KB of input latency percentiles.
  dropKey('input'),
  // ~1 KB of pacing detail; the scalar recent window stays.
  dropSubKeys('rendererGpuQueue.waits', 'rendererGpuQueue', ['longestWaits', 'waitingTails'], {
    key: 'recent',
    subKeys: ['lanes'],
  }),
  dropKey('rendererQualityBuckets'),
  dropKey('rendererPrewarmSummary'),
  dropKey('rendererPrewarm'),
  dropKey('netPipeline'),
  dropKey('heapSawtooth'),
  dropKey('hud'),
  dropKey('mainMs'),
  dropKey('rendererBudget'),
  // The core: a few hundred bytes each on a real report, so this tail is
  // reachable only by a hostile payload that inflates one of them. The GPU
  // queue's residual wedge scalars and the entry reveal wait sit here because
  // a wedged queue and a slow entry are exactly what a truncated report must
  // still carry.
  dropKey('rendererGpuQueue'),
  dropKey('entryReveal'),
  dropKey('windows'),
  dropKey('rendererPhaseMs'),
  dropKey('browser'),
  dropKey('rendererDrawingBuffer'),
  dropKey('postRevealLinks'),
  dropKey('bootPhases'),
  dropKey('shaderWarm'),
  dropKeys('scalars', RAW_SUMMARY_SCALAR_KEYS),
];

/** The rung ids in shed order: the closed vocabulary `dropped` draws from. */
export const RAW_SUMMARY_SHED_RUNG_IDS: readonly string[] = RUNGS.map((rung) => rung.id);

// The cap is a hard bound only if EVERY known key has a whole-key rung: a key
// with only a conditional or sub-block rung could carry a hostile value past
// every rung. Checked once at load, so adding a known key without its rung
// fails the process, never a beacon.
for (const key of RAW_SUMMARY_KNOWN_KEYS) {
  const covered =
    (RAW_SUMMARY_SCALAR_KEYS as readonly string[]).includes(key) ||
    RUNGS.some((rung) => rung.id === key);
  if (!covered) throw new Error(`raw summary shed ladder: no whole-key rung for '${key}'`);
}

/** The server-authored keys, removed from the client input before anything
 *  else so a posted `truncated` can never masquerade as a shed row. */
export function stripReservedRawSummaryKeys(value: Raw): void {
  for (const key of RAW_SUMMARY_RESERVED_KEYS) delete value[key];
}

/** The bytes the named members contribute to the serialized blob: each value
 *  plus its quoted key, colon and one separator. Exact for plain keys; a key
 *  that JSON escapes measures short here, which makes the estimate an
 *  OVER-estimate, the safe direction, and a fit read off the estimate is in
 *  any case confirmed by one exact measurement below. */
function memberBytes(value: Raw, keys: readonly string[]): number {
  let bytes = 0;
  for (const key of keys) {
    if (!has(value, key)) continue;
    bytes += jsonByteLength(value[key]) + Buffer.byteLength(key) + 4;
  }
  return bytes;
}

/**
 * The blob unchanged (same reference) when it fits; otherwise a shed copy
 * carrying `truncated: true` and the ordered `dropped` rung ids. The marker
 * keys are counted in the measurement, so the returned blob fits any cap
 * above the bare markers' own few hundred bytes (the real caps are
 * kilobytes). Deterministic, never mutates its input, never throws on
 * JSON-shaped input.
 *
 * Cost: the blob is serialized whole once on entry and once per CONFIRMED fit
 * (normally exactly one); between rungs the accounting subtracts only the
 * members a rung removed, so a hostile body that keeps its bytes in a
 * late-rung key costs about one blob's worth of serialization, not one per
 * rung. This runs on the realm process's event loop behind a public endpoint.
 */
export function shedRawSummaryToFit(value: Raw, maxBytes: number, deps: RawSummaryShedDeps): Raw {
  const text = JSON.stringify(value);
  const initial = Buffer.byteLength(text);
  if (initial <= maxBytes) return value;
  const out = JSON.parse(text) as Raw;
  const dropped: string[] = [];
  // The members' bytes plus one brace, tracked as an estimate: the final blob
  // is the surviving members, a separator, and the markers (which bring the
  // other brace), so the fit check is this plus the markers' own length.
  let bytes = initial - 1;
  for (const rung of RUNGS) {
    const keys = rung.keys(out);
    const before = memberBytes(out, keys);
    if (!rung.apply(out, deps)) continue;
    dropped.push(rung.id);
    bytes -= before - memberBytes(out, keys);
    const markers = jsonByteLength({ truncated: true, dropped });
    if (bytes + markers > maxBytes) continue;
    const exact = jsonByteLength({ ...out, truncated: true, dropped });
    if (exact <= maxBytes) break;
    bytes = exact - markers;
  }
  out.truncated = true;
  out.dropped = dropped;
  return out;
}
