// @vitest-environment jsdom
//
// The touch arm of the bags drag: hold to pick a stack up, drag it to a paperdoll
// socket or out onto the world, release to drop. The gesture has to coexist with two
// things it can easily break, so both are pinned here:
//   - the bag grid SCROLLS (a flick must stay a scroll, never become a drag), and
//   - the release fires a synthetic click on the source row (which must not ALSO use
//     the item).
// Plus the world-drop decision shared with the desktop arm (world_drop_target.ts).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ItemDragState } from '../src/ui/item_drag_state';
import {
  bindTouchItemDrag,
  TOUCH_DRAG_HOLD_MS,
  TOUCH_DRAG_MOVE_TOLERANCE_PX,
} from '../src/ui/touch_item_drag';
import { dropOnWorld } from '../src/ui/world_drop_target';

function pointer(type: string, x: number, y: number, id = 1, pointerType = 'touch'): PointerEvent {
  return new PointerEvent(type, {
    pointerId: id,
    clientX: x,
    clientY: y,
    pointerType,
    bubbles: true,
    cancelable: true,
  });
}

interface Harness {
  el: HTMLElement;
  state: ItemDragState;
  started: number;
  drops: Array<{ x: number; y: number }>;
  ended: number;
}

function harness(opts: { touch?: boolean; payload?: boolean } = {}): Harness {
  const el = document.createElement('button');
  document.body.appendChild(el);
  const state = new ItemDragState();
  const h: Harness = { el, state, started: 0, drops: [], ended: 0 };
  bindTouchItemDrag(el, {
    state,
    isTouchHud: () => opts.touch !== false,
    payload: () => (opts.payload === false ? null : { itemId: 'linen_cloth', count: 4, index: 2 }),
    ghostHtml: () => '<img class="item-icon">',
    onStart: () => {
      h.started++;
    },
    onMove: () => {},
    onDrop: (x, y) => h.drops.push({ x, y }),
    onEnd: () => {
      h.ended++;
    },
  });
  return h;
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('bindTouchItemDrag', () => {
  it('arms after the hold and publishes the stack for the drop targets to read', () => {
    const h = harness();
    h.el.dispatchEvent(pointer('pointerdown', 100, 100));
    expect(h.state.get()).toBeNull(); // nothing in flight yet: this could still be a tap
    vi.advanceTimersByTime(TOUCH_DRAG_HOLD_MS);
    expect(h.started).toBe(1);
    expect(h.state.get()).toEqual({ itemId: 'linen_cloth', count: 4, index: 2 });
    expect(document.body.classList.contains('touch-item-dragging')).toBe(true);
    expect(document.querySelector('.touch-drag-ghost')).not.toBeNull();
  });

  it('a flick before the hold stays a SCROLL: no drag, no ghost, no drop', () => {
    const h = harness();
    h.el.dispatchEvent(pointer('pointerdown', 100, 100));
    h.el.dispatchEvent(pointer('pointermove', 100, 100 + TOUCH_DRAG_MOVE_TOLERANCE_PX + 1));
    vi.advanceTimersByTime(TOUCH_DRAG_HOLD_MS * 2);
    expect(h.started).toBe(0);
    expect(h.state.get()).toBeNull();
    expect(document.querySelector('.touch-drag-ghost')).toBeNull();
    h.el.dispatchEvent(pointer('pointerup', 100, 140));
    expect(h.drops).toEqual([]);
  });

  it('a tiny wobble within the tolerance still arms', () => {
    const h = harness();
    h.el.dispatchEvent(pointer('pointerdown', 100, 100));
    h.el.dispatchEvent(pointer('pointermove', 102, 102));
    vi.advanceTimersByTime(TOUCH_DRAG_HOLD_MS);
    expect(h.started).toBe(1);
  });

  it('reports the RELEASE point to the drop, not the pick-up point', () => {
    const h = harness();
    h.el.dispatchEvent(pointer('pointerdown', 100, 100));
    vi.advanceTimersByTime(TOUCH_DRAG_HOLD_MS);
    h.el.dispatchEvent(pointer('pointermove', 300, 220));
    h.el.dispatchEvent(pointer('pointerup', 305, 225));
    expect(h.drops).toEqual([{ x: 305, y: 225 }]);
    // Teardown is complete: nothing in flight, no ghost, no body class.
    expect(h.state.get()).toBeNull();
    expect(h.ended).toBe(1);
    expect(document.querySelector('.touch-drag-ghost')).toBeNull();
    expect(document.body.classList.contains('touch-item-dragging')).toBe(false);
  });

  it('cancels the pending tooltip peek when it arms (a drag never pops a tooltip)', () => {
    const h = harness();
    const cancels: PointerEvent[] = [];
    h.el.addEventListener('pointercancel', (e) => cancels.push(e as PointerEvent));
    h.el.dispatchEvent(pointer('pointerdown', 100, 100));
    vi.advanceTimersByTime(TOUCH_DRAG_HOLD_MS);
    expect(cancels).toHaveLength(1);
    // The synthetic cancel carries a pointerId that can never match a real pointer,
    // so it kills the tooltip timer WITHOUT tearing down the live drag.
    expect(cancels[0].pointerId).toBe(-1);
    expect(h.state.get()).not.toBeNull();
  });

  it('a real pointercancel (the system stole the touch) ends the drag with no drop', () => {
    const h = harness();
    h.el.dispatchEvent(pointer('pointerdown', 100, 100));
    vi.advanceTimersByTime(TOUCH_DRAG_HOLD_MS);
    h.el.dispatchEvent(pointer('pointercancel', 100, 100));
    expect(h.drops).toEqual([]);
    expect(h.state.get()).toBeNull();
    expect(h.ended).toBe(1);
  });

  it('is inert with a mouse (desktop uses HTML5 drag-and-drop) and for an undraggable row', () => {
    const mouse = harness();
    mouse.el.dispatchEvent(pointer('pointerdown', 10, 10, 1, 'mouse'));
    vi.advanceTimersByTime(TOUCH_DRAG_HOLD_MS);
    expect(mouse.started).toBe(0);

    const nonTouchHud = harness({ touch: false });
    nonTouchHud.el.dispatchEvent(pointer('pointerdown', 10, 10));
    vi.advanceTimersByTime(TOUCH_DRAG_HOLD_MS);
    expect(nonTouchHud.started).toBe(0);

    const noPayload = harness({ payload: false });
    noPayload.el.dispatchEvent(pointer('pointerdown', 10, 10));
    vi.advanceTimersByTime(TOUCH_DRAG_HOLD_MS);
    expect(noPayload.started).toBe(0);
    expect(noPayload.state.get()).toBeNull();
  });
});

describe('dropOnWorld', () => {
  function deps(action: 'discard' | 'discardBlocked' | 'none') {
    const calls = { prompts: [] as Array<[string, number]>, blocked: 0 };
    return {
      calls,
      deps: {
        destroyAction: () => action,
        promptDestroy: (id: string, n: number) => calls.prompts.push([id, n]),
        showBlocked: () => {
          calls.blocked++;
        },
      },
    };
  }

  it('opens the destroy PROMPT, never destroying the stack outright', () => {
    const { calls, deps: d } = deps('discard');
    dropOnWorld(d, 'linen_cloth', 4);
    expect(calls.prompts).toEqual([['linen_cloth', 4]]);
    expect(calls.blocked).toBe(0);
  });

  it('refuses a protected (noDiscard) item with feedback and no prompt', () => {
    const { calls, deps: d } = deps('discardBlocked');
    dropOnWorld(d, 'quest_key', 1);
    expect(calls.prompts).toEqual([]);
    expect(calls.blocked).toBe(1);
  });

  it('is inert while a transactional window owns the item (vendor / trade / bank)', () => {
    const { calls, deps: d } = deps('none');
    dropOnWorld(d, 'linen_cloth', 4);
    expect(calls.prompts).toEqual([]);
    expect(calls.blocked).toBe(0);
  });
});
