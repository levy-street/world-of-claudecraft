// Every walk-in Tidehold building's authored ground-floor DECK must sit on the
// model's visible floor. The sim measures override space from the model's
// LOWEST vertex (the loader seats that on the ground), so a restyle that adds
// a base course under the origin silently drops every deck by that much:
// the castle's floor read 0.87 yd above its deck and the player waded
// waist-deep through the keep (SPACEY, 2026-09-07).
// scripts/assets/tidehold_rebase_overrides.mjs re-seats them; this pins it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - shared zero-dep JS tool (no .d.ts); same pattern as tests/i18n_completeness.test.ts.
import { floorUnderDeck, measureFloors } from '../scripts/assets/tidehold_rebase_overrides.mjs';

const BUILDINGS = ['castle', 'castle_b', 'hall', 'bank', 'market', 'smithy', 'tavern'];

describe('Tidehold building decks', () => {
  it('put the main floor deck on the model floor, measured from the model base', async () => {
    const overrides = JSON.parse(
      readFileSync('data/asset_collision_overrides.json', 'utf8'),
    ) as Record<string, { ramps?: { hx: number; hz: number; y0: number; y1: number }[] }>;
    for (const b of BUILDINGS) {
      const m = await measureFloors(`public/models/tidehold/${b}.glb`);
      const norm = 2.2 / m.maxDim;
      const main = (overrides[`tidehold/${b}`].ramps ?? [])
        .filter((r) => Math.abs(r.y1 - r.y0) < 1e-6)
        .sort((a, c) => c.hx * c.hz - a.hx * a.hz)[0];
      expect(main, b).toBeTruthy();
      const deck = main.y0 / norm;
      // the floor this deck stands on, which is not always the model's LARGEST
      // plane: the repainted tavern's upper storey has more up-facing area
      // than its hall
      const floor = floorUnderDeck(m, deck).y;
      // within a foot of the boards: a deck under the floor sinks the player,
      // one far above floats them.
      expect(
        Math.abs(deck - floor),
        `${b}: deck ${deck.toFixed(2)} vs floor ${floor.toFixed(2)}`,
      ).toBeLessThan(0.2);
    }
  }, 60000);

  it('judges a deck against a major floor plane only', () => {
    const plane = (y: number, area: number) => ({ y, area });
    // the tavern's shape: the upper storey is the largest plane, the hall is
    // the one the ground deck stands on
    const tavern = { floors: [plane(6.7, 289), plane(1.5, 220), plane(7.6, 50)] };
    expect(floorUnderDeck(tavern, 1.45).y).toBe(1.5);
    // the bug this suite exists for: a deck authored 0.87 yd under the floor
    // still answers with that floor, so the gap shows
    const castle = { floors: [plane(1.07, 708), plane(1.17, 369), plane(14.67, 321)] };
    expect(floorUnderDeck(castle, 0.2).y).toBe(1.07);
    // and a small plane that happens to lie at the sunk deck's height (a
    // table top, a tread) never stands in for the floor
    const withTread = { floors: [plane(1.07, 708), plane(0.2, 100)] };
    expect(floorUnderDeck(withTread, 0.2).y).toBe(1.07);
  });
});
