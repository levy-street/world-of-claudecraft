// The touch-layout drag of the class engine indicators, DOM half
// (src/ui/touch_frame_drag.ts): a one-finger drag on the touch layout moves a
// frame by its saved center and persists on drop, the desktop layout refuses
// the gesture (the Unlock Interface editor owns the frame there), a saved spot
// applies at attach and re-clamps from STORAGE on resize, reset hands the frame
// back to its stylesheet seat, a drag measures the frame once at the grab, the
// touch layout strips the desktop mover's inline geometry before placing, and
// the table-driven attach covers exactly the three engine indicators. The
// attacher writes only the two custom properties and the classes; the mobile
// stylesheet places the frame from them, which the CSS pins at the end hold.
// Per the repo testing convention this drives a small hand-rolled fake element
// and host (no jsdom).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  attachTouchFrameDrag,
  attachTouchFrameDrags,
  SAFE_AREA_PROBE_CLASS,
  type TouchDragHost,
} from '../src/ui/touch_frame_drag';
import {
  TOUCH_ANCHOR_X_PROP,
  TOUCH_ANCHOR_Y_PROP,
  TOUCH_DRAG_FRAMES,
  TOUCH_DRAGGING_CLASS,
  TOUCH_PLACED_CLASS,
  type TouchSafeArea,
} from '../src/ui/touch_frame_drag_core';

type Listener = (ev: PointerEvent) => void;

class FakeEl {
  classes = new Set<string>();
  props = new Map<string, string>();
  rect = { left: 100, top: 100, width: 60, height: 46 };
  captured: number[] = [];
  rectReads = 0;
  private handlers = new Map<string, Listener[]>();
  classList = {
    add: (name: string) => {
      this.classes.add(name);
    },
    remove: (name: string) => {
      this.classes.delete(name);
    },
  };
  style = {
    setProperty: (name: string, value: string) => {
      this.props.set(name, value);
    },
    removeProperty: (name: string) => {
      this.props.delete(name);
    },
  };
  getBoundingClientRect() {
    this.rectReads += 1;
    return this.rect;
  }
  addEventListener(type: string, listener: Listener): void {
    const list = this.handlers.get(type) ?? [];
    list.push(listener);
    this.handlers.set(type, list);
  }
  setPointerCapture(pointerId: number): void {
    this.captured.push(pointerId);
  }
  fire(type: string, ev: PointerEvent): void {
    for (const listener of this.handlers.get(type) ?? []) listener(ev);
  }
}

interface FakePointer extends PointerEvent {
  prevented: boolean;
  stopped: boolean;
}

function pointer(
  clientX: number,
  clientY: number,
  over: Partial<{
    pointerId: number;
    isPrimary: boolean;
    button: number;
    target: unknown;
  }> = {},
): FakePointer {
  const ev = {
    clientX,
    clientY,
    pointerId: 1,
    isPrimary: true,
    button: 0,
    target: null,
    prevented: false,
    stopped: false,
    preventDefault() {
      ev.prevented = true;
    },
    stopPropagation() {
      ev.stopped = true;
    },
    ...over,
  };
  return ev as unknown as FakePointer;
}

/** A press target whose closest() answers the real selector, so the button
 *  guard is pinned against the selector it asks for, not a stub that says yes
 *  to everything. */
const insideButton = { closest: (selector: string) => (selector === 'button' ? {} : null) };
const plainArt = { closest: () => null };

interface FakeHost extends TouchDragHost {
  store: Map<string, string>;
  size: { w: number; h: number };
  insets: TouchSafeArea;
  safeAreaReads: number;
  resize(): void;
}

function fakeHost(seed: Record<string, string> = {}): FakeHost {
  const store = new Map(Object.entries(seed));
  const listeners: Array<() => void> = [];
  const host: FakeHost = {
    store,
    size: { w: 844, h: 390 },
    insets: { top: 0, right: 0, bottom: 0, left: 0 },
    safeAreaReads: 0,
    viewport: () => ({ ...host.size }),
    safeArea: () => {
      host.safeAreaReads += 1;
      return { ...host.insets };
    },
    onResize: (listener) => {
      listeners.push(listener);
    },
    resize: () => {
      for (const listener of listeners) listener();
    },
    storage: {
      getItem: (key) => store.get(key) ?? null,
      setItem: (key, value) => {
        store.set(key, value);
      },
      removeItem: (key) => {
        store.delete(key);
      },
    },
  };
  return host;
}

