// @vitest-environment jsdom
//
// Executed-DOM guards for the shared window-frame builder itself (the pure id /
// aria derivations live in window_frame_view.test.ts; the per-window adoptions
// in *_window_frame.test.ts). Three contracts pinned here:
// - the painted chrome matches the model: the close control carries its derived
//   id, aria-controls exists ONLY on the selected tab (a dangling idref on an
//   unselected tab is an axe failure), and the tabpanel body is labelled by its
//   active tab, all re-pointed on a tab change (click and programmatic).
// - relocalizeWindowFrame re-resolves the stamped t() chrome (title, tab
//   labels, close aria-label) after a language switch: the ensureWindowFrame
//   reuse path returns the cached chrome without re-running the builder, so
//   without the re-stamp the frame keeps the open-time language for the
//   session, including across close/reopen.
// - the Hud language fan-out actually invokes the helper over mounted frames.

import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  applyActiveWindowTab,
  relocalizeWindowFrame,
  renderWindowFrame,
} from '../src/ui/window_frame';
import { ensureWindowFrame } from '../src/ui/window_frame_mount';
import type { WindowFrameDescriptor } from '../src/ui/window_frame_view';

// The builder resolves keys through t() at stamp time; a controllable resolver
// makes the "which language was resolved" question observable without loading
// locale overlays. `lang` is read at CALL time, so flipping it models a live
// language switch.
let lang = 'en';
vi.mock('../src/ui/i18n', () => ({
  t: (key: string) => `${lang}:${key}`,
}));

// Real catalog leaves (the TranslationKey type demands them); which leaf is
// irrelevant, the mocked t() never resolves them.
const TABBED: WindowFrameDescriptor = {
  id: 'w',
  titleKey: 'itemUi.vendor.goodsTitle',
  closeLabelKey: 'itemUi.vendor.close',
  tabs: [
    { id: 'buy', labelKey: 'itemUi.market.browse' },
    { id: 'sell', labelKey: 'itemUi.market.sell' },
  ],
};

function mountFrame(descriptor: WindowFrameDescriptor = TABBED, activeTab?: string) {
  const el = document.createElement('div');
  document.body.appendChild(el);
  const parts = renderWindowFrame(el, descriptor, {}, activeTab);
  return { el, parts };
}

afterEach(() => {
  document.body.innerHTML = '';
  lang = 'en';
});

describe('renderWindowFrame: painted chrome matches the model', () => {
  it('paints the derived id on the close control (the model derives and tests pin it)', () => {
    const { el } = mountFrame();
    const close = el.querySelector<HTMLElement>('[data-window-close]');
    expect(close?.id).toBe('w-close');
  });

  it('paints aria-controls ONLY on the selected tab, resolving to the live body', () => {
    const { el, parts } = mountFrame(TABBED, 'sell');
    const buy = el.querySelector<HTMLElement>('[data-window-tab="buy"]');
    const sell = el.querySelector<HTMLElement>('[data-window-tab="sell"]');
    expect(sell?.getAttribute('aria-controls')).toBe('w-panel-sell');
    expect(buy?.hasAttribute('aria-controls')).toBe(false);
    // The one idref painted resolves to a real node: the body IS the panel.
    expect(parts.body.id).toBe('w-panel-sell');
    // Every tab still names its derived panel for the tab-change paths.
    expect(buy?.dataset.panelId).toBe('w-panel-buy');
    expect(sell?.dataset.panelId).toBe('w-panel-sell');
  });

  it('labels the tabpanel body by its active tab (aria-labelledby)', () => {
    const { parts } = mountFrame(TABBED, 'sell');
    expect(parts.body.getAttribute('aria-labelledby')).toBe('w-tab-sell');
  });

  it('re-points aria-controls, the body id, and the body labelling on a tab click', () => {
    const { el, parts } = mountFrame(TABBED, 'buy');
    el.querySelector<HTMLButtonElement>('[data-window-tab="sell"]')?.click();
    const buy = el.querySelector<HTMLElement>('[data-window-tab="buy"]');
    const sell = el.querySelector<HTMLElement>('[data-window-tab="sell"]');
    expect(sell?.getAttribute('aria-selected')).toBe('true');
    expect(sell?.getAttribute('aria-controls')).toBe('w-panel-sell');
    expect(buy?.hasAttribute('aria-controls')).toBe(false);
    expect(parts.body.id).toBe('w-panel-sell');
    expect(parts.body.getAttribute('aria-labelledby')).toBe('w-tab-sell');
  });

  it('applyActiveWindowTab re-affirms the same state for a Hud-driven switch', () => {
    const { parts } = mountFrame(TABBED, 'buy');
    applyActiveWindowTab(parts.tabButtons, parts.body, 'sell');
    const [buy, sell] = parts.tabButtons;
    expect(sell.getAttribute('aria-selected')).toBe('true');
    expect(sell.tabIndex).toBe(0);
    expect(sell.getAttribute('aria-controls')).toBe('w-panel-sell');
    expect(buy.hasAttribute('aria-controls')).toBe(false);
    expect(buy.tabIndex).toBe(-1);
    expect(parts.body.id).toBe('w-panel-sell');
    expect(parts.body.getAttribute('aria-labelledby')).toBe('w-tab-sell');
  });

  it('a tab-less window paints no aria-labelledby on the body', () => {
    const { parts } = mountFrame({
      id: 'plain',
      titleKey: 'itemUi.vendor.goodsTitle',
      closeLabelKey: 'itemUi.vendor.close',
    });
    expect(parts.body.hasAttribute('aria-labelledby')).toBe(false);
    expect(parts.body.id).toBe('plain-body');
  });
});

