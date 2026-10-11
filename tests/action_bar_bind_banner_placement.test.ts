// @vitest-environment jsdom
//
// The on-bar key-binding banner's placement and drag. The banner is a HUD-root
// element placed clear of EVERY visible bar (the second and third bars stack
// above the primary one, and a banner over them left their slots unbindable),
// and its plate is a drag handle so the player can move it off anything it
// still covers. Pins the regression where the placement code was lost in a
// merge and the banner fell back to an unplaced #actionbar-stack child.
import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ACTION_BAR_BIND_BANNER_ANCHORS,
  ACTION_BAR_BIND_BANNER_NUDGE,
  bindActionBarBindBannerDrag,
  mountActionBarBindBanner,
  placeActionBarBindBanner,
} from '../src/ui/hud/action_bar/action_bar_bind_banner';
import {
  ACTION_BAR_BIND_BANNER_FALLBACK_LIFT,
  actionBarBindBannerPlacement,
} from '../src/ui/hud/action_bar/action_bar_bind_core';

vi.mock('../src/game/audio', () => ({ audio: { click: vi.fn() } }));
vi.mock('../src/ui/i18n', () => ({ t: (key: string) => key }));
vi.mock('../src/ui/ui_scale', () => ({ getUiScale: () => 2 }));

const banner = { width: 350, height: 92 };
const viewport = { width: 1600, height: 900 };

describe('actionBarBindBannerPlacement', () => {
  it('centres on the primary bar and lifts above the TOPMOST visible bar', () => {
    const bars = [
      { left: 502, top: 828, width: 596, height: 46 },
      { left: 502, top: 776, width: 596, height: 46 },
      { left: 502, top: 724, width: 596, height: 46 },
      { left: 502, top: 678, width: 40, height: 40 },
    ];
    const placed = actionBarBindBannerPlacement({ bars, banner, viewport });
    expect(placed).toEqual({ left: 625, top: 678 - 8 - 92 });
    // Above every bar: no slot of any bar is under the banner's box.
    for (const bar of bars) expect(placed.top + banner.height).toBeLessThanOrEqual(bar.top);
  });

  it('a single docked bar keeps the classic seat directly above it', () => {
    const placed = actionBarBindBannerPlacement({
      bars: [{ left: 502, top: 828, width: 596, height: 46 }],
      banner,
      viewport,
    });
    expect(placed).toEqual({ left: 625, top: 828 - 8 - 92 });
  });

  it('drops below the LOWEST bar when there is no room above', () => {
    const bars = [
      { left: 100, top: 60, width: 596, height: 46 },
      { left: 100, top: 8, width: 596, height: 46 },
    ];
    const placed = actionBarBindBannerPlacement({ bars, banner, viewport });
    expect(placed.top).toBe(60 + 46 + 8);
  });

  it('never lands on a bar: a bar moved to the top edge does not push it onto the docked stack', () => {
    const bars = [
      { left: 502, top: 828, width: 596, height: 46 },
      { left: 502, top: 8, width: 596, height: 46 },
    ];
    const placed = actionBarBindBannerPlacement({ bars, banner, viewport });
    // Above is out (8 - 8 - 92 < gap); below the lowest bar clamps back onto it;
    // the free band between the two bars is the seat.
    expect(placed.top).toBe(8 + 46 + 8);
    for (const bar of bars) {
      const clear = placed.top + banner.height <= bar.top || placed.top >= bar.top + bar.height;
      expect(clear).toBe(true);
    }
  });

  it('with no bar box at all takes the stock bottom-centre seat', () => {
    expect(actionBarBindBannerPlacement({ bars: [], banner, viewport })).toEqual({
      left: (1600 - 350) / 2,
      top: 900 - 92 - ACTION_BAR_BIND_BANNER_FALLBACK_LIFT,
    });
  });

  it('is clamped inside the viewport on every edge', () => {
    const placed = actionBarBindBannerPlacement({
      bars: [{ left: -300, top: 5, width: 100, height: 46 }],
      banner,
      viewport: { width: 400, height: 300 },
    });
    expect(placed.left).toBe(8);
    // No room above a bar at the top edge: it drops below the bar instead.
    expect(placed.top).toBe(5 + 46 + 8);
    const low = actionBarBindBannerPlacement({
      bars: [{ left: 10, top: 290, width: 100, height: 46 }],
      banner,
      viewport: { width: 400, height: 300 },
    });
    expect(low.top).toBe(290 - 8 - 92);
    expect(low.left).toBe(8);
  });
});

