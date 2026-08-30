// The $WOC Exchange delivery arms, extracted from the service coordinator
// (the monolith ratchet row's named candidate, landed by the escrow
// write-path rider; move-not-rewrite). Everything here advances a PAID
// settlement toward the buyer and residue toward closure: the batch driver,
// the eager-confirm and crash-recovery entries, the legacy-residue
// converges, the book-once custody rail, the direct hand-off with its
// grant ledger, and the return flight. The exactly-once semantics live in
// the method comments below, verbatim from the coordinator; the ledgers
// and deps stay ON the service (live state), handed in through the ctx.

import type { InvSlot } from '../src/sim/types';
import type {
  WocDeliveryScope,
  WocListingRow,
  WocMarketCustody,
  WocMarketDb,
  WocSettlementRow,
  WocSweepErrorTag,
} from './woc_market';
import {
  WOC_LOCAL_STAMP_HIGH_WATER,
  wocBackedOffIds,
  wocParkRow,
} from './woc_market_local_ledgers';
import {
  listingReturnCustodyRef,
  listingSoldNoticeCustodyRef,
  settlementCustodyRef,
} from './woc_market_rules';

/** Minute-scale cadence for the two legacy-residue arms (they converge an
 *  OLDER binary's crash residue, so every-pass cost bought nothing). */
const REDRIVE_INTERVAL_MS = 60_000;
/** Listing-id page size for the residue walk. */
const REDRIVE_PAGE = 500;

/** How many FIFO-busy grant parks one scope absorbs before its remaining
 *  settlement work stops for the pass (the review round's bound on the FIFO
 *  close): each busy park already cost one full grant-entry deadline inside
 *  the LOCKED sweep segment, and without a budget a save-wave wedge priced
 *  the segment at one deadline PER ROW across both batch arms (up to
 *  2 x SWEEP_BATCH deadlines of advisory-lock hold). Two is enough to ride
 *  out one isolated wedged buyer without surrendering the pass. */
const WOC_GRANT_BUSY_BUDGET = 2;

/** The slice of the service the arms consume. The maps are the service's
 *  process-local ledgers (woc_market_local_ledgers.ts owns the arithmetic);
 *  the arms never construct or replace them, only read and mutate entries. */
export interface WocDeliveryCtx {
  readonly db: WocMarketDb;
  readonly custody: WocMarketCustody;
  readonly realm: string;
  now(): number;
  sweepError(arm: WocSweepErrorTag, err: unknown): void;
  pruneLocalLedgers(nowMs: number): void;
  readonly parkedDeliveries: Map<number, number>;
  readonly parkedReturns: Map<number, number>;
  readonly pendingGrants: Map<
    string,
    { characterId: number; leaseNonce: string | undefined; stampMs: number }
  >;
  readonly pendingMail: Map<string, { stampMs: number; written: boolean }>;
  readonly parkRetryMs: number;
  readonly sweepBatch: number;
}

export interface WocMarketDeliveryArms {
  deliverConfirmedSettlements(nowMs: number, scope: WocDeliveryScope): Promise<number>;
  reconcileDelivering(nowMs: number, scope: WocDeliveryScope): Promise<number>;
  redriveDeliveredTails(nowMs: number, scope: WocDeliveryScope): Promise<number>;
  disposeSoldResidue(nowMs: number, scope: WocDeliveryScope): Promise<number>;
  returnUndisposedItems(nowMs: number, scope: WocDeliveryScope): Promise<number>;
  returnListingItem(listing: WocListingRow): Promise<boolean>;
}

/** Process-lifetime count of stamp-ledger high-water crossings (the counted
 *  half of the stamp bound: the warn line is the moment, this number is the
 *  readout's history). Module-level like the db contention counters: one
 *  delivery-arms instance per realm process. */
let stampHighWaterCrossings = 0;
export function wocStampHighWaterCount(): number {
  return stampHighWaterCrossings;
}

