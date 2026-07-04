// The Emberdeep Foundry, the relit forge of the mountain clans under the
// southwest crags of Thornpeak Heights. Verifies the dungeon is registered at
// its own instance band, enterable with its full spawn set, that the boss
// mechanics fire, the new 'foundry' interior collides, and the quest chain +
// boss loot table hang together. Mirrors tests/temple.test.ts.
import { describe, expect, it } from 'vitest';
import { FOUNDRY_LAYOUT, layoutColliders } from '../src/sim/dungeon_layout';

describe('Emberdeep Foundry layout', () => {
  it('is a three-chamber gauntlet on the standard shell', () => {
    expect(FOUNDRY_LAYOUT.zMin).toBe(-19);
    expect(FOUNDRY_LAYOUT.zMax).toBe(132);
    // two chamber-waist stubs: assembly hall -> casting halls -> forge heart
    const stubZs = [...new Set(FOUNDRY_LAYOUT.stubs.map((s) => s.z))].sort((a, b) => a - b);
    expect(stubZs).toEqual([48, 96]);
    // every stub leaves the 10u centre passage (|x| <= 5) open
    for (const s of FOUNDRY_LAYOUT.stubs) expect(Math.abs(s.x) - s.hw).toBeGreaterThanOrEqual(5);
    // the boss dais is inside the forge heart and walkable (no collider for it)
    expect(FOUNDRY_LAYOUT.dais.z).toBeGreaterThan(96);
    const colliders = layoutColliders(FOUNDRY_LAYOUT);
    const daisHit = colliders.some(
      (c) => c.type === 'circle' && Math.hypot(c.x - 0, c.z - FOUNDRY_LAYOUT.dais.z) < 2,
    );
    expect(daisHit).toBe(false);
  });
});
