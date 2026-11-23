import { afterEach, describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/data';
import { Sim } from '../src/sim/sim';
import { abilityDisplayDescription, abilityEffectText } from '../src/ui/ability_description';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { ensureLocaleLoaded, setLanguage } from '../src/ui/i18n';
import { EMPTY_TEST_WORLD } from './sim_shared';

afterEach(() => setLanguage('en'));

describe('Shadow Choir descriptions', () => {
  function resolved(spec: 'shadow' | 'holy') {
    const sim = new Sim({ seed: 91, playerClass: 'priest', world: EMPTY_TEST_WORLD });
    sim.setPlayerLevel(20);
    expect(sim.applyTalents({ spec, rows: { 17: 'pri_r17_choir_of_deliverance' } })).toBe(true);
    const ability = sim.resolvedAbility('choir_of_deliverance');
    if (!ability) throw new Error('Missing Choir');
    return ability;
  }

  it('describes the resolved Shadow action without the healer channel, even without a spec argument', () => {
    const ability = resolved('shadow');
    const description = abilityDisplayDescription(ability, abilityEffectText(ability));
    expect(description).toContain('For 15 sec');
    expect(description).toContain('20%');
    expect(description).toContain('subgroup');
    expect(description).toContain('Absorbed damage and overkill');
    expect(description).not.toContain('Channel for');
    expect(description).not.toMatch(/\{[^}]+\}|\$d/);
    expect(ABILITIES.choir_of_deliverance.channel?.duration).toBe(6);
    expect(ABILITIES.choir_of_deliverance.school).toBe('holy');
  });

  it('keeps the original healing channel description for Holy', () => {
    const ability = resolved('holy');
    expect(abilityDisplayDescription(ability, abilityEffectText(ability))).toContain(
      'Channel for 6 sec',
    );
  });

  it('uses the Spanish Shadow description', async () => {
    await ensureLocaleLoaded('es_ES');
    setLanguage('es_ES');
    const ability = resolved('shadow');
    const description = abilityDisplayDescription(ability, abilityEffectText(ability));
    expect(description).toContain('15');
    expect(description).toContain('20%');
    expect(description).toContain('subgrupo');
    expect(description).not.toContain('For 15 sec');
  });

  it('does not invent a zero-percent damage bonus on the Shadow Choir aura', () => {
    expect(
      auraEffectDescriptor({ id: 'choir_of_deliverance', kind: 'buff_dmg_done', value: 0 }),
    ).toBeNull();
    expect(
      auraEffectDescriptor({ id: 'other_buff', kind: 'buff_dmg_done', value: 0 }),
    ).not.toBeNull();
  });
});
