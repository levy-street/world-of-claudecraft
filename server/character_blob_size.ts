// The character-blob size SIGNAL for the save path.
//
// At 1,000 online the realm rewrites every character blob whole on the autosave
// interval (there is no per-field dirty tracking), so the serialized size of one
// character multiplies straight into write volume, WAL, and TOAST churn. Nothing
// measured it: a field that quietly grew per-player rather than per-content
// would have shown up first as a database incident, not as a log line.
//
// WARN-ONLY, and that is the whole design. The guild-bank pair
// (GUILD_BANK_ROW_MAX_BYTES in server/db.ts, GUILD_BANK_MERGED_MAX_BYTES in
// server/guild_bank_state.ts) is a HARD bound: an oversized book is skipped on
// load and refused on write, because a guild bank is a shared ledger where a
// corrupt row is worse than an inert one. A character blob is the opposite
// trade. It is one player's entire progress, and it has no second copy: the row
// in `characters` IS the character. Refusing or truncating an oversized save
// would destroy a session's gameplay to protect a disk metric, so this path
// never rejects, never truncates, and never short-circuits. It measures, and if
// the number is surprising it says so, and the write proceeds regardless.
//
// THE THRESHOLD, and where it comes from. The Crucible integration database
// review re-measured the real Sim.serializeCharacter UTF-8 JSON on 2026-09-05:
//   - professions subset: 18,807 bytes, with a 20-KiB structural ceiling;
//   - storage-rich whole character: 209,261 bytes, stable across two further
//     real load/serialize passes, with a narrow 208,881..209,262 tracking band.
// tests/professions_blob_growth.test.ts is the live authority. Its fixture uses
// legal equipped caps, 80 carried slots, 176 bank slots and 12 unbound buyback
// rows. Stored Perfected/promoted copies carry their real bonus and permanent
// binding provenance; the 204 retained recipe/formula ids remain below 512.
// The fixture's documented exclusions still apply: this is a storage-rich
// modeled character, not proof of the largest possible state across all systems.
// These are serialized bytes, not measured PostgreSQL storage, WAL or latency.
//
// The old 151,656-byte measurement omitted legitimate stored progress and
// promotion. Its unchanged fixture on the current catalog measured 156,144;
// correcting payloads and identities added 53,117 bytes. Exact per-field and
// metadata-only attribution lives in the test and in
// docs/design/crucible-professions-integration.md. The former 163,840-byte warn
// threshold sat 45,421 bytes BELOW the corrected fixture, so it would warn on
// every save of this modeled character despite no unexpected field growth.
//
// RE-MINTED to 229,376 (224 KiB) after database review: the smallest 32-KiB step
// above 209,261, leaving 20,115 bytes of headroom and one 32-KiB step below the
// 262,144-byte (256 KiB) guild-bank scale. This is still only a coarse warning,
// never a save limit. The p99 window and high-water mark below remain the
// fleet-growth watch even below this threshold. The independent literal and
// boundary tests plus the whole-character relation require a reviewed
// re-measurement if the threshold changes or content outgrows it. A crossing
// may be an unbounded field, or simply a character who owns a great deal.
export const CHARACTER_BLOB_WARN_BYTES = 229_376;

// The decision, kept pure so it is unit-testable without a database: returns the
// dev-channel log line for an oversized blob, or null when the size is
// unremarkable. Dev-channel English by the i18n rule (a server log an operator
// reads, never player-facing text), so no t() key.
//
// BYTES, not string length, is what the caller must pass: JSON.stringify returns
// UTF-16 code units, and a blob carrying non-ASCII text (a crafter signature, a
// pet name, a mail subject) encodes to more bytes than it has units. Measuring
// units would under-report exactly the rows most likely to be large. Callers use
// Buffer.byteLength(json, 'utf8'), matching the octet_length doctrine the
// guild-bank bounds already follow.
export function characterBlobSizeWarning(characterId: number, bytes: number): string | null {
  if (bytes <= CHARACTER_BLOB_WARN_BYTES) return null;
  // ATTEMPTED, not "written", and deliberately so. The size never blocks the
  // write, but the statement this line describes can still fail to persist for
  // reasons that have nothing to do with size: a lease-fence miss rolls the
  // escrow transactions back (server/db.ts, both the market/mail and guild bank
  // flushes), a refused guild bank escrow aborts the whole transaction, and the
  // leave-save retry loop (server/game.ts saveCharacterOnLeave) makes up to
  // LEAVE_SAVE_MAX_ATTEMPTS attempts, of which all but the last are failures
  // that already rolled back. Claiming "the write PROCEEDS" would have been
  // false on all three, and an operator reading this line during an incident is
  // exactly the person who must not be told a row landed when it did not.
  return `character save: a save was attempted for character ${characterId} with a ${bytes}-byte serialized state, past the ${CHARACTER_BLOB_WARN_BYTES}-byte expectation for a full character. Size never blocks the write (losing a session's progress is worse than a large row), though this attempt may still roll back for unrelated reasons. Treat it as a signal that some persisted field may be growing per-player rather than per-content.`;
}

