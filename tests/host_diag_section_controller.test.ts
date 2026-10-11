// @vitest-environment happy-dom
// Options > Performance > System Report, driven for real (the options sub-panel
// pattern: tests/options_interface_rows.test.ts). The section is deliberately
// tiny now, so the first thing pinned is what it does NOT contain; then the run
// itself: the button must not be usable while it is out, the verdict must be
// announced, and the one untrusted value it prints (the shell's file name) must
// never be markup.
//
// The bridge is installed as the real `globalThis.wocDesktop` global rather than
// mocked, so the section exercises the actual src/game/desktop_host_diag.ts glue
// AND its own availability gate.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({ audio: { click: vi.fn() } }));

import type { DesktopHostDiagGameInfo, DesktopHostDiagResult } from '../src/runtime';
import { renderHostDiagSection } from '../src/ui/host_diag_section_controller';
import { t } from '../src/ui/i18n';

type BridgeHost = { wocDesktop?: unknown };

interface Harness {
  root: HTMLElement;
  parent: HTMLElement;
}

const DEPS = {
  world: () => ({ player: { pos: { x: 12, z: -40 } } }),
  options: () => ({ settings: { get: () => 1 } }),
};

function mount(): Harness {
  // Inside #options-menu, which is where it really lives: that window resets its
  // buttons with an ID-specific `all: revert-layer`, which the busy-state rule
  // has to outrank.
  document.body.innerHTML = '<div id="options-menu"><div id="perf-panel"></div></div>';
  const root = document.getElementById('options-menu') as HTMLElement;
  const parent = document.getElementById('perf-panel') as HTMLElement;
  renderHostDiagSection(parent, DEPS);
  return { root, parent };
}

function createButton(host: Harness): HTMLButtonElement {
  const btn = host.parent.querySelector<HTMLButtonElement>('.hostdiag-action .ui-btn--gold');
  if (!btn) throw new Error('no Generate system report button');
  return btn;
}

function live(host: Harness): HTMLElement {
  const el = host.parent.querySelector<HTMLElement>('.hostdiag-live');
  if (!el) throw new Error('no live region');
  return el;
}

/** A shell exposing the bridge but NOT runHostDiag: what an installed desktop
 *  client predating the feature really looks like. */
function bridgeWithoutHostDiag(): void {
  (globalThis as BridgeHost).wocDesktop = {
    openBrowserLogin: () => Promise.resolve(),
    takeLoginCode: () => Promise.resolve(null),
    onLoginCode: () => () => {},
  };
}

/** A bridge whose runHostDiag resolves only when the test says so, which is what
 *  makes the in-flight state observable (a real run takes ten seconds or more). */
function deferredBridge(): {
  settle: (result: DesktopHostDiagResult) => Promise<void>;
  reject: () => Promise<void>;
  calls: DesktopHostDiagGameInfo[];
} {
  const calls: DesktopHostDiagGameInfo[] = [];
  let resolve: (result: DesktopHostDiagResult) => void = () => {};
  let fail: (err: Error) => void = () => {};
  (globalThis as BridgeHost).wocDesktop = {
    openBrowserLogin: () => Promise.resolve(),
    takeLoginCode: () => Promise.resolve(null),
    onLoginCode: () => () => {},
    runHostDiag: (game: DesktopHostDiagGameInfo) => {
      calls.push(game);
      return new Promise<DesktopHostDiagResult>((r, j) => {
        resolve = r;
        fail = j;
      });
    },
  };
  // Two turns: the glue awaits the bridge, the section then awaits the glue.
  const drain = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };
  return {
    calls,
    settle: async (result) => {
      resolve(result);
      await drain();
    },
    reject: async () => {
      fail(new Error('wedged'));
      await drain();
    },
  };
}

