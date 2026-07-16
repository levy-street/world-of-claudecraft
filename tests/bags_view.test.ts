import { describe, expect, it } from 'vitest';
import type { InvSlot, ItemDef } from '../src/sim/types';
import { DEFAULT_BAG_FILTER, type ItemLookup } from '../src/ui/bag_filter';
import {
  type BagMode,
  bagDestroyAction,
  bagItemAction,
  bagQualityKey,
  bagShiftLinks,
  bagStackIndex,
  bagsWindowShown,
  bagTooltipHintKey,
  bankDepositOpensPrompt,
  buildBagGrid,
  resolveDepositSubmit,
} from '../src/ui/bags_view';

// The bags core decides the mode-dependent click + tooltip (the 6-way branch) and
// the filtered grid model (empty / no-match / items), reusing bag_filter for the
// actual filter/sort. These tests pin the priority order, the grid states, and the
// ClientWorld-vs-Sim parity (the same inventory drives identical models
// whether read off a Sim or a ClientWorld mirror).

const NO_MODE: BagMode = {
  tradeOpen: false,
  mailAttach: false,
  marketSell: false,
  vendorOpen: false,
  bankDeposit: false,
  petFeed: false,
};

const ITEMS: Record<string, ItemDef> = {
  sword: { kind: 'weapon', name: 'Sword', quality: 'rare' } as ItemDef,
  potion: { kind: 'potion', name: 'Potion', quality: 'common' } as ItemDef,
  bread: { kind: 'food', name: 'Bread', quality: 'common' } as ItemDef,
  questItem: { kind: 'quest', name: 'Relic', quality: 'epic' } as ItemDef,
  bound: { kind: 'armor', name: 'Bound Plate', quality: 'uncommon', noMarketList: true } as ItemDef,
  rod: { kind: 'tool', name: 'Fishing Rod', use: { type: 'fishing' } } as ItemDef,
  soulbound: { kind: 'quest', name: 'Soulbound Key', quality: 'epic', noDiscard: true } as ItemDef,
  mark: {
    kind: 'tool',
    name: 'Heroic Mark',
    quality: 'rare',
    soulbound: true,
    noDiscard: true,
  } as ItemDef,
};
const lookup: ItemLookup = (id) => ITEMS[id];

describe('bagShiftLinks', () => {
  it('links to chat in every mode except at a vendor (split-stack owns shift there)', () => {
    expect(bagShiftLinks(NO_MODE)).toBe(true);
    expect(bagShiftLinks({ ...NO_MODE, tradeOpen: true })).toBe(true);
    expect(bagShiftLinks({ ...NO_MODE, marketSell: true })).toBe(true);
    expect(bagShiftLinks({ ...NO_MODE, petFeed: true })).toBe(true);
    expect(bagShiftLinks({ ...NO_MODE, vendorOpen: true })).toBe(false);
    expect(bagShiftLinks({ ...NO_MODE, bankDeposit: true })).toBe(false);
  });
});

describe('bagsWindowShown', () => {
  it('reads the cold-load empty display as NOT shown so the first toggle opens (issue #1538)', () => {
    // The regression: the window is hidden by the .window CSS rule, so on a fresh
    // page load the inline display is '' (never 'none'). The old `!== 'none'` check
    // treated '' as shown and ran the close branch on the first press.
    expect(bagsWindowShown('')).toBe(false);
  });
  it('reads an explicitly hidden window as NOT shown', () => {
    expect(bagsWindowShown('none')).toBe(false);
  });
  it('reads any non-hidden value as shown (not pinned to the current shown value)', () => {
    // #bags is only ever assigned 'flex' today, but the guard checks the hidden
    // values (none / '') rather than pinning to 'flex', so it stays correct if the
    // shown value ever changes. Assert a non-'flex' non-hidden value still closes.
    expect(bagsWindowShown('flex')).toBe(true);
    expect(bagsWindowShown('block')).toBe(true);
  });
});

