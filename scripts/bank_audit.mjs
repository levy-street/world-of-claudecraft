// Bank ledger conservation audit (offline tooling, run directly with Node).
//
// Cross-checks the append-only bank_ledger table against the live bank state
// serialized in characters.state.bank. The ledger is birth-complete (the bank
// ships in the same release, every bank starts empty), so replaying every
// deposit/withdraw for a character must reconstruct exactly the items its bank
// holds now, and no withdraw may ever remove an item that was never deposited.
//
// Everything is grouped and REPORTED BY CONTAINER: 'personal' rows group per
// character and reconcile against characters.state.bank; 'vault' rows (the
// Materials Vault, Bank Storage Phase 2) group per character too and reconcile
// against characters.state.vault; 'guild' rows (Guild Bank Phase 3) group per
// GUILD (container_id), because the guild bank is an anonymous exchange pipe
// (officer A deposits, officer B withdraws), so item conservation only holds
// across the whole guild, never per character. Guild
// groups additionally replay the treasury (deposit_gold + withdraw_gold +
// buy_slots copper deltas; create_fee and open_bank are PERSONAL purse copper
// and are excluded) and reconcile against the guild_banks book when it is provided.
// admin_purge (the operator escape hatch for a permanently unwithdrawable
// dormant slot, server/game.ts adminPurgeGuildBankSlot) replays as an item
// REMOVAL alongside withdraw and moves no copper at all. A
// guild with ledger rows but no book row reconciles items and treasury against
// an EMPTY book (a disbanded guild: the disband guard proves both were zero)
// but skips the purchased reconciliation (expansions survive to the last row).
//
// THE PERSONAL CONTAINER additionally carries the bank SOCKET STORE (Bank
// Storage phase 07): 'unlock_socket' rows replay the copper ladder (the Nth
// unlock per character costs exactly the Nth BANK_SOCKET_PRICES entry, at most
// four ever) against state.bank.unlockedSockets, and 'socket_bag' /
// 'unsocket_bag' rows replay the socketed-bag multiset against
// state.bank.socketBags, in maps SEPARATE from the slot replay's (a bag can
// legitimately sit in a slot AS an item or in a socket AS capacity, so a
// merged replay would paper one store's shortfall over with the other's
// surplus). The carried inventory these bags move through remains outside
// every container this audit enumerates, as it always has been.
// KNOWN FINDING CLASS with no ledger counterpart: sanitizeBankState nulls a
// tampered/corrupt socket entry at load (the one destructive load arm,
// reported through the per-load drop sink as bank.socket<i>.<id>) without
// writing a compensating unsocket_bag row, so a character whose save was
// repaired that way reports socket_ledger_state_mismatch on every later
// audit. Correlate such findings against the drop-sink diagnostics before
// treating them as a dupe.
// A SECOND known class, the lost-unlock cascade: a swallowed unlock_socket
// row (the tolerated transient write-failure/shutdown-drain hole) shifts
// every LATER unlock row one rung down the price ladder, so the honest
// socket_unlock_mismatch arrives beside up to three cascading
// bad_socket_price findings whose copper each matches a LATER rung. That
// signature is a missing row, not price tampering: reconcile the unlock
// count first before reading the price findings.
//
// THE VAULT CONTAINER reuses the personal op vocabulary ('deposit', 'withdraw',
// 'buy_slots'), so every shape and replay rule above applies to it unchanged.
// Ordinary pooled stock keys as [itemId, null]. Identity-preserving rows key as
// [itemId, {vaultSpecial:1,instance,craftedRecipeId}], so crafted and glyph-bearing
// copies reconcile without flattening. Its purchased_slots_after column carries
// the upgrade RUNG (state.vault.upgrades), the monotonic ladder analogue of the
// bank's purchasedSlots. A character with vault rows but no persisted
// state.vault reconciles against an EMPTY vault, the same corruption signature
// the personal container treats that way. Vault rows are birth-complete (every
// vault starts empty) ONLY because Bank Storage phases 01 and 02 ship in the
// SAME release: a character who had deposited under a phase-01-only binary
// would hold stock no vault row explains and would reconcile as a permanent
// ledger_state_mismatch, one this tool could never clear.
//
// THE COUNTERPARTY CHECK. Every replay described above reads the CONTAINER
// side of each row and reconciles it against the container, which is
// self-consistent by construction: it can never see value that left the book
// for a purse and never came back, and that is the shape of every guild bank
// dupe there has been. Guild rows now also record the PAYER/PAYEE side (the
// acting character's purse and bags, from the same server-derived before/after
// snapshot), so each op is a closed system and conservation is arithmetic on
// one row: book side + counterparty side + sink = 0. See
// checkCounterpartyBalance below. Rows with no recorded counterparty side
// (pre-feature rows, and every personal-container row) are SKIPPED, never read
// as balanced, and the report says how many were skipped.
//
// OPERATOR CONSISTENCY: the CLI wraps every table read in one read-only,
// repeatable-read transaction. Character rows, guild books, and their ledger
// prefix commit atomically, and a proven lease fence commits none of them, so
// every finding reflects one coherent database snapshot even on a live realm.
// Quiesce first only when the audit must include every save accepted before an
// operational cutoff rather than the snapshot established at invocation.
//
// Structure: PURE exported functions (unit-tested directly) plus a main() that
// only runs when the file is executed directly. main() talks to Postgres via pg;
// auditBank is pure and DB-free.
//
// Usage: node scripts/bank_audit.mjs
// Exits 1 when any finding exists, 0 when clean.

import { pathToFileURL } from 'node:url';
import { Pool } from 'pg';

// The guild slot ladder's valid purchased_slots_after values, mirrored from
// GUILD_BANK_RUNG_SLOTS / GUILD_BANK_LADDER_POSITIONS in src/sim/guild_bank.ts
// (this script stays dependency-free of the TS sim; tests/bank_audit.test.ts
// pins the two declarations in lockstep). open_bank (rung 0) always lands on
// the opened base; a guild buy_slots (rungs 1+) always lands on a later
// ladder position.
export const OPEN_BANK_SLOTS_AFTER = 24;

// The ANOMALY op (server/bank_ledger.ts GUILD_BANK_ESCROW_DEFICIT_OP): ONE row
// per escrow ROLLBACK. A session's book half could not be replayed onto durable
// truth, so the whole transaction was refused, the session was quarantined and
// disconnected, and everything it had done since its last save was discarded.
// Nothing was minted and nothing durable was lost, but reaching it needs one
// officer to consume value another officer never made durable and then for that
// officer to vanish, so an operator should see it. No value moved under the row,
// so it takes no part in the item, treasury, or ladder replays.
//
// Its numbers are SIGNED, describing what the DISCARDED work would have moved
// into the book: negative means the session was taking value OUT (the shape
// that would have minted had it been allowed to commit), positive means it was
// putting value IN. The report states the direction rather than assuming one.
export const ESCROW_DEFICIT_OP = 'escrow_deficit';

// The COUNTERPARTY ORPHAN op (server/bank_ledger.ts
// GUILD_BANK_COUNTERPARTY_ORPHAN_OP): a guild bank op that moved the acting
// character's purse or bags while the guild book did not move at all. No
// legitimate op produces one, so every row of this op is reported outright.
// Like the deficit row it takes no part in the item, treasury, or ladder
// replays: the value it describes moved OUTSIDE the book, which is exactly
// why the book-only replay could never see it.
export const COUNTERPARTY_ORPHAN_OP = 'counterparty_orphan';

// Rows that describe something OTHER than a value movement in the book. Both
// are excluded from every replay (items, treasury, ladder monotonicity) and
// from the per-op counterparty balance below.
const ANOMALY_OPS = new Set([ESCROW_DEFICIT_OP, COUNTERPARTY_ORPHAN_OP]);

export const GUILD_BUY_POSITIONS = [30, 36, 42, 48, 54, 60];
const GUILD_BUY_POSITION_SET = new Set(GUILD_BUY_POSITIONS);

// The vault ladder's top rung (VAULT_UPGRADE_PRICES.length in
// src/sim/materials_vault.ts): a vault buy_slots row's purchased_slots_after
// carries the rung REACHED, so the integers 1 through this are the only honest
// values a writer can emit. Lockstep-pinned against the sim ladder by
// tests/bank_audit.test.ts, the KNOWN_CONTAINERS discipline.
export const VAULT_MAX_RUNG = 5;

// The bank bag-socket ladder (BANK_SOCKET_PRICES in src/sim/bank.ts),
// mirrored dependency-free like the guild ladder and the vault rung above and
// lockstep-pinned by tests/bank_audit.test.ts. A legitimate unlock history is
// a PREFIX of this list: the Nth unlock_socket row per character costs exactly
// the Nth price, and a fifth row has no honest price at all.
export const BANK_SOCKET_PRICES = [1000000, 2000000, 3500000, 5000000];

// The op vocabulary this audit's shape chain handles (checkRowShape): the
// dependency-free mirror of server/db.ts BankLedgerRow.op, the same
// KNOWN_CONTAINERS discipline. The chain's else-arm stays the runtime
// decision (an op outside the chain dedupes into unknown_op); this set exists
// so tests/bank_audit.test.ts can hold the two declarations in lockstep BOTH
// ways: it is scraped against the db.ts union (a NEW union member reds
// without an entry here) and it generates the known-op guard's row table (an
// entry here without a real chain arm reds as an unexpected unknown_op).
export const KNOWN_OPS = new Set([
  'deposit',
  'withdraw',
  'buy_slots',
  'deposit_gold',
  'withdraw_gold',
  'create_fee',
  'open_bank',
  ESCROW_DEFICIT_OP,
  'admin_purge',
  COUNTERPARTY_ORPHAN_OP,
  'craft_consume',
  // Bank bag sockets (Bank Storage phase 07), personal-only: the copper-only
  // socket unlock plus the two single-bag moves into and out of the bank's
  // socket store (a container the slot replay cannot see; it gets its own
  // replay below, reconciled against state.bank.socketBags).
  'unlock_socket',
  'socket_bag',
  'unsocket_bag',
]);

