// @vitest-environment jsdom
//
// DOM behavioral guard: the jump-to-deed spotlight (openWithDeed) and the
// recent-strip recency sources, driven on the real DeedsWindow over jsdom
// with stub deps (the deeds_window_focus.test.ts rig). Covers the chat-link
// landing (category switch, filter/search reset, the one-shot flash), the
// hidden-deed mask guard, the strip's jump buttons, and the two live recency
// feeds (noteUnlocks, the fetched order).

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEED_ORDER } from '../src/sim/content/deeds';
import { DEEDS_RECENT_CAP, freshDeedStats } from '../src/sim/deeds';
import { deedName } from '../src/ui/deed_i18n';
import { DeedsWindow, type DeedsWindowDeps } from '../src/ui/deeds_window';
import { t } from '../src/ui/i18n';

// jsdom ships no 2D canvas, so the procedural crest compositor cannot run
// here; the painter only ever uses the returned string as an <img src>.
vi.mock('../src/ui/icons', () => ({
  iconDataUrl: () => 'data:,',
}));

interface WorldState {
  deedsEarned: Map<string, string>;
  renown: number;
  activeTitle: string | null;
  recent: string[] | null;
  name: string;
}

function baseState(): WorldState {
  return { deedsEarned: new Map(), renown: 0, activeTitle: null, recent: null, name: 'Hero' };
}

function makeWindow(
  state: WorldState,
  open = true,
  worldOver: Record<string, unknown> = {},
): { w: DeedsWindow; el: HTMLElement } {
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
        deedsRecent: async () => state.recent,
        setActiveTitle: (id: string | null) => {
          state.activeTitle = id;
        },
        cfg: { playerClass: 'warrior' },
        get player() {
          return { name: state.name };
        },
        ...worldOver,
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
  if (open) w.open();
  return { w, el };
}

const flashed = (el: HTMLElement): string | null =>
  el.querySelector('.deed-card-flash')?.getAttribute('data-deed') ?? null;

const stripIds = (el: HTMLElement): string[] =>
  [...el.querySelectorAll('[data-recent]')].map((b) => b.getAttribute('data-recent') ?? '');

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
});