describe('bagDestroyAction', () => {
  it('destroys any regular item outside a transactional mode', () => {
    expect(bagDestroyAction(ITEMS.sword, NO_MODE)).toBe('discard');
    expect(bagDestroyAction(ITEMS.potion, NO_MODE)).toBe('discard');
    // quest items are destroyable too (they already are via left-click), unless noDiscard.
    expect(bagDestroyAction(ITEMS.questItem, NO_MODE)).toBe('discard');
  });

  it('protects a noDiscard item with feedback, never destroying it', () => {
    expect(bagDestroyAction(ITEMS.soulbound, NO_MODE)).toBe('discardBlocked');
  });

  it('protects a soulbound noDiscard item (Heroic Mark) from destruction too', () => {
    expect(bagDestroyAction(ITEMS.mark, NO_MODE)).toBe('discardBlocked');
  });

  it('lets bound equipment be destroyed so an accidental honor purchase cannot clog bags', () => {
    expect(bagDestroyAction({ kind: 'armor', soulbound: true }, NO_MODE)).toBe('discard');
  });

  it('is inert in every transactional mode (their own click/contextmenu owns the slot)', () => {
    for (const mode of [
      'tradeOpen',
      'mailAttach',
      'marketSell',
      'vendorOpen',
      'petFeed',
      'bankDeposit',
    ] as const) {
      expect(bagDestroyAction(ITEMS.sword, { ...NO_MODE, [mode]: true })).toBe('none');
      // even a normally-blocked item is 'none' (not 'discardBlocked') in these modes.
      expect(bagDestroyAction(ITEMS.soulbound, { ...NO_MODE, [mode]: true })).toBe('none');
    }
  });
});

describe('bagItemAction priority order', () => {
  it('honors trade > market-sell > vendor > pet-feed > quest > use', () => {
    expect(bagItemAction(ITEMS.sword, { ...NO_MODE, tradeOpen: true })).toBe('trade');
    expect(bagItemAction(ITEMS.sword, { ...NO_MODE, marketSell: true })).toBe('marketSell');
    expect(bagItemAction(ITEMS.questItem, { ...NO_MODE, marketSell: true })).toBe(
      'marketSellBlockedQuest',
    );
    expect(bagItemAction(ITEMS.bound, { ...NO_MODE, marketSell: true })).toBe(
      'marketSellBlockedNoMarket',
    );
    expect(bagItemAction(ITEMS.sword, { ...NO_MODE, vendorOpen: true })).toBe('vendorSell');
    expect(bagItemAction(ITEMS.sword, { ...NO_MODE, bankDeposit: true })).toBe('bankDeposit');
    expect(bagItemAction(ITEMS.questItem, { ...NO_MODE, bankDeposit: true })).toBe(
      'bankDepositBlockedQuest',
    );
    expect(bagItemAction(ITEMS.bread, { ...NO_MODE, petFeed: true })).toBe('petFeed');
    expect(bagItemAction(ITEMS.sword, { ...NO_MODE, petFeed: true })).toBe('petFeedBlocked');
    expect(bagItemAction(ITEMS.questItem, NO_MODE)).toBe('discardQuest');
    expect(bagItemAction(ITEMS.potion, NO_MODE)).toBe('use');
  });
});

describe('soulbound transfer affordances', () => {
  it('blocks trade, mail, market, and vendor clicks instead of staging a Heroic Mark transfer', () => {
    expect([
      bagItemAction(ITEMS.mark, { ...NO_MODE, tradeOpen: true }),
      bagItemAction(ITEMS.mark, { ...NO_MODE, mailAttach: true }),
      bagItemAction(ITEMS.mark, { ...NO_MODE, marketSell: true }),
      bagItemAction(ITEMS.mark, { ...NO_MODE, vendorOpen: true }),
    ]).toEqual([
      'transferBlockedSoulbound',
      'transferBlockedSoulbound',
      'transferBlockedSoulbound',
      'transferBlockedSoulbound',
    ]);
  });

  it('labels every blocked transfer as soulbound instead of advertising the action', () => {
    expect([
      bagTooltipHintKey(ITEMS.mark, { ...NO_MODE, tradeOpen: true }),
      bagTooltipHintKey(ITEMS.mark, { ...NO_MODE, mailAttach: true }),
      bagTooltipHintKey(ITEMS.mark, { ...NO_MODE, marketSell: true }),
      bagTooltipHintKey(ITEMS.mark, { ...NO_MODE, vendorOpen: true }),
    ]).toEqual([
      'hudChrome.itemSoulbound',
      'hudChrome.itemSoulbound',
      'hudChrome.itemSoulbound',
      'hudChrome.itemSoulbound',
    ]);
  });
});

