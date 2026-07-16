// @vitest-environment jsdom
//
// DOM behavioral guard: keyboard focus across Book of Deeds rebuilds. Every
// Enter activation (rail category, filter chip, watch toggle, title option)
// destroys the focused control with the innerHTML rebuild; focus must land on
// the role-equivalent fresh control (the social/market/mailbox refocus
// family), falling back to Close only when no enabled match survives. Drives
// the real DeedsWindow over jsdom with stub deps, the
// leaderboard_window_stale.test.ts pattern (the source pins live in
// deeds_window.test.ts).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { freshDeedStats } from '../src/sim/deeds';
import { DEED_WATCH_CAP } from '../src/ui/deeds_view';
import { DeedsWindow, type DeedsWindowDeps, refocusSelector } from '../src/ui/deeds_window';

// jsdom ships no 2D canvas, so the procedural crest compositor cannot run
// here; the painter only ever uses the returned string as an <img src>.
vi.mock('../src/ui/icons', () => ({
  iconDataUrl: () => 'data:,',
}));

interface WorldState {
  deedsEarned: Map<string, string>;
  renown: number;
  activeTitle: string | null;
}

function baseState(): WorldState {
  return { deedsEarned: new Map(), renown: 0, activeTitle: null };
}

function makeWindow(state: WorldState): { w: DeedsWindow; el: HTMLElement } {
  const el = document.createElement('div');
  el.id = 'deeds-window';
  document.body.appendChild(el);
  const stats = freshDeedStats();
  const deps: DeedsWindowDeps = {
    root: () => el,
    world: () =>
      ({
        deedsEarned: state.deedsEarned,
        deedStats: stats,
        renown: state.renown,
        activeTitle: state.activeTitle,
        deedsRarity: async () => null,
        setActiveTitle: (id: string | null) => {
          state.activeTitle = id;
        },
        cfg: { playerClass: 'warrior' },
        player: { name: 'Hero' },
      }) as never,
    closeOthers: () => {},
    hideTooltip: () => {},
    consumePeek: () => false,
    captureFocus: () => null,
    restoreFocus: () => {},
    onWatchChanged: () => {},
    itemIcon: () => '',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: () => {},
  };
  const w = new DeedsWindow(deps);
  w.open();
  return { w, el };
}

/** Focus then click: the keyboard Enter activation shape (Enter on a focused
 *  button fires its click handler with the button as the active element). */
