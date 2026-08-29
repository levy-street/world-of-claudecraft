// MovableFrame (src/ui/movable_frame.ts): the shared movable / lockable
// unit-frame controller behind the target AND player frames. These pin the
// contract the player-frame instance leans on: the corner button toggles the
// unlocked state (aria-pressed + tf-unlocked), a drag only works unlocked and
// on the desktop layout, a completed drag persists the clamped spot, and the
// onPositioned hook fires true while a custom position applies on desktop and
// false on the mobile layout (which also clears the inline position). The second
// describe covers the `scalable` config the "Unlock interface" frames use, whose
// SE grip is a real button carrying the arrow-key resize (the keyboard path that
// pairs with the move button's arrow-key positioning). Per the repo testing
// convention this drives a small hand-rolled fake DOM stubbed on globalThis (no
// jsdom).
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  FRAME_SCALE_KEY_FINE_STEP,
  FRAME_SCALE_KEY_STEP,
  FRAME_SCALE_MAX,
  FRAME_SCALE_MIN,
} from '../src/ui/target_frame_pos';

type Listener = (ev: unknown) => void;

class FakeClassList {
  private set = new Set<string>();
  add(c: string): void {
    this.set.add(c);
  }
  remove(c: string): void {
    this.set.delete(c);
  }
  toggle(c: string, force?: boolean): boolean {
    const on = force ?? !this.set.has(c);
    if (on) this.set.add(c);
    else this.set.delete(c);
    return on;
  }
  contains(c: string): boolean {
    return this.set.has(c);
  }
}

class FakeStyle {
  props = new Map<string, string>();
  removeProperty(p: string): void {
    this.props.delete(p);
  }
  set left(v: string) {
    this.props.set('left', v);
  }
  get left(): string {
    return this.props.get('left') ?? '';
  }
  set top(v: string) {
    this.props.set('top', v);
  }
  get top(): string {
    return this.props.get('top') ?? '';
  }
  set right(v: string) {
    this.props.set('right', v);
  }
  get right(): string {
    return this.props.get('right') ?? '';
  }
  set bottom(v: string) {
    this.props.set('bottom', v);
  }
  get bottom(): string {
    return this.props.get('bottom') ?? '';
  }
  // The scale half of a `scalable` frame: the controller writes both of these
  // whenever a position applies, and reset() removes them by name.
  set transform(v: string) {
    this.props.set('transform', v);
  }
  get transform(): string {
    return this.props.get('transform') ?? '';
  }
  set transformOrigin(v: string) {
    this.props.set('transform-origin', v);
  }
  get transformOrigin(): string {
    return this.props.get('transform-origin') ?? '';
  }
  // The edge-resize hover affordance: '' clears the inline value like the DOM.
  set cursor(v: string) {
    if (v === '') this.props.delete('cursor');
    else this.props.set('cursor', v);
  }
  get cursor(): string {
    return this.props.get('cursor') ?? '';
  }
  // The layout-stretch half of a scalable frame: side edges write a real box.
  set width(v: string) {
    this.props.set('width', v);
  }
  get width(): string {
    return this.props.get('width') ?? '';
  }
  set height(v: string) {
    this.props.set('height', v);
  }
  get height(): string {
    return this.props.get('height') ?? '';
  }
}

class FakeEl {
  children: FakeEl[] = [];
  parentElement: FakeEl | null = null;
  classList = new FakeClassList();
  style = new FakeStyle();
  attrs = new Map<string, string>();
  title = '';
  type = '';
  className = '';
  hidden = false;
  rect = { left: 40, top: 500, width: 612, height: 84 };
  private listeners = new Map<string, Listener[]>();

  appendChild(c: FakeEl): void {
    c.parentElement = this;
    this.children.push(c);
  }
  addEventListener(type: string, fn: Listener): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }
  dispatch(type: string, ev: unknown): void {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
  removeAttribute(k: string): void {
    this.attrs.delete(k);
  }
  setAttribute(k: string, v: string): void {
    this.attrs.set(k, v);
  }
  getAttribute(k: string): string | null {
    return this.attrs.get(k) ?? null;
  }
  getBoundingClientRect() {
    const r = this.rect;
    return { ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top };
  }
  setPointerCapture(): void {}
  closest(): null {
    // event targets in these tests are never inside a button
    return null;
  }
}

// Document-level listeners are recorded persistently AND attached to the
// current body (tests dispatch document events via fakeDocument.body): the
// controller arms its shared dispatcher ONCE per document, while this harness
// swaps the body per test, so beforeEach re-attaches the recorded listeners
// to each fresh body.
const docListeners: Array<[string, Listener]> = [];
const fakeDocument = {
  body: new FakeEl(),
  createElement: () => new FakeEl(),
  addEventListener: (type: string, fn: Listener) => {
    docListeners.push([type, fn]);
    fakeDocument.body.addEventListener(type, fn);
  },
};
const fakeWindow = {
  innerWidth: 1600,
  innerHeight: 900,
  // Captured so the viewport-resize tests can fire the controller's handler.
  resizeListeners: [] as Array<() => void>,
  addEventListener: (type: string, fn: () => void) => {
    if (type === 'resize') fakeWindow.resizeListeners.push(fn);
  },
  fireResize: () => {
    for (const fn of [...fakeWindow.resizeListeners]) fn();
  },
};
const store = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
};

// The live UI Scale getUiScale() reads back through getComputedStyle('--ui-scale').
// Default 1 keeps every existing assertion (scale is a no-op); one test drives it
// to 1.25 to prove the drag write is divided into #ui author space.
let uiScaleStub = 1;

// biome-ignore lint/suspicious/noExplicitAny: module handle loaded after the globals exist
let MovableFrame: any;
// Flipped by the snap tests and read through each config's snapToGrid dep;
// beforeEach resets it so other drags stay exact.
let snapOn = false;

beforeAll(async () => {
  (globalThis as Record<string, unknown>).document = fakeDocument;
  (globalThis as Record<string, unknown>).window = fakeWindow;
  (globalThis as Record<string, unknown>).localStorage = fakeStorage;
  (globalThis as Record<string, unknown>).getComputedStyle = () => ({
    getPropertyValue: (p: string) => (p === '--ui-scale' ? String(uiScaleStub) : ''),
  });
  ({ MovableFrame } = await import('../src/ui/movable_frame'));
}, 30_000);

beforeEach(() => {
  store.clear();
  uiScaleStub = 1;
  snapOn = false;
  fakeDocument.body = new FakeEl();
  for (const [type, fn] of docListeners) fakeDocument.body.addEventListener(type, fn);
  // The shared dispatcher arms its ONE window resize listener the first time
  // a frame is built for this document; it must survive across tests.
  fakeWindow.innerWidth = 1600;
  fakeWindow.innerHeight = 900;
});

const KEY = 'woc_test_frame_pos';

