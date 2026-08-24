// The account-wealth sweep: the logic half over account_wealth_db.ts (which
// owns the SQL). Parses the per-realm mail and market blobs into per-character
// escrow totals (pure, unit-tested directly), orchestrates one refresh pass,
// runs the self-clocked sweep loop, and owns the TTL cache the top-holders
// endpoint reads through. See account_wealth_db.ts's header for why the totals
// are materialised at all.

import type {
  AccountPurseRefreshCounts,
  EscrowCharacterTotal,
  EscrowStateRow,
  LargeGoldMovementRow,
  TopWealthHolderRow,
} from './account_wealth_db';
import { type CachedRead, createCachedRead } from './cached_read';

// Sweep cadence. The database-visible purse only advances on the 30 s
// character autosave, so a 60 s sweep bounds admin-visible staleness at about
// 90 s while keeping the JSONB detoast cost to one pass per minute.
export const ACCOUNT_WEALTH_REFRESH_MS = 60_000;

// The rich list is a fixed-size board; 100 is the "top holders" product ask.
export const TOP_WEALTH_HOLDERS_LIMIT = 100;

// Deliberately TTL-only, never bust-wired: the gold numbers change only when
// the sweep rewrites them (about once a minute), and the moderation badges on
// the board are cosmetic context whose worst-case staleness is this TTL. The
// authoritative ban state is enforced at every entry point regardless.
export const TOP_WEALTH_HOLDERS_TTL_MS = 15_000;

// "Large" gold movements on the account detail view: 10 gold and up.
export const LARGE_GOLD_MOVEMENT_THRESHOLD_COPPER = 100_000;
export const LARGE_GOLD_MOVEMENT_LIMIT = 25;

interface MailSaveShape {
  mail?: { recipientKey?: unknown; copper?: unknown }[];
}

interface MarketSaveShape {
  collections?: { key?: unknown; copper?: unknown }[];
}

