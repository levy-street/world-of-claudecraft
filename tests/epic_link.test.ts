// The character-select Epic Link button gating (src/ui/epic_link.ts): the
// button must key off the shell's REAL capability (wocDesktop.epicLinkSupported,
// backed by the desktop-epic-capability IPC), not the mere presence of the
// epicLinkProof bridge method, which every Electron shell may expose including
// packaged website/steam builds where a proof can never be minted. Driven with a
// hand-rolled fake DOM (jsdom is deliberately not a dependency) and a stubbed
// wocDesktop bridge. Twin of tests/steam_link.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Api } from '../src/net/online';
import { userFacingApiError } from '../src/ui/api_error_i18n';
import { refreshEpicLinkStatus, wireEpicLink } from '../src/ui/epic_link';
import { t } from '../src/ui/i18n';

// epic_link.ts consults DESKTOP_APP at call time; force the desktop arm so the
// bridge path under test is reachable in plain Node.
vi.mock('../src/net/online', () => ({ DESKTOP_APP: true }));

interface FakeElement {
  hidden: boolean;
  textContent: string | null;
  listeners: Record<string, () => void>;
  addEventListener(type: string, handler: () => void): void;
}

function installDom(): Record<string, FakeElement> {
  const elements: Record<string, FakeElement> = {};
  for (const id of ['cs-epic-group', 'epic-status', 'btn-epic-link', 'btn-epic-unlink']) {
    const listeners: Record<string, () => void> = {};
    elements[id] = {
      hidden: false,
      textContent: '',
      listeners,
      addEventListener(type: string, handler: () => void) {
        listeners[type] = handler;
      },
    };
  }
  (globalThis as { document?: unknown }).document = {
    getElementById: (id: string) => elements[id] ?? null,
  };
  return elements;
}

// Drain the promise chain a click handler kicked off (no timers in play).
async function flushAsync(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// Flush the pending microtask (promise) chain WITHOUT advancing the clock, so a
// fake-timer test can settle the async link/unlink flow and then still control
// the 4s flash-restore timer explicitly. Microtasks are never faked, so this
// works whether real or fake timers are installed.
async function settleMicrotasks(): Promise<void> {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

// The login trio is what desktopBridge() requires; the Epic methods ride on top.
function installBridge(epicMethods: Record<string, unknown>): void {
  (globalThis as { wocDesktop?: unknown }).wocDesktop = {
    openBrowserLogin: async () => {},
    takeLoginCode: async () => null,
    onLoginCode: () => () => {},
    ...epicMethods,
  };
}

// An authed, server-advertised, not-yet-linked player: the one state where the
// Link button is a candidate to show at all.
const unlinkedApi = {
  token: 'session-token',
  epicAdvert: async () => true,
  epicStatus: async () => ({ enabled: true, linked: false }),
} as unknown as Api;

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { wocDesktop?: unknown }).wocDesktop;
  // The flash-surfacing tests below install a window shim and fake timers; undo
  // both so the capability-gating tests keep running under real timers.
  delete (globalThis as { window?: unknown }).window;
  vi.useRealTimers();
});