function makeFrame(opts: { mobile?: boolean; positioned?: Array<boolean> } = {}) {
  const frame = new FakeEl();
  const positioned: boolean[] = opts.positioned ?? [];
  const mover = new MovableFrame({
    frame,
    storageKey: KEY,
    unlockLabelKey: 'hudChrome.playerFrame.unlock',
    lockLabelKey: 'hudChrome.playerFrame.lock',
    draggingBodyClass: 'player-frame-dragging',
    fallbackSize: { w: 260, h: 84 },
    isMobileLayout: () => opts.mobile ?? false,
    snapToGrid: () => snapOn,
    onPositioned: (active: boolean) => positioned.push(active),
  });
  const btn = frame.children[0];
  return { frame, btn, mover, positioned };
}

// A frame in the "Unlock interface" shape: no permanent chrome, and the SE grip
// that carries BOTH resize gestures (pointer drag and arrow keys).
function makeScalableFrame(opts: { mobile?: boolean } = {}) {
  const frame = new FakeEl();
  const mover = new MovableFrame({
    frame,
    storageKey: KEY,
    unlockLabelKey: 'hudChrome.interfaceUnlock.unlockFrame',
    lockLabelKey: 'hudChrome.interfaceUnlock.lockFrame',
    resizeLabelKey: 'hudChrome.interfaceUnlock.resizeFrame',
    draggingBodyClass: 'hud-frame-dragging',
    fallbackSize: { w: 260, h: 84 },
    isMobileLayout: () => opts.mobile ?? false,
    snapToGrid: () => snapOn,
    scalable: true,
    buttonOnlyWhenUnlocked: true,
  });
  const btn = frame.children[0];
  const grip = frame.children[1];
  return { frame, btn, grip, mover };
}

function key(k: string, overrides: Record<string, unknown> = {}) {
  return { key: k, shiftKey: false, preventDefault() {}, stopPropagation() {}, ...overrides };
}

function scaleOf(frame: FakeEl): number {
  const m = /scale\(([-\d.]+)\)/.exec(frame.style.transform);
  return m ? Number(m[1]) : Number.NaN;
}

function pointer(overrides: Record<string, unknown> = {}) {
  return {
    button: 0,
    pointerId: 7,
    clientX: 100,
    clientY: 520,
    target: new FakeEl(),
    preventDefault() {},
    stopPropagation() {},
    ...overrides,
  };
}

describe('MovableFrame', () => {
  it('builds the corner button locked, and a click toggles unlock + aria-pressed', () => {
    const { frame, btn } = makeFrame();
    expect(btn.className).toBe('tf-move-btn');
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(btn.getAttribute('aria-keyshortcuts')).toBe('ArrowUp ArrowDown ArrowLeft ArrowRight');
    expect(frame.classList.contains('tf-unlocked')).toBe(false);

    btn.dispatch('click', pointer());
    expect(btn.getAttribute('aria-pressed')).toBe('true');
    expect(btn.classList.contains('active')).toBe(true);
    expect(frame.classList.contains('tf-unlocked')).toBe(true);
    // the labels resolve through t() and swap with the state
    expect(btn.title.length).toBeGreaterThan(0);

    btn.dispatch('click', pointer());
    expect(btn.getAttribute('aria-pressed')).toBe('false');
    expect(frame.classList.contains('tf-unlocked')).toBe(false);
  });

  it('moves and persists with arrow keys while unlocked', () => {
    const { frame, btn, positioned } = makeFrame();
    btn.dispatch('click', pointer());

    let prevented = false;
    btn.dispatch('keydown', {
      key: 'ArrowRight',
      shiftKey: false,
      preventDefault: () => {
        prevented = true;
      },
      stopPropagation() {},
    });

    expect(prevented).toBe(true);
    expect(frame.style.left).toBe('50px');
    expect(frame.style.top).toBe('500px');
    expect(positioned).toContain(true);
    expect(JSON.parse(store.get(KEY) ?? '{}')).toEqual({ left: 50, top: 500, vw: 1600, vh: 900 });

    btn.dispatch('keydown', {
      key: 'ArrowUp',
      shiftKey: true,
      preventDefault() {},
      stopPropagation() {},
    });
    expect(frame.style.top).toBe('499px');
    expect(JSON.parse(store.get(KEY) ?? '{}')).toEqual({ left: 50, top: 499, vw: 1600, vh: 900 });
  });

  it('Snap to Grid lands a drag on the shared 16px grid, and only positions snap', () => {
    snapOn = true;
    const { frame, btn } = makeFrame();
    btn.dispatch('click', pointer()); // unlock
    frame.dispatch('pointerdown', pointer({ clientX: 100, clientY: 520 }));
    // grab offset (60,20); moving to (503,327) would land at (443,307) raw,
    // which the grid rounds to (448,304).
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: 503, clientY: 327 }));
    expect(frame.style.left).toBe('448px');
    expect(frame.style.top).toBe('304px');
    fakeDocument.body.dispatch('pointerup', pointer());
    expect(JSON.parse(store.get(KEY) ?? '{}')).toEqual({ left: 448, top: 304, vw: 1600, vh: 900 });
  });

  it('ignores a drag while locked, and on the mobile layout even when unlocked', () => {
    const locked = makeFrame();
    locked.frame.dispatch('pointerdown', pointer());
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: 300, clientY: 300 }));
    expect(locked.frame.style.props.has('left')).toBe(false);
    expect(locked.positioned).toEqual([]);

    const mobile = makeFrame({ mobile: true });
    mobile.btn.dispatch('click', pointer()); // unlock
    mobile.frame.dispatch('pointerdown', pointer());
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: 300, clientY: 300 }));
    expect(mobile.frame.style.props.has('left')).toBe(false);
    expect(mobile.positioned).toEqual([]);
  });

  it('unlocked drag applies + persists the clamped spot and fires onPositioned(true)', () => {
    const { frame, btn, positioned } = makeFrame();
    btn.dispatch('click', pointer()); // unlock
    frame.dispatch('pointerdown', pointer({ clientX: 100, clientY: 520 }));
    expect(fakeDocument.body.classList.contains('player-frame-dragging')).toBe(true);
    // grab offset = pointer - frame rect (40,500) = (60,20); move to (500,320)
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: 500, clientY: 320 }));
    expect(frame.style.left).toBe('440px');
    expect(frame.style.top).toBe('300px');
    expect(frame.style.right).toBe('auto');
    expect(positioned).toContain(true);
    fakeDocument.body.dispatch('pointerup', pointer());
    expect(fakeDocument.body.classList.contains('player-frame-dragging')).toBe(false);
    expect(JSON.parse(store.get(KEY) ?? '{}')).toEqual({ left: 440, top: 300, vw: 1600, vh: 900 });
  });

  it('at UI Scale 1.25 the drag write is divided into #ui author space, persisted spot is not', () => {
    uiScaleStub = 1.25;
    const { frame, btn } = makeFrame();
    btn.dispatch('click', pointer()); // unlock
    // rect (40,500) â†’ grab offset (60,20); move the pointer to (500,320) so the
    // frame's VISUAL top-left tracks to (440,300) under the cursor.
    frame.dispatch('pointerdown', pointer({ clientX: 100, clientY: 520 }));
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: 500, clientY: 320 }));
    // style.left/top are author lengths #ui's zoom re-multiplies: 440/1.25, 300/1.25.
    expect(frame.style.left).toBe('352px');
    expect(frame.style.top).toBe('240px');
    // The persisted spot stays in visual space (unchanged vs scale 1) so it renders
    // at the same visual place after a reload at any UI Scale.
    fakeDocument.body.dispatch('pointerup', pointer());
    expect(JSON.parse(store.get(KEY) ?? '{}')).toEqual({ left: 440, top: 300, vw: 1600, vh: 900 });
  });

  it('reapplies a persisted visual position immediately when UI Scale changes live', () => {
    store.set(KEY, JSON.stringify({ left: 300, top: 200 }));
    const { frame, mover } = makeFrame();
    expect(frame.style.left).toBe('300px');
    expect(frame.style.top).toBe('200px');

    uiScaleStub = 1.25;
    mover.reapplyPosition();

    expect(frame.style.left).toBe('240px');
    expect(frame.style.top).toBe('160px');
    // reapplyPosition never persists; the one write is the construction-time
    // MIGRATION that stamped the legacy payload with the boot viewport.
    expect(JSON.parse(store.get(KEY) ?? '{}')).toEqual({ left: 300, top: 200, vw: 1600, vh: 900 });
  });

  it('a drag is clamped inside the viewport margin', () => {
    const { frame, btn } = makeFrame();
    btn.dispatch('click', pointer());
    frame.dispatch('pointerdown', pointer({ clientX: 100, clientY: 520 }));
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: -500, clientY: -500 }));
    // clamped to the 8px margin, never negative / off-screen
    expect(frame.style.left).toBe('8px');
    expect(frame.style.top).toBe('8px');
  });

  it('restores a saved desktop spot at construction (onPositioned(true) + inline px)', () => {
    store.set(KEY, JSON.stringify({ left: 300, top: 200 }));
    const { frame, positioned } = makeFrame();
    expect(frame.style.left).toBe('300px');
    expect(frame.style.top).toBe('200px');
    expect(positioned).toEqual([true]);
  });

  it('on the mobile layout a saved spot clears the inline position and re-docks', () => {
    store.set(KEY, JSON.stringify({ left: 300, top: 200 }));
    const { frame, positioned } = makeFrame({ mobile: true });
    // the mobile branch strips any inline position so the mobile stylesheet owns
    // the frame again, and tells the host to re-dock (onPositioned(false))
    expect(frame.style.props.has('left')).toBe(false);
    expect(frame.style.props.has('top')).toBe(false);
    expect(positioned).toEqual([false]);
  });

  it('reset() forgets the saved spot, clears inline styles, re-docks, and locks', () => {
    const { frame, btn, mover, positioned } = makeFrame();
    btn.dispatch('click', pointer()); // unlock
    frame.dispatch('pointerdown', pointer({ clientX: 100, clientY: 520 }));
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: 500, clientY: 320 }));
    fakeDocument.body.dispatch('pointerup', pointer());
    expect(store.has(KEY)).toBe(true);

    mover.reset();
    expect(store.has(KEY)).toBe(false);
    expect(frame.style.props.size).toBe(0); // inline left/top/right/bottom gone
    expect(positioned.at(-1)).toBe(false); // the host re-docked the frame
    expect(btn.getAttribute('aria-pressed')).toBe('false'); // locked again
    expect(frame.classList.contains('tf-unlocked')).toBe(false);

    // and a stale drag gesture cannot resurrect the old spot after a reset
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: 900, clientY: 700 }));
    expect(frame.style.props.size).toBe(0);
  });

  it('falls back to the CSS default on corrupt saved data', () => {
    store.set(KEY, '{not json');
    const { frame, positioned } = makeFrame();
    expect(frame.style.props.size).toBe(0);
    expect(positioned).toEqual([]);
  });
});

