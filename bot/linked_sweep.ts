// Who has a linked game account, and the paced pass that re-syncs their flair.
//
// The sweep this replaces read EVERY online member every five minutes, one
// `GET /internal/discord/flex` per member, to discover a handful of changes. At
// a thousand concurrent players that is a thousand uncached server reads per
// sweep, and the members it asks about are the wrong set twice over: an online
// member with no linked account can never produce a role or nickname write, and
// a linked member who is offline in Discord still needs one when their level
// moves. So this module holds the set that actually matters (LINKED members),
// hands the caller one bounded SLICE of it at a time, and lets the scheduler
// pace those slices instead of spending the whole sweep in one tick.
//
// Pure and IO-free, the `logic.ts` / `rate_governor.ts` rule: no clock, no
// fetch, no DOM. Every time-dependent entry point takes `nowMs`, so the pass
// window is drivable from a virtual clock and the whole file is unit-tested
// without a network.
//
// THE SET IS A BELIEF, NOT A FACT, which is what most of the care below is
// about. Nothing tells the bot who is linked; it infers that from three signals
// of different strengths, and each one is applied for exactly as much as it can
// prove:
//  - the outbox link-change feed says an id's linkage MOVED. It is authoritative
//    for the id it carries and silent about every other id, and a repoint item
//    deliberately carries only the OLD id (server/internal.ts): the feed tells
//    you who to stop flairing, never who to start.
//  - a flex-batch answer is authoritative for the ids it was asked about, but
//    ONLY when its `requested` echo matches the number of distinct ids sent. A
//    mismatch means the request was truncated or partly dropped server-side, and
//    absence-means-unlinked over a truncated answer would clear flair for most
//    of the guild. So a suspect answer contributes positive evidence alone.
//  - a members-meta push reports `unapplied`, the accepted ids with no link row.
//    That is a free full reconciliation whenever the hourly resync pushes
//    everyone. An older server omits the field entirely, and `undefined` is
//    therefore read as "no information", never as "none": treating it as an
//    empty list would mark the entire roster linked in one call.
// Every wrong belief here is self-correcting within one pass or one hourly
// resync, which is why the module never needs a periodic full-roster rescan (a
// rescan is what this phase exists to delete).

/**
 * How many ids one sweep slice asks about by default.
 *
 * It is a THRESHOLD, not a cadence, so it lives here beside the sweep rather
 * than in bot/cadence.ts. The number is chosen against the rate governor's queue
 * depth, not against the server: one slice's worst case is one nickname PATCH
 * plus a role add and a role remove per member, so 100 members is 300 queued
 * Discord writes spread over three bucket queues, under MAX_QUEUE_DEPTH (256 per
 * queue) with room for the event-driven writes landing beside them. A slice
 * large enough to overflow a queue turns the governor's backpressure into
 * dropped work, which reads in production as members whose flair silently
 * stopped updating.
 */
export const DEFAULT_SWEEP_SLICE_SIZE = 100;

/**
 * The largest slice that can ever be asked for, matching the server's
 * flex-batch array cap (FLEX_BATCH_CAP in server/internal.ts, mirrored as
 * FLEX_BATCH_LIMIT in bot/server_client.ts). Over-cap ids are dropped SERVER
 * side, and a dropped id is exactly the case the `requested` echo exists to make
 * visible, so a slice must never be built past it.
 *
 * Written as its own literal rather than imported, for the reason
 * OUTBOX_LINK_CHANGE_PAGE gives on the server side: the relationship is a
 * CEILING ("a slice may never exceed what one request can carry"), not an
 * identity, and importing it would make this pure module depend on the IO shell.
 * The suite pins both against the literal AND against each other, so the two
 * cannot drift apart unnoticed.
 */
export const SWEEP_SLICE_MAX = 1000;

/** Which set a pass iterates. */
export type PassSource = 'discovery' | 'pass';

/** Where the ids in one slice came from. */
export type SliceSource = PassSource | 'dirty';

