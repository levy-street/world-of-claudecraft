import { describe, expect, it } from 'vitest';
import { abilitiesKnownAt } from '../src/sim/content/classes';
import {
  computeTalentModifiers,
  emptyAllocation,
  type TalentModifiers,
} from '../src/sim/content/talents';
import { computeCharacterModifiers } from '../src/sim/set_bonus_mods';
import { MAX_LEVEL } from '../src/sim/types';
import { abilityDisplayDescription, abilityEffectText } from '../src/ui/ability_description';

function known(id: string, mods?: TalentModifiers) {
  const ability = abilitiesKnownAt('warlock', MAX_LEVEL, mods).find((k) => k.def.id === id);
  if (!ability) throw new Error(`missing ability ${id}`);
  return ability;
}

describe('abilityDisplayDescription buff value override', () => {
  it('splices the caller-supplied buff value instead of the resolved ability default', () => {
    // Fiendhide's base rank-3 armor value is 80; Pact Deepened doubles it for its
    // owner. A viewer without the talent must still see the OWNER's real value
    // (a real bug: an aura tooltip previously re-resolved from the VIEWER's own
    // talents, showing the base 80 on another player's Fiendhide even after
    // Pact Deepened doubled it for its owner).
    const baseRes = known('demon_skin');
    const doubledMods: TalentModifiers = {
      ...computeTalentModifiers('warlock', {
        ...emptyAllocation(),
        rows: { 11: 'wlk_r11_improved_life_tap' },
      }),
    };
    const ownerRes = known('demon_skin', doubledMods);

    const ownerEffect = ownerRes.effects.find((e) => e.type === 'selfBuff');
    if (ownerEffect?.type !== 'selfBuff') throw new Error('missing selfBuff');

    const withoutOverride = abilityDisplayDescription(baseRes, '');
    const withOverride = abilityDisplayDescription(baseRes, '', undefined, {
      kind: 'buff_armor',
      value: ownerEffect.value,
    });

    expect(withoutOverride).toContain('80');
    expect(withOverride).toContain('160');
    expect(withOverride).not.toContain('80');
  });
});

describe('abilityDisplayDescription Temporal Echo conversion', () => {
  it('shows the resolved Chronoweave 2pc conversion instead of the base values', () => {
    const allocation = { ...emptyAllocation(), spec: 'arcane' };
    const equipment = {
      head: 'chronoweave_helmet',
      chest: 'chronoweave_chest',
    };
    const mods = computeCharacterModifiers('mage', allocation, MAX_LEVEL, equipment);
    const echo = abilitiesKnownAt('mage', MAX_LEVEL, mods).find(
      (ability) => ability.def.id === 'temporal_echo',
    );
    if (!echo) throw new Error('missing Temporal Echo');

    const text = abilityDisplayDescription(echo, '84-102');
    expect(text).toContain('50% of your other single-target Arcane damage');
    expect(text).toContain('15% of your area Arcane damage');
    expect(text).toContain('200% of the damage they deal');
    expect(text).not.toContain('160%');
  });
});

describe('Scouring Mercy damage and healing values', () => {
  it('renders the healing half with Healing Power independently of its damage buff', () => {
    const mods = computeTalentModifiers('priest', { ...emptyAllocation(), spec: 'discipline' });
    const mercy = abilitiesKnownAt('priest', MAX_LEVEL, mods).find(
      (k) => k.def.id === 'scouring_mercy',
    );
    if (!mercy) throw new Error('missing Scouring Mercy');
    const scaling = { spellPower: 80, healPower: 200, attackPower: 0, rangedPower: 0 };
    const text = abilityDisplayDescription(mercy, abilityEffectText(mercy, scaling), scaling);
    // Healing: rank base 130-155 plus round(200 * 2 * 1.5 / 3.5) = 171.
    expect(text).toContain('130 to 155 (+171)');
    const unscaled = abilityDisplayDescription(mercy, abilityEffectText(mercy));
    expect(unscaled).toContain('130 to 155');
    expect(unscaled).not.toContain('(+171)');
  });
});

describe('periodic total rounding', () => {
  it('shows six rounded Dirge ticks rather than an impossible fractional tick total', () => {
    const dirge = abilitiesKnownAt('priest', MAX_LEVEL).find(
      (k) => k.def.id === 'shadow_word_pain',
    );
    if (!dirge) throw new Error('missing Dirge');
    const resolved = {
      ...dirge,
      effects: [{ type: 'dot' as const, total: 154, duration: 18, interval: 3 }],
    };
    expect(abilityEffectText(resolved)).toBe('156');
  });
});

describe('Aegis of the First Dawn heal ranges', () => {
  it('splices the Holy Paladin primary-healing factor into both ranges, as combat applies it', () => {
    // paladin_aegis.ts heals scalePrimaryHealing(roll + Healing Power, 1.1) for
    // Holy, so even with no Healing Power the base reads 39 to 50 and 132 to 165.
    const mods = computeTalentModifiers('paladin', { ...emptyAllocation(), spec: 'holy' });
    const aegis = abilitiesKnownAt('paladin', MAX_LEVEL, mods).find(
      (k) => k.def.id === 'aegis_first_dawn',
    );
    if (!aegis) throw new Error('missing Aegis of the First Dawn');
    expect(aegis.outputScaling?.primaryHealing).toBe(1.1);
    const text = abilityDisplayDescription(aegis, abilityEffectText(aegis));
    expect(text).toContain('healed for 39 to 50 every second');
    expect(text).toContain('heals them for 132 to 165 more');
  });
});

describe('Blood Credit in the Hard Bargain and Cruel Pact tooltips', () => {
  it('shows the resolved mana the cast actually restores', () => {
    // Affliction trades Hard Bargain for Cruel Pact, so each reads its own spec.
    const mods = (spec: string, credit: boolean) =>
      computeTalentModifiers('warlock', {
        ...emptyAllocation(),
        spec,
        rows: credit ? { 14: 'wlk_r14_ruin' } : {},
      } as never);
    const text = (id: string, m: TalentModifiers) => {
      const res = known(id, m);
      return abilityDisplayDescription(res, abilityEffectText(res));
    };
    // Rank 3 Hard Bargain: 85 health for 85 mana, 128 with Blood Credit
    // (round(85 * 1.5)), the same 128 talent_nonwarrior_runtime_v026 casts.
    expect(text('life_tap', mods('destruction', false))).toContain(
      'Converts 85 health into 85 mana.',
    );
    expect(text('life_tap', mods('destruction', true))).toContain(
      'Converts 85 health into 128 mana.',
    );
    expect(text('cruel_pact', mods('affliction', false))).toContain(
      'restore 1.5% of your maximum mana',
    );
    expect(text('cruel_pact', mods('affliction', true))).toContain(
      // 1.5% x 1.5 = 2.25%, shown at the tooltip's one-decimal precision.
      'restore 2.3% of your maximum mana',
    );
  });
});