// The resize grip on a `scalable` frame is the ONLY route to a frame's size, so
// it holds the same keyboard contract the move button does: a real named button,
// out of the tab order while locked, and arrow-key operable while unlocked. It
// shipped pointer-only and aria-hidden, which left a keyboard-only or
// screen-reader player able to unlock and move every HUD frame but resize none.
describe('MovableFrame resize grip', () => {
  it('is a real named button, never an aria-hidden pointer-only affordance', () => {
    const { grip } = makeScalableFrame();
    expect(grip.className).toBe('panel-resize-grip mf-resize-grip');
    expect(grip.type).toBe('button');
    expect(grip.getAttribute('aria-hidden')).toBe(null);
    // it is announced by a real accessible name, not by the tooltip alone
    expect(grip.getAttribute('aria-label')).toBe(grip.title);
    expect((grip.getAttribute('aria-label') ?? '').length).toBeGreaterThan(0);
    expect(grip.getAttribute('aria-keyshortcuts')).toBe('ArrowUp ArrowDown ArrowLeft ArrowRight');
  });

  it('leaves the tab order while the frame is locked and rejoins it when unlocked', () => {
    const { btn, grip } = makeScalableFrame();
    expect(grip.hidden).toBe(true);
    btn.dispatch('click', pointer());
    expect(grip.hidden).toBe(false);
    btn.dispatch('click', pointer());
    expect(grip.hidden).toBe(true);
  });

  it('resizes and persists with arrow keys while unlocked, Shift for the fine step', () => {
    const { frame, btn, grip } = makeScalableFrame();
    btn.dispatch('click', pointer());

    let prevented = false;
    grip.dispatch(
      'keydown',
      key('ArrowRight', {
        preventDefault: () => {
          prevented = true;
        },
      }),
    );
    expect(prevented).toBe(true);
    expect(scaleOf(frame)).toBeCloseTo(1 + FRAME_SCALE_KEY_STEP, 9);
    expect(frame.style.transformOrigin).toBe('top left');
    expect(JSON.parse(store.get(KEY) ?? '{}').scale).toBeCloseTo(1 + FRAME_SCALE_KEY_STEP, 9);

    // ArrowDown grows too (the grip travels down-right to grow), ArrowUp/Left shrink
    grip.dispatch('keydown', key('ArrowDown'));
    expect(scaleOf(frame)).toBeCloseTo(1 + 2 * FRAME_SCALE_KEY_STEP, 9);
    grip.dispatch('keydown', key('ArrowLeft'));
    grip.dispatch('keydown', key('ArrowUp'));
    expect(scaleOf(frame)).toBeCloseTo(1, 9);

    grip.dispatch('keydown', key('ArrowRight', { shiftKey: true }));
    expect(scaleOf(frame)).toBeCloseTo(1 + FRAME_SCALE_KEY_FINE_STEP, 9);
    expect(JSON.parse(store.get(KEY) ?? '{}').scale).toBeCloseTo(1 + FRAME_SCALE_KEY_FINE_STEP, 9);
  });

  it('keeps the frame position while resizing, and its size while moving', () => {
    const { frame, btn, grip } = makeScalableFrame();
    btn.dispatch('click', pointer());
    btn.dispatch('keydown', key('ArrowRight'));
    expect(frame.style.left).toBe('50px');

    grip.dispatch('keydown', key('ArrowRight'));
    // resizing does not walk the frame away from where it was put
    expect(JSON.parse(store.get(KEY) ?? '{}')).toEqual({
      vw: 1600,
      vh: 900,
      left: 50,
      top: 500,
      scale: 1 + FRAME_SCALE_KEY_STEP,
    });

    // and a later move keeps the chosen size rather than resetting it
    btn.dispatch('keydown', key('ArrowDown'));
    expect(JSON.parse(store.get(KEY) ?? '{}')).toEqual({
      vw: 1600,
      vh: 900,
      left: 50,
      top: 510,
      scale: 1 + FRAME_SCALE_KEY_STEP,
    });
  });

  it('ignores an arrow key while locked, and on the mobile layout even when unlocked', () => {
    const locked = makeScalableFrame();
    locked.grip.dispatch('keydown', key('ArrowRight'));
    expect(locked.frame.style.props.has('transform')).toBe(false);
    expect(store.has(KEY)).toBe(false);

    const mobile = makeScalableFrame({ mobile: true });
    mobile.btn.dispatch('click', pointer()); // unlock
    mobile.grip.dispatch('keydown', key('ArrowRight'));
    expect(mobile.frame.style.props.has('transform')).toBe(false);
    expect(store.has(KEY)).toBe(false);
  });

  it('ignores a key it does not own, so Tab and Escape still reach the browser', () => {
    const { frame, btn, grip } = makeScalableFrame();
    btn.dispatch('click', pointer());
    for (const k of ['Tab', 'Escape', 'Enter', ' ']) {
      let prevented = false;
      grip.dispatch(
        'keydown',
        key(k, {
          preventDefault: () => {
            prevented = true;
          },
        }),
      );
      expect(prevented).toBe(false);
    }
    expect(frame.style.props.has('transform')).toBe(false);
  });

  it('a key resize is clamped into the legal band at both ends', () => {
    const { frame, btn, grip } = makeScalableFrame();
    btn.dispatch('click', pointer());
    for (let i = 0; i < 60; i++) grip.dispatch('keydown', key('ArrowRight'));
    expect(scaleOf(frame)).toBe(FRAME_SCALE_MAX);
    for (let i = 0; i < 60; i++) grip.dispatch('keydown', key('ArrowLeft'));
    expect(scaleOf(frame)).toBe(FRAME_SCALE_MIN);
  });

  it('relocalize() re-resolves the grip name, not only the move button', () => {
    const { grip, mover } = makeScalableFrame();
    grip.setAttribute('aria-label', 'stale');
    grip.title = 'stale';
    mover.relocalize();
    expect(grip.getAttribute('aria-label')).not.toBe('stale');
    expect(grip.title).toBe(grip.getAttribute('aria-label'));
  });

  it('reset() clears the chosen size along with the position', () => {
    const { frame, btn, grip, mover } = makeScalableFrame();
    btn.dispatch('click', pointer());
    grip.dispatch('keydown', key('ArrowRight'));
    expect(frame.style.props.has('transform')).toBe(true);

    mover.reset();
    expect(frame.style.props.size).toBe(0);
    expect(store.has(KEY)).toBe(false);
    expect(grip.hidden).toBe(true);
  });
});