/** One bounded unit of sweep work: the ids to ask flex-batch about. */
export interface SweepSlice {
  ids: string[];
  source: SliceSource;
  /** True when this slice opened a new pass (the first slice of one). */
  opensPass: boolean;
}

/**
 * The part of an outbox link-change item this module reads. Structural on
 * purpose, so the pure module never imports the client that fetches them.
 */
export interface LinkChangeLike {
  kinds: readonly string[];
  discordUserId: string;
}

/** The part of a flex-batch answer this module reads. */
export interface FlexBatchLike {
  requested: number;
  members: readonly { discord_user_id: string }[];
}

/**
 * What one apply moved. `metaStale` is the ids whose cached last-pushed
 * members-meta record must be DROPPED by the caller: their server-side link row
 * is new, so the meta the bot believes it pushed is attached to a row that no
 * longer exists (or never did) and would otherwise be suppressed by the diff
 * forever.
 */
export interface LinkChangeSummary {
  added: string[];
  removed: string[];
  dirtied: string[];
  metaStale: string[];
}

export interface FlexBatchSummary {
  /** Whether the `requested` echo matched, i.e. whether absence proved anything. */
  authoritative: boolean;
  added: string[];
  removed: string[];
  metaStale: string[];
}

export interface MetaPushSummary {
  added: string[];
  removed: string[];
  dirtied: string[];
}

/**
 * The linkage state an item's kinds END in, or null when it reports no linkage
 * transition at all (a plain 'flex' or 'points' move).
 *
 * `kinds` is merged in FIRST-SEEN order, so it is a sequence rather than a set:
 * an account that unlinked and relinked inside one drain window arrives as
 * ['unlink', 'link'] and is linked, while ['link', 'unlink'] is not. Reading it
 * as a set (does it contain 'unlink') would drop a relinked member from the set
 * and leave their flair frozen until the hourly resync corrected it.
 */
export function terminalLinkKind(kinds: readonly string[]): 'link' | 'unlink' | null {
  for (let i = kinds.length - 1; i >= 0; i--) {
    if (kinds[i] === 'link' || kinds[i] === 'unlink') return kinds[i] as 'link' | 'unlink';
  }
  return null;
}

/**
 * The cached member ids that the current seed session did NOT observe: members
 * who left while the gateway was down, so GUILD_MEMBER_REMOVE never fired for
 * them (ledger L16).
 *
 * The same shape as `staleFlairedIds` and deliberately not the same function:
 * that one diffs SERVER-flagged ids against the roster to decide a write, this
 * one diffs the bot's own per-member maps against the seed to decide an
 * eviction. Sharing them would tie two unrelated call sites to one signature.
 */
export function departedFromSeed(
  cachedIds: Iterable<string>,
  seedIds: ReadonlySet<string>,
): string[] {
  return [...cachedIds].filter((id) => !seedIds.has(id));
}

/**
 * The `unapplied` id list out of a members-meta push result, or undefined when
 * the response does not carry one.
 *
 * The undefined answer is load bearing and is NOT the same as an empty array: a
 * server that predates the field answers without it, and reading that as "none
 * were unapplied" would tell applyMetaPushOutcome that every id in the batch is
 * linked, which on the hourly full resync means adding the entire guild to the
 * linked set at once. Parsed here rather than typed at the call site because the
 * push IO is declared as returning `unknown`.
 */
export function unappliedIdsFrom(result: unknown): string[] | undefined {
  if (typeof result !== 'object' || result === null) return undefined;
  const raw = (result as { unapplied?: unknown }).unapplied;
  if (!Array.isArray(raw)) return undefined;
  return raw.filter((id): id is string => typeof id === 'string');
}

/** A usable slice size: a positive integer, never above one request's capacity. */
export function resolveSliceSize(size: number | undefined): number {
  if (typeof size !== 'number' || !Number.isFinite(size) || size < 1) {
    return DEFAULT_SWEEP_SLICE_SIZE;
  }
  return Math.min(SWEEP_SLICE_MAX, Math.floor(size));
}