export function createWocMarketDeliveryArms(ctx: WocDeliveryCtx): WocMarketDeliveryArms {
  /** Next time the delivered-residue arm may run (minute-scale: it converges
   *  an OLDER binary's crash residue, so every-pass cost bought nothing). */
  let redriveDueAtMs = 0;
  /** Listing-id cursor for the residue page walk; resets on an exhausted
   *  cycle. */
  let redriveCursor = 0;
  /** The dispose arm's own minute gate (same cadence, independent clock so
   *  the two residue arms cannot hide each other's failures). */
  let disposeDueAtMs = 0;
  /** One line per crossing, not per stamp: the stamp maps hold exactly-once
   *  intents nothing may drop, so the high-water is an incident signal (the
   *  write-path rider's bound for the stamp side), COUNTED so the readout
   *  can date it, and re-arming below the mark keeps a hovering ledger from
   *  logging every beat. The TOTAL across both maps is what is compared:
   *  the incident is entries held, wherever they sit. */
  let stampHighWaterWarned = false;

  function watchStampHighWater(): void {
    const total = ctx.pendingGrants.size + ctx.pendingMail.size;
    if (total >= WOC_LOCAL_STAMP_HIGH_WATER) {
      if (!stampHighWaterWarned) {
        stampHighWaterWarned = true;
        stampHighWaterCrossings++;
        console.warn(
          `[woc_market] delivery intent ledger high water: grants ${ctx.pendingGrants.size}, mail ${ctx.pendingMail.size} (cap-less by design; deliveries are stamping faster than they settle)`,
        );
      }
    } else {
      stampHighWaterWarned = false;
    }
  }

  async function runDeliveryBatch(
    arm: 'delivered' | 'reconciled',
    batch: readonly WocSettlementRow[],
    nowMs: number,
    scope: WocDeliveryScope,
  ): Promise<number> {
    // Pruned here rather than only at pass start (the eager confirm path
    // enters through this method without ever winning the sweep lock), and
    // BEFORE the contended return so a contended pass still ages the ledgers.
    // A pass where BOTH delivery arms throw before reaching here skips one
    // prune beat, which is harmless: backedOffIds filters on retryAtMs, so a
    // stale entry can never exclude a row, only linger until the next prune.
    ctx.pruneLocalLedgers(nowMs);
    if (scope.contended) return 0;
    let advanced = 0;
    for (const settlement of batch) {
      const retryAt = ctx.parkedDeliveries.get(settlement.id);
      // Belt only: the batch reads already exclude rows inside their backoff
      // window. The reachable case is an EAGER-confirm park landing between
      // the reconcile arm's read and this row's turn in the loop (a freshly
      // claimed 'confirmed' row can never be parked: parks live in
      // 'delivering').
      if (retryAt !== undefined && retryAt > nowMs) continue;
      try {
        const out = await deliverOne(settlement);
        if (out === 'advanced') {
          advanced++;
          ctx.parkedDeliveries.delete(settlement.id);
        } else if (out === 'parked' || out === 'parked_busy') {
          // The park stat counts only parks that STOOD (a cap-refused park
          // leaves the row un-excluded, so it retries next pass and counting
          // it would overstate the standing set); the rotation stamp fires
          // either way so a refused row still cycles off the batch head.
          if (wocParkRow(ctx.parkedDeliveries, settlement.id, nowMs + ctx.parkRetryMs)) {
            scope.parked++;
          }
          await ctx.db.touchSettlementRow(settlement.id);
          if (out === 'parked_busy') {
            // The busy budget: each of these already cost one grant-entry
            // deadline inside the locked segment, so past the budget the
            // scope stops its settlement work exactly like a contended
            // pass (same stop semantics, deliberately shared: the rows a
            // break leaves behind are already 'delivering' and the next
            // pass retries them).
            scope.busyParks = (scope.busyParks ?? 0) + 1;
            if (scope.busyParks >= WOC_GRANT_BUSY_BUDGET) {
              scope.contended = true;
              break;
            }
          }
        } else if (out === 'skip') {
          // 'skip' after custody was booked means the settlement or listing
          // row left the shape only a hand edit can produce: it is invisible
          // to every monitor class, so the ONE place that saw it must say so.
          ctx.parkedDeliveries.delete(settlement.id);
          ctx.sweepError(
            arm,
            new Error(
              `settlement ${settlement.id} vanished mid-delivery (listing ${settlement.listingId}): hand-moved row?`,
            ),
          );
        } else if (out === 'contended') {
          scope.contended = true;
          break;
        }
      } catch (err) {
        // Per-settlement isolation: one poisoned row must not strand the rest
        // of the batch until the next pass.
        ctx.sweepError(arm, err);
      }
    }
    return advanced;
  }

  async function deliverConfirmedSettlements(
    nowMs: number,
    scope: WocDeliveryScope,
  ): Promise<number> {
    // Honor a contended scope BEFORE claiming: the claim UPDATE moves rows
    // into 'delivering', and claiming a batch this pass will not deliver
    // only feeds the stuck-delivering readout for nothing.
    if (scope.contended) return 0;
    const claimed = await ctx.db.claimDeliverableSettlements(ctx.realm, ctx.sweepBatch);
    return runDeliveryBatch('delivered', claimed, nowMs, scope);
  }

  /** Crash recovery: rows stuck in 'delivering' resume here; the custody
   *  book-once dedupe makes re-running the whole arm safe. Rows inside their
   *  in-process backoff window are excluded in the QUERY, so a standing
   *  parked set consumes no batch slots and costs no writes while it waits. */
  async function reconcileDelivering(nowMs: number, scope: WocDeliveryScope): Promise<number> {
    const stuck = await ctx.db.deliveringSettlements(
      ctx.realm,
      ctx.sweepBatch,
      wocBackedOffIds(ctx.parkedDeliveries, nowMs),
    );
    return runDeliveryBatch('reconciled', stuck, nowMs, scope);
  }

  /** Drive an older binary's delivered-but-unclosed residue FORWARD: custody
   *  completed ('delivered') but the separately-committed close tail never
   *  ran, leaving a listing nothing else may touch (cancel, suspend, reclaim
   *  and the close arms all refuse over the live settlement). The finalize
   *  transaction converges it to the finished sale exactly once; under the
   *  new binary the tail cannot tear, so this converges a FINITE set and runs
   *  at minute scale over a bounded id page. The FINALIZE work per beat is
   *  bounded at ctx.sweepBatch like every other arm (each finalized row also
   *  costs a durable custody parcel row write, and the one
   *  time residue is plentiful, the first boot after a legacy upgrade, is
   *  exactly when the realm can least absorb an unbounded burst); a truncated
   *  page resumes right behind the last processed row on the next beat. */
  async function redriveDeliveredTails(nowMs: number, scope: WocDeliveryScope): Promise<number> {
    if (nowMs < redriveDueAtMs || scope.contended) return 0;
    redriveDueAtMs = nowMs + REDRIVE_INTERVAL_MS;
    const page = await ctx.db.deliveredUnclosedSettlementsPage(
      ctx.realm,
      redriveCursor,
      REDRIVE_PAGE,
      ctx.sweepBatch,
    );
    // The cursor advances past the page even when a break below leaves rows
    // unfinished: those wait for the cursor to wrap (a later beat), which
    // converges, just slower than the beat interval on a contended cycle.
    redriveCursor = page.lastListingId ?? 0;
    let advanced = 0;
    for (const settlement of page.settlements) {
      try {
        // The listing read only costs when residue actually exists, which is
        // the rare case (usually zero rows survive the page probe).
        const listing = await ctx.db.listingById(ctx.realm, settlement.listingId);
        if (!listing) continue;
        const out = await finalizeDelivered(settlement, listing);
        if (out === 'finalized') {
          // Counted and notified ONLY on a real transition: a re-run whose
          // close already landed reports 'already_final', which keeps this
          // beat from re-mailing the seller's sold notice (item-free, but a
          // collected-and-deleted notice would still re-appear) and from
          // reporting converged work as fresh.
          advanced++;
          await notifySellerSold(listing);
        } else if (out === 'contended') {
          scope.contended = true;
          break;
        }
      } catch (err) {
        ctx.sweepError('redriven', err);
      }
    }
    return advanced;
  }

  /** The sibling residue: a closed sold listing with a STANDING sale row
   *  whose dispose flag never landed (the old binary crashed between its
   *  close and dispose statements). Its own arm so a throw or a contended
   *  pass can never cost the page walk its count. */
  async function disposeSoldResidue(nowMs: number, scope: WocDeliveryScope): Promise<number> {
    if (nowMs < disposeDueAtMs || scope.contended) return 0;
    disposeDueAtMs = nowMs + REDRIVE_INTERVAL_MS;
    return ctx.db.disposeSoldResidueListings(ctx.realm, ctx.sweepBatch);
  }

  /**
   * Book a custody parcel exactly once, with the claim in POSTGRES rather than
   * in the mail blob: the blob's own marker is advisory (a player can delete an
   * emptied letter, and an older binary's loader strips the field), so it can
   * never be the authority.
   *
   * An existing claim is CONSULTED, never adopted: booked means a prior pass
   * really delivered (done). An unbooked claim may resume the write under the
   * SAME ref only with evidence the parcel was not already collected: either
   * this process stamped the intent and has NOT yet handed a parcel to the
   * post office (an UNWRITTEN pendingMail entry: nothing exists to collect),
   * or the parcel is still IN the live book (presence is permission). Once an
   * attempt has reached the post office, in-process memory proves nothing
   * about collection, so only the in-book check authorizes from then on. An
   * unbooked claim that fails both is ambiguous, the mailed item may already
   * sit in the buyer's bags with its letter deleted, so it PARKS (false), as
   * do a grant-intent claim (the hand-off may have landed) and a claim with
   * no intent at all (a legacy row, or a claim whose process died before
   * stamping): visible in the unbooked-claims read, never duplicated.
   *
   * A booking failure KEEPS the claim, unbooked and visible: releasing it
   * made a repeatedly failing mail write invisible to the operator, and the
   * resume above makes the kept claim converge once the write succeeds.
   *
   * An ITEM-FREE letter (the seller's sold notice) never touches the ledger
   * at all: it can duplicate nothing and destroy nothing, its only writer
   * runs once per finalized sale, and a durable claim for it would park
   * forever on a transient failure (no arm ever re-notifies), polluting the
   * one readout the operator watches. The in-book dedupe still absorbs
   * same-process retries.
   */
  async function bookCustodyOnce(
    recipient: { key: string; name: string },
    letter: 'delivery' | 'return' | 'sold_notice',
    items: InvSlot[],
    custodyRef: string,
  ): Promise<boolean> {
    if (items.length === 0) {
      await ctx.custody.persistMailParcel(recipient, letter, items, custodyRef);
      return true;
    }
    const fresh = await ctx.db.claimCustodyRef(ctx.realm, custodyRef);
    if (fresh) {
      // Stamp the durable mail intent BEFORE the parcel exists anywhere, so a
      // crash at any later point leaves a claim that says which rail owns it.
      if (!(await ctx.db.markCustodyMailIntent(custodyRef))) return false;
      ctx.pendingMail.set(custodyRef, { stampMs: ctx.now(), written: false });
      watchStampHighWater();
    } else {
      const state = await ctx.db.custodyRefState(custodyRef);
      if (state === null) {
        // The row vanished between the claim attempt and this read, which
        // only hand intervention can cause; park this pass and let the next
        // one mint a fresh claim.
        return false;
      }
      if (state.booked) {
        ctx.pendingMail.delete(custodyRef);
        return true;
      }
      if (state.grantCharacterId !== null) return false;
      if (!state.mailIntent) return false;
      const attempt = ctx.pendingMail.get(custodyRef);
      const unwritten = attempt !== undefined && !attempt.written;
      if (!unwritten && !ctx.custody.hasParcel(custodyRef)) {
        return false;
      }
      // Attributed to the mail rail with the parcel provably uncollected:
      // fall through and resume the durable write (the in-book dedupe makes
      // the re-mail idempotent, and booked_at still gates the advance).
    }
    // Flip written BEFORE the call: a throw anywhere inside persistMailParcel
    // can still leave the parcel in the LIVE book (the blob half failing),
    // so from this line on only the in-book check may authorize a retry.
    const attempt = ctx.pendingMail.get(custodyRef);
    if (attempt) attempt.written = true;
    await ctx.custody.persistMailParcel(recipient, letter, items, custodyRef);
    await ctx.db.markCustodyRefBooked(custodyRef);
    ctx.pendingMail.delete(custodyRef);
    return true;
  }

  /**
   * Put a directed sale's item straight into the buyer's bags.
   *
   * Rides the SAME custodyRef as the mail parcel would, deliberately: the claim
   * is the one key that decides an item is delivered, so hand-off and mail are
   * mutually exclusive by construction and no sequence of retries can do both.
   *
   * Three outcomes, and the difference is load-bearing (B2b):
   * - 'handed': the grant AND its booking committed atomically; done.
   * - 'mail': nothing durable happened (an ordinary grantCopy refusal:
   *   offline, wrong owner, bags full; or a claim the mail side already
   *   owns); the caller mails instead. The refusal path CONVERTS the claim's
   *   intent to the mail rail in one statement, which is the only legal
   *   conversion (grantCopy declining proves the bags are untouched).
   * - 'abort': the outcome is unknown or owed to a later pass. A TRANSIENT
   *   save throw lands here: the grant sits in the live bags, an autosave may
   *   persist it, and the old fall-through-to-mail was exactly the second
   *   copy. The claim keeps its grant intent, the pendingGrants entry keeps
   *   the session identity, and the next pass retries the SAME ref
   *   idempotently (snapshotCopy, never a second grantCopy). A lease-fence
   *   rejection ALSO keeps the intent and parks: the fence proves this write
   *   lost, not that an earlier autosave under the then-valid nonce did, so
   *   only an operator can attribute the item. An unbooked grant claim whose
   *   session is gone parks the same way (visible in the unbooked-claims
   *   read), as does an 'ambiguous' grantCopy refusal (the grant touched the
   *   live bags but the session state is unprovable: never mail over it).
   */
  async function handToBuyer(
    settlement: WocSettlementRow,
    item: InvSlot,
    target: { characterId: number; name: string },
    custodyRef: string,
  ): Promise<'handed' | 'mail' | 'abort' | 'abort_busy'> {
    const fresh = await ctx.db.claimCustodyRef(ctx.realm, custodyRef);
    if (!fresh) {
      const state = await ctx.db.custodyRefState(custodyRef);
      // Vanished under us (hand intervention only): park this pass.
      if (state === null) return 'abort';
      // A prior pass really delivered (either route).
      if (state.booked) return 'handed';
      // A claim the mail rail owns (or an unattributable one): the mail
      // route decides its own resume-or-park.
      if (state.grantCharacterId === null) return 'mail';
      // A grant was in flight under this ref. Resume it ONLY while the very
      // session it landed in is still live in this process: the live bags are
      // then known to hold the earlier grant, so re-persisting them retries
      // the delivery without a second copy. Anything else (a restart, a
      // relog, a nonce rotation) makes the bags unprovable and parks the
      // claim for the operator: never mail, never re-grant, never advance.
      const pending = ctx.pendingGrants.get(custodyRef);
      if (!pending || pending.characterId !== state.grantCharacterId) {
        // No usable session memory for this ref (restart, or a claim another
        // process granted): drop any mismatched entry and park.
        ctx.pendingGrants.delete(custodyRef);
        return 'abort';
      }
      const snap = ctx.custody.snapshotCopy(settlement.buyerAccount, pending.characterId);
      if (
        !snap.ok ||
        snap.save.leaseNonce === undefined ||
        snap.save.leaseNonce !== pending.leaseNonce
      ) {
        // The session ended or rotated: the continuous-memory retry is dead
        // for good, so drop the entry (the claim itself keeps the park).
        ctx.pendingGrants.delete(custodyRef);
        return 'abort';
      }
      // The proof of resumability is the SESSION IDENTITY plus nonce match,
      // not the entry's age: refresh the stamp on every provable attempt, or
      // ten minutes of ordinary lock contention (a slow-database incident)
      // would expire a still-live, still-provable retry into a permanent
      // operator-only park.
      pending.stampMs = ctx.now();
      return commitGrant(
        custodyRef,
        settlement.buyerAccount,
        pending.characterId,
        pending.leaseNonce,
      );
    }
    // Fresh claim: stamp the durable grant intent BEFORE touching the bags, so
    // a crash at any later point leaves a claim that says "a grant may have
    // landed" and no automatic path will mail over it.
    const stamped = await ctx.db.markCustodyGrantIntent(custodyRef, target.characterId);
    if (!stamped) return 'abort';
    const granted = ctx.custody.grantCopy(settlement.buyerAccount, target.characterId, item);
    if (!granted.ok) {
      // 'ambiguous' is NOT a clean refusal: the grant already touched the
      // live bags and the session state is unprovable, so the claim keeps
      // its grant intent and PARKS (mailing here is the second-copy rail).
      if (granted.reason === 'ambiguous') return 'abort';
      // Nothing durable happened (grantCopy declines cleanly), so convert
      // the claim to the mail rail in one statement and record the not-yet-
      // written attempt: that pair is what lets bookCustodyOnce proceed.
      if (!(await ctx.db.markCustodyMailIntent(custodyRef))) return 'abort';
      ctx.pendingMail.set(custodyRef, { stampMs: ctx.now(), written: false });
      watchStampHighWater();
      return 'mail';
    }
    ctx.pendingGrants.set(custodyRef, {
      characterId: target.characterId,
      leaseNonce: granted.save.leaseNonce,
      stampMs: ctx.now(),
    });
    watchStampHighWater();
    return commitGrant(
      custodyRef,
      settlement.buyerAccount,
      target.characterId,
      granted.save.leaseNonce,
    );
  }

  /** The durable half of a direct hand-off: persist the granted bags and book
   *  the ref in ONE transaction (saveDeliveredCharacterBooked), riding the
   *  BUYER'S per-character save FIFO through custody's bounded
   *  persistGrantSerialized (the escrow write-path rider CLOSED the old
   *  carve-out here): the blob is re-serialized inside the FIFO slot, so a
   *  stale pre-grant autosave always commits BEFORE the grant's save and
   *  can never roll the delivered item back out of the buyer's durable
   *  bags. The head-of-line bound the carve-out demanded is the entry's
   *  wait deadline: a wedged FIFO answers 'busy' with nothing written and
   *  this row simply PARKS (claim, grant intent, and ledger entry intact;
   *  the batch rotation backs it off), so one stuck character save costs a
   *  bounded wait, never the locked delivery segment. See handToBuyer for
   *  what each outcome means to the caller. */
  async function commitGrant(
    custodyRef: string,
    accountId: number,
    characterId: number,
    leaseNonce: string | undefined,
  ): Promise<'handed' | 'abort' | 'abort_busy'> {
    let out: 'booked' | 'lease_lost' | 'claim_missing' | 'busy' | 'session_lost';
    try {
      out = await ctx.custody.persistGrantSerialized(
        accountId,
        characterId,
        leaseNonce,
        async (save) => {
          const result = await ctx.db.saveDeliveredCharacterBooked(save, custodyRef);
          if (result === 'booked') ctx.custody.acknowledgeCharacterSave?.(save);
          return result;
        },
      );
    } catch (err) {
      // Transient throw (pool exhaustion, timeout, connection reset): the
      // transaction may or may not have committed. Keep the claim, the grant
      // intent, and the pendingGrants entry; the next pass reads booked_at
      // and either sees the commit (handed) or retries this same session.
      // NEVER fall through to mail here: that was the B2b double copy.
      ctx.sweepError('deliver_grant', err);
      return 'abort';
    }
    if (out === 'busy') {
      // The bounded head-of-line arm: nothing serialized, nothing written,
      // everything durable intact; the next pass retries the SAME ref. The
      // distinct verdict is what lets the batch driver budget these.
      return 'abort_busy';
    }
    if (out === 'session_lost') {
      // The session left or rotated DURING the FIFO wait: the
      // continuous-memory retry is dead (the pre-checks in handToBuyer
      // catch the earlier cases), so drop the entry and park for the
      // operator, exactly like the fence arm below. RECORDED TRADE (the
      // rider's review round): a buyer disconnecting between grantCopy and
      // the slot means the leave flush, queued behind us, may persist the
      // granted bags anyway while this row parks unfinalized; before the
      // FIFO close the pre-captured blob would have committed under the
      // still-valid nonce. The close is the safer direction (it is exactly
      // the stale-blob ordering hazard the rider fixed), at the cost of a
      // higher operator-park rate on this real race.
      ctx.pendingGrants.delete(custodyRef);
      return 'abort';
    }
    if (out === 'booked') {
      ctx.pendingGrants.delete(custodyRef);
      return 'handed';
    }
    if (out === 'lease_lost') {
      // The fence rejected the write: another process owns this character now
      // and every FUTURE save from this zombie session is fenced out too. But
      // the fence says nothing about a save that already landed while the
      // nonce was still valid (the ordinary autosave), so the grant may
      // ALREADY be durable. Keep the intent, park, and let the operator
      // attribute the item; mailing here was a dupe against exactly that
      // autosave.
      ctx.pendingGrants.delete(custodyRef);
      return 'abort';
    }
    // claim_missing: the claim row was gone or already booked under us, which
    // only hand intervention can cause; the save rolled back with it. Park
    // loudly rather than guessing.
    ctx.pendingGrants.delete(custodyRef);
    ctx.sweepError(
      'deliver_grant',
      new Error(`woc_market: custody claim missing at grant commit for ${custodyRef}`),
    );
    return 'abort';
  }

  /** One delivery attempt. 'advanced' finished the sale; 'parked' made no
   *  progress and cannot without outside change (the caller rotates and
   *  backs the row off); 'parked_busy' is the same park verdict when the
   *  cause was the grant entry's FIFO deadline (the caller budgets these:
   *  each one already cost a full deadline of locked-segment time); 'skip'
   *  means another actor owns the row now; 'contended' means a bounded lock
   *  wait expired (the caller stops the batch and the next pass retries). */
  async function deliverOne(
    settlement: WocSettlementRow,
  ): Promise<'advanced' | 'parked' | 'parked_busy' | 'skip' | 'contended'> {
    const listing = await ctx.db.listingById(ctx.realm, settlement.listingId);
    if (!listing) return 'parked';
    if (listing.itemDisposed) {
      // The escrowed copy already left custody (delivered once, or returned
      // to the seller): delivering over it would mint a second copy (the
      // return-then-deliver shape). Park in 'delivering', visible to the
      // stuck monitor; an operator decides between failing the settlement
      // and correcting the flag.
      return 'parked';
    }
    const target = await ctx.db.deliveryTarget(
      ctx.realm,
      settlement.buyerAccount,
      settlement.buyerCharacter,
    );
    // No character to deliver to right now: hold in 'delivering'; a later
    // beat retries (the account may recreate a character; admins can act).
    if (!target) return 'parked';
    const custodyRef = settlementCustodyRef(settlement.id);
    // A DIRECTED sale is a hand-to-hand deal: the two players agreed in a trade
    // window, so the goods belong in the buyer's bags, not in their mailbox.
    // An Exchange sale is anonymous and asynchronous, and keeps the parcel.
    //
    // Mail remains the fallback for BOTH, and every reason to fall back is
    // ordinary rather than exceptional (logged out, bags full). It is NOT the
    // fallback for an ambiguous grant: 'abort' holds the settlement in
    // 'delivering' with the claim visible, and never mails (B2b).
    let handed = false;
    if (listing.directedBuyerAccount !== null) {
      const hand = await handToBuyer(settlement, listing.item, target, custodyRef);
      if (hand === 'abort_busy') return 'parked_busy';
      if (hand === 'abort') return 'parked';
      handed = hand === 'handed';
    }
    if (!handed) {
      const booked = await bookCustodyOnce(
        { key: String(target.characterId), name: target.name },
        'delivery',
        [listing.item],
        custodyRef,
      );
      // A parked claim: stay in 'delivering', visible, and try again later.
      if (!booked) return 'parked';
    }
    // The whole close tail commits as ONE transaction (delivered CAS, sale
    // row, listing close + dispose, bond flips): no crash point can exist
    // between them, so the only resumable states are BEFORE it (custody
    // booked, still 'delivering': this method re-runs) and AFTER it (done).
    const finalized = await finalizeDelivered(settlement, listing);
    if (finalized === 'stale') return 'skip';
    if (finalized === 'contended') return 'contended';
    // 'already_final' converged with nothing new written: no second notice.
    if (finalized === 'finalized') await notifySellerSold(listing);
    return 'advanced';
  }

  function finalizeDelivered(
    settlement: WocSettlementRow,
    listing: WocListingRow,
  ): Promise<'finalized' | 'already_final' | 'stale' | 'contended'> {
    return ctx.db.finalizeDeliveredSettlement({
      settlementId: settlement.id,
      listingId: listing.id,
      bidId: settlement.bidId,
      sale: {
        realm: ctx.realm,
        listingId: listing.id,
        itemId: listing.itemId,
        item: listing.item,
        priceCents: settlement.amountCents,
        // The settled base-unit amount when the quote leg is still on the row;
        // provenance keeps the USD price as the authoritative figure either way.
        amountBase: settlement.quoteReference === null ? null : settlement.settledAmountBase,
        sellerAccount: listing.sellerAccount,
        buyerAccount: settlement.buyerAccount,
        sellerName: listing.sellerName,
        buyerName: settlement.buyerName,
      },
    });
  }

  /** Best-effort seller notice (no attachment, book-once): it follows a
   *  finalized sale and must never fail or retry-block the delivery. The
   *  whole body is guarded (the target read included): no arm ever
   *  re-notifies, so a crash or throw between the finalize and this notice
   *  loses the notice for good (an ACCEPTED loss: the letter is item-free
   *  and the sale itself is durable), and the error line below is the only
   *  trace that it happened. */
  async function notifySellerSold(listing: WocListingRow): Promise<void> {
    try {
      const seller = await ctx.db.deliveryTarget(
        ctx.realm,
        listing.sellerAccount,
        listing.sellerCharacter,
      );
      if (!seller) return;
      await bookCustodyOnce(
        { key: String(seller.characterId), name: seller.name },
        'sold_notice',
        [],
        listingSoldNoticeCustodyRef(listing.id),
      );
    } catch (err) {
      ctx.sweepError('deliver_notice', err);
    }
  }

  /** True only when the return flight completed and the listing was
   *  disposed; false is the caller's park signal (seller unresolvable, or a
   *  parked return claim, which must NOT dispose: the flag is what keeps the
   *  backlog retrying, and the claim stays visible meanwhile). */
  async function returnListingItem(listing: WocListingRow): Promise<boolean> {
    const target = await ctx.db.deliveryTarget(
      ctx.realm,
      listing.sellerAccount,
      listing.sellerCharacter,
    );
    if (!target) return false;
    const booked = await bookCustodyOnce(
      { key: String(target.characterId), name: target.name },
      'return',
      [listing.item],
      listingReturnCustodyRef(listing.id),
    );
    if (!booked) return false;
    await ctx.db.markItemDisposed(listing.id);
    return true;
  }

  /** Same park treatment as the delivery arms: a return that cannot proceed
   *  (seller gone, parked claim) rotates ONCE onto the sweep_parked_at batch
   *  order, backs off in-process, and is EXCLUDED from the backlog read
   *  until its retry; the stat counts rows DISPOSED, so a parked backlog can
   *  neither own the batch head nor flood the saturation warning. */
  async function returnUndisposedItems(nowMs: number, scope: WocDeliveryScope): Promise<number> {
    const backlog = await ctx.db.undisposedClosedListings(
      ctx.realm,
      ctx.sweepBatch,
      wocBackedOffIds(ctx.parkedReturns, nowMs),
    );
    let advanced = 0;
    for (const listing of backlog) {
      // Belt over the SQL's own resolution filter: a sold listing's copy went
      // to its buyer and must never take the return flight home.
      if (listing.resolution === 'sold') continue;
      const retryAt = ctx.parkedReturns.get(listing.id);
      // Belt only, and unlike the delivery twin's belt this one is currently
      // UNREACHABLE (nothing but this serialized arm writes parkedReturns and
      // the backlog read excludes backing-off rows): pure defense in depth.
      if (retryAt !== undefined && retryAt > nowMs) continue;
      try {
        if (await returnListingItem(listing)) {
          advanced++;
          ctx.parkedReturns.delete(listing.id);
        } else {
          // Same stat rule as the delivery twin: count only standing parks,
          // rotate either way.
          if (wocParkRow(ctx.parkedReturns, listing.id, nowMs + ctx.parkRetryMs)) {
            scope.parked++;
          }
          await ctx.db.touchListingRow(listing.id);
        }
      } catch (err) {
        // Per-listing isolation, REPORTED rather than swallowed: a return
        // that fails every pass was invisible before.
        ctx.sweepError('returned', err);
      }
    }
    return advanced;
  }

  return {
    deliverConfirmedSettlements,
    reconcileDelivering,
    redriveDeliveredTails,
    disposeSoldResidue,
    returnUndisposedItems,
    returnListingItem,
  };
}