const KEY = 'procOverlayAnchor';
const pct = (fraction: number) => `${(fraction * 100).toFixed(2)}%`;

function attach(el: FakeEl, host: FakeHost, touch = true) {
  return attachTouchFrameDrag(el, { storageKey: KEY, isTouchLayout: () => touch, host });
}

describe('attachTouchFrameDrag', () => {
  it('leaves a frame with no saved spot on its stylesheet seat', () => {
    const el = new FakeEl();
    const drag = attach(el, fakeHost());
    expect(drag.anchor).toBeNull();
    expect(el.classes.has(TOUCH_PLACED_CLASS)).toBe(false);
    expect(el.props.size).toBe(0);
  });

  it('moves the frame by its center on a touch-layout drag and persists the spot on drop', () => {
    const el = new FakeEl();
    const host = fakeHost();
    const drag = attach(el, host);
    // Grabbed 20px left of and 13px above the 60x46 frame's center (130, 123).
    const down = pointer(110, 110, { target: plainArt });
    el.fire('pointerdown', down);
    expect(down.prevented).toBe(true);
    // Propagation is left alone on purpose: the touch controls' document-level
    // pointerdown listeners (chrome-fade keep-awake, the More tray's
    // tap-outside-to-dismiss) must still see the press.
    expect(down.stopped).toBe(false);
    expect(el.captured).toEqual([1]);
    expect(el.classes.has(TOUCH_DRAGGING_CLASS)).toBe(true);
    // The center follows the finger with the grab offset kept: (420, 213).
    el.fire('pointermove', pointer(400, 200));
    expect(drag.anchor).toEqual({ fx: 420 / 844, fy: 213 / 390 });
    expect(el.props.get(TOUCH_ANCHOR_X_PROP)).toBe(pct(420 / 844));
    expect(el.props.get(TOUCH_ANCHOR_Y_PROP)).toBe(pct(213 / 390));
    expect(el.classes.has(TOUCH_PLACED_CLASS)).toBe(true);
    // Nothing reaches storage until the drop.
    expect(host.store.has(KEY)).toBe(false);
    el.fire('pointerup', pointer(400, 200));
    expect(el.classes.has(TOUCH_DRAGGING_CLASS)).toBe(false);
    expect(el.classes.has(TOUCH_PLACED_CLASS)).toBe(true);
    expect(JSON.parse(host.store.get(KEY) ?? '')).toEqual({ fx: 420 / 844, fy: 213 / 390 });
  });

  it('measures the frame and the safe area once at the grab, never per move', () => {
    const el = new FakeEl();
    const host = fakeHost();
    attach(el, host);
    const rectReadsBefore = el.rectReads;
    const safeAreaReadsBefore = host.safeAreaReads;
    el.fire('pointerdown', pointer(130, 123));
    for (let i = 0; i < 25; i++) el.fire('pointermove', pointer(200 + i * 10, 150 + i * 3));
    el.fire('pointerup', pointer(450, 225));
    expect(el.rectReads - rectReadsBefore).toBe(1);
    expect(host.safeAreaReads - safeAreaReadsBefore).toBe(1);
  });

  it('refuses the gesture on the desktop layout, where the Unlock Interface editor owns the frame', () => {
    const el = new FakeEl();
    const host = fakeHost();
    const drag = attach(el, host, false);
    const down = pointer(110, 110);
    el.fire('pointerdown', down);
    el.fire('pointermove', pointer(400, 200));
    el.fire('pointerup', pointer(400, 200));
    expect(down.prevented).toBe(false);
    expect(drag.anchor).toBeNull();
    expect(el.classes.size).toBe(0);
    expect(host.store.has(KEY)).toBe(false);
  });

  it('ignores a non-primary press, a secondary button, and a press on a control inside the frame', () => {
    const el = new FakeEl();
    const host = fakeHost();
    attach(el, host);
    el.fire('pointerdown', pointer(110, 110, { isPrimary: false }));
    expect(el.classes.has(TOUCH_DRAGGING_CLASS)).toBe(false);
    // A right button on a touch-classified device that also has a mouse.
    el.fire('pointerdown', pointer(110, 110, { button: 2 }));
    expect(el.classes.has(TOUCH_DRAGGING_CLASS)).toBe(false);
    el.fire('pointerdown', pointer(110, 110, { target: insideButton }));
    expect(el.classes.has(TOUCH_DRAGGING_CLASS)).toBe(false);
    // The positive arm of the same guard: a press on the artwork starts one.
    el.fire('pointerdown', pointer(110, 110, { target: plainArt }));
    expect(el.classes.has(TOUCH_DRAGGING_CLASS)).toBe(true);
  });

  it('ignores a second finger for the length of a live drag', () => {
    const el = new FakeEl();
    const host = fakeHost();
    const drag = attach(el, host);
    el.fire('pointerdown', pointer(110, 110));
    el.fire('pointerdown', pointer(500, 300, { pointerId: 2 }));
    el.fire('pointermove', pointer(700, 350, { pointerId: 2 }));
    expect(drag.anchor).toBeNull();
    el.fire('pointerup', pointer(700, 350, { pointerId: 2 }));
    expect(el.classes.has(TOUCH_DRAGGING_CLASS)).toBe(true);
    el.fire('pointermove', pointer(400, 200));
    expect(drag.anchor).toEqual({ fx: 420 / 844, fy: 213 / 390 });
    el.fire('pointercancel', pointer(400, 200));
    expect(el.classes.has(TOUCH_DRAGGING_CLASS)).toBe(false);
    expect(host.store.has(KEY)).toBe(true);
  });

  it('keeps the whole visual body inside the viewport and every side of the safe area', () => {
    const el = new FakeEl();
    const host = fakeHost();
    host.insets = { top: 47, right: 44, bottom: 21, left: 12 };
    const drag = attach(el, host);
    el.fire('pointerdown', pointer(130, 123));
    el.fire('pointermove', pointer(-500, -500));
    expect(drag.anchor?.fx).toBeCloseTo((12 + 30) / 844);
    expect(drag.anchor?.fy).toBeCloseTo((47 + 23) / 390);
    el.fire('pointermove', pointer(5000, 5000));
    expect(drag.anchor?.fx).toBeCloseTo((844 - 44 - 30) / 844);
    expect(drag.anchor?.fy).toBeCloseTo((390 - 21 - 23) / 390);
  });

  it('applies a saved spot at attach and re-clamps it from STORAGE on resize', () => {
    const el = new FakeEl();
    const host = fakeHost({ [KEY]: JSON.stringify({ fx: 0.9, fy: 0.9 }) });
    const drag = attach(el, host);
    expect(drag.anchor).toEqual({ fx: 0.9, fy: 0.9 });
    expect(el.classes.has(TOUCH_PLACED_CLASS)).toBe(true);
    expect(el.props.get(TOUCH_ANCHOR_X_PROP)).toBe('90.00%');
    // A smaller viewport clamps the 46px-tall frame's center up to 1 - 23/200.
    host.size = { w: 300, h: 200 };
    host.resize();
    expect(drag.anchor?.fx).toBeCloseTo(0.9);
    expect(drag.anchor?.fy).toBeCloseTo(1 - 23 / 200);
    // Growing back restores the exact saved spot: the clamp was never persisted.
    host.size = { w: 844, h: 390 };
    host.resize();
    expect(drag.anchor).toEqual({ fx: 0.9, fy: 0.9 });
    expect(JSON.parse(host.store.get(KEY) ?? '')).toEqual({ fx: 0.9, fy: 0.9 });
  });

  it('applies a saved spot on the desktop layout too (an inert stamp there), so a layout flip finds it', () => {
    const el = new FakeEl();
    const host = fakeHost({ [KEY]: JSON.stringify({ fx: 0.3, fy: 0.3 }) });
    const drag = attach(el, host, false);
    expect(drag.anchor).toEqual({ fx: 0.3, fy: 0.3 });
    expect(el.classes.has(TOUCH_PLACED_CLASS)).toBe(true);
  });

  it('strips the desktop mover inline geometry on the touch layout before placing, and only there', () => {
    // The desktop mover applied a spot inline (a live Interface Mode flip into
    // touch fires no resize, so its own mobile-layout strip has not run): an
    // inline left/top would outrank the placement rules.
    const seedMoverGeometry = (el: FakeEl) => {
      el.style.setProperty('left', '412px');
      el.style.setProperty('top', '188px');
      el.style.setProperty('transform', 'scale(1.2)');
      el.style.setProperty('transform-origin', 'top left');
    };
    // At attach with a saved spot.
    const atAttach = new FakeEl();
    seedMoverGeometry(atAttach);
    attach(atAttach, fakeHost({ [KEY]: JSON.stringify({ fx: 0.3, fy: 0.3 }) }));
    expect([...atAttach.props.keys()].sort()).toEqual([TOUCH_ANCHOR_X_PROP, TOUCH_ANCHOR_Y_PROP]);
    // At the grab.
    const atGrab = new FakeEl();
    seedMoverGeometry(atGrab);
    attach(atGrab, fakeHost());
    atGrab.fire('pointerdown', pointer(130, 123));
    expect(atGrab.props.has('left')).toBe(false);
    expect(atGrab.props.has('transform')).toBe(false);
    // On a resize that re-places.
    const atResize = new FakeEl();
    const host = fakeHost({ [KEY]: JSON.stringify({ fx: 0.3, fy: 0.3 }) });
    attach(atResize, host);
    seedMoverGeometry(atResize);
    host.resize();
    expect(atResize.props.has('left')).toBe(false);
    // Never on the desktop layout: the mover owns that geometry there.
    const desktop = new FakeEl();
    seedMoverGeometry(desktop);
    attach(desktop, fakeHost({ [KEY]: JSON.stringify({ fx: 0.3, fy: 0.3 }) }), false);
    expect(desktop.props.get('left')).toBe('412px');
    expect(desktop.props.get('transform')).toBe('scale(1.2)');
  });

  it('leaves a mid-drag resize to the live drag', () => {
    const el = new FakeEl();
    const host = fakeHost({ [KEY]: JSON.stringify({ fx: 0.2, fy: 0.2 }) });
    const drag = attach(el, host);
    el.fire('pointerdown', pointer(130, 123));
    el.fire('pointermove', pointer(400, 200));
    host.resize();
    expect(drag.anchor).toEqual({ fx: 400 / 844, fy: 200 / 390 });
  });

  it('keeps the seat on malformed storage', () => {
    const el = new FakeEl();
    const drag = attach(el, fakeHost({ [KEY]: 'garbage' }));
    expect(drag.anchor).toBeNull();
    expect(el.classes.has(TOUCH_PLACED_CLASS)).toBe(false);
  });

  it('survives a store that throws, and re-places from memory on resize when it does', () => {
    const el = new FakeEl();
    const host = fakeHost();
    host.storage = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const drag = attach(el, host);
    // Carried past the bottom-right corner, where the 60x46 frame clamps.
    el.fire('pointerdown', pointer(130, 123));
    el.fire('pointermove', pointer(900, 420));
    el.fire('pointerup', pointer(900, 420));
    expect(drag.anchor?.fx).toBeCloseTo(1 - 30 / 844);
    expect(drag.anchor?.fy).toBeCloseTo(1 - 23 / 390);
    // No store to re-read, so the in-memory anchor is the basis: re-clamped
    // into the smaller viewport rather than dropped.
    host.size = { w: 300, h: 200 };
    host.resize();
    expect(drag.anchor?.fx).toBeCloseTo(1 - 30 / 300);
    expect(drag.anchor?.fy).toBeCloseTo(1 - 23 / 200);
    expect(() => drag.reset()).not.toThrow();
  });

  it('reset forgets the saved spot and hands the frame back to its seat', () => {
    const el = new FakeEl();
    const host = fakeHost({ [KEY]: JSON.stringify({ fx: 0.3, fy: 0.3 }) });
    const drag = attach(el, host);
    drag.reset();
    expect(drag.anchor).toBeNull();
    expect(el.classes.size).toBe(0);
    expect(el.props.size).toBe(0);
    expect(host.store.has(KEY)).toBe(false);
    // And a resize after the reset re-places nothing.
    host.resize();
    expect(el.classes.size).toBe(0);
  });

  it('reset mid-drag releases the gesture, so the next press starts a fresh one', () => {
    const el = new FakeEl();
    const host = fakeHost();
    const drag = attach(el, host);
    el.fire('pointerdown', pointer(130, 123));
    el.fire('pointermove', pointer(400, 200));
    drag.reset();
    expect(el.classes.size).toBe(0);
    // The stale finger's moves and lift are no longer the gesture's.
    el.fire('pointermove', pointer(500, 250));
    el.fire('pointerup', pointer(500, 250));
    expect(drag.anchor).toBeNull();
    expect(host.store.has(KEY)).toBe(false);
    // A new press is accepted (a stuck pointer id would refuse it).
    el.fire('pointerdown', pointer(130, 123, { pointerId: 7 }));
    el.fire('pointermove', pointer(400, 200, { pointerId: 7 }));
    expect(drag.anchor).toEqual({ fx: 400 / 844, fy: 200 / 390 });
  });
});

