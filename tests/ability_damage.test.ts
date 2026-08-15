import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import {
  computeTalentModifiers,
  emptyAllocation,
  emptyModifiers,
  type TalentModifiers,
} from '../src/sim/content/talents';
import {
  abilityScalingPower,
  absorbBonus,
  channelTickBonus,
  directHealBonus,
  directHitBonus,
  dotTickBonus,
  hotTickBonus,
} from '../src/sim/spell_scaling';
import { MAX_LEVEL } from '../src/sim/types';
import {
  type AbilityScaling,
  abilityBuffValue,
  abilityDamageBonus,
  abilityTemporalHourglassValues,
} from '../src/ui/ability_damage';
import { abilityEffectText } from '../src/ui/hud';

function known(cls: Parameters<typeof abilitiesKnownAt>[0], id: string, mods?: TalentModifiers) {
  const ability = abilitiesKnownAt(cls, MAX_LEVEL, mods).find((k) => k.def.id === id);
  if (!ability) throw new Error(`missing ability ${id}`);
  return ability;
}

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('missing expected effect');
  return value;
}

const SC: AbilityScaling = { spellPower: 80, rangedPower: 200, attackPower: 140 };
const ARCANE_MODS = { ...emptyModifiers(), spec: 'arcane' as const };
const FROST_MODS = { ...emptyModifiers(), spec: 'frost' as const };
const SURVIVAL_MODS = computeTalentModifiers('hunter', {
  ...emptyAllocation(),
  spec: 'survival',
} as never);
const SPIRITMEND_MODS = computeTalentModifiers('shaman', {
  ...emptyAllocation(),
  spec: 'restoration',
} as never);
const DESTRUCTION_MODS = computeTalentModifiers('warlock', {
  ...emptyAllocation(),
  spec: 'destruction',
} as never);
const PROT_MODS = computeTalentModifiers('warrior', {
  ...emptyAllocation(),
  spec: 'prot',
} as never);

