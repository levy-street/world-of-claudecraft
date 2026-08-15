import { describe, expect, it } from 'vitest';
import {
  boundsUsableOn,
  MIN_WINDOW_HEIGHT,
  MIN_WINDOW_WIDTH,
  nearestDisplay,
  resolveWindowRestore,
} from '../electron/window_memory.cjs';

// Restoring a window is only safe while the monitor layout it was saved on
// still holds. The failure this guards is silent and total: bounds reapplied
// onto a display that was unplugged put the window where nothing renders, so
// the player launches the game and sees no window at all. Every arm below is a
// layout the resolver must refuse, plus the happy path it must honor exactly.

const primary = { id: 1, workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
// A second monitor to the right, as a laptop-plus-external setup reports it.
const external = { id: 2, workArea: { x: 1920, y: 0, width: 2560, height: 1440 } };
const defaults = { width: 1440, height: 900 };

describe('resolveWindowRestore', () => {
  it('restores saved bounds when the display and the geometry still hold', () => {
    const restore = resolveWindowRestore({
      saved: {
        windowBounds: { x: 2100, y: 140, width: 1600, height: 1000 },
        displayId: 2,
        maximized: false,
      },
      displays: [primary, external],
      primaryId: 1,
      defaults,
    });
    expect(restore).toEqual({
      x: 2100,
      y: 140,
      width: 1600,
      height: 1000,
      maximized: false,
      restored: true,
    });
  });

  it('carries a maximized session back as maximized', () => {
    const restore = resolveWindowRestore({
      saved: {
        // getNormalBounds, so a maximized session still remembers a real size.
        windowBounds: { x: 100, y: 100, width: 1440, height: 900 },
        displayId: 1,
        maximized: true,
      },
      displays: [primary],
      primaryId: 1,
      defaults,
    });
    expect(restore.maximized).toBe(true);
    expect(restore.restored).toBe(true);
    expect({ x: restore.x, y: restore.y }).toEqual({ x: 100, y: 100 });
  });

  it('falls back to the default window when the saved display is gone', () => {
    // The external monitor from the last session is unplugged: its id no longer
    // matches, so the bounds are not reapplied even though they would still
    // (partly) intersect a remaining display.
    const restore = resolveWindowRestore({
      saved: {
        windowBounds: { x: 200, y: 100, width: 1600, height: 1000 },
        displayId: 2,
        maximized: true,
      },
      displays: [primary],
      primaryId: 1,
      defaults,
    });
    expect(restore.restored).toBe(false);
    // A stale maximized flag never rides a fallback: the layout it belonged to
    // is gone, and filling the wrong screen on first paint is the bad outcome.
    expect(restore.maximized).toBe(false);
    // Centered on the primary, computed exactly: (1920 - 1440) / 2 = 240,
    // (1080 - 900) / 2 = 90.
    expect(restore).toEqual({
      x: 240,
      y: 90,
      width: 1440,
      height: 900,
      maximized: false,
      restored: false,
    });
  });

  it('falls back when the saved bounds sit entirely off every display', () => {
    const restore = resolveWindowRestore({
      saved: {
        windowBounds: { x: 5000, y: 3000, width: 1440, height: 900 },
        displayId: 1,
        maximized: false,
      },
      displays: [primary],
      primaryId: 1,
      defaults,
    });
    expect(restore.restored).toBe(false);
    expect({ x: restore.x, y: restore.y }).toEqual({ x: 240, y: 90 });
  });

  it('falls back when only a sliver of the window would be visible', () => {
    // 40 px of width inside the work area: below the 100 px floor, so the
    // window would be a stripe at the screen edge with nothing to grab.
    const restore = resolveWindowRestore({
      saved: {
        windowBounds: { x: 1880, y: 100, width: 1440, height: 900 },
        displayId: 1,
        maximized: false,
      },
      displays: [primary],
      primaryId: 1,
      defaults,
    });
    expect(restore.restored).toBe(false);
    // The same window pushed 200 px further in IS restored, so the arm above
    // fails for the sliver and not for some unrelated reason.
    const inside = resolveWindowRestore({
      saved: {
        windowBounds: { x: 1680, y: 100, width: 1440, height: 900 },
        displayId: 1,
        maximized: false,
      },
      displays: [primary],
      primaryId: 1,
      defaults,
    });
    expect(inside.restored).toBe(true);
    expect(inside.x).toBe(1680);
  });

  it('falls back when the title strip is above the work area', () => {
    // Most of the window is on screen, but its top edge (the strip a player
    // drags) is off the top, which is unrecoverable without a mouse gesture
    // most desktops no longer offer.
    const restore = resolveWindowRestore({
      saved: {
        windowBounds: { x: 200, y: -60, width: 1440, height: 900 },
        displayId: 1,
        maximized: false,
      },
      displays: [primary],
      primaryId: 1,
      defaults,
    });
    expect(restore.restored).toBe(false);
  });

  it('centers on the display NEAREST the saved point, not blindly on primary', () => {
    // The saved window lived far out on the right-hand external monitor, which
    // is still connected, but the saved bounds are unusable (off its bottom).
    const restore = resolveWindowRestore({
      saved: {
        windowBounds: { x: 3000, y: 4000, width: 1440, height: 900 },
        displayId: 2,
        maximized: false,
      },
      displays: [primary, external],
      primaryId: 1,
      defaults,
    });
    expect(restore.restored).toBe(false);
    // Centered on the external work area: 1920 + (2560 - 1440) / 2 = 2480,
    // (1440 - 900) / 2 = 270.
    expect({ x: restore.x, y: restore.y }).toEqual({ x: 2480, y: 270 });
  });

  it('centers the default window on the primary display on a first launch', () => {
    const restore = resolveWindowRestore({
      saved: { maximized: false },
      displays: [external, primary],
      primaryId: 1,
      defaults,
    });
    expect(restore).toEqual({
      x: 240,
      y: 90,
      width: 1440,
      height: 900,
      maximized: false,
      restored: false,
    });
  });

  it('never restores below the window minimums', () => {
    const restore = resolveWindowRestore({
      saved: {
        windowBounds: { x: 10, y: 10, width: 300, height: 200 },
        displayId: 1,
        maximized: false,
      },
      displays: [primary],
      primaryId: 1,
      defaults,
    });
    expect(restore.restored).toBe(true);
    expect(restore.width).toBe(MIN_WINDOW_WIDTH);
    expect(restore.height).toBe(MIN_WINDOW_HEIGHT);
  });

  it('never centers a window wider or taller than the display it lands on', () => {
    const small = { id: 9, workArea: { x: 0, y: 0, width: 1280, height: 800 } };
    const restore = resolveWindowRestore({
      saved: null,
      displays: [small],
      primaryId: 9,
      defaults,
    });
    expect(restore.width).toBe(1280);
    expect(restore.height).toBe(800);
    expect({ x: restore.x, y: restore.y }).toEqual({ x: 0, y: 0 });
  });

  it('survives an empty or junk display list', () => {
    const restore = resolveWindowRestore({ saved: null, displays: [], defaults });
    expect(restore.restored).toBe(false);
    expect(restore.width).toBe(1440);
    expect(restore.height).toBe(900);
    expect(resolveWindowRestore().restored).toBe(false);
  });

  it('ignores a saved display whose id matches nothing measurable', () => {
    const broken = { id: 3, workArea: { x: 0, y: 0, width: 0, height: 0 } };
    const restore = resolveWindowRestore({
      saved: {
        windowBounds: { x: 10, y: 10, width: 1440, height: 900 },
        displayId: 3,
        maximized: false,
      },
      displays: [broken, primary],
      primaryId: 1,
      defaults,
    });
    expect(restore.restored).toBe(false);
  });
});

describe('boundsUsableOn', () => {
  it('requires at least 100 x 50 visible and a reachable top edge', () => {
    const workArea = { x: 0, y: 0, width: 1920, height: 1080 };
    expect(boundsUsableOn({ x: 0, y: 0, width: 1024, height: 720 }, workArea)).toBe(true);
    // Exactly at the floor on each axis, then one pixel short of it.
    expect(boundsUsableOn({ x: 1820, y: 0, width: 1024, height: 720 }, workArea)).toBe(true);
    expect(boundsUsableOn({ x: 1821, y: 0, width: 1024, height: 720 }, workArea)).toBe(false);
    expect(boundsUsableOn({ x: 0, y: 1030, width: 1024, height: 720 }, workArea)).toBe(true);
    expect(boundsUsableOn({ x: 0, y: 1031, width: 1024, height: 720 }, workArea)).toBe(false);
    expect(boundsUsableOn({ x: 0, y: -1, width: 1024, height: 720 }, workArea)).toBe(false);
  });
});

describe('nearestDisplay', () => {
  it('picks the display whose work area is closest to the point', () => {
    expect(nearestDisplay([primary, external], { x: 100, y: 100 })?.id).toBe(1);
    expect(nearestDisplay([primary, external], { x: 4000, y: 100 })?.id).toBe(2);
    // A point inside one work area is distance zero from it, so ordering in the
    // list cannot decide the answer.
    expect(nearestDisplay([external, primary], { x: 500, y: 500 })?.id).toBe(1);
    expect(nearestDisplay([], { x: 0, y: 0 })).toBeNull();
  });
});
