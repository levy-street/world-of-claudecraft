// @vitest-environment jsdom
//
// DOM guards for the arena window painter after it adopts the shared window-frame
// chrome (the pure state decisions are covered by arena_window_view.test.ts, and
// the source contract by arena_window.test.ts). These render the real DOM and
// assert: the frame chrome is stamped on an inner mount, the #arena-window root
// stays the single dialog (markDialogRoot on open; the frame's own role stripped)
// with the arena-title id its aria-labelledby points at, the bracket tag rides in
// the frame title, the titlebar is a drag handle but the close button is not, the
// frame is reused across the mediumHud re-render, and a hostile ladder player name
// is escaped through esc(). This is the documented DOM-rendered styling exception:
// the frame wraps it without changing the paint path.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ArenaWindow, type ArenaWindowDeps } from '../src/ui/arena_window';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';
import type { ArenaInfo, IWorld } from '../src/world_api';

beforeEach(() => {
  // fetchLeaderboard() reaches for the all-time ladder; keep it offline + quiet.
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(new Error('no server'))),
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
});

function arenaEl(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'arena-window';
  el.className = 'window panel';
  return el;
}

function liveArenaInfo(over: Partial<ArenaInfo> = {}): ArenaInfo {
  const standings = {
    '1v1': { rating: 1500, wins: 10, losses: 5 },
    '2v2': { rating: 1400, wins: 6, losses: 6 },
    fiesta: { rating: 1300, wins: 3, losses: 2 },
  };
  const ladder = [
    { pid: 2, name: '<img src=x onerror=alert(1)>', cls: 'mage', rating: 1400, wins: 8, losses: 7 },
  ];
  return {
    rating: 1500,
    wins: 10,
    losses: 5,
    standings,
    format: null,
    queued: false,
    queueSize: 0,
    match: null,
    ladder,
    ladders: { '1v1': ladder, '2v2': [], fiesta: [] },
    ...over,
  } as unknown as ArenaInfo;
}

function makeWin(arenaInfo: ArenaInfo | null, deps: Partial<ArenaWindowDeps> = {}) {
  const el = arenaEl();
  const world = () =>
    ({
      arenaInfo,
      playerId: 1,
      player: { name: 'Me' },
      partyInfo: null,
    }) as unknown as IWorld;
  const win = new ArenaWindow({
    root: () => el,
    world,
    closeOthers: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    ...deps,
  });
  return { el, win };
}

describe('ArenaWindow: frame adoption', () => {
  it('stamps the frame chrome on an inner mount and keeps a single dialog on the root', () => {
    const { el, win } = makeWin(null);
    win.toggle();
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-labelledby')).toBe('arena-title');
    const frame = el.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame).not.toBeNull();
    expect(frame?.hasAttribute('role')).toBe(false);
    expect(frame?.querySelector('.window-titlebar')).not.toBeNull();
    expect(frame?.querySelector('.window-body')).not.toBeNull();
    expect(frame?.querySelector('[data-window-close]')).not.toBeNull();
    // The title node the root points at lives inside the frame.
    expect(el.querySelector('#arena-title')?.classList.contains('window-title')).toBe(true);
  });

  it('renders the offline note in the body when no arena snapshot has synced', () => {
    const { el, win } = makeWin(null);
    win.toggle();
    expect(el.querySelector('.window-body .arena-note')).not.toBeNull();
  });

  it('reuses the frame across a re-render instead of rebuilding it cold', () => {
    const { el, win } = makeWin(liveArenaInfo());
    win.toggle();
    const firstBody = el.querySelector('.window-body');
    win.render();
    expect(el.querySelector('.window-body')).toBe(firstBody);
    expect(el.querySelectorAll('.window-titlebar').length).toBe(1);
  });
});

describe('ArenaWindow: live panel + escaping', () => {
  it('rides the bracket tag inside the frame title and escapes a hostile ladder name', () => {
    const { el, win } = makeWin(liveArenaInfo());
    win.render();
    // The bracket tag lives beside the display-font title in the titlebar.
    expect(el.querySelector('.window-title .arena-bracket-tag')).not.toBeNull();
    const body = el.querySelector('.window-body') as HTMLElement;
    expect(body.querySelector('.ladder-row')).not.toBeNull();
    expect(body.querySelector('img')).toBeNull();
    expect(body.innerHTML).toContain('&lt;img');
  });
});

describe('ArenaWindow: move / resize / fit + close', () => {
  it('makes the titlebar a drag handle the Hud recognizes, but never the close button', () => {
    const { el, win } = makeWin(null);
    win.toggle();
    const titlebar = el.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    const closeBtn = el.querySelector<HTMLElement>('[data-window-close]') as HTMLElement;
    expect(isWindowDragHandle(titlebar, el)).toBe(true);
    expect(isWindowDragHandle(closeBtn, el)).toBe(false);
  });

  it('routes the frame close control through close() (hides the root, returns focus)', () => {
    const restoreFocus = vi.fn();
    const { el, win } = makeWin(null, { restoreFocus });
    win.toggle();
    expect(el.style.display).toBe('block');
    el.querySelector<HTMLElement>('[data-window-close]')?.click();
    expect(el.style.display).toBe('none');
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });
});
