// Direct pin of the loot difficulty gate (src/sim/loot/loot_difficulty_gate.ts):
// the ONE predicate rollLoot and the Dungeon Finder preview share for
// LootEntry.normalOnly. The full truth table is pinned here so the predicate
// is decided independently of its two call sites (tests/loot_roll.test.ts and
// tests/dungeon_finder_view.test.ts prove those sites consume it).
import { describe, expect, it } from 'vitest';
import { lootEntryRollsOnClaim } from '../src/sim/loot/loot_difficulty_gate';

describe('loot_difficulty_gate: lootEntryRollsOnClaim', () => {
  it('rolls an unflagged row on both difficulties', () => {
    expect(lootEntryRollsOnClaim({}, false)).toBe(true);
    expect(lootEntryRollsOnClaim({}, true)).toBe(true);
  });

  it('rolls a normalOnly row on a Normal kill and skips it on a heroic claim', () => {
    expect(lootEntryRollsOnClaim({ normalOnly: true }, false)).toBe(true);
    expect(lootEntryRollsOnClaim({ normalOnly: true }, true)).toBe(false);
  });

  it('treats only the literal true flag as Normal-only', () => {
    // The field is typed `normalOnly?: true`; a row that omits it, or a
    // hand-built fixture carrying undefined, is an ordinary both-difficulty
    // row, never a heroic skip.
    expect(lootEntryRollsOnClaim({ normalOnly: undefined }, true)).toBe(true);
  });
});
