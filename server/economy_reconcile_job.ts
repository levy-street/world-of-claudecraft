// Economy Watch, phase 2: the RECONCILIATION PASS. What actually runs the
// conservation checks, on a rolling window, and files what they find.
//
// Cadence is minutes, not nightly. A nightly sweep is right for retention,
// where the cost of a late delete is nothing; it is wrong here, because the
// value of catching a duplication decays fast: a dupe found eight hours in has
// already been traded, laundered through the market, and mailed to alts. The
// pass is cheap enough to justify that: it reads only rows past its cursor, and
// the two aggregate sums are the whole of its heavy work.
//
// EXACTLY ONE PASS PER REALM AT A TIME, behind a database advisory lock. The
// cursor is a single world_state row, so two processes serving one realm would
// each advance it past windows the other never checked, and the windows nobody
// checked are silently unexamined rather than visibly failing. The lock is the
// only thing standing between "one process = one realm" being a deployment
// convention and it being an assumption this system's correctness rests on.
//
// The whole file is deps-injected and clock-injected: every read, the online
// set, the alert write, and the cursor arrive through `EconomyReconcileDeps`,
// so the pass unit-tests against a fake evidence bag with no `pg` and no world.

import {
  checkPersistedBalance,
  type EconomyAlert,
  type ReconcileRow,
  reconcileWindow,
  type SupplySnapshot,
} from './economy_reconcile';
import type { EconomyWindowRow, PurseDisagreement } from './economy_reconcile_db';
import type { EconomyPassSnapshot } from './http/economy_metrics';
import { economyMetricsCounters } from './http/economy_signals';

// Advisory lock namespace for this pass. The siblings are db.ts's boot-DDL lock
// ("WOC\x01", module-private there) and retention_sweep.ts's "WOC\x02"; the
// three must never collide. Taken as a TWO-key lock, with the realm's hash as
// the second key, so realms sharing one DATABASE_URL do not serialize behind
// each other for no reason.
export const ECONOMY_RECONCILE_ADVISORY_LOCK_KEY = 0x57_4f_43_03; // "WOC\x03"

/** How often the pass runs when nothing overrides it. */
export const ECONOMY_RECONCILE_INTERVAL_MS = 15 * 60_000;

/**
 * Ledger rows one pass will read. A long database outage can leave a backlog
 * far larger than this; the cursor advances to the last row actually read, so
 * the remainder is simply the next pass's window and no pass ever tries to hold
 * a whole outage in memory.
 */
export const ECONOMY_RECONCILE_WINDOW_ROWS = 20_000;

/**
 * A stable 31-bit hash of the realm name, for the advisory lock's second key.
 * Deliberately not a random or per-process value: every process serving one
 * realm must compute the SAME number or the lock stops excluding anything.
 */
export function realmLockKey(realm: string): number {
  let h = 2166136261;
  for (let i = 0; i < realm.length; i++) {
    h ^= realm.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Postgres advisory keys are signed 32-bit; keep it positive and in range.
  return h & 0x7f_ff_ff_ff;
}

/** Where the last pass stopped, persisted so a restart resumes rather than
 *  re-reading (or worse, skipping) the ledger. */
export interface EconomyReconcileCursor {
  /** The highest ledger id this realm has reconciled. */
  lastRowId: number;
  /** The supply measured at the end of that pass, which is this pass's OPENING
   *  figure. Carried rather than re-derived because "supply at the moment the
   *  last window closed" is not recoverable after the fact. */
  openingSupply: number;
}

export interface EconomyReconcileLockClient {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<Record<string, unknown>> }>;
  // pg's PoolClient.release(err?) satisfies this structurally.
  release(destroy?: boolean): void;
}

