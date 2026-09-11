// The micro-menu rail's pure state core: which launcher's ring lights, which
// launcher carries a count badge, and what that badge reads. Host-agnostic, so the
// whole decision is exercised here without a DOM; the DOM half lives in
// tests/micro_menu_state_painter.test.ts.
//
// The registry itself is load-bearing and is pinned against the real entry
// documents: a launcher selector or a window id that does not exist in index.html /
// play.html would light nothing forever, and the failure is invisible in play.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  createMicroMenuStateView,
  MICRO_MENU_BADGES,
  MICRO_MENU_LAUNCHERS,
} from '../src/ui/micro_menu_state_view';

const indexHtml = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const playHtml = readFileSync(new URL('../play.html', import.meta.url), 'utf8');
const hudCss = readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8');
// Windows that ship in no markup entry: their painter mints the root on first
// open. The value is the module that mints it, so the exemption stays anchored to
// real code and a renamed or deleted mint fails here instead of going quiet.
const RUNTIME_MINTED_WINDOWS: Readonly<Record<string, string>> = {
  'perfecting-window': '../src/ui/hud/professions/perfecting_window.ts',
};

const view = () => createMicroMenuStateView((value) => String(value));

/** Every launcher reports closed unless its window id is in the open set. */
const openOnly = (...ids: string[]) => {
  const open = new Set(ids);
  return (windowId: string) => open.has(windowId);
};

describe('micro_menu_state_view: the open-window ring', () => {
  it('lights only the launcher whose window is open', () => {
    const state = view().tick(openOnly('map-window'), { talentPoints: 0 });
    const on = state.launchers.filter((l) => l.on).map((l) => l.selector);
    expect(on).toEqual(['#mm-map']);
  });

  it('lights every open launcher and clears one that closed', () => {
    const v = view();
    let state = v.tick(openOnly('bags', 'char-window'), { talentPoints: 0 });
    expect(
      state.launchers
        .filter((l) => l.on)
        .map((l) => l.selector)
        .sort(),
    ).toEqual(['#mm-bag', '#mm-char']);
    state = v.tick(openOnly('bags'), { talentPoints: 0 });
    expect(state.launchers.filter((l) => l.on).map((l) => l.selector)).toEqual(['#mm-bag']);
  });

  it('reuses one state object across ticks (no per-tick allocation)', () => {
    const v = view();
    const first = v.tick(openOnly(), { talentPoints: 0 });
    const second = v.tick(openOnly('spellbook'), { talentPoints: 3 });
    expect(second).toBe(first);
    expect(second.launchers[0]).toBe(first.launchers[0]);
  });

  it('never rings a launcher that is not a window opener', () => {
    // The ring means "this button's window is open". #mm-music keeps its own
    // mm-on gold, and the three non-window launchers open no `.window` at all.
    const selectors = MICRO_MENU_LAUNCHERS.map((l) => l.selector);
    // The positive control: an emptied registry would satisfy every exclusion below
    // without ringing anything, so name launchers that MUST still be here.
    expect(selectors, 'the window openers still take the ring').toEqual(
      expect.arrayContaining([
        '#mm-map',
        '#mm-bag',
        '#mm-char',
        '#mm-options',
        // The four plain window toggles that were missing from the registry
        // (2026-09 review): no ring and no aria-pressed until they landed here.
        '#mm-cosmetics',
        '#mm-harvest-journal',
        '#mm-loot-explorer',
        '#mm-perfecting',
      ]),
    );
    for (const excluded of ['#mm-music', '#mm-emote', '#mm-wiki', '#mm-discord']) {
      expect(selectors, `${excluded} must not take the open-window ring`).not.toContain(excluded);
    }
  });
});