// The desktop-window resize contract on a scalable frame: hovering a border
// shows the matching resize cursor, and dragging a border resizes with the
// OPPOSITE border anchored, so a west pull grows leftward without the right
// edge moving. The frame rect is (40,500 612x84), so the west band is x 40..48
// and the east band x 644..652.
describe('MovableFrame edge resize', () => {
  function makeSavedScalableFrame() {
    // A saved spot away from the clamp margins so anchor math asserts exactly.
    store.set(KEY, JSON.stringify({ left: 400, top: 300 }));
    return makeScalableFrame();
  }

  it('shows the border resize cursor on hover while unlocked, and clears it on the body', () => {
    const { frame, btn } = makeScalableFrame();
    btn.dispatch('click', pointer());

    frame.dispatch('pointermove', pointer({ clientX: 648, clientY: 540 }));
    expect(frame.style.cursor).toBe('var(--cursor-resize-ew, ew-resize)');
    frame.dispatch('pointermove', pointer({ clientX: 300, clientY: 506 }));
    expect(frame.style.cursor).toBe('var(--cursor-resize-ns, ns-resize)');
    frame.dispatch('pointermove', pointer({ clientX: 42, clientY: 502 }));
    expect(frame.style.cursor).toBe('var(--cursor-resize-nwse, nwse-resize)');
    frame.dispatch('pointermove', pointer({ clientX: 300, clientY: 540 }));
    expect(frame.style.cursor).toBe('');
  });

  it('a hover jump between opposite borders repaints the highlight (shared cursor)', () => {
    const { frame, btn } = makeScalableFrame();
    btn.dispatch('click', pointer()); // unlock
    // North band then south band: both are ns-resize, so a cursor-keyed
    // elision kept the north highlight painted while the pointer sat south.
    frame.dispatch('pointermove', pointer({ clientX: 300, clientY: 502 }));
    expect(frame.getAttribute('data-resize-edge')).toBe('n');
    frame.dispatch('pointermove', pointer({ clientX: 300, clientY: 582 }));
    expect(frame.getAttribute('data-resize-edge')).toBe('s');
  });

  it('with Snap to Grid on the move arrows walk grid lines (Shift stays 1px)', () => {
    snapOn = true;
    store.set(KEY, JSON.stringify({ left: 105, top: 210, vw: 1600, vh: 900 }));
    const { frame, btn } = makeFrame();
    btn.dispatch('click', pointer()); // unlock
    btn.dispatch('keydown', key('ArrowRight'));
    expect(frame.style.left).toBe('112px');
    btn.dispatch('keydown', key('ArrowDown'));
    expect(frame.style.top).toBe('224px');
    btn.dispatch('keydown', key('ArrowRight', { shiftKey: true }));
    expect(frame.style.left).toBe('113px');
  });

  it('with Snap to Grid on the grip arrows land the visual size on grid lines', () => {
    snapOn = true;
    const { frame, btn, grip } = makeSavedScalableFrame();
    btn.dispatch('click', pointer()); // unlock
    // rect width 612 at scale 1: the next grid line up is 624.
    grip.dispatch('keydown', key('ArrowRight'));
    const m = /scale\(([-\d.]+)/.exec(frame.style.transform);
    expect(m).toBeTruthy();
    if (!m) return;
    expect(Number(m[1]) * 612).toBeCloseTo(624, 6);
  });

  it('stamps the hovered edge on the frame and mints the overlay highlight child', () => {
    const { frame, btn } = makeScalableFrame();
    // A scalable frame carries the .tf-edge-glow overlay the stylesheet
    // paints the per-side highlight on, stacked over the frame's content.
    expect(frame.children.some((c) => c.className === 'tf-edge-glow')).toBe(true);

    btn.dispatch('click', pointer()); // unlock
    frame.dispatch('pointermove', pointer({ clientX: 42, clientY: 540 }));
    expect(frame.getAttribute('data-resize-edge')).toBe('w');
    frame.dispatch('pointermove', pointer({ clientX: 300, clientY: 540 }));
    expect(frame.getAttribute('data-resize-edge')).toBeNull();
  });

  it('returning to the approach band after a grip visit repaints its highlight', () => {
    const { frame, btn, grip } = makeScalableFrame();
    btn.dispatch('click', pointer()); // unlock
    // Hover the east band (the grip's approach path), slide onto the grip,
    // slide back: the leave handler must clear the hover MEMO with the
    // attribute, or the east band stays elided and its glow never repaints.
    frame.dispatch('pointermove', pointer({ clientX: 648, clientY: 540 }));
    expect(frame.getAttribute('data-resize-edge')).toBe('e');
    grip.dispatch('pointerenter', pointer());
    expect(frame.getAttribute('data-resize-edge')).toBe('se');
    grip.dispatch('pointerleave', pointer());
    frame.dispatch('pointermove', pointer({ clientX: 648, clientY: 540 }));
    expect(frame.getAttribute('data-resize-edge')).toBe('e');
  });

  it('hovering the corner grip lights the two edges it resizes (right and bottom)', () => {
    const { frame, btn, grip } = makeScalableFrame();
    btn.dispatch('click', pointer()); // unlock
    grip.dispatch('pointerenter', pointer());
    expect(frame.getAttribute('data-resize-edge')).toBe('se');
    // A pointermove BUBBLING through the frame from the grip must not clear
    // the pair: the grip's center sits inside the border band's dead zone,
    // and the frame's own hover hit test yields there.
    frame.dispatch('pointermove', pointer({ clientX: 640, clientY: 573, target: grip }));
    expect(frame.getAttribute('data-resize-edge')).toBe('se');
    grip.dispatch('pointerleave', pointer());
    expect(frame.getAttribute('data-resize-edge')).toBeNull();

    // Locked (or mobile) the grip hover stamps nothing.
    btn.dispatch('click', pointer()); // lock again
    grip.dispatch('pointerenter', pointer());
    expect(frame.getAttribute('data-resize-edge')).toBeNull();
  });

  it('shows no resize cursor while locked, and clears a live one on lock', () => {
    const { frame, btn } = makeScalableFrame();
    frame.dispatch('pointermove', pointer({ clientX: 648, clientY: 540 }));
    expect(frame.style.cursor ?? '').toBe('');

    btn.dispatch('click', pointer()); // unlock
    frame.dispatch('pointermove', pointer({ clientX: 648, clientY: 540 }));
    expect(frame.style.cursor).toBe('var(--cursor-resize-ew, ew-resize)');
    btn.dispatch('click', pointer()); // lock mid-hover
    expect(frame.style.cursor).toBe('');
  });

  it('a west-border drag stretches WIDTH only, right border anchored', () => {
    const { frame, btn } = makeSavedScalableFrame();
    btn.dispatch('click', pointer());

    frame.dispatch('pointerdown', pointer({ clientX: 44, clientY: 540 }));
    // dx = -153 on a 612px width is a 1.25 ratio on the X axis alone (the
    // horizontal-only adjustment); the 153 new visual px all come out of the
    // left side and the height never moves.
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: -109, clientY: 540 }));
    expect(frame.style.transform).toBe('scale(1.25, 1)');
    expect(frame.style.left).toBe('247px');
    expect(frame.style.top).toBe('300px');

    fakeDocument.body.dispatch('pointerup', pointer());
    const saved = JSON.parse(store.get(KEY) ?? '{}');
    expect(saved.left).toBe(247);
    expect(saved.scaleX).toBeCloseTo(1.25, 9);
    expect(saved.scaleY).toBe(1);
  });

  it('a south-border drag stretches HEIGHT only, the vertical-only adjustment', () => {
    const { frame, btn } = makeSavedScalableFrame();
    btn.dispatch('click', pointer());

    // rect is (40,500 612x84): the south band is the bottom 8px.
    frame.dispatch('pointerdown', pointer({ clientX: 300, clientY: 580 }));
    // dy = +21 on an 84px height is a 1.25 ratio on the Y axis alone.
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: 300, clientY: 601 }));
    expect(frame.style.transform).toBe('scale(1, 1.25)');
    expect(frame.style.left).toBe('400px');
    expect(frame.style.top).toBe('300px');
  });

  it('a corner drag stays a PROPORTIONAL zoom and collapses to the scale payload', () => {
    const { frame, btn } = makeSavedScalableFrame();
    btn.dispatch('click', pointer());

    // rect corner nw is around (40,500): drag up-left grows the whole frame;
    // dx = -153 is the larger ratio (1.25) and both axes take it.
    frame.dispatch('pointerdown', pointer({ clientX: 44, clientY: 504 }));
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: -109, clientY: 494 }));
    expect(scaleOf(frame)).toBeCloseTo(1.25, 9);
    expect(frame.style.left).toBe('247px');
    expect(frame.style.top).toBe('279px');

    fakeDocument.body.dispatch('pointerup', pointer());
    const saved = JSON.parse(store.get(KEY) ?? '{}');
    expect(saved.scale).toBeCloseTo(1.25, 9);
    expect(saved.scaleX).toBeUndefined();
    expect(saved.scaleY).toBeUndefined();
  });

  it('a side drag on a BOX-mode frame writes a real layout size instead', () => {
    // The aura group and the chat box genuinely re-wrap, so their sides size
    // the box that decides the wrap, not a zoom.
    store.set(KEY, JSON.stringify({ left: 400, top: 300 }));
    const frame = new FakeEl();
    const mover = new MovableFrame({
      frame,
      storageKey: KEY,
      unlockLabelKey: 'hudChrome.interfaceUnlock.unlockFrame',
      lockLabelKey: 'hudChrome.interfaceUnlock.lockFrame',
      resizeLabelKey: 'hudChrome.interfaceUnlock.resizeFrame',
      draggingBodyClass: 'hud-frame-dragging',
      fallbackSize: { w: 260, h: 84 },
      isMobileLayout: () => false,
      snapToGrid: () => snapOn,
      scalable: true,
      resizeMode: 'box',
      buttonOnlyWhenUnlocked: true,
    });
    expect(mover).toBeTruthy();
    frame.children[0].dispatch('click', pointer());

    frame.dispatch('pointerdown', pointer({ clientX: 648, clientY: 540 }));
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: 801, clientY: 540 }));
    expect(frame.style.props.get('width')).toBe('765px');
    expect(scaleOf(frame)).toBe(1);

    fakeDocument.body.dispatch('pointerup', pointer());
    expect(JSON.parse(store.get(KEY) ?? '{}')).toEqual({
      left: 400,
      top: 300,
      w: 765,
      vw: 1600,
      vh: 900,
    });
  });

  it('Snap to Grid lands a stretched edge on the grid pitch (scale mode)', () => {
    snapOn = true;
    const { frame, btn } = makeSavedScalableFrame();
    btn.dispatch('click', pointer());

    // East band drag of +37: raw visual width 649, which the grid rounds to
    // 656; the persisted scaleX carries exactly that snapped extent.
    frame.dispatch('pointerdown', pointer({ clientX: 648, clientY: 540 }));
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: 685, clientY: 540 }));
    const m = /scale\(([-\d.]+), ([-\d.]+)\)/.exec(frame.style.transform);
    expect(m).toBeTruthy();
    if (!m) return;
    expect(Number(m[1]) * 612).toBeCloseTo(656, 6);
    expect(Number(m[2])).toBe(1);
  });

  it('Snap to Grid quantizes a box-mode stretch to the grid pitch', () => {
    snapOn = true;
    const frame = new FakeEl();
    const mover = new MovableFrame({
      frame,
      storageKey: KEY,
      unlockLabelKey: 'hudChrome.interfaceUnlock.unlockFrame',
      lockLabelKey: 'hudChrome.interfaceUnlock.lockFrame',
      resizeLabelKey: 'hudChrome.interfaceUnlock.resizeFrame',
      draggingBodyClass: 'hud-frame-dragging',
      fallbackSize: { w: 260, h: 84 },
      isMobileLayout: () => false,
      snapToGrid: () => snapOn,
      scalable: true,
      resizeMode: 'box',
      buttonOnlyWhenUnlocked: true,
    });
    expect(mover).toBeTruthy();
    store.set(KEY, JSON.stringify({ left: 400, top: 300 }));
    frame.children[0].dispatch('click', pointer());

    frame.dispatch('pointerdown', pointer({ clientX: 648, clientY: 540 }));
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: 685, clientY: 540 }));
    expect(frame.style.props.get('width')).toBe('656px');
  });

  it('a corner drag is a UNIFORM zoom that anchors the opposite corner', () => {
    const { frame, btn } = makeSavedScalableFrame();
    btn.dispatch('click', pointer());

    // rect corner nw is around (40,500): drag up-left grows the whole frame.
    frame.dispatch('pointerdown', pointer({ clientX: 44, clientY: 504 }));
    // dx = -153 gives the width ratio 1.25; dy = -10 a smaller height ratio,
    // so the larger (1.25) zooms the frame; the SE corner stays anchored.
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: -109, clientY: 494 }));
    expect(scaleOf(frame)).toBeCloseTo(1.25, 9);
    expect(frame.style.props.has('width')).toBe(false);
    expect(frame.style.left).toBe('247px');
    expect(frame.style.top).toBe('279px');

    fakeDocument.body.dispatch('pointerup', pointer());
    const saved = JSON.parse(store.get(KEY) ?? '{}');
    expect(saved.scale).toBeCloseTo(1.25, 9);
    expect(saved.w).toBeUndefined();
    expect(saved.h).toBeUndefined();
  });

  it('the resize band stays INSIDE the border, so a neighbour cannot steal it', () => {
    const { frame, btn } = makeSavedScalableFrame();
    btn.dispatch('click', pointer());

    // Just OUTSIDE the frame top is nothing: an outer halo used to reach into
    // the frame stacked above (the action bars sit 4px apart) and that
    // neighbour won the hit test, leaving the bars corner-only.
    frame.dispatch('pointermove', pointer({ clientX: 300, clientY: 495 }));
    expect(frame.style.cursor).toBe('');

    // Just inside it is the n band, and a north drag anchors the bottom.
    frame.dispatch('pointermove', pointer({ clientX: 300, clientY: 504 }));
    expect(frame.style.cursor).toBe('var(--cursor-resize-ns, ns-resize)');
    frame.dispatch('pointerdown', pointer({ clientX: 300, clientY: 504 }));
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: 300, clientY: 483 }));
    expect(frame.style.transform).toBe('scale(1, 1.25)');
    expect(frame.style.top).toBe('279px');
  });

  it('clearAppliedGeometry re-docks the frame but keeps the saved spot for later', () => {
    // The combined action bar group's lifecycle: retired shapes drop their
    // applied geometry (or a stale spot snaps the block sideways the moment the
    // option is ticked), and restoreSavedPosition is the way back.
    const { frame, mover } = makeSavedScalableFrame();
    expect(frame.style.left).toBe('400px');

    mover.clearAppliedGeometry();
    expect(frame.style.props.size).toBe(0); // every inline style gone
    expect(JSON.parse(store.get(KEY) ?? '{}').left).toBe(400); // storage kept

    // A reapply while retired must NOT resurrect the cleared position.
    mover.reapplyPosition();
    expect(frame.style.props.has('left')).toBe(false);

    mover.restoreSavedPosition();
    expect(frame.style.left).toBe('400px');
    expect(frame.style.top).toBe('300px');
  });

  it('a body press still moves rather than resizes', () => {
    const { frame, btn } = makeSavedScalableFrame();
    btn.dispatch('click', pointer());

    frame.dispatch('pointerdown', pointer({ clientX: 300, clientY: 540 }));
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: 320, clientY: 560 }));
    fakeDocument.body.dispatch('pointerup', pointer());
    // the frame moved with the pointer (grab offset against the 40,500 rect),
    // and no size multiplier was minted
    expect(frame.style.left).toBe('60px');
    expect(frame.style.top).toBe('520px');
    expect(scaleOf(frame)).toBe(1);
    expect(JSON.parse(store.get(KEY) ?? '{}').scale).toBeUndefined();
  });

  it('a border press does nothing while locked', () => {
    const { frame } = makeSavedScalableFrame();
    frame.dispatch('pointerdown', pointer({ clientX: 44, clientY: 540 }));
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: -109, clientY: 540 }));
    expect(frame.style.left).toBe('400px');
    expect(scaleOf(frame)).toBe(1);
  });

  it('a move-only frame keeps the plain move gesture on its borders', () => {
    const { frame, btn } = makeFrame();
    btn.dispatch('click', pointer());
    frame.dispatch('pointerdown', pointer({ clientX: 44, clientY: 540 }));
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: 144, clientY: 540 }));
    // dragged, not resized: the west band means nothing without `scalable`
    expect(frame.style.props.has('transform')).toBe(false);
    expect(frame.style.left).toBe('140px');
  });
});