describe('bag mode chain order pin (insertion guard)', () => {
  // Pins the RELATIVE order between simultaneously-on modes, not just each mode
  // alone (the priority-order test above flips one flag at a time, so a ladder
  // reorder between two on-modes could survive it). The cascade peels every mode
  // in ladder order and ends by proving it reached NO_MODE, so adding a BagMode
  // flag without adding its peel step in the right rung fails here by type and
  // by value. Extend this cascade in the SAME commit as any BagMode change.
  const ALL_MODES: BagMode = {
    tradeOpen: true,
    mailAttach: true,
    marketSell: true,
    vendorOpen: true,
    bankDeposit: true,
    petFeed: true,
  };

  it('peels the action ladder one rung at a time: trade > mail-attach > market-sell > vendor > bank-deposit > pet-feed > kind fallbacks', () => {
    let mode = { ...ALL_MODES };
    expect(bagItemAction(ITEMS.sword, mode)).toBe('trade');
    mode = { ...mode, tradeOpen: false };
    expect(bagItemAction(ITEMS.sword, mode)).toBe('mailAttach');
    mode = { ...mode, mailAttach: false };
    expect(bagItemAction(ITEMS.sword, mode)).toBe('marketSell');
    mode = { ...mode, marketSell: false };
    expect(bagItemAction(ITEMS.sword, mode)).toBe('vendorSell');
    mode = { ...mode, vendorOpen: false };
    expect(bagItemAction(ITEMS.sword, mode)).toBe('bankDeposit');
    expect(bagItemAction(ITEMS.questItem, mode)).toBe('bankDepositBlockedQuest');
    mode = { ...mode, bankDeposit: false };
    expect(bagItemAction(ITEMS.bread, mode)).toBe('petFeed');
    expect(bagItemAction(ITEMS.sword, mode)).toBe('petFeedBlocked');
    mode = { ...mode, petFeed: false };
    expect(mode).toEqual(NO_MODE);
    expect(bagItemAction(ITEMS.questItem, mode)).toBe('discardQuest');
    expect(bagItemAction(ITEMS.sword, mode)).toBe('use');
  });

  it('blocked variants block in place, they never fall through to a lower rung', () => {
    // A mail-blocked item must NOT fall to market-sell even with that mode on.
    expect(bagItemAction(ITEMS.questItem, { ...ALL_MODES, tradeOpen: false })).toBe(
      'mailAttachBlocked',
    );
    expect(bagItemAction(ITEMS.bound, { ...ALL_MODES, tradeOpen: false })).toBe(
      'mailAttachBlocked',
    );
    // A market-blocked item must NOT fall to vendor even with vendor on.
    expect(
      bagItemAction(ITEMS.questItem, { ...ALL_MODES, tradeOpen: false, mailAttach: false }),
    ).toBe('marketSellBlockedQuest');
    expect(bagItemAction(ITEMS.bound, { ...ALL_MODES, tradeOpen: false, mailAttach: false })).toBe(
      'marketSellBlockedNoMarket',
    );
    // A quest item blocks in place at the bank; it must NOT fall through to pet-feed.
    expect(
      bagItemAction(ITEMS.questItem, {
        ...ALL_MODES,
        tradeOpen: false,
        mailAttach: false,
        marketSell: false,
        vendorOpen: false,
      }),
    ).toBe('bankDepositBlockedQuest');
  });

  it('peels the tooltip-hint ladder the same way (pet-feed contributes no hint)', () => {
    let mode = { ...ALL_MODES };
    expect(bagTooltipHintKey(ITEMS.sword, mode)).toBe('itemUi.tooltip.clickTradeOffer');
    mode = { ...mode, tradeOpen: false };
    expect(bagTooltipHintKey(ITEMS.sword, mode)).toBe('hudChrome.mailbox.clickAttach');
    expect(bagTooltipHintKey(ITEMS.questItem, mode)).toBe('hudChrome.mailbox.cannotMail');
    mode = { ...mode, mailAttach: false };
    expect(bagTooltipHintKey(ITEMS.sword, mode)).toBe('itemUi.tooltip.clickMarketList');
    mode = { ...mode, marketSell: false };
    expect(bagTooltipHintKey(ITEMS.sword, mode)).toBe('itemUi.tooltip.clickSell');
    mode = { ...mode, vendorOpen: false };
    expect(bagTooltipHintKey(ITEMS.sword, mode)).toBe('hudChrome.bank.depositHint');
    expect(bagTooltipHintKey(ITEMS.questItem, mode)).toBe('hudChrome.bank.cannotDeposit');
    mode = { ...mode, bankDeposit: false };
    // Pet-feed has no tooltip hint: a weapon falls through to the kind branch.
    expect(bagTooltipHintKey(ITEMS.sword, mode)).toBe('itemUi.tooltip.clickEquip');
    mode = { ...mode, petFeed: false };
    expect(mode).toEqual(NO_MODE);
  });

  it('shift-to-chat-link stays vendor- and bank-owned even with every mode on', () => {
    expect(bagShiftLinks(ALL_MODES)).toBe(false);
    // Vendor AND bank each own shift; turning off only one keeps it owned.
    expect(bagShiftLinks({ ...ALL_MODES, vendorOpen: false })).toBe(false);
    expect(bagShiftLinks({ ...ALL_MODES, bankDeposit: false })).toBe(false);
    expect(bagShiftLinks({ ...ALL_MODES, vendorOpen: false, bankDeposit: false })).toBe(true);
  });
});

