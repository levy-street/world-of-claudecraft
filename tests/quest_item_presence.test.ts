// The accept-time re-grant predicate (quests/quest_item_presence.ts): where a
// quest-required item still counts as HELD, so the fallback grant stops
// minting duplicates the moment a copy is merely stashed rather than lost.
//
// The unit arms drive each store INDIVIDUALLY with every other store empty,
// because a disjunction can pass an all-true fixture while reading the wrong
// member; the all-false case pins the re-grant side. The Sim arms below prove
// the three non-trivial seam reads (mailbox with its ownership scoping, the
// bank, market escrow through the real Market book) against the real stores
// rather than fakes; the real ACCEPT-path drive lives in
// tests/professions_starter_tools.test.ts.
import { describe, expect, it } from 'vitest';
import type { MarketListing } from '../src/sim/market';
import {
  playerHoldsQuestItem,
  type QuestItemPresenceCtx,
} from '../src/sim/quests/quest_item_presence';
import { type PlayerMeta, Sim } from '../src/sim/sim';

const TOOL = 'gathering_sickle';

function fakeMeta(bankItems: { itemId: string; count: number }[] = []): PlayerMeta {
  return { entityId: 7, bank: { inventory: bankItems } } as unknown as PlayerMeta;
}

function fakeCtx(overrides: Partial<QuestItemPresenceCtx> = {}): QuestItemPresenceCtx {
  return {
    countItem: () => 0,
    mailboxHoldsItem: () => false,
    marketListings: [],
    marketListingBelongsTo: () => false,
    ...overrides,
  };
}

function listing(overrides: Partial<MarketListing>): MarketListing {
  return {
    id: 1,
    sellerKey: '7',
    sellerName: 'Seller',
    itemId: TOOL,
    count: 1,
    price: 10,
    expiresAt: Infinity,
    house: false,
    ...overrides,
  };
}

describe('playerHoldsQuestItem, one store at a time', () => {
  it('nothing anywhere: not held, so the fallback WOULD re-grant', () => {
    expect(playerHoldsQuestItem(fakeCtx(), fakeMeta(), TOOL)).toBe(false);
  });

  it('a copy in the bags counts', () => {
    const ctx = fakeCtx({ countItem: (id) => (id === TOOL ? 1 : 0) });
    expect(playerHoldsQuestItem(ctx, fakeMeta(), TOOL)).toBe(true);
  });

  it('a copy in the bank counts, and an unrelated bank item does not', () => {
    expect(playerHoldsQuestItem(fakeCtx(), fakeMeta([{ itemId: TOOL, count: 1 }]), TOOL)).toBe(
      true,
    );
    expect(
      playerHoldsQuestItem(fakeCtx(), fakeMeta([{ itemId: 'iron_ore', count: 5 }]), TOOL),
    ).toBe(false);
    // A zeroed bank stack is not a copy: deleting the count conjunct must
    // redden here, not stay green.
    expect(playerHoldsQuestItem(fakeCtx(), fakeMeta([{ itemId: TOOL, count: 0 }]), TOOL)).toBe(
      false,
    );
  });

  it('a mailbox attachment counts', () => {
    const ctx = fakeCtx({ mailboxHoldsItem: (_meta, id) => id === TOOL });
    expect(playerHoldsQuestItem(ctx, fakeMeta(), TOOL)).toBe(true);
  });

  it('market escrow counts only when the listing is MINE and non-empty', () => {
    const mine = fakeCtx({
      marketListings: [listing({})],
      marketListingBelongsTo: () => true,
    });
    expect(playerHoldsQuestItem(mine, fakeMeta(), TOOL)).toBe(true);
    // Someone else's listing of the same item is not my copy.
    const theirs = fakeCtx({
      marketListings: [listing({})],
      marketListingBelongsTo: () => false,
    });
    expect(playerHoldsQuestItem(theirs, fakeMeta(), TOOL)).toBe(false);
    // A different item id never matches, whoever owns it.
    const other = fakeCtx({
      marketListings: [listing({ itemId: 'iron_ore' })],
      marketListingBelongsTo: () => true,
    });
    expect(playerHoldsQuestItem(other, fakeMeta(), TOOL)).toBe(false);
    // An emptied-out listing of mine is not a copy either.
    const drained = fakeCtx({
      marketListings: [listing({ count: 0 })],
      marketListingBelongsTo: () => true,
    });
    expect(playerHoldsQuestItem(drained, fakeMeta(), TOOL)).toBe(false);
  });

  it('short-circuits on the bags before touching the realm-global stores', () => {
    // The mailbox read walks the realm-wide mail book and the escrow read
    // walks the whole listing book. What keeps those scans off the common
    // accept path is ORDER: bags first. A reorder would keep every arm above
    // green while putting a whole-book walk on every quest accept.
    let mailCalls = 0;
    let marketCalls = 0;
    const ctx = fakeCtx({
      countItem: (id) => (id === TOOL ? 1 : 0),
      mailboxHoldsItem: () => {
        mailCalls++;
        return false;
      },
      marketListings: [listing({})],
      marketListingBelongsTo: () => {
        marketCalls++;
        return false;
      },
    });
    // Empty bank on purpose: with a bank copy too the arm would only prove
    // "some local store short-circuits"; bags alone proves bags-first.
    expect(playerHoldsQuestItem(ctx, fakeMeta(), TOOL)).toBe(true);
    expect(mailCalls).toBe(0);
    expect(marketCalls).toBe(0);
  });
});

