import { describe, expect, it, vi } from 'vitest';

import { startDiscordLogin } from '../src/discord_login_start';

// Guards the "Login with Discord" entry point (issue #1988): every surface must
// either start the flow or surface an error, never a silent no-op.
describe('startDiscordLogin', () => {
  const baseDeps = () => ({
    startWebOAuth: vi.fn(),
    openBrowserFailed: vi.fn(),
    bridgeUnavailable: vi.fn(),
  });

  it('web build redirects in place via startDiscordOAuth', () => {
    const deps = baseDeps();
    const outcome = startDiscordLogin({ desktopApp: false, bridge: null, ...deps });
    expect(outcome).toBe('web-redirect');
    expect(deps.startWebOAuth).toHaveBeenCalledTimes(1);
    expect(deps.bridgeUnavailable).not.toHaveBeenCalled();
    expect(deps.openBrowserFailed).not.toHaveBeenCalled();
  });

  it('desktop shell opens the OS browser through the preload bridge', () => {
    const deps = baseDeps();
    const openBrowserLogin = vi.fn().mockResolvedValue(undefined);
    const outcome = startDiscordLogin({
      desktopApp: true,
      bridge: { openBrowserLogin },
      ...deps,
    });
    expect(outcome).toBe('browser-bridge');
    expect(openBrowserLogin).toHaveBeenCalledTimes(1);
    expect(deps.startWebOAuth).not.toHaveBeenCalled();
  });

  it('surfaces an error when the desktop bridge rejects (no silent no-op)', async () => {
    const deps = baseDeps();
    const failure = new Error('browser refused');
    const openBrowserLogin = vi.fn().mockRejectedValue(failure);
    startDiscordLogin({ desktopApp: true, bridge: { openBrowserLogin }, ...deps });
    // The catch runs on a microtask; flush it before asserting.
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.openBrowserFailed).toHaveBeenCalledTimes(1);
    expect(deps.openBrowserFailed).toHaveBeenCalledWith(failure);
    expect(deps.bridgeUnavailable).not.toHaveBeenCalled();
  });

  it('surfaces an error on a desktop shell with no bridge (nav guard would eat an in-app redirect)', () => {
    const deps = baseDeps();
    const outcome = startDiscordLogin({ desktopApp: true, bridge: null, ...deps });
    expect(outcome).toBe('no-bridge-error');
    expect(deps.bridgeUnavailable).toHaveBeenCalledTimes(1);
    // Must NOT fall through to an in-app redirect that the Electron nav guard blocks.
    expect(deps.startWebOAuth).not.toHaveBeenCalled();
  });
});
