// @vitest-environment jsdom
//
// Behavioral guards for the event calendar window after its shared window-frame
// adoption: the frame chrome is stamped on an inner mount (the #calendar-window
// root stays a plain .window.panel), the month nav / grid / day pane render into
// the scrollable body, the frame is reused across repaints, the titlebar is a
// drag handle but the close is not, and the close routes to the window's close().

import { describe, expect, it, vi } from 'vitest';
import { CalendarWindow, type CalendarWindowDeps } from '../src/ui/calendar_window';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';

vi.mock('../src/game/audio', () => ({ audio: { bagOpen: vi.fn(), click: vi.fn() } }));

function calEl(): HTMLElement {
  const el = document.createElement('div');
  el.id = 'calendar-window';
  el.className = 'window panel';
  return el;
}

function fakeDeps(
  el: HTMLElement,
  overrides: Partial<CalendarWindowDeps> = {},
): CalendarWindowDeps {
  return {
    root: () => el,
    world: () =>
      ({ socialInfo: null, guildEventCreate: vi.fn(), guildEventRemove: vi.fn() }) as never,
    closeOthers: () => {},
    captureFocus: () => null,
    restoreFocus: () => {},
    showError: () => {},
    ...overrides,
  };
}

describe('CalendarWindow: frame adoption', () => {
  it('stamps the window-frame chrome on an inner mount with titlebar, body, close', () => {
    const el = calEl();
    new CalendarWindow(fakeDeps(el)).render();
    const frame = el.querySelector<HTMLElement>(':scope > .window-frame');
    expect(frame).not.toBeNull();
    expect(frame?.getAttribute('role')).toBe('dialog');
    expect(frame?.querySelector('.window-titlebar')).not.toBeNull();
    expect(frame?.querySelector('.window-body')).not.toBeNull();
    expect(frame?.querySelector('[data-window-close]')).not.toBeNull();
    // The root itself never carries builder class / role / aria.
    expect(el.className).toBe('window panel');
    expect(el.hasAttribute('role')).toBe(false);
  });

  it('renders the month nav, grid, and day pane inside the scrollable body', () => {
    const el = calEl();
    new CalendarWindow(fakeDeps(el)).render();
    expect(el.querySelector('.window-body .cal-nav')).not.toBeNull();
    expect(el.querySelector('.window-body .cal-grid')).not.toBeNull();
    expect(el.querySelector('.window-body #cal-day-pane')).not.toBeNull();
  });

  it('reuses the frame across repaints instead of rebuilding it cold', () => {
    const el = calEl();
    const w = new CalendarWindow(fakeDeps(el));
    w.render();
    const body = el.querySelector('.window-body');
    w.render();
    expect(el.querySelector('.window-body')).toBe(body);
    expect(el.querySelectorAll('.window-titlebar').length).toBe(1);
  });

  it('makes the titlebar a drag handle the Hud recognizes, but never the close', () => {
    const el = calEl();
    new CalendarWindow(fakeDeps(el)).render();
    const titlebar = el.querySelector<HTMLElement>('.window-titlebar') as HTMLElement;
    const close = el.querySelector<HTMLElement>('[data-window-close]') as HTMLElement;
    expect(isWindowDragHandle(titlebar, el)).toBe(true);
    expect(isWindowDragHandle(close, el)).toBe(false);
  });

  it('routes the close control to the window close()', () => {
    const el = calEl();
    const w = new CalendarWindow(fakeDeps(el));
    w.render();
    const closeSpy = vi.spyOn(w, 'close');
    el.querySelector<HTMLElement>('[data-window-close]')?.click();
    expect(closeSpy).toHaveBeenCalledTimes(1);
  });
});
