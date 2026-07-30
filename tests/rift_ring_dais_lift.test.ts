import { describe, expect, it } from 'vitest';
import { DAIS_PLATFORM_HEIGHT, daisVisualLift } from '../src/render/dais_lift';
import { generateRiftFloor, isSetPieceSeed, riftFloorCount } from '../src/sim/rift/rift_gen';

// The raised boss dais is a render-only 0.6u platform (the sim keeps the dais
// walkable flat), so the death-zone danger ring must lift by the shared
// DAIS_PLATFORM_HEIGHT on it or the telegraph hides under the foundation
// blocks exactly where the boss is tanked (2026-07-21 S-raid playtest:
// "platform boss made the aoe circles invisible"). The renderer's ring
// groundY closure and placeDais both consume dais_lift.ts; this pins the
// shared math and that the case is live rift content.

describe('rift death-zone ring: raised dais lift', () => {
  it('lifts by the platform height on a raised dais, nowhere else', () => {
    const dais = { x: 0, z: 40, r: 10 };
    expect(daisVisualLift(dais, true, 0, 40)).toBe(DAIS_PLATFORM_HEIGHT);
    expect(daisVisualLift(dais, true, 0, 49.9)).toBe(DAIS_PLATFORM_HEIGHT);
    expect(daisVisualLift(dais, true, 0, 50.5)).toBe(0);
    expect(daisVisualLift(dais, false, 0, 40)).toBe(0);
    expect(daisVisualLift(null, true, 0, 40)).toBe(0);
    expect(daisVisualLift(undefined, true, 0, 40)).toBe(0);
  });

  it('raised-dais boss floors exist in live rift content (the case is not vacuous)', () => {
    let raised = 0;
    for (let s = 1; s < 400 && raised === 0; s++) {
      if (isSetPieceSeed(s)) continue;
      const floor = generateRiftFloor(s, 28, riftFloorCount(s) - 1);
      if (floor.style.daisRaised && floor.layout.dais) raised++;
    }
    expect(raised, 'at least one S boss floor raises its dais').toBeGreaterThan(0);
  });
});
