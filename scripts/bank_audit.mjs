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
// and are excluded) and reconcile against the guild_banks book when it is provided. A
// guild with ledger rows but no book row reconciles items and treasury against
// an EMPTY book (a disbanded guild: the disband guard proves both were zero)
// but skips the purchased reconciliation (expansions survive to the last row).
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
  if (row.op === 'deposit' || row.op === 'withdraw') {
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
    if (Number(row.purchased_slots_after) !== 24) {
      findings.push({
        ...base,
        kind: 'bad_open_slots',
        detail: `open_bank row ${row.id} has purchased_slots_after ${String(row.purchased_slots_after)}`,
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
  }
  // The gold, fee, and open ops exist only for the guild container, and every
  // guild row must name its guild (container_id is the group key).
  const container = row.container ?? 'personal';
  const guildOnlyOp =
    row.op === 'deposit_gold' ||
    row.op === 'withdraw_gold' ||
    row.op === 'create_fee' ||
    row.op === 'open_bank';
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

  // A) Per-row shape checks.
  for (const row of rows) checkRowShape(row, findings);

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
      if (row.op !== 'deposit' && row.op !== 'withdraw') continue;
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
    const rowCount = ledgerRows.filter((r) => (r.container ?? 'personal') === container).length;
    const findingCount = findings.filter((f) => f.container === container).length;
    lines.push(`container ${container}: ledger rows ${rowCount}: findings ${findingCount}`);
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
    const ledger = await pool.query(
      `SELECT id, realm, character_id, op, item_id, count, instance,
              copper_delta, purchased_slots_after, container, container_id
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
