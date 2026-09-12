import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { emptyModifiers } from '../src/sim/content/talents';
import { ABILITIES } from '../src/sim/data';
import { classAbilityNamesEn } from '../src/ui/i18n.catalog/abilities';

// The ability/spell tooltip (hud.ts abilityTooltip over
// ability_tooltip_lines.ts describeAbilitySummary) renders
// the RESOLVED ability (res.cost / res.castTime / res.cooldown / res.effects), not the
// base def, so a selected talent's cost/cast/cooldown/damage reduction shows up. This
// pins the data contract those tooltips depend on: abilitiesKnownAt(cls, lvl, mods) bakes
// the talent modifiers into the resolved fields while leaving the base def untouched.
// Regression guard for "I select a talent and the spell tooltip doesn't update" (the
// cooldown line used to read res.def.cooldown and ignored cooldown-reducing talents).

// Chronomancy gating (mage-chronomancy.md Phase 1): fire_blast now belongs to
// the DPS specs, so every resolution here rides a fire-spec build.
function modsFor(
  ability: string,
  mod: Partial<
    Record<'dmgPct' | 'flatDmg' | 'costPct' | 'cooldownPct' | 'castPct' | 'buffPct', number>
  >,
) {
  const m = emptyModifiers();
  m.spec = 'fire';
  m.abilities[ability] = {
    dmgPct: 0,
    dmgPctVsDotted: 0,
    flatDmg: 0,
    costPct: 0,
    cooldownPct: 0,
    critPct: 0,
    cooldownFlat: 0,
    castPct: 0,
    buffPct: 0,
    castWhileMoving: false,
    damagePushbackImmune: false,
    ignoreStealthRequirement: false,
    bonusCharges: 0,
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
  const baseMods = emptyModifiers();
  baseMods.spec = 'fire';
  const baseKnown = resolved('mage', 'fire_blast', baseMods)!;

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
    const base = resolved('paladin', 'devotion_ward', emptyModifiers())!;
    const baseBuff = base.effects.find((e) => e.type === 'buffTarget') as { value: number };
    expect(baseBuff.value).toBeGreaterThan(0);
    const known = resolved('paladin', 'devotion_ward', modsFor('devotion_ward', { buffPct: 0.2 }))!;
    const buff = known.effects.find((e) => e.type === 'buffTarget') as { value: number };
    expect(buff.value).toBeCloseTo(baseBuff.value * 1.2, 10);
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

describe('druid Wolf Form mobility pass (tooltip data)', () => {
  const known = (level: number) =>
    abilitiesKnownAt('druid', level, emptyModifiers()).map((k) => k.def.id);

  it('Dash is learned at 12 (was 18) with every other number unchanged', () => {
    expect(ABILITIES.dash.learnLevel).toBe(12);
    expect(known(11)).not.toContain('dash');
    expect(known(12)).toContain('dash');
    expect(ABILITIES.dash.cooldown).toBe(60);
    expect(ABILITIES.dash.offGcd).toBe(true);
    expect(ABILITIES.dash.requiresForm).toBe('cat');
    expect(ABILITIES.dash.effects).toEqual([
      { type: 'selfBuff', kind: 'buff_speed', value: 1.5, duration: 15 },
    ]);
  });

  it('Wolf Form and Fleet Form tooltips state the baseline mobility rules', () => {
    expect(ABILITIES.cat_form.learnLevel).toBe(4);
    expect(ABILITIES.cat_form.description).toContain('you move 15% faster');
    expect(ABILITIES.travel_form.learnLevel).toBe(11);
    expect(ABILITIES.travel_form.description).toContain(
      'increasing movement speed by 40% and removing breakable roots and slows',
    );
  });

  it('the English catalog carries the same prose as the sim defs (one wording, two files)', () => {
    const en = classAbilityNamesEn.entities.abilities;
    expect(en.cat_form.description).toBe(ABILITIES.cat_form.description);
    expect(en.travel_form.description).toBe(ABILITIES.travel_form.description);
    expect(en.dash.description).toBe(ABILITIES.dash.description);
  });
});
