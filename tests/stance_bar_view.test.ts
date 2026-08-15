// Pure view-core tests for the warrior stance bar (src/ui/stance_bar_view.ts):
// the HUD render model that maps the known stance ids + the worn stance to the
// #stancebar buttons. Node-only, no DOM (UI_PURE_CORES). The sim-side stance
// behavior (reconcile, exclusive group, stat folds) is pinned in
// tests/v026_winning_warrior_contract.test.ts; this file covers only the
// presentation model plus the def contract the HUD's filter relies on.

import { describe, expect, it } from 'vitest';
import { WARRIOR_STANCE_IDS } from '../src/sim/combat/warrior_stances';
import { ABILITIES } from '../src/sim/content/classes';
import {
  activeStanceBarAbilityId,
  isStanceBarAbilityGroup,
  PALADIN_DEVOTION_GROUP,
  stanceBarView,
  WARRIOR_STANCE_GROUP,
} from '../src/ui/stance_bar_view';

describe('stanceBarView (HUD render model)', () => {
  it('hides for non-warriors and when no stance is known', () => {
    expect(stanceBarView('mage', ['battle_stance'], 'battle_stance').visible).toBe(false);
    expect(stanceBarView('warrior', [], null).visible).toBe(false);
  });

  it('builds one slot per known stance and marks the active one', () => {
    const m = stanceBarView('warrior', ['battle_stance', 'defensive_stance'], 'battle_stance');
    expect(m.visible).toBe(true);
    expect(m.slots.map((s) => s.id)).toEqual(['battle_stance', 'defensive_stance']);
    expect(m.slots.map((s) => s.iconKey)).toEqual(['battle_stance', 'defensive_stance']);
    expect(m.slots.map((s) => s.active)).toEqual([true, false]);
    // sig is stable for the same inputs and changes when the active stance changes.
    expect(m.sig).toBe(
      stanceBarView('warrior', ['battle_stance', 'defensive_stance'], 'battle_stance').sig,
    );
    expect(m.sig).not.toBe(
      stanceBarView('warrior', ['battle_stance', 'defensive_stance'], 'defensive_stance').sig,
    );
  });

  it('with no active stance no slot is marked and the sig still differs', () => {
    const m = stanceBarView('warrior', ['battle_stance', 'defensive_stance'], null);
    expect(m.visible).toBe(true);
    expect(m.slots.map((s) => s.active)).toEqual([false, false]);
    expect(m.sig).not.toBe(
      stanceBarView('warrior', ['battle_stance', 'defensive_stance'], 'battle_stance').sig,
    );
  });

  it('uses one choice row only for the two Paladin auras', () => {
    const ids = ['devotion_ward', 'retribution_aura'];
    const m = stanceBarView('paladin', ids, 'retribution_aura');

    expect(m.visible).toBe(true);
    expect(m.slots).toEqual([
      { id: 'devotion_ward', iconKey: 'devotion_ward', active: false },
      { id: 'retribution_aura', iconKey: 'retribution_aura', active: true },
    ]);
  });

  it('marks the Paladin own choice active when another Paladin aura coexists', () => {
    expect(
      activeStanceBarAbilityId(
        ['devotion_ward', 'retribution_aura'],
        [
          { id: 'devotion_ward', sourceId: 99 },
          { id: 'retribution_aura', sourceId: 7 },
        ],
        7,
      ),
    ).toBe('retribution_aura');
  });

  it('every known-stance def carries the group the HUD filters by', () => {
    expect(WARRIOR_STANCE_IDS.length).toBeGreaterThan(0);
    for (const id of WARRIOR_STANCE_IDS) {
      expect(ABILITIES[id]?.exclusiveGroup).toBe(WARRIOR_STANCE_GROUP);
    }
  });

  it('routes only Paladin auras through the dedicated row group', () => {
    for (const id of ['devotion_ward', 'retribution_aura']) {
      expect(ABILITIES[id]?.exclusiveGroup).toBe(PALADIN_DEVOTION_GROUP);
    }
    for (const id of ['radiant_devotion', 'dawn_devotion', 'grace_devotion']) {
      expect(ABILITIES[id]?.exclusiveGroup).toBeUndefined();
    }
    expect(isStanceBarAbilityGroup(WARRIOR_STANCE_GROUP)).toBe(true);
    expect(isStanceBarAbilityGroup(PALADIN_DEVOTION_GROUP)).toBe(true);
  });
});
