// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  acknowledge: vi.fn(),
  initialize: vi.fn(),
  save: vi.fn(),
  notice: vi.fn(),
  apply: vi.fn(),
  snapshot: vi.fn(),
  sync: vi.fn(),
  stop: vi.fn(),
  flush: vi.fn(),
  classify: vi.fn(),
  pending: vi.fn(),
}));
vi.mock('../src/net/account_settings', () => ({
  AccountSettingsClient: class {
    status = mocks.status;
    acknowledge = mocks.acknowledge;
    initialize = mocks.initialize;
    save = mocks.save;
  },
}));
vi.mock('../src/ui/account_settings_notice_controller', () => ({
  showAccountSettingsNotice: mocks.notice,
}));
vi.mock('../src/game/account_settings_device_core', () => ({
  classifyAccountSettingsDevice: mocks.classify,
}));
vi.mock('../src/game/account_settings_runtime', () => ({ refreshAccountSettingsRuntime: vi.fn() }));
vi.mock('../src/game/account_settings_sync', () => ({
  applyAccountSettings: mocks.apply,
  snapshotAccountSettings: mocks.snapshot,
  startAccountSettingsSync: mocks.sync,
  readPendingAccountSettings: mocks.pending,
}));

describe('account settings bootstrap', () => {
  it('flushes before revoking account credentials and finishes logout after failures', async () => {
    const { prepareAccountSettings, logoutAccountSettings } = await import(
      '../src/account_settings_wiring'
    );
    const session = {
      token: 'one',
      base: '',
      logout: vi.fn().mockRejectedValueOnce(new Error('offline')),
    };
    await prepareAccountSettings(session, 42);
    mocks.flush.mockRejectedValueOnce(new Error('save unavailable'));
    const finish = vi.fn();
    await expect(logoutAccountSettings(session, finish)).resolves.toBeUndefined();
    expect(session.logout).toHaveBeenCalledOnce();
    expect(finish).toHaveBeenCalledOnce();
    expect(mocks.flush.mock.invocationCallOrder[0]).toBeLessThan(
      session.logout.mock.invocationCallOrder[0],
    );
    expect(session.logout.mock.invocationCallOrder[0]).toBeLessThan(
      finish.mock.invocationCallOrder[0],
    );
  });
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    localStorage.clear();
    document.body.innerHTML = '<span id="realm-list-user"></span>';
    mocks.status.mockResolvedValue({ acknowledged: false, accountId: 1 });
    mocks.notice.mockImplementation(async (ack) => ack());
    mocks.initialize.mockResolvedValue({ woc_settings: '{"cameraSpeed":2}' });
    mocks.snapshot.mockReturnValue({ woc_keybinds: '{"jump":["KeyX"]}' });
    mocks.classify.mockReturnValue('desktop');
    mocks.pending.mockReturnValue(null);
    mocks.sync.mockReturnValue({ stop: mocks.stop, flush: mocks.flush });
  });

  it('awaits durable acknowledgement before opening character selection, without choosing a seed', async () => {
    const { enterAccountRealmFlow } = await import('../src/account_settings_wiring');
    let confirm!: () => void;
    mocks.notice.mockReturnValue(
      new Promise<void>((resolve) => {
        confirm = resolve;
      }),
    );
    const session = {
      token: 'one',
      base: '',
      username: 'Player',
      realms: vi.fn().mockResolvedValue({ realms: [] }),
    };
    const showRealmList = vi.fn();
    const entering = enterAccountRealmFlow(session, { selectRealm: vi.fn(), showRealmList });
    await vi.waitFor(() => expect(mocks.notice).toHaveBeenCalledOnce());
    expect(session.realms).not.toHaveBeenCalled();
    expect(mocks.initialize).not.toHaveBeenCalled();
    confirm();
    await entering;
    expect(showRealmList).toHaveBeenCalledOnce();
  });

  it('applies the server winner before starting saves and seeds from the selected character', async () => {
    const { prepareAccountSettings } = await import('../src/account_settings_wiring');
    const session = { token: 'one', base: '' };
    await prepareAccountSettings(session, 42);
    expect(mocks.snapshot).toHaveBeenCalledWith(localStorage, 42);
    expect(mocks.initialize).toHaveBeenCalledWith('desktop', 42, mocks.snapshot());
    expect(mocks.apply).toHaveBeenCalledWith(localStorage, { woc_settings: '{"cameraSpeed":2}' });
    expect(mocks.apply.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.sync.mock.invocationCallOrder[1],
    );
  });

  it('rechecks acknowledgement for a different account session and does not reuse its first seed', async () => {
    const { prepareAccountSettings } = await import('../src/account_settings_wiring');
    const session = { token: 'one', base: '' };
    await prepareAccountSettings(session, 42);
    session.token = 'two';
    await prepareAccountSettings(session, 43);
    expect(mocks.status).toHaveBeenCalledTimes(2);
    expect(mocks.notice).toHaveBeenCalledTimes(2);
    expect(mocks.initialize).toHaveBeenLastCalledWith('desktop', 43, mocks.snapshot());
    expect(mocks.stop).toHaveBeenCalledTimes(3);
  });

  it('refuses stale initialization if the account changes during the server request', async () => {
    const { prepareAccountSettings } = await import('../src/account_settings_wiring');
    const session = { token: 'one', base: '' };
    mocks.initialize.mockImplementation(async () => {
      session.token = 'two';
      return {};
    });
    await expect(prepareAccountSettings(session, 42)).rejects.toThrow('Account changed');
    expect(mocks.apply).not.toHaveBeenCalled();
  });

  it('recovers unsaved edits only from the same account and device and flushes before entry', async () => {
    const { prepareAccountSettings } = await import('../src/account_settings_wiring');
    const pending = { woc_theme: 'saved-local-edit' };
    mocks.pending.mockReturnValue(pending);
    await prepareAccountSettings({ token: 'one', base: '' }, 42);
    expect(mocks.pending).toHaveBeenCalledWith(
      localStorage,
      'woc_account_settings_pending:1:desktop',
    );
    expect(mocks.apply).toHaveBeenCalledWith(localStorage, pending);
    expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({ initialPending: pending }));
    expect(mocks.flush).toHaveBeenCalledOnce();
  });

  it('loads the saved language before gameplay and reports the language change', async () => {
    const { prepareAccountSettings } = await import('../src/account_settings_wiring');
    const { getLanguage, setLanguage, t } = await import('../src/ui/i18n');
    const changed = vi.fn();
    document.addEventListener('woc:languagechange', changed);
    mocks.apply.mockImplementationOnce(() => localStorage.setItem('locale', 'es'));
    await prepareAccountSettings({ token: 'one', base: '' }, 42);
    expect(getLanguage()).toBe('es');
    expect(t('hud.options.music')).not.toBe('Music');
    expect(changed).toHaveBeenCalledOnce();
    document.removeEventListener('woc:languagechange', changed);
    setLanguage('en');
  });

  it('does not retain the previous account language when the new profile has no locale', async () => {
    const { prepareAccountSettings } = await import('../src/account_settings_wiring');
    const { getLanguage, setLanguage } = await import('../src/ui/i18n');
    setLanguage('es');
    mocks.apply.mockImplementationOnce(() => localStorage.removeItem('locale'));
    await prepareAccountSettings({ token: 'one', base: '' }, 42);
    expect(getLanguage()).toBe('en');
  });

  it('does not open the chooser when the status request fails and can retry it', async () => {
    const { ensureAccountSettingsAcknowledged } = await import('../src/account_settings_wiring');
    const session = { token: 'one', base: '' };
    mocks.status.mockRejectedValueOnce(new Error('offline'));
    await expect(ensureAccountSettingsAcknowledged(session)).rejects.toThrow('offline');
    await ensureAccountSettingsAcknowledged(session);
    expect(mocks.status).toHaveBeenCalledTimes(2);
  });

  it('observes homepage locale edits after acknowledgement and overlays only those edits', async () => {
    const { ensureAccountSettingsAcknowledged, prepareAccountSettings } = await import(
      '../src/account_settings_wiring'
    );
    const session = { token: 'one', base: '' };
    await ensureAccountSettingsAcknowledged(session);
    expect(mocks.sync).toHaveBeenCalledWith(expect.objectContaining({ paused: true }));
    const early = mocks.sync.mock.calls[0][0];
    early.onChange('locale', 'es');
    await prepareAccountSettings(session, 42);
    expect(mocks.apply).toHaveBeenCalledWith(localStorage, {
      woc_settings: '{"cameraSpeed":2}',
      locale: 'es',
    });
    expect(mocks.flush).toHaveBeenCalledOnce();
  });

  it('keeps local preferences and pauses network sync when initialization fails after acknowledgement', async () => {
    const { prepareAccountSettings, setAccountSettingsSaveErrorReporter } = await import(
      '../src/account_settings_wiring'
    );
    const report = vi.fn();
    setAccountSettingsSaveErrorReporter(report);
    mocks.initialize.mockRejectedValueOnce(new Error('preferences unavailable'));
    await expect(prepareAccountSettings({ token: 'one', base: '' }, 42)).resolves.toBeUndefined();
    expect(mocks.apply).not.toHaveBeenCalled();
    expect(mocks.stop).not.toHaveBeenCalled();
    expect(report).toHaveBeenCalledOnce();
  });

  it('allows logout to continue when a pending save fails', async () => {
    const { prepareAccountSettings, flushAccountSettings, setAccountSettingsSaveErrorReporter } =
      await import('../src/account_settings_wiring');
    setAccountSettingsSaveErrorReporter(vi.fn());
    await prepareAccountSettings({ token: 'one', base: '' }, 42);
    mocks.flush.mockRejectedValueOnce(new Error('offline'));
    await expect(flushAccountSettings()).resolves.toBeUndefined();
  });

  it('keeps the initialized observer running when a recovery save fails', async () => {
    const { prepareAccountSettings, setAccountSettingsSaveErrorReporter } = await import(
      '../src/account_settings_wiring'
    );
    setAccountSettingsSaveErrorReporter(vi.fn());
    mocks.pending.mockReturnValue({ woc_theme: 'pending-edit' });
    mocks.flush.mockRejectedValueOnce(new Error('offline'));
    await expect(prepareAccountSettings({ token: 'one', base: '' }, 42)).resolves.toBeUndefined();
    expect(mocks.stop).toHaveBeenCalledOnce();
    expect(localStorage.getItem('woc_account_settings_pending:1:desktop')).toContain(
      'pending-edit',
    );
  });

  it('does not let an error toast failure prevent the local fallback', async () => {
    const { prepareAccountSettings, setAccountSettingsSaveErrorReporter } = await import(
      '../src/account_settings_wiring'
    );
    setAccountSettingsSaveErrorReporter(() => {
      throw new Error('toast unavailable');
    });
    mocks.initialize.mockRejectedValueOnce(new Error('preferences unavailable'));
    await expect(prepareAccountSettings({ token: 'one', base: '' }, 42)).resolves.toBeUndefined();
  });
});
