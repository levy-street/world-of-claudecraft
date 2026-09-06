// EVIDENCE FIXTURE for the material-source database-performance review. It
// MEASURES and RECORDS; it does not tune anything and it waives nothing.
//
// What it is for: the review's open questions were all "what is the real
// number", and every answer so far has been an estimate. This file builds the
// worst case out of the REAL caps (material registry, per-item stack size, bank
// and guild slot ladders, vault ceiling, the legal name and id lengths) instead
// of a guessed shape, records exact serialized bytes against the ceilings that
// already exist, and counts the statements a save really issues by driving the
// real code with a recording client.
//
// Rules this file holds itself to:
//   * No production edits and no ceiling is raised here. The ceiling constants
//     are PINNED to their current literals, so a change that makes room by
//     moving a ceiling reds this fixture and has to be argued rather than
//     absorbed.
//   * Assertions are hard, machine-independent facts only (shapes, counts,
//     validity through the real validators, strict byte ORDERING). Absolute
//     byte counts and the pass/fail verdict against a ceiling are REPORTED
//     through the measurement channel, never asserted, because the number
//     depends on the live content tables and this fixture must not silently
//     re-base when content moves.
//   * Nothing here fakes the journal away. The recording clients record the
//     statements the real planner and the real save path produce.
//
// The measurement channel is console.info, one JSON line per measurement, so
// the parent can lift the figures out of a run log.

import type { PoolClient, QueryResult } from 'pg';
import { describe, expect, it } from 'vitest';
import { CHARACTER_BLOB_WARN_BYTES } from '../server/character_blob_size';
import { readCharacterMaterialContainers } from '../server/character_material_sources_db';
import { GUILD_BANK_MERGED_MAX_BYTES } from '../server/guild_bank_state';
import {
  type MaterialSourceContainerChange,
  writeMaterialSourceJournal,
} from '../server/material_source_journal_db';
import {
  type BoundedTransactionRunner,
  OFFLINE_CHARACTER_SAVE_STATEMENT_TIMEOUT_MS,
  runOfflineCharacterSave,
} from '../server/offline_character_save_db';
import { bagSlotsOf, stackSizeOf } from '../src/sim/bags';
import {
  BANK_BAG_SOCKETS,
  BANK_BASE_SLOTS,
  BANK_MAX_BONUS_SLOTS,
  BANK_PURCHASED_SLOTS_MAX,
} from '../src/sim/bank';
import type { CharacterState } from '../src/sim/character_state';
import { ITEMS } from '../src/sim/data';
import { GUILD_BANK_LADDER_POSITIONS } from '../src/sim/guild_bank';
import { materialItemIds } from '../src/sim/material_ids';
import {
  canonicalMaterialComposition,
  MAX_GATHERER_ID_LENGTH,
  type MaterialComposition,
  type MaterialSourceCount,
} from '../src/sim/material_sources';
import type { MaterialStackSlot } from '../src/sim/material_stack';
import {
  VAULT_BASE_CAP,
  VAULT_UPGRADE_PRICES,
  VAULT_UPGRADE_STEP,
} from '../src/sim/materials_vault';
import { MAX_CRAFTED_BY_LENGTH } from '../src/sim/professions/tools';
import { cloneInvSlot } from '../src/sim/types';
import { stripComments } from './helpers/strip_comments';

const bytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

/** One JSON line per measurement, so a run log carries the figures. */
function record(label: string, measurement: Record<string, unknown>): void {
  process.stdout.write(`[material-source-cost] ${JSON.stringify({ label, ...measurement })}\n`);
}

// ---------------------------------------------------------------------------
// The real caps. Every bound below is DERIVED from a production constant or the
// live content tables, never typed as a literal, so this fixture cannot keep
// measuring a shape the game no longer has.
// ---------------------------------------------------------------------------

const MATERIAL_IDS = [...materialItemIds()].sort();

/** The material with the largest legal stack, and that stack size. */
const widestMaterial = MATERIAL_IDS.reduce(
  (widest, itemId) => {
    const stack = stackSizeOf(ITEMS[itemId]);
    return stack > widest.stack ? { itemId, stack } : widest;
  },
  { itemId: MATERIAL_IDS[0] ?? 'copper_ore', stack: 0 },
);

/** Bank slot ceiling: base + the whole copper ladder + the entitlement bonus +
 *  every socket filled with the roomiest bag the item table defines. */
const WIDEST_BAG_SLOTS = Object.values(ITEMS).reduce(
  (widest, def) => Math.max(widest, bagSlotsOf(def)),
  0,
);
const BANK_SLOT_CEILING =
  BANK_BASE_SLOTS +
  BANK_PURCHASED_SLOTS_MAX +
  BANK_MAX_BONUS_SLOTS +
  BANK_BAG_SOCKETS * WIDEST_BAG_SLOTS;

/** Guild book slot ceiling: the last rung of the purchase ladder. */
const GUILD_SLOT_CEILING = GUILD_BANK_LADDER_POSITIONS[GUILD_BANK_LADDER_POSITIONS.length - 1] ?? 0;