describe('attachTouchFrameDrags', () => {
  function fakeDocument(present: string[]) {
    const els = new Map(present.map((id) => [id, new FakeEl()]));
    return {
      els,
      doc: {
        getElementById: (id: string) => (els.get(id) as unknown as HTMLElement) ?? null,
      } as Pick<Document, 'getElementById'>,
    };
  }

  it('attaches the three engine indicators by their registry element ids', () => {
    const ids = TOUCH_DRAG_FRAMES.map((row) => row.elementId);
    const { els, doc } = fakeDocument(ids);
    const host = fakeHost(
      Object.fromEntries(
        TOUCH_DRAG_FRAMES.map((row) => [row.storageKey, JSON.stringify({ fx: 0.4, fy: 0.6 })]),
      ),
    );
    const drags = attachTouchFrameDrags(doc, () => true, host);
    expect(drags.drags).toHaveLength(3);
    for (const id of ids) expect(els.get(id)?.classes.has(TOUCH_PLACED_CLASS), id).toBe(true);
    drags.resetAll();
    for (const id of ids) expect(els.get(id)?.classes.size, id).toBe(0);
    expect(host.store.size).toBe(0);
  });

  it('threads the layout probe into every attached drag, so each frame really drags on touch', () => {
    const ids = TOUCH_DRAG_FRAMES.map((row) => row.elementId);
    const { els, doc } = fakeDocument(ids);
    let touch = false;
    const host = fakeHost();
    const drags = attachTouchFrameDrags(doc, () => touch, host);
    const doom = els.get('warlock-doom-frame') as FakeEl;
    // Desktop: refused.
    doom.fire('pointerdown', pointer(130, 123));
    doom.fire('pointermove', pointer(400, 200));
    doom.fire('pointerup', pointer(400, 200));
    expect(drags.drags[2]?.anchor).toBeNull();
    // Touch: the doom meter moves and persists under its own key.
    touch = true;
    doom.fire('pointerdown', pointer(130, 123));
    doom.fire('pointermove', pointer(400, 200));
    doom.fire('pointerup', pointer(400, 200));
    expect(drags.drags[2]?.anchor).toEqual({ fx: 400 / 844, fy: 200 / 390 });
    expect(JSON.parse(host.store.get('warlockDoomAnchor') ?? '')).toEqual({
      fx: 400 / 844,
      fy: 200 / 390,
    });
    expect(host.store.size).toBe(1);
  });

  it('skips a frame missing from the document, like the unlock registry does', () => {
    const { doc } = fakeDocument(['proc-overlay']);
    const drags = attachTouchFrameDrags(doc, () => true, fakeHost());
    expect(drags.drags).toHaveLength(1);
    expect(() => drags.resetAll()).not.toThrow();
  });
});