// How long one reported line silences its repeats. The character blob is
// rewritten whole on the autosave interval, so a threshold crossing is never a
// single event: one oversized character alone reprints every autosave, and a
// fleet-wide crossing (the case this signal exists to catch) would print from
// every session at once, forever. That is not a louder signal, it is a log an
// operator stops reading. The window matches the market-writer queue-depth warn
// in server/game.ts, which dampens for the same reason.
export const CHARACTER_BLOB_WARN_WINDOW_MS = 60_000;

export type CharacterBlobSizeReporter = (
  characterId: number,
  bytes: number,
  nowMs: number,
) => string | null;

// The dampened reporter: the pure decision above plus one window's worth of
// memory. Returns the line to log, or null when the size is fine OR when an
// identical-in-kind line already fired inside the window. Suppressed lines are
// COUNTED, not dropped silently, and the count rides the next line that fires,
// so the log still says how much it swallowed.
//
// A FACTORY rather than bare module-level `let`s, because the state is what
// makes this untestable otherwise: a shared counter bleeds between test cases
// (one case's suppressed total surfacing in another's assertion) and needs a
// test-only reset export to escape. Each caller, including each test, owns an
// isolated instance instead. `nowMs` is a PARAMETER for the same reason: a test
// drives the window by passing timestamps rather than by faking global time.
export function createCharacterBlobSizeReporter(): CharacterBlobSizeReporter {
  let lastWarnMs = Number.NEGATIVE_INFINITY;
  let suppressed = 0;
  return (characterId, bytes, nowMs) => {
    const line = characterBlobSizeWarning(characterId, bytes);
    if (line === null) return null;
    if (nowMs - lastWarnMs < CHARACTER_BLOB_WARN_WINDOW_MS) {
      suppressed++;
      return null;
    }
    lastWarnMs = nowMs;
    if (suppressed === 0) return line;
    const swallowed = suppressed;
    suppressed = 0;
    return `${line} (${swallowed} further oversized save${swallowed === 1 ? '' : 's'} suppressed in the preceding ${CHARACTER_BLOB_WARN_WINDOW_MS}ms)`;
  };
}

// The one instance the save path uses. Module-level so the window spans the
// whole process rather than resetting per call site: all three savers share it,
// which is the point (a fleet-wide crossing hitting every path at once still
// prints one line a minute, not three).
export const reportCharacterBlobSize = createCharacterBlobSizeReporter();

// The scrape-visible twin of the warn line: below-threshold growth is silent
// in logs, but every measurement already paid at the save chokepoint feeds
// this gauge (server/http/game_metrics.ts, woc_character_state_bytes_max).
// Process-lifetime monotonic max, reset only by restart: it answers how large
// a serialized state has been observed here, while the p99 below distinguishes
// broad growth from a lone outlier.
let blobBytesHighWater = 0;
export function recordCharacterBlobBytes(bytes: number): void {
  if (bytes > blobBytesHighWater) blobBytesHighWater = bytes;
  blobBytesWindow.record(bytes);
}
export function characterBlobBytesHighWater(): number {
  return blobBytesHighWater;
}

// ---------------------------------------------------------------------------
// The p99 gauge beside the high-water mark (the farming handoff's P3 row): a
// monotonic max answers "did anything bigger than modelled ever save here",
// but it cannot tell one outlier from a fleet-wide creep, which is the shape
// a per-player field growing without a bound actually takes. The p99 over the
// most recent saves answers that: it moves only when the bulk of the realm's
// blobs move. Windowed by COUNT, not time, so it is clock-free and its memory
// is a fixed ring; nearest-rank on a sorted copy at read time, because reads
// are orders of magnitude rarer than records (one per save, ~33/s at 1,000
// online on the 30 s autosave). The most frequent reader is not the scrape
// (every 15 to 60 s) or the 5 s heartbeat but the PERF_TICK_LOG over-budget arm
// (server/game.ts maybeLogTickPerf), which prints on a stuttering tick at its
// own throttle of one line per 20 ticks, i.e. UP TO 1/s, and reads this p99 for
// the blobP99= token on every such line. Still two orders under the record
// rate, and it only reaches that ceiling while the loop is already blowing its
// budget, which is exactly when the sort must stay cheap: a 1,024-sample sort
// is tens of microseconds, so even the sustained-stutter case costs well under
// 0.1% of one 50 ms tick.
// ---------------------------------------------------------------------------

export interface WindowedPercentile {
  /** Add one sample; the oldest sample leaves once the window is full. */
  record(value: number): void;
  /** Nearest-rank percentile (0 < p <= 100) over the retained samples; 0 while empty. */
  percentile(p: number): number;
  /** Retained sample count (at most the capacity). */
  count(): number;
}

/**
 * A fixed-capacity ring of the most recent samples with nearest-rank
 * percentile reads. Pure and instance-scoped (a test owns its own window; the
 * module instance below is the save path's).
 */
