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

function durableDelta(delta: GuildBankOpDelta): SerializedBankLedgerGuildDelta {
  const { instance, craftedRecipeId, ...fields } = delta;
  return {
    ...fields,
    instanceJson: instance == null ? null : JSON.stringify(instance),
    craftedRecipeId: craftedRecipeId ?? null,
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