// The arrange-mode name chip: a frame with a frameLabelKey carries a small
// always-inert span naming WHICH frame it is, resolved through t() and shown
// only while unlocked, so a force-shown placeholder is never an anonymous box.
describe('MovableFrame name chip', () => {
  function makeLabeledFrame() {
    const frame = new FakeEl();
    const mover = new MovableFrame({
      frame,
      storageKey: KEY,
      unlockLabelKey: 'hudChrome.interfaceUnlock.unlockFrame',
      lockLabelKey: 'hudChrome.interfaceUnlock.lockFrame',
      resizeLabelKey: 'hudChrome.interfaceUnlock.resizeFrame',
      frameLabelKey: 'hudChrome.interfaceUnlock.frameNames.actionBar1',
      draggingBodyClass: 'hud-frame-dragging',
      fallbackSize: { w: 260, h: 84 },
      isMobileLayout: () => false,
      snapToGrid: () => snapOn,
      scalable: true,
      buttonOnlyWhenUnlocked: true,
    });
    const btn = frame.children[0];
    const grip = frame.children[1];
    const label = frame.children[2];
    return { frame, btn, grip, label, mover };
  }

  it('appends the chip after the button and grip, resolved through t()', () => {
    const { label } = makeLabeledFrame();
    expect(label.className).toBe('tf-frame-label');
    expect((label as unknown as { textContent: string }).textContent.length).toBeGreaterThan(0);
  });

  it('is hidden while locked and joins the frame while unlocked', () => {
    const { btn, label } = makeLabeledFrame();
    expect(label.hidden).toBe(true);
    btn.dispatch('click', pointer());
    expect(label.hidden).toBe(false);
    btn.dispatch('click', pointer());
    expect(label.hidden).toBe(true);
  });

  it('relocalize() re-resolves the chip text in place', () => {
    const { label, mover } = makeLabeledFrame();
    (label as unknown as { textContent: string }).textContent = 'stale';
    mover.relocalize();
    expect((label as unknown as { textContent: string }).textContent).not.toBe('stale');
  });

  it('a frame without a frameLabelKey mints no chip', () => {
    const { frame } = makeScalableFrame();
    expect(frame.children.length).toBe(3); // button + grip + edge-glow overlay, no chip
    expect(frame.children.some((c) => c.className === 'tf-frame-label')).toBe(false);
  });
});

