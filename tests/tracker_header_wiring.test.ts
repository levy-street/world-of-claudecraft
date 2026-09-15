// @vitest-environment happy-dom
// Behavioral pin for the shared tracker-header delegation
// (src/ui/tracker_header_wiring.ts), which hud.ts binds over the quest, deed,
// Reliquary, and recipe trackers: the header-only guard, the compact-touch
// chip reroute, the Enter/Space arm stopped before the game binds, the stray
// key that stays untouched, and the optional row controls.
import { describe, expect, it, vi } from 'vitest';
import { wireTrackerHeader } from '../src/ui/tracker_header_wiring';

function strip(headerClass = 'dt-header') {
  const root = document.createElement('div');
  root.innerHTML =
    `<button type="button" class="${headerClass}"><span class="inner">Hdr</span></button>` +
    `<div class="row" data-quest="q1">row</div><div class="other">other</div>`;
  return {
    root,
    header: root.querySelector('.inner') as HTMLElement,
    row: root.querySelector('.row') as HTMLElement,
    other: root.querySelector('.other') as HTMLElement,
  };
}

function key(target: HTMLElement, key: string, code = key) {
  const e = new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true });
  const stop = vi.spyOn(e, 'stopPropagation');
  target.dispatchEvent(e);
  return { prevented: e.defaultPrevented, stopped: stop.mock.calls.length > 0 };
}

describe('wireTrackerHeader', () => {
  it('toggles on a header click (descendants included) and ignores the rest of the strip', () => {
    const s = strip();
    const toggle = vi.fn();
    wireTrackerHeader(s.root, { toggle });
    s.header.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(toggle).toHaveBeenCalledTimes(1);
    s.other.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    s.row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('reroutes activation to openCompact only while isCompact says so', () => {
    const s = strip();
    const toggle = vi.fn();
    const openCompact = vi.fn();
    let compact = false;
    wireTrackerHeader(s.root, { toggle, isCompact: () => compact, openCompact });
    s.header.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(toggle).toHaveBeenCalledTimes(1);
    expect(openCompact).not.toHaveBeenCalled();
    compact = true;
    s.header.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(openCompact).toHaveBeenCalledTimes(1);
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it('arms Enter, Space (key) and Space (code) on the header, prevented and stopped', () => {
    const s = strip();
    const toggle = vi.fn();
    wireTrackerHeader(s.root, { toggle });
    expect(key(s.header, 'Enter')).toEqual({ prevented: true, stopped: true });
    expect(key(s.header, ' ', 'Space')).toEqual({ prevented: true, stopped: true });
    expect(key(s.header, 'Spacebar', 'Space')).toEqual({ prevented: true, stopped: true });
    expect(toggle).toHaveBeenCalledTimes(3);
  });

  it('leaves other keys, and Enter outside any control, untouched', () => {
    const s = strip();
    const toggle = vi.fn();
    wireTrackerHeader(s.root, { toggle });
    expect(key(s.header, 'a', 'KeyA')).toEqual({ prevented: false, stopped: false });
    expect(key(s.other, 'Enter')).toEqual({ prevented: false, stopped: false });
    expect(key(s.row, 'Enter')).toEqual({ prevented: false, stopped: false });
    expect(toggle).not.toHaveBeenCalled();
  });

  it('leaves a row the callback declines (no quest id) to the game binds', () => {
    // The quest tracker's row callback answers false for a .qt-title with no
    // data-quest, and the wiring must then NOT swallow the key (the old hud.ts
    // arm's exact fall-through, preserved across the extraction).
    const s = strip();
    const toggle = vi.fn();
    const activate = vi.fn(() => false);
    wireTrackerHeader(s.root, { toggle, rows: { selector: '.row', activate } });
    expect(key(s.row, 'Enter')).toEqual({ prevented: false, stopped: false });
    expect(activate).toHaveBeenCalledTimes(1);
  });

  it('honors a custom header selector and activates row controls by click and key', () => {
    const s = strip('qt-header');
    const toggle = vi.fn();
    const activate = vi.fn(() => true);
    wireTrackerHeader(s.root, {
      header: '.qt-header',
      toggle,
      rows: { selector: '.row', activate },
    });
    s.header.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(toggle).toHaveBeenCalledTimes(1);
    s.row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(activate).toHaveBeenCalledWith(s.row);
    expect(key(s.row, 'Enter')).toEqual({ prevented: true, stopped: true });
    expect(activate).toHaveBeenCalledTimes(2);
    expect(key(s.other, 'Enter')).toEqual({ prevented: false, stopped: false });
  });
});
