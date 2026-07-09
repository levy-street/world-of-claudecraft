import { describe, expect, it } from 'vitest';
import type { CastBarState } from '../src/render/cast_bar';
import { castCueText, castDisplayName } from '../src/ui/cast_presentation';
import { t } from '../src/ui/i18n';

function state(over: Partial<CastBarState> = {}): CastBarState {
  return {
    visible: true,
    channel: false,
    fill: 0.5,
    label: 'fireball',
    fishing: false,
    kind: 'cast',
    source: 'unit',
    interrupt: 'interruptible',
    important: false,
    ...over,
  };
}

describe('cast presentation helpers', () => {
  it('resolves special scripted cast ids to user-facing labels', () => {
    expect(castDisplayName('nythraxis_deathless_rage')).toBe(
      t('abilityUi.cast.nythraxisDeathlessRage'),
    );
    expect(castDisplayName('nythraxis_ward_channel')).toBe(t('abilityUi.cast.nythraxisWardChannel'));
  });

  it('suppresses interrupt cues for pet casts even when interrupt cues are enabled', () => {
    const cue = castCueText(
      state({ kind: 'channel', source: 'pet', interrupt: 'interruptible' }),
      { showInterruptCues: true },
    );

    expect(cue).toContain(t('hudChrome.castBar.pet'));
    expect(cue).toContain(t('hudChrome.castBar.channeling'));
    expect(cue).not.toContain(t('hudChrome.castBar.interruptible'));
  });

  it('shows interrupt cues for non-pet casts when requested', () => {
    expect(castCueText(state({ interrupt: 'interruptible' }), { showInterruptCues: true })).toBe(
      t('hudChrome.castBar.interruptible'),
    );
    expect(
      castCueText(state({ interrupt: 'uninterruptible' }), { showInterruptCues: true }),
    ).toBe(t('hudChrome.castBar.cannotInterrupt'));
    expect(castCueText(state({ interrupt: 'interruptible' }), { showInterruptCues: false })).toBe(
      '',
    );
  });
});