describe('bagTooltipHintKey', () => {
  it('matches the mode-then-kind branch', () => {
    expect(bagTooltipHintKey(ITEMS.sword, { ...NO_MODE, tradeOpen: true })).toBe(
      'itemUi.tooltip.clickTradeOffer',
    );
    expect(bagTooltipHintKey(ITEMS.questItem, { ...NO_MODE, marketSell: true })).toBe(
      'itemUi.tooltip.cannotMarket',
    );
    expect(bagTooltipHintKey(ITEMS.sword, { ...NO_MODE, marketSell: true })).toBe(
      'itemUi.tooltip.clickMarketList',
    );
    expect(bagTooltipHintKey(ITEMS.questItem, { ...NO_MODE, vendorOpen: true })).toBe(
      'itemUi.tooltip.cannotVendor',
    );
    expect(bagTooltipHintKey(ITEMS.sword, { ...NO_MODE, vendorOpen: true })).toBe(
      'itemUi.tooltip.clickSell',
    );
    expect(bagTooltipHintKey(ITEMS.sword, { ...NO_MODE, bankDeposit: true })).toBe(
      'hudChrome.bank.depositHint',
    );
    expect(bagTooltipHintKey(ITEMS.questItem, { ...NO_MODE, bankDeposit: true })).toBe(
      'hudChrome.bank.cannotDeposit',
    );
    expect(bagTooltipHintKey(ITEMS.questItem, NO_MODE)).toBe('itemUi.tooltip.clickDestroy');
    expect(bagTooltipHintKey(ITEMS.sword, NO_MODE)).toBe('itemUi.tooltip.clickEquip');
    expect(bagTooltipHintKey(ITEMS.bread, NO_MODE)).toBe('itemUi.tooltip.clickConsume');
    expect(bagTooltipHintKey(ITEMS.potion, NO_MODE)).toBe('itemUi.tooltip.clickUseInstant');
    expect(bagTooltipHintKey(ITEMS.rod, NO_MODE)).toBe('itemUi.tooltip.clickUse');
    expect(bagTooltipHintKey({ kind: 'junk' }, NO_MODE)).toBe('');
  });
});

describe('bagQualityKey', () => {
  it('falls back to common when quality is unset', () => {
    expect(bagQualityKey({ quality: 'epic' })).toBe('epic');
    expect(bagQualityKey({})).toBe('common');
  });
});

describe('bagStackIndex (bank-deposit target resolution)', () => {
  it('returns the exact clicked slot index by reference, never a first-match-by-itemId', () => {
    // Two distinct stacks of the SAME material: a first-match-by-itemId would always
    // return 0 and deposit the wrong stack. Reference identity targets the one clicked.
    const first: InvSlot = { itemId: 'cloth', count: 3 };
    const second: InvSlot = { itemId: 'cloth', count: 7 };
    const inv: InvSlot[] = [first, { itemId: 'sword', count: 1 }, second];
    expect(bagStackIndex(inv, first)).toBe(0);
    expect(bagStackIndex(inv, second)).toBe(2);
  });

  it('distinguishes distinct instanced copies that share an itemId', () => {
    const a: InvSlot = { itemId: 'ring', count: 1, instance: { signer: 'Ada' } };
    const b: InvSlot = { itemId: 'ring', count: 1, instance: { signer: 'Bo' } };
    const inv: InvSlot[] = [a, b];
    expect(bagStackIndex(inv, a)).toBe(0);
    expect(bagStackIndex(inv, b)).toBe(1);
  });

  it('returns -1 for a stale slot no longer in the inventory (a click after a repaint)', () => {
    const stale: InvSlot = { itemId: 'cloth', count: 3 };
    // An equal-VALUE slot is not the SAME reference, so it does not match either.
    expect(bagStackIndex([{ itemId: 'cloth', count: 3 }], stale)).toBe(-1);
    expect(bagStackIndex([], stale)).toBe(-1);
  });
});

