import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ status: vi.fn(), initialize: vi.fn(), save: vi.fn() }));
vi.mock('../src/net/account_settings', () => ({
  AccountSettingsClient: class {
    status = api.status;
    initialize = api.initialize;
    save = api.save;
  },
}));
vi.mock('../src/ui/account_settings_notice_controller', () => ({
  showAccountSettingsNotice: vi.fn(),
}));
vi.mock('../src/game/account_settings_runtime', () => ({ refreshAccountSettingsRuntime: vi.fn() }));
vi.mock('../src/ui/i18n', () => ({
  ensureLocaleLoaded: vi.fn().mockResolvedValue(undefined),
  isSupportedLanguage: (value: string) => ['en', 'es'].includes(value),
  setLanguage: vi.fn(),
}));
vi.mock('../src/ui/locale_channels', () => ({ CONTENT_LOCALE_CHANNEL_ENSURERS: [] }));

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

describe('account settings unavailable during entry', () => {
  let storage: Storage;
  let flush: (() => Promise<void>) | undefined;
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    storage = new MemoryStorage() as unknown as Storage;
    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('navigator', { userAgent: 'desktop', platform: 'Win32', maxTouchPoints: 0 });
    vi.stubGlobal('screen', { width: 1920, height: 1080 });
    vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal('document', { dispatchEvent: vi.fn() });
    vi.stubGlobal(
      'CustomEvent',
      class {
        constructor(public type: string) {}
      },
    );
    api.status.mockResolvedValue({ accountId: 1, acknowledged: true });
    api.initialize.mockResolvedValue({ locale: 'en', woc_theme: 'server-theme' });
    api.save.mockResolvedValue(undefined);
  });
  afterEach(async () => {
    await flush?.();
    vi.unstubAllGlobals();
  });

  it('journals gameplay edits after a failed initialization and replays them on next login', async () => {
    let wiring = await import('../src/account_settings_wiring');
    flush = wiring.flushAccountSettings;
    wiring.setAccountSettingsSaveErrorReporter(vi.fn());
    api.initialize.mockRejectedValueOnce(new Error('preferences unavailable'));
    await wiring.prepareAccountSettings({ token: 'one', base: '' }, 42);
    storage.setItem('locale', 'es');
    expect(storage.getItem('woc_account_settings_pending:1:desktop:login')).toContain('es');
    expect(api.save).not.toHaveBeenCalled();
    await flush();
    vi.resetModules();
    wiring = await import('../src/account_settings_wiring');
    flush = wiring.flushAccountSettings;
    await wiring.prepareAccountSettings({ token: 'one', base: '' }, 42);
    expect(api.save).toHaveBeenCalledWith(
      'desktop',
      { locale: 'es', woc_theme: 'server-theme' },
      false,
    );
    expect(storage.getItem('locale')).toBe('es');
    expect(storage.getItem('woc_theme')).toBe('server-theme');
  });
});