export class LinkedSweep {
  /** Members believed to have a linked game account. The pass iterates this. */
  private readonly linked = new Set<string>();
  /**
   * Linked members that need attention BEFORE the next scheduled pass reaches
   * them: something told us their game-side state moved. Always a subset of
   * `linked`, because every removal path drops both.
   */
  private readonly dirty = new Set<string>();
  /**
   * Ids the server told us have no link row, so the members-meta the bot
   * believes it pushed for them never landed anywhere. Kept until they are seen
   * linked again, at which point the caller is told to drop their cached record
   * so their join date and staff flair are re-pushed against the fresh row.
   * Bounded by the roster: pruneToRoster drops everyone who left.
   */
  private readonly noLinkRow = new Set<string>();
  /** The ids of the pass in flight, front to back. Empty means no pass. */
  private cursor: string[] = [];
  private cursorSource: PassSource = 'pass';
  /**
   * Whether the previous slice came from the dirty queue. Read by nextSlice to
   * bound dirty-first preemption: while pass-shaped work exists (an in-flight
   * cursor, an armed discovery walk, or a requested or due pass), dirty and
   * pass slices ALTERNATE, so a sustained feed (steady playtime-points items
   * are enough at the D18 envelope) cannot starve the pass indefinitely. The
   * pass is the safety net for exactly the members nothing reported moving,
   * so an unbounded preemption would quietly delete it.
   */
  private lastSliceWasDirty = false;
  /** A roster snapshot waiting to be walked as a discovery pass. */
  private discovery: string[] | null = null;
  private passRequested = false;
  /**
   * Negative infinity, not 0: the first pass has to be due at whatever the
   * host clock's origin happens to be, and a zero would make it due only once
   * `nowMs` had grown past one whole interval, which for a virtual clock
   * starting at 0 means never in the tests that matter.
   */
  private lastPassStartMs = Number.NEGATIVE_INFINITY;

  /** How many members are believed linked. */
  size(): number {
    return this.linked.size;
  }

  has(id: string): boolean {
    return this.linked.has(id);
  }

  /** A snapshot of the linked set, in insertion order. */
  linkedIds(): string[] {
    return [...this.linked];
  }

  dirtyIds(): string[] {
    return [...this.dirty];
  }

  /** Whether the server has told us this id has no link row to apply meta to. */
  hasNoLinkRow(id: string): boolean {
    return this.noLinkRow.has(id);
  }

  isPassInProgress(): boolean {
    return this.cursor.length > 0;
  }

  /** Which set the pass in flight is walking, or null when none is. */
  passSource(): PassSource | null {
    return this.cursor.length > 0 ? this.cursorSource : null;
  }

  /** How many ids of the pass in flight are still unserved. */
  remainingInPass(): number {
    return this.cursor.length;
  }

  isDiscoveryPending(): boolean {
    return this.discovery !== null;
  }

  lastPassStartedAtMs(): number {
    return this.lastPassStartMs;
  }

  isPassRequested(): boolean {
    return this.passRequested;
  }

  /**
   * Ask for a pass now, whatever the window says. GUILD_CREATE's kick calls this
   * first: a kick that only woke the task early would find the window still open
   * and do nothing, which is precisely the reconnect case where a pass is most
   * wanted.
   */
  requestPass(): void {
    this.passRequested = true;
  }

