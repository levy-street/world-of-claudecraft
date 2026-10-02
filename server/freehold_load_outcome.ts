// THE LOAD-OUTCOME VOCABULARY: every reason a durable housing load can refuse,
// which of those reasons a later read can change the answer to, and the two
// shapes the join path consumes. Data only, with no store state and no ports,
// which is why it is out here: the metric series walks the kind list, the join
// path installs the LoadedFreehold, and neither of them wants the store.
//
// THE TWO GROUPS ARE THE POINT. A DATA cause answers the same way every time, so
// its hold is terminal for the entry and re-reading it spends a permit and a
// statement on a login path for nothing. A CAPACITY cause can answer differently
// on the next read, so its hold is repairable. One kind is neither, and says so.

import { boundedFreeholdDetail } from '../src/sim/freehold/load_report';
import type { PersistedFreehold } from '../src/sim/freehold/persisted';
import { FREEHOLD_PRIMARY_PLOT_INDEX } from './freehold_db';

/**
 * Every reason a durable load can refuse, as a VALUE so a consumer can walk it.
 *
 * The metrics family that labels on this kind used to key its series on
 * whatever the by-kind tally happened to contain, which made its bounded-label
 * promise a property of the union type rather than of anything at runtime. It
 * now walks this list (the server/offline_fence_refusals.ts OFFLINE_FENCE_WRITERS
 * shape), so a widened producer cannot grow the series set on its own and a
 * kind that has never fired reads zero rather than being absent.
 */

export const FREEHOLD_LOAD_FAILURE_KINDS = [
  'unsupported',
  'malformed',
  'oversize',
  // The genuinely ROW-LEVEL cause: the SQL reader saw rows for this account and
  // none of them sits in the admitted slot. It is a data incident.
  'unadmitted',
  // The three ADMISSION causes, split out because the metric's own help text
  // promises an operator four different responses and one label cannot give
  // them: a full local cap is a login-storm capacity signal, a missing permit is
  // pool or gate saturation, and a thrown read is a database fault. A host with
  // no store answers the same hold SHAPE but books no counter at all, so it is
  // deliberately absent from this list.
  'cap_full',
  'no_permit',
  'read_threw',
  // The WHOLE-PRELOAD cap: every step answered inside its own bound and the sum
  // of them did not, so an operator seeing this is seeing a login that ran past
  // FREEHOLD_PERSIST_LOGIN_BUDGET_MS rather than any one step timing out.
  'no_budget',
  // The GLOBAL CLAIM cause (07a): another realm holds this plot's live claim,
  // so the row was never read. Capacity, not data: the next login can answer
  // differently once that realm lets the plot go or its claim expires.
  'claim_busy',
  // The ORDERING cause, and the only kind that is neither data nor capacity: the
  // sim already holds a record for this owner and it carries the STAND-IN, which
  // means it was seeded WITHOUT an install, which means nothing can ever teach it
  // the identity a row would be created under. See classify's absent arm.
  'unnamed_record',
] as const;

/** The load-failure kinds a LATER READ CAN CHANGE THE ANSWER TO, and so the ones
 *  whose hold is REPAIRABLE rather than terminal. They are the CAPACITY causes:
 *  the store's own cap was full, no background permit arrived inside the login
 *  bound, the read threw, or the whole load ran past its budget.
 *
 *  DERIVED, so the two lists cannot drift. An earlier version of this line
 *  claimed derivation while spelling three literals, and the very commit that
 *  wrote it added a fifth kind the set then did not know about. It is a
 *  subtraction now: everything that is not a DATA cause and not the ordering
 *  cause is a capacity cause, so a kind added to the list above lands in exactly
 *  one of the two groups by construction.
 *
 *  THE DATA CAUSES are terminal because the same row produces the same answer
 *  every time and re-reading it spends a permit and a statement on a login path
 *  for nothing. THE ORDERING CAUSE (`unnamed_record`) is terminal for its own
 *  reason: nothing inside one session can rename a load-once record. */
/** TYPED TO THE LIST, not to `string`. The subtraction below is real derivation
 *  either way, but with a bare string set the guarantee rested on one assertion
 *  in the suite: a typo here compiled clean and silently moved a DATA cause into
 *  the repairable group, which is re-reading an unreadable row on every login
 *  forever, the regression ruling 2 exists to prevent arrived at from the other
 *  side. The default direction of a missing entry is still the permissive one,
 *  which is why the set's exact membership is also pinned. */
const FREEHOLD_TERMINAL_HOLD_KINDS: ReadonlySet<(typeof FREEHOLD_LOAD_FAILURE_KINDS)[number]> =
  new Set(['unadmitted', 'unsupported', 'malformed', 'oversize', 'unnamed_record']);
