import { describe, expect, it } from 'vitest';
import { auraEffectDescriptor } from '../src/ui/aura_effect';
import { instanceBonusStatLines } from '../src/ui/item_instance_tooltip';

describe('Last Flame enchant live tooltip facts', () => {
  it('shows the actual Strength buff magnitude', () => {
    expect(auraEffectDescriptor({ kind: 'buff_str', value: 50 })).toMatchObject({
      key: 'hudChrome.auraEffect.increase.str',
      nums: { value: 50 },
    });
  });

  it('explains the weapon proc on an enchanted copy even without flat bonus stats', () => {
    const html = instanceBonusStatLines({ enchant: 'enchant_weapon_lastflame_zeal' });
    expect(html).toContain('50 Strength');
    expect(html).toContain('15 sec');
    expect(html).toContain('200');
    expect(html).not.toContain('+50');
  });
});
