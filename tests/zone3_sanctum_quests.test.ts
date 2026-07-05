// The Gravewyrm Sanctum is a single dungeon instance with three boss quests:
// Korgath at the threshold, Velkhar in the Ritual Vault, and Korzul on the
// final dais. All three should be pickable BEFORE entering, so the party
// clears the instance once. They must therefore gate on the same prerequisite
// (q_sanctum_gate, "the way below stands open"), never on each other — gating
// Korzul behind Velkhar's turn-in forces a second run of the same dungeon.
import { describe, expect, it } from 'vitest';
import { QUESTS } from '../src/sim/data';

describe('Gravewyrm Sanctum dungeon quests are concurrently available', () => {
  const SANCTUM_BOSS_QUESTS = ['q_korgath', 'q_velkhar', 'q_gravewyrm'];

  it('every Sanctum boss quest gates on opening the gate, not on a prior boss', () => {
    for (const id of SANCTUM_BOSS_QUESTS) {
      expect(QUESTS[id], `${id} should exist`).toBeTruthy();
      expect(QUESTS[id].requiresQuest, `${id} prerequisite`).toBe('q_sanctum_gate');
    }
  });

  it('Korzul (q_gravewyrm) does not chain off Velkhar (q_velkhar)', () => {
    expect(QUESTS.q_gravewyrm.requiresQuest).not.toBe('q_velkhar');
  });
});