describe('host_diag_section_controller: the availability gate', () => {
  afterEach(() => {
    delete (globalThis as BridgeHost).wocDesktop;
  });

  it('renders nothing at all on a host with no runHostDiag', () => {
    // A browser session (no bridge) and an older installed shell (a bridge
    // WITHOUT the method) both get no section, rather than a button that can
    // never work. The Performance view calls this unconditionally, so the gate
    // living here is what keeps every other host clean.
    delete (globalThis as BridgeHost).wocDesktop;
    expect(mount().parent.children).toHaveLength(0);
    bridgeWithoutHostDiag();
    expect(mount().parent.children).toHaveLength(0);
  });

  it('renders the section on a shell that can produce the file', () => {
    deferredBridge();
    const host = mount();
    expect(host.parent.querySelector('.hostdiag-action')).not.toBeNull();
    expect(host.parent.textContent).toContain(t('hudChrome.hostDiag.title'));
  });
});

describe('host_diag_section_controller: structure', () => {
  beforeEach(() => {
    deferredBridge();
  });
  afterEach(() => {
    delete (globalThis as BridgeHost).wocDesktop;
  });

  it('is exactly one sentence, one button and one live region, and nothing more', () => {
    const host = mount();
    const text = host.parent.textContent ?? '';
    expect(text).toContain(t('hudChrome.hostDiag.intro'));
    // One card, holding a heading, the sentence, the action and the region: the
    // contents list, the privacy paragraph and the send-to-support hint are gone.
    expect(host.parent.children).toHaveLength(1);
    expect(host.parent.querySelectorAll('ul, li')).toHaveLength(0);
    expect(host.parent.querySelectorAll('button')).toHaveLength(1);
    expect(host.parent.querySelectorAll('.hostdiag-live')).toHaveLength(1);
    expect(host.parent.querySelectorAll('.set-note')).toHaveLength(1);
    expect(createButton(host).textContent).toBe(t('hudChrome.hostDiag.create'));
  });

  it('carries a POLITE live region that exists before anything is written into it', () => {
    // An announcement region inserted together with its text is not reliably
    // announced, so the region must be present and empty on the first paint.
    const host = mount();
    const region = live(host);
    expect(region.getAttribute('role')).toBe('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
    expect(createButton(host).disabled).toBe(false);
  });

  it('mounts no footer and no window chrome of its own', () => {
    // It is a section inside the Performance view now, not a sub-view: the Back
    // and close controls belong to that view.
    const host = mount();
    expect(host.root.querySelector('.ui-win-foot')).toBeNull();
    expect(host.root.querySelector('[data-back]')).toBeNull();
  });
});

describe('host_diag_section_controller: a run', () => {
  afterEach(() => {
    delete (globalThis as BridgeHost).wocDesktop;
  });

  it('marks the button busy with a collecting status while the run is out, then frees it', async () => {
    const bridge = deferredBridge();
    const host = mount();
    const btn = createButton(host);
    btn.click();
    expect(btn.getAttribute('aria-disabled'), 'busy while one is in flight').toBe('true');
    expect(btn.disabled, 'never natively disabled: that would drop keyboard focus').toBe(false);
    expect(btn.getAttribute('aria-busy')).toBe('true');
    expect(live(host).textContent).toBe(t('hudChrome.hostDiag.running'));
    // A press while busy must not reach the bridge again.
    btn.click();
    expect(bridge.calls).toHaveLength(1);

    await bridge.settle({ status: 'saved', nativeStatus: 'ok', fileName: 'report.json' });
    expect(btn.getAttribute('aria-disabled'), 'usable again after a completed run').toBe('false');
    expect(btn.getAttribute('aria-busy')).toBe('false');
    // Focus stays put because the button is never rebuilt.
    expect(host.parent.contains(btn)).toBe(true);
    expect(live(host).textContent).toBe(t('hudChrome.hostDiag.saved', { fileName: 'report.json' }));
  });

  it('says the same plain saved line for every native status', async () => {
    const statuses: DesktopHostDiagResult['nativeStatus'][] = [
      'ok',
      'partial',
      'unsupported-platform',
      'unavailable',
      'error',
    ];
    for (const nativeStatus of statuses) {
      const bridge = deferredBridge();
      const host = mount();
      createButton(host).click();
      await bridge.settle({ status: 'saved', nativeStatus, fileName: 'r.json' });
      expect(live(host).textContent, String(nativeStatus)).toBe(
        t('hudChrome.hostDiag.saved', { fileName: 'r.json' }),
      );
      expect(live(host).classList.contains('is-success')).toBe(true);
    }
  });

  it('sends the perf-report session id and the game context it could resolve', async () => {
    const bridge = deferredBridge();
    sessionStorage.setItem('woc_perf_session_id', 'joinme-1234');
    const host = mount();
    createButton(host).click();
    expect(bridge.calls[0]?.sessionId, 'the join key for the automatic perf reports').toBe(
      'joinme-1234',
    );
    expect(typeof bridge.calls[0]?.releaseVersion).toBe('string');
    expect(typeof bridge.calls[0]?.locale).toBe('string');
    await bridge.settle({ status: 'cancelled', nativeStatus: null });
    sessionStorage.removeItem('woc_perf_session_id');
  });

  it('renders a hostile file name as TEXT, never as markup', async () => {
    const bridge = deferredBridge();
    const host = mount();
    createButton(host).click();
    await bridge.settle({
      status: 'saved',
      nativeStatus: 'ok',
      fileName: '<img src=x onerror=alert(1)>',
    });
    const message = host.parent.querySelector<HTMLElement>('.hostdiag-message');
    expect(message?.querySelector('img'), 'no element was created from the name').toBeNull();
    expect(message?.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(live(host).classList.contains('is-success')).toBe(true);
  });

  it('says nothing at all when the player closed the save dialog', async () => {
    const bridge = deferredBridge();
    const host = mount();
    const btn = createButton(host);
    btn.click();
    await bridge.settle({ status: 'cancelled', nativeStatus: null });
    expect(live(host).textContent, 'a cancel is a decision, not a message').toBe('');
    expect(live(host).className).toBe('hostdiag-live');
    expect(btn.disabled).toBe(false);
  });

  it('reports one try-again line for a failure and a rejected promise, and the running line for a busy shell', async () => {
    const failure = t('hudChrome.hostDiag.failed');
    const errored = deferredBridge();
    const a = mount();
    createButton(a).click();
    await errored.settle({ status: 'error', nativeStatus: 'error' });
    expect(live(a).textContent).toBe(failure);
    expect(live(a).classList.contains('is-error')).toBe(true);

    const busy = deferredBridge();
    const b = mount();
    createButton(b).click();
    await busy.settle({ status: 'busy', nativeStatus: null });
    // The first run is still open and will write its file: not a failure.
    expect(live(b).textContent).toBe(t('hudChrome.hostDiag.running'));
    expect(live(b).classList.contains('is-info')).toBe(true);
    expect(live(b).classList.contains('is-error')).toBe(false);

    const wedged = deferredBridge();
    const c = mount();
    const btn = createButton(c);
    btn.click();
    await wedged.reject();
    expect(live(c).textContent).toBe(failure);
    expect(btn.getAttribute('aria-disabled'), 'and the button comes back').toBe('false');
  });

  it('writes nothing once its nodes have been discarded by a navigation away', async () => {
    // The save dialog is the player's to answer, so a run routinely outlives the
    // section; the settled request must not paint into a detached tree.
    const bridge = deferredBridge();
    const host = mount();
    createButton(host).click();
    const region = live(host);
    document.body.innerHTML = '';
    await bridge.settle({ status: 'saved', nativeStatus: 'ok', fileName: 'r.json' });
    expect(region.textContent).toBe(t('hudChrome.hostDiag.running'));
  });
});
