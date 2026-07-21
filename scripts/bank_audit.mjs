// Bank ledger conservation audit (offline tooling, run directly with Node).
//
// Cross-checks the append-only bank_ledger table against the live bank state
// serialized in characters.state.bank. The ledger is birth-complete (the bank
// ships in the same release, every bank starts empty), so replaying every
// deposit/withdraw for a character must reconstruct exactly the items its bank
// holds now, and no withdraw may ever remove an item that was never deposited.
//
// Everything is grouped and REPORTED BY CONTAINER from day one: v1 sees only the
// 'personal' container, but a future guild bank writes 'guild' rows into the SAME
// table and inherits this audit unchanged (its own state source would wire in
// then; here the state reconciliation runs for 'personal' only).
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
    characterId: row.character_id,
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
  }
}

// The pure checker. `ledgerRows` are bank_ledger rows (snake_case, id-ascending
// preferred but re-sorted here); `characters` are { id, realm, state } records.
// Returns findings [{ container, realm, characterId, kind, detail }].
export function auditBank({ ledgerRows, characters }) {
  const findings = [];
  const rows = [...ledgerRows].sort((a, b) => Number(a.id) - Number(b.id));

  // A) Per-row shape checks.
  for (const row of rows) checkRowShape(row, findings);

  // Group id-ascending rows by container + character.
  const groups = new Map();
  for (const row of rows) {
    const container = row.container ?? 'personal';
    const key = `${container}::${row.character_id}`;
    let group = groups.get(key);
    if (!group) {
      group = { container, characterId: row.character_id, realm: row.realm, rows: [] };
      groups.set(key, group);
    }
    group.rows.push(row);
  }

  // Personal-container replay results, keyed by character id, for reconciliation.
  const personalNet = new Map();
  const personalFinalPurchased = new Map();

  // B) Per-group monotonicity + conservation replay.
  for (const group of groups.values()) {
    const base = { container: group.container, realm: group.realm, characterId: group.characterId };

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
    lines.push(
      `FINDING: container ${finding.container}: realm ${finding.realm}: character ${finding.characterId}: ${finding.kind}: ${finding.detail}`,
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

  const pool = new Pool({ connectionString: databaseUrl, max: 2 });
  try {
    const ledger = await pool.query(
      `SELECT id, realm, character_id, op, item_id, count, instance,
              copper_delta, purchased_slots_after, container, container_id
         FROM bank_ledger
        ORDER BY id`,
    );
    const chars = await pool.query('SELECT id, realm, state FROM characters');
    const characters = chars.rows.map((r) => ({ id: r.id, realm: r.realm, state: r.state }));
    const findings = auditBank({ ledgerRows: ledger.rows, characters });
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
