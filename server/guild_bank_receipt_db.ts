// Receipt-gated guild-bank replay for character saves. The character fence
// and bank-ledger command classifier run first; this module touches only the
// newly claimed command sidecars, in ascending guild-row lock order.
//
// SOURCE CUSTODY. Each replayed sidecar carries the exact per-source legs its
// command moved, so the book this transaction writes holds the units it really
// moved rather than a whole-stack rewrite. The durable audit of that is the
// container journal, and it is written HERE, in this same transaction, from the
// two states this module actually has: the locked persisted BEFORE row (through
// the one load path) and the POST-MERGE book it just wrote, so the journal can
// never describe a book the receipt gate refused. One batched statement covers
// every guild the save moved, after every guild row is written and in the same
// ascending guild-id order the row locks were taken in; a save that moved no
// material stock, and an empty receipt retry that queries no guild at all, pay
// no source query either. A refusal from the journal core THROWS, which aborts
// the caller's whole transaction: book, character, ledger rows and audit commit
// together or not at all.

import { type GuildBankOpDelta, sanitizeGuildBankState } from '../src/sim/guild_bank';
import type { InvSlot } from '../src/sim/types';
import type { BankLedgerBatchWriteResult } from './bank_ledger_batch_db';
import {
  type BankLedgerCommandBatch,
  type SerializedBankLedgerGuildDelta,
  serializeBankLedgerGuildEffect,
} from './bank_ledger_outbox';
import { type GuildBookSourceChange, journalGuildBookSources } from './guild_bank_source_journal';
import {
  GuildBankEscrowRefused,
  type GuildBankSave,
  type GuildBankWriteResult,
  mergeGuildBankRow,
} from './guild_bank_state';
import { REALM } from './realm';

export const GUILD_BANK_ROW_MAX_BYTES = 262_144;

export interface GuildBankReceiptReplayPlan {
  /** Empty books have no value-moving effect and may be seeded idempotently. */
  readonly emptySeedGuildIds: readonly number[];
}

interface Queryable {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows?: Record<string, unknown>[]; rowCount?: number | null }>;
}

function assertGuildId(guildId: number): void {
  if (!Number.isSafeInteger(guildId) || guildId <= 0) {
    throw new RangeError('guild bank save guildId must be a positive safe integer');
  }
}

function effectsByGuild(
  batches: readonly BankLedgerCommandBatch[],
): Map<number, SerializedBankLedgerGuildDelta[]> {
  const grouped = new Map<number, SerializedBankLedgerGuildDelta[]>();
  for (const batch of batches) {
    if (!batch.guildEffect) continue;
    const effect = serializeBankLedgerGuildEffect(batch.guildEffect);
    const deltas = grouped.get(effect.guildId) ?? [];
    deltas.push(...effect.deltas);
    grouped.set(effect.guildId, deltas);
  }
  return grouped;
}