/** Vault per-material ceiling: the unlock rung plus every widening rung. */
const VAULT_ITEM_CEILING = VAULT_BASE_CAP + (VAULT_UPGRADE_PRICES.length - 1) * VAULT_UPGRADE_STEP;

// ---------------------------------------------------------------------------
// Composition builders. The MAXIMAL shape is one bucket per unit (every unit
// from a different gatherer), which is what "no contributor cap" permits; the
// NORMAL shape is the row a real player carries.
// ---------------------------------------------------------------------------

/** A legal character-name snapshot at its maximum length (auth alphabet: ASCII,
 *  MAX_CRAFTED_BY_LENGTH characters). Both the gatherer NAME and the premium
 *  SIGNER are bounded by that same rule, so both are built at 16. */
const MAX_NAME = 'W'.repeat(MAX_CRAFTED_BY_LENGTH);
const MAX_SIGNER = 'S'.repeat(MAX_CRAFTED_BY_LENGTH);
/** characters.id is INT: 2,147,483,647 is the widest id a live row can carry,
 *  and every id below it is still ten digits. */
const MAX_CHARACTER_ID = 2_147_483_647;
/** A host-persisted offline/headless id at ITS bound. Kept SEPARATE from the
 *  online shapes below: nothing in the live game mints one, so it is a
 *  supplemental storage shape, never folded into the online worst case. */
const MAX_OFFLINE_ID = 'o'.repeat(MAX_GATHERER_ID_LENGTH);

/** The shapes a bucket can take, widest last. `premium` is the widest the
 *  algebra accepts (a gatherer AND the legacy premium signature); `online` is
 *  what the live gathering mint writes today. */
type BucketShape = 'online' | 'premium' | 'offline';

function bucketAt(shape: BucketShape, index: number): MaterialSourceCount {
  const id = MAX_CHARACTER_ID - index;
  switch (shape) {
    case 'online':
      return { source: { gatherer: { kind: 'character', id, name: MAX_NAME } }, count: 1 };
    case 'premium':
      return {
        source: { gatherer: { kind: 'character', id, name: MAX_NAME }, signer: MAX_SIGNER },
        count: 1,
      };
    case 'offline':
      return {
        source: { gatherer: { kind: 'offline', id: MAX_OFFLINE_ID, name: MAX_NAME } },
        count: 1,
      };
  }
}

/** One bucket per unit: what "no contributor cap" permits at the container's
 *  own unit ceiling. `offline` repeats one id, so it is a per-BUCKET byte probe
 *  rather than a container worst case. */
function maxComposition(units: number, shape: BucketShape = 'online'): MaterialComposition {
  const buckets: MaterialSourceCount[] = [];
  for (let i = 0; i < units; i++) buckets.push(bucketAt(shape, i));
  return buckets;
}

/** The representative row: a whole stack gathered by its owner. */
function normalComposition(units: number): MaterialComposition {
  return [{ source: { gatherer: { kind: 'character', id: 4242, name: 'Aeliana' } }, count: units }];
}

const maxSlot = (itemId: string, units: number): MaterialStackSlot => ({
  itemId,
  count: units,
  materialSources: maxComposition(units),
});
const premiumSlot = (itemId: string, units: number): MaterialStackSlot => ({
  itemId,
  count: units,
  materialSources: maxComposition(units, 'premium'),
});
const normalSlot = (itemId: string, units: number): MaterialStackSlot => ({
  itemId,
  count: units,
  materialSources: normalComposition(units),
});

/** `slots` copies of the same shape, spread across real material ids so the
 *  container is a plausible one rather than one id repeated. */
function fill(
  slots: number,
  units: number,
  build: (itemId: string, units: number) => MaterialStackSlot,
): MaterialStackSlot[] {
  return Array.from({ length: slots }, (_, index) =>
    build(MATERIAL_IDS[index % MATERIAL_IDS.length] ?? widestMaterial.itemId, units),
  );
}

