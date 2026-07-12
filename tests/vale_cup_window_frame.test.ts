// @vitest-environment jsdom
//
// DOM guards for the Vale Cup window painter after it adopts the shared
// window-frame chrome (the pure state decisions are covered by
// vale_cup_window_view.test.ts, and the source contract by vale_cup_ui_guard).
// These render the real DOM and assert: the frame chrome is stamped on an inner
// mount, the #valecup-window root stays the single dialog (markDialogRoot on open;
// the frame's own role is stripped) with the title id its aria-labelledby points
// at, the titlebar is a drag handle but the close button is not, the frame is
// reused across the mediumHud re-render, and a hostile winners-board player name
// is escaped through esc() (never injected as live markup).

import { describe, expect, it, vi } from 'vitest';
import { ValeCupWindow, type ValeCupWindowDeps } from '../src/ui/vale_cup_window';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';
import type { CupInfo, IWorld } from '../src/world_api';

function valeEl(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'valecup-window';
  el.className = 'window panel';
  return el;
}

function liveCupInfo(over: Partial<CupInfo> = {}): CupInfo {
  return {
    standing: { wins: 0, losses: 0, draws: 0 },
    queued: false,
    bracket: null,
    nation: null,
    role: null,
    position: 0,
    queueSizes: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
    deserterFor: 0,
    match: null,
    live: null,
    board: [{ name: '<img src=x onerror=alert(1)>', wins: 1 }],
    guildBoard: [],
    myGuild: null,
    guildStanding: { wins: 0, losses: 0 },
    practicing: [],
    ...over,
  } as unknown as CupInfo;
}

function makeWin(cupInfo: CupInfo | null, deps: Partial<ValeCupWindowDeps> = {}) {
  const el = valeEl();
  const world = () => ({ cupInfo, playerId: 1, partyInfo: null }) as unknown as IWorld;
  const win = new ValeCupWindow({
    root: () => el,
    world,
    closeOthers: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    ...deps,
  });
  return { el, win };
}

describe('ValeCupWindow: frame adoption', () => {
  it('stamps the frame chrome on an inner mount and keeps a single dialog on the root', () => {
    const { el, win } = makeWin(null);
    win.toggle();
    // The root is the sole dialog (marked once on open by markDialogRoot).
    expect(el.getAttribute('role')).toBe('dialog');
    expect(el.getAttribute('aria-labelledby')).toBe('valecup-title');
    const frame = el.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame).not.toBeNull();
    expect(frame?.hasAttribute('role')).toBe(false);
    expect(frame?.querySelector('.window-titlebar')).not.toBeNull();
    expect(frame?.querySelector('.window-body')).not.toBeNull();
    expect(frame?.querySelector('[data-window-close]')).not.toBeNull();
    // The title node the root points at lives inside the frame.
    expect(el.querySelector('#valecup-title')?.classList.contains('window-title')).toBe(true);
  });

  it('renders the offline note in the body when the cup is not synced', () => {
    const { el, win } = makeWin(null);
    win.toggle();
    expect(el.querySelector('.window-body .vcup-note')).not.toBeNull();
  });

  it('reuses the frame across a re-render instead of rebuilding it cold', () => {
    const { el, win } = makeWin(liveCupInfo());
    win.toggle();
    const firstBody = el.querySelector('.window-body');
    win.render();
    expect(el.querySelector('.window-body')).toBe(firstBody);
    expect(el.querySelectorAll('.window-titlebar').length).toBe(1);
  });
});

describe('ValeCupWindow: move / resize / fit + close', () => {
  it('makes the titlebar a drag handle the Hud recognizes, but never the close button', () => {
    const { el, win } = makeWin(null);
    win.toggle();
    const titlebar = el.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    const closeBtn = el.querySelector<HTMLElement>('[data-window-close]') as HTMLElement;
    expect(isWindowDragHandle(titlebar, el)).toBe(true);
    expect(isWindowDragHandle(closeBtn, el)).toBe(false);
  });

  it('routes the frame close control through close() (hides the root)', () => {
    const restoreFocus = vi.fn();
    const { el, win } = makeWin(null, { restoreFocus });
    win.toggle();
    expect(el.style.display).toBe('block');
    el.querySelector<HTMLElement>('[data-window-close]')?.click();
    expect(el.style.display).toBe('none');
    expect(restoreFocus).toHaveBeenCalledTimes(1);
  });
});

describe('ValeCupWindow: hostile-string escaping', () => {
  it('escapes a hostile winners-board player name (no live injection)', () => {
    const { el, win } = makeWin(liveCupInfo());
    win.render();
    const body = el.querySelector('.window-body') as HTMLElement;
    // The winners board is part of the live body.
    expect(body.querySelector('.ladder-row')).not.toBeNull();
    expect(body.querySelector('img')).toBeNull();
    expect(body.innerHTML).toContain('&lt;img');
  });
});