describe('refreshEpicLinkStatus advert and auth gating', () => {
  it('hides the group when unauthenticated', async () => {
    const elements = installDom();
    installBridge({
      epicLinkProof: async () => 'exchangecode',
      epicLinkSupported: async () => true,
    });
    const api = {
      token: null,
      epicAdvert: async () => true,
      epicStatus: async () => ({ enabled: true, linked: false }),
    } as unknown as Api;
    await refreshEpicLinkStatus(api);
    expect(elements['cs-epic-group'].hidden).toBe(true);
  });

  it('hides the group when the server advert is false (dark EPIC_ENABLED)', async () => {
    const elements = installDom();
    installBridge({
      epicLinkProof: async () => 'exchangecode',
      epicLinkSupported: async () => true,
    });
    const epicStatus = vi.fn(async () => ({ enabled: true, linked: false }));
    const api = {
      token: 'session-token',
      epicAdvert: async () => false,
      epicStatus,
    } as unknown as Api;
    await refreshEpicLinkStatus(api);
    expect(elements['cs-epic-group'].hidden).toBe(true);
    // Dark advert must not even attempt the authed status call.
    expect(epicStatus).not.toHaveBeenCalled();
  });

  it('hides the group when status reports enabled false', async () => {
    const elements = installDom();
    installBridge({
      epicLinkProof: async () => 'exchangecode',
      epicLinkSupported: async () => true,
    });
    const api = {
      token: 'session-token',
      epicAdvert: async () => true,
      epicStatus: async () => ({ enabled: false, linked: false }),
    } as unknown as Api;
    await refreshEpicLinkStatus(api);
    expect(elements['cs-epic-group'].hidden).toBe(true);
  });
});

describe('refreshEpicLinkStatus capability gating', () => {
  it('hides the Link button when the shell reports Epic unsupported (website/steam)', async () => {
    const elements = installDom();
    installBridge({
      epicLinkProof: async () => null,
      epicLinkSupported: async () => false,
    });
    await refreshEpicLinkStatus(unlinkedApi);
    expect(elements['cs-epic-group'].hidden).toBe(false);
    expect(elements['btn-epic-link'].hidden).toBe(true);
  });

  it('shows the Link button when the shell reports Epic supported', async () => {
    const elements = installDom();
    installBridge({
      epicLinkProof: async () => 'exchangecode',
      epicLinkSupported: async () => true,
    });
    await refreshEpicLinkStatus(unlinkedApi);
    expect(elements['cs-epic-group'].hidden).toBe(false);
    expect(elements['btn-epic-link'].hidden).toBe(false);
  });

  it('falls back to proof-method presence on older shells without the capability probe', async () => {
    const elements = installDom();
    installBridge({ epicLinkProof: async () => 'exchangecode' });
    await refreshEpicLinkStatus(unlinkedApi);
    expect(elements['btn-epic-link'].hidden).toBe(false);
  });

  it('keeps hiding the Link button when even the proof method is absent', async () => {
    const elements = installDom();
    installBridge({});
    await refreshEpicLinkStatus(unlinkedApi);
    expect(elements['btn-epic-link'].hidden).toBe(true);
  });

  it('falls back to proof-method presence when the capability probe throws', async () => {
    // A transient bridge error must not hide a working Link button; the server
    // stays the authority, so the worst case is a click that mints null.
    const elements = installDom();
    installBridge({
      epicLinkProof: async () => 'exchangecode',
      epicLinkSupported: async () => {
        throw new Error('ipc hiccup');
      },
    });
    await refreshEpicLinkStatus(unlinkedApi);
    expect(elements['btn-epic-link'].hidden).toBe(false);
  });

  it('shows status and Unlink when linked, and hides the Link button', async () => {
    const elements = installDom();
    installBridge({
      epicLinkProof: async () => 'exchangecode',
      epicLinkSupported: async () => true,
    });
    const api = {
      token: 'session-token',
      epicAdvert: async () => true,
      epicStatus: async () => ({ enabled: true, linked: true, epicAccountId: 'epic-acct-1' }),
    } as unknown as Api;
    await refreshEpicLinkStatus(api);
    expect(elements['cs-epic-group'].hidden).toBe(false);
    expect(elements['btn-epic-link'].hidden).toBe(true);
    expect(elements['btn-epic-unlink'].hidden).toBe(false);
    expect(elements['epic-status'].hidden).toBe(false);
    expect(elements['epic-status'].textContent).toContain('epic-acct-1');
  });
});