export function createWindowedPercentile(capacity: number): WindowedPercentile {
  if (!Number.isInteger(capacity) || capacity <= 0) {
    throw new Error(
      `createWindowedPercentile capacity must be a positive integer, got ${capacity}`,
    );
  }
  const ring = new Array<number>(capacity);
  let next = 0;
  let filled = 0;
  return {
    record(value: number): void {
      ring[next] = value;
      next = (next + 1) % capacity;
      if (filled < capacity) filled++;
    },
    percentile(p: number): number {
      if (filled === 0) return 0;
      const sorted = ring.slice(0, filled).sort((a, b) => a - b);
      // Nearest rank: the smallest sample at or above the p-th share of the
      // window; p = 100 is the max, p -> 0 is the min.
      const rank = Math.min(filled, Math.max(1, Math.ceil((p / 100) * filled)));
      return sorted[rank - 1];
    },
    count(): number {
      return filled;
    },
  };
}

// 1,024 saves: about 30 s of the autosave wave at 1,000 online, or the whole
// recent history of a quiet realm, either way enough that one pathological
// character is under 0.1% of the window and cannot move its p99 alone.
export const CHARACTER_BLOB_P99_WINDOW = 1024;

const blobBytesWindow = createWindowedPercentile(CHARACTER_BLOB_P99_WINDOW);

/** The p99 serialized blob size over the most recent CHARACTER_BLOB_P99_WINDOW saves
 *  (0 before the first save), scraped as woc_character_state_bytes_p99 and printed
 *  on the PERF_TICK_LOG heartbeat as blobP99=. */
export function characterBlobBytesP99(): number {
  return blobBytesWindow.percentile(99);
}

// ---------------------------------------------------------------------------
// The deferred warn-line queue (the setImmediate shutdown trade, closed). The
// statement builder (server/character_save_statement.ts) runs inside open
// transactions holding row locks, and console.warn is a SYNCHRONOUS write when
// stdout is a blocking sink, so the line is queued and written off the lock
// hold on the next immediate. That deferral used to lose the line when a
// shutdown-path save queued it after the drain train's last yield: process.exit
// discards pending immediates. flushQueuedCharacterBlobWarnings is the
// shutdown train's synchronous drain (server/main.ts, right before exit), and
// the immediate finds an empty queue when the drain got there first, so a line
// is written exactly once either way.
// ---------------------------------------------------------------------------

// The queue's hard bound. The PRACTICAL bound is already the 60 s dampener
// above (reportCharacterBlobSize returns at most one line per
// CHARACTER_BLOB_WARN_WINDOW_MS, so the steady state queues one line a minute
// and the immediate drains it long before a second arrives), and this cap is
// never reached on that path. It exists because the dampener is a policy the
// CALLERS opt into, not a property of the queue: a future queuer that skips
// the reporter, or a drain starved by a wedged event loop while an incident
// prints, would otherwise grow an unbounded array of strings inside the very
// process the incident is already straining. Small on purpose: past a handful
// of lines the queue has stopped being a signal and become a backlog.
export const CHARACTER_BLOB_WARN_QUEUE_MAX = 32;

const queuedWarnLines: string[] = [];
let warnFlushScheduled = false;
// Lines refused by the cap since the last drain, reported as a tail line so a
// truncated burst is never silently smaller than it was.
let droppedWarnLines = 0;

function writeWarnLine(line: string): void {
  try {
    console.warn(line);
  } catch {
    /* a lost dev-channel line (EPIPE on a closed stdout), never a crash */
  }
}

/** Queue one dev-channel warn line for emission off the current call stack.
 *  At the cap the line is DROPPED and counted (the oldest lines are the
 *  informative ones: the first crossing names the character and the size). */
export function queueCharacterBlobWarning(line: string): void {
  if (queuedWarnLines.length >= CHARACTER_BLOB_WARN_QUEUE_MAX) droppedWarnLines++;
  else queuedWarnLines.push(line);
  if (warnFlushScheduled) return;
  warnFlushScheduled = true;
  setImmediate(flushQueuedCharacterBlobWarnings);
}

/** Write every queued warn line NOW (synchronous): the shutdown drain, and the
 *  deferred immediate's body. Idempotent; an empty queue costs nothing. */
export function flushQueuedCharacterBlobWarnings(): void {
  warnFlushScheduled = false;
  while (queuedWarnLines.length > 0) writeWarnLine(queuedWarnLines.shift() as string);
  if (droppedWarnLines > 0) {
    const dropped = droppedWarnLines;
    droppedWarnLines = 0;
    writeWarnLine(
      `character save: ${dropped} further oversized-save warning line${dropped === 1 ? '' : 's'} were dropped at the ${CHARACTER_BLOB_WARN_QUEUE_MAX}-line queue cap.`,
    );
  }
}

/** Queued lines not yet written (the drain tests' probe). */
export function queuedCharacterBlobWarningCount(): number {
  return queuedWarnLines.length;
}