describe('abilityDamageBonus (tooltip scaling mirrors combat)', () => {
  it('renders Direhowl from its percentage damage reduction, not the retired AP amount', () => {
    expect(abilityBuffValue(known('warrior', 'demoralizing_shout', PROT_MODS))).toBe(20);
  });

  it('reads Hourglass healing and cooldown percentages from the resolved effect', () => {
    const mods = computeTalentModifiers('mage', {
      ...emptyAllocation(),
      spec: 'arcane',
    } as never);
    const hourglass = abilitiesKnownAt('mage', MAX_LEVEL, mods).find(
      (ability) => ability.def.id === 'temporal_hourglass',
    );
    expect(hourglass).toBeDefined();
    if (!hourglass) return;
    expect(abilityTemporalHourglassValues(hourglass)).toEqual({
      healing: 30,
      hostilePveDuration: 60,
      hostilePvpDuration: 10,
      groundDuration: 30,
      selfCooldownRecovery: 100,
      allyCooldownRecovery: 75,
    });
  });

  it('a direct nuke folds Spell Power with the rank-resolved cast time', () => {
    const fb = known('mage', 'frostbolt');
    const eff = required(fb.effects.find((e) => e.type === 'directDamage'));
    expect(abilityDamageBonus(fb, eff, SC)).toBe(
      directHitBonus(SC.spellPower, fb.def, fb.castTime, false),
    );
    expect(abilityDamageBonus(fb, eff, SC)).toBeGreaterThan(0);
  });

  it('an AoE nuke takes the AoE-penalised coefficient', () => {
    const ae = known('mage', 'arcane_explosion', ARCANE_MODS);
    const eff = required(ae.effects.find((e) => e.type === 'aoeDamage'));
    expect(abilityDamageBonus(ae, eff, SC)).toBe(
      directHitBonus(SC.spellPower, ae.def, ae.castTime, true),
    );
  });

  it('a pure DoT folds Spell Power across all its ticks (the total)', () => {
    const swp = known('priest', 'shadow_word_pain');
    const eff = required(swp.effects.find((e) => e.type === 'dot'));
    if (eff.type !== 'dot') throw new Error('expected dot');
    const ticks = eff.duration / eff.interval;
    expect(abilityDamageBonus(swp, eff, SC)).toBe(
      dotTickBonus(SC.spellPower, swp.def, eff.duration, eff.interval) * ticks,
    );
  });

  it('a hunter attack-spell scales off Ranged Attack Power, not Spell Power', () => {
    const as = known('hunter', 'arcane_shot');
    const eff = required(as.effects.find((e) => e.type === 'directDamage'));
    expect(abilityScalingPower(SC, as.def)).toBe(SC.rangedPower);
    expect(abilityDamageBonus(as, eff, SC)).toBe(
      directHitBonus(SC.rangedPower, as.def, as.castTime, false),
    );
  });

  it('Bloodhook uses the same Ranged Attack Power wound bonus that combat snapshots', () => {
    const bloodhook = known('hunter', 'bloodhook', SURVIVAL_MODS);
    const effect = required(
      bloodhook.effects.find((candidate) => candidate.type === 'hunterBloodhook'),
    );
    expect(abilityDamageBonus(bloodhook, effect, { ...SC, rangedPower: 0 })).toBe(0);
    // 2026-08-09 120s band round: the survival baseline meleeDmgPct stepped
    // 0.06 to 0.3 (the rest of the raise rides the baseline agiPct), so the 34
    // base and 200*0.26 rider re-derive at 1.3x.
    expect(abilityDamageBonus(bloodhook, effect, SC)).toBe(68);
    expect(abilityEffectText(bloodhook, SC)).toBe('44.2 (+68)');
  });

  it('a channelled directDamage (Arcane Missiles) uses the per-tick CHANNEL coefficient', () => {
    const am = known('mage', 'arcane_missiles', ARCANE_MODS);
    const eff = required(am.effects.find((e) => e.type === 'directDamage'));
    // It is a per-missile channel tick, so it must use the channel coefficient, not
    // the single-cast direct coefficient.
    expect(abilityDamageBonus(am, eff, SC)).toBe(channelTickBonus(SC.spellPower, am.def));
  });

  it('a drain channel (Mind Flay) folds the per-tick channel coefficient', () => {
    const mf = known('priest', 'mind_flay');
    const eff = required(mf.effects.find((e) => e.type === 'drainTick'));
    expect(abilityDamageBonus(mf, eff, SC)).toBe(channelTickBonus(SC.spellPower, mf.def));
  });

  it('a melee weaponStrike adds nothing here (Attack Power rides the swing)', () => {
    const ss = known('rogue', 'sinister_strike');
    const eff = required(ss.effects.find((e) => e.type === 'weaponStrike'));
    expect(abilityDamageBonus(ss, eff, SC)).toBe(0);
  });

  it('a rogue finisher folds Attack Power / 14 into its base', () => {
    const ev = known('rogue', 'eviscerate');
    const eff = required(ev.effects.find((e) => e.type === 'finisherDamage'));
    expect(abilityDamageBonus(ev, eff, SC)).toBe(Math.round(SC.attackPower / 14));
  });

  it('a direct heal folds Spell Power at the cast-time coefficient (combat directHealBonus)', () => {
    const heal = abilitiesKnownAt('priest', MAX_LEVEL).find((k) =>
      k.effects.some((e) => e.type === 'heal'),
    )!;
    const eff = required(heal.effects.find((e) => e.type === 'heal'));
    expect(abilityDamageBonus(heal, eff, SC)).toBe(directHealBonus(SC.spellPower, heal.castTime));
    expect(abilityDamageBonus(heal, eff, SC)).toBeGreaterThan(0);
  });

  it('Cascading Mend shows the same Spell Power bonus as its first combat heal', () => {
    const chain = known('shaman', 'chain_heal', SPIRITMEND_MODS);
    const effect = required(chain.effects.find((candidate) => candidate.type === 'chainHeal'));
    expect(abilityDamageBonus(chain, effect, { ...SC, spellPower: 0 })).toBe(0);
    expect(abilityDamageBonus(chain, effect, { ...SC, spellPower: 100 })).toBe(
      directHealBonus(100, chain.castTime),
    );
    expect(abilityEffectText(chain, { ...SC, spellPower: 0 })).toBe('120 to 145');
    expect(abilityEffectText(chain, { ...SC, spellPower: 100 })).toMatch(/^120 to 145 \(\+\d+\)$/);
  });

  it('a personal mage barrier shows the same Spell Power bonus combat applies', () => {
    const barrier = known('mage', 'ice_barrier', FROST_MODS);
    const eff = required(barrier.effects.find((e) => e.type === 'absorb'));
    if (eff.type !== 'absorb') throw new Error('expected absorb');
    expect(abilityDamageBonus(barrier, eff, SC)).toBe(absorbBonus(SC.spellPower, 0.5));
  });

  it('a pure HoT folds Spell Power across all its ticks; a hybrid HoT rider does not', () => {
    const rejuv = known('druid', 'rejuvenation');
    const hot = required(rejuv.effects.find((e) => e.type === 'hot'));
    if (hot.type !== 'hot') throw new Error('expected hot');
    const ticks = hot.duration / hot.interval;
    expect(abilityDamageBonus(rejuv, hot, SC)).toBe(
      hotTickBonus(SC.spellPower, hot.duration, hot.interval) * ticks,
    );
    // Regrowth's HoT rides a direct heal: combat suppresses the rider (the
    // direct part already took the coefficient), so the tooltip must too.
    const regrowth = known('druid', 'regrowth');
    const rider = required(regrowth.effects.find((e) => e.type === 'hot'));
    expect(abilityDamageBonus(regrowth, rider, SC)).toBe(0);
  });

  it('a ground AoE pulse folds the AoE-penalised direct coefficient (combat spBonus)', () => {
    const protection = computeTalentModifiers(
      'paladin',
      { spec: 'protection', ranks: {}, choices: {} },
      MAX_LEVEL,
    );
    const cons = known('paladin', 'consecration', protection);
    const eff = required(cons.effects.find((e) => e.type === 'groundAoE'));
    expect(abilityDamageBonus(cons, eff, SC)).toBe(
      directHitBonus(SC.spellPower, cons.def, cons.castTime, true),
    );
  });

  it('the reworked Rain of Fire ground pulse uses the AoE-penalised direct coefficient', () => {
    const rof = known('warlock', 'rain_of_fire', DESTRUCTION_MODS);
    const eff = required(rof.effects.find((e) => e.type === 'groundAoE'));
    expect(abilityDamageBonus(rof, eff, SC)).toBe(
      directHitBonus(SC.spellPower, rof.def, rof.castTime, true),
    );
  });
});
