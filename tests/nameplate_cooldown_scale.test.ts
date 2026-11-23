// The enemy cooldown row's settings: the toggle and the size slider fold into
// one live number (Settings.nameplateCooldownRenderScale), applied to the plate
// painter through nameplate_cooldown_scale.ts. As with the dot row, the OFF
// encoding is load-bearing: 0 is how "draw no row" reaches the painter.

import { beforeEach, describe, expect, it } from 'vitest';
import { BOOL_SETTINGS, SETTING_RANGES, Settings } from '../src/game/settings';
import {
  nameplateCooldownScale,
  setNameplateCooldownScale,
} from '../src/render/nameplate_cooldown_scale';
import { NAMEPLATE_COOLDOWN_SCALE_MIN } from '../src/render/nameplate_cooldowns_core';

describe('nameplate cooldown settings', () => {
  beforeEach(() => setNameplateCooldownScale(NAMEPLATE_COOLDOWN_SCALE_MIN));

  it('ships on, at 150%, on a 100% to 300% slider', () => {
    expect(BOOL_SETTINGS.showNameplateCooldowns.def).toBe(true);
    expect(SETTING_RANGES.nameplateCooldownScale).toEqual({ min: 1, max: 3, def: 1.5 });
  });

  it('folds the toggle and the slider into one renderer number, 0 meaning off', () => {
    const settings = new Settings();
    expect(settings.nameplateCooldownRenderScale()).toBe(1.5);
    settings.set('nameplateCooldownScale', 2.5);
    expect(settings.nameplateCooldownRenderScale()).toBe(2.5);
    settings.set('showNameplateCooldowns', false);
    expect(settings.nameplateCooldownRenderScale()).toBe(0);
    settings.set('showNameplateCooldowns', true);
    expect(settings.nameplateCooldownRenderScale()).toBe(2.5);
  });

  it('is independent of the dot row: turning one off leaves the other', () => {
    const settings = new Settings();
    settings.set('showNameplateDots', false);
    expect(settings.nameplateCooldownRenderScale()).toBe(1.5);
    settings.set('showNameplateDots', true);
    settings.set('showNameplateCooldowns', false);
    expect(settings.nameplateDotRenderScale()).toBe(1.5);
  });

  it('carries the applied value to the painter, and a corrupt one as off', () => {
    setNameplateCooldownScale(2);
    expect(nameplateCooldownScale()).toBe(2);
    setNameplateCooldownScale(0);
    expect(nameplateCooldownScale()).toBe(0);
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      setNameplateCooldownScale(1.5);
      setNameplateCooldownScale(bad);
      expect(nameplateCooldownScale(), String(bad)).toBe(0);
    }
  });
});