describe('micro_menu_state_view: the count badges', () => {
  it('shows the unspent talent points and hides the badge at zero', () => {
    const v = view();
    let state = v.tick(openOnly(), { talentPoints: 0 });
    expect(state.badges).toEqual([{ selector: '#mm-talents', count: 0, text: '', visible: false }]);
    state = v.tick(openOnly(), { talentPoints: 4 });
    expect(state.badges[0]).toEqual({
      selector: '#mm-talents',
      count: 4,
      text: '4',
      visible: true,
    });
    state = v.tick(openOnly(), { talentPoints: 0 });
    // Empty text IS the hidden state: `.mm-badge:empty` is display:none, so the
    // painter keeps to one elided write per badge.
    expect(state.badges[0]).toMatchObject({ text: '', visible: false });
  });

  it('clamps a negative or fractional count to a whole non-negative value', () => {
    const v = view();
    expect(v.tick(openOnly(), { talentPoints: -3 }).badges[0]).toMatchObject({
      count: 0,
      text: '',
      visible: false,
    });
    expect(v.tick(openOnly(), { talentPoints: 2.9 }).badges[0]).toMatchObject({
      count: 2,
      text: '2',
      visible: true,
    });
  });

  it('re-formats on every tick so a language switch is never frozen out', () => {
    // The count is unchanged across both ticks; only the formatter changed. A
    // value memo here would keep rendering the old locale's digits.
    let locale = 'a';
    const v = createMicroMenuStateView((value) => `${locale}${value}`);
    expect(v.tick(openOnly(), { talentPoints: 2 }).badges[0].text).toBe('a2');
    locale = 'b';
    expect(v.tick(openOnly(), { talentPoints: 2 }).badges[0].text).toBe('b2');
  });
});

describe('micro_menu_state_view: the registry is real', () => {
  it('rings each of the four late-added launchers from its own window', () => {
    const cases: ReadonlyArray<readonly [string, string]> = [
      ['#mm-cosmetics', 'cosmetics-window'],
      ['#mm-harvest-journal', 'harvest-journal-window'],
      ['#mm-loot-explorer', 'loot-explorer-window'],
      ['#mm-perfecting', 'perfecting-window'],
    ];
    for (const [selector, windowId] of cases) {
      const state = view().tick(openOnly(windowId), { talentPoints: 0 });
      expect(
        state.launchers.filter((l) => l.on).map((l) => l.selector),
        `${windowId} must light ${selector} and nothing else`,
      ).toEqual([selector]);
    }
  });

  it('names a launcher and a window that exist in BOTH entry documents', () => {
    expect(MICRO_MENU_LAUNCHERS.length).toBeGreaterThan(0);
    for (const { selector, windowId } of MICRO_MENU_LAUNCHERS) {
      const launcherId = `id="${selector.slice(1)}"`;
      expect(indexHtml, `index.html has no ${selector}`).toContain(launcherId);
      expect(playHtml, `play.html has no ${selector}`).toContain(launcherId);
      const minter = RUNTIME_MINTED_WINDOWS[windowId];
      if (minter) {
        // The runtime-minted root: prove the mint really assigns this id AND the
        // .window.panel classes Hud's observer keys its open-state stamp off, so
        // the ring has something to read once the window opens.
        const source = readFileSync(new URL(minter, import.meta.url), 'utf8');
        expect(source, `${minter} does not mint #${windowId}`).toContain(`root.id = '${windowId}'`);
        expect(source, `${minter} does not mint a .window.panel root`).toContain(
          "root.className = 'window panel'",
        );
        continue;
      }
      expect(indexHtml, `index.html has no #${windowId}`).toContain(`id="${windowId}"`);
      expect(playHtml, `play.html has no #${windowId}`).toContain(`id="${windowId}"`);
    }
  });

  it('maps every launcher to a distinct window', () => {
    const windows = MICRO_MENU_LAUNCHERS.map((l) => l.windowId);
    expect(new Set(windows).size).toBe(windows.length);
    const selectors = MICRO_MENU_LAUNCHERS.map((l) => l.selector);
    expect(new Set(selectors).size).toBe(selectors.length);
  });

  it('hides an empty badge in the stylesheet (the painter never writes display)', () => {
    // The zero state is empty text, so the hide has to be a CSS rule; without it a
    // zero-count badge would render as an empty pill on the launcher.
    expect(hudCss).toContain('.micro-btn .mm-badge:empty');
  });

  it('badges only launchers the ring registry already knows', () => {
    const selectors = new Set(MICRO_MENU_LAUNCHERS.map((l) => l.selector));
    for (const badge of MICRO_MENU_BADGES) {
      expect(selectors, `${badge.selector} is badged but is not a launcher`).toContain(
        badge.selector,
      );
    }
  });
});
