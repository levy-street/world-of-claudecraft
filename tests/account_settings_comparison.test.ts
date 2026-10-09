import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  accountGameSettingsBaseline,
  accountGameSettingsEqual,
} from '../src/game/account_settings_comparison';
import { Settings } from '../src/game/settings';

afterEach(() => vi.unstubAllGlobals());

describe('account settings materialized defaults comparison', () => {
  it('does not treat the first graphics-only Settings.save as edits to untouched shared defaults', () => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const settings = new Settings();
    settings.set('graphicsPreset', 4);
    expect(accountGameSettingsEqual(null, values.get('woc_settings') ?? null)).toBe(true);
    settings.set('cameraSpeed', 1);
    expect(accountGameSettingsEqual(null, values.get('woc_settings') ?? null)).toBe(false);
    expect(accountGameSettingsBaseline(null).cameraSpeed).toBe(0.7);
  });
  it('compares sparse rows with defaults while preserving deliberate non-default fields', () => {
    expect(
      accountGameSettingsEqual('{"cameraSpeed":0.7}', '{"cameraSpeed":0.7,"musicVolume":0.8}'),
    ).toBe(true);
    expect(accountGameSettingsEqual('{"cameraSpeed":1}', '{"cameraSpeed":0.7}')).toBe(false);
    expect(accountGameSettingsEqual('bad json', null)).toBe(true);
  });
});
