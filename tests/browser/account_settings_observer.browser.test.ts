import { expect, it, vi } from 'vitest';
import { startAccountSettingsSync } from '../../src/game/account_settings_sync';

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
