// @vitest-environment happy-dom
// The atlas rail divider over a real DOM: the stored width lands as the
// --map-rail-width property and aria-valuenow, a pointer drag and the keys
// resize it and persist it, a double-click resets it, and keys it does not use
// still reach the game.
import { afterEach, describe, expect, it } from 'vitest';
import { MapRailResizeController } from '../src/ui/hud/map/map_rail_resize_controller';

function rig(stored: number | null, scale = 1) {
  const win = document.createElement('div');
  win.id = 'map-window';
  const divider = document.createElement('div');
  divider.className = 'map-atlas-splitter';
  win.appendChild(divider);
  document.body.appendChild(win);
  const saved: number[] = [];
  const store = { value: stored };
  const controller = new MapRailResizeController({
    win,
    divider,
    settings: {
      get: () => store.value,
      set: (width) => {
        saved.push(width);
        store.value = width;
      },
    },
    getScale: () => scale,
  });
  controller.install();
  const width = () => win.style.getPropertyValue('--map-rail-width');
  return { win, divider, controller, saved, store, width };
}

const pointer = (type: string, clientX: number, buttons = 1) =>
  new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    pointerId: 7,
    button: 0,
    buttons,
  });

afterEach(() => {
  document.body.innerHTML = '';
});

describe('MapRailResizeController', () => {
  it('applies the stored width, or the shipped 300 before settings exist', () => {
    const fresh = rig(null);
    expect(fresh.width()).toBe('300px');
    expect(fresh.divider.getAttribute('aria-valuenow')).toBe('300');
    expect(fresh.divider.getAttribute('aria-valuemin')).toBe('240');
    expect(fresh.divider.getAttribute('aria-valuemax')).toBe('560');
    const stored = rig(420);
    expect(stored.width()).toBe('420px');
  });

  it('picks up settings that arrive after install, writing nothing when unchanged', () => {
    const r = rig(null);
    r.store.value = 380;
    r.controller.sync();
    expect(r.width()).toBe('380px');
    r.win.style.setProperty('--map-rail-width', 'marker');
    r.controller.sync(); // same stored width: no rewrite
    expect(r.width()).toBe('marker');
  });

  it('a pointer drag widens the rail live and persists once on release', () => {
    const r = rig(300, 1.25);
    r.divider.dispatchEvent(pointer('pointerdown', 500));
    r.divider.dispatchEvent(pointer('pointermove', 600));
    expect(r.width()).toBe('380px'); // 100 visual px under zoom 1.25
    expect(r.divider.classList.contains('is-dragging')).toBe(true);
    expect(r.saved).toEqual([]);
    r.divider.dispatchEvent(pointer('pointerup', 600, 0));
    expect(r.saved).toEqual([380]);
    expect(r.divider.classList.contains('is-dragging')).toBe(false);
  });

  it('the keys resize and persist, and keys it does not use still reach the game', () => {
    const r = rig(300);
    let reachedWindow = 0;
    const onWindow = () => {
      reachedWindow += 1;
    };
    window.addEventListener('keydown', onWindow);
    r.divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    r.divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(r.saved).toEqual([316, 560]);
    expect(r.divider.getAttribute('aria-valuenow')).toBe('560');
    expect(reachedWindow).toBe(0);
    r.divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', bubbles: true }));
    expect(reachedWindow).toBe(1);
    window.removeEventListener('keydown', onWindow);
  });

  it('a double-click resets to the shipped width', () => {
    const r = rig(500);
    r.divider.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    expect(r.width()).toBe('300px');
    expect(r.saved).toEqual([300]);
  });

  it('dispose detaches the divider', () => {
    const r = rig(300);
    r.controller.dispose();
    r.divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true }));
    expect(r.saved).toEqual([]);
  });
});
