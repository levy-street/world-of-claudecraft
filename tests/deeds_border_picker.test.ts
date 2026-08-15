// @vitest-environment jsdom
//
// DOM behavioral guard: the nameplate-border picker in the Book of Deeds
// cosmetics shelf. Drives the real DeedsWindow over jsdom with stub deps (the
// deeds_window_focus.test.ts harness), because the thing worth pinning is the
// wiring the pure core cannot see: which option buttons render, which facet
// command a click sends, that the two pickers' delegations stay apart, and
// that nothing is written optimistically (the active mark follows the WORLD
// read, so online it moves on the snapshot echo and not on the click).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { freshDeedStats } from '../src/sim/deeds';
import { DeedsWindow, type DeedsWindowDeps } from '../src/ui/deeds_window';

// jsdom ships no 2D canvas, so the procedural crest compositor cannot run
// here; the painter only ever uses the returned string as an <img src>.
vi.mock('../src/ui/icons', () => ({
  iconDataUrl: () => 'data:,',
}));

// Live catalog border deeds: two earned, one held back to prove the picker
// lists only what is earned. DEED_ORDER puts prog_ before dgn_ before col_.
const PRESTIGE = 'prog_prestige_10';
const DEEPWARD = 'dgn_deepward';
const DISCOVERY = 'col_discovery_250';

interface WorldState {
  deedsEarned: Map<string, string>;
  activeTitle: string | null;
  activeBorder: string | null;
  /** False models the ONLINE mirror: the command goes out, the local read does
   *  not move until the snapshot echo lands. */
  applyLocally: boolean;
}

function baseState(over: Partial<WorldState> = {}): WorldState {
  return {
    deedsEarned: new Map(),
    activeTitle: null,
    activeBorder: null,
    applyLocally: true,
    ...over,
  };
}

interface Harness {
  w: DeedsWindow;
  el: HTMLElement;
  setActiveBorder: ReturnType<typeof vi.fn>;
  setActiveTitle: ReturnType<typeof vi.fn>;
}

function makeWindow(state: WorldState, opts: { peek?: boolean } = {}): Harness {
  const el = document.createElement('div');
  el.id = 'deeds-window';
  document.body.appendChild(el);
  const stats = freshDeedStats();
  const setActiveBorder = vi.fn((id: string | null) => {
    if (state.applyLocally) state.activeBorder = id;
  });
  const setActiveTitle = vi.fn((id: string | null) => {
    if (state.applyLocally) state.activeTitle = id;
  });
  const deps: DeedsWindowDeps = {
    root: () => el,
    world: () =>
      ({
        deedsEarned: state.deedsEarned,
        deedStats: stats,
        renown: 0,
        activeTitle: state.activeTitle,
        activeBorder: state.activeBorder,
        setActiveTitle,
        setActiveBorder,
        deedsRarity: async () => null,
        deedsRecent: async () => null,
        cfg: { playerClass: 'warrior' },
        player: { name: 'Hero' },
      }) as never,
    closeOthers: () => {},
    hideTooltip: () => {},
    consumePeek: () => opts.peek === true,
    captureFocus: () => null,
    restoreFocus: () => {},
    onWatchChanged: () => {},
    itemIcon: () => '',
    moneyHtml: () => '',
    itemTooltip: () => '',
    attachTooltip: () => {},
  };
  const w = new DeedsWindow(deps);
  w.open('titles');
  return { w, el, setActiveBorder, setActiveTitle };
}