function positiveCopper(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** 'mail:eastbrook' -> { kind: 'mail', realm: 'eastbrook' }; null for any
 *  other world_state key (including the retained bare legacy 'market' row). */
export function parseEscrowStateKey(
  key: string,
): { kind: 'mail' | 'market'; realm: string } | null {
  const sep = key.indexOf(':');
  if (sep === -1) return null;
  const kind = key.slice(0, sep);
  if (kind !== 'mail' && kind !== 'market') return null;
  return { kind, realm: key.slice(sep + 1) };
}

/**
 * Fold the mail and market blobs into per-character escrow totals. Keys follow
 * the market sellerKey convention: a stable character id string, with legacy
 * pre-rekey saves possibly still keyed by character NAME (resolved against the
 * blob's realm by the SQL half). The house-stock '' key holds no player gold
 * and is skipped. Pure: a Vitest drives it with literal blobs.
 */
export function escrowTotalsFromStateRows(rows: EscrowStateRow[]): EscrowCharacterTotal[] {
  const byKey = new Map<string, EscrowCharacterTotal>();
  const bucket = (rawKey: string, realm: string): EscrowCharacterTotal | null => {
    const key = rawKey.trim();
    if (key === '') return null;
    const numeric = /^\d+$/.test(key) ? Number(key) : null;
    const characterId = numeric !== null && Number.isSafeInteger(numeric) ? numeric : null;
    // Id-keyed totals merge across realms (character ids are global); name-keyed
    // legacy totals stay realm-scoped because names are only unique per realm.
    const mapKey = characterId !== null ? `id:${characterId}` : `name:${realm}:${key}`;
    let entry = byKey.get(mapKey);
    if (!entry) {
      entry = {
        characterId,
        characterName: characterId === null ? key : null,
        realm: characterId === null ? realm : null,
        mailCopper: 0,
        marketCopper: 0,
      };
      byKey.set(mapKey, entry);
    }
    return entry;
  };
  for (const row of rows) {
    const parsed = parseEscrowStateKey(row.key);
    if (!parsed) continue;
    const data = row.data;
    if (typeof data !== 'object' || data === null) continue;
    if (parsed.kind === 'mail') {
      const letters = (data as MailSaveShape).mail;
      if (!Array.isArray(letters)) continue;
      for (const letter of letters) {
        const copper = positiveCopper(letter?.copper);
        if (copper === 0 || typeof letter?.recipientKey !== 'string') continue;
        const entry = bucket(letter.recipientKey, parsed.realm);
        if (entry) entry.mailCopper += copper;
      }
    } else {
      const collections = (data as MarketSaveShape).collections;
      if (!Array.isArray(collections)) continue;
      for (const col of collections) {
        const copper = positiveCopper(col?.copper);
        if (copper === 0 || typeof col?.key !== 'string') continue;
        const entry = bucket(col.key, parsed.realm);
        if (entry) entry.marketCopper += copper;
      }
    }
  }
  return [...byKey.values()];
}

/** The db functions one refresh pass needs, injectable for pool-less tests. */
export interface AccountWealthSweepDeps {
  refreshAccountPurseTotals(): Promise<AccountPurseRefreshCounts>;
  listEscrowStateRows(): Promise<EscrowStateRow[]>;
  /** Resolves to the number of stale escrow rows zeroed. */
  applyEscrowTotals(totals: EscrowCharacterTotal[]): Promise<number>;
  // The cross-process guard (account_wealth_db.ts withAccountWealthSweepLock):
  // the sweep's queries are global, so exactly one realm process may run a
  // pass; a false return means a peer holds the lock and this tick is a no-op.
  withSweepLock(run: () => Promise<void>): Promise<boolean>;
}

/** The row counts one refresh pass touched, for the per-pass log line. */
export interface AccountWealthRefreshSummary {
  purseRowsChanged: number;
  orphanPursesZeroed: number;
  escrowEntries: number;
  staleEscrowZeroed: number;
}

/** One full refresh: purse totals in SQL, then the Node-parsed escrow pass.
 *  Callers other than tests reach it through the sweep loop, which wraps every
 *  pass in the cross-process lock. */
export async function refreshAccountWealth(
  deps: Pick<
    AccountWealthSweepDeps,
    'refreshAccountPurseTotals' | 'listEscrowStateRows' | 'applyEscrowTotals'
  >,
): Promise<AccountWealthRefreshSummary> {
  const purse = await deps.refreshAccountPurseTotals();
  const rows = await deps.listEscrowStateRows();
  const totals = escrowTotalsFromStateRows(rows);
  const staleEscrowZeroed = await deps.applyEscrowTotals(totals);
  return {
    purseRowsChanged: purse.rowsChanged,
    orphanPursesZeroed: purse.orphansZeroed,
    escrowEntries: totals.length,
    staleEscrowZeroed,
  };
}

/** The one line a completed pass emits (0 counts included): a sweep that
 *  stops speaking is wedged, not quiet, so the line is unconditional. */
export function formatAccountWealthSweepLine(
  summary: AccountWealthRefreshSummary,
  durationMs: number,
): string {
  return (
    `account wealth sweep: ${summary.purseRowsChanged} purse rows changed, ` +
    `${summary.orphanPursesZeroed} orphan purses zeroed, ` +
    `${summary.escrowEntries} escrow entries applied, ` +
    `${summary.staleEscrowZeroed} stale escrow rows zeroed in ${durationMs} ms`
  );
}

export interface AccountWealthSweepHandle {
  stop(): void;
}

/**
 * The self-clocked sweep loop: one refresh per interval, never overlapping
 * (the next timer arms only after the current pass settles), failures logged
 * and retried on the next tick. Registered after listen in main.ts beside the
 * retention sweep. Every completed pass emits one onInfo line with its row
 * counts and duration (the retention sweep's one-line contract); a stand-down
 * to a peer's lock is deliberately silent because at this cadence every loser
 * process would otherwise log once a minute forever.
 */
export function startAccountWealthSweep(
  deps: AccountWealthSweepDeps,
  opts: {
    intervalMs?: number;
    /** A failed pass, with how long it ran before failing (a timeout and a
     *  fast refusal look the same without it). */
    onError?: (err: unknown, durationMs: number) => void;
    onInfo?: (message: string) => void;
  } = {},
): AccountWealthSweepHandle {
  const intervalMs = opts.intervalMs ?? ACCOUNT_WEALTH_REFRESH_MS;
  const onError =
    opts.onError ??
    ((err, durationMs) =>
      console.error(`account wealth sweep failed after ${durationMs} ms:`, err));
  const onInfo = opts.onInfo ?? ((message) => console.log(message));
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  const run = async (): Promise<void> => {
    const startedAt = Date.now();
    try {
      // A false return means a peer process holds the sweep lock and is
      // running this pass globally; standing down until the next tick is the
      // correct outcome, not an error.
      const pass: { summary?: AccountWealthRefreshSummary } = {};
      const ran = await deps.withSweepLock(async () => {
        pass.summary = await refreshAccountWealth(deps);
      });
      if (ran && pass.summary) {
        onInfo(formatAccountWealthSweepLine(pass.summary, Date.now() - startedAt));
      }
    } catch (err) {
      onError(err, Date.now() - startedAt);
    }
    if (!stopped) timer = setTimeout(() => void run(), intervalMs);
  };
  timer = setTimeout(() => void run(), intervalMs);
  return {
    stop(): void {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
    },
  };
}

// ---------------------------------------------------------------------------
// The top-holders cache: single-key, single-flight, TTL (see the constant's
// comment for why it is deliberately not bust-wired). The refresh source is
// injected so tests drive it without a pool.
// ---------------------------------------------------------------------------

let topHoldersSource: (() => Promise<TopWealthHolderRow[]>) | null = null;
let topHoldersCache: CachedRead<TopWealthHolderRow[]> | null = null;

/** Inject the top-holders SQL read (boot wiring, or a test fake). */
export function configureTopWealthHolders(source: () => Promise<TopWealthHolderRow[]>): void {
  topHoldersSource = source;
  topHoldersCache = null;
}

/** Clear the injected source and cache (test-only). */
export function resetTopWealthHoldersForTests(): void {
  topHoldersSource = null;
  topHoldersCache = null;
}

/** Drop the active suspicion-flag counts from a top-holders page. The flag
 *  store is moderation data: the accounts list already strips flag counts for
 *  callers without moderation.read, and the rich list must give the same
 *  caller the same answer (no current role bundle grants accounts.read
 *  without moderation.read, but the two surfaces must not disagree if one
 *  ever does). */
export function redactActiveFlagCounts(
  rows: readonly TopWealthHolderRow[],
): Omit<TopWealthHolderRow, 'activeFlagCount'>[] {
  return rows.map(({ activeFlagCount: _redacted, ...rest }) => rest);
}

/** The large-movements half of the account wealth pane, read through both
 *  admin dispatch arms. */
export interface LargeMovementsPane {
  largeMovements: LargeGoldMovementRow[];
  /** Set when the ledger read failed (its bound is
   *  LARGE_GOLD_MOVEMENTS_TIMEOUT_MS): the pane degrades to an empty list
   *  with this marker instead of failing the whole wealth response, since the
   *  breakdown is already computed by then. Absent on a successful read. */
  largeMovementsUnavailable?: true;
}

/** Run the ledger read for one account and degrade, not fail, on error; the
 *  failure is logged once here (both dispatch arms funnel through this). */
export async function readLargeMovementsPane(
  accountId: number,
  read: () => Promise<LargeGoldMovementRow[]>,
): Promise<LargeMovementsPane> {
  try {
    return { largeMovements: await read() };
  } catch (err) {
    console.error(
      `admin account wealth: large gold movements read failed for account ${accountId}:`,
      err,
    );
    return { largeMovements: [], largeMovementsUnavailable: true };
  }
}

/** The cached top-holders board both admin dispatch arms read. */
export function readTopWealthHolders(): Promise<TopWealthHolderRow[]> {
  if (topHoldersSource === null) {
    throw new Error('top wealth holders source is not configured; call configureTopWealthHolders');
  }
  const source = topHoldersSource;
  topHoldersCache ??= createCachedRead(() => source(), { ttlMs: TOP_WEALTH_HOLDERS_TTL_MS });
  return topHoldersCache.read();
}