// The frames show/hide menu contract: setUserHidden drives the tf-user-hidden
// class the stylesheet's !important rules key on, persists beside the saved
// box, survives a reconstruction (a reload), and is undone by reset().
describe('MovableFrame user-hidden (frames menu)', () => {
  it('setUserHidden stamps the class, persists, and unhides cleanly', () => {
    const { frame, mover } = makeScalableFrame();
    expect(mover.isUserHidden).toBe(false);
    mover.setUserHidden(true);
    expect(mover.isUserHidden).toBe(true);
    expect(frame.classList.contains('tf-user-hidden')).toBe(true);
    expect(store.get(`${KEY}_hidden`)).toBe('1');
    mover.setUserHidden(false);
    expect(frame.classList.contains('tf-user-hidden')).toBe(false);
    expect(store.has(`${KEY}_hidden`)).toBe(false);
  });

  it('a persisted hidden flag reapplies on construction (a reload)', () => {
    store.set(`${KEY}_hidden`, '1');
    const { frame, mover } = makeScalableFrame();
    expect(mover.isUserHidden).toBe(true);
    expect(frame.classList.contains('tf-user-hidden')).toBe(true);
  });

  it('reset() clears the hidden choice along with the saved box', () => {
    const { frame, mover } = makeScalableFrame();
    mover.setUserHidden(true);
    mover.reset();
    expect(mover.isUserHidden).toBe(false);
    expect(frame.classList.contains('tf-user-hidden')).toBe(false);
    expect(store.has(`${KEY}_hidden`)).toBe(false);
  });
});

