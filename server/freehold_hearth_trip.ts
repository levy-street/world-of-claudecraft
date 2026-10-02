// THE REMOTE HEARTH TRIP ON A LIT REALM (07a; the touch-set manifest's section
// 4). The sim's useHearthKey asks its admission seam AFTER every local check
// (dead, combat, record, entry context, already home, the local clock); online
// this module answers it, and the durable account cooldown decides:
//
//   'admit'   only through a one-shot TICKET this module minted from a PROVED
//             commit of the cooldown advance, set immediately before its own
//             re-dispatch and cleared in that call's finally;
//   'pending' a trip has started (or is running) for the account from this
//             pid: the use is silent now and the server re-dispatches it once
//             the advance commits or refuses;
//   'deny'    the sim emits `busy`.
//
// The trip commits ONE character save carrying the housing hook (the account
// Hearth participant, plus the plot claim re-proved under its lock when this
// realm holds one), on the character FIFO, through commitFreeholdMutation. The
// hook's own outcome decides, never the save's boolean. Admission is per
// ACCOUNT (one pending trip per account per process, whichever character
// asked; a use from ANOTHER pid of that account while it runs is denied, since
// only the trip's own session is re-dispatched), a session with no lease nonce
// never starts one (its save would carry no nonce fence), every refusal is
// metered per account for its whole window (a relog does not reset it), and
// nothing here can be
// reached by a client frame: the ticket exists only inside one synchronous
// server-side re-dispatch, and the re-dispatch is not player input (no lane
// token, no detector observation), so it replays the frame path's prechecks
// itself (hearthKeyUseRefusal).
//
// Counts only reach a log or a metric: never an account id, an owner key, a
// plot id, a token or a holder.
import type { FreeholdKeyAdmission } from '../src/sim/freehold/hearth_key';
import type { FreeholdClaimFence } from './freehold_claim_db';
import { FREEHOLD_PERSIST_LOAD_PERMIT_WAIT_MS } from './freehold_login_bounds';
import type { FreeholdMutationOutcome, FreeholdMutationRequest } from './freehold_mutation';

/** The refusal memo's window: the player-waiting admission bound, reused
 *  rather than guessed. */
export const FREEHOLD_HEARTH_TRIP_MEMO_MS = FREEHOLD_PERSIST_LOAD_PERMIT_WAIT_MS;
/** The bound on the trip save's WAITS (the character FIFO, the market writer,
 *  the background permit): the same player-waiting bound, named for its own
 *  use so a retune of one is a visible decision about the other. */
export const FREEHOLD_HEARTH_TRIP_WAIT_MS = FREEHOLD_PERSIST_LOAD_PERMIT_WAIT_MS;

export interface FreeholdHearthTripSession {
  readonly pid: number;
  readonly characterId: number;
  readonly accountId: number;
  readonly leaseNonce: string | undefined;
  readonly left?: boolean;
  readonly escrowQuarantined?: boolean;
}

export interface FreeholdHearthTripCounters {
  started: number;
  advanced: number;
  cooldown: number;
  corrupt: number;
  unsupported: number;
  refused: number;
  failed: number;
  /** The save never reached the hook (a fence miss, a quarantine, the vault
   *  guard, the no-state arm, a guild-book refusal): nothing was attempted. */
  notRun: number;
  unresolved: number;
  /** A committed advance whose re-dispatch the sim then refused (R-2). */
  refusedAfterCommit: number;
  /** A committed advance whose re-dispatch a server precheck took before the
   *  sim saw it (draining, the vault fence, spectating, jailed, dark, or a
   *  session gone by the re-dispatch): the same R-2 class, apart. */
  droppedAfterCommit: number;
  /** Denied before any queue or database work (no loaded entry, no claim). */
  refusedPreQueue: number;
  /** Denied by the per-account refusal memo. */
  metered: number;
  /** The session left, or changed, before the outcome was applied. */
  abandoned: number;
  /** Committed advances whose COMMIT answer was lost and the verify proved
   *  landed: a subset of `advanced`. */
  verifiedLanded: number;
  /** Lost COMMIT answers the verify proved did NOT land (apart from `failed`,
   *  which is proved not committed without a verify). */
  verifiedNotLanded: number;
  /** A trip whose step AFTER its counted outcome threw (the re-dispatch into
   *  the sim, a merge): the outcome above stands, this counts the throw. */
  threwAfterOutcome: number;
  /** Every trip's wall time from its start to its outcome, summed (ms, through
   *  the host clock): divided by `started` it is the mean trip latency. */
  tripMsTotal: number;
}

