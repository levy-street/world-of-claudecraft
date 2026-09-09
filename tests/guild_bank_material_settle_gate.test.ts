import { describe, expect, it } from 'vitest';
import {
  contributesTo,
  guildBankUnsettledRefusal,
  holderContribution,
  unsettledGuildBook,
} from '../server/guild_bank_settle_gate';
import type { GuildBankOpDelta } from '../src/sim/guild_bank';
import type { MaterialSourceTransferSelection } from '../src/sim/material_source_transfer_selection';
import type { MaterialSource } from '../src/sim/material_sources';
import { captureMaterialStackSelection } from '../src/sim/material_stack_selection';
import type { InvSlot } from '../src/sim/types';
import type { GuildBankInfo } from '../src/world_api';

const ore = 'copper_ore';
const fresh: MaterialSource = { gatherer: { kind: 'character', id: 42, name: 'Officer' } };
const slots: InvSlot[] = [
  {
    itemId: ore,
    count: 10,
    materialSources: [
      { source: {}, count: 5 },
      { source: fresh, count: 5 },
    ],
  },
];
const book = (inventory = slots): GuildBankInfo => ({
  slots: inventory,
  treasury: 0,
  capacity: 24,
  purchasedSlots: 24,
  nextExpansionPrice: 50_000,
  canEdit: true,
});
const deposit = (count = 5): GuildBankOpDelta => ({
  op: 'deposit',
  itemId: ore,
  count,
  instance: null,
  craftedRecipeId: null,
  copperDelta: 0,
  purchasedSlotsBefore: 24,
  purchasedSlotsAfter: 24,
  materialSources: [
    { source: fresh, count: 5 },
    ...(count === 0 ? [{ source: {}, count: -5 }] : []),
  ],
});
const selection = (sourceIndex: number): MaterialSourceTransferSelection => ({
  itemId: ore,
  target: captureMaterialStackSelection(slots, ore, 0)!,
  quantities: [{ sourceIndex, count: 5 }],
});

function judge(selected: MaterialSourceTransferSelection | undefined, log = [deposit()]) {
  return guildBankUnsettledRefusal(
    'withdraw',
    { slot: 0, count: 5, selection: selected },
    book(),
    unsettledGuildBook([log]),
  );
}

describe('material sources across the release and hotfix settle gate', () => {
  it('refuses selected unsettled provenance even when the book has enough settled ore', () => {
    const dependency = judge(selection(1));
    expect(dependency).not.toBeNull();
    expect(contributesTo(holderContribution([deposit()]), dependency!)).toBe(true);
    expect(contributesTo(holderContribution([deposit()]), { kind: 'items_of', itemId: ore })).toBe(
      true,
    );
  });

  it('allows selecting settled provenance and the canonical automatic take', () => {
    expect(judge(selection(0))).toBeNull();
    expect(judge(undefined)).toBeNull();
    expect(judge(selection(1), [])).toBeNull();
  });

  it('counts pure source reattribution despite a zero item-count delta', () => {
    expect(judge(selection(1), [deposit(0)])).not.toBeNull();
  });

  it('nets exact source removals within one holder but never across holders', () => {
    const removal: GuildBankOpDelta = {
      ...deposit(),
      op: 'withdraw',
      materialSources: [{ source: fresh, count: -5 }],
    };
    expect(judge(selection(1), [deposit(), removal])).toBeNull();
    expect(
      guildBankUnsettledRefusal(
        'withdraw',
        { slot: 0, count: 5, selection: selection(1) },
        book(),
        unsettledGuildBook([[deposit()], [removal]]),
      ),
    ).not.toBeNull();
  });

  it('leaves stale selections unjudged so they cannot force another holder to flush', () => {
    expect(
      judge({ ...selection(1), target: { ...selection(1).target, pin: '0'.repeat(32) } }),
    ).toBeNull();
  });

  it('allows partial legacy signed material withdrawals within their settled source quantity', () => {
    const signed: InvSlot[] = [{ itemId: ore, count: 10, instance: { signer: 'Officer' } }];
    const log: GuildBankOpDelta = {
      ...deposit(),
      instance: { signer: 'Officer' },
      materialSources: null,
    };
    expect(
      guildBankUnsettledRefusal(
        'withdraw',
        { slot: 0, count: 5 },
        book(signed),
        unsettledGuildBook([[log]]),
      ),
    ).toBeNull();
  });
});
