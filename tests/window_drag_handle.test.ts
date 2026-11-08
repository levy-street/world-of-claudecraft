// @vitest-environment happy-dom
// Which press starts a window drag, and the resize corner taking precedence
// over the headerless map's drag band (the band the corner overlaps).
import { afterEach, describe, expect, it } from 'vitest';
import { installWindowDrag } from '../src/ui/window_drag';
import { WINDOW_DRAG_MARGIN } from '../src/ui/window_drag_core';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';
import { resizeCornerWindowAt } from '../src/ui/window_resize';
import { RESIZE_ENGAGE_SLOP_TOUCH } from '../src/ui/window_resize_core';

afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
});

// A 900x600 window at the origin with a 1px border, laid out by hand (happy-dom
// does no layout).
function mapWindow(): HTMLElement {
  const win = document.createElement('div');
  win.id = 'map-window';
  win.className = 'window panel window-resizable';
  win.innerHTML =
    '<aside class="map-atlas-sidebar"><span class="rail-text">Rail</span></aside>' +
    '<div class="map-atlas-stage"><canvas id="map-canvas"></canvas>' +
    '<button id="map-close"></button></div>';
  document.body.appendChild(win);
  Object.defineProperty(win, 'clientLeft', { value: 1 });
  Object.defineProperty(win, 'clientTop', { value: 1 });
  Object.defineProperty(win, 'clientWidth', { value: 898 });
  Object.defineProperty(win, 'clientHeight', { value: 598 });
  win.getBoundingClientRect = () => new DOMRect(0, 0, 900, 600);
  return win;
}

const press = (target: Element, clientX: number, clientY: number) => {
  const ev = new PointerEvent('pointerdown', {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
    button: 0,
    pointerId: 1,
  });
  Object.defineProperty(ev, 'target', { value: target });
  return ev;
};

describe('isWindowDragHandle', () => {
  it('drags the headerless map by its own padding band only', () => {
    const win = mapWindow();
    expect(isWindowDragHandle(win, win)).toBe(true);
    expect(isWindowDragHandle(win.querySelector('.rail-text') as HTMLElement, win)).toBe(false);
    expect(isWindowDragHandle(win.querySelector('#map-canvas') as HTMLElement, win)).toBe(false);
    expect(isWindowDragHandle(win.querySelector('#map-close') as HTMLElement, win)).toBe(false);
  });

  it('drags any other window by its title bar', () => {
    const win = document.createElement('div');
    win.className = 'window panel';
    win.innerHTML = '<div class="panel-title"><span>Bags</span></div><div class="body"></div>';
    document.body.appendChild(win);
    expect(isWindowDragHandle(win.querySelector('.panel-title span') as HTMLElement, win)).toBe(
      true,
    );
    expect(isWindowDragHandle(win.querySelector('.body') as HTMLElement, win)).toBe(false);
    expect(isWindowDragHandle(win, win)).toBe(false);
  });
});

describe('resizeCornerWindowAt', () => {
  it('finds the map in its SE corner band and nowhere else', () => {
    const win = mapWindow();
    expect(resizeCornerWindowAt(press(win, 895, 595), 1, false)).toBe(win);
    expect(resizeCornerWindowAt(press(win, 860, 595), 1, false)).toBeNull();
    expect(resizeCornerWindowAt(press(win, 10, 10), 1, false)).toBeNull();
  });

  it('stands the map grip down on the touch layout', () => {
    const win = mapWindow();
    document.body.classList.add('mobile-touch');
    expect(resizeCornerWindowAt(press(win, 895, 595), 1, false)).toBeNull();
  });
});

describe('window drag vs the resize corner', () => {
  function installDrag() {
    const pinned: HTMLElement[] = [];
    const drag = installWindowDrag({
      getScale: () => 1,
      isDragHandle: isWindowDragHandle,
      bringToFront: () => undefined,
      hideTooltip: () => undefined,
      pinWindow: (el) => pinned.push(el),
      commitWindow: () => undefined,
    });
    return { drag, pinned };
  }

  it('a press in the corner leaves the map to the resize (no drag starts)', () => {
    const win = mapWindow();
    const { drag, pinned } = installDrag();
    document.dispatchEvent(press(win, 895, 595));
    expect(pinned).toEqual([]);
    drag.destroy();
  });

  it('a press elsewhere on the band still drags the map', () => {
    const win = mapWindow();
    const { drag, pinned } = installDrag();
    document.dispatchEvent(press(win, 450, 5));
    expect(pinned).toEqual([win]);
    drag.destroy();
  });
});