describe('material source storage cost: the real caps', () => {
  it('derives its bounds from live constants rather than assuming a shape', () => {
    // Vacuity floor: an empty registry or a zero ceiling would make every
    // measurement below meaningless while still "passing".
    expect(MATERIAL_IDS.length).toBeGreaterThan(20);
    expect(widestMaterial.stack).toBeGreaterThan(0);
    expect(BANK_SLOT_CEILING).toBeGreaterThan(BANK_BASE_SLOTS);
    expect(GUILD_SLOT_CEILING).toBeGreaterThan(0);
    expect(VAULT_ITEM_CEILING).toBeGreaterThan(VAULT_BASE_CAP);

    record('caps', {
      materialIds: MATERIAL_IDS.length,
      widestMaterialStack: widestMaterial.stack,
      widestMaterialId: widestMaterial.itemId,
      bankSlotCeiling: BANK_SLOT_CEILING,
      guildSlotCeiling: GUILD_SLOT_CEILING,
      vaultItemCeiling: VAULT_ITEM_CEILING,
      maxGathererNameChars: MAX_CRAFTED_BY_LENGTH,
      maxGathererIdChars: MAX_GATHERER_ID_LENGTH,
    });
  });

  it('every bucket shape is VALID through the real algebra, at both unit ceilings', () => {
    // The whole P0 claim in one assertion: the shipped algebra accepts one
    // bucket per unit at BOTH real unit ceilings (a 20-unit bag/bank stack and
    // a 200-unit vault holding). Nothing folds, nothing caps. If a contributor
    // cap ever lands, this reds and the fixture must be re-based against the
    // new cap rather than deleted.
    for (const units of [widestMaterial.stack, VAULT_ITEM_CEILING]) {
      for (const shape of ['online', 'premium', 'offline'] as const) {
        const canonical = canonicalMaterialComposition(maxComposition(units, shape), units);
        expect(canonical.ok).toBe(true);
        if (canonical.ok && shape !== 'offline') {
          // The offline probe repeats one id, so the algebra coalesces it into
          // ONE bucket; that is correct and is why it is a byte probe only.
          expect(canonical.value).toHaveLength(units);
        }
      }
    }

    // And the save path's own clone preserves every bucket, so what is measured
    // below is what is persisted.
    const cloned = cloneInvSlot(premiumSlot(widestMaterial.itemId, widestMaterial.stack));
    expect(cloned.materialSources).toHaveLength(widestMaterial.stack);
    expect(cloned.materialSources).not.toBe(maxComposition(widestMaterial.stack, 'premium'));
  });

  it('records the marginal byte cost of provenance per slot, per bucket shape', () => {
    // TWO unit ceilings, because the containers differ: a bag or bank stack
    // caps at the item's stack size, a vault holding at the per-material
    // ceiling. Both are measured; neither is used for the other's container.
    const perBucket = (units: number, shape: BucketShape): number => {
      const bare: MaterialStackSlot = { itemId: widestMaterial.itemId, count: units };
      const loaded: MaterialStackSlot = {
        itemId: widestMaterial.itemId,
        count: units,
        materialSources: maxComposition(units, shape),
      };
      return Math.round((bytes(loaded) - bytes(bare)) / units);
    };

    const units = widestMaterial.stack;
    const bare: MaterialStackSlot = { itemId: widestMaterial.itemId, count: units };
    const normal = normalSlot(widestMaterial.itemId, units);
    const online = maxSlot(widestMaterial.itemId, units);
    const premium = premiumSlot(widestMaterial.itemId, units);

    const bareBytes = bytes(bare);
    const normalBytes = bytes(normal);
    const onlineBytes = bytes(online);
    const premiumBytes = bytes(premium);

    // Hard ordering: provenance only ever adds, one bucket per unit costs
    // strictly more than one bucket for the stack, and the premium shape (a
    // gatherer AND a signature) is strictly wider than the plain gatherer.
    expect(normalBytes).toBeGreaterThan(bareBytes);
    expect(onlineBytes).toBeGreaterThan(normalBytes);
    expect(premiumBytes).toBeGreaterThan(onlineBytes);

    record('slot-bytes', {
      stackUnits: units,
      vaultUnits: VAULT_ITEM_CEILING,
      bareBytes,
      normalBytes,
      onlineMaxBytes: onlineBytes,
      premiumMaxBytes: premiumBytes,
      normalOverheadBytes: normalBytes - bareBytes,
      premiumOverheadBytes: premiumBytes - bareBytes,
      bytesPerBucketOnline: perBucket(units, 'online'),
      bytesPerBucketPremium: perBucket(units, 'premium'),
      // Supplemental, NOT an online mint: a host-persisted offline/headless id
      // at its own 64-character bound.
      bytesPerBucketOfflineHypothetical: perBucket(units, 'offline'),
    });
  });

  it('records CONTAINERS-ONLY bank+vault bytes, at each container unit ceiling', () => {
    // The ceiling is PINNED, not raised: this fixture measures against the
    // number production actually uses today.
    expect(CHARACTER_BLOB_WARN_BYTES).toBe(163_840);

    // Per-container unit ceilings, which differ and must not be conflated:
    //   bank slot  -> the item's stack size (20 for every shipped material)
    //   vault item -> the per-material ceiling the ladder tops out at (200)
    const stackUnits = widestMaterial.stack;
    const vaultUnits = VAULT_ITEM_CEILING;
    // ONE vault row per material at the full per-material ceiling, and NO
    // compact stock beside it: the two stores share one ceiling, so a shape
    // holding 200 in `stock` AND 200 in `special` for the same id would be
    // illegal. Provenance can only ride `special`, so all-special IS the
    // worst case.
    const vaultRows = MATERIAL_IDS.length;
    const build = (shape: (itemId: string, units: number) => MaterialStackSlot) => ({
      bank: { inventory: fill(BANK_SLOT_CEILING, stackUnits, shape) },
      vault: { stock: {}, special: fill(vaultRows, vaultUnits, shape) },
    });

    const plain = (itemId: string, n: number): MaterialStackSlot => ({ itemId, count: n });
    const bare = build(plain);
    const normal = build(normalSlot);
    const online = build(maxSlot);
    const premium = build(premiumSlot);

    const bareBytes = bytes(bare);
    const normalBytes = bytes(normal);
    const onlineBytes = bytes(online);
    const premiumBytes = bytes(premium);
    // The pre-feature vault shape, for scale: the same holdings as a compact
    // count map, which cannot carry composition at all.
    const compactStockBytes = bytes({
      stock: Object.fromEntries(MATERIAL_IDS.map((id) => [id, vaultUnits])),
      special: [],
    });

    // The containers must still READ through the real adapter at this size: a
    // shape the pre-image reader refuses would make the byte figure fiction.
    const read = readCharacterMaterialContainers(premium.bank, premium.vault);
    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.personal).toHaveLength(BANK_SLOT_CEILING);
      expect(read.value.vault).toHaveLength(vaultRows);
    }

    expect(premiumBytes).toBeGreaterThan(onlineBytes);
    expect(onlineBytes).toBeGreaterThan(normalBytes);
    expect(normalBytes).toBeGreaterThan(bareBytes);

    // STRICTLY CONTAINERS ONLY. These figures are the bank plus the vault and
    // nothing else: no deedStats, quests, equipment, reliquary or loadouts, so
    // they are NOT a whole-character blob and must not be read as one, nor
    // compared pass/fail against a whole-character ceiling. The whole-character
    // baseline lives in tests/professions_blob_growth.test.ts (the 151,656-byte
    // Phase 18 arm), which this fixture does not rebuild and cannot substitute
    // for; the ceiling is reported beside these numbers only as the scale an
    // eventual whole-character re-measurement has to clear.
    record('container-only-bytes', {
      scope: 'bank+vault containers only, NOT a whole-character blob',
      wholeCharacterBaselineIncluded: false,
      wholeCharacterBaselineOwner: 'tests/professions_blob_growth.test.ts',
      bankSlots: BANK_SLOT_CEILING,
      bankUnitsPerSlot: stackUnits,
      vaultRows,
      vaultUnitsPerRow: vaultUnits,
      bareBytes,
      normalBytes,
      onlineMaxBytes: onlineBytes,
      premiumMaxBytes: premiumBytes,
      preFeatureCompactStockBytes: compactStockBytes,
      characterWarnCeilingBytes: CHARACTER_BLOB_WARN_BYTES,
    });
  });

  it('records maximal guild book payload bytes against the hard refusal bound', () => {
    // 262,144 is a HARD bound: a book past it is refused and quarantined
    // (server/guild_bank_state.ts sized()). Pinned, never raised here.
    expect(GUILD_BANK_MERGED_MAX_BYTES).toBe(262_144);

    const units = widestMaterial.stack;
    const book = (shape: (itemId: string, units: number) => MaterialStackSlot) => ({
      treasury: 0,
      purchasedSlots: GUILD_SLOT_CEILING,
      inventory: fill(GUILD_SLOT_CEILING, units, shape),
    });

    const bareBytes = bytes({
      treasury: 0,
      purchasedSlots: GUILD_SLOT_CEILING,
      inventory: fill(GUILD_SLOT_CEILING, units, (itemId, n) => ({ itemId, count: n })),
    });
    const normalBytes = bytes(book(normalSlot));
    const onlineBytes = bytes(book(maxSlot));
    const premiumBytes = bytes(book(premiumSlot));

    expect(premiumBytes).toBeGreaterThan(onlineBytes);
    expect(onlineBytes).toBeGreaterThan(normalBytes);
    expect(normalBytes).toBeGreaterThan(bareBytes);

    // Unlike the character containers above, a guild book row IS this whole
    // payload, so comparing it to the hard bound is a like-for-like comparison
    // rather than a partial one.
    record('guild-book-bytes', {
      scope: 'the whole guild_banks row payload, directly comparable to the bound',
      guildSlots: GUILD_SLOT_CEILING,
      unitsPerSlot: units,
      bareBytes,
      normalBytes,
      onlineMaxBytes: onlineBytes,
      premiumMaxBytes: premiumBytes,
      hardBoundBytes: GUILD_BANK_MERGED_MAX_BYTES,
      premiumOverHardBound: premiumBytes > GUILD_BANK_MERGED_MAX_BYTES,
      onlineOverHardBound: onlineBytes > GUILD_BANK_MERGED_MAX_BYTES,
      // Headroom at the widest legal shape, the operator-facing figure: a book
      // past the bound is refused and quarantined, never truncated.
      premiumHeadroomBytes: GUILD_BANK_MERGED_MAX_BYTES - premiumBytes,
      // How many maximal slots fit before the refusal.
      maximalSlotsBeforeRefusal: Math.floor(
        GUILD_BANK_MERGED_MAX_BYTES / Math.max(1, Math.round(premiumBytes / GUILD_SLOT_CEILING)),
      ),
    });
  });
});