/** Give an element a fixed VISUAL box (jsdom lays nothing out). */
function box(el: Element, r: { x: number; y: number; w: number; h: number }): void {
  el.getBoundingClientRect = () =>
    ({
      left: r.x,
      top: r.y,
      right: r.x + r.w,
      bottom: r.y + r.h,
      x: r.x,
      y: r.y,
      width: r.w,
      height: r.h,
    }) as DOMRect;
}

/** The VISUAL window box; the module divides it by the UI scale (2 here). */
function windowSize(w: number, h: number): void {
  Object.defineProperty(window, 'innerWidth', { value: w, configurable: true });
  Object.defineProperty(window, 'innerHeight', { value: h, configurable: true });
}

function size(el: HTMLElement, w: number, h: number): void {
  Object.defineProperty(el, 'offsetWidth', { value: w, configurable: true });
  Object.defineProperty(el, 'offsetHeight', { value: h, configurable: true });
  Object.defineProperty(el, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: h, configurable: true });
}

describe('placeActionBarBindBanner', () => {
  let ui: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML =
      '<div id="ui"><div id="actionbar-stack"><div id="actionbar3"></div><div id="actionbar2"></div><div id="actionbar"></div></div></div>';
    ui = document.getElementById('ui') as HTMLElement;
    size(ui, 1600, 900);
    windowSize(3200, 1800);
  });

  it('lists the primary bar first, then every stacked bar', () => {
    expect(ACTION_BAR_BIND_BANNER_ANCHORS[0]).toBe('#actionbar');
    expect(ACTION_BAR_BIND_BANNER_ANCHORS).toContain('#actionbar2');
    expect(ACTION_BAR_BIND_BANNER_ANCHORS).toContain('#actionbar3');
  });

  it('every anchor resolves in both client entries', () => {
    for (const entry of ['index.html', 'play.html']) {
      const html = readFileSync(entry, 'utf8');
      for (const sel of ACTION_BAR_BIND_BANNER_ANCHORS) {
        expect(html, `${sel} in ${entry}`).toContain(`id="${sel.slice(1)}"`);
      }
    }
  });

  it('clamps against the VISIBLE region, not the #ui author box, under a UI scale above 1', () => {
    // Visual window 1600x900 under scale 2 shows only 800x450 author px of the
    // 1600x900 #ui box; the no-bar fallback seat must stay inside the visible part.
    windowSize(1600, 900);
    const el = document.createElement('div');
    ui.appendChild(el);
    size(el, 350, 92);
    placeActionBarBindBanner(el, ui);
    expect(el.style.left).toBe(`${(800 - 350) / 2}px`);
    expect(el.style.top).toBe(`${450 - 92 - ACTION_BAR_BIND_BANNER_FALLBACK_LIFT}px`);
  });

  it('mounts on the HUD root and places the banner above the topmost bar in author px', () => {
    // Visual boxes under a 2x UI zoom: author px are half of these.
    box(document.getElementById('actionbar')!, { x: 1004, y: 1656, w: 1192, h: 92 });
    box(document.getElementById('actionbar2')!, { x: 1004, y: 1552, w: 1192, h: 92 });
    // A bar with no box (display:none) anchors nothing.
    box(document.getElementById('actionbar3')!, { x: 0, y: 0, w: 0, h: 0 });
    const el = mountActionBarBindBanner(ui, { onReset: () => {}, onDone: () => {} });
    expect(el.parentElement).toBe(ui);
    size(el, 350, 92);
    placeActionBarBindBanner(el, ui);
    expect(el.style.left).toBe(`${502 + 298 - 175}px`);
    expect(el.style.top).toBe(`${776 - 8 - 92}px`);
  });

  it('a bar Interface Unlock reparented to #ui still counts', () => {
    const bar2 = document.getElementById('actionbar2')!;
    ui.appendChild(bar2);
    box(document.getElementById('actionbar')!, { x: 1004, y: 1656, w: 1192, h: 92 });
    box(bar2, { x: 200, y: 400, w: 1192, h: 92 });
    const el = document.createElement('div');
    ui.appendChild(el);
    size(el, 350, 92);
    placeActionBarBindBanner(el, ui);
    expect(el.style.top).toBe(`${200 - 8 - 92}px`);
  });
});

