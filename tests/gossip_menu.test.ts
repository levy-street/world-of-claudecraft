import { describe, expect, it } from 'vitest';
import { gossipMenuIsEmpty } from '../src/ui/hud/quest/gossip_menu';

// Reproduces the tutorial bug report: after accepting/turning in the starter
// quest with the Marshal (the only content a fresh character's gossip menu
// ever has), the dialog should recognize the menu is now empty so the caller
// can close it, instead of leaving a dead greeting-only window on screen.
describe('gossipMenuIsEmpty', () => {
  it('is empty when the NPC has no quests, shop, or board left to offer', () => {
    expect(
      gossipMenuIsEmpty({
        questCount: 0,
        discussionCount: 0,
        hasVendor: false,
        hasMarket: false,
        hasHeroicVendor: false,
        hasDelveBoard: false,
        hasVcup: false,
        hasCardMaster: false,
      }),
    ).toBe(true);
  });

  it('the Marshal case: quest just accepted/turned in, nothing else offered', () => {
    // Mirrors marshal_redbrook's gossip state for a brand-new tutorial
    // character right after acceptQuest/turnInQuest('q_wolves'): the quest is
    // no longer 'available'/'ready' so it drops out of the list, and none of
    // the other menu sources apply.
    expect(
      gossipMenuIsEmpty({
        questCount: 0,
        discussionCount: 0,
        hasVendor: false,
        hasMarket: false,
        hasHeroicVendor: false,
        hasDelveBoard: false,
        hasVcup: false,
        hasCardMaster: false,
      }),
    ).toBe(true);
  });

  it('stays non-empty with another offerable quest', () => {
    expect(
      gossipMenuIsEmpty({
        questCount: 1,
        discussionCount: 0,
        hasVendor: false,
        hasMarket: false,
        hasHeroicVendor: false,
        hasDelveBoard: false,
        hasVcup: false,
        hasCardMaster: false,
      }),
    ).toBe(false);
  });

  it('stays non-empty with an in-progress discussion quest', () => {
    expect(
      gossipMenuIsEmpty({
        questCount: 0,
        discussionCount: 1,
        hasVendor: false,
        hasMarket: false,
        hasHeroicVendor: false,
        hasDelveBoard: false,
        hasVcup: false,
        hasCardMaster: false,
      }),
    ).toBe(false);
  });

  it('stays non-empty for a vendor, market, heroic vendor, delve board, or Vale Cup NPC', () => {
    expect(
      gossipMenuIsEmpty({
        questCount: 0,
        discussionCount: 0,
        hasVendor: true,
        hasMarket: false,
        hasHeroicVendor: false,
        hasDelveBoard: false,
        hasVcup: false,
        hasCardMaster: false,
      }),
    ).toBe(false);
    expect(
      gossipMenuIsEmpty({
        questCount: 0,
        discussionCount: 0,
        hasVendor: false,
        hasMarket: true,
        hasHeroicVendor: false,
        hasDelveBoard: false,
        hasVcup: false,
        hasCardMaster: false,
      }),
    ).toBe(false);
    expect(
      gossipMenuIsEmpty({
        questCount: 0,
        discussionCount: 0,
        hasVendor: false,
        hasMarket: false,
        hasHeroicVendor: true,
        hasDelveBoard: false,
        hasVcup: false,
        hasCardMaster: false,
      }),
    ).toBe(false);
    expect(
      gossipMenuIsEmpty({
        questCount: 0,
        discussionCount: 0,
        hasVendor: false,
        hasMarket: false,
        hasHeroicVendor: false,
        hasDelveBoard: true,
        hasVcup: false,
        hasCardMaster: false,
      }),
    ).toBe(false);
    expect(
      gossipMenuIsEmpty({
        questCount: 0,
        discussionCount: 0,
        hasVendor: false,
        hasMarket: false,
        hasHeroicVendor: false,
        hasDelveBoard: false,
        hasVcup: true,
        hasCardMaster: false,
      }),
    ).toBe(false);
    expect(
      gossipMenuIsEmpty({
        questCount: 0,
        discussionCount: 0,
        hasVendor: false,
        hasMarket: false,
        hasHeroicVendor: false,
        hasDelveBoard: false,
        hasVcup: false,
        hasCardMaster: true,
      }),
    ).toBe(false);
  });
});