function sameDeltas(
  actual: readonly SerializedBankLedgerGuildDelta[],
  expected: readonly SerializedBankLedgerGuildDelta[],
): boolean {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

/** Validate the old dirty-book carrier against command-owned sidecars before
 *  pool checkout. Every nonempty delta must be covered, in command order, by
 *  the exact receipt prefix. Empty row seeds are the only unreceipted shape. */
export function prepareGuildBankReceiptReplay(
  guildBanks: readonly GuildBankSave[],
  batches: readonly BankLedgerCommandBatch[],
): GuildBankReceiptReplayPlan {
  if (!Array.isArray(guildBanks)) throw new TypeError('guild bank saves must be an array');
  const expected = effectsByGuild(batches);
  const seen = new Set<number>();
  const emptySeedGuildIds: number[] = [];

  for (const save of guildBanks) {
    if (typeof save !== 'object' || save === null) {
      throw new TypeError('guild bank save must be an object');
    }
    assertGuildId(save.guildId);
    if (seen.has(save.guildId)) {
      throw new Error(`duplicate guild bank save for guild ${save.guildId}`);
    }
    seen.add(save.guildId);
    if (!Array.isArray(save.deltas)) throw new TypeError('guild bank save deltas must be an array');
    if (save.deltas.length === 0) {
      emptySeedGuildIds.push(save.guildId);
      continue;
    }

    const receipted = expected.get(save.guildId);
    if (!receipted) {
      throw new Error(`guild bank ${save.guildId} has nonempty unreceipted deltas`);
    }
    const detached = serializeBankLedgerGuildEffect({
      guildId: save.guildId,
      deltas: save.deltas,
    });
    if (!sameDeltas(detached.deltas, receipted)) {
      throw new Error(`guild bank ${save.guildId} deltas do not match the receipt prefix`);
    }
    expected.delete(save.guildId);
  }

  if (expected.size > 0) {
    const [guildId] = [...expected.keys()].sort((a, b) => a - b);
    throw new Error(
      `bank ledger guild effect for guild ${guildId} has no matching guild bank save`,
    );
  }

  return Object.freeze({
    emptySeedGuildIds: Object.freeze(emptySeedGuildIds.sort((a, b) => a - b)),
  });
}

function replayDelta(delta: SerializedBankLedgerGuildDelta): GuildBankOpDelta {
  return {
    op: delta.op,
    // JSON.parse, never a structured copy: it is what mints an OWN '__proto__'
    // key back, so a payload that carried one survives the round trip whole and
    // keeps the same identity the book grouped it under.
    itemId: delta.itemId,
    count: delta.count,
    instance: delta.instanceJson === null ? null : JSON.parse(delta.instanceJson),
    craftedRecipeId: delta.craftedRecipeId,
    copperDelta: delta.copperDelta,
    purchasedSlotsBefore: delta.purchasedSlotsBefore,
    purchasedSlotsAfter: delta.purchasedSlotsAfter,
    // The receipt's own canonical legs, carried through verbatim: they are what
    // makes this replay move the exact units the command moved, including a
    // count-0 re-attribution whose unit total nets to nothing.
    materialSources: delta.materialSources,
  };
}

/** Pure selection used by the DB shell and tests. Existing receipts are never
 *  replayed; command order is preserved within each guild, then locks sort by id. */
export function guildBankSavesForNewClaims(
  plan: GuildBankReceiptReplayPlan,
  claims: BankLedgerBatchWriteResult,
): GuildBankSave[] {
  const grouped = new Map<number, GuildBankOpDelta[]>();
  for (const claim of claims.batches) {
    if (!claim.newlyClaimed || !claim.guildEffect) continue;
    const deltas = grouped.get(claim.guildEffect.guildId) ?? [];
    deltas.push(...claim.guildEffect.deltas.map(replayDelta));
    grouped.set(claim.guildEffect.guildId, deltas);
  }
  for (const guildId of plan.emptySeedGuildIds) {
    if (!grouped.has(guildId)) grouped.set(guildId, []);
  }
  return [...grouped].sort(([a], [b]) => a - b).map(([guildId, deltas]) => ({ guildId, deltas }));
}

/** Apply only receipt-new effects. An all-existing prefix with no empty seed
 *  returns without issuing a guild query. */
export async function writeClaimedGuildBankEffectsOnClient(
  client: Queryable,
  plan: GuildBankReceiptReplayPlan,
  claims: BankLedgerBatchWriteResult,
  results?: GuildBankWriteResult[],
): Promise<void> {
  const saves = guildBankSavesForNewClaims(plan, claims);
  // These are not synthetic WRITES. They are explicit durable results for
  // the already-committed command prefix, so the host may retire the matching
  // dirty/log prefix without mistaking the skipped replay for an omission.
  // One result per command sidecar, in exact batch order. Duplicate guild ids
  // are intentional: they preserve the durable command/guild correlation the
  // host needs when retiring an existing receipt prefix.
  for (const claim of claims.batches) {
    if (!claim.newlyClaimed && claim.guildEffect) {
      results?.push({
        guildId: claim.guildEffect.guildId,
        written: true,
        deficit: null,
        rowUnusable: false,
      });
    }
  }
  const written: GuildBankWriteResult[] = [];
  // Ascending guild id (guildBankSavesForNewClaims sorts), so the anchor upsert
  // below takes its rows in the same order the guild_banks rows were locked in.
  const sourceChanges: GuildBookSourceChange[] = [];
  for (const save of saves) {
    written.push(await writeGuildBankRow(client, save, sourceChanges));
  }
  results?.push(...written);
  // A refused book aborts the whole transaction, so its audit is never written:
  // journalling first would only send a statement into a doomed transaction.
  if (written.some((result) => !result.written)) throw new GuildBankEscrowRefused(written);
  await journalGuildBookSources(client, sourceChanges);
}

/** The persisted BEFORE state through the ONE load path, which is exactly the
 *  base mergeGuildBankRow replayed onto. Reached only on a row the merge
 *  accepted, so an oversized or malformed row never gets here (its write is
 *  refused and the transaction aborts before anything is journalled). */
function beforeInventory(durable: unknown): readonly InvSlot[] {
  return sanitizeGuildBankState(durable).inventory;
}

/** Write one guild's book and record what the journal needs about it. `changes`
 *  collects the locked persisted BEFORE state and the POST-MERGE book for every
 *  row this transaction actually wrote; a refused row contributes nothing. */
async function writeGuildBankRow(
  client: Queryable,
  save: GuildBankSave,
  changes: GuildBookSourceChange[],
): Promise<GuildBankWriteResult> {
  const lockedRead = async () =>
    client.query(
      `SELECT octet_length(data::text) AS data_bytes,
              CASE WHEN octet_length(data::text) <= $2 THEN data ELSE NULL END AS data
         FROM guild_banks
        WHERE guild_id = $1 AND realm = $3
          FOR UPDATE`,
      [save.guildId, GUILD_BANK_ROW_MAX_BYTES, REALM],
    );
  let read = await lockedRead();
  if (!read.rows?.[0]) {
    await client.query(
      `INSERT INTO guild_banks (guild_id, realm, data, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (guild_id) DO NOTHING`,
      [save.guildId, REALM, JSON.stringify({ treasury: 0, inventory: [], purchasedSlots: 0 })],
    );
    read = await lockedRead();
  }
  const row = read.rows?.[0];
  const oversized = row ? Number(row.data_bytes) > GUILD_BANK_ROW_MAX_BYTES : false;
  const durable = row ? (row.data ?? null) : null;
  const merged = mergeGuildBankRow(durable, save.deltas, { oversized });
  if (merged.data === null) return { guildId: save.guildId, ...merged.result };
  // The journal's before-state is the SAME normalized reading of the SAME locked
  // row the merge replayed onto, taken from the row already in hand: no extra
  // query, and no chance of describing a state this transaction did not see.
  changes.push({
    guildId: save.guildId,
    before: beforeInventory(durable),
    after: merged.data.inventory,
  });
  await client.query(
    `INSERT INTO guild_banks (guild_id, realm, data, updated_at) VALUES ($1, $2, $3, now())
     ON CONFLICT (guild_id) DO UPDATE SET realm = EXCLUDED.realm, data = EXCLUDED.data,
       updated_at = now()`,
    [save.guildId, REALM, JSON.stringify(merged.data)],
  );
  return { guildId: save.guildId, ...merged.result };
}