// Leaving fullscreen shrinks the viewport and the resize handler clamps every
// frame into view; the clamp must NOT become the new truth, or the frames are
// permanently displaced the first time the window shrinks. The handler derives
// from STORAGE, so growing the window back restores the exact saved spot.
describe('MovableFrame viewport resize (fullscreen exit)', () => {
  it('a shrink re-anchors the render, and growing back restores the SAVED spot', () => {
    // A legacy payload (no viewport stamp): construction migrates it in place,
    // stamping the boot viewport, so the resize below can re-anchor honestly.
    store.set(KEY, JSON.stringify({ left: 900, top: 100 }));
    const { frame } = makeScalableFrame();
    expect(frame.style.left).toBe('900px');
    expect(JSON.parse(store.get(KEY) ?? '{}')).toEqual({ left: 900, top: 100, vw: 1600, vh: 900 });
    // Out of fullscreen: the frame sat 88px from the RIGHT edge (1600 - 900 -
    // 612), so in the 800-wide window it keeps that distance: 800 - 612 - 88.
    fakeWindow.innerWidth = 800;
    fakeWindow.fireResize();
    expect(frame.style.left).toBe('100px');
    // The SAVED left survived the re-anchored render untouched ...
    expect(JSON.parse(store.get(KEY) ?? '{}').left).toBe(900);
    // ... so returning to fullscreen puts the frame exactly back.
    fakeWindow.innerWidth = 1600;
    fakeWindow.fireResize();
    expect(frame.style.left).toBe('900px');
  });

  it('re-anchors per axis: a bottom-right frame rides its edges across a resize', () => {
    // Saved under 1600x900, parked near the bottom-right corner (rect 612x84).
    store.set(KEY, JSON.stringify({ left: 980, top: 800, vw: 1600, vh: 900 }));
    const { frame } = makeScalableFrame();
    expect(frame.style.left).toBe('980px');
    expect(frame.style.top).toBe('800px');
    // The window shrinks (fullscreen exit): the frame keeps its distance to
    // the RIGHT and BOTTOM edges instead of its distance from the top-left.
    fakeWindow.innerWidth = 1200;
    fakeWindow.innerHeight = 700;
    fakeWindow.fireResize();
    expect(frame.style.left).toBe('580px');
    expect(frame.style.top).toBe('600px');
    // Growing back restores the exact saved spot.
    fakeWindow.innerWidth = 1600;
    fakeWindow.innerHeight = 900;
    fakeWindow.fireResize();
    expect(frame.style.left).toBe('980px');
    expect(frame.style.top).toBe('800px');
  });

  it('a spot that never reached storage keeps its in-memory position', () => {
    const { frame, mover, btn } = makeFrame();
    btn.dispatch('click', pointer());
    frame.dispatch('pointerdown', pointer({ clientX: 100, clientY: 520 }));
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: 300, clientY: 520 }));
    fakeDocument.body.dispatch('pointerup', pointer({ clientX: 300, clientY: 520 }));
    const placed = frame.style.left;
    // Storage vanishes (private browsing, a cleared site): the resize handler
    // must not blank the position it still holds in memory.
    store.clear();
    fakeWindow.fireResize();
    expect(frame.style.left).toBe(placed);
    expect(mover.isUnlocked).toBe(true);
  });
});

