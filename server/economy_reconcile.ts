// Economy Watch, phase 1: the CONSERVATION CHECKS. Three independent questions
// asked of the ledger, each able to catch a duplication the other two miss.
//
//   1. PER-CHARACTER CHAIN. Does this character's row sequence add up, and does
//      the last balance_after match the money actually persisted for them? A
//      gap here means a mutation bypassed the ledger, or a save landed a purse
//      the ledger never explained.
//   2. GLOBAL SUPPLY. Does every coin in the world (purses, bank vaults, guild
//      treasuries, unclaimed mail, market escrow) equal cumulative faucets
//      minus cumulative sinks? A mismatch means coin appeared or vanished
//      without a row saying why.
//   3. TRANSFER SYMMETRY. Does every transfer row have its opposite half? An
//      orphaned half is the signature of a race that credited one side and
//      lost the other, which is precisely how the classic dupes work.
//
// Every function here is PURE and takes its data as arguments. The SQL and the
// scheduling live in the caller (server/economy_reconcile_job.ts), so the whole
// detection logic unit-tests against hand-built fixtures with no database, no
// clock, and no running world. That matters more here than almost anywhere
// else in the codebase: a reconciler that can only be exercised against a live
// Postgres is a reconciler nobody writes the nasty cases for.
//
// FALSE POSITIVES ARE THE ENEMY. An operator who is paged twice for a
// non-incident stops reading the third page, and the third one is the real
// dupe. So every check takes the writer's `droppedWrites` count and degrades
// to a WARNING when the evidence is known to be incomplete: rows the writer
// admits it never wrote cannot be distinguished from rows a thief prevented,
// and claiming otherwise would be the reconciler lying about its own
// confidence.

import {
  type EconomyEventKind,
  isFaucetKind,
  isSinkKind,
  TRANSFER_PARTNER,
} from '../src/sim/economy_event_kinds';

/** How bad a finding is. `critical` is the only level that pages an operator. */
export type EconomyAlertSeverity = 'critical' | 'warning' | 'info';

/** The closed set of things the reconciler can report. Bounded because it is a
 *  Prometheus label and an admin filter, same discipline as the event kinds. */
export const ECONOMY_ALERT_KINDS = [
  'chain_break',
  'balance_mismatch',
  'supply_mismatch',
  'orphaned_transfer',
  'evidence_incomplete',
] as const;
export type EconomyAlertKind = (typeof ECONOMY_ALERT_KINDS)[number];

export interface EconomyAlert {
  kind: EconomyAlertKind;
  severity: EconomyAlertSeverity;
  characterId: number | null;
  /** Copper the finding is off by, signed. Positive means coin the world has
   *  and the ledger cannot explain, i.e. the duplication direction. */
  delta: number;
  /** Operator-facing English detail. Server-side and dev-channel, so it stays
   *  English literals like every other server diagnostic (server/CLAUDE.md);
   *  the ADMIN DASHBOARD renders alerts through t() keys off `kind`, never by
   *  displaying this string. */
  detail: string;
}

/** One ledger row, as the checks need it. Structural so a fixture is a literal. */
export interface ReconcileRow {
  id: number;
  characterId: number;
  kind: EconomyEventKind;
  /** `purse` is the character's own coin; `pool` is a holding area they moved. */
  holder: 'purse' | 'pool';
  amount: number;
  /** NULL on a pool row with no single running balance (a burn, a letter). */
  balanceAfter: number | null;
  prevLedgerId: number | null;
  counterpartyKind: string | null;
  counterpartyId: string | null;
  simTick: number;
}

/**
 * The character's own rows, in order. A pool row is attributed to the actor who
 * MOVED the coin but states a market box's or a treasury's balance, so it is
 * not part of their purse's history: folding one in would break the chain
 * arithmetic on every market buy, mail send, and guild deposit, which is the
 * highest-volume false positive this system could possibly produce.
 */
type PurseRow = ReconcileRow & { balanceAfter: number };

function purseRows(rows: readonly ReconcileRow[]): PurseRow[] {
  return rows.filter((r): r is PurseRow => r.holder === 'purse' && r.balanceAfter !== null);
}

/**
 * CHECK 1a: the per-character chain.
 *
 * Rows must arrive oldest-first for one character. Two properties are checked
 * per adjacent pair: the link (`prevLedgerId` points at the previous row) and
 * the arithmetic (previous balance plus this amount equals this balance).
 *
 * The arithmetic is the one that catches a dupe; the link only catches a
 * missing row. They are reported separately because the operator response
 * differs: a broken link with intact arithmetic is a dropped write (check the
 * writer's counters), while broken arithmetic is money that moved without a
 * row (check the code path).
 *
 * POOL rows are dropped first: they ride the actor's id for attribution but
 * describe a holding area, so they are not links in this chain and never were.
 */