describe('the real seams', () => {
  it('sees a REAL mailbox attachment, in-flight letters included', () => {
    const sim = new Sim({ seed: 31, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    const meta = sim.players.get(pid) as PlayerMeta;
    expect(playerHoldsQuestItem(sim.ctx, meta, TOOL)).toBe(false);
    // Books a system letter carrying the item, with the standard delivery
    // delay: the raven is still ON THE WING when we ask, which is exactly the
    // window a re-accept exploit would use.
    sim.ctx.mailHeroicMarks(pid, TOOL, 1);
    expect(playerHoldsQuestItem(sim.ctx, meta, TOOL)).toBe(true);
    expect(sim.countItem(TOOL, pid)).toBe(0);
  });

  it('sees a REAL banked copy', () => {
    const sim = new Sim({ seed: 32, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    const meta = sim.players.get(pid) as PlayerMeta;
    meta.bank.inventory.push({ itemId: TOOL, count: 1 });
    expect(playerHoldsQuestItem(sim.ctx, meta, TOOL)).toBe(true);
    expect(sim.countItem(TOOL, pid)).toBe(0);
  });

  it("another player's mailed copy is NOT mine: the ownership conjunct is live", () => {
    // Dropping the ownership half of mailboxHoldsItem would leave every other
    // arm green while any stranger's mailed sickle suppressed MY re-grant,
    // silently blocking a player from a required tool. Both letters are
    // booked through the tracked sendLetter path, never a direct book push:
    // the bucketed read (MailIndex) cannot see an untracked letter, which
    // would make the negative arm below pass for invisibility instead of
    // ownership, and its failure mode is duplicate quest-item minting.
    const sim = new Sim({ seed: 33, playerClass: 'warrior', autoEquip: false });
    const meta = sim.players.get(sim.playerId) as PlayerMeta;
    const toolLetter = {
      letterId: 'qa_presence_tools',
      senderName: 'Postmaster',
      subject: 'Tools',
      body: '',
      items: [{ itemId: TOOL, count: 1 }],
      delaySeconds: 0,
    };
    sim.postOffice.sendLetter('somebody-else-entirely', 'Somebody Else', toolLetter, 'system');
    sim.tick();
    expect(sim.ctx.mailboxHoldsItem(meta, TOOL)).toBe(false);
    expect(playerHoldsQuestItem(sim.ctx, meta, TOOL)).toBe(false);

    // Positive control: the SAME letter addressed to ME is seen, proving the
    // negative above was the ownership conjunct and not an unindexed letter.
    sim.postOffice.sendLetter(sim.postOffice.mailKeyFor(meta), meta.name, toolLetter, 'system');
    sim.tick();
    expect(sim.ctx.mailboxHoldsItem(meta, TOOL)).toBe(true);
    expect(playerHoldsQuestItem(sim.ctx, meta, TOOL)).toBe(true);
  });

  it('sees a REAL market escrow through the real ownership check', () => {
    // The unit arms fake marketListingBelongsTo; this one lists through the
    // real Market book so the seller-key comparison itself is on the hook.
    // The tier-1 tools carry noMarketList, so the stand-in is a listable id:
    // the predicate is item-generic and serves every quest's fallback grants.
    const LISTABLE = 'iron_ore';
    const sim = new Sim({ seed: 34, playerClass: 'warrior', autoEquip: false });
    const pid = sim.playerId;
    const meta = sim.players.get(pid) as PlayerMeta;
    // marketList requires standing at the Merchant.
    const merchant = [...sim.entities.values()].find((e) => e.templateId === 'the_merchant');
    if (!merchant) throw new Error('no merchant entity in the world');
    const player = sim.entities.get(meta.entityId);
    if (!player) throw new Error('no player entity');
    player.pos.x = merchant.pos.x;
    player.pos.z = merchant.pos.z;
    player.prevPos = { ...player.pos };
    sim.addItem(LISTABLE, 1, pid);
    expect(playerHoldsQuestItem(sim.ctx, meta, LISTABLE)).toBe(true); // in bags
    sim.marketList(LISTABLE, 1, 25, pid);
    expect(sim.countItem(LISTABLE, pid)).toBe(0); // escrowed out of the bags
    expect(sim.marketListings.some((l) => l.itemId === LISTABLE)).toBe(true);
    expect(playerHoldsQuestItem(sim.ctx, meta, LISTABLE)).toBe(true);
    // The false direction of the REAL ownership check, locally: a stranger's
    // listing of the same item must not read as mine. Pushed directly into
    // the book with a foreign seller key, the shape marketBuy already vets.
    sim.marketCancel(sim.marketListings.find((l) => l.itemId === LISTABLE)!.id, pid);
    sim.marketListings.push({
      id: 424242,
      sellerKey: 'someone-else-entirely',
      sellerName: 'Stranger',
      itemId: LISTABLE,
      count: 1,
      price: 10,
      expiresAt: Number.POSITIVE_INFINITY,
      house: false,
    });
    expect(sim.countItem(LISTABLE, pid)).toBe(1); // the cancel returned mine
    sim.removeItem(LISTABLE, 1, pid);
    expect(playerHoldsQuestItem(sim.ctx, meta, LISTABLE)).toBe(false);
  });
});