// ---------------------------------------------------------------------------
// The COUNTERPARTY (payer/payee) balance. THE CHECK THIS SCRIPT WAS MISSING.
//
// Before the counterparty columns existed, every guild finding here was
// derived from bank_ledger rows and reconciled against the guild book, i.e.
// from the book's own side of every op against the book. That replay is
// SELF-CONSISTENT BY CONSTRUCTION and can therefore never detect a mint that
// ends up sitting in a player's purse: value that crosses the purse/book
// boundary in one direction only leaves the book side perfectly explicable.
// Every dupe this feature had was exactly that shape.
//
// With `counterparty_copper_delta` / `counterparty_count` recorded, each op is
// a closed system and conservation is arithmetic on ONE row:
//
//   book side  +  counterparty side  +  sink  =  0
//
// where the sink is the value the op deliberately removed from the world (a
// ladder rung's price, the guild creation fee, an operator purge's destroyed
// copy). Both derivations below read only the row's own op and columns.
//
// NOTE on copper_delta's overload, which is why `bookCopper` is not simply
// that column: for deposit_gold / withdraw_gold / buy_slots it IS the
// treasury's movement, but for open_bank and create_fee it records the PURSE
// payment (the treasury never held that copper, which is why the treasury
// replay above excludes both). Reading it uniformly would double-count those
// two.

/** Copper the guild's TREASURY moved under this row. */
function bookCopperDelta(row) {
  switch (row.op) {
    case 'deposit_gold':
    case 'withdraw_gold':
    case 'buy_slots':
      return Number(row.copper_delta) || 0;
    default:
      // open_bank / create_fee are purse-paid; item ops and purges move none.
      return 0;
  }
}

/** Copper this row removed from the world entirely (a positive burn). */
function copperSinkOf(row) {
  switch (row.op) {
    case 'buy_slots':
    case 'open_bank':
    case 'create_fee':
      // copper_delta is the negated price on all three, so the burn is its
      // negation. A ladder rung and a creation fee are paid to nobody.
      return -(Number(row.copper_delta) || 0);
    default:
      return 0;
  }
}

/** Signed count of `item_id` the BOOK gained under this row. */
function bookItemDelta(row) {
  const n = Number(row.count) || 0;
  switch (row.op) {
    case 'deposit':
      return n;
    case 'withdraw':
    case 'admin_purge':
      return -n;
    default:
      return 0;
  }
}

/** Copies this row removed from the world entirely (a positive destruction).
 *  Only the operator purge destroys: a withdraw hands the copy to the actor,
 *  which is what its counterparty count says. */
function itemSinkOf(row) {
  return row.op === 'admin_purge' ? Number(row.count) || 0 : 0;
}

/** The counterparty half of the ledger SELECT list, given the column names the
 *  database actually has. DEGRADE, never die: DEPLOY.md tells operators to run
 *  this tool after a restore, and a restored pg_dump (or a replica that has not
 *  booted the new schema) is exactly the incident it exists for, so naming a
 *  missing column unconditionally would fail the whole audit precisely then. An
 *  absent column is selected as a typed NULL, which lands in the already
 *  implemented "unbalanceable, skipped" path and is reported as such.
 *  Exported so the fallback is unit-testable without a database. */
export function counterpartySelectList(presentColumns) {
  const has = new Set(presentColumns);
  return [
    has.has('counterparty_copper_delta')
      ? 'counterparty_copper_delta'
      : 'NULL::bigint AS counterparty_copper_delta',
    has.has('counterparty_count') ? 'counterparty_count' : 'NULL::int AS counterparty_count',
  ].join(', ');
}

/** True when this row records a counterparty side at all. NULL on BOTH columns
 *  means NOT RECORDED (a pre-feature row, or a personal-container row, which
 *  never writes one), and the balance is skipped rather than evaluated against
 *  an assumed zero: reading absence as balance would turn every legacy row
 *  into a false all-clear, which is the exact failure this check exists to
 *  stop being possible. */
function hasCounterparty(row) {
  return row.counterparty_copper_delta != null || row.counterparty_count != null;
}

/** The per-op balance identity, evaluated on one guild row. */
function checkCounterpartyBalance(row, base, findings) {
  if ((row.container ?? 'personal') !== 'guild') return;
  // Anomaly rows describe work that did not land (deficit) or report the
  // imbalance themselves (orphan); neither is a movement to balance.
  if (ANOMALY_OPS.has(row.op)) return;
  if (!hasCounterparty(row)) return;

  const cpCopper = Number(row.counterparty_copper_delta) || 0;
  const copperSum = bookCopperDelta(row) + cpCopper + copperSinkOf(row);
  if (copperSum !== 0) {
    findings.push({
      ...base,
      kind: 'counterparty_copper_imbalance',
      detail:
        `${row.op} row ${row.id} does not conserve copper: the book moved ${bookCopperDelta(row)}, ` +
        `the acting character's purse moved ${cpCopper}, and ${copperSinkOf(row)} was burned, ` +
        `leaving ${copperSum} ${copperSum > 0 ? 'MINTED' : 'DESTROYED'}`,
    });
  }

  const cpCount = Number(row.counterparty_count) || 0;
  const itemSum = bookItemDelta(row) + cpCount + itemSinkOf(row);
  if (itemSum !== 0) {
    findings.push({
      ...base,
      kind: 'counterparty_item_imbalance',
      detail:
        `${row.op} row ${row.id} does not conserve ${row.item_id ?? 'items'}: the book moved ` +
        `${bookItemDelta(row)}, the acting character's bags moved ${cpCount}, and ${itemSinkOf(row)} ` +
        `was destroyed, leaving ${itemSum} ${itemSum > 0 ? 'MINTED' : 'DESTROYED'}`,
    });
  }
}

// A multiset key over an item: its id plus a stable serialization of the
// per-instance payload (null when absent). Both the ledger `instance` column and
// characters.state are JSONB, so Postgres normalizes each side's key order the
// same way; equal payloads therefore serialize identically here. Most bank items
// are fungible (instance absent) so the key is just [itemId, null].
function multisetKey(itemId, instance) {
  return JSON.stringify([itemId ?? null, instance ?? null]);
}

function vaultSpecialIdentity(slot) {
  return {
    vaultSpecial: 1,
    instance: slot.instance ?? null,
    craftedRecipeId: slot.craftedRecipeId ?? null,
  };
}

function isExactVaultSpecialIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const keys = Object.keys(value).sort();
  if (JSON.stringify(keys) !== JSON.stringify(['craftedRecipeId', 'instance', 'vaultSpecial'])) {
    return false;
  }
  if (value.vaultSpecial !== 1) return false;
  if (
    value.instance !== null &&
    (typeof value.instance !== 'object' || Array.isArray(value.instance))
  ) {
    return false;
  }
  return (
    value.craftedRecipeId === null ||
    (typeof value.craftedRecipeId === 'string' && value.craftedRecipeId !== '')
  );
}

function itemIdFromKey(key) {
  try {
    return JSON.parse(key)[0];
  } catch {
    return key;
  }
}

// The persisted bank object for a character row, or null if the character has no
// bank state yet. characters.state arrives parsed (JSONB) from Postgres but a
// fixture may pass a JSON string; handle both.
function stateBankOf(character) {
  if (!character) return null;
  let state = character.state;
  if (typeof state === 'string') {
    try {
      state = JSON.parse(state);
    } catch {
      return null;
    }
  }
  if (!state || typeof state !== 'object') return null;
  const bank = state.bank;
  if (!bank || typeof bank !== 'object') return null;
  return bank;
}

// The persisted Materials Vault object for a character row, or null when the
// character has no vault state yet. Same tolerant parse as stateBankOf (JSONB
// from Postgres, a JSON string from a fixture).
function stateVaultOf(character) {
  if (!character) return null;
  let state = character.state;
  if (typeof state === 'string') {
    try {
      state = JSON.parse(state);
    } catch {
      return null;
    }
  }
  if (!state || typeof state !== 'object') return null;
  const vault = state.vault;
  if (!vault || typeof vault !== 'object') return null;
  return vault;
}

// The `stock` record of a vault object: a plain id-to-count map. A missing or
// wrong-shaped stock (an array is the likely wrong guess, the bank's slot-list
// shape) reads as empty here rather than throwing, so the reconciliation below
// still runs and reports the resulting mismatch.
function vaultStockOf(vault) {
  const stock = vault?.stock;
  if (!stock || typeof stock !== 'object' || Array.isArray(stock)) return {};
  return stock;
}

// The item multiset a vault currently holds. Ordinary stock stays pooled under
// [itemId, null]; each special row carries the exact versioned identity the
// ledger writer emits. Keys are walked sorted where source order is irrelevant.
function vaultStateMultiset(vault) {
  const m = new Map();
  const stock = vaultStockOf(vault);
  for (const itemId of Object.keys(stock).sort()) {
    const key = multisetKey(itemId, null);
    m.set(key, (m.get(key) ?? 0) + Number(stock[itemId] ?? 0));
  }
  const special = Array.isArray(vault?.special) ? vault.special : [];
  for (const slot of special) {
    if (!slot || typeof slot !== 'object' || typeof slot.itemId !== 'string') continue;
    const key = multisetKey(slot.itemId, vaultSpecialIdentity(slot));
    m.set(key, (m.get(key) ?? 0) + Number(slot.count ?? 0));
  }
  return m;
}