describe('bindActionBarBindBannerDrag', () => {
  let ui: HTMLElement;
  let el: HTMLElement;
  beforeEach(() => {
    document.body.innerHTML = '<div id="ui"></div>';
    ui = document.getElementById('ui') as HTMLElement;
    size(ui, 1600, 900);
    windowSize(3200, 1800);
    // Frame-batched writes: run the batch synchronously in the test.
    window.requestAnimationFrame = (cb) => {
      cb(0);
      return 1;
    };
    el = mountActionBarBindBanner(ui, { onReset: () => {}, onDone: () => {} });
    size(el, 350, 92);
    box(el, { x: 1250, y: 1156, w: 700, h: 184 });
    el.setPointerCapture = () => {};
  });

  function pointer(type: string, x: number, y: number, target: Element = el, button = 0, id = 1) {
    const e = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button });
    Object.defineProperty(e, 'pointerId', { value: id });
    target.dispatchEvent(e);
    return e;
  }

  it('only the pointer that started the drag can move or end it', () => {
    pointer('pointerdown', 1260, 1166);
    pointer('pointermove', 1460, 966, el, 0, 2);
    expect(el.style.left).not.toBe('725px');
    pointer('pointerup', 1460, 966, el, 0, 2);
    pointer('pointermove', 1460, 966);
    expect(el.style.left).toBe('725px');
  });

  it('arrow keys nudge the banner while a banner button has focus, Shift four times as far', () => {
    el.style.left = '100px';
    el.style.top = '100px';
    const done = el.querySelectorAll('button')[1]!;
    done.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    expect(el.style.left).toBe(`${100 + ACTION_BAR_BIND_BANNER_NUDGE}px`);
    done.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true }),
    );
    expect(el.style.top).toBe(`${100 - 4 * ACTION_BAR_BIND_BANNER_NUDGE}px`);
    // Clamped at the edge like a drag.
    for (let i = 0; i < 40; i++)
      done.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
    expect(el.style.left).toBe('8px');
  });

  it('re-places against the bars on resize until the player moves it by hand', () => {
    const before = el.style.top;
    windowSize(3200, 1200);
    window.dispatchEvent(new Event('resize'));
    expect(el.style.top).not.toBe(before);
    const placed = el.style.top;
    pointer('pointerdown', 1260, 1166);
    pointer('pointermove', 1460, 966);
    pointer('pointerup', 1460, 966);
    windowSize(3200, 1800);
    window.dispatchEvent(new Event('resize'));
    expect(el.style.top).not.toBe(placed);
    expect(el.style.top).toBe('478px');
  });

  it('releases every resize listener when the banner is removed', async () => {
    const addSpy = vi.spyOn(window, 'addEventListener');
    const banner = mountActionBarBindBanner(ui, { onReset: () => {}, onDone: () => {} });
    const resizeOptions = addSpy.mock.calls
      .filter(([type]) => type === 'resize')
      .map(([, , options]) => options as AddEventListenerOptions | undefined);
    expect(resizeOptions.length).toBeGreaterThan(0);
    banner.remove();
    await Promise.resolve();
    for (const options of resizeOptions) expect(options?.signal?.aborted).toBe(true);
    addSpy.mockRestore();
  });

  it('drags by the plate, converting visual px to author px under the UI zoom', () => {
    pointer('pointerdown', 1260, 1166);
    pointer('pointermove', 1460, 966);
    // Grab offset (10,10) visual; new visual origin (1450,956) is (725,478) author px.
    expect(el.style.left).toBe('725px');
    expect(el.style.top).toBe('478px');
    pointer('pointerup', 1460, 966);
    pointer('pointermove', 100, 100);
    expect(el.style.left).toBe('725px');
  });

  it('never drags from Reset or Done, and ignores non-primary buttons', () => {
    const placedLeft = el.style.left;
    const done = el.querySelectorAll('button')[1]!;
    pointer('pointerdown', 1260, 1166, done);
    pointer('pointermove', 1460, 966);
    expect(el.style.left).toBe(placedLeft);
    pointer('pointerdown', 1260, 1166, el, 2);
    pointer('pointermove', 1460, 966);
    expect(el.style.left).toBe(placedLeft);
  });

  it('stays inside the HUD root', () => {
    pointer('pointerdown', 1260, 1166);
    pointer('pointermove', -5000, -5000);
    expect(el.style.left).toBe('8px');
    expect(el.style.top).toBe('8px');
  });

  it('is installed by the mount, once, on the mounted root', () => {
    // bindActionBarBindBannerDrag is exported for the mount; a second bind is harmless.
    bindActionBarBindBannerDrag(el, ui);
    pointer('pointerdown', 1260, 1166);
    pointer('pointermove', 1460, 966);
    expect(el.style.left).toBe('725px');
  });
});