  /**
   * Arm ONE discovery pass over the roster: the boot case, where the linked set
   * is empty and there is nothing to iterate until something says who is linked.
   *
   * Idempotent while one is outstanding, and that is the whole reason it is a
   * method rather than a flag the wiring sets. Discovery is armed at every
   * COMPLETE roster seed, Discord re-sends GUILD_CREATE on every re-IDENTIFY,
   * and a reconnect storm therefore arms it repeatedly; re-arming would restart
   * the full-roster walk from the beginning each time and turn the storm into a
   * continuous roster rescan, which is the load this phase exists to remove.
   * The honest limit (Phase 6 QA): the guard covers OVERLAPPING discoveries
   * only. Reconnects spaced further apart than one walk (about 150 s at the
   * 5000-member envelope) each run their own; that is one batched request per
   * slice, still far cheaper than the per-member reads this replaced, and the
   * walk doubles as the reconnect's linkage heal.
   * Returns whether it armed, so the caller (and a test) can tell.
   */
  armDiscovery(rosterIds: Iterable<string>): boolean {
    if (this.discovery !== null) return false;
    if (this.cursor.length > 0 && this.cursorSource === 'discovery') return false;
    this.discovery = [...new Set(rosterIds)];
    return true;
  }

  /**
   * Apply the outbox link-change feed. `rosterHas` gates every ADDITION: an id
   * that is not in the guild cannot be flaired, and adding it would put a
   * permanent member of the pass beyond the reach of every removal path.
   *
   * An 'unlink' is applied whatever the roster says, because the point of the
   * item is to stop flairing that id, and a member who left the guild and
   * unlinked in the same window must not survive on the roster check.
   */
  applyLinkChangeItems(
    items: readonly LinkChangeLike[],
    rosterHas: (id: string) => boolean,
  ): LinkChangeSummary {
    const added: string[] = [];
    const removed: string[] = [];
    const dirtied: string[] = [];
    const metaStale: string[] = [];
    for (const item of items) {
      // Item-level tolerance, matching the outbox consumer's stream-level
      // listOf: this list is network input whatever the types say, and the
      // apply runs AFTER the drain consumed all four streams, so a throw on
      // one malformed element would reject the poll and lose every relay and
      // activity post in the same envelope. One bad item costs itself only.
      if (item === null || typeof item !== 'object') continue;
      const id = item.discordUserId;
      if (typeof id !== 'string' || id === '') continue;
      const terminal = terminalLinkKind(Array.isArray(item.kinds) ? item.kinds : []);
      if (terminal === 'unlink') {
        // The row is gone, so anything the bot believes it pushed for this id is
        // attached to nothing. Recorded only for roster members, which is what
        // keeps this set bounded by the guild rather than by history.
        if (rosterHas(id)) this.noLinkRow.add(id);
        if (this.unlink(id)) removed.push(id);
        continue;
      }
      if (!rosterHas(id)) continue;
      // A fresh 'link' row carries null meta columns, so the cached record has to
      // go whether or not this id was already believed linked. A 'flex'/'points'
      // item proves linkage too (neither moves for an unlinked account), so it
      // clears a standing no-link-row belief.
      const wasMissing = this.noLinkRow.delete(id);
      if (terminal === 'link' || wasMissing) metaStale.push(id);
      if (!this.linked.has(id)) {
        this.linked.add(id);
        added.push(id);
      }
      if (!this.dirty.has(id)) {
        this.dirty.add(id);
        dirtied.push(id);
      }
    }
    return { added, removed, dirtied, metaStale };
  }

  /**
   * Drop one member from every set this module holds: the single-member form
   * of pruneToRoster, for GUILD_MEMBER_REMOVE. Without it a departed member
   * with a live game link stays in the pass until the next COMPLETE roster
   * seed: flex-batch answers by link row (departure does not unlink), so every
   * pass produces a doomed 404 role write and nickname PATCH for them.
   *
   * Departure also ends the no-link-row bookkeeping, unlike an unlink: there
   * is no member left whose meta could be re-pushed, and a rejoin arrives
   * through GUILD_MEMBER_ADD and the feed with fresh state.
   */
  forget(id: string): boolean {
    this.noLinkRow.delete(id);
    return this.unlink(id);
  }