describe('bankDepositOpensPrompt', () => {
  it('opens the partial prompt only for a splittable, non-instanced stack', () => {
    expect(bankDepositOpensPrompt({ itemId: 'cloth', count: 5 })).toBe(true);
    // A single-count stack deposits whole (nothing to split).
    expect(bankDepositOpensPrompt({ itemId: 'cloth', count: 1 })).toBe(false);
    // An instanced item always moves whole regardless of count.
    expect(bankDepositOpensPrompt({ itemId: 'ring', count: 4, instance: { signer: 'Ada' } })).toBe(
      false,
    );
  });
});

describe('resolveDepositSubmit (prompt re-resolve + clamp)', () => {
  const captured: InvSlot = { itemId: 'cloth', count: 10 };

  it('refuses (null) when the slot is gone or a different item now sits at the index', () => {
    expect(resolveDepositSubmit(undefined, captured, 3, 10)).toBeNull();
    expect(resolveDepositSubmit({ itemId: 'ore', count: 5 }, captured, 3, 10)).toBeNull();
  });

  it('clamps the requested count to >=1 and no more than the live stack or the max', () => {
    const live: InvSlot = { itemId: 'cloth', count: 10 };
    expect(resolveDepositSubmit(live, captured, 4, 10)).toBe(4);
    expect(resolveDepositSubmit(live, captured, 999, 10)).toBe(10);
    // The caller sanitizes empty/NaN input to 0; a 0 (or negative) clamps up to 1.
    expect(resolveDepositSubmit(live, captured, 0, 10)).toBe(1);
    expect(resolveDepositSubmit(live, captured, -5, 10)).toBe(1);
    // A shrunken live stack (a partial deposit landed under the prompt) clamps down.
    expect(resolveDepositSubmit({ itemId: 'cloth', count: 3 }, captured, 8, 10)).toBe(3);
    // A GROWN live stack (loot landed under the prompt) still clamps to the max
    // captured at prompt-open: maxCount binds even as the strict smallest term.
    expect(resolveDepositSubmit({ itemId: 'cloth', count: 10 }, captured, 8, 5)).toBe(5);
  });
});

describe('buildBagGrid', () => {
  const inv: InvSlot[] = [
    { itemId: 'sword', count: 1 },
    { itemId: 'potion', count: 5 },
    { itemId: 'questItem', count: 1 },
  ];

  it('reports empty for an empty bag', () => {
    expect(buildBagGrid([], lookup, DEFAULT_BAG_FILTER).state).toBe('empty');
  });

  it('reports items with the full unfiltered list (recent order preserved)', () => {
    const model = buildBagGrid(inv, lookup, DEFAULT_BAG_FILTER);
    expect(model.state).toBe('items');
    expect(model.visible.map((s) => s.itemId)).toEqual(['sword', 'potion', 'questItem']);
  });

  it('reuses bag_filter: a category filter narrows the visible rows', () => {
    const weaponsOnly = buildBagGrid(inv, lookup, { ...DEFAULT_BAG_FILTER, category: 'weapon' });
    expect(weaponsOnly.state).toBe('items');
    expect(weaponsOnly.visible.map((s) => s.itemId)).toEqual(['sword']);
  });

  it('reports no-match when the filter excludes everything in a non-empty bag', () => {
    const none = buildBagGrid(inv, lookup, { ...DEFAULT_BAG_FILTER, search: 'zzzzz' });
    expect(none.state).toBe('noMatch');
    expect(none.visible).toEqual([]);
  });

  it('is a pure projection (same input -> same output)', () => {
    expect(buildBagGrid(inv, lookup, DEFAULT_BAG_FILTER)).toEqual(
      buildBagGrid(inv, lookup, DEFAULT_BAG_FILTER),
    );
  });
});

describe('ClientWorld-vs-Sim parity', () => {
  // The Sim exposes its inventory array directly; a ClientWorld mirrors it from a
  // server snapshot (a JSON round-trip). Drive the grid model from both and assert
  // identical output, with a quality sort to exercise the ordering path.
  it('yields identical grid models from a Sim-shaped and a mirror-shaped inventory', () => {
    const simInv: InvSlot[] = [
      { itemId: 'potion', count: 3 },
      { itemId: 'sword', count: 1 },
      { itemId: 'questItem', count: 1 },
    ];
    const cliInv = JSON.parse(JSON.stringify(simInv)) as InvSlot[];
    const filter = { ...DEFAULT_BAG_FILTER, sort: 'quality' as const };
    expect(buildBagGrid(simInv, lookup, filter)).toEqual(buildBagGrid(cliInv, lookup, filter));
  });
});