// On the touch HUD nearly every window is an edge-pinned CSS sheet
// (hud.mobile.css). The drag's pin writes inline left/top plus
// right/bottom:auto, which unpins two of its edges: pinning at pointerdown made
// a plain title TAP shrink the bag to its content and blow the Book of Deeds out
// to 1152x8184 with its close button off-screen. On touch the drag now waits
// for real travel, and locks the window's on-screen size before it pins.
describe('window drag on the touch layout', () => {
  function titledWindow(id: string, rect = new DOMRect(10, 10, 854, 382)): HTMLElement {
    const win = document.createElement('div');
    win.id = id;
    win.className = 'window panel';
    win.innerHTML = '<div class="panel-title"><span>Title</span></div><div class="body"></div>';
    document.body.appendChild(win);
    win.getBoundingClientRect = () => rect;
    return win;
  }

  const pointer = (
    type: 'pointerdown' | 'pointermove' | 'pointerup',
    target: Element,
    clientX: number,
    clientY: number,
    buttons = 1,
  ) => {
    const ev = new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      button: 0,
      buttons,
      pointerId: 7,
      pointerType: 'touch',
    });
    Object.defineProperty(ev, 'target', { value: target });
    return ev;
  };

  function installTouchDrag(scale = 1) {
    const pinned: HTMLElement[] = [];
    const sizeAtPin: string[] = [];
    const drag = installWindowDrag({
      getScale: () => scale,
      isDragHandle: isWindowDragHandle,
      bringToFront: () => undefined,
      hideTooltip: () => undefined,
      pinWindow: (el) => {
        pinned.push(el);
        sizeAtPin.push(`${el.style.width}x${el.style.height}`);
      },
      commitWindow: () => undefined,
      requestFrame: () => 1,
      cancelFrame: () => undefined,
    });
    return { drag, pinned, sizeAtPin };
  }

  it('the title bar is still a drag handle on the touch layout', () => {
    document.body.classList.add('mobile-touch');
    const win = titledWindow('deeds-window');
    expect(isWindowDragHandle(win.querySelector('.panel-title span') as HTMLElement, win)).toBe(
      true,
    );
  });

  it('a title tap (no travel past the slop) never pins or resizes the window', () => {
    document.body.classList.add('mobile-touch');
    const { drag, pinned } = installTouchDrag();
    for (const id of ['bags', 'deeds-window', 'leaderboard-window']) {
      const win = titledWindow(id);
      const title = win.querySelector('.panel-title span') as Element;
      document.dispatchEvent(pointer('pointerdown', title, 60, 30));
      // Finger wobble inside the touch slop.
      document.dispatchEvent(pointer('pointermove', title, 60 + RESIZE_ENGAGE_SLOP_TOUCH - 1, 30));
      document.dispatchEvent(pointer('pointerup', title, 60 + RESIZE_ENGAGE_SLOP_TOUCH - 1, 30, 0));
      expect(win.dataset.windowMoved).toBeUndefined();
      expect(win.classList.contains('window-dragging')).toBe(false);
      expect(win.style.width).toBe('');
      expect(win.style.height).toBe('');
    }
    expect(pinned).toEqual([]);
    drag.destroy();
  });

  it('a real drag engages past the slop and locks the on-screen size before pinning', () => {
    document.body.classList.add('mobile-touch');
    const { drag, pinned, sizeAtPin } = installTouchDrag();
    const win = titledWindow('deeds-window');
    const title = win.querySelector('.panel-title span') as Element;
    document.dispatchEvent(pointer('pointerdown', title, 60, 30));
    document.dispatchEvent(pointer('pointermove', title, 60 + RESIZE_ENGAGE_SLOP_TOUCH, 30));
    expect(pinned).toEqual([win]);
    // The size was written BEFORE the pin, so right/bottom:auto cannot resize it.
    expect(sizeAtPin).toEqual(['854pxx382px']);
    expect(win.style.width).toBe('854px');
    expect(win.style.height).toBe('382px');
    expect(win.dataset.windowMoved).toBe('1');
    expect(win.classList.contains('window-dragging')).toBe(true);
    drag.destroy();
  });

  it('locks the size in author space under a UI scale', () => {
    document.body.classList.add('mobile-touch');
    // A 874x402 author viewport at scale 2, so the viewport cap is not what binds.
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 1748 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 804 });
    const { drag } = installTouchDrag(2);
    const win = titledWindow('bags', new DOMRect(20, 20, 1192, 764));
    const title = win.querySelector('.panel-title span') as Element;
    document.dispatchEvent(pointer('pointerdown', title, 60, 30));
    document.dispatchEvent(pointer('pointermove', title, 60, 30 + RESIZE_ENGAGE_SLOP_TOUCH));
    expect(win.style.width).toBe('596px');
    expect(win.style.height).toBe('382px');
    drag.destroy();
  });

  it('caps a full-screen sheet at the viewport less the drag margin so it cannot spill', () => {
    document.body.classList.add('mobile-touch');
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 874 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 402 });
    const { drag } = installTouchDrag();
    const win = titledWindow('char-window', new DOMRect(0, 0, 874, 402));
    const title = win.querySelector('.panel-title span') as Element;
    document.dispatchEvent(pointer('pointerdown', title, 60, 30));
    document.dispatchEvent(pointer('pointermove', title, 60 + RESIZE_ENGAGE_SLOP_TOUCH, 30));
    expect(win.style.width).toBe(`${874 - WINDOW_DRAG_MARGIN * 2}px`);
    expect(win.style.height).toBe(`${402 - WINDOW_DRAG_MARGIN * 2}px`);
    drag.destroy();
  });

  it('a press whose pointerup was swallowed does not engage on a later buttonless move', () => {
    document.body.classList.add('mobile-touch');
    const { drag, pinned } = installTouchDrag();
    const win = titledWindow('bags');
    const title = win.querySelector('.panel-title span') as Element;
    document.dispatchEvent(pointer('pointerdown', title, 60, 30));
    document.dispatchEvent(pointer('pointermove', title, 200, 30, 0));
    document.dispatchEvent(pointer('pointermove', title, 260, 30));
    expect(pinned).toEqual([]);
    expect(win.style.width).toBe('');
    drag.destroy();
  });

  it('the desktop layout still pins on press and never locks the size', () => {
    const { drag, pinned } = installTouchDrag();
    const win = titledWindow('deeds-window');
    document.dispatchEvent(
      pointer('pointerdown', win.querySelector('.panel-title span') as Element, 60, 30),
    );
    expect(pinned).toEqual([win]);
    expect(win.dataset.windowMoved).toBe('1');
    expect(win.style.width).toBe('');
    expect(win.style.height).toBe('');
    drag.destroy();
  });
});
