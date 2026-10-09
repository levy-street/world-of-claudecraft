import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { observeAccountSettingsLogin } from '../src/account_settings_login_observer';
import { Settings } from '../src/game/settings';

class MemoryStorage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}

describe('account settings login observer', () => {
  let observer: ReturnType<typeof observeAccountSettingsLogin> | undefined;
  let localStorage: Storage;
  const journal = 'woc_account_settings_pending:1:desktop:login';
  beforeEach(() => {
    localStorage = new MemoryStorage() as unknown as Storage;
    vi.stubGlobal('localStorage', localStorage);
  });
  afterEach(() => {
    observer?.stop();
    vi.unstubAllGlobals();
  });

  it('recovers only homepage edits and retains untouched server preferences', () => {
    localStorage.setItem('woc_theme', 'another-account-browser-value');
    observer = observeAccountSettingsLogin(localStorage, journal);
    localStorage.setItem('locale', 'es');
    expect(observer.applyTo({ woc_theme: 'server-theme', locale: 'en' })).toEqual({
      woc_theme: 'server-theme',
      locale: 'es',
    });
    observer.stop();
    observer = observeAccountSettingsLogin(localStorage, journal);
    expect(observer.applyTo({ woc_theme: 'server-theme', locale: 'en' })).toEqual({
      woc_theme: 'server-theme',
      locale: 'es',
    });
  });

  it('recovers deletions, ignores credentials and can acknowledge transferred edits', () => {
    localStorage.setItem('locale', 'en');
    observer = observeAccountSettingsLogin(localStorage, journal);
    localStorage.removeItem('locale');
    localStorage.setItem('woc_token', 'secret');
    expect(observer.applyTo({ locale: 'es', woc_theme: 'server' })).toEqual({
      woc_theme: 'server',
    });
    expect(localStorage.getItem(journal)).not.toContain('secret');
    observer.acknowledge();
    expect(localStorage.getItem(journal)).toBeNull();
  });

  it('does not import another account or device login journal', () => {
    localStorage.setItem(
      'woc_account_settings_pending:2:desktop:login',
      JSON.stringify({ changes: { locale: 'es' } }),
    );
    localStorage.setItem(
      'woc_account_settings_pending:1:phone:login',
      JSON.stringify({ changes: { locale: 'fr' } }),
    );
    observer = observeAccountSettingsLogin(localStorage, journal);
    expect(observer.hasChanges()).toBe(false);
    expect(observer.applyTo({ locale: 'en' })).toEqual({ locale: 'en' });
  });

  it('bounds deletion tombstones across repeated homepage edits', () => {
    observer = observeAccountSettingsLogin(localStorage, journal);
    for (let index = 0; index < 300; index++) {
      const key = `woc_chat_test_${index}`;
      localStorage.setItem(key, 'enabled');
      localStorage.removeItem(key);
    }
    const raw = localStorage.getItem(journal)!;
    expect(Object.keys(JSON.parse(raw).changes).length).toBeLessThanOrEqual(256);
    expect(new TextEncoder().encode(raw).length).toBeLessThanOrEqual(49_152);
  });

  it('overlays only changed fields inside the settings blob and recovers that patch', () => {
    localStorage.setItem(
      'woc_settings',
      JSON.stringify({ cameraSpeed: 0.7, musicVolume: 0.2, highContrast: false }),
    );
    observer = observeAccountSettingsLogin(localStorage, journal);
    localStorage.setItem(
      'woc_settings',
      JSON.stringify({ cameraSpeed: 0.7, musicVolume: 0.2, highContrast: true }),
    );
    observer.stop();
    observer = observeAccountSettingsLogin(localStorage, journal);
    const merged = observer.applyTo({
      woc_settings: JSON.stringify({ cameraSpeed: 1.2, musicVolume: 0.8, highContrast: false }),
    });
    expect(JSON.parse(merged.woc_settings)).toEqual({
      cameraSpeed: 1.2,
      musicVolume: 0.8,
      highContrast: true,
    });
  });

  it('preserves cloud camera and audio when a real landing contrast control saves defaults', () => {
    localStorage.setItem('woc_settings', JSON.stringify({ cameraSpeed: 0.7 }));
    observer = observeAccountSettingsLogin(localStorage, journal);
    new Settings().set('landingHighContrast', true);
    const merged = observer.applyTo({
      woc_settings: JSON.stringify({
        cameraSpeed: 1.2,
        musicVolume: 0.2,
        landingHighContrast: false,
      }),
    });
    expect(JSON.parse(merged.woc_settings)).toEqual({
      cameraSpeed: 1.2,
      musicVolume: 0.2,
      landingHighContrast: true,
    });
  });

  it('does not queue a shared edit when the landing graphics picker materializes defaults', () => {
    observer = observeAccountSettingsLogin(localStorage, journal);
    new Settings().set('graphicsPreset', 3);
    expect(observer.hasChanges()).toBe(false);
    expect(observer.applyTo({ woc_settings: '{"cameraSpeed":1.2}' })).toEqual({
      woc_settings: '{"cameraSpeed":1.2}',
    });
  });

  it.each(['remove', 'clear'])(
    'resets its field baseline after a %s followed by re-adding settings',
    (action) => {
      localStorage.setItem('woc_settings', '{"cameraSpeed":1}');
      observer = observeAccountSettingsLogin(localStorage, journal);
      if (action === 'remove') localStorage.removeItem('woc_settings');
      else localStorage.clear();
      localStorage.setItem('woc_settings', '{"cameraSpeed":1}');
      const merged = observer.applyTo({ woc_settings: '{"cameraSpeed":1.2,"musicVolume":0.2}' });
      expect(JSON.parse(merged.woc_settings)).toEqual({ cameraSpeed: 1 });
    },
  );
});
