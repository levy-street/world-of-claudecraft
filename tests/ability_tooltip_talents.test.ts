import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import { emptyModifiers } from '../src/sim/content/talents';
import { ABILITIES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { abilityDisplayDescription, abilityEffectText } from '../src/ui/ability_description';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';

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
    dmgPctVsDotted: 0,
    flatDmg: 0,
    costPct: 0,
    cooldownPct: 0,
    castPct: 0,
    buffPct: 0,
    castWhileMoving: false,
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

  it('normal action tooltips resolve every extended grant placeholder', async () => {
    await ensureLocaleLoaded('en');
    setLanguage('en');
    const tooltip = (sim: Sim, id: string) => {
      const ability = sim.resolvedAbility(id);
      if (!ability) throw new Error(`missing ${id}`);
      return abilityDisplayDescription(ability, abilityEffectText(ability), {
        spellPower: 0,
        rangedPower: 0,
        attackPower: 0,
      });
    };
    const selected = (cls: Parameters<typeof abilitiesKnownAt>[0], row: number, choice: string) => {
      const sim = new Sim({ seed: 3, playerClass: cls });
      sim.setPlayerLevel(20);
      expect(sim.applyTalents({ spec: null, rows: { [row]: choice } })).toBe(true);
      return sim;
    };

    const protection = new Sim({ seed: 3, playerClass: 'paladin' });
    protection.setPlayerLevel(20);
    expect(protection.setSpec('protection')).toBe(true);
    const cases = [
      tooltip(protection, 'holy_shield'),
      tooltip(selected('paladin', 20, 'pal_r20_aura_mastery'), 'aura_surge'),
      tooltip(selected('paladin', 20, 'pal_r20_avenging_wrath'), 'avenging_wrath'),
      tooltip(selected('hunter', 20, 'hun_r20_aspect_of_the_wild'), 'aspect_of_the_wild'),
      tooltip(selected('shaman', 20, 'sha_r20_bloodlust'), 'bloodlust'),
      tooltip(selected('mage', 20, 'mag_r20_evocation'), 'evocation'),
      tooltip(selected('mage', 20, 'mag_r20_meteor'), 'meteor'),
      tooltip(selected('druid', 20, 'dru_r20_tranquility'), 'tranquility'),
    ];
    expect(cases.every((description) => !/\{[A-Za-z]/.test(description))).toBe(true);
    expect(cases[0]).toContain('90 to 110');
    expect(cases[0]).toContain('70%');
    expect(cases[1]).toContain('100 to 120');
    expect(cases[1]).toContain('75%');
    expect(cases[2]).toContain('60');
    expect(cases[2]).toContain('30');
    expect(cases[3]).toContain('45');
    expect(cases[4]).toContain('30%');
    expect(cases[5]).toContain('220');
    expect(cases[6]).toContain('12 to 18');
    expect(cases[7]).toContain('42 to 52');

    const combat = new Sim({ seed: 3, playerClass: 'rogue' });
    combat.setPlayerLevel(20);
    expect(combat.setSpec('combat')).toBe(true);
    const cravenThrust = tooltip(combat, 'backstab');
    expect(cravenThrust).toContain('135% weapon damage');
    expect(cravenThrust).not.toContain('150% weapon damage');
    const wickedSlash = combat.resolvedAbility('sinister_strike');
    if (!wickedSlash) throw new Error('missing Wicked Slash');
    const strike = wickedSlash.effects.find((effect) => effect.type === 'weaponStrike');
    if (!strike || strike.type !== 'weaponStrike') throw new Error('missing weapon strike');
    expect(tooltip(combat, 'sinister_strike')).toContain(
      `${Math.round((strike.weaponMult ?? 1) * 100)}% weapon damage`,
    );
  });
});
