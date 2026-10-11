// @vitest-environment happy-dom
//
// Options > Performance is now "Performance", not "Performance Overlay": the
// overlay controls sit under their own section heading, and the desktop shell's
// System Report rides under them as a second section. This drives the real
// PerfOverlaySettingsPanel and pins both halves of that arrangement, including
// the one that is easy to break by accident: the overlay controls must render
// identically whether or not the host can produce a system report.

import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({ audio: { click: vi.fn() } }));

import { t } from '../src/ui/i18n';
import { defaultPerfOverlayConfig } from '../src/ui/perf_overlay_config';
import { PerfOverlaySettingsPanel, type PerfSettingsHost } from '../src/ui/perf_overlay_settings';

type BridgeHost = { wocDesktop?: unknown };

function makeHost(): PerfSettingsHost {
  return {
    perf: {
      get: () => defaultPerfOverlayConfig(),
      patch: () => {},
      setMetric: () => {},
      reset: () => {},
      resetPosition: () => {},
      setPlacement: () => {},
    },
    getShowFps: () => true,
    setShowFps: () => {},
    click: () => {},
    onClose: () => {},
    onBack: () => {},
    closeIconHtml: '<svg data-icon="close"></svg>',
    backIconHtml: '<svg data-icon="prev"></svg>',
    hostDiag: {
      world: () => ({ player: { pos: { x: 0, z: 0 } } }),
      options: () => ({ settings: { get: () => 1 } }),
    },
  };
}

function render(): HTMLElement {
  const container = document.createElement('div');
  new PerfOverlaySettingsPanel(makeHost()).render(container);
  return container;
}

/** The overlay half of the view, which must be identical on every host. */
function overlayShape(container: HTMLElement): string[] {
  return [
    ...container.querySelectorAll(
      '.perf-master, .perf-cols .perf-card-title, .perf-chips, .perf-presets, .perf-swatches',
    ),
  ].map((el) => `${el.className}:${el.textContent}`);
}

function installBridge(withHostDiag: boolean): void {
  (globalThis as BridgeHost).wocDesktop = {
    openBrowserLogin: () => Promise.resolve(),
    takeLoginCode: () => Promise.resolve(null),
    onLoginCode: () => () => {},
    ...(withHostDiag ? { runHostDiag: () => Promise.resolve(null) } : {}),
  };
}

describe('PerfOverlaySettingsPanel: the two sections', () => {
  afterEach(() => {
    delete (globalThis as BridgeHost).wocDesktop;
  });

  it('titles the view "Performance" with no section heading when the overlay is the only section', () => {
    // A browser or phone session: one section, so no heading (on a phone in
    // landscape it would eat close to half of the visible strip).
    delete (globalThis as BridgeHost).wocDesktop;
    const container = render();
    expect(container.querySelector('.panel-title span')?.textContent).toBe(
      t('hudChrome.perf.title'),
    );
    expect(container.querySelector('.perf-panel > .perf-card-title')).toBeNull();
    expect(container.textContent).not.toContain(t('hudChrome.hostDiag.title'));
  });

  it('heads the overlay controls "Performance Overlay" once the System Report follows them', () => {
    installBridge(true);
    const container = render();
    expect(container.querySelector('.panel-title span')?.textContent).toBe(
      t('hudChrome.perf.title'),
    );
    // The heading spans the panel rather than being boxed, so the overlay's own
    // cards below it stay one level deep.
    const head = container.querySelector('.perf-panel > .perf-card-title') as Element;
    expect(head).not.toBeNull();
    expect(head.textContent).toBe(t('hudChrome.perf.overlaySection'));
    expect(
      head.compareDocumentPosition(container.querySelector('.perf-master') as Node) &
        Node.DOCUMENT_POSITION_FOLLOWING,
      'the heading leads the controls it names',
    ).toBeTruthy();
  });

  it('omits the System Report section on a host that cannot produce one', () => {
    // No bridge at all (a browser session), and a bridge WITHOUT runHostDiag (an
    // installed shell predating the feature) are the two cases.
    delete (globalThis as BridgeHost).wocDesktop;
    expect(render().querySelector('.hostdiag-action')).toBeNull();
    installBridge(false);
    expect(render().querySelector('.hostdiag-action')).toBeNull();
  });

  it('adds the System Report section, below the overlay, on a desktop shell', () => {
    installBridge(true);
    const container = render();
    const action = container.querySelector('.hostdiag-action');
    expect(action).not.toBeNull();
    expect(container.textContent).toContain(t('hudChrome.hostDiag.intro'));
    const cols = container.querySelector('.perf-cols') as Element;
    expect(
      cols.compareDocumentPosition(action as Node) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the System Report section sits under the overlay controls',
    ).toBeTruthy();
    // It is the last thing in the scrolling body, and the footer still sits
    // outside it.
    expect(container.querySelector('.perf-panel')?.lastElementChild?.contains(action as Node)).toBe(
      true,
    );
  });

  it('renders the overlay controls identically with and without the System Report', () => {
    installBridge(false);
    const without = overlayShape(render());
    installBridge(true);
    const withSection = overlayShape(render());
    expect(without.length).toBeGreaterThan(0);
    expect(withSection).toEqual(without);
  });
});
