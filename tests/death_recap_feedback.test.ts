import { describe, expect, it } from 'vitest';
import { deathRecapFeedback } from '../src/ui/death_recap_feedback';
import { t } from '../src/ui/i18n';

describe('death recap feedback', () => {
  it('pins the four-way killer/ability fallback ordering', () => {
    expect(deathRecapFeedback('Bogthane', undefined, 'Whirlwind')).toEqual({
      key: 'hud.system.deathRecapKillerAbility',
      values: { killer: 'Bogthane', ability: 'Whirlwind' },
    });
    expect(deathRecapFeedback('Bogthane', undefined, undefined)).toEqual({
      key: 'hud.system.deathRecapKiller',
      values: { killer: 'Bogthane' },
    });
    expect(deathRecapFeedback(undefined, 'Curse of Frailty', 'Curse of Frailty')).toEqual({
      key: 'hud.system.deathRecapAbility',
      values: { ability: 'Curse of Frailty' },
    });
    expect(deathRecapFeedback(undefined, undefined, undefined)).toEqual({
      key: 'hud.system.playerDeath',
    });
  });

  it('gives fall damage and swim fatigue their own sentence instead of "Slain by X"', () => {
    expect(deathRecapFeedback(undefined, 'Falling', 'Falling')).toEqual({
      key: 'hud.system.deathRecapFalling',
    });
    expect(deathRecapFeedback(undefined, 'Fatigue', 'Fatigue')).toEqual({
      key: 'hud.system.deathRecapDrowned',
    });
    // Renders as its own translated sentence, never the raw English cause
    // leaking through the generic {ability} interpolation.
    expect(t('hud.system.deathRecapFalling')).toBe('You have died. You fell to your death.');
    expect(t('hud.system.deathRecapDrowned')).toBe('You have died. You drowned.');
  });

  it('takes the environmental shortcut only when unattributed to a killer', () => {
    // Both environmental causes are unattributed in the sim (dealDamage is
    // called with a null source), so a killer name never actually accompanies
    // them, but the mapping stays defensive: an attributed kill takes the
    // generic path even if the raw source string happens to collide.
    expect(deathRecapFeedback('Bogthane', 'Falling', 'Falling')).toEqual({
      key: 'hud.system.deathRecapKillerAbility',
      values: { killer: 'Bogthane', ability: 'Falling' },
    });
  });

  it('gives Cauterize its own self-inflicted sentence instead of "Slain by Cauterized" (issue #3029)', () => {
    // Regression: the fire mage's own Cauterized burn (aura id 'cauterizing')
    // is self-sourced, so handleDeath drops the killer id (killer === target)
    // and only the raw aura name 'Cauterized' survives as abilityRaw. Before
    // this fix that fell through to the generic {ability} path and read as
    // "Slain by Cauterized", implying an enemy named Cauterized landed the kill.
    expect(deathRecapFeedback(undefined, 'Cauterized', 'Cauterized')).toEqual({
      key: 'hud.system.deathRecapCauterized',
    });
    expect(t('hud.system.deathRecapCauterized')).toBe(
      "You have died. Cauterize's burn overwhelmed you.",
    );
    // Defensive mirror of the Falling/Fatigue case: an attributed kill still
    // takes the generic path even if the raw source string happens to collide.
    expect(deathRecapFeedback('Bogthane', 'Cauterized', 'Cauterized')).toEqual({
      key: 'hud.system.deathRecapKillerAbility',
      values: { killer: 'Bogthane', ability: 'Cauterized' },
    });
  });
});
