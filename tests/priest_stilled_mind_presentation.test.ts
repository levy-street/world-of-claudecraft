import { afterEach, expect, it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { abilityDisplayDescription, abilityEffectText } from '../src/ui/ability_description';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { resolveAuraIconId } from '../src/ui/aura_icon_view';
import { setLanguage } from '../src/ui/i18n';
import { EMPTY_TEST_WORLD } from './sim_shared';

afterEach(() => setLanguage('en'));

it('shows the independent critical reservation only for Shadow', () => {
  const sim = new Sim({ seed: 91, playerClass: 'priest', world: EMPTY_TEST_WORLD });
  sim.setPlayerLevel(20);
  expect(sim.applyTalents({ spec: 'shadow', rows: { 14: 'pri_r11_inner_focus' } })).toBe(true);
  const ability = sim.resolvedAbility('inner_focus');
  if (!ability) throw new Error('Missing Stilled Mind');
  const description = (spec: 'shadow' | 'holy') =>
    abilityDisplayDescription(ability, abilityEffectText(ability), undefined, undefined, spec);
  expect(description('shadow')).toContain('next Mindfracture or Void Rupture within 60 sec');
  expect(description('shadow')).toContain('Other spells do not consume');
  expect(description('shadow')).toContain('3 Gloomtithe charges');
  expect(description('shadow')).toContain('A resisted cast consumes');
  expect(description('holy')).toContain('costs no Mana');
  expect(description('holy')).not.toContain('guaranteed');
});

it('describes the reserved critical hit and retains the Stilled Mind icon', () => {
  const aura = { id: 'priest_stilled_mind_crit', kind: 'buff_dmg_done' as const, value: 0 };
  expect(auraEffectDescriptor(aura)?.key).toMatch(/\.stilledMindCrit$/);
  expect(
    resolveAuraIconId(
      aura,
      (id) => id === 'inner_focus',
      () => false,
      () => false,
    ),
  ).toBe('inner_focus');
});
