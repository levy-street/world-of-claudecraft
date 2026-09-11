// Every walk-in Tidehold building's authored ground-floor DECK must sit on the
// model's visible floor. The sim measures override space from the model's
// LOWEST vertex (the loader seats that on the ground), so a restyle that adds
// a base course under the origin silently drops every deck by that much:
// the castle's floor read 0.87 yd above its deck and the player waded
// waist-deep through the keep (Troy, 2026-09-07).
// scripts/assets/tidehold_rebase_overrides.mjs re-seats them; this pins it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error - shared zero-dep JS tool (no .d.ts); same pattern as tests/i18n_completeness.test.ts.
import { measureFloors } from '../scripts/assets/tidehold_rebase_overrides.mjs';

const BUILDINGS = ['castle', 'castle_b', 'hall', 'bank', 'market', 'smithy', 'tavern'];

describe('Tidehold building decks', () => {
  it('put the main floor deck on the model floor, measured from the model base', async () => {
    const overrides = JSON.parse(readFileSync('data/asset_collision_overrides.json', 'utf8')) as Record<
      string,
      { ramps?: { hx: number; hz: number; y0: number; y1: number }[] }
    >;
    for (const b of BUILDINGS) {
      const m = await measureFloors(`public/models/tidehold/${b}.glb`);
      const norm = 2.2 / m.maxDim;
      const main = (overrides[`tidehold/${b}`].ramps ?? [])
        .filter((r) => Math.abs(r.y1 - r.y0) < 1e-6)
        .sort((a, c) => c.hx * c.hz - a.hx * a.hz)[0];
      expect(main, b).toBeTruthy();
      const deck = main.y0 / norm;
      const floor = m.floors[0].y;
      // within a foot of the boards: a deck under the floor sinks the player,
      // one far above floats them.
      expect(Math.abs(deck - floor), `${b}: deck ${deck.toFixed(2)} vs floor ${floor.toFixed(2)}`).toBeLessThan(0.2);
    }
  }, 60000);
});