describe('startEpicLink capability guard', () => {
  it('never mints a proof when the shell reports Epic unsupported', async () => {
    const elements = installDom();
    const mint = vi.fn(async () => 'exchangecode');
    installBridge({
      epicLinkProof: mint,
      epicLinkSupported: async () => false,
    });
    const epicLink = vi.fn(async () => ({}));
    const api = {
      token: 'session-token',
      epicAdvert: async () => true,
      epicStatus: async () => ({ enabled: true, linked: false }),
      epicLink,
    } as unknown as Api;
    wireEpicLink(api);
    elements['btn-epic-link'].listeners.click();
    await flushAsync();
    expect(mint).not.toHaveBeenCalled();
    expect(epicLink).not.toHaveBeenCalled();
  });

  it('mints and posts the proof when the shell reports Epic supported', async () => {
    const elements = installDom();
    const mint = vi.fn(async () => 'exchangecode');
    installBridge({
      epicLinkProof: mint,
      epicLinkSupported: async () => true,
    });
    const epicLink = vi.fn(async () => ({}));
    const api = {
      token: 'session-token',
      epicAdvert: async () => true,
      epicStatus: async () => ({ enabled: true, linked: false }),
      epicLink,
    } as unknown as Api;
    wireEpicLink(api);
    elements['btn-epic-link'].listeners.click();
    await flushAsync();
    expect(mint).toHaveBeenCalledTimes(1);
    expect(epicLink).toHaveBeenCalledWith('exchangecode');
  });

  it('flashes noProof and does not POST when the shell mints null', async () => {
    vi.useFakeTimers();
    (globalThis as { window?: unknown }).window = globalThis;
    const elements = installDom();
    const mint = vi.fn(async () => null);
    const settled = vi.fn(async () => null);
    installBridge({
      epicLinkProof: mint,
      epicLinkSupported: async () => true,
      epicLinkSettled: settled,
    });
    const epicLink = vi.fn(async () => ({}));
    const api = {
      token: 'session-token',
      epicAdvert: async () => true,
      epicStatus: async () => ({ enabled: true, linked: false }),
      epicLink,
    } as unknown as Api;
    wireEpicLink(api);
    await settleMicrotasks();
    elements['btn-epic-link'].listeners.click();
    await settleMicrotasks();
    expect(mint).toHaveBeenCalledTimes(1);
    expect(epicLink).not.toHaveBeenCalled();
    expect(elements['epic-status'].hidden).toBe(false);
    expect(elements['epic-status'].textContent).toBe(t('hudChrome.epic.noProof'));
    // The settle signal still fires in finally so any cancelable handle is released.
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('a double click mints exactly one proof: the in-flight latch drops re-entry', async () => {
    // Two rapid clicks without the latch mint twice: the second mint makes the
    // shell cancel a proof the server may still be verifying, and strands the
    // first handle uncancelled. The latch holds until the attempt settles.
    const elements = installDom();
    let releaseMint: (proof: string) => void = () => {};
    const mint = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          releaseMint = resolve;
        }),
    );
    installBridge({ epicLinkProof: mint, epicLinkSupported: async () => true });
    const epicLink = vi.fn(async () => ({}));
    const api = {
      token: 'session-token',
      epicAdvert: async () => true,
      epicStatus: async () => ({ enabled: true, linked: false }),
      epicLink,
    } as unknown as Api;
    wireEpicLink(api);
    elements['btn-epic-link'].listeners.click();
    await flushAsync(); // past the capability probe: the mint is now pending
    elements['btn-epic-link'].listeners.click(); // mid-flight: must be dropped
    await flushAsync();
    expect(mint).toHaveBeenCalledTimes(1);
    releaseMint('exchangecode');
    await flushAsync();
    expect(epicLink).toHaveBeenCalledTimes(1);
    expect(epicLink).toHaveBeenCalledWith('exchangecode');
    // The latch releases once the attempt settles: a later click mints again.
    elements['btn-epic-link'].listeners.click();
    await flushAsync();
    expect(mint).toHaveBeenCalledTimes(2);
  });
});

