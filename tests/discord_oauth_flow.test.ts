// @vitest-environment happy-dom
//
// The bug this module fixes: a failed in-game Discord LINK (relink) attempt
// used to call the same flashDiscordError() as a LOGIN failure, which writes
// into #login-error on the pre-game auth screen, an element that is hidden
// once the player is in the game (the only place a link/relink ever starts
// from). The player saw nothing happen. discordLinkErrorActive() plus
// onLinkPanelUpdate is the fix: LINK failures arm a flag the in-game panel
// reads instead, and LOGIN failures keep going through #login-error.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type DiscordOAuthFlowDeps,
  discordLinkErrorActive,
  handleNativeDiscordResult,
  installDiscordPopupListener,
  startDiscordOAuth,
} from '../src/net/discord_oauth_flow';
import type { NativeDiscordResult } from '../src/net/native_discord';
import type { Api } from '../src/net/online';

function makeDeps(overrides: Partial<DiscordOAuthFlowDeps> = {}): DiscordOAuthFlowDeps {
  return {
    api: {
      base: 'https://woc.test',
      discordStart: vi.fn(async () => ({ url: 'https://discord.com/oauth2/authorize' })),
      exchangeNativeDiscordCode: vi.fn(async () => ({
        choose: false,
        linkToken: '',
        username: 'player',
      })),
      saveSession: vi.fn(),
    } as unknown as Api,
    isDesktopLoginPage: () => false,
    onLinkSuccess: vi.fn(),
    onLinkPanelUpdate: vi.fn(),
    onNativeChoosePending: vi.fn(),
    ...overrides,
  };
}

function loginErrorEl(): HTMLElement {
  let el = document.getElementById('login-error');
  if (!el) {
    el = document.createElement('div');
    el.id = 'login-error';
    document.body.appendChild(el);
  }
  el.textContent = '';
  return el;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.getElementById('login-error')?.remove();
});

describe('startDiscordOAuth: link mode failures stay off #login-error', () => {
  beforeEach(() => {
    // Every link attempt clears the notice first; drive it non-empty so the
    // "cleared on a new attempt" behavior below is actually observable.
    vi.spyOn(window, 'open').mockReturnValue(null);
  });

  it('clears any stale link-error notice at the start of a new attempt', async () => {
    const deps = makeDeps({
      api: { discordStart: vi.fn(async () => ({ url: 'u' })) } as unknown as Api,
    });
    // Arm it first via a failed attempt, then start a fresh one.
    startDiscordOAuth('link', deps);
    await new Promise((r) => setTimeout(r, 0));
    expect(discordLinkErrorActive()).toBe(true); // window.open() returned null above

    startDiscordOAuth('link', deps);
    expect(discordLinkErrorActive()).toBe(false);
  });

  it('arms the link-error flag (not #login-error) when discordStart rejects', async () => {
    const el = loginErrorEl();
    const deps = makeDeps({
      api: { discordStart: vi.fn(async () => Promise.reject(new Error('boom'))) } as unknown as Api,
    });
    startDiscordOAuth('link', deps);
    await new Promise((r) => setTimeout(r, 0));
    expect(discordLinkErrorActive()).toBe(true);
    expect(deps.onLinkPanelUpdate).toHaveBeenCalled();
    expect(el.textContent).toBe(''); // never routed to the pre-game auth screen
  });

  it('arms the link-error flag when the popup was blocked (window.open returned null)', async () => {
    const deps = makeDeps();
    startDiscordOAuth('link', deps);
    await new Promise((r) => setTimeout(r, 0));
    expect(discordLinkErrorActive()).toBe(true);
  });

  it('does not arm the flag on a successful start with a live popup', async () => {
    const fakePopup = { location: { href: '' }, close: vi.fn() } as unknown as Window;
    vi.spyOn(window, 'open').mockReturnValue(fakePopup);
    const deps = makeDeps();
    startDiscordOAuth('link', deps);
    await new Promise((r) => setTimeout(r, 0));
    expect(discordLinkErrorActive()).toBe(false);
    expect(fakePopup.location.href).toBe('https://discord.com/oauth2/authorize');
  });
});