describe('relocalizeWindowFrame: live language switch', () => {
  it('the reuse path alone keeps the stamped language (the bug this helper fixes)', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    ensureWindowFrame(host, TABBED, {});
    lang = 'de';
    const reused = ensureWindowFrame(host, TABBED, {});
    // Reuse never re-runs the builder: still the open-time language.
    expect(reused.root.querySelector('.window-title')?.textContent).toBe(
      'en:itemUi.vendor.goodsTitle',
    );
  });

  it('re-resolves the title, tab labels, and close aria-label from the stamped keys', () => {
    const { parts } = mountFrame();
    lang = 'fr';
    relocalizeWindowFrame(parts.root);
    expect(parts.root.querySelector('.window-title')?.textContent).toBe(
      'fr:itemUi.vendor.goodsTitle',
    );
    expect(parts.root.querySelector('[data-window-close]')?.getAttribute('aria-label')).toBe(
      'fr:itemUi.vendor.close',
    );
    expect(parts.tabButtons.map((b) => b.textContent)).toEqual([
      'fr:itemUi.market.browse',
      'fr:itemUi.market.sell',
    ]);
  });

  it('preserves consumer-added element children (title subtitle span, tab pip)', () => {
    const { parts } = mountFrame();
    // The talents window appends a pip inside each tab; several windows append
    // a subtitle span after the title text. Both must survive the re-stamp.
    const pip = document.createElement('span');
    pip.className = 'tt-pts';
    pip.textContent = '3';
    parts.tabButtons[0].appendChild(pip);
    const title = parts.root.querySelector<HTMLElement>('.window-title') as HTMLElement;
    const sub = document.createElement('span');
    sub.className = 'panel-subtitle';
    sub.textContent = 'sub';
    title.appendChild(sub);

    lang = 'es';
    relocalizeWindowFrame(parts.root);
    expect(parts.tabButtons[0].querySelector('.tt-pts')?.textContent).toBe('3');
    expect(parts.tabButtons[0].firstChild?.nodeValue).toBe('es:itemUi.market.browse');
    expect(title.querySelector('.panel-subtitle')?.textContent).toBe('sub');
    expect(title.firstChild?.nodeValue).toBe('es:itemUi.vendor.goodsTitle');
  });
});

describe('hud language fan-out wiring (source pin)', () => {
  const hudTs = readFileSync('src/ui/hud.ts', 'utf8');
  it('refreshLocalizedDynamicUi relocalizes every mounted window frame first', () => {
    const body = hudTs.slice(hudTs.indexOf('private refreshLocalizedDynamicUi(): void {'));
    const fanout = body.slice(0, body.indexOf('this.refreshKeybindLabels();'));
    expect(fanout).toContain("document.querySelectorAll<HTMLElement>('.window-frame')");
    expect(fanout).toContain('relocalizeWindowFrame(frame);');
  });
});