const borderOptionIds = (el: HTMLElement): string[] =>
  [...el.querySelectorAll<HTMLElement>('[data-border-pick]')].map(
    (btn) => btn.getAttribute('data-border-pick') ?? '',
  );

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('Book of Deeds border picker', () => {
  it('offers only the earned border deeds behind a None head', () => {
    const state = baseState();
    state.deedsEarned.set(PRESTIGE, '2026-08-01');
    state.deedsEarned.set(DEEPWARD, '2026-08-02');
    const { el } = makeWindow(state);
    // '' is the None option's value (the picker's null spelling in the DOM).
    expect(borderOptionIds(el)).toEqual(['', PRESTIGE, DEEPWARD]);
    expect(borderOptionIds(el)).not.toContain(DISCOVERY);
  });

  it('renders the empty line and only None when no border deed is earned', () => {
    const { el } = makeWindow(baseState());
    expect(borderOptionIds(el)).toEqual(['']);
    const group = el.querySelector('.deeds-borders') as HTMLElement;
    expect(group.querySelector('.deeds-empty')).not.toBeNull();
    // The None head is still pressed: nothing worn is a real, chosen state.
    expect(group.querySelector('[data-border-pick=""]')?.getAttribute('aria-pressed')).toBe('true');
  });

  it('marks the worn border pressed and leaves None unpressed', () => {
    const state = baseState({ activeBorder: DEEPWARD });
    state.deedsEarned.set(PRESTIGE, '2026-08-01');
    state.deedsEarned.set(DEEPWARD, '2026-08-02');
    const { el } = makeWindow(state);
    expect(el.querySelector(`[data-border-pick="${DEEPWARD}"]`)?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    expect(el.querySelector('[data-border-pick=""]')?.getAttribute('aria-pressed')).toBe('false');
    expect(el.querySelector(`[data-border-pick="${PRESTIGE}"]`)?.getAttribute('aria-pressed')).toBe(
      'false',
    );
  });

  it('sends the deed id on a pick and null on None, never the other command', () => {
    const state = baseState();
    state.deedsEarned.set(PRESTIGE, '2026-08-01');
    const { el, setActiveBorder, setActiveTitle } = makeWindow(state);
    el.querySelector<HTMLElement>(`[data-border-pick="${PRESTIGE}"]`)?.click();
    expect(setActiveBorder).toHaveBeenCalledWith(PRESTIGE);
    expect(el.querySelector(`[data-border-pick="${PRESTIGE}"]`)?.getAttribute('aria-pressed')).toBe(
      'true',
    );
    el.querySelector<HTMLElement>('[data-border-pick=""]')?.click();
    expect(setActiveBorder).toHaveBeenLastCalledWith(null);
    expect(el.querySelector('[data-border-pick=""]')?.getAttribute('aria-pressed')).toBe('true');
    // The border delegation never reaches the title command.
    expect(setActiveTitle).not.toHaveBeenCalled();
  });

  it('keeps the title delegation off the border command', () => {
    const state = baseState();
    state.deedsEarned.set('prog_veteran', '2026-08-01');
    const { el, setActiveBorder, setActiveTitle } = makeWindow(state);
    el.querySelector<HTMLElement>('[data-title="prog_veteran"]')?.click();
    expect(setActiveTitle).toHaveBeenCalledWith('prog_veteran');
    expect(setActiveBorder).not.toHaveBeenCalled();
  });

  it('writes nothing optimistically: the mark follows the world read', () => {
    // The ONLINE shape: the command goes out but the mirror has not echoed, so
    // the picker must still show the previous state after its own repaint.
    const state = baseState({ applyLocally: false });
    state.deedsEarned.set(PRESTIGE, '2026-08-01');
    const { w, el, setActiveBorder } = makeWindow(state);
    el.querySelector<HTMLElement>(`[data-border-pick="${PRESTIGE}"]`)?.click();
    expect(setActiveBorder).toHaveBeenCalledWith(PRESTIGE);
    expect(el.querySelector(`[data-border-pick="${PRESTIGE}"]`)?.getAttribute('aria-pressed')).toBe(
      'false',
    );
    expect(el.querySelector('[data-border-pick=""]')?.getAttribute('aria-pressed')).toBe('true');
    // The echo lands: the slow-band refresh must SEE it, which it only does
    // because the worn border is a repaint-signature dimension.
    state.activeBorder = PRESTIGE;
    w.refreshIfChanged();
    expect(el.querySelector(`[data-border-pick="${PRESTIGE}"]`)?.getAttribute('aria-pressed')).toBe(
      'true',
    );
  });

  it('suppresses the pick when the click releases a long-press tooltip peek', () => {
    const state = baseState();
    state.deedsEarned.set(PRESTIGE, '2026-08-01');
    const { el, setActiveBorder } = makeWindow(state, { peek: true });
    el.querySelector<HTMLElement>(`[data-border-pick="${PRESTIGE}"]`)?.click();
    expect(setActiveBorder).not.toHaveBeenCalled();
  });

  it('returns focus to the fresh border option after the pick rebuilds the pane', () => {
    // Enter activation shape: the click destroys the focused button with the
    // innerHTML rebuild, so the pick attribute has to be one of the identities
    // refocusSelector carries across, or a keyboard user is dumped on Close.
    const state = baseState();
    state.deedsEarned.set(PRESTIGE, '2026-08-01');
    const { el } = makeWindow(state);
    const before = el.querySelector<HTMLElement>(`[data-border-pick="${PRESTIGE}"]`);
    before?.focus();
    before?.click();
    const fresh = el.querySelector<HTMLElement>(`[data-border-pick="${PRESTIGE}"]`);
    expect(fresh).not.toBe(before);
    expect(document.activeElement).toBe(fresh);
  });

  it('reuses the title option class so the tap floor and focus ring reach it', () => {
    // The 40px mobile floor and the focus-visible ring are declared for
    // .deed-title-option; a bespoke class on these buttons would silently drop
    // both (the CSS rules are pinned in deeds_window.test.ts).
    const state = baseState();
    state.deedsEarned.set(PRESTIGE, '2026-08-01');
    const { el } = makeWindow(state);
    for (const btn of el.querySelectorAll<HTMLElement>('[data-border-pick]')) {
      expect(btn.classList.contains('deed-title-option')).toBe(true);
      expect(btn.tagName).toBe('BUTTON');
    }
    // Both groups are labelled regions, so a screen reader can tell which run
    // of options it has entered. The name comes from the VISIBLE head (a real
    // h3 the group points at), not a second aria-label string.
    expect(el.querySelector('.deeds-titles')?.getAttribute('role')).toBe('group');
    expect(el.querySelector('.deeds-borders')?.getAttribute('role')).toBe('group');
    expect(el.querySelectorAll('.deeds-picker-head').length).toBe(2);
    for (const cls of ['.deeds-titles', '.deeds-borders']) {
      const group = el.querySelector(cls) as HTMLElement;
      const labelledBy = group.getAttribute('aria-labelledby') ?? '';
      // A dangling id would leave the group unnamed, which is worse than the
      // aria-label it replaced: resolve it and require the visible text.
      const head = el.querySelector(`#${labelledBy}`) as HTMLElement | null;
      expect(head, `${cls} must be named by an element that exists`).toBeTruthy();
      expect(head?.tagName).toBe('H3');
      expect(head?.classList.contains('deeds-picker-head')).toBe(true);
      expect((head?.textContent ?? '').trim().length).toBeGreaterThan(0);
      // One accessible name only: the aria-label it used to carry is gone.
      expect(group.getAttribute('aria-label')).toBeNull();
    }
  });
});

// CSS REACH, not class presence: every selector this feature added rides a
// grouped or compound rule, and a later split ('.deeds-titles' alone, an
// '.ms-deed-border' rule without the '.ms-active' compound) would leave the
// markup styled by nothing while a class-presence test stayed green. Each arm
// below matches the SELECTOR TEXT that has to keep reaching.
describe('picker and note CSS reach (grouped selectors, not just classes)', () => {
  // This file runs under jsdom, where import.meta.url is an http URL that
  // readFileSync rejects; resolve the sheet from __dirname instead.
  const components = readFileSync(join(__dirname, '../src/styles/components.css'), 'utf8');

  it('gives .deeds-borders the picker column layout through the shared rule', () => {
    const rule = components.match(/\.deeds-titles,\s*\n?\s*\.deeds-borders \{([^}]*)\}/)?.[1];
    expect(rule, '.deeds-borders must stay in the grouped picker layout rule').toBeTruthy();
    expect(rule).toContain('display: flex;');
    expect(rule).toContain('flex-direction: column;');
  });

  it('styles the picker head, at the weight the h3 needs declared', () => {
    const rule = components.match(/\n\s*\.deeds-picker-head \{([^}]*)\}/)?.[1];
    expect(rule, '.deeds-picker-head must have a rule of its own').toBeTruthy();
    expect(rule).toContain('font-size: 12px;');
    // The head is an h3 now: without this the UA sheet renders it bold and
    // larger than the shelf label should be.
    expect(rule).toContain('font-weight: 400;');
  });

  it('styles the WORN border badge through its full compound selector', () => {
    // The base badge and the worn state are separate rules; the worn one is
    // reachable only as the three-class compound the painter writes.
    expect(components).toMatch(/\.ms-badge\.ms-deed-border \{[^}]*\}/);
    const worn = components.match(/\.ms-badge\.ms-deed-border\.ms-active \{([^}]*)\}/)?.[1];
    expect(worn, 'the worn-border badge must keep its compound rule').toBeTruthy();
    expect(worn).toContain('border-color:');
  });

  it('styles the Reliquary border note through its grouping with the uniques note', () => {
    const rule = components.match(
      /\.reliquary-uniques-note,\s*\n?\s*\.reliquary-border-note \{([^}]*)\}/,
    )?.[1];
    expect(rule, '.reliquary-border-note must stay grouped with the uniques note').toBeTruthy();
    expect(rule).toContain('font-size: 12px;');
    expect(rule).toContain('color: var(--color-text-muted);');
  });
});