export interface EconomyReconcileDeps {
  realm: string;
  connect(): Promise<EconomyReconcileLockClient>;
  maxRowId(): Promise<number>;
  loadWindow(sinceId: number, untilId: number, limit: number): Promise<EconomyWindowRow[]>;
  loadPurseDisagreements(): Promise<PurseDisagreement[]>;
  supplySnapshot(): Promise<SupplySnapshot>;
  /**
   * Character ids with a live session right now. An online character's save is
   * by definition mid-flight, so their purse is never compared against the
   * ledger; an offline one was saved on logout and IS comparable. This is the
   * fact the database cannot supply and the reason the pass lives in the game
   * process rather than in a cron container.
   */
  onlineCharacterIds(): ReadonlySet<number>;
  /** The writer's dropped-row count, which bounds how much this pass can claim
   *  to know (see `checkSupply`). */
  droppedWrites(): number;
  /** File the findings and answer the ones that ACTUALLY landed: the table
   *  dedupes against its open queue, and only a newly filed row is news. */
  insertAlerts(alerts: readonly EconomyAlert[]): Promise<EconomyAlert[]>;
  /**
   * Tap the operator on the shoulder about newly filed findings. Separate from
   * `insertAlerts` because the two have different delivery contracts: the table
   * is durable and the notification is at most once, and conflating them would
   * make a failed Discord post look like a lost finding.
   */
  notify(filed: readonly EconomyAlert[]): void;
  loadCursor(): Promise<EconomyReconcileCursor | null>;
  saveCursor(cursor: EconomyReconcileCursor): Promise<void>;
  intervalMs?: number;
  windowRows?: number;
  onInfo?(message: string): void;
  onError?(scope: string, err: unknown): void;
}

/** What one pass did, returned for tests and for the log line. */
export interface EconomyReconcilePassResult {
  ran: boolean;
  rowsRead: number;
  alerts: EconomyAlert[];
  filed: number;
  /** Coin that unsaved character state can account for; the bound `checkSupply`
   *  is given. Logged because an operator reading a warning needs to know how
   *  close to the line it was. */
  unsettledCopper: number;
  cursor: EconomyReconcileCursor;
}

export interface EconomyReconcileJob {
  start(): void;
  stop(): Promise<void>;
  /** One pass, for tests and for an operator-triggered run. */
  runOnce(): Promise<EconomyReconcilePassResult | null>;
  /**
   * What the last completed pass measured, for the /metrics gauges. Null until
   * one completes, which the exporter publishes as an ABSENT series rather than
   * zero: a realm that has never reconciled has an unknown coin supply, and a
   * flat 0 would read as every coin in the world having vanished.
   */
  lastPass(): EconomyPassSnapshot | null;
}

/**
 * Split disagreements into the ones a save can still explain and the ones it
 * cannot.
 *
 * SETTLED means both: the character has no live session, and their character
 * row was written strictly after their newest ledger row. Either alone is not
 * enough. `updated_at` moves for writes that are not purse saves (a hotbar
 * layout, an appearance reroll), so a bare timestamp comparison could call a
 * mid-session player settled and page for a purse that was simply still in
 * flight; and a logged-out character whose last save predates their last
 * movement is genuinely lagging, not broken.
 *
 * Exported pure because this classification is where a false page would come
 * from, and it deserves its own table of cases.
 */
export function splitBySettlement(
  disagreements: readonly PurseDisagreement[],
  online: ReadonlySet<number>,
): { settled: PurseDisagreement[]; unsettled: PurseDisagreement[]; unsettledCopper: number } {
  const settled: PurseDisagreement[] = [];
  const unsettled: PurseDisagreement[] = [];
  let unsettledCopper = 0;
  for (const d of disagreements) {
    if (!online.has(d.characterId) && d.savedAt > d.ledgerAt) {
      settled.push(d);
      continue;
    }
    unsettled.push(d);
    // Magnitude, not signed: the bound is "how much drift could exist", and two
    // players drifting in opposite directions do not cancel into certainty.
    unsettledCopper += Math.abs(d.persistedCopper - d.ledgerBalance);
  }
  return { settled, unsettled, unsettledCopper };
}

/** Group window rows by character, preserving id order within each. */
export function groupByCharacter(rows: readonly EconomyWindowRow[]): Map<number, ReconcileRow[]> {
  const out = new Map<number, ReconcileRow[]>();
  for (const r of rows) {
    const list = out.get(r.characterId);
    if (list) list.push(r);
    else out.set(r.characterId, [r]);
  }
  return out;
}