// flashEpicStatus writes into #epic-status for 4s. Its restore guard only
// checks textContent, so a status refresh that toggles the element's `hidden`
// after the flash would swallow the error early; and an unlink failure gave no
// user feedback at all on the Steam twin. These drive the wired buttons with a
// window shim (the flash uses window.setTimeout, absent in the node test env)
// under fake timers.
describe('link/unlink failure surfacing', () => {
  // The latch test above deliberately leaves a mint in flight, so the module-level
  // linkInFlight latch stays set; a fresh import gives these attempts a clean latch
  // instead of having the wired click silently dropped as re-entry.
  let epic: typeof import('../src/ui/epic_link');
  beforeEach(async () => {
    vi.resetModules();
    epic = await import('../src/ui/epic_link');
  });

  it('keeps the link error visible after the trailing status refresh, then restores after 4s', async () => {
    vi.useFakeTimers();
    const elements = installDom();
    (globalThis as { window?: unknown }).window = globalThis;
    installBridge({
      epicLinkProof: async () => 'exchangecode',
      epicLinkSupported: async () => true,
    });
    const err = { code: 'epic.invalid_token' };
    const epicLink = vi.fn(async () => {
      throw err;
    });
    const api = {
      token: 'session-token',
      epicAdvert: async () => true,
      epicStatus: async () => ({ enabled: true, linked: false }),
      epicLink,
    } as unknown as Api;

    epic.wireEpicLink(api);
    await settleMicrotasks(); // the wire's initial refresh: unlinked -> status hidden
    elements['btn-epic-link'].listeners.click();
    await settleMicrotasks(); // mint -> epicLink reject -> refresh -> flash

    const status = elements['epic-status'];
    // Decisive: the trailing unlinked refresh (hidden = true) must not swallow
    // the flash. Red on the old order, where the refresh ran after the flash and
    // hid the error within a frame.
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe(userFacingApiError(err));

    // The 4s flash window then restores the prior (hidden, unlinked) status.
    await vi.advanceTimersByTimeAsync(4000);
    expect(status.textContent).toBe('');
    expect(status.hidden).toBe(true);
  });

  it('surfaces a localized error when the unlink call fails', async () => {
    vi.useFakeTimers();
    const elements = installDom();
    (globalThis as { window?: unknown }).window = globalThis;
    installBridge({
      epicLinkProof: async () => 'exchangecode',
      epicLinkSupported: async () => true,
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err = { code: 'epic.upstream' };
    const unlinkEpic = vi.fn(async () => {
      throw err;
    });
    const api = {
      token: 'session-token',
      epicAdvert: async () => true,
      epicStatus: async () => ({ enabled: true, linked: true, epicAccountId: 'epic-acct-1' }),
      unlinkEpic,
    } as unknown as Api;

    epic.wireEpicLink(api);
    await settleMicrotasks(); // initial refresh: linked -> unlink button shown
    elements['btn-epic-unlink'].listeners.click();
    await settleMicrotasks(); // unlink rejects -> dev log + localized flash

    const status = elements['epic-status'];
    expect(status.hidden).toBe(false);
    expect(status.textContent).toBe(userFacingApiError(err));
    // The dev-channel log still fires alongside the localized flash.
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

// After a link attempt settles (server verify resolved OR rejected), the client
// signals the shell so it can cancel any cancelable adapter handle. The signal
// must fire exactly once per attempt on both paths, and an older shell that
// predates the bridge method must not throw (the optional-chained, swallowed call).
describe('link settle signal', () => {
  // Fresh module per test so the module-level linkInFlight latch starts clean
  // (the double-click test above deliberately strands a mint in flight).
  let epic: typeof import('../src/ui/epic_link');
  beforeEach(async () => {
    vi.resetModules();
    epic = await import('../src/ui/epic_link');
  });

  it('signals the shell exactly once after the link POST resolves', async () => {
    const elements = installDom();
    const settled = vi.fn(async () => null);
    installBridge({
      epicLinkProof: async () => 'exchangecode',
      epicLinkSupported: async () => true,
      epicLinkSettled: settled,
    });
    const epicLink = vi.fn(async () => ({}));
    const api = {
      token: 'session-token',
      epicAdvert: async () => true,
      epicStatus: async () => ({ enabled: true, linked: false }),
      epicLink,
    } as unknown as Api;

    epic.wireEpicLink(api);
    await settleMicrotasks();
    elements['btn-epic-link'].listeners.click();
    await settleMicrotasks();
    expect(epicLink).toHaveBeenCalledWith('exchangecode');
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('signals the shell once even when the link POST rejects', async () => {
    vi.useFakeTimers(); // the reject path flashes via window.setTimeout
    (globalThis as { window?: unknown }).window = globalThis;
    const elements = installDom();
    const settled = vi.fn(async () => null);
    installBridge({
      epicLinkProof: async () => 'exchangecode',
      epicLinkSupported: async () => true,
      epicLinkSettled: settled,
    });
    const epicLink = vi.fn(async () => {
      throw { code: 'epic.invalid_token' };
    });
    const api = {
      token: 'session-token',
      epicAdvert: async () => true,
      epicStatus: async () => ({ enabled: true, linked: false }),
      epicLink,
    } as unknown as Api;

    epic.wireEpicLink(api);
    await settleMicrotasks();
    elements['btn-epic-link'].listeners.click();
    await settleMicrotasks();
    // The settle signal fires in the finally, on the rejection path too.
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('does not throw on an older shell without epicLinkSettled', async () => {
    const elements = installDom();
    installBridge({
      epicLinkProof: async () => 'exchangecode',
      epicLinkSupported: async () => true,
    });
    const epicLink = vi.fn(async () => ({}));
    const api = {
      token: 'session-token',
      epicAdvert: async () => true,
      epicStatus: async () => ({ enabled: true, linked: false }),
      epicLink,
    } as unknown as Api;

    epic.wireEpicLink(api);
    await settleMicrotasks();
    elements['btn-epic-link'].listeners.click();
    await settleMicrotasks();
    // The optional-chained call is a no-op; the link still posts, no throw.
    expect(epicLink).toHaveBeenCalledWith('exchangecode');
  });
});

// The browser guard's FALSE arm: every DESKTOP_APP read above is forced true
// so the bridge path is reachable, which leaves `DESKTOP_APP ? ... : null`
// itself unexercised. Re-import with the web value and prove a fully capable
// bridge is still never consulted.
describe('web build (DESKTOP_APP false) never consults the bridge', () => {
  let epic: typeof import('../src/ui/epic_link');
  beforeEach(async () => {
    vi.resetModules();
    vi.doMock('../src/net/online', () => ({ DESKTOP_APP: false }));
    epic = await import('../src/ui/epic_link');
  });
  afterEach(() => {
    // Restore the file-wide desktop-arm mock for any later import.
    vi.doMock('../src/net/online', () => ({ DESKTOP_APP: true }));
  });

  it('shows status but hides Link, and a forced click mints and posts nothing', async () => {
    const elements = installDom();
    const epicLinkProof = vi.fn(async () => 'exchangecode');
    installBridge({ epicLinkProof, epicLinkSupported: async () => true });
    const epicLink = vi.fn(async () => ({}));
    const api = {
      token: 'session-token',
      epicAdvert: async () => true,
      epicStatus: async () => ({ enabled: true, linked: false }),
      epicLink,
    } as unknown as Api;

    epic.wireEpicLink(api);
    await settleMicrotasks();
    // The lit advert still renders the card (web players see link state)...
    expect(elements['cs-epic-group'].hidden).toBe(false);
    // ...but a web build can never mint a proof, so Link stays hidden even
    // though the installed bridge would answer capability true.
    expect(elements['btn-epic-link'].hidden).toBe(true);
    elements['btn-epic-link'].listeners.click();
    await settleMicrotasks();
    expect(epicLinkProof).not.toHaveBeenCalled();
    expect(epicLink).not.toHaveBeenCalled();
  });
});
