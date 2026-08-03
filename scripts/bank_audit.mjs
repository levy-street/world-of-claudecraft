// Bank ledger conservation audit (offline tooling, run directly with Node).
//
// Cross-checks the append-only bank_ledger table against the live bank state
// serialized in characters.state.bank. The ledger is birth-complete (the bank
// ships in the same release, every bank starts empty), so replaying every
// deposit/withdraw for a character must reconstruct exactly the items its bank
// holds now, and no withdraw may ever remove an item that was never deposited.
//
// Everything is grouped and REPORTED BY CONTAINER: 'personal' rows group per
// character and reconcile against characters.state.bank; 'guild' rows (Guild
// Bank Phase 3) group per GUILD (container_id), because the guild bank is an
// anonymous exchange pipe (officer A deposits, officer B withdraws), so item
// conservation only holds across the whole guild, never per character. Guild
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
// OPERATOR CAVEAT: run against a QUIESCED realm (or accept false positives).
// The ledger rows are written fire-and-forget at op time while the book rows
// land later on the fenced escrow save, so a live realm's unflushed window
// shows as transient ledger/book mismatches; a fenced-out session's rolled-
// back ops also leave their ledger rows behind by design (the evidence trail
// for the incident the loud fence-out log records). Findings on a quiesced
// realm are real.
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

// Per-row shape anomalies (independent of any replay).
function checkRowShape(row, findings) {
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
  if (row.op === 'deposit' || row.op === 'withdraw' || row.op === 'admin_purge') {
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
    if (Number(row.copper_delta) >= 0) {
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
  if (container === 'guild' && row.container_id == null) {
    findings.push({
      ...base,
      kind: 'missing_container_id',
      detail: `guild row ${row.id} has no container_id`,
    });
  }
}

// The pure checker. `ledgerRows` are bank_ledger rows (snake_case, id-ascending
// preferred but re-sorted here); `characters` are { id, realm, state } records.
// Returns findings [{ container, realm, characterId, kind, detail }].
export function auditBank({ ledgerRows, characters, guildBanks }) {
  const findings = [];
  const rows = [...ledgerRows].sort((a, b) => Number(a.id) - Number(b.id));

  // A) Per-row shape checks, plus the per-op counterparty balance (the one
  // check that can see across the purse/book boundary).
  for (const row of rows) {
    checkRowShape(row, findings);
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
      if (prevPurchased !== null && after < prevPurchased) {
        findings.push({
          ...base,
          kind: 'purchased_regression',
          detail: `row ${row.id} purchased_slots_after ${after} is below the previous ${prevPurchased}`,
        });
      }
      prevPurchased = prevPurchased === null ? after : Math.max(prevPurchased, after);
      finalPurchased = after;
    }

    const net = new Map();
    const flaggedNegative = new Set();
    for (const row of group.rows) {
      // admin_purge removes a dormant copy from a guild book, so it replays as
      // a REMOVAL exactly like a withdraw: without it the purged copy would
      // read as an unexplained shortfall against the live book forever.
      if (row.op !== 'deposit' && row.op !== 'withdraw' && row.op !== 'admin_purge') continue;
      const key = multisetKey(row.item_id, row.instance);
      const delta = row.op === 'deposit' ? Number(row.count) : -Number(row.count);
      const next = (net.get(key) ?? 0) + delta;
      net.set(key, next);
      if (next < 0 && !flaggedNegative.has(key)) {
        flaggedNegative.add(key);
        findings.push({
          ...base,
          kind: 'negative_net',
          detail: `item ${row.item_id} net fell to ${next} at row ${row.id}: withdrew more than was ever deposited`,
        });
      }
    }

    if (group.container === 'personal') {
      personalNet.set(group.characterId, net);
      personalFinalPurchased.set(group.characterId, finalPurchased);
    }

    if (group.container === 'guild') {
      // Treasury replay: deposit_gold, withdraw_gold, and buy_slots all move
      // TREASURY copper; create_fee (the founder's purse) and open_bank (the
      // opening officer's purse, ladder rung 0) are excluded.
      // The running balance must never fall below zero: more copper leaving
      // the treasury than ever entered it is a dupe/corruption signature.
      let treasury = 0;
      let flaggedTreasury = false;
      for (const row of group.rows) {
        if (row.op !== 'deposit_gold' && row.op !== 'withdraw_gold' && row.op !== 'buy_slots') {
          continue;
        }
        treasury += Number(row.copper_delta);
        if (treasury < 0 && !flaggedTreasury) {
          flaggedTreasury = true;
          findings.push({
            ...base,
            kind: 'negative_treasury',
            detail: `treasury fell to ${treasury} at row ${row.id}: more copper left than ever entered`,
          });
        }
      }

      // A guild opens its bank at most once (the ladder never returns to
      // rung 0 through any legitimate op). A second open_bank row points at a
      // fenced-out (reverted) opening whose row remained as evidence, or a
      // corruption: either way an operator should look (the same
      // rows-remain-by-design caveat as reverted ops elsewhere).
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
    max: 2,
    options: '-c statement_timeout=300000',
  });
  try {
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
    const present = await pool.query(
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
    const ledger = await pool.query(
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
    // Only the bank slice of each character blob: the audit reads nothing
    // else, and buffering every full state blob is the expensive part.
    const chars = await pool.query(
      `SELECT id, realm, jsonb_build_object('bank', state->'bank') AS state FROM characters`,
    );
    const characters = chars.rows.map((r) => ({ id: r.id, realm: r.realm, state: r.state }));
    // Guild books for the guild-container reconciliation (Guild Bank Phase 3).
    const banks = await pool.query('SELECT guild_id, realm, data FROM guild_banks');
    const findings = auditBank({ ledgerRows: ledger.rows, characters, guildBanks: banks.rows });
    console.log(formatReport(ledger.rows, findings));
    process.exitCode = findings.length > 0 ? 1 : 0;
  } finally {
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
