import { describe, expect, it } from 'vitest';
import { drownedLitanyChestItemsForTier } from '../src/sim/content/delves/drowned_litany_loot';
import type { Rng } from '../src/sim/rng';

// A p-AWARE stub: `Rng.chance(p)` is `next() < p`, so this simulates "the
// underlying draw landed at exactly `drawValue`" for every chance() call.
// Unlike a scripted true/false stub (tests/reliquary_content.test.ts
// ScriptedRng, which proves referential integrity across every branch but is
// blind to the threshold itself), this catches a regression to the retired
// 3% constant even though the outcome still depends on which `p` the call
// site passes.
function rngAt(drawValue: number): Rng {
  return { chance: (p: number) => drawValue < p } as unknown as Rng;
}

describe('Drowned Reliquary Rite loot: bountiful epic roll', () => {
  // Bountiful always grants the uncommon (draw 1) and rare (unconditional);
  // only the epic is gated on draw 2. `tier` is ignored on the bountiful arm
  // in the CURRENT implementation (a separate, pre-existing question from
  // this rate change: unlike the Collapsed Reliquary's lockpick coffer,
  // which requires an actual solve, the Drowned Litany rite's coffer check
  // in drowned_litany_rite.ts carries no such gate, so a tries-exhausted
  // 'low' grant still rolls it). Passing 'low' here pins that CURRENT
  // contract of the function under test, not an endorsement of it.
  const epicId = (drawValue: number) =>
    drownedLitanyChestItemsForTier('low', 'warrior', rngAt(drawValue), true).find(
      (s) => s.itemId === 'blackwater_vanguard_chest',
    );

  it('hits at the live 12% rate, not the retired 3% one', () => {
    // 0.08 sits strictly between the retired 3% threshold and the live 12%
    // one: a miss under the old tuning, a hit under the new.
    expect(epicId(0.08)).toBeDefined();
  });

  it('still hits just under the 12% threshold', () => {
    expect(epicId(0.119999)).toBeDefined();
  });

  it('misses at or above the 12% threshold (strict <, not <=)', () => {
    expect(epicId(0.12)).toBeUndefined();
    expect(epicId(0.2)).toBeUndefined();
  });

  it('still guarantees the rare on bountiful regardless of the epic roll', () => {
    const items = drownedLitanyChestItemsForTier('low', 'warrior', rngAt(0.9), true).map(
      (s) => s.itemId,
    );
    expect(items).toContain('nhalias_bell_maul'); // guaranteed rare
    expect(items).not.toContain('blackwater_vanguard_chest'); // 0.9 misses the 12% gate
  });
});