export const FREEHOLD_RETRYABLE_HOLD_KINDS: ReadonlySet<string> = new Set(
  FREEHOLD_LOAD_FAILURE_KINDS.filter((kind) => !FREEHOLD_TERMINAL_HOLD_KINDS.has(kind)),
);

/** Why an account's durable row must not be written this session. `kind` is the
 *  classification the load produced; `detail` is dev-channel prose. */
export interface FreeholdRecoveryHold {
  /** Derived from the list above, so the two can never drift apart. */
  readonly kind: (typeof FREEHOLD_LOAD_FAILURE_KINDS)[number];
  readonly detail: string;
  readonly plotIndex: number;
  readonly durableRev: string;
}

/** One account's durable answer, as the join path consumes it. `hold` non-null
 *  means install nothing and write nothing. `state` null means the answer
 *  carries no document: with `durableRev` null and `recordWithheld` false
 *  that is NO durable row (the install puts in a default under `plotId`, which
 *  this store persists), and otherwise it is an answer that must put nothing
 *  in at all. */
export interface LoadedFreehold {
  readonly accountId: number;
  readonly plotIndex: number;
  readonly plotId: string;
  /** Null when no durable row exists yet, so the first write is insert-only. */
  readonly durableRev: string | null;
  readonly state: PersistedFreehold | null;
  readonly hearthReadyAtMs: number;
  readonly hearthRevision: string;
  readonly hold: FreeholdRecoveryHold | null;
  /**
   * TRUE when the install must put NO record in, whatever the other fields say
   * (the Hearth clock, a separate and forward-only durable fact, still merges).
   * The other fields are not enough on their own: an answer for a fresh account
   * whose first insert has not landed is revision-null and hold-null, exactly
   * how an absent row reads, and the install puts an empty default in for that.
   * Two producers, and only these:
   * - preload's already-live arm: the answer was read BESIDE a live record,
   *   which is the truth. Named `besideLiveRecord` until ruling (b) widened it;
   *   an answer installed after that record's eviction put an EMPTY default in
   *   under the account's real name, the eleventh path.
   * - the join's WITHHELD verdict (server/freehold_join_answer.ts): no loaded
   *   entry vouches for the answer at install time, because the entry it came
   *   from has gone. No production join installs a raw preload answer any more,
   *   so this second producer is the one the install's check stands on.
   *
   * REQUIRED, and the install acts only on a positive `false`, so a constructor
   * or projection that loses the field fails CLOSED rather than reopening it.
   */
  readonly recordWithheld: boolean;
}

/** The durable revision a recovery hold reports when there is no row to name
 *  one. Its own constant rather than the hearth clock's ABSENT_HEARTH_REVISION,
 *  which shares the value but names a different counter: this is the PLOT's
 *  compare-and-swap fence. Dev-channel only, but a field named for the wrong
 *  counter is how a later reader learns the wrong model. */
export const FREEHOLD_ABSENT_DURABLE_REV = '0';

/**
 * The answer the whole-preload cap produces, and the ONE hold in this store that
 * leaves the entry untouched. The read it gave up waiting for is still in flight
 * behind a single-flight slot; marking the entry held would overwrite whatever
 * that read then learns, and the honest answer is that this LOGIN got nothing,
 * not that the account is unreadable. It books its own kind so an operator can
 * tell a login that ran out of budget from one that lost a permit.
 *
 * PURE, and out here with the rest of the vocabulary rather than inside the
 * store: it is a LoadedFreehold constructor, which is this module's subject, and
 * the store keeps the two things that are actually its own, the counters and the
 * operator line.
 */
export function freeholdBudgetRefusal(
  accountId: number,
  budgetMs: number,
  /** The COLD clock, handed in rather than imported: ABSENT_HEARTH_REVISION and
   *  FREEHOLD_ABSENT_DURABLE_REV share a value and name different counters, and
   *  importing the hearth module here would close a cycle through the store. */
  hearth: { readonly readyAtMs: number; readonly revision: string },
): LoadedFreehold {
  const detail = boundedFreeholdDetail(`no durable answer within ${budgetMs} ms`);
  return {
    accountId,
    plotIndex: FREEHOLD_PRIMARY_PLOT_INDEX,
    plotId: '',
    durableRev: null,
    state: null,
    hearthReadyAtMs: hearth.readyAtMs,
    hearthRevision: hearth.revision,
    recordWithheld: false,
    hold: {
      kind: 'no_budget',
      detail,
      plotIndex: FREEHOLD_PRIMARY_PLOT_INDEX,
      durableRev: FREEHOLD_ABSENT_DURABLE_REV,
    },
  };
}