export function createEconomyReconcileJob(deps: EconomyReconcileDeps): EconomyReconcileJob {
  const onError =
    deps.onError ?? ((scope, err) => console.error(`economy reconcile ${scope} failed:`, err));
  const onInfo = deps.onInfo ?? ((message) => console.log(message));
  const intervalMs = Math.max(60_000, deps.intervalMs ?? ECONOMY_RECONCILE_INTERVAL_MS);
  const windowRows = Math.max(1, deps.windowRows ?? ECONOMY_RECONCILE_WINDOW_ROWS);
  const lockKey2 = realmLockKey(deps.realm);

  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlight: Promise<void> | null = null;
  let stopping = false;
  // What the last completed pass measured, for the exporter's gauges. Held here
  // rather than re-read at scrape time on purpose: these figures cost two
  // aggregate sums each, and a scrape must never be able to put that load on
  // the database.
  let lastPass: EconomyPassSnapshot | null = null;

  // Wall clock is read through Date.now() at exactly two points (the pass
  // timestamp below, and the exporter's age gauge). Nothing in the CHECKS ever
  // sees a clock: their verdicts must depend only on the evidence, or a slow
  // pass would reach different conclusions than a fast one.
  function stamp(supply: SupplySnapshot, unsettledCopper: number, backlogRows: number): void {
    lastPass = { atMs: Date.now(), supply, unsettledCopper, backlogRows };
  }

  // The pass proper, already holding the lock.
  async function pass(): Promise<EconomyReconcilePassResult> {
    const stored = await deps.loadCursor();
    // Capture the ceiling FIRST. Rows keep landing while the pass works, and an
    // open-ended window would pair a character's newest row with a purse read
    // taken after an even newer one, which disagrees for a reason that is not a
    // finding.
    const untilId = await deps.maxRowId();

    if (stored === null) {
      // FIRST EVER PASS. There is no opening supply, so the identity has no
      // left-hand side and checking it would compare this realm's whole coin
      // stock against one window's faucets. Establish the baseline and report
      // nothing: a reconciler's first act must not be to accuse the entire
      // history it was not running for.
      const supply = await deps.supplySnapshot();
      const opening =
        supply.purses +
        supply.bankVaults +
        supply.guildTreasuries +
        supply.unclaimedMailCoin +
        supply.marketEscrow;
      const cursor = { lastRowId: untilId, openingSupply: opening };
      await deps.saveCursor(cursor);
      stamp(supply, 0, 0);
      economyMetricsCounters().reconcilePass('baseline');
      onInfo(
        `economy reconcile: baseline established at ledger id ${untilId}, ${opening} copper in circulation`,
      );
      return { ran: true, rowsRead: 0, alerts: [], filed: 0, unsettledCopper: 0, cursor };
    }

    const rows = await deps.loadWindow(stored.lastRowId, untilId, windowRows);
    const disagreements = await deps.loadPurseDisagreements();
    const { settled, unsettledCopper } = splitBySettlement(
      disagreements,
      deps.onlineCharacterIds(),
    );
    const closingSupply = await deps.supplySnapshot();

    const alerts = reconcileWindow({
      rowsByCharacter: groupByCharacter(rows),
      openingSupply: stored.openingSupply,
      closingSupply,
      droppedWrites: deps.droppedWrites(),
      unsettledCopper,
    });
    // The global half: a save that disagrees with the ledger for a character
    // nothing can explain away. Run over every settled disagreement, not only
    // the ones with rows this window, because the character who was robbed may
    // not have moved a coin since.
    for (const d of settled) {
      alerts.push(...checkPersistedBalance(d.characterId, d.ledgerBalance, d.persistedCopper));
    }

    const metrics = economyMetricsCounters();
    // Counted from what the pass FOUND, before the alert table dedupes against
    // its open queue. A still-recurring violation must keep showing a rate here,
    // or a panel would flatline after the incident's first sighting and read as
    // resolved.
    for (const a of alerts) metrics.finding(a.kind, a.severity);

    const filed = alerts.length > 0 ? await deps.insertAlerts(alerts) : [];
    // Notified from what was FILED, never from what was found: an unresolved
    // violation is re-found on every pass, and pinging a human every fifteen
    // minutes about it is how a channel gets muted before the second incident.
    if (filed.length > 0) deps.notify(filed);

    // The cursor advances to the last row READ, never to `untilId`: the window
    // is row-capped, so a backlog leaves rows between the two, and jumping to
    // the ceiling would skip them permanently. The closing supply becomes the
    // next pass's opening figure ONLY when the window was complete, for the
    // same reason: a partial window's flows do not explain the whole supply
    // move, and carrying the measured figure forward anyway would bake this
    // pass's unexplained delta into the baseline and hide it from every later
    // pass.
    const complete = rows.length < windowRows;
    const lastRowId = rows.length > 0 ? rows[rows.length - 1].id : untilId;
    const cursor: EconomyReconcileCursor = complete
      ? {
          lastRowId,
          openingSupply:
            closingSupply.purses +
            closingSupply.bankVaults +
            closingSupply.guildTreasuries +
            closingSupply.unclaimedMailCoin +
            closingSupply.marketEscrow,
        }
      : { lastRowId, openingSupply: stored.openingSupply };
    await deps.saveCursor(cursor);
    stamp(closingSupply, unsettledCopper, Math.max(0, untilId - lastRowId));
    metrics.reconcilePass(complete ? 'complete' : 'capped');

    // One line per pass, findings or not. A reconciler that only speaks when it
    // is unhappy is indistinguishable from a reconciler that has stopped
    // running, and this one is the only thing watching the gold supply.
    onInfo(
      `economy reconcile: ${rows.length} rows through id ${lastRowId}, ${alerts.length} finding(s), ${filed.length} filed, ${unsettledCopper} copper of unsaved drift${complete ? '' : ' (window capped, more rows pending)'}`,
    );
    return {
      ran: true,
      rowsRead: rows.length,
      alerts,
      filed: filed.length,
      unsettledCopper,
      cursor,
    };
  }

  async function runOnce(): Promise<EconomyReconcilePassResult | null> {
    let client: EconomyReconcileLockClient;
    try {
      client = await deps.connect();
    } catch (err) {
      onError('connect', err);
      return null;
    }
    // A client whose lock or unlock query failed may still hold the session
    // advisory lock, and a pooled connection can live for hours: while it sits
    // in the pool the lock stays taken and every later pass loses the try-lock,
    // so reconciliation silently stops. Those arms destroy the connection
    // instead of pooling it, because ending the backend session drops its locks.
    let destroyClient = false;
    try {
      let acquired = false;
      try {
        const res = await client.query('SELECT pg_try_advisory_lock($1, $2) AS acquired', [
          ECONOMY_RECONCILE_ADVISORY_LOCK_KEY,
          lockKey2,
        ]);
        acquired = res.rows[0]?.acquired === true;
      } catch (err) {
        onError('lock', err);
        economyMetricsCounters().reconcilePass('failed');
        destroyClient = true;
        return null;
      }
      if (!acquired) {
        // A peer is mid-pass. Nothing is deferred and nothing is lost: the
        // cursor is shared, so the peer's pass covers this window.
        economyMetricsCounters().reconcilePass('peer_locked');
        return null;
      }
      try {
        return await pass();
      } catch (err) {
        // Counted here and rethrown: the caller still handles it, but a pass
        // that keeps throwing must be visible as a rate. A reconciler failing
        // every fifteen minutes and a reconciler finding nothing are the same
        // silence from the outside.
        economyMetricsCounters().reconcilePass('failed');
        throw err;
      } finally {
        try {
          await client.query('SELECT pg_advisory_unlock($1, $2)', [
            ECONOMY_RECONCILE_ADVISORY_LOCK_KEY,
            lockKey2,
          ]);
        } catch (err) {
          onError('unlock', err);
          destroyClient = true;
        }
      }
    } finally {
      client.release(destroyClient || undefined);
    }
  }

  function poll(): void {
    // Coalesce rather than stack: a pass that outruns the interval must not have
    // a second one queued behind it competing for the same cursor.
    if (inFlight || stopping) return;
    inFlight = runOnce()
      .then(() => undefined)
      .catch((err) => onError('pass', err))
      .finally(() => {
        inFlight = null;
      });
  }

  return {
    start(): void {
      // Idempotent, and without an immediate fire: boot must not front-run
      // schema setup, and the first window is worth nothing anyway (it
      // establishes the baseline). unref()'d like the other boot intervals so
      // it never holds the process open on its own.
      if (timer) return;
      stopping = false;
      timer = setInterval(poll, intervalMs);
      timer.unref();
    },
    async stop(): Promise<void> {
      stopping = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      // Wait out an in-flight pass so no read races pool.end(). A pass is
      // read-mostly and bounded by the window cap, so this cannot hold shutdown
      // long enough to threaten the character saves behind it.
      try {
        await inFlight;
      } catch {
        // Swallowed by design: shutdown must proceed.
      }
    },
    runOnce,
    lastPass: () => lastPass,
  };
}
