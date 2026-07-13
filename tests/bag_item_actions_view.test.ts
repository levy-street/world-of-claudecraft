import { describe, expect, it } from 'vitest';
import { type MobileBagItemActionId, mobileBagItemActions } from '../src/ui/bag_item_actions_view';
import type { BagItemInfo, BagMode } from '../src/ui/bags_view';

const NORMAL_MODE: BagMode = {
  tradeOpen: false,
  mailAttach: false,
  marketSell: false,
  vendorOpen: false,
  bankDeposit: false,
  petFeed: false,
};

function ids(item: BagItemInfo): MobileBagItemActionId[] {
  return mobileBagItemActions(item, NORMAL_MODE).actions.map((action) => action.id);
}

describe('mobileBagItemActions', () => {
  it.each(['weapon', 'armor'])('offers explicit Equip for %s', (kind) => {
    expect(ids({ kind })).toEqual(['equip', 'linkToChat', 'destroy']);
  });

  it('offers explicit Equip Bag for bags', () => {
    expect(ids({ kind: 'bag' })).toEqual(['equipBag', 'linkToChat', 'destroy']);
  });

  it.each([
    ['food', 'consume'],
    ['drink', 'consume'],
    ['potion', 'use'],
    ['elixir', 'use'],
  ] as const)('offers %s use plus Consumables assignment', (kind, action) => {
    const view = mobileBagItemActions({ kind }, NORMAL_MODE);
    expect(view.actions.map((entry) => entry.id)).toEqual([action, 'linkToChat', 'destroy']);
    expect(view.canAssignConsumable).toBe(true);
  });

  it('offers Use only for usable tools', () => {
    expect(ids({ kind: 'tool', use: { effect: 'fish' } })).toEqual([
      'use',
      'linkToChat',
      'destroy',
    ]);
    expect(ids({ kind: 'tool' })).toEqual(['linkToChat', 'destroy']);
  });

  it('keeps non-usable and protected items shareable', () => {
    expect(ids({ kind: 'quest', noDiscard: true })).toEqual(['linkToChat']);
    expect(ids({ kind: 'junk', noDiscard: true })).toEqual(['linkToChat']);
  });

  it('blocks Destroy only for explicitly non-discardable items', () => {
    expect(ids({ kind: 'armor', noDiscard: true })).toEqual(['equip', 'linkToChat']);
    expect(ids({ kind: 'armor', soulbound: true })).toEqual(['equip', 'linkToChat', 'destroy']);
  });

  it.each([
    ['tradeOpen', 'trade'],
    ['mailAttach', 'mailAttach'],
    ['marketSell', 'marketSell'],
    ['vendorOpen', 'vendorSell'],
    ['bankDeposit', 'bankDeposit'],
    ['petFeed', 'petFeed'],
  ] as const)('leaves %s as the existing direct action', (key, directAction) => {
    const mode = { ...NORMAL_MODE, [key]: true };
    expect(mobileBagItemActions({ kind: 'food' }, mode)).toEqual({
      actions: [],
      canAssignConsumable: false,
      directAction,
    });
  });
});