// The bag multiset a bank's SOCKET STORE currently holds. Sockets store bare
// ids (never an instance payload; the sim's #2837 peek refuses one before it
// can enter), so every key is [itemId, null], exactly the key a socket ledger
// row produces. Tolerant like every state read here: a missing or wrong-shaped
// socketBags reads as empty, and only string entries count (null is an empty
// socket; anything else is junk the mismatch below surfaces by its absence).
function socketStateMultiset(bank) {
  const bags = Array.isArray(bank?.socketBags) ? bank.socketBags : [];
  const m = new Map();
  for (const id of bags) {
    if (typeof id !== 'string' || id === '') continue;
    const key = multisetKey(id, null);
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return m;
}

// The item multiset a bank currently holds (summed by key over its inventory).
function stateMultiset(bank) {
  const m = new Map();
  const inv = Array.isArray(bank.inventory) ? bank.inventory : [];
  for (const slot of inv) {
    if (!slot || typeof slot !== 'object') continue;
    const key = multisetKey(slot.itemId, slot.instance);
    m.set(key, (m.get(key) ?? 0) + Number(slot.count ?? 0));
  }
  return m;
}

// Every container the reconciliation passes below actually replay. Anything
// else is reported per row rather than grouped and forgotten (see the
// unknown_container check at the end of checkRowShape). Exported so
// tests/bank_audit.test.ts can pin this vocabulary in lockstep with the
// BankLedgerRow.container union in server/db.ts: widening one side alone would
// let a container the writer emits reach an audit that reconciles nothing.
export const KNOWN_CONTAINERS = new Set(['personal', 'vault', 'guild']);

// Per-row shape anomalies (independent of any replay).
function checkRowShape(row, findings) {
  // Set when the op matches no arm of the vocabulary chain below; returned so
  // auditBank can dedupe unknown-op findings per op VALUE rather than per row.
  let unknownOp = null;
  const base = {
    container: row.container ?? 'personal',
    realm: row.realm,
    // Shape findings keep the acting character for attribution; guild rows
    // additionally carry their guild (the group key the report names).
    characterId: row.character_id,
    ...((row.container ?? 'personal') === 'guild'
      ? { guildId: row.container_id == null ? null : Number(row.container_id) }
      : {}),
  };
  // craft_consume (Bank Storage Phase 04) is an item op with exactly the
  // deposit/withdraw row shape: vault stock consumed in place by a completed
  // craft, one row per material id, positive count, no copper.
  if (
    row.op === 'deposit' ||
    row.op === 'withdraw' ||
    row.op === 'admin_purge' ||
    row.op === 'craft_consume'
  ) {
    if (row.count == null || Number(row.count) <= 0) {
      findings.push({
        ...base,
        kind: 'bad_count',
        detail: `${row.op} row ${row.id} has a non-positive count ${String(row.count)}`,
      });
    }
    if (row.item_id == null || row.item_id === '') {
      findings.push({
        ...base,
        kind: 'missing_item_id',
        detail: `${row.op} row ${row.id} has no item_id`,
      });
    }
    if (Number(row.copper_delta) !== 0) {
      findings.push({
        ...base,
        kind: 'copper_on_item_op',
        detail: `${row.op} row ${row.id} carries copper_delta ${String(row.copper_delta)}`,
      });
    }
  } else if (row.op === 'buy_slots') {
    if (row.count != null) {
      findings.push({
        ...base,
        kind: 'count_on_buy',
        detail: `buy_slots row ${row.id} carries a count ${String(row.count)}`,
      });
    }
    // Bank Storage phase 11: a personal buy_slots row carries its payment
    // rail in instance->>'paidWith' (server-derived, never the request). A
    // Claudium purchase moves NO copper (its debit is the service-side
    // claudium_ledger; this row is the character-side slot audit), so its
    // copper_delta must be EXACTLY 0; every other rail (gold, or a
    // pre-phase-11 unstamped row) keeps the negated-price shape.
    const buyRail =
      row.instance && typeof row.instance === 'object' ? row.instance.paidWith : undefined;
    const buyContainer = row.container ?? 'personal';
    // The exemption is PERSONAL-only. Guild and vault buy_slots rows are
    // single-rail by design and stay unstamped, so a claudium stamp on one is
    // itself the anomaly: without this scope a forged guild row carrying
    // {"paidWith":"claudium"} would inherit the zero-copper exemption and walk
    // straight past nonnegative_buy_cost, which is the only thing standing
    // between the audit and a free guild expansion.
    if (buyRail === 'claudium' && buyContainer !== 'personal') {
      findings.push({
        ...base,
        kind: 'claudium_rail_off_personal',
        detail: `${buyContainer} buy_slots row ${row.id} is stamped paidWith claudium`,
      });
    }
    if (buyRail === 'claudium' && buyContainer === 'personal') {
      if (Number(row.copper_delta) !== 0) {
        findings.push({
          ...base,
          kind: 'copper_on_claudium_buy',
          detail: `claudium buy_slots row ${row.id} has copper_delta ${String(row.copper_delta)}`,
        });
      }
    } else if (Number(row.copper_delta) >= 0) {
      findings.push({
        ...base,
        kind: 'nonnegative_buy_cost',
        detail: `buy_slots row ${row.id} has copper_delta ${String(row.copper_delta)}`,
      });
    }
    // A GUILD expansion (rungs 1+) always lands on a valid ladder position
    // above the opened base; any other after-count is a tampered book or a
    // mis-named op (the personal ladder has its own positions, unchecked here).
    if (
      (row.container ?? 'personal') === 'guild' &&
      !GUILD_BUY_POSITION_SET.has(Number(row.purchased_slots_after))
    ) {
      findings.push({
        ...base,
        kind: 'bad_buy_position',
        detail: `guild buy_slots row ${row.id} has purchased_slots_after ${String(row.purchased_slots_after)}`,
      });
    }
    // A VAULT purchase (Bank Storage Phase 2) always lands ON the ladder:
    // purchased_slots_after carries the rung reached, and the sim refuses a
    // climb past the top, so any non-integer or out-of-ladder value is a
    // tampered row or a mis-named op, the same tripwire the guild arm above
    // gives its positions.
    if ((row.container ?? 'personal') === 'vault') {
      const rung = Number(row.purchased_slots_after);
      if (!(Number.isInteger(rung) && rung >= 1 && rung <= VAULT_MAX_RUNG)) {
        findings.push({
          ...base,
          kind: 'bad_buy_position',
          detail: `vault buy_slots row ${row.id} has purchased_slots_after ${String(row.purchased_slots_after)}`,
        });
      }
    }
  } else if (row.op === 'deposit_gold' || row.op === 'withdraw_gold') {
    // Guild treasury moves: copper-only rows with a direction-checked delta.
    if (row.item_id != null || row.count != null) {
      findings.push({
        ...base,
        kind: 'item_on_gold_op',
        detail: `${row.op} row ${row.id} carries item fields`,
      });
    }
    if (row.op === 'deposit_gold' && Number(row.copper_delta) <= 0) {
      findings.push({
        ...base,
        kind: 'bad_gold_delta',
        detail: `deposit_gold row ${row.id} has non-positive copper_delta ${String(row.copper_delta)}`,
      });
    }
    if (row.op === 'withdraw_gold' && Number(row.copper_delta) >= 0) {
      findings.push({
        ...base,
        kind: 'bad_gold_delta',
        detail: `withdraw_gold row ${row.id} has non-negative copper_delta ${String(row.copper_delta)}`,
      });
    }
  } else if (row.op === 'open_bank') {
    // Ladder rung 0: the acting officer's PURSE opened the item store (24
    // slots). Purse-paid like create_fee, so it is excluded from the treasury
    // replay below; the after-count is always the rung-0 grant.
    if (row.count != null) {
      findings.push({
        ...base,
        kind: 'count_on_open',
        detail: `open_bank row ${row.id} carries a count ${String(row.count)}`,
      });
    }
    if (Number(row.copper_delta) >= 0) {
      findings.push({
        ...base,
        kind: 'nonnegative_open_cost',
        detail: `open_bank row ${row.id} has copper_delta ${String(row.copper_delta)}`,
      });
    }
    if (Number(row.purchased_slots_after) !== OPEN_BANK_SLOTS_AFTER) {
      findings.push({
        ...base,
        kind: 'bad_open_slots',
        detail: `open_bank row ${row.id} has purchased_slots_after ${String(row.purchased_slots_after)}`,
      });
    }
  } else if (row.op === ESCROW_DEFICIT_OP) {
    const copper = Number(row.copper_delta) || 0;
    const count = Number(row.count) || 0;
    const parts = [];
    if (copper !== 0) {
      parts.push(`${Math.abs(copper)} copper ${copper < 0 ? 'out of' : 'into'} the book`);
    }
    if (row.item_id != null && count !== 0) {
      parts.push(`${Math.abs(count)} x ${row.item_id} ${count < 0 ? 'out of' : 'into'} the book`);
    }
    findings.push({
      ...base,
      kind: 'escrow_deficit',
      detail:
        `escrow rollback row ${row.id}: a guild bank escrow save could not replay its own ` +
        `deltas onto durable truth, so the whole save was refused and the session was ` +
        `rolled back and disconnected. Discarded work: ${
          parts.length > 0 ? parts.join(', ') : 'no net movement'
        }. Nothing durable was minted or lost; reaching this needs one officer to consume ` +
        'value another officer never made durable and then for that officer to vanish.',
    });
  } else if (row.op === COUNTERPARTY_ORPHAN_OP) {
    const copper = Number(row.counterparty_copper_delta) || 0;
    const count = Number(row.counterparty_count) || 0;
    const parts = [];
    if (copper !== 0) {
      parts.push(`${Math.abs(copper)} copper ${copper > 0 ? 'into' : 'out of'} the purse`);
    }
    if (row.item_id != null && count !== 0) {
      parts.push(`${Math.abs(count)} x ${row.item_id} ${count > 0 ? 'into' : 'out of'} the bags`);
    }
    findings.push({
      ...base,
      kind: 'counterparty_orphan',
      detail:
        `counterparty orphan row ${row.id}: a guild bank op moved the acting character's ` +
        `purse/bags while the guild book did not move at all (${
          parts.length > 0 ? parts.join(', ') : 'no recorded movement'
        }). Value crossed the purse/book boundary in ONE direction, which no legitimate op ` +
        'can do. The evidence payload names the attempted op and the whole movement.',
    });
  } else if (row.op === 'socket_bag' || row.op === 'unsocket_bag') {
    // A socket move is always EXACTLY ONE bag (the sim stores a bare id per
    // socket; there is no stacked-socket state a bigger count could describe),
    // so this arm is stricter than the generic item-op shape above.
    if (Number(row.count) !== 1) {
      findings.push({
        ...base,
        kind: 'bad_count',
        detail: `${row.op} row ${row.id} has count ${String(row.count)} (a socket move is exactly one bag)`,
      });
    }
    if (row.item_id == null || row.item_id === '') {
      findings.push({
        ...base,
        kind: 'missing_item_id',
        detail: `${row.op} row ${row.id} has no item_id`,
      });
    }
    if (Number(row.copper_delta) !== 0) {
      findings.push({
        ...base,
        kind: 'copper_on_item_op',
        detail: `${row.op} row ${row.id} carries copper_delta ${String(row.copper_delta)}`,
      });
    }
    // Sockets store BARE ids (the sim refuses a payload-bearing bag before it
    // can enter), and the replay keys socket rows as [itemId, null]; a row
    // carrying an instance payload is a mint signature the count reconcile
    // would otherwise silently absorb.
    if (row.instance != null) {
      findings.push({
        ...base,
        kind: 'unexpected_instance',
        detail: `${row.op} row ${row.id} carries an instance payload (sockets store bare ids)`,
      });
    }
  } else if (row.op === 'unlock_socket') {
    // The buy_slots shape: copper-only, no item fields. The exact ladder price
    // is checked in the per-character replay below (it depends on the row's
    // POSITION in that character's unlock sequence, which one row cannot know).
    if (row.count != null) {
      findings.push({
        ...base,
        kind: 'count_on_buy',
        detail: `unlock_socket row ${row.id} carries a count ${String(row.count)}`,
      });
    }
    if (row.item_id != null) {
      findings.push({
        ...base,
        kind: 'item_on_gold_op',
        detail: `unlock_socket row ${row.id} carries item fields`,
      });
    }
    if (Number(row.copper_delta) >= 0) {
      findings.push({
        ...base,
        kind: 'nonnegative_buy_cost',
        detail: `unlock_socket row ${row.id} has copper_delta ${String(row.copper_delta)}`,
      });
    }
  } else if (row.op === 'create_fee') {
    // The founder's purse paid the (positive) creation fee; a newborn guild
    // has no expansions yet.
    if (Number(row.copper_delta) >= 0) {
      findings.push({
        ...base,
        kind: 'nonnegative_create_fee',
        detail: `create_fee row ${row.id} has copper_delta ${String(row.copper_delta)}`,
      });
    }
    if (Number(row.purchased_slots_after) !== 0) {
      findings.push({
        ...base,
        kind: 'slots_on_create_fee',
        detail: `create_fee row ${row.id} has purchased_slots_after ${String(row.purchased_slots_after)}`,
      });
    }
  } else {
    // The op-side twin of unknown_container below, added when craft_consume
    // widened the vocabulary: an op this chain does not know gets NO shape
    // checks and is skipped by the item replay, while its purchased_slots_after
    // still feeds the monotonicity scan, so a typo'd writer would quietly
    // poison a group's replay while every one of its rows passed shape.
    // Flagging it is what makes widening the vocabulary a reviewed act.
    // DEDUPED per op value by the caller (the flaggedNegative discipline):
    // an unknown op is uniquely likely to be SYSTEMATIC (a typo'd writer, or
    // an old audit running against a newer server), and per-row emission on
    // a keep-forever table would build millions of finding objects exactly
    // when an operator most needs the report to open. The op value is
    // RETURNED (at the end, so the container checks below still run on the
    // row) and auditBank's tracker emits one finding per op value with the
    // first row and the total count.
    unknownOp = String(row.op);
  }
  // The gold, fee, open, and admin-purge ops exist only for the guild
  // container, and every guild row must name its guild (container_id is the
  // group key).
  const container = row.container ?? 'personal';
  const guildOnlyOp =
    row.op === 'deposit_gold' ||
    row.op === 'withdraw_gold' ||
    row.op === 'create_fee' ||
    row.op === 'open_bank' ||
    row.op === 'admin_purge' ||
    row.op === ESCROW_DEFICIT_OP ||
    row.op === COUNTERPARTY_ORPHAN_OP;
  if (guildOnlyOp && container !== 'guild') {
    findings.push({
      ...base,
      kind: 'gold_op_outside_guild',
      detail: `${row.op} row ${row.id} has container '${container}'`,
    });
  }
  // The vault-only mirror of that guard: craft_consume records stock consumed
  // in place from the Materials Vault, the one container crafting can draw
  // from, so on any other container it is a mis-labeled writer whose row
  // would replay against a store that never moved.
  if (row.op === 'craft_consume' && container !== 'vault') {
    findings.push({
      ...base,
      kind: 'vault_op_outside_vault',
      detail: `${row.op} row ${row.id} has container '${container}'`,
    });
  }
  // The personal-only mirror of that guard: the socket store hangs off
  // state.bank (unlockedSockets / socketBags), a per-character structure, so a
  // socket op on any other container is a mis-labeled writer whose row would
  // replay against a store that never moved.
  if (
    (row.op === 'unlock_socket' || row.op === 'socket_bag' || row.op === 'unsocket_bag') &&
    container !== 'personal'
  ) {
    findings.push({
      ...base,
      kind: 'socket_op_outside_personal',
      detail: `${row.op} row ${row.id} has container '${container}'`,
    });
  }
  if (container === 'guild' && row.container_id == null) {
    findings.push({
      ...base,
      kind: 'missing_container_id',
      detail: `guild row ${row.id} has no container_id`,
    });
  }
  // The mirror of that check: only a GUILD row may carry a container_id.
  // server/db.ts states the contract on BankLedgerRow ('personal' and 'vault'
  // are per-character stores, container_id NULL; only 'guild' keys by id), and
  // both writers hardcode null, so there is no legitimate non-guild population
  // to false-positive on. The hazard is identical whichever non-guild container
  // it is: the character IS the group key, so a second key the grouping below
  // ignores means a writer invented a store no pass reads. An unknown container
  // carrying one reports here AND as unknown_container, which is the honest
  // read: both facts are separately wrong.
  if (container !== 'guild' && row.container_id != null) {
    findings.push({
      ...base,
      kind: 'unexpected_container_id',
      detail: `${container} row ${row.id} has container_id ${String(row.container_id)}`,
    });
  }
  // Vault item evidence is either pooled null or the exact versioned special
  // wrapper. Craft consumption can only draw pooled stock, and purchases carry
  // no item identity, so both of those ops require null specifically.
  const vaultInstanceAllowed =
    row.instance == null ||
    ((row.op === 'deposit' || row.op === 'withdraw') && isExactVaultSpecialIdentity(row.instance));
  if (
    container === 'vault' &&
    (!vaultInstanceAllowed ||
      ((row.op === 'craft_consume' || row.op === 'buy_slots') && row.instance != null))
  ) {
    findings.push({
      ...base,
      kind: 'unexpected_instance',
      detail: `vault row ${row.id} carries invalid identity evidence`,
    });
  }
  // A container this script does not know is replayed by NOTHING: the grouping
  // pass builds it a group and nets its items, but the reconciliation passes
  // each match on their own literal container, so a future writer with a
  // typo'd container would move real value into a store no pass reads and no
  // finding names. Flagging the row here is what stops it vanishing.
  if (!KNOWN_CONTAINERS.has(container)) {
    findings.push({
      ...base,
      kind: 'unknown_container',
      detail: `row ${row.id} has an unrecognized container '${container}'`,
    });
  }
  return unknownOp;
}

// The pure checker. `ledgerRows` are bank_ledger rows (snake_case, id-ascending
// preferred but re-sorted here); `characters` are { id, realm, state } records.
// Returns findings [{ container, realm, characterId, kind, detail }].
export function auditBank({ ledgerRows, characters, guildBanks }) {
  const findings = [];
  const rows = [...ledgerRows].sort((a, b) => Number(a.id) - Number(b.id));

  // A) Per-row shape checks, plus the per-op counterparty balance (the one
  // check that can see across the purse/book boundary).
  // Unknown-op tracker (the F4 dedupe): one finding per unrecognized op
  // VALUE, carrying the first row seen and the total row count, never one
  // per row (a systematic unknown op on a keep-forever table would other-
  // wise flood the report exactly when an operator most needs it).
  const unknownOps = new Map();
  for (const row of rows) {
    const unknownOp = checkRowShape(row, findings);
    if (unknownOp !== null) {
      // Group key mirrors the replay grouping below: guild rows spread per
      // GUILD, everything else per character, so the finding can say how far
      // a systematic unknown op reaches while staying one finding per value
      // (the base still names the first row's group for attribution).
      const rowContainer = row.container ?? 'personal';
      const groupKey =
        rowContainer === 'guild'
          ? `guild::${row.container_id}`
          : `${rowContainer}::${row.character_id}`;
      const seen = unknownOps.get(unknownOp);
      if (seen) {
        seen.count += 1;
        seen.groups.add(groupKey);
      } else {
        unknownOps.set(unknownOp, {
          count: 1,
          firstRowId: row.id,
          groups: new Set([groupKey]),
          base: {
            container: rowContainer,
            realm: row.realm,
            characterId: row.character_id,
          },
        });
      }
    }
    checkCounterpartyBalance(
      row,
      {
        container: row.container ?? 'personal',
        realm: row.realm,
        characterId: row.character_id,
        ...((row.container ?? 'personal') === 'guild'
          ? { guildId: row.container_id == null ? null : Number(row.container_id) }
          : {}),
      },
      findings,
    );
  }
  for (const [op, seen] of unknownOps) {
    findings.push({
      ...seen.base,
      kind: 'unknown_op',
      detail:
        `${seen.count} row(s) carry an unrecognized op '${op}' ` +
        `across ${seen.groups.size} container/character group(s) ` +
        `(first at row ${seen.firstRowId}); none were shape-checked or replayed`,
    });
  }

  // Group id-ascending rows: personal per character, guild per GUILD
  // (container_id), because guild item conservation only holds across the
  // whole anonymous pipe, never per depositing character.
  const groups = new Map();
  for (const row of rows) {
    const container = row.container ?? 'personal';
    const key =
      container === 'guild' ? `guild::${row.container_id}` : `${container}::${row.character_id}`;
    let group = groups.get(key);
    if (!group) {
      group =
        container === 'guild'
          ? {
              container,
              characterId: null,
              guildId: row.container_id == null ? null : Number(row.container_id),
              realm: row.realm,
              rows: [],
            }
          : { container, characterId: row.character_id, realm: row.realm, rows: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
  }

  // Personal-container replay results, keyed by character id, for reconciliation.
  const personalNet = new Map();
  const personalFinalPurchased = new Map();

  // Bank socket-store replay results (Bank Storage phase 07), keyed by
  // character id. Kept in their OWN maps on the vault rule above: the socket
  // store and the slot bank hold the same item ids (a bag can sit in a slot AS
  // an item or in a socket AS capacity), so a merged replay would let a
  // shortfall in one be papered over by a surplus in the other.
  const personalSocketNet = new Map();
  const personalUnlockCount = new Map();

  // Materials Vault replay results, also keyed by character id. Kept in their
  // OWN maps rather than merged into the personal ones: the two containers are
  // separate stores holding the same item ids, so a merged replay would let a
  // shortfall in one be papered over by a surplus in the other.
  const vaultNet = new Map();
  const vaultFinalPurchased = new Map();

  // Guild-container replay results, keyed by guild id.
  const guildNet = new Map();
  const guildTreasury = new Map();
  const guildFinalPurchased = new Map();
  const guildRealm = new Map();

  // B) Per-group monotonicity + conservation replay.
  for (const group of groups.values()) {
    const base =
      group.container === 'guild'
        ? {
            container: group.container,
            realm: group.realm,
            characterId: null,
            guildId: group.guildId,
          }
        : {
            container: group.container,
            realm: group.realm,
            characterId: group.characterId,
          };

    let prevPurchased = null;
    let finalPurchased = null;
    for (const row of group.rows) {
      // Anomaly rows describe work that did NOT land in the book (a rolled-
      // back escrow, or value that moved outside it), so they carry no ladder
      // position and must not drag the monotonicity scan backwards.
      if (ANOMALY_OPS.has(row.op)) continue;
      const after = Number(row.purchased_slots_after);
      if (!Number.isFinite(after)) continue;
      // Guild commands from different officers are committed with their
      // character saves, so a bystander row can legitimately arrive after a
      // later ladder purchase while retaining the lower position it observed
      // at command time. The guild-row CAS still forces open_bank/buy_slots
      // commits themselves into ladder order. Use every row's maximum as the
      // final birth-complete witness, but run regression checks only across
      // the commands that actually move the guild ladder. Personal and vault
      // rows remain one-character FIFO streams, where every row is ordered.
      if (group.container === 'guild') {
        finalPurchased = finalPurchased === null ? after : Math.max(finalPurchased, after);
        if (row.op !== 'open_bank' && row.op !== 'buy_slots') continue;
      }
      if (prevPurchased !== null && after < prevPurchased) {
        findings.push({
          ...base,
          kind: 'purchased_regression',
          detail: `row ${row.id} purchased_slots_after ${after} is below the previous ${prevPurchased}`,
        });
      }
      prevPurchased = prevPurchased === null ? after : Math.max(prevPurchased, after);
      if (group.container !== 'guild') finalPurchased = after;
    }

    const net = new Map();
    const flaggedNegative = new Set();
    const finalRowForKey = new Map();
    for (const row of group.rows) {
      // admin_purge removes a dormant copy from a guild book, so it replays as
      // a REMOVAL exactly like a withdraw: without it the purged copy would
      // read as an unexplained shortfall against the live book forever.
      // craft_consume (Phase 04) replays as a removal on the same argument:
      // vault stock a completed craft consumed in place would otherwise read
      // as an unexplained shortfall against state.vault.stock forever.
      if (
        row.op !== 'deposit' &&
        row.op !== 'withdraw' &&
        row.op !== 'admin_purge' &&
        row.op !== 'craft_consume'
      ) {
        continue;
      }
      const key = multisetKey(row.item_id, row.instance);
      const delta = row.op === 'deposit' ? Number(row.count) : -Number(row.count);
      const next = (net.get(key) ?? 0) + delta;
      net.set(key, next);
      finalRowForKey.set(key, row);
      if (group.container !== 'guild' && next < 0 && !flaggedNegative.has(key)) {
        flaggedNegative.add(key);
        findings.push({
          ...base,
          kind: 'negative_net',
          detail: `item ${row.item_id} net fell to ${next} at row ${row.id}: withdrew more than was ever deposited`,
        });
      }
    }
    if (group.container === 'guild') {
      // A successful guild save may use the same netted replay as
      // mergeGuildBankRow: cross-officer commit order can make the original
      // rows dip below zero inside one self-balancing batch even though the
      // durable transaction applied an equivalent nonnegative order. The
      // final net remains authoritative and is still reconciled to the book.
      for (const [key, count] of net) {
        if (count >= 0) continue;
        const row = finalRowForKey.get(key);
        findings.push({
          ...base,
          kind: 'negative_net',
          detail: `item ${itemIdFromKey(key)} final net is ${count} after row ${row?.id}: withdrew more than was ever deposited`,
        });
      }
    }

    if (group.container === 'personal') {
      personalNet.set(group.characterId, net);
      personalFinalPurchased.set(group.characterId, finalPurchased);

      // The socket-store replay: socket_bag adds a bag to the store,
      // unsocket_bag removes one, and the running net per bag id must never
      // fall below zero (unsocketing a bag that was never socketed is the
      // same mint signature as the slot replay's negative_net). The unlock
      // ladder replays beside it: the Nth unlock row costs exactly the Nth
      // mirrored price, and rows past the ladder's end have no honest price.
      const socketNet = new Map();
      const flaggedSocketNegative = new Set();
      let unlockRows = 0;
      for (const row of group.rows) {
        if (row.op === 'socket_bag' || row.op === 'unsocket_bag') {
          const key = multisetKey(row.item_id, null);
          const delta = row.op === 'socket_bag' ? Number(row.count) : -Number(row.count);
          const next = (socketNet.get(key) ?? 0) + delta;
          socketNet.set(key, next);
          if (next < 0 && !flaggedSocketNegative.has(key)) {
            flaggedSocketNegative.add(key);
            findings.push({
              ...base,
              kind: 'negative_socket_net',
              detail: `bag ${row.item_id} socket net fell to ${next} at row ${row.id}: unsocketed more than was ever socketed`,
            });
          }
        } else if (row.op === 'unlock_socket') {
          const expected = BANK_SOCKET_PRICES[unlockRows];
          if (expected === undefined) {
            findings.push({
              ...base,
              kind: 'socket_unlock_past_ladder',
              detail: `unlock_socket row ${row.id} is unlock ${unlockRows + 1} but the ladder has ${BANK_SOCKET_PRICES.length} rungs`,
            });
          } else if (Number(row.copper_delta) !== -expected) {
            findings.push({
              ...base,
              kind: 'bad_socket_price',
              detail: `unlock_socket row ${row.id} (unlock ${unlockRows + 1}) has copper_delta ${String(row.copper_delta)}, expected ${-expected}`,
            });
          }
          unlockRows += 1;
        }
      }
      personalSocketNet.set(group.characterId, socketNet);
      personalUnlockCount.set(group.characterId, unlockRows);
    }

    if (group.container === 'vault') {
      vaultNet.set(group.characterId, net);
      vaultFinalPurchased.set(group.characterId, finalPurchased);
    }

    if (group.container === 'guild') {
      // Treasury replay: deposit_gold, withdraw_gold, and buy_slots all move
      // TREASURY copper; create_fee (the founder's purse) and open_bank (the
      // opening officer's purse, ladder rung 0) are excluded.
      // More copper leaving the treasury than ever entered it is a
      // dupe/corruption signature. As with item replay above, rows from
      // different officers' atomic saves may interleave in an order that
      // makes a valid self-balancing batch dip below zero, so only the final
      // total is ordered strongly enough to judge from ledger ids.
      let treasury = 0;
      let lastTreasuryRow = null;
      for (const row of group.rows) {
        if (row.op !== 'deposit_gold' && row.op !== 'withdraw_gold' && row.op !== 'buy_slots') {
          continue;
        }
        treasury += Number(row.copper_delta);
        lastTreasuryRow = row;
      }
      if (treasury < 0) {
        findings.push({
          ...base,
          kind: 'negative_treasury',
          detail: `treasury ended at ${treasury} after row ${lastTreasuryRow?.id}: more copper left than ever entered`,
        });
      }

      // A guild opens its bank at most once (the ladder never returns to
      // rung 0 through any legitimate op). A second open_bank row means
      // legacy pre-transactional history or corruption: a current fenced
      // save commits neither the opening nor its ledger row.
      const openRows = group.rows.filter((row) => row.op === 'open_bank');
      if (openRows.length > 1) {
        findings.push({
          ...base,
          kind: 'multiple_open_bank',
          detail: `guild has ${openRows.length} open_bank rows (ids ${openRows
            .map((r) => r.id)
            .join(', ')})`,
        });
      }
      if (group.guildId != null) {
        guildNet.set(group.guildId, net);
        guildTreasury.set(group.guildId, treasury);
        guildFinalPurchased.set(group.guildId, finalPurchased);
        guildRealm.set(group.guildId, group.realm);
      }
    }
  }

  // C) State reconciliation for the personal container, over every character
  // (a character with items in its bank but no ledger rows violates the
  // birth-complete invariant and surfaces here as a net-vs-state mismatch).
  for (const character of characters) {
    const bank = stateBankOf(character);
    // A character with neither bank state nor ledger activity is a pre-bank save:
    // nothing to reconcile. But ledger activity WITHOUT any persisted bank state is
    // a corruption signature (the rows claim items or purchases the state does not
    // show), so reconcile those against an EMPTY bank instead of skipping.
    const hasLedgerActivity =
      personalNet.has(character.id) || personalFinalPurchased.get(character.id) != null;
    if (!bank && !hasLedgerActivity) continue;
    const effectiveBank = bank ?? { inventory: [], purchasedSlots: 0 };
    const base = { container: 'personal', realm: character.realm, characterId: character.id };

    const inv = Array.isArray(effectiveBank.inventory) ? effectiveBank.inventory : [];
    for (const slot of inv) {
      if (slot && typeof slot === 'object' && Number(slot.count) < 0) {
        findings.push({
          ...base,
          kind: 'negative_state_count',
          detail: `state bank holds ${slot.itemId} with a negative count ${Number(slot.count)}`,
        });
      }
    }

    const net = personalNet.get(character.id) ?? new Map();
    const stateM = stateMultiset(effectiveBank);
    const keys = new Set([...net.keys(), ...stateM.keys()]);
    for (const key of keys) {
      const ledgerCount = net.get(key) ?? 0;
      const stateCount = stateM.get(key) ?? 0;
      if (ledgerCount !== stateCount) {
        findings.push({
          ...base,
          kind: 'ledger_state_mismatch',
          detail: `item ${itemIdFromKey(key)}: ledger net ${ledgerCount} does not match state bank ${stateCount}`,
        });
      }
    }

    const finalPurchased = personalFinalPurchased.get(character.id);
    if (finalPurchased != null) {
      const statePurchased = Number(effectiveBank.purchasedSlots ?? 0);
      if (statePurchased !== finalPurchased) {
        findings.push({
          ...base,
          kind: 'purchased_mismatch',
          detail: `final ledger purchased_slots_after ${finalPurchased} does not match state purchasedSlots ${statePurchased}`,
        });
      }
    }

    // Socket-store reconciliation (Bank Storage phase 07): replaying every
    // socket_bag/unsocket_bag must reconstruct exactly the bags the sockets
    // hold now, and the unlock rung must equal the unlock rows written. The
    // store is birth-complete on the vault's terms (phases 06 and 07 ship in
    // the same release; no online save can hold a socket a row does not
    // explain), so state sockets with no ledger explanation flag here too.
    const socketNet = personalSocketNet.get(character.id) ?? new Map();
    const socketStateM = socketStateMultiset(effectiveBank);
    const socketKeys = new Set([...socketNet.keys(), ...socketStateM.keys()]);
    for (const key of socketKeys) {
      const ledgerCount = socketNet.get(key) ?? 0;
      const stateCount = socketStateM.get(key) ?? 0;
      if (ledgerCount !== stateCount) {
        findings.push({
          ...base,
          kind: 'socket_ledger_state_mismatch',
          detail: `bag ${itemIdFromKey(key)}: socket ledger net ${ledgerCount} does not match state socketBags ${stateCount}`,
        });
      }
    }
    const ledgerUnlocks = personalUnlockCount.get(character.id) ?? 0;
    const stateUnlocks = Number(effectiveBank.unlockedSockets ?? 0);
    if (ledgerUnlocks !== stateUnlocks) {
      findings.push({
        ...base,
        kind: 'socket_unlock_mismatch',
        detail: `unlock_socket rows ${ledgerUnlocks} do not match state unlockedSockets ${stateUnlocks}`,
      });
    }
  }

  // C2) State reconciliation for the vault container. The Materials Vault is a
  // per-character store like the personal bank, so it reconciles on the same
  // terms: replaying every vault deposit/withdraw must reconstruct exactly the
  // counts state.vault.stock holds now, and the final purchased_slots_after
  // (this container's upgrade RUNG) must match state.vault.upgrades. It is a
  // SEPARATE pass over the same characters rather than an arm of the personal
  // one, because the two containers hold the same item ids independently.
  for (const character of characters) {
    const vault = stateVaultOf(character);
    // Ledger activity WITHOUT persisted vault state is the corruption signature
    // the personal pass treats the same way: the rows claim materials or rungs
    // the state does not show, so reconcile against an EMPTY vault instead of
    // skipping the character. A character with neither is a pre-vault save.
    const hasLedgerActivity =
      vaultNet.has(character.id) || vaultFinalPurchased.get(character.id) != null;
    if (!vault && !hasLedgerActivity) continue;
    const effectiveVault = vault ?? { stock: {}, upgrades: 0 };
    const base = { container: 'vault', realm: character.realm, characterId: character.id };

    const stock = vaultStockOf(effectiveVault);
    for (const itemId of Object.keys(stock).sort()) {
      if (Number(stock[itemId]) < 0) {
        findings.push({
          ...base,
          kind: 'negative_state_count',
          detail: `state vault holds ${itemId} with a negative count ${Number(stock[itemId])}`,
        });
      }
    }
    const special = effectiveVault?.special;
    if (special !== undefined && !Array.isArray(special)) {
      findings.push({
        ...base,
        kind: 'malformed_special_state',
        detail: 'state vault special collection is not an array',
      });
    }
    if (Array.isArray(special)) {
      for (let index = 0; index < special.length; index++) {
        const slot = special[index];
        if (!slot || typeof slot !== 'object' || typeof slot.itemId !== 'string') {
          findings.push({
            ...base,
            kind: 'malformed_special_state',
            detail: `state vault special row ${index} is malformed`,
          });
          continue;
        }
        if (Number(slot.count) < 0) {
          findings.push({
            ...base,
            kind: 'negative_state_count',
            detail: `state vault special row ${index} holds ${slot.itemId} with a negative count ${Number(slot.count)}`,
          });
        }
      }
    }

    const net = vaultNet.get(character.id) ?? new Map();
    const stateM = vaultStateMultiset(effectiveVault);
    const keys = [...new Set([...net.keys(), ...stateM.keys()])].sort();
    for (const key of keys) {
      const ledgerCount = net.get(key) ?? 0;
      const stateCount = stateM.get(key) ?? 0;
      if (ledgerCount !== stateCount) {
        findings.push({
          ...base,
          kind: 'ledger_state_mismatch',
          detail: `item ${itemIdFromKey(key)}: ledger net ${ledgerCount} does not match state vault ${stateCount}`,
        });
      }
    }

    const finalUpgrades = vaultFinalPurchased.get(character.id);
    if (finalUpgrades != null) {
      const stateUpgrades = Number(effectiveVault.upgrades ?? 0);
      if (stateUpgrades !== finalUpgrades) {
        findings.push({
          ...base,
          kind: 'purchased_mismatch',
          detail: `final ledger purchased_slots_after ${finalUpgrades} does not match state vault upgrades ${stateUpgrades}`,
        });
      }
    }
  }

  // D) State reconciliation for the guild container, when the guild_banks
  // records are provided ({ guild_id, realm, data }). Guild banks are
  // birth-complete too (the table ships with the ledger's guild rows; every
  // book starts empty), so ledger replay must match the persisted book. A
  // guild with rows but NO book row is a disbanded guild: items and treasury
  // reconcile against an EMPTY book (the disband guard proved both were zero),
  // while the purchased reconciliation is skipped (expansions legitimately
  // survive to the last row). A book with contents but no ledger activity is
  // the same corruption signature as the personal container's case above.
  if (guildBanks) {
    const bookByGuild = new Map();
    for (const rec of guildBanks) bookByGuild.set(Number(rec.guild_id), rec);
    const guildIds = new Set([...guildNet.keys(), ...bookByGuild.keys()]);
    for (const guildId of guildIds) {
      const rec = bookByGuild.get(guildId) ?? null;
      const base = {
        container: 'guild',
        realm: rec?.realm ?? guildRealm.get(guildId) ?? '',
        characterId: null,
        guildId,
      };
      let book = rec?.data ?? null;
      if (typeof book === 'string') {
        try {
          book = JSON.parse(book);
        } catch {
          book = null;
        }
      }
      if (!book || typeof book !== 'object') book = null;
      const effective = book ?? { treasury: 0, inventory: [], purchasedSlots: 0 };

      const net = guildNet.get(guildId) ?? new Map();
      const stateM = stateMultiset(effective);
      const keys = new Set([...net.keys(), ...stateM.keys()]);
      for (const key of keys) {
        const ledgerCount = net.get(key) ?? 0;
        const stateCount = stateM.get(key) ?? 0;
        if (ledgerCount !== stateCount) {
          findings.push({
            ...base,
            kind: 'ledger_state_mismatch',
            detail: `item ${itemIdFromKey(key)}: ledger net ${ledgerCount} does not match guild book ${stateCount}`,
          });
        }
      }

      const ledgerTreasury = guildTreasury.get(guildId) ?? 0;
      const stateTreasury = Number(effective.treasury ?? 0);
      if (ledgerTreasury !== stateTreasury) {
        findings.push({
          ...base,
          kind: 'treasury_mismatch',
          detail: `ledger treasury replay ${ledgerTreasury} does not match guild book treasury ${stateTreasury}`,
        });
      }

      if (rec) {
        const finalPurchased = guildFinalPurchased.get(guildId);
        if (finalPurchased != null) {
          const statePurchased = Number(effective.purchasedSlots ?? 0);
          if (statePurchased !== finalPurchased) {
            findings.push({
              ...base,
              kind: 'purchased_mismatch',
              detail: `final ledger purchased_slots_after ${finalPurchased} does not match guild book purchasedSlots ${statePurchased}`,
            });
          }
        }
      }
    }
  }

  return findings;
}

// THE STORAGE PURCHASE ARM (Bank Storage phase 14, closing the ruling that
// unresolved rows had no operator surface at all: no admin route, no metric, and
// nothing here read status). The pending operational row and the deletion-proof
// applied receipt are the durable game-side records of a Claudium purchase.
// Two operational statuses are things a person has to look at:
//
//   unresolved  the spend was accepted and the apply-time re-check refused.
//               Impossible-state territory: the player was charged and holds no
//               slots. Never swept, never regressed, and nothing else in the
//               system will ever revisit it.
//   pending     recoverable work. Normally transient (its own request drives it,
//               and a fresh login re-drives it), so only an OLD one is a signal:
//               past the threshold below, either the character has not come back
//               or nothing is driving the row at all.
//
// `applied` is a legacy mixed-version status. Current successful writers archive
// the immutable receipt and delete the operational row in the character-save
// transaction. A definitive no-debit refusal also deletes its pending row before
// it is reported to the player; refusal history is not a persistent status.
//
// This arm is DE-COUPLED from the ledger replay above: it reconciles nothing
// against character state, so it takes no part in the container grouping and
// prints its own section.

/** A pending row younger than this is ordinary in-flight work, not an
 *  incident: a character who bought and logged straight out leaves one until
 *  the next login recovery, and an ambiguous purchase retries on a backoff.
 *  A day is comfortably past every one of those, so what survives it is either
 *  a character who has not returned (benign, and the report says so) or a row
 *  nothing is going to drive. */
export const STORAGE_PURCHASE_STRANDED_HOURS = 24;

/** How many open rows one report will list. Open rows are bounded in ordinary
 *  operation (a pending row is driven to a terminal status by its own request
 *  or the character's next login, and unresolved rows cost a real debit each),
 *  so reaching this is itself the finding. The report says so rather than
 *  quietly printing a prefix. */
export const STORAGE_PURCHASE_REPORT_LIMIT = 500;

/** The status vocabulary, mirrored from StoragePurchaseStatus in
 *  server/storage_purchase_db.ts (this script stays dependency-free of the TS
 *  server; tests/bank_audit.test.ts pins the two in lockstep). A row outside it
 *  is reported rather than ignored: the current schema carries a CHECK, so a
 *  bad value means a stale/disabled constraint or a corrupt restore. */
export const STORAGE_PURCHASE_STATUSES = new Set(['pending', 'applied', 'unresolved']);

// pg returns TIMESTAMPTZ as a Date and a fixture as a string; both parse, and
// anything unreadable answers null so the caller reports rather than inventing
// an age.
function timestampMs(value) {
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const ms = Date.parse(String(value));
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function hoursSince(startMs, nowMs) {
  if (startMs === null) return null;
  return Math.floor((nowMs - startMs) / 3_600_000);
}

function ageText(hours) {
  return hours === null ? 'an unreadable age' : `${hours}h`;
}

/** Every storage_purchases row an operator should look at. Pure and DB-free,
 *  like auditBank. `nowMs` is injected so the threshold is testable. */
export function auditStoragePurchases({ rows, nowMs }) {
  const findings = [];
  for (const row of rows) {
    const status = String(row.status ?? '');
    const base = {
      realm: String(row.realm ?? ''),
      characterId: row.character_id === null ? null : Number(row.character_id),
      accountId: row.account_id === null ? null : Number(row.account_id),
      key: String(row.idempotency_key ?? ''),
      status,
    };
    const what = `purchase ${base.key} (${String(row.item_id ?? '')}, declared ${String(
      row.expected_cost_claudium ?? '',
    )} Claudium)`;
    if (!STORAGE_PURCHASE_STATUSES.has(status)) {
      findings.push({
        ...base,
        kind: 'storage_purchase_bad_status',
        detail: `${what} carries status ${JSON.stringify(status)}, which is outside the vocabulary: treat as corruption or an unknown writer, and do not resolve it by hand until you know which`,
      });
      continue;
    }
    if (status === 'unresolved') {
      const hours = hoursSince(timestampMs(row.resolved_at ?? row.created_at), nowMs);
      findings.push({
        ...base,
        kind: 'storage_purchase_unresolved',
        detail: `${what} is UNRESOLVED after ${ageText(hours)}: the service accepted the spend and the apply-time re-check refused, so the player was charged and holds no slots. Nothing will revisit it. CHECK THIS CHARACTER'S bank_ledger buy_slots ROWS FIRST: the expected cause is that they bought that same rung with GOLD while the purchase was still open, in which case the ladder already moved and granting by hand would over-grant it. Refund at the service if so; otherwise grant the slots by hand, then settle the row`,
      });
      continue;
    }
    if (status === 'pending') {
      const hours = hoursSince(timestampMs(row.created_at), nowMs);
      if (hours !== null && hours < STORAGE_PURCHASE_STRANDED_HOURS) continue;
      findings.push({
        ...base,
        kind: 'storage_purchase_stranded',
        detail: `${what} has been PENDING for ${ageText(hours)}: a pending row is driven by its own request and re-driven at the character's next login, so at this age either the character has not come back (benign) or nothing is driving it and a debit may be sitting at the service with no game-side apply. Check the character's last login before acting`,
      });
    }
  }
  return findings;
}

/** The storage-purchase section, printed under the ledger report. Says what was
 *  READ as well as what was found: a silent section over a table nobody
 *  queried would read as an all-clear it has not earned. */
export function formatStoragePurchaseReport(rows, findings, truncated = false, totals = null) {
  const lines = [];
  // Said FIRST, because a truncated report that looks complete is worse than no
  // report: an operator reading a tidy list has to know more rows exist.
  if (truncated) {
    lines.push(
      `storage purchases: TRUNCATED at ${STORAGE_PURCHASE_REPORT_LIMIT} open rows: more exist and are NOT listed below. UNRESOLVED rows are read first, so pending rows cannot hide them; if unresolved alone exceeds this limit, some are omitted too. Omitted rows can also include corrupt out-of-vocabulary statuses. Query storage_purchases directly for the full picture.`,
    );
  }
  // Prefer the whole-table totals when the caller has them: over a truncated
  // read the slice's own tally describes the slice, not the incident.
  const byStatus = new Map();
  if (Array.isArray(totals) && totals.length > 0) {
    for (const row of totals) byStatus.set(String(row.status ?? ''), Number(row.n ?? 0));
  } else {
    for (const row of rows) {
      const status = String(row.status ?? '');
      byStatus.set(status, (byStatus.get(status) ?? 0) + 1);
    }
  }
  const counts = [...byStatus.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([status, n]) => `${status} ${n}`)
    .join(', ');
  const openTotal =
    Array.isArray(totals) && totals.length > 0
      ? [...byStatus.values()].reduce((a, b) => a + b, 0)
      : rows.length;
  lines.push(
    `storage purchases: open rows read ${rows.length} of ${openTotal}${counts === '' ? '' : ` (${counts})`}: findings ${findings.length}`,
  );
  for (const finding of findings) {
    lines.push(
      `FINDING: storage purchase: realm ${finding.realm}: character ${finding.characterId}: ${finding.kind}: ${finding.detail}`,
    );
  }
  if (findings.length === 0) {
    lines.push('OK: no unresolved or stranded storage purchases.');
  }
  return lines.join('\n');
}

// A one-line-per-item report grouped by container, plus a per-container summary.
export function formatReport(ledgerRows, findings) {
  const lines = [];
  const containers = new Set();
  for (const row of ledgerRows) containers.add(row.container ?? 'personal');
  for (const finding of findings) containers.add(finding.container);

  lines.push('Bank ledger conservation audit');
  for (const container of [...containers].sort()) {
    const rows = ledgerRows.filter((r) => (r.container ?? 'personal') === container);
    const findingCount = findings.filter((f) => f.container === container).length;
    lines.push(`container ${container}: ledger rows ${rows.length}: findings ${findingCount}`);
    // How much of the guild container the counterparty balance could actually
    // judge. A row with no recorded counterparty side is SKIPPED by that
    // check, so a report that did not say so would read as a stronger
    // all-clear than it is: the skipped rows are exactly the ones whose
    // purse/book conservation this audit still cannot see.
    if (container === 'guild') {
      const missing = rows.filter((r) => !ANOMALY_OPS.has(r.op) && !hasCounterparty(r));
      lines.push(
        `container guild: rows with no recorded counterparty side (pre-feature, unbalanceable): ${missing.length}`,
      );
      // The HIGHEST such id, so an operator can tell a frozen historical gap
      // from a growing one. NULL is supposed to mean "written before the
      // columns existed", but nothing in the schema enforces that: a write
      // site that forgot to stamp would put an indistinguishable NULL into a
      // keep-forever table. If this id keeps climbing across runs, the
      // convention is being broken by live code, not by history.
      if (missing.length > 0) {
        const highest = missing.reduce(
          (max, r) => (Number(r.id) > max ? Number(r.id) : max),
          Number.NEGATIVE_INFINITY,
        );
        lines.push(
          `container guild: highest id with no counterparty side: ${highest} (frozen if it does not climb between runs; a rising value means a live write site is not stamping)`,
        );
      }
    }
  }
  for (const finding of findings) {
    // Guild findings name the guild (the group key); personal ones the character.
    const who =
      finding.guildId != null ? `guild ${finding.guildId}` : `character ${finding.characterId}`;
    lines.push(
      `FINDING: container ${finding.container}: realm ${finding.realm}: ${who}: ${finding.kind}: ${finding.detail}`,
    );
  }
  if (findings.length === 0) lines.push('OK: no shape or conservation anomalies found.');
  return lines.join('\n');
}

// The characters read. Only the bank and vault slices of each character blob:
// the audit reads nothing else, and buffering every full state blob is the
// expensive part. A save that predates either feature yields a JSON null for
// that key, which stateBankOf / stateVaultOf already read as "no state".
// Hoisted out of main() so tests/bank_audit.test.ts can pin the projection by
// source text. Dropping either extraction is not a quiet degradation: that
// container would reconcile against an empty one, so every character WITH
// activity in it starts emitting false ledger_state_mismatch findings, loudly
// and at scale. Only a character with no activity there goes quiet (nothing to
// contradict), which is why the loud noise is the tell and the pin exists.
//
// A recorded scale deferral, the characters-side twin of the ledger read's:
// each jsonb extraction decompresses the WHOLE state blob and Postgres shares
// no work between the two, so reading both slices roughly doubles the scan
// against reading one; the read is fully buffered with no cursor besides, so
// the whole projection lands in this process at once. Revisit with a keyset
// cursor and streaming once characters reaches the low hundreds of thousands
// of rows.
export const CHARACTERS_SQL = `SELECT id, realm,
        jsonb_build_object('bank', state->'bank', 'vault', state->'vault') AS state
   FROM characters`;

async function main() {
  try {
    process.loadEnvFile?.('.env');
  } catch {
    // .env is optional; CI and production inject DATABASE_URL directly.
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'DATABASE_URL is required. Start the dev database with `npm run db:up` and copy .env.example to .env.',
    );
  }

  // A bounded statement timeout so a runaway seq scan on a large ledger can
  // never hold a production connection open indefinitely (this is an offline
  // operator tool pointed at a quiesced realm; failing loudly beats camping a
  // connection). Pagination is a recorded deferral: revisit with a keyset
  // cursor once bank_ledger reaches millions of rows.
  const pool = new Pool({
    connectionString: databaseUrl,
    max: 1,
    options: '-c statement_timeout=300000',
  });
  let client = null;
  let transactionOpen = false;
  try {
    client = await pool.connect();
    // Every reconciliation spans several tables. One read-only snapshot makes
    // the CLI safe to run against a live realm: a save can land before or after
    // this instant, but never between the ledger and state views we compare.
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    transactionOpen = true;
    // DEGRADE, never die, on a database that predates the counterparty
    // columns. DEPLOY.md tells operators to run this tool after a restore, and
    // a restored pg_dump (or a replica that has not booted the new schema yet)
    // is exactly the incident it exists for: naming the columns unconditionally
    // would fail the whole audit with "column does not exist" precisely then.
    // Absent columns select as NULL, which lands in the already-implemented
    // "unbalanceable, skipped" path and is reported as such.
    // Resolved through to_regclass, NOT information_schema.columns filtered by
    // table_name alone: the main SELECT below is UNQUALIFIED, so it reads
    // whichever bank_ledger the search_path resolves to, and a restore staged
    // into a side schema (or a per-tenant layout) can make an unfiltered
    // catalog probe report columns that the table actually being read does not
    // have. That would kill the audit with "column does not exist" in exactly
    // the restore scenario this fallback exists for. to_regclass honours the
    // search_path, so the probe names the same relation the scan will.
    const present = await client.query(
      `SELECT attname AS column_name FROM pg_attribute
        WHERE attrelid = to_regclass('bank_ledger')
          AND attnum > 0 AND NOT attisdropped
          AND attname IN ('counterparty_copper_delta', 'counterparty_count')`,
    );
    const has = new Set(present.rows.map((r) => r.column_name));
    const counterpartyColumns = counterpartySelectList(has);
    if (has.size < 2) {
      console.warn(
        'bank_ledger predates the counterparty columns on this database: the per-op ' +
          'purse/book balance cannot be checked and every guild row is reported as ' +
          'unbalanceable. Boot a realm process against it to apply the schema.',
      );
    }
    const ledger = await client.query(
      // Two more columns, no new predicate: this is the same single ordered
      // scan of the whole table it always was, so it needs no new index (the
      // recorded deferral about paginating this read with a keyset cursor once
      // bank_ledger reaches millions of rows still stands, unchanged).
      `SELECT id, realm, character_id, op, item_id, count, instance,
              copper_delta, purchased_slots_after, container, container_id,
              ${counterpartyColumns}
         FROM bank_ledger
        ORDER BY id`,
    );
    const chars = await client.query(CHARACTERS_SQL);
    const characters = chars.rows.map((r) => ({ id: r.id, realm: r.realm, state: r.state }));
    // Guild books for the guild-container reconciliation (Guild Bank Phase 3).
    const banks = await client.query('SELECT guild_id, realm, data FROM guild_banks');
    const findings = auditBank({ ledgerRows: ledger.rows, characters, guildBanks: banks.rows });
    console.log(formatReport(ledger.rows, findings));

    // The storage-purchase arm. DEGRADE, never die, on the same terms as the
    // counterparty columns above: this table arrived with Bank Storage phase
    // 11, and the tool is documented as the thing you run after a restore, so
    // a database that predates it (or a replica that has not booted the new
    // schema) must still get its ledger audit. to_regclass honours the
    // search_path, so the probe names the same relation the read would.
    //
    // Only non-applied statuses are read. Be precise about what that buys: the
    // RESULT is small, the SCAN is not. `status` carries no general index, so
    // this reads the whole table and filters. That
    // is acceptable here and nowhere else: an offline operator tool, under a
    // statement timeout, in a run that already scans the whole bank_ledger. It
    // is also LIMITED, because the incident that makes this report interesting
    // is exactly the one that could make it enormous, and a tool that balloons
    // in memory during an incident is no use during an incident.
    const storagePresent = await client.query(
      `SELECT to_regclass('storage_purchases') IS NOT NULL AS present`,
    );
    let storageFindings = [];
    if (storagePresent.rows[0]?.present) {
      // status <> 'applied' has no serving index BY DECISION: closed rows are
      // deleted from this table synchronously at resolve time (applied history
      // lives in storage_purchase_applied_receipts), so it only ever holds
      // open or stuck rows (small by construction), and this is operator-run.
      const purchases = await client.query(
        `SELECT id, realm, account_id, character_id, item_id, expected_cost_claudium,
                idempotency_key, status, created_at, resolved_at
           FROM storage_purchases
          WHERE status <> 'applied'
          ORDER BY (status = 'unresolved') DESC, id
          LIMIT $1`,
        [STORAGE_PURCHASE_REPORT_LIMIT + 1],
      );
      const truncated = purchases.rows.length > STORAGE_PURCHASE_REPORT_LIMIT;
      const rows = purchases.rows.slice(0, STORAGE_PURCHASE_REPORT_LIMIT);
      // The per-status totals come from the WHOLE table, not from the slice the
      // limit returned: counts computed over a truncated read under-report the
      // exact incident that caused the truncation, and an operator reading
      // "unresolved 3" during a mass-pending event would act on a number that
      // means "3 of the first 500 rows".
      // Same deliberate index-free scan bound as the report query above.
      const totals = await client.query(
        `SELECT status, count(*)::int AS n
           FROM storage_purchases
          WHERE status <> 'applied'
          GROUP BY status`,
      );
      storageFindings = auditStoragePurchases({ rows, nowMs: Date.now() });
      console.log(formatStoragePurchaseReport(rows, storageFindings, truncated, totals.rows));
    } else {
      console.warn(
        'storage_purchases does not exist on this database: Claudium storage purchases ' +
          'cannot be audited. Boot a realm process against it to apply the schema.',
      );
    }
    process.exitCode = findings.length + storageFindings.length > 0 ? 1 : 0;
    await client.query('COMMIT');
    transactionOpen = false;
  } catch (error) {
    if (client && transactionOpen) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // Preserve the audit failure that made rollback necessary.
      }
    }
    throw error;
  } finally {
    client?.release();
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
