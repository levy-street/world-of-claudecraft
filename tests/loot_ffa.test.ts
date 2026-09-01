import { describe, expect, it } from 'vitest';
import {
  hasSharedLootRights,
  isTapGroupMember,
  LOOT_FFA_DELAY,
  lootHasGoneFfa,
} from '../src/sim/loot/loot_ffa';

// Pure unit coverage for the loot free-for-all timeout rule: a tapped corpse the
// owner has not cleared within LOOT_FFA_DELAY seconds opens to everyone.

describe('loot FFA timeout', () => {
  it('locks to classic one minute', () => {
    expect(LOOT_FFA_DELAY).toBe(60);
  });

  it('lootHasGoneFfa flips only once the countdown reaches zero', () => {
    expect(lootHasGoneFfa(LOOT_FFA_DELAY)).toBe(false); // just became lootable
    expect(lootHasGoneFfa(0.05)).toBe(false); // one tick left
    expect(lootHasGoneFfa(0)).toBe(true); // exactly elapsed
    expect(lootHasGoneFfa(-3)).toBe(true); // overshot past despawn delay
  });

  describe('hasSharedLootRights', () => {
    const TAPPER = 1;
    const PARTY_MEMBER = 2;
    const STRANGER = 9;
    const party = [TAPPER, PARTY_MEMBER];

    it('grants the tapper and their party while still locked', () => {
      expect(hasSharedLootRights(TAPPER, TAPPER, party, false)).toBe(true);
      expect(hasSharedLootRights(PARTY_MEMBER, TAPPER, party, false)).toBe(true);
    });

    it('denies a stranger while the corpse is still owner-locked', () => {
      expect(hasSharedLootRights(STRANGER, TAPPER, party, false)).toBe(false);
      expect(hasSharedLootRights(STRANGER, TAPPER, null, false)).toBe(false);
    });

    it('grants a stranger once the owner-lock has lapsed (FFA)', () => {
      expect(hasSharedLootRights(STRANGER, TAPPER, party, true)).toBe(true);
      expect(hasSharedLootRights(STRANGER, TAPPER, null, true)).toBe(true);
    });

    it('treats an untapped corpse as FFA regardless of the timer', () => {
      expect(hasSharedLootRights(STRANGER, null, null, false)).toBe(true);
    });

    it('is a pure function of its inputs (determinism)', () => {
      const once = hasSharedLootRights(STRANGER, TAPPER, party, false);
      const twice = hasSharedLootRights(STRANGER, TAPPER, party, false);
      expect(once).toEqual(twice);
    });
  });

  // Distribution's counterpart to the permission check above: who the loot is owed
  // to, which an FFA outsider is NOT even though they may open the corpse.
  describe('isTapGroupMember', () => {
    const TAPPER = 1;
    const PARTY_MEMBER = 2;
    const ABSENT_RECIPIENT = 3;
    const STRANGER = 9;
    const party = [TAPPER, PARTY_MEMBER];

    it('counts the tapper, their party, and the kill-time recipients', () => {
      expect(isTapGroupMember(TAPPER, TAPPER, party, [TAPPER])).toBe(true);
      expect(isTapGroupMember(PARTY_MEMBER, TAPPER, party, [TAPPER])).toBe(true);
      expect(isTapGroupMember(ABSENT_RECIPIENT, TAPPER, party, [TAPPER, ABSENT_RECIPIENT])).toBe(
        true,
      );
    });

    it('excludes a stranger even where hasSharedLootRights lets them loot', () => {
      expect(hasSharedLootRights(STRANGER, TAPPER, party, true)).toBe(true);
      expect(isTapGroupMember(STRANGER, TAPPER, party, [TAPPER, PARTY_MEMBER])).toBe(false);
      expect(isTapGroupMember(STRANGER, TAPPER, null, null)).toBe(false);
    });

    it('excludes everyone from an untapped corpse with no recipients', () => {
      expect(isTapGroupMember(STRANGER, null, null, null)).toBe(false);
    });
  });
});