export function checkChain(mixed: readonly ReconcileRow[]): EconomyAlert[] {
  const rows = purseRows(mixed);
  const alerts: EconomyAlert[] = [];
  for (let i = 1; i < rows.length; i++) {
    const prev = rows[i - 1];
    const cur = rows[i];
    if (cur.prevLedgerId !== prev.id) {
      alerts.push({
        kind: 'chain_break',
        severity: 'warning',
        characterId: cur.characterId,
        delta: 0,
        detail: `row ${cur.id} points at prev_ledger_id ${String(cur.prevLedgerId)} but the previous row for this character is ${prev.id}: a row is missing from the audit trail`,
      });
      // Do NOT also check arithmetic across a known gap: the missing row's
      // amount is exactly what would make the sum disagree, so reporting both
      // would page an operator twice for one dropped write.
      continue;
    }
    const expected = prev.balanceAfter + cur.amount;
    if (expected !== cur.balanceAfter) {
      alerts.push({
        kind: 'balance_mismatch',
        severity: 'critical',
        characterId: cur.characterId,
        delta: cur.balanceAfter - expected,
        detail: `row ${cur.id}: previous balance ${prev.balanceAfter} plus amount ${cur.amount} is ${expected}, but the row states ${cur.balanceAfter}. Money moved without a ledger row explaining it.`,
      });
    }
  }
  return alerts;
}

/**
 * CHECK 1b: the ledger's last word against what actually persisted.
 *
 * The chain can be internally perfect and still disagree with the save blob,
 * which is the save-timer rollback shape: the sim moved coin, the ledger wrote
 * it, and then the persist never landed. The ledger is the ACCUSER here, not
 * the authority: a mismatch says the two disagree, not which one is right.
 */
export function checkPersistedBalance(
  characterId: number,
  lastLedgerBalance: number | null,
  persistedCopper: number,
): EconomyAlert[] {
  if (lastLedgerBalance === null) return [];
  if (lastLedgerBalance === persistedCopper) return [];
  return [
    {
      kind: 'balance_mismatch',
      severity: 'critical',
      characterId,
      delta: persistedCopper - lastLedgerBalance,
      detail: `persisted purse is ${persistedCopper} but the ledger's last balance_after is ${lastLedgerBalance}. Either a mutation bypassed the ledger, or a save was rolled back after its rows landed.`,
    },
  ];
}

/** Every term of the global supply identity, as the job measures them. */
export interface SupplySnapshot {
  purses: number;
  /**
   * The personal bank. Structurally ZERO today and named anyway: `BankState`
   * (src/sim/bank.ts) is an item vault with no copper field, so no coin can be
   * there. Kept as an explicit zero rather than dropped so a future
   * coin-carrying vault has a term to land in; deleting it would make that
   * coin escape the identity silently, which is the one failure mode this
   * whole file exists to prevent.
   */
  bankVaults: number;
  guildTreasuries: number;
  unclaimedMailCoin: number;
  marketEscrow: number;
}

/** Cumulative faucet and sink totals, summed from the ledger by kind. */
export interface FlowTotals {
  minted: number;
  burned: number;
}

/**
 * Sum ledger rows into faucet and sink totals. Transfers are deliberately
 * EXCLUDED: they move coin between holders without changing how much exists,
 * so counting them would make the identity drift by the entire trade volume of
 * the realm.
 */
export function totalFlows(rows: readonly ReconcileRow[]): FlowTotals {
  // Faucet and sink rows are counted whatever their holder: a burn (the
  // Merchant's cut) is a pool row and is exactly the sink that makes the
  // buyer's debit balance.
  let minted = 0;
  let burned = 0;
  for (const r of rows) {
    if (isFaucetKind(r.kind)) minted += r.amount;
    else if (isSinkKind(r.kind)) burned += -r.amount;
  }
  return { minted, burned };
}

/** Total coin the world is currently holding, across every modelled pool. */
export function totalSupply(s: SupplySnapshot): number {
  return s.purses + s.bankVaults + s.guildTreasuries + s.unclaimedMailCoin + s.marketEscrow;
}

/**
 * CHECK 2: the global supply identity.
 *
 * `openingSupply` is the measured supply at the start of the window, so this
 * works on a rolling window and not only from the beginning of time (replaying
 * every row since launch on every pass is not a thing a nightly job can do
 * forever). A positive delta is coin the world holds that no faucet explains,
 * which is the duplication direction and the reason this is the check that
 * pages.
 *
 * TWO KNOWN SOURCES OF INCOMPLETE EVIDENCE, both quantified rather than assumed
 * away, because the closing supply is measured from PERSISTED state while the
 * ledger records movements the moment they happen:
 *
 *   - `droppedWrites`: rows the writer admits it never wrote. Unbounded in
 *     effect (a dropped row's amount is unknown), so any non-zero count can
 *     explain any delta, and the finding degrades to a warning outright.
 *   - `unsettledCopper`: the total by which characters whose save has not yet
 *     caught up to their last ledger row disagree with it. This one IS bounded,
 *     and the bound is what keeps the check useful on a realm that is never
 *     idle: a delta LARGER than the lag can possibly account for is a real
 *     finding no matter how many players are mid-session, so only the part of
 *     the delta within the bound is excused.
 */
