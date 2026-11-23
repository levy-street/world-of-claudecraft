// @vitest-environment happy-dom
// Which press starts a window drag, and the resize corner taking precedence
// over the headerless map's drag band (the band the corner overlaps).
import { afterEach, describe, expect, it } from 'vitest';
import { installWindowDrag } from '../src/ui/window_drag';
import { isWindowDragHandle } from '../src/ui/window_drag_handle';
import { resizeCornerWindowAt } from '../src/ui/window_resize';

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
