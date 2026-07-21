// Cross-form-shift billing (spendAbilityCost's 'cross' branch): the parked-mana
// debit only applies when the CURRENT form swapped the resource bar (bear/cat
// park mana). A caster form (moonkin/shadow) keeps the live mana bar, so a
// cross-shift out of it must bill live mana; billing savedMana there hits a
// stale pool and the real cost silently vanishes (regression introduced when
// formShiftKind was broadened to all form kinds).

import { describe, expect, it } from 'vitest';
import { recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';

const CAT_FORM_COST = 30;
const BEAR_FORM_COST = 30;
const GCD_SETTLE_TICKS = 32;

function makeDruid() {
  const sim = new Sim({ seed: 11, playerClass: 'druid' });
  sim.setPlayerLevel(12);
  const p = sim.player;
  p.resource = p.maxResource;
  return { sim, p };
}

/** Enter moonkin through the real stat path: push the toggle aura, recalc. */
function shiftToMoonkin(sim: Sim): void {
  const p = sim.player;
  const meta = sim.meta(p.id)!;
  p.auras.push({
    id: 'moonkin_form',
    name: 'Moonwing Form',
    kind: 'form_moonkin',
    remaining: 3600,
    duration: 3600,
    value: 0,
    sourceId: p.id,
    school: 'arcane',
  });
  recalcPlayerStats(p, meta.cls, meta.equipment, meta.talentMods, meta.equipmentInstance);
}

function settle(sim: Sim): void {
  for (let i = 0; i < GCD_SETTLE_TICKS; i++) sim.tick();
}

describe('cross-form-shift resource billing', () => {
  it('bills live mana when cross-shifting out of a caster form (moonkin to cat)', () => {
    // Arrange: moonkin keeps the live mana bar (no resource shift).
    const { sim, p } = makeDruid();
    shiftToMoonkin(sim);
    expect(p.resourceType).toBe('mana');
    const manaBefore = p.resource;

    // Act: cross-shift straight to cat form.
    sim.castAbility('cat_form');
    sim.tick();

    // Assert: the cat entry parked the LIVE pool minus the cast cost. A stale
    // savedMana debit would leave the parked pool at manaBefore instead.
    expect(p.auras.some((a) => a.kind === 'form_cat')).toBe(true);
    expect(p.auras.some((a) => a.kind === 'form_moonkin')).toBe(false);
    expect(p.resourceType).toBe('energy');
    expect(p.savedMana).toBe(manaBefore - CAT_FORM_COST);
  });

  it('still bills the parked pool when cross-shifting between bar-swapping forms (cat to bear)', () => {
    // Arrange: enter cat from caster form (bills live mana, then parks the rest).
    const { sim, p } = makeDruid();
    const manaBefore = p.resource;
    sim.castAbility('cat_form');
    sim.tick();
    expect(p.resourceType).toBe('energy');
    expect(p.savedMana).toBe(manaBefore - CAT_FORM_COST);

    // Act: cross-shift to bear while the mana pool is parked.
    settle(sim);
    sim.castAbility('bear_form');
    sim.tick();

    // Assert: the bear cost came out of the parked pool, not the form bar.
    expect(p.auras.some((a) => a.kind === 'form_bear')).toBe(true);
    expect(p.resourceType).toBe('rage');
    expect(p.savedMana).toBe(manaBefore - CAT_FORM_COST - BEAR_FORM_COST);
  });
});
