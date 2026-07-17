import { describe, expect, it } from 'vitest';
import { errorSfxKey } from '../src/ui/error_sfx';

describe('errorSfxKey', () => {
  it('classifies cooldown text', () => {
    expect(errorSfxKey('That ability is not ready yet.')).toBe('ui_error_cooldown');
  });

  it('classifies every resource-shortage text', () => {
    for (const text of [
      'Not enough rage!',
      'Not enough energy!',
      'Not enough mana!',
      'Not enough health.',
    ]) {
      expect(errorSfxKey(text)).toBe('ui_error_resource');
    }
  });

  it('classifies every reach-the-target text', () => {
    for (const text of [
      'Out of range.',
      'Too close!',
      'You have no target.',
      'You must be facing your target.',
      'Line of sight.',
      'You must be behind your target.',
    ]) {
      expect(errorSfxKey(text)).toBe('ui_error_range');
    }
  });

  it('falls back to the generic cue for everything else', () => {
    expect(errorSfxKey('You have no pet.')).toBe('ui_error');
    expect(errorSfxKey('Not enough money.')).toBe('ui_error');
    expect(errorSfxKey('')).toBe('ui_error');
  });
});
