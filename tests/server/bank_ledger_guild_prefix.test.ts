import { describe, expect, it } from 'vitest';
import {
  consumeCommittedGuildLedgerPrefix,
  guildLedgerIdsForOps,
  guildLedgerPrefixCounts,
  ledgerProjectionSurface,
  visitGuildLedgerIdsForOps,
} from '../../server/bank_ledger_guild_prefix';
import type {
  PreparedBankLedgerCommandBatch,
  SerializedBankLedgerGuildDelta,
  SerializedBankLedgerGuildEffect,
  SerializedBankLedgerOutboxRow,
} from '../../server/bank_ledger_outbox';
import type { GuildBankOpDelta } from '../../src/sim/guild_bank';

function liveDelta(overrides: Partial<GuildBankOpDelta> = {}): GuildBankOpDelta {
  return {
    op: 'deposit',
    itemId: 'copper_ore',
    count: 2,
    instance: null,
    craftedRecipeId: null,
    copperDelta: 0,
    purchasedSlotsBefore: 0,
    purchasedSlotsAfter: 0,
    ...overrides,
  };
}

/**
 * The durable sidecar a live delta serializes to, normalized the way the real
 * serializer normalizes: the payload detaches to JSON, the crafted marker
 * normalizes to null, and the source legs are OMITTED whenever the live delta
 * carries none.
 *
 * The omission is the compatibility contract, not tidiness. `JSON.stringify`
 * drops an absent key and emits `"materialSources":null` for a present one, so
 * a fixture that spread a null through would model receipt bytes no durable row
 * has: every guild receipt written before the legs existed would stop hashing to
 * its stored payload, and a restart's retry of one would no longer be an
 * idempotent retry. It also happens to be what the type says, since the durable
 * side admits no null there.
 */
function durableDelta(delta: GuildBankOpDelta): SerializedBankLedgerGuildDelta {
  const { instance, craftedRecipeId, materialSources, ...fields } = delta;
  return {
    ...fields,
    instanceJson: instance == null ? null : JSON.stringify(instance),
    craftedRecipeId: craftedRecipeId ?? null,
    ...(materialSources == null ? {} : { materialSources }),
  };
}

function serializedRow(
  container: SerializedBankLedgerOutboxRow['container'],
  overrides: Partial<SerializedBankLedgerOutboxRow> = {},
): SerializedBankLedgerOutboxRow {
  return {
    realm: 'Azeroth',
    characterId: 101,
    accountId: 202,
    op: 'deposit',
    itemId: 'copper_ore',
    count: 2,
    instanceJson: null,
    copperDelta: 0,
    purchasedSlotsAfter: 0,
    container,
    containerId: container === 'guild' ? 7 : null,
    counterpartyCopperDelta: null,
    counterpartyCount: null,
    ...overrides,
  };
}

function preparedBatch(
  key: string,
  rows: readonly SerializedBankLedgerOutboxRow[],
  guildEffect: SerializedBankLedgerGuildEffect | null = null,
): PreparedBankLedgerCommandBatch {
  const guildIds = [
    ...new Set(rows.flatMap((row) => (row.containerId === null ? [] : [row.containerId]))),
  ].sort((a, b) => a - b);
  return {
    batchKey: key,
    rows,
    encodedBytes: 1,
    guildEffect,
    guildIds,
    hasUnscopedRows: rows.some((row) => row.container !== 'guild'),
  };
}

function guildBatch(
  key: string,
  guildId: number,
  deltas: readonly SerializedBankLedgerGuildDelta[],
): PreparedBankLedgerCommandBatch {
  return preparedBatch(
    key,
    deltas.map((delta) =>
      serializedRow('guild', {
        op: delta.op,
        itemId: delta.itemId,
        count: delta.count,
        instanceJson: delta.instanceJson,
        copperDelta: delta.copperDelta,
        purchasedSlotsAfter: delta.purchasedSlotsAfter,
        containerId: guildId,
      }),
    ),
    { guildId, deltas },
  );
}