/** What a REPLAY of a store entry answers with: the entry's own knowledge, plus
 *  whichever document the caller decided this reader may see.
 *
 *  Declared structurally rather than over the store's entry type, so this module
 *  stays free of the store, and it is the LoadedFreehold constructor for the
 *  replay arms exactly as freeholdBudgetRefusal is for the cap. */
export interface FreeholdEntrySnapshot {
  readonly accountId: number;
  readonly plotIndex: number;
  readonly plotId: string;
  readonly durableRev: string | null;
  readonly hearthReadyAtMs: number;
  readonly hearthRevision: string;
  readonly hold: FreeholdRecoveryHold | null;
}

/** Project one entry into the answer the join path consumes.
 *
 *  THE CLOCK IS THE ENTRY'S, never a hard-coded cold one. These are the replay
 *  arms: they issue no read, so reporting 0 would tell a second character of the
 *  same account that the shared Hearth cooldown is ready when the read that took
 *  it said otherwise. */
export function freeholdSnapshotOf(
  entry: FreeholdEntrySnapshot,
  state: PersistedFreehold | null,
  /** True from the already-live arm only; see `recordWithheld`. */
  recordWithheld: boolean,
): LoadedFreehold {
  return {
    accountId: entry.accountId,
    plotIndex: entry.plotIndex,
    plotId: entry.plotId,
    durableRev: entry.durableRev,
    state,
    hearthReadyAtMs: entry.hearthReadyAtMs,
    hearthRevision: entry.hearthRevision,
    hold: entry.hold,
    recordWithheld,
  };
}

/** True when this kind's hold is TERMINAL for the entry, which is also what
 *  decides whether the entry stays `loaded`.
 *
 *  `entry.loaded` is what preload's replay arms and retain's lost-entry repair
 *  consult, so setting it for every kind meant an account refused by a CAPACITY
 *  blip replayed that refusal for the life of the entry: measured with the
 *  shared gate saturated, eight of eight logins at one join per second were
 *  refused and a lone re-join for a refused account still replayed the hold, so
 *  a momentary stall became a session-long housing outage. The four fixture
 *  classes in the rollout contract sanction a terminal hold for a DATA cause,
 *  where a repeat read cannot change the answer, and none of them sanctions one
 *  for a capacity cause.
 *
 *  A REPAIRABLE ENTRY STAYS WRITE-BLOCKED WHILE UNREPAIRED, which is the caveat
 *  that makes this safe: the store's `blocked()` is `!loaded || isHeld`, so an
 *  entry with no `loaded` and a hold is blocked by BOTH halves, and nothing
 *  writes for it until a later read actually succeeds and clears the hold. */
export const freeholdHoldIsTerminal = (kind: FreeholdRecoveryHold['kind']): boolean =>
  !FREEHOLD_RETRYABLE_HOLD_KINDS.has(kind);

/**
 * A LOADED answer: what the entry now knows (its plot index, plot id, durable
 * revision and state) with the settled clock and no hold. Both loaded arms of
 * the store's classify, the absent row and a normalized row, answer through it
 * after writing those fields onto the entry, so the answer and the entry agree.
 */
export function freeholdLoadedAnswer(
  accountId: number,
  entry: {
    readonly plotIndex: number;
    readonly plotId: string;
    readonly durableRev: string | null;
    readonly state: PersistedFreehold | null;
  },
  hearth: { readonly readyAtMs: number; readonly revision: string },
): LoadedFreehold {
  return {
    accountId,
    plotIndex: entry.plotIndex,
    plotId: entry.plotId,
    durableRev: entry.durableRev,
    state: entry.state,
    hearthReadyAtMs: hearth.readyAtMs,
    hearthRevision: hearth.revision,
    hold: null,
    recordWithheld: false,
  };
}

/** The answer a held load returns. No state and no durable revision, ever: a
 *  hold means install nothing and write nothing, so the caller keeps whatever
 *  the sim seeds and the row on disk is left exactly as it was. */
export function freeholdHoldAnswer(
  entry: { readonly accountId: number; readonly plotId: string },
  hold: FreeholdRecoveryHold,
  hearth: { readonly readyAtMs: number; readonly revision: string },
): LoadedFreehold {
  return {
    accountId: entry.accountId,
    plotIndex: hold.plotIndex,
    plotId: entry.plotId,
    durableRev: null,
    state: null,
    hearthReadyAtMs: hearth.readyAtMs,
    hearthRevision: hearth.revision,
    hold,
    recordWithheld: false,
  };
}
