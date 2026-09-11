import { describe, expect, it } from 'vitest';
import { type GossipMenuContent, gossipMenuIsEmpty } from '../src/ui/hud/quest/gossip_menu';

// Reproduces the tutorial bug report: after accepting/turning in the starter
// quest with the Marshal (the only content a fresh character's gossip menu
// ever has), the dialog should recognize the menu is now empty so the caller
// can close it, instead of leaving a dead greeting-only window on screen.
//
// EMPTY is the all-false base every case spreads from: a new menu dimension
// added to GossipMenuContent extends this one object instead of thirteen
// hand-maintained literals (which is exactly how hasDeepglassBouts and
// hasPortalWizard once broke this file's compile).
const EMPTY: GossipMenuContent = {
  questCount: 0,
  discussionCount: 0,
  hasVendor: false,
  hasMarket: false,
  hasHeroicVendor: false,
  hasWarfareVendor: false,
  hasCrucibleVendor: false,
  hasDelveBoard: false,
  hasCardMaster: false,
  hasDeepglass: false,
  hasDeepglassBouts: false,
  hasPortalWizard: false,
  hasTraining: false,
  hasFarmer: false,
};

describe('gossipMenuIsEmpty', () => {
  it('is empty when the NPC has no quests, shop, or board left to offer', () => {
    expect(gossipMenuIsEmpty({ ...EMPTY })).toBe(true);
  });

  it('the Marshal case: quest just accepted/turned in, nothing else offered', () => {
    // Mirrors marshal_redbrook's gossip state for a brand-new tutorial
    // character right after acceptQuest/turnInQuest('q_wolves'): the quest is
    // no longer 'available'/'ready' so it drops out of the list, and none of
    // the other menu sources apply.
    expect(gossipMenuIsEmpty({ ...EMPTY, questCount: 0, discussionCount: 0 })).toBe(true);
  });

  it('stays non-empty with another offerable quest', () => {
    expect(gossipMenuIsEmpty({ ...EMPTY, questCount: 1 })).toBe(false);
  });

  it('stays non-empty with an in-progress discussion quest', () => {
    expect(gossipMenuIsEmpty({ ...EMPTY, discussionCount: 1 })).toBe(false);
  });

  it('stays non-empty for every single-row service NPC', () => {
    // Each dimension alone must keep the menu open: an NPC whose ENTIRE menu
    // is that one row would otherwise close itself the moment it opened. The
    // WARFARE shop, the steward's passage row, the marshal's fixture rows and
    // the portal wizard's gate row all earned their fields exactly that way.
    const dimensions: Partial<GossipMenuContent>[] = [
      { hasVendor: true },
      { hasMarket: true },
      { hasHeroicVendor: true },
      { hasWarfareVendor: true },
      { hasCrucibleVendor: true },
      { hasDelveBoard: true },
      { hasCardMaster: true },
      { hasDeepglass: true },
      { hasDeepglassBouts: true },
      { hasPortalWizard: true },
      { hasTraining: true },
      { hasFarmer: true },
    ];
    for (const dim of dimensions) {
      expect(gossipMenuIsEmpty({ ...EMPTY, ...dim })).toBe(false);
    }
  });

  it('a flagged NPC with stock offers BOTH rows, so both dimensions can be true at once', () => {
    // Round-2 review finding: the WARFARE shop used to SUPPRESS the generic
    // goods row for a flagged NPC, which silently removed selling and buyback
    // at FURY, a shipped NPC that already had one. The two rows now coexist
    // (with distinct labels), so this combination is the live shape and the
    // menu must read non-empty on either dimension alone as well.
    expect(gossipMenuIsEmpty({ ...EMPTY, hasVendor: true, hasWarfareVendor: true })).toBe(false);
    // The goods row alone (an unflagged NPC with stock) still keeps it open.
    expect(gossipMenuIsEmpty({ ...EMPTY, hasVendor: true })).toBe(false);
  });
});
