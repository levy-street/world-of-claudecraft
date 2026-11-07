// A short-reach ability (a taunt, an 8 yd strike) against a towering boss
// measures to the edge of its body like the melee does: the warrior's Goad
// reaches the Guardian of the Heat from the wellspring's lip, where the tank
// stands (found by the Smith's Heart raid bots, 2026-11-04: the tank's Goad
// was "Out of range" for the whole fight).
import { describe, expect, it } from 'vitest';
import { effectivePlayerAttackRange } from '../src/sim/combat/player_attack_reach';
import { MOBS } from '../src/sim/data';

const HEAT = 'heart_heat_guardian';

describe('short reach to a towering body', () => {
  it('Goad (8 yd) reaches the Heat guardian from its body edge', () => {
    const r = MOBS[HEAT].bodyRadius ?? 0;
    expect(r).toBeGreaterThan(0);
    expect(effectivePlayerAttackRange({ kind: 'mob', templateId: HEAT }, 8)).toBe(8 + r);
  });
  it('a long-range spell and a body-less mob keep their authored range', () => {
    expect(effectivePlayerAttackRange({ kind: 'mob', templateId: HEAT }, 30)).toBe(30);
    expect(effectivePlayerAttackRange({ kind: 'mob', templateId: 'forest_wolf' }, 8)).toBe(8);
  });
  it("keeps an older dungeon's towering boss at its tuned short reach", () => {
    const old = Object.entries(MOBS).find(
      ([id, m]) => (m.bodyRadius ?? 0) > 0 && !id.startsWith('heart_'),
    );
    expect(old, 'a non-raid template with a body radius').toBeTruthy();
    expect(effectivePlayerAttackRange({ kind: 'mob', templateId: old?.[0] ?? '' }, 8)).toBe(8);
  });
});