  /**
   * Apply a flex-batch answer for the ids that were sent.
   *
   * Positive evidence (a member came back) always applies. NEGATIVE evidence
   * (an id was sent and did not come back) applies only when `requested` matches
   * the number of DISTINCT ids sent, because that echo is the only thing that
   * separates "none of these are linked" from "the request was truncated". The
   * distinct count is what the server counts, so comparing against the raw array
   * length would read a perfectly delivered answer to a repeated id as suspect.
   *
   * Ids the answer carries that were never asked about are ignored: only what
   * was sent can be reasoned about, and a malformed answer must not be able to
   * inject members into the set.
   *
   * One deliberate staleness (Phase 6 QA): an unlink applied while the slice
   * containing that member was IN FLIGHT is re-added here by the stale answer's
   * positive evidence. The heal is the noLinkRow memory: the feed's unlink
   * recorded the id there, so the re-add reports the member in `metaStale`, the
   * resulting meta push comes back `unapplied` for them, and
   * applyMetaPushOutcome removes them again, all within the same slice's
   * follow-through. Pinned by "an unlink raced by its own in-flight slice heals
   * through the meta push" in the suite.
   */
  applyFlexBatchResult(
    sentIds: readonly string[],
    result: FlexBatchLike,
    rosterHas?: (id: string) => boolean,
  ): FlexBatchSummary {
    const sent = new Set(sentIds);
    const authoritative = result.requested === sent.size;
    const present = new Set<string>();
    const added: string[] = [];
    const removed: string[] = [];
    const metaStale: string[] = [];
    for (const member of result.members) {
      const id = member.discord_user_id;
      if (!sent.has(id) || present.has(id)) continue;
      present.add(id);
      // The roster gate mirrors applyLinkChangeItems, for the race an in-flight
      // slice opens: a departure or pruneToRoster that lands while the request
      // is out must not be undone by the stale answer's positive evidence,
      // because the re-added id would have no removal path until the next
      // complete seed. `present` is stamped above the gate on purpose, so an
      // authoritative answer's negative evidence still reads the id as
      // answered rather than as absent.
      if (rosterHas && !rosterHas(id)) continue;
      if (this.noLinkRow.delete(id)) metaStale.push(id);
      if (!this.linked.has(id)) {
        this.linked.add(id);
        added.push(id);
      }
    }
    if (authoritative) {
      for (const id of sent) {
        if (present.has(id)) continue;
        if (this.unlink(id)) removed.push(id);
      }
    }
    return { authoritative, added, removed, metaStale };
  }

  /**
   * Apply the linkage signal riding on a members-meta push the bot already made:
   * the accepted ids with no link row could not be applied, and the rest could,
   * which makes every id in the batch a decided one. On the hourly full resync
   * the batch is the whole roster, so this is a complete reconciliation that
   * costs no extra request at all.
   *
   * `unapplied === undefined` means the server did not report the field, and
   * nothing is inferred: reading it as an empty list would mark every id in the
   * batch linked, which on that same full resync is the entire guild.
   *
   * It deliberately does NOT touch the caller's last-pushed cache. Leaving an
   * unapplied member dirty there would re-push most of the guild every sweep
   * (L14), so the record stays cached and the correction rides `metaStale` when
   * the member is later seen linked.
   */
  applyMetaPushOutcome(
    batchIds: readonly string[],
    unapplied: readonly string[] | undefined,
  ): MetaPushSummary {
    const added: string[] = [];
    const removed: string[] = [];
    const dirtied: string[] = [];
    if (unapplied === undefined) return { added, removed, dirtied };
    const missing = new Set(unapplied);
    for (const id of new Set(batchIds)) {
      if (missing.has(id)) {
        this.noLinkRow.add(id);
        if (this.unlink(id)) removed.push(id);
        continue;
      }
      this.noLinkRow.delete(id);
      if (this.linked.has(id)) continue;
      this.linked.add(id);
      added.push(id);
      this.dirty.add(id);
      dirtied.push(id);
    }
    return { added, removed, dirtied };
  }