describe('startDiscordOAuth: login mode failures use #login-error, never the link flag', () => {
  it('writes the login screen error line on a failed login start', async () => {
    const el = loginErrorEl();
    const deps = makeDeps({
      api: { discordStart: vi.fn(async () => Promise.reject(new Error('boom'))) } as unknown as Api,
    });
    startDiscordOAuth('login', deps);
    await new Promise((r) => setTimeout(r, 0));
    expect(el.textContent).not.toBe('');
    expect(deps.onLinkPanelUpdate).not.toHaveBeenCalled();
  });
});

describe('installDiscordPopupListener', () => {
  function post(data: unknown): void {
    window.dispatchEvent(new MessageEvent('message', { data, origin: location.origin }));
  }

  it('arms the link-error flag on a failed link bounce, never #login-error', () => {
    const el = loginErrorEl();
    const deps = makeDeps();
    installDiscordPopupListener(deps);
    post({ source: 'woc-discord', ok: false, mode: 'link' });
    expect(discordLinkErrorActive()).toBe(true);
    expect(deps.onLinkPanelUpdate).toHaveBeenCalled();
    expect(el.textContent).toBe('');
  });

  it('routes a failed login bounce to #login-error, not the link flag', () => {
    const el = loginErrorEl();
    const deps = makeDeps();
    installDiscordPopupListener(deps);
    post({ source: 'woc-discord', ok: false, mode: 'login' });
    expect(el.textContent).not.toBe('');
  });

  it('clears the notice and refreshes status on a successful link bounce', () => {
    const deps = makeDeps();
    installDiscordPopupListener(deps);
    post({ source: 'woc-discord', ok: false, mode: 'link' });
    expect(discordLinkErrorActive()).toBe(true);
    post({ source: 'woc-discord', ok: true, mode: 'link' });
    expect(discordLinkErrorActive()).toBe(false);
    expect(deps.onLinkSuccess).toHaveBeenCalledTimes(1);
  });

  it('ignores a message from a different origin or an unrelated source', () => {
    const deps = makeDeps();
    installDiscordPopupListener(deps);
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { source: 'woc-discord', ok: false, mode: 'link' },
        origin: 'https://evil.example',
      }),
    );
    expect(deps.onLinkPanelUpdate).not.toHaveBeenCalled();
    post({ source: 'some-other-popup', ok: false, mode: 'link' });
    expect(deps.onLinkPanelUpdate).not.toHaveBeenCalled();
  });
});

describe('handleNativeDiscordResult', () => {
  const base: NativeDiscordResult = { ok: true, mode: 'link', code: '', username: 'p', error: '' };

  it('arms the link-error flag on a failed native LINK result, not #login-error', async () => {
    const el = loginErrorEl();
    const deps = makeDeps();
    await handleNativeDiscordResult({ ...base, ok: false, mode: 'link' }, deps);
    expect(discordLinkErrorActive()).toBe(true);
    expect(el.textContent).toBe('');
  });

  it('routes a failed native LOGIN result to #login-error', async () => {
    const el = loginErrorEl();
    const deps = makeDeps();
    await handleNativeDiscordResult({ ...base, ok: false, mode: 'login' }, deps);
    expect(el.textContent).not.toBe('');
  });

  it('clears the notice and calls onLinkSuccess on a successful native LINK result', async () => {
    const deps = makeDeps();
    await handleNativeDiscordResult({ ...base, ok: false, mode: 'link' }, deps);
    expect(discordLinkErrorActive()).toBe(true);
    await handleNativeDiscordResult({ ...base, ok: true, mode: 'link' }, deps);
    expect(discordLinkErrorActive()).toBe(false);
    expect(deps.onLinkSuccess).toHaveBeenCalledTimes(1);
  });

  it('parks a first-time native login choice through onNativeChoosePending', async () => {
    // takeNativeDiscordVerifier reads this exact key (native_discord.ts); the real
    // flow sets it via openNativeDiscordOAuth before the browser round trip.
    localStorage.setItem('woc_native_discord_verifier', 'test-verifier');
    const deps = makeDeps({
      api: {
        exchangeNativeDiscordCode: vi.fn(async () => ({
          choose: true,
          linkToken: 'tok123',
          username: 'NewPlayer',
        })),
      } as unknown as Api,
    });
    await handleNativeDiscordResult({ ...base, mode: 'login', code: 'abc' }, deps);
    expect(deps.onNativeChoosePending).toHaveBeenCalledWith('tok123', 'NewPlayer');
  });
});
