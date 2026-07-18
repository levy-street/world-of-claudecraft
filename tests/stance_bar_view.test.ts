// Pure view-core tests for the warrior stance bar (src/ui/stance_bar_view.ts):
// the HUD render model that maps the known stance ids + the worn stance to the
// #stancebar buttons. Node-only, no DOM (UI_PURE_CORES). The sim-side stance
// behavior (reconcile, exclusive group, stat folds) is pinned in
// tests/v026_winning_warrior_contract.test.ts; this file covers only the
// presentation model plus the def contract the HUD's filter relies on.

import { describe, expect, it } from 'vitest';
import { WARRIOR_STANCE_IDS } from '../src/sim/combat/warrior_stances';
import { ABILITIES } from '../src/sim/content/classes';
import { stanceBarView, WARRIOR_STANCE_GROUP } from '../src/ui/stance_bar_view';

describe('stanceBarView (HUD render model)', () => {
  it('hides for non-warriors and when no stance is known', () => {
    expect(stanceBarView(false, ['battle_stance'], 'battle_stance').visible).toBe(false);
    expect(stanceBarView(true, [], null).visible).toBe(false);
  });

  it('builds one slot per known stance and marks the active one', () => {
    const m = stanceBarView(true, ['battle_stance', 'defensive_stance'], 'battle_stance');
    expect(m.visible).toBe(true);
    expect(m.slots.map((s) => s.id)).toEqual(['battle_stance', 'defensive_stance']);
    expect(m.slots.map((s) => s.iconKey)).toEqual(['battle_stance', 'defensive_stance']);
    expect(m.slots.map((s) => s.active)).toEqual([true, false]);
    // sig is stable for the same inputs and changes when the active stance changes.
    expect(m.sig).toBe(
      stanceBarView(true, ['battle_stance', 'defensive_stance'], 'battle_stance').sig,
    );
    expect(m.sig).not.toBe(
      stanceBarView(true, ['battle_stance', 'defensive_stance'], 'defensive_stance').sig,
    );
  });

  it('with no active stance no slot is marked and the sig still differs', () => {
    const m = stanceBarView(true, ['battle_stance', 'defensive_stance'], null);
    expect(m.visible).toBe(true);
    expect(m.slots.map((s) => s.active)).toEqual([false, false]);
    expect(m.sig).not.toBe(
      stanceBarView(true, ['battle_stance', 'defensive_stance'], 'battle_stance').sig,
    );
  });

  it('every known-stance def carries the group the HUD filters by', () => {
    expect(WARRIOR_STANCE_IDS.length).toBeGreaterThan(0);
    for (const id of WARRIOR_STANCE_IDS) {
      expect(ABILITIES[id]?.exclusiveGroup).toBe(WARRIOR_STANCE_GROUP);
    }
  });
});