  /**
   * Drop everyone who is no longer in the guild, from every set this module
   * holds. Runs at a COMPLETE roster seed beside the per-member map eviction in
   * main.ts (L16): without it a member who left while the gateway was down stays
   * in the pass forever, costing a flex-batch entry per pass and a role write
   * against an id the guild no longer has.
   *
   * Returns the ids dropped from the linked/dirty/cursor sets. The no-link-row
   * set is pruned too and is deliberately not reported: it is bookkeeping about
   * pushes, not membership, and `hasNoLinkRow` is how a test reads it.
   */
  pruneToRoster(rosterIds: ReadonlySet<string>): string[] {
    const dropped = new Set<string>();
    for (const id of [...this.linked]) {
      if (rosterIds.has(id)) continue;
      this.linked.delete(id);
      dropped.add(id);
    }
    for (const id of [...this.dirty]) {
      if (rosterIds.has(id)) continue;
      this.dirty.delete(id);
      dropped.add(id);
    }
    for (const id of this.cursor) {
      if (!rosterIds.has(id)) dropped.add(id);
    }
    this.cursor = this.cursor.filter((id) => rosterIds.has(id));
    for (const id of [...this.noLinkRow]) {
      if (!rosterIds.has(id)) this.noLinkRow.delete(id);
    }
    return [...dropped];
  }

  /**
   * The next unit of work, or null when there is none. The whole scheduling
   * decision lives here so the wiring stays a call and a loop.
   *
   * The order is the priority: members something just told us about go first,
   * then the rest of the pass in flight, then a discovery pass, then the
   * periodic pass. A discovery outranks a periodic pass because it is a strict
   * superset of one (it walks the roster, which contains every linked member),
   * so running the periodic pass first would ask about the same members twice.
   */
  nextSlice(
    nowMs: number,
    sliceSize: number = DEFAULT_SWEEP_SLICE_SIZE,
    passIntervalMs?: number,
  ): SweepSlice | null {
    const size = resolveSliceSize(sliceSize);
    // Dirty first, but BOUNDED: after a dirty slice, pass-shaped work gets the
    // next one, so under sustained feed traffic the two alternate instead of
    // the dirty queue preempting the pass forever. "Pass-shaped work" counts
    // PENDING work too, not just a cursor already in flight: a requested or
    // due pass, or an armed discovery walk, that never gets to OPEN is starved
    // just as thoroughly as one stalled mid-cursor (the fresh-eyes round
    // proved the cursor-only bound starvable twelve slices out of twelve).
    // The cost is one slice interval of extra latency for a dirty member, and
    // only while pass work is actually contending; otherwise dirty is served
    // on every slice exactly as before.
    const passWork =
      this.cursor.length > 0 ||
      this.discovery !== null ||
      this.passRequested ||
      this.passDue(nowMs, passIntervalMs);
    if (this.dirty.size > 0 && !(this.lastSliceWasDirty && passWork)) {
      return this.takeDirty(size);
    }
    this.lastSliceWasDirty = false;
    if (this.cursor.length > 0) return this.takeFromCursor(size, false);
    if (this.discovery !== null) {
      const candidates = this.discovery;
      this.discovery = null;
      const opened = this.beginPass(candidates, 'discovery', nowMs, size);
      if (opened !== null) return opened;
    }
    if (this.passRequested || this.passDue(nowMs, passIntervalMs)) {
      const opened = this.beginPass([...this.linked], 'pass', nowMs, size);
      if (opened !== null) return opened;
    }
    // A pass or discovery that opened over NOTHING yields null above; dirty
    // work must still be served then, or the alternation gate would answer
    // null while work exists (an empty discovery snapshot is the reachable
    // case: dirty implies linked non-empty, so an empty PASS cannot coincide
    // with dirty work, but an empty roster snapshot can).
    if (this.dirty.size > 0) return this.takeDirty(size);
    return null;
  }