// ---------------------------------------------------------------------------
// Journal SQL and parameter cost. The planner is the real one; only the wire is
// recorded.
// ---------------------------------------------------------------------------

interface RecordedQuery {
  readonly text: string;
  readonly values: readonly unknown[];
}

function recordingJournalClient(rows: (values: readonly unknown[]) => Record<string, unknown>[]) {
  const queries: RecordedQuery[] = [];
  return {
    queries,
    client: {
      query: async (text: string, values?: unknown[]) => {
        queries.push({ text, values: values ?? [] });
        const answered = rows(values ?? []);
        return { rows: answered, rowCount: answered.length };
      },
    },
  };
}

/** The rows the real journal statement returns, one per planned record. */
function journalRowsFor(values: readonly unknown[]): Record<string, unknown>[] {
  const records = JSON.parse(String(values[0] ?? '[]')) as {
    ord: number;
    realm: string;
    container: string;
    owner_id: number;
  }[];
  return records.map((r) => ({
    ord: r.ord,
    realm: r.realm,
    container: r.container,
    owner_id: String(r.owner_id),
    revision: '1',
  }));
}

describe('material source journal: statement and parameter cost', () => {
  const units = widestMaterial.stack;
  const container = (before: MaterialStackSlot[], after: MaterialStackSlot[]) =>
    [
      { realm: 'evidence', container: 'personal', ownerId: 1, before, after },
    ] as readonly MaterialSourceContainerChange[];

  // The BEHAVIOUR of both cases below is already pinned by
  // tests/material_source_journal_db.test.ts ("ignores containers that moved
  // nothing: no query, no anchor, no revision" and "increments an existing
  // revision without replacing the opening"). These cases exist for the
  // NUMBERS at the real container ceiling, which that suite does not measure;
  // each keeps only the structural assertion its measurement rests on.
  it('measures the parameter bytes a no-change container costs at the real cap', async () => {
    const slots = fill(BANK_SLOT_CEILING, units, normalSlot);
    // Same content, different objects: the real save always hands the journal a
    // fresh after-state, so an identity check would not be exercised.
    const after = slots.map((slot) => cloneInvSlot(slot));

    const rig = recordingJournalClient(journalRowsFor);
    const written = await writeMaterialSourceJournal(
      rig.client,
      container(slots, after),
      materialItemIds(),
    );
    expect(written.ok).toBe(true);
    expect(rig.queries).toHaveLength(0);

    // The SQL cost is zero; the CPU cost is not, and it is the reason this
    // case is measured rather than assumed. Both sides of both containers are
    // projected and diffed to reach that conclusion.
    record('no-change-cost', {
      containerSlots: BANK_SLOT_CEILING,
      unitsPerSlot: units,
      statements: rig.queries.length,
      parameterBytes: 0,
      projectedSlots: BANK_SLOT_CEILING * 2,
    });
  });

  it('measures the opening projection a moving container repeats every revision', async () => {
    const before = fill(BANK_SLOT_CEILING, units, normalSlot);
    // A REAL take: count and composition move together (a count-only change is
    // a malformed after-state the ledger core refuses).
    const after = before.map((slot, index) =>
      index === 0
        ? {
            ...cloneInvSlot(slot),
            count: slot.count - 1,
            materialSources: normalComposition(slot.count - 1),
          }
        : cloneInvSlot(slot),
    );

    const rig = recordingJournalClient(journalRowsFor);
    const written = await writeMaterialSourceJournal(
      rig.client,
      container(before, after),
      materialItemIds(),
    );
    expect(written.ok).toBe(true);
    expect(rig.queries).toHaveLength(1);

    const parameter = String(rig.queries[0]?.values[0] ?? '');
    const parsed = JSON.parse(parameter) as {
      opening: { entries: unknown[] };
      movements: unknown[];
    }[];
    expect(parsed).toHaveLength(1);

    // The premise of the measurement: the opening carries the WHOLE container
    // although one stack moved, and the statement's ON CONFLICT arm discards it
    // whenever the anchor already exists.
    const record0 = parsed[0];
    expect(record0?.opening.entries.length).toBeGreaterThan(1);
    expect(record0?.movements).toHaveLength(1);
    expect(rig.queries[0]?.text).toContain('ON CONFLICT (realm, container, owner_id) DO UPDATE');

    const openingBytes = Buffer.byteLength(JSON.stringify(record0?.opening), 'utf8');
    record('journal-parameter-bytes', {
      containerSlots: BANK_SLOT_CEILING,
      unitsPerSlot: units,
      movedStacks: 1,
      parameterBytes: Buffer.byteLength(parameter, 'utf8'),
      openingBytes,
      movementBytes: Buffer.byteLength(JSON.stringify(record0?.movements), 'utf8'),
      // Repeated on EVERY later revision of an existing anchor.
      openingShareOfParameter: openingBytes / Buffer.byteLength(parameter, 'utf8'),
    });
  });

  it('the maximal composition survives one journal round trip at BOTH unit caps', async () => {
    // Once at a bank stack's ceiling and once at a vault holding's, since the
    // two differ by an order of magnitude and the vault one is the real worst
    // case for this parameter.
    for (const [kind, capUnits] of [
      ['personal', widestMaterial.stack],
      ['vault', VAULT_ITEM_CEILING],
    ] as const) {
      const before = fill(1, capUnits, premiumSlot);
      // A REAL take: drop the last bucket so the after-state stays canonical at
      // its own count.
      const kept = (before[0]?.materialSources ?? []).slice(0, capUnits - 1);
      const after: MaterialStackSlot[] = [
        {
          ...cloneInvSlot(before[0] as MaterialStackSlot),
          count: capUnits - 1,
          materialSources: kept,
        },
      ];

      const rig = recordingJournalClient(journalRowsFor);
      const written = await writeMaterialSourceJournal(
        rig.client,
        [{ realm: 'evidence', container: kind, ownerId: 1, before, after }],
        materialItemIds(),
      );
      expect(written.ok).toBe(true);
      expect(rig.queries).toHaveLength(1);

      const parameter = String(rig.queries[0]?.values[0] ?? '');
      record('journal-parameter-bytes-maximal', {
        container: kind,
        containerSlots: 1,
        unitsPerSlot: capUnits,
        bucketShape: 'premium (gatherer + signer), the widest the algebra accepts',
        parameterBytes: Buffer.byteLength(parameter, 'utf8'),
      });
    }
  });
});