describe('openWithDeed: the chat-link landing', () => {
  it('switches to the deed category and flashes its card, one-shot', () => {
    const state = baseState();
    state.deedsEarned.set('prog_first_steps', '2026-07-01');
    const { w, el } = makeWindow(state);
    w.open('combat');
    w.openWithDeed('prog_first_steps');
    expect(el.querySelector('[data-cat="progression"]')?.classList.contains('active')).toBe(true);
    expect(flashed(el)).toBe('prog_first_steps');
    // One-shot: the next paint carries no spotlight, so a slow-band refresh
    // can never re-scroll a window the player has moved on from.
    w.render();
    expect(flashed(el)).toBe(null);
  });

  it('the spotlight survives the slow-band refresh right after the jump (signature latched)', () => {
    const state = baseState();
    state.deedsEarned.set('prog_first_steps', '2026-07-01');
    const { w, el } = makeWindow(state);
    w.open('combat');
    w.openWithDeed('prog_first_steps');
    expect(flashed(el)).toBe('prog_first_steps');
    // The HUD's 500ms band fires within the 1.6s flash: same state, same
    // latched signature, so the repaint elides and the animation lives on.
    w.refreshIfChanged();
    expect(flashed(el)).toBe('prog_first_steps');
  });

  it('moves the reading position onto the landed card (the jump is a navigation)', () => {
    const state = baseState();
    state.deedsEarned.set('prog_first_steps', '2026-07-01');
    const { w, el } = makeWindow(state);
    w.openWithDeed('prog_first_steps');
    const card = el.querySelector('.deed-card[data-deed="prog_first_steps"]') as HTMLElement;
    expect(card.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(card);
  });

  it('a cold open leaves reading position on the landed card, not Close', () => {
    // open() parks on Close for a plain open; a jump must not let that park
    // steal the focus the navigation promised (the closed-Book chat-link path).
    const state = baseState();
    state.deedsEarned.set('prog_first_steps', '2026-07-01');
    const { w, el } = makeWindow(state, false);
    w.openWithDeed('prog_first_steps');
    const card = el.querySelector('.deed-card[data-deed="prog_first_steps"]') as HTMLElement;
    expect(document.activeElement).toBe(card);
    expect(el.querySelector('[data-close]')).not.toBe(document.activeElement);
  });

  it('scrolls the landed card into view once, centered', () => {
    const spy = vi.fn();
    (Element.prototype as unknown as { scrollIntoView: unknown }).scrollIntoView = spy;
    try {
      const state = baseState();
      state.deedsEarned.set('prog_first_steps', '2026-07-01');
      const { w } = makeWindow(state, false);
      w.openWithDeed('prog_first_steps');
      // Once under display:none during render, once after open() sets flex so
      // the scroll is reliable against a visible root.
      expect(spy).toHaveBeenCalledTimes(2);
      expect(spy).toHaveBeenCalledWith({ block: 'center' });
    } finally {
      Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
    }
  });

  it('the spotlight survives the recent-order fetch repaint after a cold open', async () => {
    // Cold open always starts fetchRecent; offline (and a fast online reply)
    // resolves on a microtask and re-renders. Without a sticky flash that
    // rebuild strips .deed-card-flash before the first paint, so the gold
    // ring (and the reduced-motion static ring) never shows on the main
    // closed-Book chat-link path.
    const state = baseState();
    state.deedsEarned.set('prog_first_steps', '2026-07-01');
    state.deedsEarned.set('cmb_first_blood', '2026-07-01');
    state.recent = ['prog_first_steps', 'cmb_first_blood'];
    const { w, el } = makeWindow(state, false);
    w.openWithDeed('prog_first_steps');
    expect(flashed(el)).toBe('prog_first_steps');
    await settle();
    expect(flashed(el)).toBe('prog_first_steps');
    // The card, not Close, still holds the reading position after the rebuild.
    expect(document.activeElement).toBe(
      el.querySelector('.deed-card[data-deed="prog_first_steps"]'),
    );
  });

  it('an EARNED hidden deed is jumpable: revealed on the Feats shelf, flashed', () => {
    const state = baseState();
    state.deedsEarned.set('hid_roll_hundred', '2026-07-01');
    const { w, el } = makeWindow(state);
    w.open('combat');
    w.openWithDeed('hid_roll_hundred');
    expect(el.querySelector('[data-cat="feat"]')?.classList.contains('active')).toBe(true);
    expect(flashed(el)).toBe('hid_roll_hundred');
  });

  it('opens the Book when it was closed, landing on the card', () => {
    const state = baseState();
    state.deedsEarned.set('prog_first_steps', '2026-07-01');
    const { w, el } = makeWindow(state, false);
    expect(w.isOpen).toBe(false);
    w.openWithDeed('prog_first_steps');
    expect(w.isOpen).toBe(true);
    expect(flashed(el)).toBe('prog_first_steps');
  });

  it('resets an active filter and search so the card is guaranteed visible', () => {
    const state = baseState();
    state.deedsEarned.set('prog_first_steps', '2026-07-01');
    const { w, el } = makeWindow(state);
    // An earned deed would be hidden behind the unearned filter and a stale
    // search; the jump clears both.
    (el.querySelector('[data-filter="unearned"]') as HTMLElement).click();
    const search = el.querySelector('.deed-search') as HTMLInputElement;
    search.value = 'zzz-no-match';
    search.dispatchEvent(new Event('input'));
    w.openWithDeed('prog_first_steps');
    expect(flashed(el)).toBe('prog_first_steps');
    expect(el.querySelector('[data-filter="all"]')?.classList.contains('active')).toBe(true);
    expect((el.querySelector('.deed-search') as HTMLInputElement).value).toBe('');
  });

  it('a hidden unearned deed opens the Book wherever it was, unfocused (the mask holds)', () => {
    const { w, el } = makeWindow(baseState());
    w.open('combat');
    w.openWithDeed('hid_roll_hundred');
    expect(w.isOpen).toBe(true);
    expect(flashed(el)).toBe(null);
    // No category switch: switching to the Feats shelf would hint where the
    // hidden deed lives.
    expect(el.querySelector('[data-cat="combat"]')?.classList.contains('active')).toBe(true);
  });

  it('an unknown id (content drift) opens the Book unfocused, never a crash', () => {
    const { w, el } = makeWindow(baseState(), false);
    w.openWithDeed('removed_deed');
    expect(w.isOpen).toBe(true);
    expect(flashed(el)).toBe(null);
  });

  it('a prototype-key id is a plain unknown, never a forged def', () => {
    const { w, el } = makeWindow(baseState(), false);
    w.openWithDeed('__proto__');
    w.openWithDeed('constructor');
    expect(w.isOpen).toBe(true);
    expect(flashed(el)).toBe(null);
  });
});

describe('the recent strip: jump buttons and recency sources', () => {
  it('clicking a strip crest jumps to that deed card', () => {
    const state = baseState();
    state.deedsEarned.set('prog_first_steps', '2026-07-01');
    const { el } = makeWindow(state);
    const btn = el.querySelector<HTMLElement>('[data-recent="prog_first_steps"]');
    expect(btn).not.toBeNull();
    expect(btn?.tagName).toBe('BUTTON');
    // The accessible name rides the button (runtime, not just a source pin),
    // and the crest img stays alt="" so the deed is not announced twice.
    expect(btn?.getAttribute('aria-label')).toBe(
      t('hudChrome.deeds.recentJumpAria', { name: deedName('prog_first_steps') }),
    );
    expect(btn?.querySelector('img')?.getAttribute('alt')).toBe('');
    btn?.click();
    expect(el.querySelector('[data-cat="progression"]')?.classList.contains('active')).toBe(true);
    expect(flashed(el)).toBe('prog_first_steps');
  });

  it('bounds the session feed to DEEDS_RECENT_CAP, newest surviving', () => {
    const { w } = makeWindow(baseState(), false);
    const ids = DEED_ORDER.slice(0, DEEDS_RECENT_CAP + 4);
    w.noteUnlocks(ids);
    const session = (w as unknown as { sessionUnlocks: string[] }).sessionUnlocks;
    expect(session).toHaveLength(DEEDS_RECENT_CAP);
    expect(session).toEqual(ids.slice(-DEEDS_RECENT_CAP));
  });

  it('an unlock noted while the Book is closed leads the strip when it opens', () => {
    const state = baseState();
    state.deedsEarned.set('prog_first_steps', '2026-07-01');
    state.deedsEarned.set('cmb_first_blood', '2026-07-01');
    const { w, el } = makeWindow(state, false);
    w.noteUnlocks(['prog_first_steps']);
    w.open();
    expect(stripIds(el)[0]).toBe('prog_first_steps');
  });

  it('a character switch clears the session feed (the watch-set rekey rule)', () => {
    const state = baseState();
    state.deedsEarned.set('prog_first_steps', '2026-07-01');
    state.deedsEarned.set('cmb_first_blood', '2026-07-01');
    const { w, el } = makeWindow(state);
    w.noteUnlocks(['prog_first_steps']);
    expect(stripIds(el)[0]).toBe('prog_first_steps');
    state.name = 'Other';
    w.render();
    // Back to the same-day fallback order (catalog-later first): the old
    // character's session signal died with the switch.
    expect(stripIds(el)[0]).toBe('cmb_first_blood');
  });

  it('fetches the recent order once per open, and drops a response landing after close', async () => {
    const state = baseState();
    state.deedsEarned.set('prog_first_steps', '2026-07-01');
    state.deedsEarned.set('cmb_first_blood', '2026-07-01');
    let resolveRecent: ((v: readonly string[] | null) => void) | undefined;
    let calls = 0;
    const { w } = makeWindow(state, false, {
      deedsRecent: () => {
        calls++;
        return new Promise((resolve) => {
          resolveRecent = resolve;
        });
      },
    });
    w.open();
    expect(calls).toBe(1);
    w.render();
    w.render();
    // Once per OPEN, never per render: a render-driven refetch would loop.
    expect(calls).toBe(1);
    w.close();
    resolveRecent?.(['prog_first_steps', 'cmb_first_blood']);
    await settle();
    // The late response was discarded, not stored into the closed window.
    expect((w as unknown as { recentOrder: readonly string[] | null }).recentOrder).toBe(null);
    w.open();
    expect(calls).toBe(2);
  });

  it('noteUnlocks puts the session order first and repaints an open window', () => {
    const state = baseState();
    // Same day: the day fallback would order these catalog-later-first
    // (cmb_first_blood ahead), so session order is observable.
    state.deedsEarned.set('prog_first_steps', '2026-07-01');
    state.deedsEarned.set('cmb_first_blood', '2026-07-01');
    const { w, el } = makeWindow(state);
    expect(stripIds(el)[0]).toBe('cmb_first_blood');
    w.noteUnlocks(['prog_first_steps']);
    expect(stripIds(el)[0]).toBe('prog_first_steps');
  });

  it('the fetched order lands async and repaints the strip in place', async () => {
    const state = baseState();
    state.deedsEarned.set('prog_first_steps', '2026-07-01');
    state.deedsEarned.set('cmb_first_blood', '2026-07-01');
    state.recent = ['prog_first_steps', 'cmb_first_blood'];
    const { el } = makeWindow(state);
    await settle();
    expect(stripIds(el)).toEqual(['prog_first_steps', 'cmb_first_blood']);
  });
});