  /**
   * Hand a slice back unprocessed, for the one case that has to: the server
   * answered null (bot/server_client.ts reports a failure as null rather than
   * throwing), so nothing was observed and no belief may move.
   *
   * The ids go back to the FRONT, so a failing slice is retried before the rest
   * of the pass rather than after it. Re-serving is the right call over
   * skipping: these members were never asked about, and a skipped slice would
   * leave them unsynced until the next whole pass with nothing recording that it
   * happened.
   */
  restoreSlice(slice: SweepSlice): void {
    if (slice.source === 'dirty') {
      // Only members still believed linked go back: an unlink that arrived while
      // the request was in flight has already decided this id, and re-dirtying
      // it would put a member the feed just removed back into the sweep.
      for (const id of slice.ids) if (this.linked.has(id)) this.dirty.add(id);
      return;
    }
    this.cursorSource = slice.source;
    // A 'pass' cursor holds exactly the linked set, so ids unlinked or
    // forgotten while the failed slice was in flight do not go back; a
    // 'discovery' snapshot holds unlinked ids by design and answers for them
    // harmlessly, so it is restored whole.
    const ids = slice.source === 'pass' ? slice.ids.filter((id) => this.linked.has(id)) : slice.ids;
    this.cursor.unshift(...ids);
  }

  /** Take up to `size` ids off the dirty queue, oldest first. */
  private takeDirty(size: number): SweepSlice {
    const ids = [...this.dirty].slice(0, size);
    for (const id of ids) this.dirty.delete(id);
    this.lastSliceWasDirty = true;
    return { ids, source: 'dirty', opensPass: false };
  }

  /** Take the front of the pass in flight. */
  private takeFromCursor(size: number, opensPass: boolean): SweepSlice {
    const ids = this.cursor.slice(0, size);
    this.cursor = this.cursor.slice(size);
    return { ids, source: this.cursorSource, opensPass };
  }

  /**
   * Open a pass over `candidates`. The window is stamped and any standing
   * request consumed even when the candidate list is EMPTY: a pass over nobody
   * has completed, and leaving the request standing would re-enter this branch
   * on every tick for as long as the set stayed empty.
   */
  private beginPass(
    candidates: string[],
    source: PassSource,
    nowMs: number,
    size: number,
  ): SweepSlice | null {
    this.lastPassStartMs = Number.isFinite(nowMs) ? nowMs : this.lastPassStartMs;
    this.passRequested = false;
    this.cursor = candidates;
    this.cursorSource = source;
    if (this.cursor.length === 0) return null;
    return this.takeFromCursor(size, true);
  }

  /**
   * Whether the periodic window has elapsed. An UNUSABLE interval (missing,
   * non-finite, non-positive) is read as "not due", so a lost config value
   * degrades to passes driven by GUILD_CREATE's requestPass rather than to a
   * pass on every tick, which against a 3 second slice cadence would be a
   * continuous full rescan of the linked set.
   *
   * A clock that went BACKWARDS (an NTP correction) reads as due, matching
   * dueForFullResync in member_writes.ts: the alternative is a pass postponed by
   * however far the clock moved.
   */
  private passDue(nowMs: number, passIntervalMs: number | undefined): boolean {
    if (!Number.isFinite(nowMs)) return false;
    if (typeof passIntervalMs !== 'number' || !Number.isFinite(passIntervalMs)) return false;
    if (passIntervalMs <= 0) return false;
    if (this.lastPassStartMs === Number.NEGATIVE_INFINITY) return true;
    const elapsed = nowMs - this.lastPassStartMs;
    if (elapsed < 0) return true;
    return elapsed >= passIntervalMs;
  }

  /**
   * Remove one id from the sweep entirely. Only a 'pass' cursor is scanned: it
   * holds exactly the linked set, so an unlinked member must leave it, while a
   * 'discovery' cursor is a ROSTER snapshot that holds unlinked ids by design
   * and answers for them harmlessly (they simply come back absent).
   */
  private unlink(id: string): boolean {
    this.dirty.delete(id);
    const wasLinked = this.linked.delete(id);
    if (wasLinked && this.cursorSource === 'pass') {
      const at = this.cursor.indexOf(id);
      if (at >= 0) this.cursor.splice(at, 1);
    }
    return wasLinked;
  }
}