/** What a re-dispatch met: 'dropped' when a server precheck took the use
 *  before the sim saw it (a session gone by the re-dispatch, the draining or
 *  vault-loot drop always, and after a committed advance the spectating,
 *  jailed and dark gates too), undefined otherwise. */
export type FreeholdHearthRedispatch = 'dropped' | undefined;

/** Fresh zeroed trip counters: the one initializer the trip module and the
 *  authority registry's unregistered answer share. */
export function createFreeholdHearthTripCounters(): FreeholdHearthTripCounters {
  return {
    started: 0,
    advanced: 0,
    cooldown: 0,
    corrupt: 0,
    unsupported: 0,
    refused: 0,
    failed: 0,
    notRun: 0,
    unresolved: 0,
    refusedAfterCommit: 0,
    droppedAfterCommit: 0,
    refusedPreQueue: 0,
    metered: 0,
    abandoned: 0,
    verifiedLanded: 0,
    verifiedNotLanded: 0,
    threwAfterOutcome: 0,
    tripMsTotal: 0,
  };
}

export interface FreeholdHearthTripHost {
  /** The LIVE session object for a pid (the same object every call while the
   *  session lives), or undefined. */
  sessionForPid(pid: number): FreeholdHearthTripSession | undefined;
  /** The plot store's view of the owner (null: no entry). */
  authority(ownerKey: string): {
    readonly loaded: boolean;
    readonly blocked: boolean;
    readonly plotId: string;
    readonly durableRev: string | null;
  } | null;
  /** The claim this process holds for the account's plot, if any. */
  claimFor(accountId: number): FreeholdClaimFence | undefined;
  /** commitFreeholdMutation over one save of this session. Never rejects. */
  commit(
    session: FreeholdHearthTripSession,
    request: FreeholdMutationRequest,
    waitSignal: AbortSignal,
  ): Promise<FreeholdMutationOutcome>;
  /** The server prechecks plus sim.useItem(HEARTH_KEY_ITEM_ID, pid).
   *  `advanced`: the durable cooldown advance already committed. */
  redispatch(session: FreeholdHearthTripSession, advanced: boolean): FreeholdHearthRedispatch;
  /** mergeFreeholdKeyReadyAt: forward only, a durable value may deny, never admit. */
  mergeReadyAt(ownerKey: string, readyAtMs: number): void;
  /** The plot store's remembered clock for the owner (adoptHearthReading):
   *  forward only by revision, so a relog on this process replays this clock,
   *  never the one read at login. */
  adoptDurable(ownerKey: string, readyAtMs: number, revision: string): void;
  /** Whether any live player still holds the owner key (the sim roster the
   *  last-leave clock eviction reads): a merge for an owner with none would
   *  install a clock nothing ever evicts. */
  ownerOnline(ownerKey: string): boolean;
  /** The owner key's account id, or null when it is not an online account key. */
  accountOf(ownerKey: string): number | null;
  readonly cooldownMs: number;
  nowMs(): number;
  /** The trip save's wait signal; AbortSignal.timeout(ms) unless a host binds
   *  its own (a test clock). */
  waitSignal?(ms: number): AbortSignal;
  warn(message: string): void;
}

type TicketVerdict = 'admit' | 'deny';

/** Bound to the (ownerKey, pid, characterId, leaseNonce) of the session it was
 *  minted for (the manifest's section 4): consumed only by that session. */
interface Ticket {
  readonly ownerKey: string;
  readonly pid: number;
  readonly characterId: number;
  readonly leaseNonce: string | undefined;
  readonly verdict: TicketVerdict;
  consumed: boolean;
}