// ---------------------------------------------------------------------------
// Real statement counts. Both paths below run production code end to end; the
// only substitution is the client that records instead of talking to Postgres.
// ---------------------------------------------------------------------------

function preimageRow(before: unknown, vault: unknown): Record<string, unknown> {
  return { before_bank: before, before_vault: vault };
}

const journalStatementsIn = (queries: readonly RecordedQuery[]): number =>
  queries.filter((q) => q.text.includes('material_source_journal')).length;

const characterStateWith = (slots: MaterialStackSlot[]): CharacterState =>
  ({
    inventory: [],
    equipment: {},
    questLog: [],
    questsDone: [],
    bank: { inventory: slots },
    vault: { stock: {}, special: [] },
  }) as unknown as CharacterState;

interface ArmMeasurement {
  readonly statements: number;
  readonly journalStatements: number;
  readonly sequence: readonly string[];
}

/**
 * Drive the REAL `saveCharacterStateOnClient` (the arm both marketplace escrow
 * transactions call) with a recording client, once with a container that moved
 * and once with one that did not. Shared by the statement-count case and the
 * ladder case so the ladder reads a MEASURED number rather than an assumed one.
 */
async function measureEscrowSaveArm(): Promise<{
  unchanged: ArmMeasurement;
  moved: ArmMeasurement;
}> {
  // Dynamic import: server/db builds its pool at module init, so it is reached
  // only from inside a test, the tunables-suite idiom.
  const db = await import('../server/db');
  const units = widestMaterial.stack;
  const before = fill(4, units, normalSlot);
  const after = before.map((slot, index) =>
    index === 0
      ? {
          ...cloneInvSlot(slot),
          count: slot.count - 1,
          materialSources: normalComposition(slot.count - 1),
        }
      : cloneInvSlot(slot),
  );

  const run = async (next: MaterialStackSlot[]): Promise<ArmMeasurement> => {
    const queries: RecordedQuery[] = [];
    const client = {
      query: async (text: string, values?: unknown[]) => {
        queries.push({ text, values: values ?? [] });
        if (text.includes('material_source_journal')) {
          const rows = journalRowsFor(values ?? []);
          return { rows, rowCount: rows.length };
        }
        // The single-statement pre-image form returns the locked image with
        // the updated row.
        return { rows: [preimageRow({ inventory: before }, null)], rowCount: 1 };
      },
    };
    const landed = await db.saveCharacterStateOnClient(
      client as unknown as PoolClient,
      1,
      60,
      characterStateWith(next),
    );
    expect(landed).toBe(true);
    return {
      statements: queries.length,
      journalStatements: journalStatementsIn(queries),
      sequence: queries.map((q) => q.text.split('\n')[0]?.trim().slice(0, 48) ?? ''),
    };
  };

  return {
    unchanged: await run(before.map((slot) => cloneInvSlot(slot))),
    moved: await run(after),
  };
}

