import { expect, it, vi } from 'vitest';
import { observeAccountSettingsLogin } from '../../src/account_settings_login_observer';
import {
  applyAccountSettings,
  startAccountSettingsSync,
} from '../../src/game/account_settings_sync';

it('observes native localStorage preferences and preserves sessionStorage isolation', async () => {
  localStorage.clear();
  sessionStorage.clear();
  const originalSet = Storage.prototype.setItem;
  const save = vi.fn().mockResolvedValue(undefined);
  const sync = startAccountSettingsSync({ storage: localStorage, eventTarget: window, save });
  try {
    sessionStorage.setItem('ev_music_on', '0');
    localStorage.setItem('woc_token', 'unrelated');
    await sync.flush();
    expect(save).not.toHaveBeenCalled();
    localStorage.setItem('ev_music_on', '1');
    window.dispatchEvent(new Event('pagehide'));
    await sync.flush();
    expect(save).toHaveBeenCalledWith({ ev_music_on: '1' }, true);
    localStorage.removeItem('ev_music_on');
    await sync.flush();
    expect(save.mock.calls[1][0]).toEqual({});
    localStorage.setItem('ev_music_on', '0');
    localStorage.clear();
    await sync.flush();
    expect(save.mock.calls[2][0]).toEqual({});
  } finally {
    sync.stop();
    localStorage.clear();
    sessionStorage.clear();
  }
  expect(Storage.prototype.setItem).toBe(originalSet);
});

it('keeps a recovered phone preset and homepage language edit while importing shared preferences', async () => {
  localStorage.clear();
  localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 2, cameraSpeed: 0.7 }));
  localStorage.setItem('locale', 'en');
  const journalKey = 'woc_account_settings_pending:1:phone:login';
  const observer = observeAccountSettingsLogin(localStorage, journalKey);
  let sync: ReturnType<typeof startAccountSettingsSync> | undefined;
  try {
    localStorage.setItem('locale', 'es');
    const merged = observer.applyTo({
      woc_settings: JSON.stringify({
        graphicsPreset: 3,
        graphicsDefaultApplied: true,
        cameraSpeed: 1,
      }),
      locale: 'en',
      woc_theme: 'gold',
    });
    observer.stop();
    applyAccountSettings(localStorage, merged);
    expect(localStorage.getItem('locale')).toBe('es');
    expect(JSON.parse(localStorage.getItem('woc_settings')!)).toEqual({
      graphicsPreset: 2,
      cameraSpeed: 1,
    });
    const save = vi.fn().mockResolvedValue(undefined);
    sync = startAccountSettingsSync({ storage: localStorage, initialPending: merged, save });
    observer.acknowledge();
    await sync.flush();
    expect(JSON.parse(save.mock.calls[0][0].woc_settings)).toEqual({ cameraSpeed: 1 });
    expect(save.mock.calls[0][0].locale).toBe('es');
    localStorage.setItem('woc_settings', JSON.stringify({ graphicsPreset: 1, cameraSpeed: 1 }));
    await sync.flush();
    expect(save).toHaveBeenCalledOnce();
  } finally {
    observer.stop();
    sync?.stop();
    localStorage.clear();
  }
});