describe('bank ledger projection surface', () => {
  it('prioritizes guild over vault over personal regardless of row order', () => {
    const personal = preparedBatch('personal', [serializedRow('personal')]);
    const vault = preparedBatch('vault', [serializedRow('vault')]);
    const guild = preparedBatch('guild', [serializedRow('guild')]);

    expect(ledgerProjectionSurface({ batches: [] })).toBe('personal');
    expect(ledgerProjectionSurface({ batches: [personal] })).toBe('personal');
    expect(ledgerProjectionSurface({ batches: [personal, vault] })).toBe('vault');
    expect(ledgerProjectionSurface({ batches: [vault, personal] })).toBe('vault');
    expect(ledgerProjectionSurface({ batches: [vault, guild] })).toBe('guild');
    expect(ledgerProjectionSurface({ batches: [guild, vault] })).toBe('guild');
  });

  it('selects unique guilds only for the supplied visible operation allowlist', () => {
    const batches = [
      preparedBatch('mixed', [
        serializedRow('guild', { containerId: 9, op: 'counterparty_orphan' }),
        serializedRow('guild', { containerId: 7, op: 'deposit' }),
        serializedRow('personal', { containerId: null, op: 'deposit' }),
        serializedRow('guild', { containerId: 7, op: 'withdraw' }),
      ]),
      preparedBatch('fee', [serializedRow('guild', { containerId: 11, op: 'create_fee' })]),
    ];

    expect(guildLedgerIdsForOps(batches, ['deposit', 'withdraw', 'create_fee'])).toEqual([7, 11]);
    expect(guildLedgerIdsForOps(batches, ['counterparty_orphan'])).toEqual([9]);
    expect(guildLedgerIdsForOps(batches, [])).toEqual([]);

    const visited: number[] = [];
    visitGuildLedgerIdsForOps(batches, ['deposit', 'withdraw', 'create_fee'], (guildId) =>
      visited.push(guildId),
    );
    expect(visited).toEqual([7, 11]);
  });
});