export function checkSupply(
  openingSupply: number,
  closingSupply: SupplySnapshot,
  flows: FlowTotals,
  opts: { droppedWrites: number; unsettledCopper?: number },
): EconomyAlert[] {
  const expected = openingSupply + flows.minted - flows.burned;
  const actual = totalSupply(closingSupply);
  const delta = actual - expected;
  if (delta === 0) return [];
  // Rows the writer admits it never wrote look exactly like rows a thief
  // prevented. Say so instead of pretending to know which it was.
  const dropped = opts.droppedWrites > 0;
  const lag = Math.abs(opts.unsettledCopper ?? 0);
  const withinLag = Math.abs(delta) <= lag;
  const incomplete = dropped || withinLag;
  const because = dropped
    ? `the writer dropped ${opts.droppedWrites} rows this window, so the ledger is known to be incomplete`
    : `unsaved character state accounts for up to ${lag} copper of drift, which covers this`;
  return [
    {
      kind: incomplete ? 'evidence_incomplete' : 'supply_mismatch',
      severity: incomplete ? 'warning' : 'critical',
      characterId: null,
      delta,
      detail: incomplete
        ? `supply is off by ${delta} copper (holding ${actual}, faucets minus sinks predict ${expected}), but ${because} and this cannot be called a dupe`
        : `supply is off by ${delta} copper: the world holds ${actual} but faucets minus sinks predict ${expected}${lag > 0 ? `, and unsaved character state can account for at most ${lag} of that` : ''}. ${delta > 0 ? 'Coin exists that nothing minted.' : 'Coin vanished with no sink to explain it.'}`,
    },
  ];
}

/**
 * CHECK 3: transfer symmetry.
 *
 * Every transfer kind has a partner kind carrying the other half
 * (`TRANSFER_PARTNER`, sim-side data so the server cannot drift from it). The
 * two halves of one movement share a sim tick and are equal and opposite, so
 * grouping by (tick, magnitude) and requiring the pair to net to zero finds an
 * orphaned half without needing a transaction id the sim does not mint.
 *
 * Deliberately magnitude-keyed rather than pairing on counterparty ids: the
 * pool halves name a pool, not a character, so a counterparty join would fail
 * on exactly the market and mail paths that most need checking.
 */
export function checkTransferSymmetry(rows: readonly ReconcileRow[]): EconomyAlert[] {
  // Bucket by tick and magnitude: one movement's two halves always share both.
  const buckets = new Map<string, ReconcileRow[]>();
  for (const r of rows) {
    if (TRANSFER_PARTNER[r.kind] === undefined) continue;
    const key = `${r.simTick}:${Math.abs(r.amount)}`;
    const b = buckets.get(key);
    if (b) b.push(r);
    else buckets.set(key, [r]);
  }
  const alerts: EconomyAlert[] = [];
  for (const [key, group] of buckets) {
    const net = group.reduce((sum, r) => sum + r.amount, 0);
    if (net === 0) continue;
    const [tick] = key.split(':');
    const lone = group[0];
    alerts.push({
      kind: 'orphaned_transfer',
      severity: 'critical',
      characterId: lone.characterId,
      delta: net,
      detail: `transfer at sim tick ${tick} nets ${net} copper across ${group.length} row(s) of kind ${[...new Set(group.map((r) => r.kind))].join(', ')} instead of balancing to zero: one half of a transfer is missing, which is the signature of a race that credited one side and lost the other`,
    });
  }
  return alerts;
}

/**
 * Run every check over one window's worth of evidence and return the findings,
 * most severe first so a truncated operator view still shows the worst thing.
 */
export function reconcileWindow(input: {
  rowsByCharacter: ReadonlyMap<number, readonly ReconcileRow[]>;
  /**
   * Persisted purses for SETTLED characters only: those whose save is known to
   * postdate their last ledger row. The job owns that selection, because
   * comparing an in-session player's half-saved purse against a ledger that is
   * already ahead of it would report a critical on every active player and
   * bury the one real finding under them.
   */
  persistedCopper: ReadonlyMap<number, number>;
  openingSupply: number;
  closingSupply: SupplySnapshot;
  droppedWrites: number;
  /** Total drift the UNSETTLED characters can account for; see `checkSupply`. */
  unsettledCopper?: number;
}): EconomyAlert[] {
  const alerts: EconomyAlert[] = [];
  const all: ReconcileRow[] = [];
  for (const [characterId, rows] of input.rowsByCharacter) {
    alerts.push(...checkChain(rows));
    const purse = purseRows(rows);
    const last = purse.length > 0 ? purse[purse.length - 1].balanceAfter : null;
    const persisted = input.persistedCopper.get(characterId);
    // A character with no persisted figure is not a finding: they may simply
    // not have been saved yet. Absence of evidence is not evidence of a dupe.
    if (persisted !== undefined) {
      alerts.push(...checkPersistedBalance(characterId, last, persisted));
    }
    all.push(...rows);
  }
  alerts.push(...checkTransferSymmetry(all));
  alerts.push(
    ...checkSupply(input.openingSupply, input.closingSupply, totalFlows(all), {
      droppedWrites: input.droppedWrites,
      unsettledCopper: input.unsettledCopper,
    }),
  );
  const rank: Record<EconomyAlertSeverity, number> = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
