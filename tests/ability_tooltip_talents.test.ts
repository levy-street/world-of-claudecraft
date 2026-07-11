import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { emptyModifiers } from '../src/sim/content/talents';
import { ABILITIES } from '../src/sim/data';

// The ability/spell tooltip (hud.ts abilityTooltip / describeAbilitySummary) renders
// the RESOLVED ability (res.cost / res.castTime / res.cooldown / res.effects), not the
// base def, so a selected talent's cost/cast/cooldown/damage reduction shows up. This
// pins the data contract those tooltips depend on: abilitiesKnownAt(cls, lvl, mods) bakes
// the talent modifiers into the resolved fields while leaving the base def untouched.
// Regression guard for "I select a talent and the spell tooltip doesn't update" (the
// cooldown line used to read res.def.cooldown and ignored cooldown-reducing talents).

function modsFor(
  ability: string,
  mod: Partial<
    Record<'dmgPct' | 'flatDmg' | 'costPct' | 'cooldownPct' | 'castPct' | 'buffPct', number>
  >,
) {
  const m = emptyModifiers();
  m.abilities[ability] = {
    dmgPct: 0,
    flatDmg: 0,
    costPct: 0,
    cooldownPct: 0,
    castPct: 0,
    buffPct: 0,
    castWhileMoving: false,
    addEffects: [],
    ...mod,
  };
  return m;
}

const resolved = (
  cls: Parameters<typeof abilitiesKnownAt>[0],
  id: string,
  mods: ReturnType<typeof emptyModifiers>,
) => abilitiesKnownAt(cls, 20, mods).find((k) => k.def.id === id);

describe('ability tooltip data reflects selected talents', () => {
  // Compare the modified resolution against the UNMODIFIED resolution at the same level,
  // so the rank-at-level cost/cooldown is the baseline (not the rank-1 def values).
  const baseKnown = resolved('mage', 'fire_blast', emptyModifiers())!;

  it('a cooldown-reducing talent lowers the resolved cooldown (def untouched)', () => {
    expect(baseKnown.cooldown).toBeGreaterThan(0);
    const known = resolved('mage', 'fire_blast', modsFor('fire_blast', { cooldownPct: -0.3 }))!;
    expect(known.cooldown).toBeCloseTo(baseKnown.cooldown * 0.7, 5);
    // The base def is never mutated; only the resolved value drops. This is exactly why
    // the tooltip must read res.cooldown, not res.def.cooldown.
    expect(known.def.cooldown).toBe(ABILITIES.fire_blast.cooldown);
  });

  it('a cost-reducing talent lowers the resolved cost', () => {
    const known = resolved('mage', 'fire_blast', modsFor('fire_blast', { costPct: -0.25 }))!;
    expect(known.cost).toBe(Math.round(baseKnown.cost * 0.75));
    expect(known.def.cost).toBe(ABILITIES.fire_blast.cost);
  });

  it('a buff-strengthening talent (buffPct) raises the resolved buff value', () => {
    // Improved Devotion Aura / Aspect of the Hawk / Fortitude scale the buff's value,
    // which the tooltip's resolved buff line reads (the static description can't show it).
    const base = resolved('paladin', 'devotion_aura', emptyModifiers())!;
    const baseBuff = base.effects.find((e) => e.type === 'buffTarget') as { value: number };
    expect(baseBuff.value).toBeGreaterThan(0);
    const known = resolved('paladin', 'devotion_aura', modsFor('devotion_aura', { buffPct: 0.2 }))!;
    const buff = known.effects.find((e) => e.type === 'buffTarget') as { value: number };
    expect(buff.value).toBe(Math.round(baseBuff.value * 1.2));
  });

  it('a damage talent raises the resolved effect damage', () => {
    const basePrimary = baseKnown.effects.find((e) => e.type === 'directDamage') as
      | { min: number; max: number }
      | undefined;
    expect(basePrimary).toBeDefined();
    const known = resolved('mage', 'fire_blast', modsFor('fire_blast', { dmgPct: 0.5 }))!;
    const primary = known.effects.find((e) => e.type === 'directDamage') as {
      min: number;
      max: number;
    };
    expect(primary.max).toBeGreaterThan(basePrimary!.max);
  });
});