function focusClick(el: HTMLElement, selector: string): HTMLElement {
  const btn = el.querySelector<HTMLElement>(selector);
  if (!btn) throw new Error(`missing ${selector}`);
  btn.focus();
  btn.click();
  return btn;
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('DeedsWindow: focus survives rebuilds', () => {
  it('focuses the Close button on cold open so a keyboard user enters the dialog', () => {
    // open() moves focus into the freshly displayed window (the cold-window house
    // pattern), so a keyboard-only user is not stranded on the opener while the
    // Tab trap is active. makeWindow calls open() with no manual focus.
    const { el } = makeWindow(baseState());
    expect(document.activeElement).toBe(el.querySelector('[data-close]'));
  });

  it('keeps focus on the same rail category button across the rebuild', () => {
    const { el } = makeWindow(baseState());
    const before = focusClick(el, '[data-cat="combat"]');
    const fresh = el.querySelector<HTMLElement>('[data-cat="combat"]');
    expect(fresh).not.toBe(before);
    expect(fresh?.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(fresh);
  });

  it('keeps focus on the same filter chip across the rebuild', () => {
    const { el } = makeWindow(baseState());
    const before = focusClick(el, '[data-filter="earned"]');
    const fresh = el.querySelector<HTMLElement>('[data-filter="earned"]');
    expect(fresh).not.toBe(before);
    expect(fresh?.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(fresh);
  });

  it('keeps focus on a watch toggle whose button survives the rebuild', () => {
    const { el } = makeWindow(baseState());
    focusClick(el, '[data-watch="prog_first_steps"]');
    const fresh = el.querySelector<HTMLElement>('[data-watch="prog_first_steps"]');
    expect(fresh?.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(fresh);
  });

  it('keeps focus on the equipped title option across the rebuild', () => {
    const state = baseState();
    state.deedsEarned.set('prog_veteran', '2026-07-01');
    const { el } = makeWindow(state);
    el.querySelector<HTMLElement>('[data-cat="titles"]')?.click();
    focusClick(el, '[data-title="prog_veteran"]');
    const fresh = el.querySelector<HTMLElement>('[data-title="prog_veteran"]');
    expect(fresh?.getAttribute('aria-pressed')).toBe('true');
    expect(document.activeElement).toBe(fresh);
  });

  it('falls back to Close when the focused watch card leaves the current filter', () => {
    const state = baseState();
    const { w, el } = makeWindow(state);
    el.querySelector<HTMLElement>('[data-filter="unearned"]')?.click();
    el.querySelector<HTMLElement>('[data-watch="prog_first_steps"]')?.focus();
    state.deedsEarned.set('prog_first_steps', '2026-07-12');
    w.refreshIfChanged();
    expect(el.querySelector('[data-watch="prog_first_steps"]')).toBeNull();
    expect(document.activeElement).toBe(el.querySelector('[data-close]'));
  });

  it('falls back to Close when the fresh match renders disabled at the watch cap', () => {
    const { el } = makeWindow(baseState());
    const ids = [...el.querySelectorAll<HTMLElement>('[data-watch]')].map(
      (btn) => btn.getAttribute('data-watch') ?? '',
    );
    expect(ids.length).toBeGreaterThan(DEED_WATCH_CAP);
    // Fill all but the last watch slot (no focus involved: each click rebuilds
    // with focus on <body>).
    for (let i = 0; i < DEED_WATCH_CAP - 1; i++) {
      el.querySelector<HTMLElement>(`[data-watch="${ids[i]}"]`)?.click();
    }
    // Focus an unwatched button, then fill the last slot from another one: the
    // rebuild renders the focused button disabled (the cap note), and a
    // disabled control must never receive the refocus.
    el.querySelector<HTMLElement>(`[data-watch="${ids[DEED_WATCH_CAP]}"]`)?.focus();
    el.querySelector<HTMLElement>(`[data-watch="${ids[DEED_WATCH_CAP - 1]}"]`)?.click();
    const fresh = el.querySelector(
      `[data-watch="${ids[DEED_WATCH_CAP]}"]`,
    ) as HTMLButtonElement | null;
    expect(fresh?.disabled).toBe(true);
    expect(document.activeElement).toBe(el.querySelector('[data-close]'));
  });

  it('preserves the search caret across a search-driven rebuild', () => {
    const { el } = makeWindow(baseState());
    const input = el.querySelector('.deed-search') as HTMLInputElement;
    input.focus();
    input.value = 'first';
    input.setSelectionRange(2, 2);
    input.dispatchEvent(new Event('input'));
    const fresh = el.querySelector('.deed-search') as HTMLInputElement;
    expect(fresh).not.toBe(input);
    expect(fresh.value).toBe('first');
    expect(document.activeElement).toBe(fresh);
    expect(fresh.selectionStart).toBe(2);
    expect(fresh.selectionEnd).toBe(2);
  });
});

describe('refocusSelector', () => {
  it('builds the identity selector and escapes selector-quote specials', () => {
    const host = document.createElement('div');
    host.innerHTML = '<button data-cat="combat"></button>';
    const plain = host.firstElementChild as HTMLElement;
    expect(refocusSelector(plain)).toBe('[data-cat="combat"]:not([disabled])');

    const weird = document.createElement('button');
    weird.setAttribute('data-title', 'a"b\\c');
    host.appendChild(weird);
    const sel = refocusSelector(weird);
    expect(sel).toBe('[data-title="a\\"b\\\\c"]:not([disabled])');
    expect(host.querySelector(sel as string)).toBe(weird);

    expect(refocusSelector(null)).toBeNull();
    expect(refocusSelector(document.createElement('button'))).toBeNull();
  });
});
