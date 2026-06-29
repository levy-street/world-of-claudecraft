import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import {
  abilityScalingPower,
  channelTickBonus,
  directHitBonus,
  dotTickBonus,
} from '../src/sim/spell_scaling';
import { MAX_LEVEL } from '../src/sim/types';
import { type AbilityScaling, abilityDamageBonus } from '../src/ui/ability_damage';

function known(cls: Parameters<typeof abilitiesKnownAt>[0], id: string) {
  return abilitiesKnownAt(cls, MAX_LEVEL).find((k) => k.def.id === id)!;
}

const SC: AbilityScaling = { spellPower: 80, rangedPower: 200, attackPower: 140 };

describe('abilityDamageBonus (tooltip scaling mirrors combat)', () => {
  it('a direct nuke folds Spell Power with the rank-resolved cast time', () => {
    const fb = known('mage', 'frostbolt');
    const eff = fb.effects.find((e) => e.type === 'directDamage')!;
    expect(abilityDamageBonus(fb, eff, SC)).toBe(
      directHitBonus(SC.spellPower, fb.def, fb.castTime, false),
    );
    expect(abilityDamageBonus(fb, eff, SC)).toBeGreaterThan(0);
  });

  it('an AoE nuke takes the AoE-penalised coefficient', () => {
    const ae = known('mage', 'arcane_explosion');
    const eff = ae.effects.find((e) => e.type === 'aoeDamage')!;
    expect(abilityDamageBonus(ae, eff, SC)).toBe(
      directHitBonus(SC.spellPower, ae.def, ae.castTime, true),
    );
  });

  it('a pure DoT folds Spell Power across all its ticks (the total)', () => {
    const swp = known('priest', 'shadow_word_pain');
    const eff = swp.effects.find((e) => e.type === 'dot')!;
    if (eff.type !== 'dot') throw new Error('expected dot');
    const ticks = eff.duration / eff.interval;
    expect(abilityDamageBonus(swp, eff, SC)).toBe(
      dotTickBonus(SC.spellPower, swp.def, eff.duration, eff.interval) * ticks,
    );
  });

  it('a hunter attack-spell scales off Ranged Attack Power, not Spell Power', () => {
    const as = known('hunter', 'arcane_shot');
    const eff = as.effects.find((e) => e.type === 'directDamage')!;
    expect(abilityScalingPower(SC, as.def)).toBe(SC.rangedPower);
    expect(abilityDamageBonus(as, eff, SC)).toBe(
      directHitBonus(SC.rangedPower, as.def, as.castTime, false),
    );
  });

  it('a channelled directDamage (Arcane Missiles) uses the per-tick CHANNEL coefficient', () => {
    const am = known('mage', 'arcane_missiles');
    const eff = am.effects.find((e) => e.type === 'directDamage')!;
    // It is a per-missile channel tick, so it must use the channel coefficient, not
    // the single-cast direct coefficient.
    expect(abilityDamageBonus(am, eff, SC)).toBe(channelTickBonus(SC.spellPower, am.def));
  });

  it('a drain channel (Mind Flay) folds the per-tick channel coefficient', () => {
    const mf = known('priest', 'mind_flay');
    const eff = mf.effects.find((e) => e.type === 'drainTick')!;
    expect(abilityDamageBonus(mf, eff, SC)).toBe(channelTickBonus(SC.spellPower, mf.def));
  });

  it('a melee weaponStrike adds nothing here (Attack Power rides the swing)', () => {
    const ss = known('rogue', 'sinister_strike');
    const eff = ss.effects.find((e) => e.type === 'weaponStrike')!;
    expect(abilityDamageBonus(ss, eff, SC)).toBe(0);
  });

  it('a rogue finisher folds Attack Power / 14 into its base', () => {
    const ev = known('rogue', 'eviscerate');
    const eff = ev.effects.find((e) => e.type === 'finisherDamage')!;
    expect(abilityDamageBonus(ev, eff, SC)).toBe(Math.round(SC.attackPower / 14));
  });

  it('returns 0 for a heal (heals do not scale in this PR)', () => {
    const heal = abilitiesKnownAt('priest', MAX_LEVEL).find((k) =>
      k.effects.some((e) => e.type === 'heal'),
    )!;
    const eff = heal.effects.find((e) => e.type === 'heal')!;
    expect(abilityDamageBonus(heal, eff, SC)).toBe(0);
  });
});