// resizeMode 'dimensions' (the raid-frame model, PR #3284): every resize
// gesture walks the frame's real width/height SETTINGS through the injected
// accessors instead of writing a transform, so contents reflow at crisp text
// sizes; a west/north grab anchors the opposite border by compensating
// left/top; a legacy saved stretch (scaleX/scaleY) is stripped, never
// re-applied. The unit/party movers in hud.ts wire these accessors over the
// playerFrame/targetFrame/partyFrame width+height settings.
describe('MovableFrame dimensions resize', () => {
  function makeDimensionsFrame(factors: { width?: number; height?: number } = {}) {
    const value = { width: 170, height: 42 };
    const sets = { width: [] as number[], height: [] as number[] };
    const frame = new FakeEl();
    const mover = new MovableFrame({
      frame,
      storageKey: KEY,
      unlockLabelKey: 'hudChrome.partyFrames.unlock',
      lockLabelKey: 'hudChrome.partyFrames.lock',
      resizeLabelKey: 'hudChrome.interfaceUnlock.resizeFrame',
      draggingBodyClass: 'party-frame-dragging',
      fallbackSize: { w: 360, h: 240 },
      isMobileLayout: () => false,
      snapToGrid: () => snapOn,
      scalable: true,
      resizeMode: 'dimensions',
      dimensions: {
        width: {
          get: () => value.width,
          set: (v: number) => {
            value.width = v;
            sets.width.push(v);
          },
          min: 120,
          max: 260,
          factor: factors.width === undefined ? undefined : () => factors.width as number,
        },
        height: {
          get: () => value.height,
          set: (v: number) => {
            value.height = v;
            sets.height.push(v);
          },
          min: 30,
          max: 72,
          factor: factors.height === undefined ? undefined : () => factors.height as number,
        },
      },
    });
    const btn = frame.children[0];
    const grip = frame.children[1];
    return { frame, btn, grip, mover, value, sets };
  }

  function makeSavedDimensionsFrame(factors: { width?: number; height?: number } = {}) {
    // Stamped with the current fake viewport so no re-anchor moves the spot.
    store.set(KEY, JSON.stringify({ left: 400, top: 300, vw: 1600, vh: 900 }));
    return makeDimensionsFrame(factors);
  }

  it('with Snap to Grid on the dimension arrows walk the visual extent to grid lines', () => {
    snapOn = true;
    const { value, btn, grip } = makeSavedDimensionsFrame();
    btn.dispatch('click', pointer()); // unlock
    // width 170 at factor 1: the next grid line up is 176, then 192.
    grip.dispatch('keydown', key('ArrowRight'));
    expect(value.width).toBe(176);
    grip.dispatch('keydown', key('ArrowRight'));
    expect(value.width).toBe(192);
    // Shift stays the 1px fine setting step, off-grid on purpose.
    grip.dispatch('keydown', key('ArrowRight', { shiftKey: true }));
    expect(value.width).toBe(193);
  });

  it('dispose() leaves the shared dispatcher: a live drag goes dead', () => {
    const { value, frame, btn, mover } = makeSavedDimensionsFrame();
    btn.dispatch('click', pointer()); // unlock
    frame.dispatch('pointerdown', pointer({ clientX: 650, clientY: 542 }));
    mover.dispose();
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: 690, clientY: 542 }));
    // The fanned-out move never reaches the disposed frame: the width
    // setting the drag would have written stays at its start value.
    expect(value.width).toBe(170);
  });

  it('Snap to Grid quantizes a dimension drag by its VISUAL extent', () => {
    snapOn = true;
    const { value, frame, btn } = makeSavedDimensionsFrame();
    btn.dispatch('click', pointer());

    // +37 of travel at factor 1: raw setting 207, whose visual extent snaps
    // to 208 on the 16px grid (the setting equals the visual here).
    frame.dispatch('pointerdown', pointer({ clientX: 650, clientY: 542 }));
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: 687, clientY: 542 }));
    expect(value.width).toBe(208);
  });

  it('an east-border drag writes the width SETTING and never a transform', () => {
    const { frame, btn, value, sets } = makeSavedDimensionsFrame();
    btn.dispatch('click', pointer());

    frame.dispatch('pointerdown', pointer({ clientX: 650, clientY: 542 }));
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: 690, clientY: 542 }));
    expect(value.width).toBe(210);
    expect(value.height).toBe(42);
    expect(frame.style.props.has('transform')).toBe(false);
    expect(frame.style.props.has('width')).toBe(false);

    // Persisting keeps the position clean: no scale fields, no box.
    fakeDocument.body.dispatch('pointerup', pointer({ clientX: 690, clientY: 542 }));
    expect(JSON.parse(store.get(KEY) ?? '{}')).toEqual({
      left: 400,
      top: 300,
      vw: 1600,
      vh: 900,
    });
    // Sub-pixel travel elides: one write per whole settings px at most.
    expect(sets.width.length).toBeGreaterThan(0);
    expect(new Set(sets.width).size).toBe(sets.width.length);
  });

  it('a west-border drag grows the width and anchors the RIGHT border via left', () => {
    const { frame, btn, value } = makeSavedDimensionsFrame();
    btn.dispatch('click', pointer());

    frame.dispatch('pointerdown', pointer({ clientX: 44, clientY: 542 }));
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: 14, clientY: 542 }));
    expect(value.width).toBe(200);
    // 30 new setting px at factor 1 come out of the left side.
    expect(frame.style.left).toBe('370px');
    expect(frame.style.top).toBe('300px');
  });

  it('the SE grip walks both axes through their own factors, clamped to the band', () => {
    // Width fans out over 2 columns, height over 5 rows (the party stack).
    const { grip, btn, value } = makeSavedDimensionsFrame({ width: 2, height: 5 });
    btn.dispatch('click', pointer());

    grip.dispatch('pointerdown', pointer({ clientX: 650, clientY: 582 }));
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: 690, clientY: 602 }));
    expect(value.width).toBe(190); // 40 visual px / factor 2
    expect(value.height).toBe(46); // 20 visual px / factor 5

    // A huge pull stops at each axis max instead of running away.
    fakeDocument.body.dispatch('pointermove', pointer({ clientX: 5000, clientY: 5000 }));
    expect(value.width).toBe(260);
    expect(value.height).toBe(72);
  });

  it('the grip keyboard steps the settings per axis, Shift for the fine step', () => {
    const { grip, btn, value } = makeSavedDimensionsFrame();
    btn.dispatch('click', pointer());

    grip.dispatch('keydown', key('ArrowRight'));
    expect(value.width).toBe(175);
    grip.dispatch('keydown', key('ArrowLeft', { shiftKey: true }));
    expect(value.width).toBe(174);
    grip.dispatch('keydown', key('ArrowDown'));
    expect(value.height).toBe(44);
    grip.dispatch('keydown', key('ArrowUp', { shiftKey: true }));
    expect(value.height).toBe(43);
    // The frame itself never gains a transform from keyboard sizing either.
    expect(store.get(KEY)).toBe(JSON.stringify({ left: 400, top: 300, vw: 1600, vh: 900 }));
  });

  it('strips a legacy saved stretch at load and upgrades the save in place', () => {
    // The old scale-mode payload: a real user save carried scaleX/scaleY that
    // distorted text; in dimensions mode it must neither apply nor survive.
    store.set(
      KEY,
      JSON.stringify({ left: 400, top: 300, scaleX: 1.315, scaleY: 1.425, vw: 1600, vh: 900 }),
    );
    const { frame } = makeDimensionsFrame();
    expect(frame.style.props.has('transform')).toBe(false);
    expect(JSON.parse(store.get(KEY) ?? '{}')).toEqual({
      left: 400,
      top: 300,
      vw: 1600,
      vh: 900,
    });
  });
});
