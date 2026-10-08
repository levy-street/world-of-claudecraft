import { beforeEach, describe, expect, it, vi } from 'vitest';

const music = vi.hoisted(() => ({ setEnabled: vi.fn() }));
const controls = vi.hoisted(() => ({
  setInterfaceMode: vi.fn(),
  interfaceModeFromSetting: vi.fn((v: number) => v),
}));
vi.mock('../src/game/music', () => ({ music }));
vi.mock('../src/game/mobile_controls', () => controls);

import { refreshAccountSettingsRuntime } from '../src/game/account_settings_runtime';

describe('account import refreshes early preference readers', () => {
  beforeEach(() => vi.clearAllMocks());
  it('applies saved music mute and interface mode during the current entry', () => {
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => (key === 'ev_music_on' ? '0' : '{"interfaceMode":2}'),
    });
    refreshAccountSettingsRuntime();
    expect(music.setEnabled).toHaveBeenCalledWith(false);
    expect(controls.setInterfaceMode).toHaveBeenCalledWith(2);
    vi.unstubAllGlobals();
  });
  it('restores defaults for an account with no saved music or interface preferences', () => {
    vi.stubGlobal('localStorage', { getItem: () => null });
    refreshAccountSettingsRuntime();
    expect(music.setEnabled).toHaveBeenCalledWith(true);
    expect(controls.setInterfaceMode).toHaveBeenCalledWith(0);
    vi.unstubAllGlobals();
  });
});
