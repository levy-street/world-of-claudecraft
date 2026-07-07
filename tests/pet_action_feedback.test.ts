import { describe, expect, it } from 'vitest';
import { formatNumber, t } from '../src/ui/i18n';
import {
  formatPetCooldownShort,
  petActionButtonLabels,
  petCooldownProgress,
} from '../src/ui/pet_action_feedback';

describe('pet action feedback', () => {
  it('formats cooldowns with units instead of a bare number', () => {
    const unit = t('hudChrome.unitFrame.durationUnitSeconds');
    expect(formatPetCooldownShort(6.1, formatNumber, unit)).toBe('7s');
    expect(formatPetCooldownShort(0.7, formatNumber, unit)).toBe('0.7s');
    expect(formatPetCooldownShort(0.01, formatNumber, unit)).toBe('0.1s');
  });

  it('clamps radial cooldown progress to 0..100', () => {
    expect(petCooldownProgress(5, 10)).toBe(50);
    expect(petCooldownProgress(12, 10)).toBe(100);
    expect(petCooldownProgress(-1, 10)).toBe(0);
    expect(petCooldownProgress(5, 0)).toBe(0);
  });

  it('builds action-aware title and aria labels for cooldown and autocast state', () => {
    const cooldown = petActionButtonLabels({
      actionLabel: t('hud.pet.taunt'),
      cooldownText: '7s',
      autoBadge: t('hudChrome.petAction.auto'),
      t,
    });
    expect(cooldown.title).toContain(t('hud.pet.taunt'));
    expect(cooldown.title).toContain('7s');
    expect(cooldown.ariaLabel).toContain(t('hud.pet.taunt'));
    expect(cooldown.ariaLabel).toContain('7s');
    expect(cooldown.autoBadge).toBe(t('hudChrome.petAction.auto'));

    const ready = petActionButtonLabels({
      actionLabel: t('hud.pet.taunt'),
      t,
    });
    expect(ready.title).toBe(t('hud.pet.taunt'));
    expect(ready.ariaLabel).toBe(t('hud.pet.taunt'));
    expect(ready.autoBadge).toBeUndefined();
  });
});