/** The body of one named method, brace-matched out of comment-stripped source.
 *  Template literals in these bodies are brace-balanced, so a counter is safe. */
function methodBody(source: string, marker: string): string {
  const at = source.indexOf(marker);
  if (at < 0) return '';
  // Methods with a Promise union have object-literal braces in their return
  // type before the method body. Find the body opener by its first statement,
  // then brace-match from there. This keeps the source count tied to the
  // actual method boundary rather than accidentally counting a type arm.
  const rest = source.slice(at);
  const statement = rest.search(/\{\s*(?:try|return\s+this\.withTx)\b/);
  if (statement < 0) return '';
  const bodyOpen = at + statement;
  let depth = 0;
  let opened = false;
  for (let i = bodyOpen; i < source.length; i++) {
    const ch = source[i];
    if (ch === '{') {
      depth++;
      opened = true;
    } else if (ch === '}') {
      depth--;
      if (opened && depth === 0) return source.slice(at, i + 1);
    }
  }
  return '';
}

const countOf = (body: string, needle: RegExp): number => (body.match(needle) ?? []).length;

describe('material source save paths: measured statement counts', () => {
  const units = widestMaterial.stack;

  it('the offline save path issues its real statement sequence, journal included', async () => {
    const before = fill(4, units, normalSlot);
    // A REAL take: the count and its composition move together, or the after
    // state is malformed and the ledger core refuses the whole container.
    const moved = before.map((slot, index) =>
      index === 0
        ? {
            ...cloneInvSlot(slot),
            count: slot.count - 1,
            materialSources: normalComposition(slot.count - 1),
          }
        : cloneInvSlot(slot),
    );

    const run = async (after: MaterialStackSlot[]) => {
      const queries: RecordedQuery[] = [];
      const runner: BoundedTransactionRunner = async (timeoutMs, fn) => {
        // The production allowance reaches the runner; nothing here re-tunes it.
        expect(timeoutMs).toBe(OFFLINE_CHARACTER_SAVE_STATEMENT_TIMEOUT_MS);
        return fn(async (text: string, values?: unknown[]) => {
          queries.push({ text, values: values ?? [] });
          const isLock = text.includes('FOR UPDATE');
          const isJournal = text.includes('material_source_journal');
          const rows = isLock
            ? [preimageRow({ inventory: before }, null)]
            : isJournal
              ? journalRowsFor(values ?? [])
              : [];
          return { rows, rowCount: isLock || rows.length === 0 ? 1 : rows.length } as QueryResult;
        });
      };
      // The real writer, the real statement builder, the real journal.
      const landed = await runOfflineCharacterSave(runner, 1, 60, characterStateWith(after));
      return { landed, queries };
    };

    const unchanged = await run(before.map((slot) => cloneInvSlot(slot)));
    const changed = await run(moved);

    expect(unchanged.landed).toBe(true);
    expect(changed.landed).toBe(true);

    // The measured fact: a save that moved material issues exactly one MORE
    // statement than one that did not.
    expect(journalStatementsIn(unchanged.queries)).toBe(0);
    expect(journalStatementsIn(changed.queries)).toBe(1);
    expect(changed.queries).toHaveLength(unchanged.queries.length + 1);

    record('offline-save-statements', {
      unchanged: unchanged.queries.length,
      moved: changed.queries.length,
      journalStatements: journalStatementsIn(changed.queries),
      sequence: changed.queries.map((q) => q.text.split('\n')[0]?.trim().slice(0, 48)),
    });
  });

  it('the caller-owned escrow save issues its journal statement inside the priced transaction', async () => {
    const arm = await measureEscrowSaveArm();
    expect(arm.unchanged.journalStatements).toBe(0);
    expect(arm.moved.journalStatements).toBe(1);
    expect(arm.moved.statements).toBe(arm.unchanged.statements + 1);

    record('escrow-save-statements', {
      unchanged: arm.unchanged.statements,
      moved: arm.moved.statements,
      journalStatements: arm.moved.journalStatements,
      sequence: arm.moved.sequence,
    });
  });
});

// ---------------------------------------------------------------------------
// The escrow timeout ladder, measured against the statement count that path
// really issues. Nothing here re-tunes a bound; the constants are pinned to
// their current literals so a silent re-tune reds this fixture, and the
// discrepancy is recorded as a measured result.
// ---------------------------------------------------------------------------

describe('escrow workload ladder vs the measured statement count', () => {
  it('pins the ladder inputs and records the journal statement it does not count', async () => {
    const { DB_HEAVY_STATEMENT_TIMEOUT_MS, DB_POOL_CONNECT_TIMEOUT_MS } = await import(
      '../server/db'
    );
    const {
      ESCROW_DIRECTED_BASE_WORKLOAD_STATEMENTS,
      ESCROW_LEDGER_STORAGE_WORKLOAD_STATEMENTS,
      ESCROW_LEDGER_WORKLOAD_STATEMENTS,
      ESCROW_LOCK_TIMEOUT_MS,
      ESCROW_STATEMENT_TIMEOUT_MS,
    } = await import('../server/woc_market_db');

    // Pinned literals, not self-comparisons: a re-tune must come here and be
    // re-measured rather than silently absorbed.
    expect(ESCROW_STATEMENT_TIMEOUT_MS).toBe(4_000);
    expect(ESCROW_LOCK_TIMEOUT_MS).toBe(2_000);
    expect(DB_POOL_CONNECT_TIMEOUT_MS).toBe(5_000);
    expect(ESCROW_DIRECTED_BASE_WORKLOAD_STATEMENTS).toBe(5);
    expect(ESCROW_LEDGER_WORKLOAD_STATEMENTS).toBe(6);
    expect(ESCROW_LEDGER_STORAGE_WORKLOAD_STATEMENTS).toBe(12);

    // AUTOSAVE_SECONDS is module-private in game.ts; scrape it through the
    // shared block-aware stripper, the tunables-suite idiom, so a re-tuned
    // cadence moves this relation instead of leaving a stale literal.
    const fs = await import('node:fs');
    const path = await import('node:path');
    const gameSource = stripComments(
      fs.readFileSync(path.join(process.cwd(), 'server/game.ts'), 'utf8'),
    );
    const autosaveMatch = gameSource.match(/^const AUTOSAVE_SECONDS = (\d+);$/m);
    expect(autosaveMatch).not.toBeNull();
    const autosaveMs = Number(autosaveMatch?.[1]) * 1000;
    expect(autosaveMs).toBeGreaterThan(0);

    const ceiling = (statements: number): number =>
      ESCROW_STATEMENT_TIMEOUT_MS * statements +
      ESCROW_LOCK_TIMEOUT_MS +
      DB_POOL_CONNECT_TIMEOUT_MS;

    // The MEASURED half: the real save arm, driven with a recording client.
    const arm = await measureEscrowSaveArm();

    // The SOURCE-COUNTED half: the rest of the transaction. escrowInsertListing
    // is a method on a class whose withTx needs a pool, so its whole body is
    // not drivable here; its query CALL SITES are counted out of the real
    // source instead. That is a count of the shipped code, not a formula, and
    // it is labelled as source-counted wherever it is reported.
    const marketSource = stripComments(
      fs.readFileSync(path.join(process.cwd(), 'server/woc_market_db.ts'), 'utf8'),
    );
    const escrowBody = methodBody(marketSource, 'async escrowInsertListing(');
    expect(escrowBody.length).toBeGreaterThan(0);

    const directQueries = countOf(escrowBody, /client\.query\(/g);
    // The three SET LOCALs are protocol statements with no locks, IO or
    // planning; the ladder's own docblock excludes them from its sum, so this
    // count follows that exclusion rather than inventing a different one.
    const setLocals = countOf(escrowBody, /SET LOCAL /g);
    // One statement each, verified at their definitions.
    const accountLockCalls = countOf(escrowBody, /lockCharacterSaveAccountParentOnClient\(/g);
    const saveArmCalls = countOf(escrowBody, /saveCharacterStateOnClient\(/g);

    // ONE character per escrow transaction. The delivered buyer save is a
    // separate transaction with the heavy character-save timeout, so it is not
    // folded into this escrow four-second workload ladder.
    expect(saveArmCalls).toBe(1);
    const marketSaveArmCallSites = countOf(marketSource, /saveCharacterStateOnClient\(/g);
    expect(marketSaveArmCallSites).toBe(2);
    const deliveredBody = methodBody(marketSource, 'async saveDeliveredCharacterBooked(');
    expect(deliveredBody.length).toBeGreaterThan(0);
    expect(escrowBody).toContain('ESCROW_STATEMENT_TIMEOUT_MS');
    expect(deliveredBody).toContain('DB_HEAVY_STATEMENT_TIMEOUT_MS');
    expect(deliveredBody).not.toContain('ESCROW_STATEMENT_TIMEOUT_MS');

    const workload = (armStatements: number): number =>
      directQueries - setLocals + accountLockCalls + armStatements;
    const observedBaseNoMovement = workload(arm.unchanged.statements);
    const observedBaseWithMovement = workload(arm.moved.statements);

    record('escrow-ladder', {
      autosaveMs,
      deliveredSaveStatementTimeoutMs: DB_HEAVY_STATEMENT_TIMEOUT_MS,
      pinnedBaseStatements: ESCROW_DIRECTED_BASE_WORKLOAD_STATEMENTS,
      // Source-counted transaction body plus the measured save arm.
      sourceCountedDirectQueries: directQueries,
      sourceCountedSetLocals: setLocals,
      sourceCountedAccountLockStatements: accountLockCalls,
      measuredSaveArmStatementsNoMovement: arm.unchanged.statements,
      measuredSaveArmStatementsWithMovement: arm.moved.statements,
      observedBaseStatementsNoMovement: observedBaseNoMovement,
      observedBaseStatementsWithMovement: observedBaseWithMovement,
      pinnedBaseCeilingMs: ceiling(ESCROW_DIRECTED_BASE_WORKLOAD_STATEMENTS),
      observedBaseCeilingMsNoMovement: ceiling(observedBaseNoMovement),
      observedBaseCeilingMsWithMovement: ceiling(observedBaseWithMovement),
      pinnedLedgerCeilingMs: ceiling(ESCROW_LEDGER_WORKLOAD_STATEMENTS),
      pinnedMaxCeilingMs: ceiling(ESCROW_LEDGER_STORAGE_WORKLOAD_STATEMENTS),
      pinnedBaseUnderAutosave: ceiling(ESCROW_DIRECTED_BASE_WORKLOAD_STATEMENTS) < autosaveMs,
      observedBaseUnderAutosaveWithMovement: ceiling(observedBaseWithMovement) < autosaveMs,
      // A directed trade spans two transactions with DIFFERENT budgets: this
      // ladder prices the escrow listing, while delivery uses the heavy save
      // timeout recorded above.
      escrowSaveArmCallSitesInFile: marketSaveArmCallSites,
      charactersSavedPerTransaction: saveArmCalls,
      deliveredSaveUsesHeavyBudget: true,
      // Per-statement lock and connect terms are counted ONCE per transaction
      // by this ladder's own formula. Whether that is the right accounting is a
      // review question, deliberately not re-tuned here.
      lockAndConnectTermsCountedOnce: true,
    });

    // The two facts this fixture is entitled to assert. First: with no movement
    // the source-counted body agrees with the pinned figure, so the count is
    // reading the same transaction the ladder prices.
    expect(observedBaseNoMovement).toBe(ESCROW_DIRECTED_BASE_WORKLOAD_STATEMENTS);
    // Second: a material-moving save issues strictly more than the pinned
    // figure. This is NOT an acceptance of the resulting ceiling; the ladder
    // relation stays owned by tests/server/tunables.test.ts.
    expect(observedBaseWithMovement).toBeGreaterThan(ESCROW_DIRECTED_BASE_WORKLOAD_STATEMENTS);
  });
});
