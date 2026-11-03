import { describe, expect, it } from 'vitest';
import { audibleVolume, isAudioMuted, toggleAudioMuted } from '../src/game/audio_mute';

describe('Mute All Sound toggle', () => {
  it('zeroes every channel while muted and restores the saved value after', () => {
    expect(isAudioMuted()).toBe(false);
    expect(audibleVolume(0.7)).toBe(0.7);

    expect(toggleAudioMuted()).toBe(true);
    expect(audibleVolume(0.7)).toBe(0);
    expect(audibleVolume(1)).toBe(0);

    expect(toggleAudioMuted()).toBe(false);
    expect(audibleVolume(0.7)).toBe(0.7);
  });
});