export function createFreeholdHearthTrips(host: FreeholdHearthTripHost): {
  admission(ownerKey: string, pid: number): FreeholdKeyAdmission;
  /** A session left: prune the EXPIRED refusals. An unexpired one stays, so a
   *  relog inside its window is still metered. */
  onSessionLeft(): void;
  /** Whether a trip is in flight for the account (a test read: the claim is
   *  kept wanted by the host's holdInFlight, never by this). */
  inFlight(accountId: number): boolean;
  /** The refusal memo's live entry count (a test and gauge read). */
  refusalMemoSize(): number;
  readonly counters: FreeholdHearthTripCounters;
} {
  const counters = createFreeholdHearthTripCounters();
  // One entry per account with a trip in flight: the trip's identity and the
  // pid it re-dispatches. Bounded by the trip's save, never by a leave: the
  // save's WAITS (the character FIFO, the market writer, the background permit)
  // take the trip's wait signal (FREEHOLD_HEARTH_TRIP_MEMO_MS), its transaction
  // its own wall deadline and the verify FREEHOLD_VERIFY_BOUNDS, so the commit
  // always settles and run()'s finally always clears its entry.
  const pending = new Map<number, { readonly trip: number; readonly pid: number }>();
  // Account id to the end of its refusal window. Bounded by the accounts with
  // a refusal in the last window plus the expired entries since the last
  // prune (every session leave and every new refusal prune).
  const memo = new Map<number, number>();
  const pruneMemo = () => {
    const now = host.nowMs();
    for (const [accountId, until] of memo) if (now >= until) memo.delete(accountId);
  };
  let ticket: Ticket | null = null;
  let nextTrip = 0;

  // The SAME live session object (the frame path's own first gate), and still
  // the same character under the same lease nonce and not leaving: a takeover
  // that reused a pid or a nonce can never inherit the trip's re-dispatch.
  const sameSession = (a: FreeholdHearthTripSession, b: FreeholdHearthTripSession | undefined) =>
    b !== undefined &&
    b === a &&
    b.characterId === a.characterId &&
    b.leaseNonce === a.leaseNonce &&
    b.left !== true &&
    b.escrowQuarantined !== true;

  /** The ONE ticket setter, and its ONE call site is below. */
  function redispatchWithTicket(
    ownerKey: string,
    session: FreeholdHearthTripSession,
    verdict: TicketVerdict,
  ): 'consumed' | 'dropped' | 'refused' {
    const minted: Ticket = {
      ownerKey,
      pid: session.pid,
      characterId: session.characterId,
      leaseNonce: session.leaseNonce,
      verdict,
      consumed: false,
    };
    ticket = minted;
    let met: FreeholdHearthRedispatch;
    try {
      met = host.redispatch(session, verdict === 'admit');
    } finally {
      ticket = null;
    }
    if (minted.consumed) return 'consumed';
    return met === 'dropped' ? 'dropped' : 'refused';
  }

  async function run(
    ownerKey: string,
    accountId: number,
    session: FreeholdHearthTripSession,
    claim: FreeholdClaimFence | undefined,
    trip: number,
  ): Promise<void> {
    const startedAtMs = host.nowMs();
    let outcome: FreeholdMutationOutcome;
    try {
      outcome = await host.commit(
        session,
        {
          accountIds: [accountId],
          claimProofs: claim ? [claim] : [],
          plots: [],
          operations: [],
          hearth: { accountId, cooldownMs: host.cooldownMs },
        },
        host.waitSignal
          ? host.waitSignal(FREEHOLD_HEARTH_TRIP_WAIT_MS)
          : AbortSignal.timeout(FREEHOLD_HEARTH_TRIP_WAIT_MS),
      );
    } catch (error) {
      outcome = { kind: 'failed', error };
    } finally {
      // Compare-and-delete: only THIS trip may clear the account's flag.
      if (pending.get(accountId)?.trip === trip) pending.delete(accountId);
      counters.tripMsTotal += Math.max(0, host.nowMs() - startedAtMs);
    }
    let verdict: TicketVerdict = 'deny';
    let readyAtMs: number | null = null;
    // The revision the durable clock was proved at, for the store's memory.
    let revision: string | null = null;
    if (outcome.kind === 'committed' && outcome.hearth) {
      counters.advanced++;
      if (outcome.verified) counters.verifiedLanded++;
      verdict = 'admit';
      readyAtMs = Number(outcome.hearth.readyAtMs);
      revision = outcome.hearth.revision;
    } else if (outcome.kind === 'refused' && outcome.refusal.kind === 'hearth') {
      const result = outcome.refusal.result;
      if (result.kind === 'cooldown') {
        // NEVER admit on a cooldown: the database judged it at its own clock,
        // and the sim re-checks on the realm's, so admitting would let the gap
        // between the two buy a trip the durable clock refused.
        counters.cooldown++;
        readyAtMs = Number(result.readyAtMs);
        revision = result.revision;
      } else if (result.kind === 'corrupt') {
        counters.corrupt++;
        host.warn('freehold hearth trip refused: the stored ready time is past any cooldown');
      } else {
        counters.unsupported++;
        host.warn('freehold hearth trip refused: the account clock is unsupported');
      }
    } else if (outcome.kind === 'refused') {
      counters.refused++;
    } else if (outcome.kind === 'unresolved') {
      counters.unresolved++;
    } else if (outcome.kind === 'not_run') {
      counters.notRun++;
    } else if (outcome.kind === 'not_landed') {
      counters.verifiedNotLanded++;
    } else {
      counters.failed++;
    }
    // The store remembers the newest proved clock whatever happens to the
    // session, so a relog on this process replays it rather than the login's.
    if (readyAtMs !== null && revision !== null) host.adoptDurable(ownerKey, readyAtMs, revision);
    if (
      verdict !== 'admit' &&
      !(
        outcome.kind === 'refused' &&
        outcome.refusal.kind === 'hearth' &&
        outcome.refusal.result.kind === 'cooldown'
      )
    ) {
      pruneMemo();
      memo.set(accountId, host.nowMs() + FREEHOLD_HEARTH_TRIP_MEMO_MS);
    }
    const live = host.sessionForPid(session.pid);
    if (!sameSession(session, live)) {
      // Gone or changed: no re-dispatch. The clock is the ACCOUNT's, so a
      // durable value still merges while any session of the owner is live (a
      // sibling must not keep a stale clock), and never once none is: the last
      // leave evicted it, and the login merge reinstalls it.
      counters.abandoned++;
      if (readyAtMs !== null && host.ownerOnline(ownerKey)) host.mergeReadyAt(ownerKey, readyAtMs);
      return;
    }
    if (verdict === 'deny' && readyAtMs !== null) host.mergeReadyAt(ownerKey, readyAtMs);
    try {
      const answer = redispatchWithTicket(ownerKey, session, verdict);
      // Both are residual R-2 (a committed advance whose trip does not happen):
      // the key stays spent. A precheck drop (the host answered it as the
      // frame path would, a fenced vault busy) is counted apart and logs no
      // line, since a draining realm would log one per trip in flight.
      if (verdict === 'admit' && answer === 'dropped') counters.droppedAfterCommit++;
      else if (verdict === 'admit' && answer === 'refused') {
        counters.refusedAfterCommit++;
        host.warn('freehold hearth trip committed but the sim refused its re-dispatch');
      }
    } finally {
      if (verdict === 'admit' && readyAtMs !== null) host.mergeReadyAt(ownerKey, readyAtMs);
    }
  }

  return {
    admission(ownerKey, pid) {
      if (ticket !== null && ticket.ownerKey === ownerKey && ticket.pid === pid) {
        // The ticket names its session; any other session on that pid (a
        // takeover inside the re-dispatch) is refused and never consumes it.
        const live = host.sessionForPid(pid);
        if (
          !live ||
          live.characterId !== ticket.characterId ||
          live.leaseNonce !== ticket.leaseNonce
        ) {
          return 'deny';
        }
        ticket.consumed = true;
        return ticket.verdict;
      }
      const accountId = host.accountOf(ownerKey);
      const session = host.sessionForPid(pid);
      if (accountId === null || !session || session.accountId !== accountId) return 'deny';
      if (session.left === true || session.escrowQuarantined === true) return 'deny';
      // Single flight: the trip's own pid waits silently for its re-dispatch;
      // any other pid of the account is never re-dispatched, so it hears busy.
      const inFlight = pending.get(accountId);
      if (inFlight !== undefined) return inFlight.pid === pid ? 'pending' : 'deny';
      const until = memo.get(accountId);
      if (until !== undefined) {
        if (host.nowMs() < until) {
          counters.metered++;
          return 'deny';
        }
        memo.delete(accountId);
      }
      // BEFORE any queue: a held, quiesced or unloaded entry, a durable row
      // this process holds no claim for, or a session with no lease nonce (its
      // save would carry no nonce fence; every handshake mints one) never
      // spends the shared cooldown.
      const authority = host.authority(ownerKey);
      const claim = host.claimFor(accountId);
      if (
        session.leaseNonce === undefined ||
        !authority ||
        !authority.loaded ||
        authority.blocked ||
        (authority.durableRev !== null && (!claim || claim.plotId !== authority.plotId))
      ) {
        counters.refusedPreQueue++;
        return 'deny';
      }
      const trip = ++nextTrip;
      pending.set(accountId, { trip, pid });
      counters.started++;
      void run(
        ownerKey,
        accountId,
        session,
        authority.durableRev !== null ? claim : undefined,
        trip,
      )
        // Every outcome was counted before anything that can throw runs (the
        // re-dispatch into the sim, a merge), so a throw here is its own count
        // and line, never an unhandled rejection.
        .catch(() => {
          counters.threwAfterOutcome++;
          host.warn('freehold hearth trip threw after its outcome was counted');
        });
      return 'pending';
    },
    onSessionLeft() {
      pruneMemo();
    },
    inFlight(accountId) {
      return pending.has(accountId);
    },
    refusalMemoSize() {
      return memo.size;
    },
    counters,
  };
}
