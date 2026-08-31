import { describe, expect, it, vi } from 'vitest';
import type { GamepadManager } from '../src/game/gamepad';
import { createGamepadSettingApplier } from '../src/game/gamepad_settings';
import type { Settings } from '../src/game/settings';

function setup() {
  const pad = {
    start: vi.fn(),
    stop: vi.fn(),
    setInvertY: vi.fn(),
    setDeadzone: vi.fn(),
    setCameraSpeed: vi.fn(),
    setVibration: vi.fn(),
    setKindOverride: vi.fn(),
  } as unknown as GamepadManager;
  const settings = {
    set: vi.fn((_key: string, value: number | boolean) => value),
  } as unknown as Settings;
  const syncPadMode = vi.fn();
  return {
    apply: createGamepadSettingApplier(pad, settings, syncPadMode),
    pad,
    settings,
    syncPadMode,
  };
}

describe('createGamepadSettingApplier', () => {
  it('starts or stops controller input and always resyncs pad mode', () => {
    const enabled = setup();
    expect(enabled.apply('gamepadEnabled', true)).toBe(true);
    expect(enabled.pad.start).toHaveBeenCalledOnce();
    expect(enabled.syncPadMode).toHaveBeenCalledOnce();

    const disabled = setup();
    expect(disabled.apply('gamepadEnabled', false)).toBe(true);
    expect(disabled.pad.stop).toHaveBeenCalledOnce();
    expect(disabled.syncPadMode).toHaveBeenCalledOnce();
  });

  it('applies the camera, reticle, vibration, and glyph-family settings', () => {
    const { apply, pad, settings } = setup();

    expect(apply('gamepadInvertY', true)).toBe(true);
    expect(apply('gamepadStickDeadzone', 0.2)).toBe(true);
    expect(apply('gamepadCameraSpeed', 2.8)).toBe(true);
    expect(apply('gamepadReticleSpeed', 1.4)).toBe(true);
    expect(apply('gamepadVibration', 0.7)).toBe(true);
    expect(apply('gamepadGlyphStyle', 1)).toBe(true);

    expect(pad.setInvertY).toHaveBeenCalledWith(true);
    expect(pad.setDeadzone).toHaveBeenCalledWith(0.2);
    expect(pad.setCameraSpeed).toHaveBeenCalledWith(2.8);
    expect(settings.set).toHaveBeenCalledWith('gamepadReticleSpeed', 1.4);
    expect(pad.setVibration).toHaveBeenCalledWith(0.7);
    expect(pad.setKindOverride).toHaveBeenCalledWith('xbox');
  });

  it('returns false without writing when the setting belongs elsewhere', () => {
    const { apply, settings } = setup();

    expect(apply('brightness', 1.2)).toBe(false);
    expect(settings.set).not.toHaveBeenCalled();
  });
});
