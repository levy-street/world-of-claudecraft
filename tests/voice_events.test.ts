import { describe, expect, it } from 'vitest';
import { NYTHRAXIS_VOICE_GAIN, nextVoicedYell, voicedYellGain } from '../src/ui/voice_events';

describe('voiced yell playback gating', () => {
  it('suppresses duplicate yell clips emitted for multiple raid members in the same moment', () => {
    const first = nextVoicedYell(null, 'yell__fail_and_we_all_perish', 1000);
    expect(first.play).toBe(true);

    const duplicate = nextVoicedYell(first.state, 'yell__fail_and_we_all_perish', 1000);
    expect(duplicate.play).toBe(false);
    expect(duplicate.state).toBe(first.state);
  });

  it('allows a different line or the same line after the de-dupe window', () => {
    const first = nextVoicedYell(null, 'yell__fail_and_we_all_perish', 1000);

    expect(nextVoicedYell(first.state, 'yell__your_spirit_belongs_to_me', 1050).play).toBe(true);
    expect(nextVoicedYell(first.state, 'yell__fail_and_we_all_perish', 1600).play).toBe(true);
  });

  it('boosts Nythraxis yell playback without affecting other speakers', () => {
    expect(voicedYellGain('Nythraxis, Scourge of Thornpeak')).toBe(NYTHRAXIS_VOICE_GAIN);
    expect(voicedYellGain('Brother Aldric')).toBe(1);
  });
});
