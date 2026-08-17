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
        hasWarfareVendor: false,
        hasDelveBoard: false,
        hasVcup: false,
        hasCardMaster: false,
        hasTraining: false,
        hasFarmer: false,
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
        hasWarfareVendor: false,
        hasDelveBoard: false,
        hasVcup: false,
        hasCardMaster: false,
        hasTraining: false,
        hasFarmer: false,
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
        hasWarfareVendor: false,
        hasDelveBoard: false,
        hasVcup: false,
        hasCardMaster: false,
        hasTraining: false,
        hasFarmer: false,
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
        hasWarfareVendor: false,
        hasDelveBoard: false,
        hasVcup: false,
        hasCardMaster: false,
        hasTraining: false,
        hasFarmer: false,
      }),
    ).toBe(false);
  });

  it('stays non-empty for a vendor, market, heroic or WARFARE vendor, delve board, or Vale Cup NPC', () => {
    expect(
      gossipMenuIsEmpty({
        questCount: 0,
        discussionCount: 0,
        hasVendor: true,
        hasMarket: false,
        hasHeroicVendor: false,
        hasWarfareVendor: false,
        hasDelveBoard: false,
        hasVcup: false,
        hasCardMaster: false,
        hasTraining: false,
        hasFarmer: false,
      }),
    ).toBe(false);
    expect(
      gossipMenuIsEmpty({
        questCount: 0,
        discussionCount: 0,
        hasVendor: false,
        hasMarket: true,
        hasHeroicVendor: false,
        hasWarfareVendor: false,
        hasDelveBoard: false,
        hasVcup: false,
        hasCardMaster: false,
        hasTraining: false,
        hasFarmer: false,
      }),
    ).toBe(false);
    expect(
      gossipMenuIsEmpty({
        questCount: 0,
        discussionCount: 0,
        hasVendor: false,
        hasMarket: false,
        hasHeroicVendor: true,
        hasWarfareVendor: false,
        hasDelveBoard: false,
        hasVcup: false,
        hasCardMaster: false,
        hasTraining: false,
        hasFarmer: false,
      }),
    ).toBe(false);
    // The WARFARE quartermaster alone. Its own dimension, because the shop row
    // sits BESIDE the generic goods row, so a flagged NPC whose stock list is
    // empty has this field alone keeping the menu open.
    expect(
      gossipMenuIsEmpty({
        questCount: 0,
        discussionCount: 0,
        hasVendor: false,
        hasMarket: false,
        hasHeroicVendor: false,
        hasWarfareVendor: true,
        hasDelveBoard: false,
        hasVcup: false,
        hasCardMaster: false,
        hasTraining: false,
        hasFarmer: false,
      }),
    ).toBe(false);
    expect(
      gossipMenuIsEmpty({
        questCount: 0,
        discussionCount: 0,
        hasVendor: false,
        hasMarket: false,
        hasHeroicVendor: false,
        hasWarfareVendor: false,
        hasDelveBoard: true,
        hasVcup: false,
        hasCardMaster: false,
        hasTraining: false,
        hasFarmer: false,
      }),
    ).toBe(false);
    expect(
      gossipMenuIsEmpty({
        questCount: 0,
        discussionCount: 0,
        hasVendor: false,
        hasMarket: false,
        hasHeroicVendor: false,
        hasWarfareVendor: false,
        hasDelveBoard: false,
        hasVcup: true,
        hasCardMaster: false,
        hasTraining: false,
        hasFarmer: false,
      }),
    ).toBe(false);
    expect(
      gossipMenuIsEmpty({
        questCount: 0,
        discussionCount: 0,
        hasVendor: false,
        hasMarket: false,
        hasHeroicVendor: false,
        hasWarfareVendor: false,
        hasDelveBoard: false,
        hasVcup: false,
        hasCardMaster: true,
        hasTraining: false,
        hasFarmer: false,
      }),
    ).toBe(false);
    // A station master's Train option alone keeps the menu open.
    expect(
      gossipMenuIsEmpty({
        questCount: 0,
        discussionCount: 0,
        hasVendor: false,
        hasMarket: false,
        hasHeroicVendor: false,
        hasWarfareVendor: false,
        hasDelveBoard: false,
        hasVcup: false,
        hasCardMaster: false,
        hasTraining: true,
        hasFarmer: false,
      }),
    ).toBe(false);
    // A farmer's husk-trade row alone keeps the menu open (the farming
    // go-live): the two compost-only farmers have stock too, but a farmer
    // with no quest and no vendor rows is a legal content shape and must not
    // close on open.
    expect(
      gossipMenuIsEmpty({
        questCount: 0,
        discussionCount: 0,
        hasVendor: false,
        hasMarket: false,
        hasHeroicVendor: false,
        hasWarfareVendor: false,
        hasDelveBoard: false,
        hasVcup: false,
        hasCardMaster: false,
        hasTraining: false,
        hasFarmer: true,
      }),
    ).toBe(false);
  });

  it('a flagged NPC with stock offers BOTH rows, so both dimensions can be true at once', () => {
    // Round-2 review finding: the WARFARE shop used to SUPPRESS the generic
    // goods row for a flagged NPC, which silently removed selling and buyback
    // at FURY, a shipped NPC that already had one. The two rows now coexist
    // (with distinct labels), so this combination is the live shape and the
    // menu must read non-empty on either dimension alone as well.
    expect(
      gossipMenuIsEmpty({
        questCount: 0,
        discussionCount: 0,
        hasVendor: true,
        hasMarket: false,
        hasHeroicVendor: false,
        hasWarfareVendor: true,
        hasDelveBoard: false,
        hasVcup: false,
        hasCardMaster: false,
        hasTraining: false,
        hasFarmer: false,
      }),
    ).toBe(false);
    // The goods row alone (an unflagged NPC with stock) still keeps it open.
    expect(
      gossipMenuIsEmpty({
        questCount: 0,
        discussionCount: 0,
        hasVendor: true,
        hasMarket: false,
        hasHeroicVendor: false,
        hasWarfareVendor: false,
        hasDelveBoard: false,
        hasVcup: false,
        hasCardMaster: false,
        hasTraining: false,
        hasFarmer: false,
      }),
    ).toBe(false);
  });
});
