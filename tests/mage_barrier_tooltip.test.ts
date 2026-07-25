import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { emptyModifiers } from '../src/sim/content/talents';
import { abilityEffectText } from '../src/ui/hud';

describe('mage personal barrier tooltip', () => {
  it('shows the rank base and the live Spell Power contribution', () => {
    const mods = emptyModifiers();
    mods.spec = 'frost';
    const barrier = abilitiesKnownAt('mage', 20, mods).find(
      (known) => known.def.id === 'ice_barrier',
    );
    if (!barrier) throw new Error('missing ice_barrier');

    expect(abilityEffectText(barrier, { spellPower: 80, rangedPower: 0, attackPower: 0 })).toBe(
      '130 (+40)',
    );
  });

  it('shows Temporal Barrier at its lower ally-shield coefficient', () => {
    const mods = emptyModifiers();
    mods.spec = 'arcane';
    const barrier = abilitiesKnownAt('mage', 20, mods).find(
      (known) => known.def.id === 'temporal_barrier',
    );
    if (!barrier) throw new Error('missing temporal_barrier');

    expect(abilityEffectText(barrier, { spellPower: 80, rangedPower: 0, attackPower: 0 })).toBe(
      '160 (+20)',
    );
  });
});