// The stylesheet half of the contract: the attacher writes only the classes
// and the two custom properties, so the touch layer must (a) hand pointer
// events back and pin touch-action on the grabbable states, (b) place a
// stamped frame from those properties by its CENTER (its own translate, never
// inherited: a gamepad-mode rule anchors the medallion by its top edge and
// the detached class nulls the translate), the doom meter re-anchored off its
// bottom seat, (c) dress the frame under a live finger, and (d) dress the
// inset probe the browser host mints.
describe('the touch layer places a stamped engine indicator', () => {
  const mobileCss = readFileSync(new URL('../src/styles/hud.mobile.css', import.meta.url), 'utf8');
  /** Source with comments removed, so a commented-out line cannot satisfy a pin. */
  const stripComments = (source: string): string =>
    source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
  const hudTs = stripComments(readFileSync(new URL('../src/ui/hud.ts', import.meta.url), 'utf8'));

  it('hands pointer events back on the lit phoenix, the warlock artwork, the medallion and the doom meter', () => {
    const block = mobileCss.match(
      /body\.mobile-touch #proc-overlay\.preview,[\s\S]*?body\.mobile-touch \.warlock-doom-frame \{([^}]*)\}/,
    );
    expect(block).not.toBeNull();
    const selectors = block?.[0] ?? '';
    for (const lit of [
      '#proc-overlay.heating',
      '#proc-overlay.hot',
      '#proc-overlay.combustion',
      '#proc-overlay.chrono.c1',
      '#proc-overlay.frost.f1',
      '#proc-overlay.necromancy .soul-rail',
      '#proc-overlay.necromancy .soul-crystal',
      '#proc-overlay.destruction .ruin-ritual',
      '#proc-overlay.destruction .ruin-mark',
      '.paladin-devotion-frame',
      '.warlock-doom-frame',
    ])
      expect(selectors, lit).toContain(`body.mobile-touch ${lit}`);
    const body = block?.[1] ?? '';
    expect(body).toContain('pointer-events: auto;');
    expect(body).toContain('touch-action: none;');
    // A hybrid device with a fine pointer still gets the move affordance.
    expect(body).toContain('cursor: var(--cursor-move, move);');
    expect(body).toContain('-webkit-touch-callout: none;');
  });

  it('places the proc overlay and the medallion by their center from the anchor properties', () => {
    expect(mobileCss).toMatch(
      new RegExp(
        `body\\.mobile-touch #proc-overlay\\.${TOUCH_PLACED_CLASS},\\s*body\\.mobile-touch \\.paladin-devotion-frame\\.${TOUCH_PLACED_CLASS} \\{\\s*left: var\\(${TOUCH_ANCHOR_X_PROP}\\);\\s*top: var\\(${TOUCH_ANCHOR_Y_PROP}\\);\\s*translate: -50% -50%;\\s*\\}`,
      ),
    );
  });

  it('re-anchors the doom meter off its bottom seat and centres it on both axes', () => {
    expect(mobileCss).toMatch(
      new RegExp(
        `body\\.mobile-touch \\.warlock-doom-frame\\.${TOUCH_PLACED_CLASS} \\{\\s*left: var\\(${TOUCH_ANCHOR_X_PROP}\\);\\s*top: var\\(${TOUCH_ANCHOR_Y_PROP}\\);\\s*bottom: auto;\\s*transform: translate\\(-50%, -50%\\);\\s*\\}`,
      ),
    );
  });

  it('dresses the frame under a live finger with the editor outline', () => {
    expect(mobileCss).toMatch(
      new RegExp(
        `body\\.mobile-touch \\.${TOUCH_DRAGGING_CLASS} \\{\\s*outline: 1px dashed var\\(--gold\\);\\s*outline-offset: -1px;\\s*\\}`,
      ),
    );
  });

  it('dresses the inset probe from the stylesheet, not inline styles', () => {
    expect(mobileCss).toMatch(
      new RegExp(
        `\\.${SAFE_AREA_PROBE_CLASS} \\{\\s*position: fixed;\\s*inset: 0;\\s*padding: env\\(safe-area-inset-top, 0px\\) env\\(safe-area-inset-right, 0px\\)\\s*env\\(safe-area-inset-bottom, 0px\\) env\\(safe-area-inset-left, 0px\\);\\s*visibility: hidden;\\s*pointer-events: none;\\s*\\}`,
      ),
    );
    const attacher = stripComments(
      readFileSync(new URL('../src/ui/touch_frame_drag.ts', import.meta.url), 'utf8'),
    );
    expect(attacher).toContain('probe.className = SAFE_AREA_PROBE_CLASS;');
    expect(attacher).not.toContain('probe.style');
  });

  it('is attached by the Hud beside the desktop editor and reset with the layout', () => {
    expect(hudTs).toContain(
      'this.touchFrameDrags = attachTouchFrameDrags(document, isMobileLayout);',
    );
    const reset = hudTs.slice(hudTs.indexOf('resetUnitFrames(): void {'));
    expect(reset.slice(0, reset.indexOf('\n  }\n'))).toContain('this.touchFrameDrags?.resetAll();');
  });
});