describe('guild ledger prefix verification', () => {
  it('uses ordered cumulative offsets independently for every guild', () => {
    const sevenOne = liveDelta({
      itemId: 'signed_blade',
      count: 1,
      instance: { signer: 'Ana', charges: { sharpen: 2 } },
      craftedRecipeId: 'recipe_signed_blade',
    });
    const sevenTwo = liveDelta({ op: 'deposit_gold', itemId: null, count: null, copperDelta: 125 });
    const sevenThree = liveDelta({
      op: 'buy_slots',
      itemId: null,
      count: null,
      purchasedSlotsBefore: 6,
      purchasedSlotsAfter: 12,
    });
    const eightOne = liveDelta({
      op: 'withdraw',
      itemId: 'linen_cloth',
      count: -3,
      craftedRecipeId: undefined,
    });
    const source = {
      unflushedGuildBankOps: new Map([
        [7, [sevenOne, sevenTwo, sevenThree]],
        [8, [eightOne]],
      ]),
    };
    const batches = [
      guildBatch('seven.first', 7, [durableDelta(sevenOne)]),
      preparedBatch('personal.middle', [serializedRow('personal')]),
      guildBatch('eight.first', 8, [durableDelta(eightOne)]),
      guildBatch('seven.rest', 7, [durableDelta(sevenTwo), durableDelta(sevenThree)]),
    ];

    expect(guildLedgerPrefixCounts(source, batches)).toEqual(
      new Map([
        [7, 3],
        [8, 1],
      ]),
    );
  });

  it('requires every live and durable delta field to match exactly', () => {
    const live = liveDelta({
      instance: { signer: 'Ana', charges: { sharpen: 2 } },
      craftedRecipeId: 'recipe_copper_ore',
      copperDelta: 17,
      purchasedSlotsBefore: 6,
      purchasedSlotsAfter: 12,
    });
    const exact = durableDelta(live);
    const source = { unflushedGuildBankOps: new Map([[7, [live]]]) };

    expect(guildLedgerPrefixCounts(source, [guildBatch('exact', 7, [exact])])).toEqual(
      new Map([[7, 1]]),
    );

    const mismatches: readonly [string, SerializedBankLedgerGuildDelta][] = [
      ['op', { ...exact, op: 'withdraw' }],
      ['item', { ...exact, itemId: 'tin_ore' }],
      ['count', { ...exact, count: 3 }],
      ['instance JSON', { ...exact, instanceJson: '{"charges":{"sharpen":2},"signer":"Ana"}' }],
      ['crafted recipe', { ...exact, craftedRecipeId: 'recipe_tin_ore' }],
      ['copper', { ...exact, copperDelta: 18 }],
      ['slots before', { ...exact, purchasedSlotsBefore: 5 }],
      ['slots after', { ...exact, purchasedSlotsAfter: 13 }],
    ];
    for (const [field, mismatch] of mismatches) {
      expect(
        guildLedgerPrefixCounts(source, [
          guildBatch(`mismatch.${field.replace(' ', '_')}`, 7, [mismatch]),
        ]),
        field,
      ).toBeNull();
    }
  });

  it('is INDIFFERENT to the effect actorAccountId: attribution never gates replay', () => {
    // The operator attribution (PR #3670) rides the durable effect for the
    // OWNER CHECK (bankLedgerBatchMatchesOwner); the fenced carrier applies
    // the book delta regardless of who ordered it, so the prefix match must
    // neither require nor compare it.
    const live = liveDelta({ op: 'admin_purge' });
    const source = { unflushedGuildBankOps: new Map([[7, [live]]]) };
    const durable = durableDelta(live);
    const attributed = {
      ...guildBatch('purge.attributed', 7, [durable]),
      guildEffect: { guildId: 7, deltas: [durable], actorAccountId: 909 },
    };
    expect(guildLedgerPrefixCounts(source, [attributed])).toEqual(new Map([[7, 1]]));
    expect(guildLedgerPrefixCounts(source, [guildBatch('purge.bare', 7, [durable])])).toEqual(
      new Map([[7, 1]]),
    );
  });

  it('matches on the SOURCE LEGS too, and refuses a sidecar that lost them', () => {
    // The prefix splice retires a command by declaring its durable receipt
    // equivalent. A live delta whose legs the durable sidecar does not carry is
    // NOT that command: splicing it would retire an op whose exact provenance
    // never committed, so the audit would open on stock nothing recorded.
    const legs = [
      { source: { gatherer: { kind: 'character', id: 7, name: 'Mara' } }, count: 1 },
      { source: {}, count: 1 },
    ] as const;
    const live = liveDelta({ materialSources: legs });
    const source = { unflushedGuildBankOps: new Map([[7, [live]]]) };

    const carried = durableDelta(live);
    expect(carried.materialSources).toEqual(legs);
    expect(guildLedgerPrefixCounts(source, [guildBatch('legs.exact', 7, [carried])])).toEqual(
      new Map([[7, 1]]),
    );

    // The SAME legs observed in the other order still match: both sides go
    // through the one canonical adapter, which orders by descriptor key.
    const reordered = { ...carried, materialSources: [legs[1], legs[0]] };
    expect(guildLedgerPrefixCounts(source, [guildBatch('legs.reordered', 7, [reordered])])).toEqual(
      new Map([[7, 1]]),
    );

    // A sidecar that lost the legs, or carries different ones, is refused. The
    // lost one is the SAME command as written by a binary that recorded no
    // legs: every other field matches, which is what makes the refusal decisive.
    const lost = durableDelta(liveDelta());
    expect(lost).toEqual({ ...carried, materialSources: undefined });
    expect(guildLedgerPrefixCounts(source, [guildBatch('legs.lost', 7, [lost])])).toBeNull();
    expect(
      guildLedgerPrefixCounts(source, [
        guildBatch('legs.other', 7, [{ ...carried, materialSources: [{ source: {}, count: 2 }] }]),
      ]),
    ).toBeNull();
  });

  it('OMITS the legs key for a legacy delta, so old receipt bytes are unchanged', () => {
    // Absent, never null: a durable row written before the legs existed carries
    // no such key, and its retry must still hash to the payload it stored.
    const live = liveDelta();
    const durable = durableDelta(live);
    expect('materialSources' in durable).toBe(false);
    expect(JSON.stringify(durable)).not.toContain('materialSources');
    const absentSource = { unflushedGuildBankOps: new Map([[7, [live]]]) };
    const absentBatch = guildBatch('legacy.absent', 7, [durable]);
    expect(guildLedgerPrefixCounts(absentSource, [absentBatch])).toEqual(new Map([[7, 1]]));
    // A live delta that spells its absence as null is the same legacy delta,
    // and still matches that same key-less receipt.
    const explicitNull = liveDelta({ materialSources: null });
    expect(durableDelta(explicitNull)).toEqual(durable);
    const nullSource = { unflushedGuildBankOps: new Map([[7, [explicitNull]]]) };
    const nullBatch = guildBatch('legacy.null', 7, [durable]);
    expect(guildLedgerPrefixCounts(nullSource, [nullBatch])).toEqual(new Map([[7, 1]]));
  });

  it('normalizes an omitted live crafted recipe only to durable null', () => {
    const live = liveDelta({ craftedRecipeId: undefined });
    const source = { unflushedGuildBankOps: new Map([[7, [live]]]) };
    const durable = durableDelta(live);

    expect(durable.craftedRecipeId).toBeNull();
    expect(guildLedgerPrefixCounts(source, [guildBatch('null.recipe', 7, [durable])])).toEqual(
      new Map([[7, 1]]),
    );
    expect(
      guildLedgerPrefixCounts(source, [
        guildBatch('non-null.recipe', 7, [{ ...durable, craftedRecipeId: '' }]),
      ]),
    ).toBeNull();
  });

  it('returns null for a missing, short, or out-of-order live prefix', () => {
    const first = liveDelta({ itemId: 'copper_ore' });
    const second = liveDelta({ itemId: 'tin_ore' });
    const oneBatch = guildBatch('first', 7, [durableDelta(first)]);
    const twoBatch = guildBatch('two', 7, [durableDelta(first), durableDelta(second)]);

    expect(guildLedgerPrefixCounts({ unflushedGuildBankOps: new Map() }, [oneBatch])).toBeNull();
    expect(
      guildLedgerPrefixCounts({ unflushedGuildBankOps: new Map([[7, [first]]]) }, [twoBatch]),
    ).toBeNull();
    expect(
      guildLedgerPrefixCounts({ unflushedGuildBankOps: new Map([[7, [second, first]]]) }, [
        oneBatch,
      ]),
    ).toBeNull();
  });

  it('returns an empty count map when no batch carries a guild sidecar', () => {
    const personal = preparedBatch('personal.only', [serializedRow('personal')]);
    expect(guildLedgerPrefixCounts({ unflushedGuildBankOps: new Map() }, [personal])).toEqual(
      new Map(),
    );
  });
});

