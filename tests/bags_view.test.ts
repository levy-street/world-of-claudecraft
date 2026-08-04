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
  bagsMoneyRowStale,
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
  bankOpen: false,
  bankDeposit: false,
  guildBankDeposit: false,
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
  starterTool: {
    kind: 'tool',
    name: 'Gathering Sickle',
    quality: 'common',
    noVendorSell: true,
    noMarketList: true,
  } as ItemDef,
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
    expect(bagShiftLinks({ ...NO_MODE, guildBankDeposit: true })).toBe(false);
    // bankOpen is the ONE consumer that deliberately does not read the superset:
    // the gate here is "does something else already own shift-click", and a bank
    // view with no deposit target has no split prompt to collide with. Pinned so
    // the exception is a tested decision, not an omission (every other consumer
    // of bankOpen goes inert; this one stays live).
    expect(bagShiftLinks({ ...NO_MODE, bankOpen: true })).toBe(true);
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
      'bankOpen',
      'bankDeposit',
      'guildBankDeposit',
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

describe('transfer-locked instanced copies (issue 1165)', () => {
  const ARMED = { bindOnTrade: true };
  const STAMPED = { bindOnTrade: true, boundTo: 7 };
  const SIGNED = { signer: 'Ayla' };

  it('blocks a locked copy in market-sell mode, in place, for armed AND stamped', () => {
    expect(bagItemAction(ITEMS.sword, { ...NO_MODE, marketSell: true }, ARMED)).toBe(
      'marketSellBlockedBound',
    );
    expect(bagItemAction(ITEMS.sword, { ...NO_MODE, marketSell: true }, STAMPED)).toBe(
      'marketSellBlockedBound',
    );
  });

  it('blocks a locked copy in mail-attach mode, in place, for armed AND stamped', () => {
    expect(bagItemAction(ITEMS.sword, { ...NO_MODE, mailAttach: true }, ARMED)).toBe(
      'mailAttachBlockedBound',
    );
    expect(bagItemAction(ITEMS.sword, { ...NO_MODE, mailAttach: true }, STAMPED)).toBe(
      'mailAttachBlockedBound',
    );
  });

  it('an UNLOCKED instanced copy stages normally: signed goods list and mail', () => {
    expect(bagItemAction(ITEMS.sword, { ...NO_MODE, marketSell: true }, SIGNED)).toBe('marketSell');
    expect(bagItemAction(ITEMS.sword, { ...NO_MODE, mailAttach: true }, SIGNED)).toBe('mailAttach');
  });

  it('the def-level gates still outrank the lock: quest/noMarketList block first', () => {
    expect(bagItemAction(ITEMS.questItem, { ...NO_MODE, marketSell: true }, STAMPED)).toBe(
      'marketSellBlockedQuest',
    );
    expect(bagItemAction(ITEMS.bound, { ...NO_MODE, mailAttach: true }, STAMPED)).toBe(
      'mailAttachBlocked',
    );
  });

  it('a lock never blocks outside the two pipe modes: vendor/bank/trade are unchanged', () => {
    expect(bagItemAction(ITEMS.sword, { ...NO_MODE, tradeOpen: true }, STAMPED)).toBe('trade');
    expect(bagItemAction(ITEMS.sword, { ...NO_MODE, vendorOpen: true }, STAMPED)).toBe(
      'vendorSell',
    );
    expect(bagItemAction(ITEMS.sword, { ...NO_MODE, bankDeposit: true }, STAMPED)).toBe(
      'bankDeposit',
    );
  });

  it('the tooltip hint mirrors the block: cannot-market / cannot-mail for locked copies', () => {
    expect(bagTooltipHintKey(ITEMS.sword, { ...NO_MODE, marketSell: true }, STAMPED)).toBe(
      'itemUi.tooltip.cannotMarket',
    );
    expect(bagTooltipHintKey(ITEMS.sword, { ...NO_MODE, mailAttach: true }, ARMED)).toBe(
      'hudChrome.mailbox.cannotMail',
    );
    expect(bagTooltipHintKey(ITEMS.sword, { ...NO_MODE, marketSell: true }, SIGNED)).toBe(
      'itemUi.tooltip.clickMarketList',
    );
    expect(bagTooltipHintKey(ITEMS.sword, { ...NO_MODE, mailAttach: true }, SIGNED)).toBe(
      'hudChrome.mailbox.clickAttach',
    );
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
    bankOpen: true,
    bankDeposit: true,
    guildBankDeposit: true,
    petFeed: true,
  };

  it('peels the action ladder one rung at a time: trade > mail-attach > market-sell > vendor > guild-bank-deposit > bank-deposit > bank-open-no-target > pet-feed > kind fallbacks', () => {
    let mode = { ...ALL_MODES };
    expect(bagItemAction(ITEMS.sword, mode)).toBe('trade');
    mode = { ...mode, tradeOpen: false };
    expect(bagItemAction(ITEMS.sword, mode)).toBe('mailAttach');
    mode = { ...mode, mailAttach: false };
    expect(bagItemAction(ITEMS.sword, mode)).toBe('marketSell');
    mode = { ...mode, marketSell: false };
    expect(bagItemAction(ITEMS.sword, mode)).toBe('vendorSell');
    mode = { ...mode, vendorOpen: false };
    expect(bagItemAction(ITEMS.sword, mode)).toBe('guildBankDeposit');
    expect(bagItemAction(ITEMS.questItem, mode)).toBe('guildBankDepositBlockedQuest');
    mode = { ...mode, guildBankDeposit: false };
    expect(bagItemAction(ITEMS.sword, mode)).toBe('bankDeposit');
    expect(bagItemAction(ITEMS.questItem, mode)).toBe('bankDepositBlockedQuest');
    mode = { ...mode, bankDeposit: false };
    // The no-target rung: the bank is still OPEN, so the click stops here for
    // every item kind rather than dropping to the rungs that act on the item.
    expect(bagItemAction(ITEMS.sword, mode)).toBe('bankDepositBlockedNoTarget');
    expect(bagItemAction(ITEMS.potion, mode)).toBe('bankDepositBlockedNoTarget');
    expect(bagItemAction(ITEMS.bread, mode)).toBe('bankDepositBlockedNoTarget');
    expect(bagItemAction(ITEMS.questItem, mode)).toBe('bankDepositBlockedNoTarget');
    mode = { ...mode, bankOpen: false };
    expect(bagItemAction(ITEMS.bread, mode)).toBe('petFeed');
    expect(bagItemAction(ITEMS.sword, mode)).toBe('petFeedBlocked');
    mode = { ...mode, petFeed: false };
    expect(mode).toEqual(NO_MODE);
    expect(bagItemAction(ITEMS.questItem, mode)).toBe('discardQuest');
    expect(bagItemAction(ITEMS.sword, mode)).toBe('use');
  });

  it('a bank open with NEITHER deposit armed never falls through to the use ladder', () => {
    // The regression this rung exists for (PR #2812 review): disarming both
    // deposit modes for the guild pane's Log view left the ladder falling out
    // the bottom, so an officer reading the activity log who clicked a bag item
    // DRANK / EQUIPPED / SUMMONED it. Every kind that has a default action below
    // the bank rungs is pinned here, and the mount/bag/quest kinds are named
    // explicitly because each reaches a DIFFERENT sink (useItem, equipBag, the
    // destroy prompt).
    const logView: BagMode = { ...NO_MODE, bankOpen: true };
    for (const key of ['sword', 'potion', 'bread', 'rod', 'questItem', 'bound', 'mark'] as const) {
      expect(bagItemAction(ITEMS[key], logView), key).toBe('bankDepositBlockedNoTarget');
    }
    expect(bagItemAction({ kind: 'bag' }, logView)).toBe('bankDepositBlockedNoTarget');
    expect(bagItemAction({ kind: 'mount' }, logView)).toBe('bankDepositBlockedNoTarget');
    // Control: the SAME items with the bank closed keep their default actions,
    // so the rung is proven to be the bank's doing and not a blanket refusal.
    expect(bagItemAction(ITEMS.sword, NO_MODE)).toBe('use');
    expect(bagItemAction({ kind: 'bag' }, NO_MODE)).toBe('equipBag');
    expect(bagItemAction(ITEMS.questItem, NO_MODE)).toBe('discardQuest');
    // And an ARMED deposit still outranks the no-target rung in both panes.
    expect(bagItemAction(ITEMS.sword, { ...logView, bankDeposit: true })).toBe('bankDeposit');
    expect(bagItemAction(ITEMS.sword, { ...logView, guildBankDeposit: true })).toBe(
      'guildBankDeposit',
    );
  });

  it('the open bank with no deposit target keeps destroy and the tooltip honest', () => {
    // The same disarm re-armed two OTHER affordances that the open bank owns:
    // shift+right-click destroy went live over a reading surface, and the
    // tooltip advertised "Click to equip" for a click that is now refused.
    const logView: BagMode = { ...NO_MODE, bankOpen: true };
    expect(bagDestroyAction(ITEMS.sword, logView)).toBe('none');
    expect(bagDestroyAction(ITEMS.soulbound, logView)).toBe('none');
    // Control: with the bank fully closed the destroy affordance is live again.
    expect(bagDestroyAction(ITEMS.sword, NO_MODE)).toBe('discard');
    expect(bagTooltipHintKey(ITEMS.sword, logView)).toBe('hudChrome.bank.cannotDepositNow');
    expect(bagTooltipHintKey(ITEMS.questItem, logView)).toBe('hudChrome.bank.cannotDepositNow');
    expect(bagTooltipHintKey(ITEMS.potion, logView)).toBe('hudChrome.bank.cannotDepositNow');
    // Control: closed bank, and each armed pane, keep their own hints.
    expect(bagTooltipHintKey(ITEMS.sword, NO_MODE)).toBe('itemUi.tooltip.clickEquip');
    expect(bagTooltipHintKey(ITEMS.sword, { ...logView, bankDeposit: true })).toBe(
      'hudChrome.bank.depositHint',
    );
    expect(bagTooltipHintKey(ITEMS.sword, { ...logView, guildBankDeposit: true })).toBe(
      'hudChrome.bank.guildDepositHint',
    );
  });

  it('guild-bank-deposit pre-empts every pipe dimension in place (never falling to a lower rung)', () => {
    const mode = { ...NO_MODE, guildBankDeposit: true };
    // Allowed: an ordinary item, and an unlocked instanced copy.
    expect(bagItemAction(ITEMS.sword, mode)).toBe('guildBankDeposit');
    expect(bagItemAction(ITEMS.sword, mode, { signer: 'Ada' })).toBe('guildBankDeposit');
    // Quest / soulbound / noMarketList / per-copy transfer lock each deny with
    // their own arm (voicing the exact sim line at the consumer).
    expect(bagItemAction(ITEMS.questItem, mode)).toBe('guildBankDepositBlockedQuest');
    expect(bagItemAction(ITEMS.mark, mode)).toBe('guildBankDepositBlockedSoulbound');
    expect(bagItemAction(ITEMS.bound, mode)).toBe('guildBankDepositBlockedNoTransfer');
    expect(bagItemAction(ITEMS.sword, mode, { bindOnTrade: true })).toBe(
      'guildBankDepositBlockedNoTransfer',
    );
    expect(bagItemAction(ITEMS.sword, mode, { boundTo: 7 })).toBe(
      'guildBankDepositBlockedNoTransfer',
    );
    // Even with the pet-feed rung armed below, a deny blocks in place.
    expect(bagItemAction(ITEMS.questItem, { ...mode, petFeed: true })).toBe(
      'guildBankDepositBlockedQuest',
    );
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
    // A quest item blocks in place at the GUILD bank rung; it must NOT fall
    // through to the personal bank rung or pet-feed.
    expect(
      bagItemAction(ITEMS.questItem, {
        ...ALL_MODES,
        tradeOpen: false,
        mailAttach: false,
        marketSell: false,
        vendorOpen: false,
      }),
    ).toBe('guildBankDepositBlockedQuest');
    // A quest item blocks in place at the bank; it must NOT fall through to pet-feed.
    expect(
      bagItemAction(ITEMS.questItem, {
        ...ALL_MODES,
        tradeOpen: false,
        mailAttach: false,
        marketSell: false,
        vendorOpen: false,
        guildBankDeposit: false,
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
    // The guild tab carries its OWN hint keys (the consequences differ from
    // the personal pane), and its cannot arm covers every pipe dimension,
    // not only quest.
    expect(bagTooltipHintKey(ITEMS.sword, mode)).toBe('hudChrome.bank.guildDepositHint');
    expect(bagTooltipHintKey(ITEMS.questItem, mode)).toBe('hudChrome.bank.guildCannotDeposit');
    expect(bagTooltipHintKey(ITEMS.mark, mode)).toBe('hudChrome.bank.guildCannotDeposit');
    expect(bagTooltipHintKey(ITEMS.bound, mode)).toBe('hudChrome.bank.guildCannotDeposit');
    expect(bagTooltipHintKey(ITEMS.sword, mode, { boundTo: 7 })).toBe(
      'hudChrome.bank.guildCannotDeposit',
    );
    mode = { ...mode, guildBankDeposit: false };
    expect(bagTooltipHintKey(ITEMS.sword, mode)).toBe('hudChrome.bank.depositHint');
    expect(bagTooltipHintKey(ITEMS.questItem, mode)).toBe('hudChrome.bank.cannotDeposit');
    mode = { ...mode, bankDeposit: false };
    // The no-target rung: still an OPEN bank, so the hint says so instead of
    // advertising an equip the click will refuse.
    expect(bagTooltipHintKey(ITEMS.sword, mode)).toBe('hudChrome.bank.cannotDepositNow');
    mode = { ...mode, bankOpen: false };
    // Pet-feed has no tooltip hint: a weapon falls through to the kind branch.
    expect(bagTooltipHintKey(ITEMS.sword, mode)).toBe('itemUi.tooltip.clickEquip');
    mode = { ...mode, petFeed: false };
    expect(mode).toEqual(NO_MODE);
  });

  it('shift-to-chat-link stays vendor- and bank-owned even with every mode on', () => {
    expect(bagShiftLinks(ALL_MODES)).toBe(false);
    // Vendor AND both bank modes each own shift; turning off only some keeps it owned.
    expect(bagShiftLinks({ ...ALL_MODES, vendorOpen: false })).toBe(false);
    expect(bagShiftLinks({ ...ALL_MODES, bankDeposit: false })).toBe(false);
    expect(bagShiftLinks({ ...ALL_MODES, vendorOpen: false, bankDeposit: false })).toBe(false);
    expect(
      bagShiftLinks({
        ...ALL_MODES,
        vendorOpen: false,
        bankDeposit: false,
        guildBankDeposit: false,
      }),
    ).toBe(true);
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

// The purse-staleness decision behind the bag money row (issue #2373). This is the
// whole polarity of the fix in one pure predicate, which is the point: driven as a
// truth table here, an inverted gate or an inverted diff cannot survive, where a
// source-text pin on the call site would match the negated form just as happily.
describe('bagsMoneyRowStale', () => {
  it('is TRUE only when a shown window is painting a purse that moved', () => {
    // The issue's repro: the window is up, the auctioneer just paid out.
    expect(bagsMoneyRowStale('flex', 5000, 1000)).toBe(true);
  });

  it('is FALSE when the purse did not move (no repaint under the player)', () => {
    // Load-bearing: this runs on the 500ms band, so a predicate that ignored the
    // purse would rebuild the money row twice a second forever.
    expect(bagsMoneyRowStale('flex', 5000, 5000)).toBe(false);
  });

  it('is FALSE for a hidden window even when the purse moved', () => {
    expect(bagsMoneyRowStale('none', 5000, 1000)).toBe(false);
  });

  it('is FALSE for a never-opened window, whose cold display is empty (issue #1538)', () => {
    // The raw `!== 'none'` form that the older bags call sites copy reads '' as
    // shown, which would paint a window the player has never opened.
    expect(bagsMoneyRowStale('', 5000, 1000)).toBe(false);
  });

  it('converges from the -1 cold sentinel, which no real purse can equal', () => {
    // A window shown without a paint behind it must not be left stale, and a
    // zero-copper player must still arm rather than compare equal by accident.
    expect(bagsMoneyRowStale('flex', 0, -1)).toBe(true);
  });

  it('fires on a DEBIT as well as a credit (a trainer fee, a vendor buy)', () => {
    // `!==`, not `>`: money leaving the purse goes just as stale as money arriving.
    expect(bagsMoneyRowStale('flex', 1000, 5000)).toBe(true);
  });

  it('is not pinned to the current shown value', () => {
    // Mirrors bagsWindowShown's own contract: guard the hidden values, not 'flex'.
    expect(bagsMoneyRowStale('block', 5000, 1000)).toBe(true);
  });
});

describe('noVendorSell affordances (the quest-granted starter tools)', () => {
  it('denies the vendor click in place instead of dispatching a sale the sim refuses', () => {
    // The sim refuses on noVendorSell (src/sim/items.ts sellItem). Before this
    // mirror existed the click dispatched anyway and the player's only feedback
    // was an error toast. A quality-'common' tool with a real sellValue is the
    // case that made it visible: the tier-1 gathering tools are the first items
    // to carry noVendorSell AND a nonzero sell price.
    expect(bagItemAction(ITEMS.starterTool, { ...NO_MODE, vendorOpen: true })).toBe(
      'vendorSellBlocked',
    );
    // Discriminating control: an ordinary sellable item still sells.
    expect(bagItemAction(ITEMS.sword, { ...NO_MODE, vendorOpen: true })).toBe('vendorSell');
  });

  it('labels the tooltip cannot-vendor rather than advertising a click to sell', () => {
    expect(bagTooltipHintKey(ITEMS.starterTool, { ...NO_MODE, vendorOpen: true })).toBe(
      'itemUi.tooltip.cannotVendor',
    );
    expect(bagTooltipHintKey(ITEMS.sword, { ...NO_MODE, vendorOpen: true })).toBe(
      'itemUi.tooltip.clickSell',
    );
  });

  it('leaves every other mode alone: the flag gates the vendor arm only', () => {
    // noVendorSell must not leak into trade, bank, or use. The tool is also
    // noMarketList, so the market and mail arms block on THAT flag, which is a
    // separate rule with its own pins above.
    expect(bagItemAction(ITEMS.starterTool, { ...NO_MODE, tradeOpen: true })).toBe('trade');
    expect(bagItemAction(ITEMS.starterTool, { ...NO_MODE, bankDeposit: true })).toBe('bankDeposit');
    expect(bagItemAction(ITEMS.starterTool, NO_MODE)).toBe('use');
  });
});