describe('committed guild ledger prefix consumption', () => {
  it('splices partial prefixes and clears dirty sidecars only when a log becomes empty', () => {
    const one = liveDelta({ itemId: 'copper_ore' });
    const two = liveDelta({ itemId: 'tin_ore' });
    const three = liveDelta({ itemId: 'silver_ore' });
    const state = {
      unflushedGuildBankOps: new Map<number, GuildBankOpDelta[]>([
        [7, [one, two, three]],
        [8, [one]],
        [9, []],
      ]),
      dirtyGuildBanks: new Map([
        [7, 70],
        [8, 80],
        [9, 90],
        [10, 100],
        [11, 110],
      ]),
      guildBankDeficitSkips: new Map([
        [7, 1],
        [8, 2],
        [9, 3],
        [10, 4],
        [11, 5],
      ]),
    };

    consumeCommittedGuildLedgerPrefix(
      state,
      new Map([
        [7, 2],
        [8, 1],
        [9, 0],
        [11, 1],
      ]),
    );

    expect(state.unflushedGuildBankOps).toEqual(new Map([[7, [three]]]));
    expect(state.dirtyGuildBanks).toEqual(
      new Map([
        [7, 70],
        [10, 100],
        [11, 110],
      ]),
    );
    expect(state.guildBankDeficitSkips).toEqual(
      new Map([
        [7, 1],
        [10, 4],
        [11, 5],
      ]),
    );
  });
});
