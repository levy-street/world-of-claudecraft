import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOCUSABLE_SELECTOR, FocusManager } from '../src/ui/focus_manager';

// The shared focus-manager TRAP wiring. The pure boundary math (nextFocusIndex)
// is covered by focus_order.test.ts; this file exercises the wiring the manager layers on
// top: the open/release stack, return-to-opener, focus-first (skip the close X), the
// Tab/Shift+Tab cycle (which MUST include the close X so a keyboard user can reach it),
// the "do not trap when focus is outside the window" guard that preserves the game's
// Tab-targeting, the self-heal of a leaked trap, and the listener lifecycle. The repo
// tests DOM-touching wiring with a hand-rolled fake DOM in the default node env (no
// jsdom); the real-browser axe + keyboard E2E is a separate browser suite. The fake faithfully models only
// the DOM contracts the manager uses: querySelectorAll(FOCUSABLE_SELECTOR) in document
// order, contains() ancestry, getClientRects() visibility, matches('[data-close]'), and
// focus() setting document.activeElement.

type FakeKeydown = { key: string; shiftKey: boolean; preventDefault: () => void };

class FakeHTMLElement {
  children: FakeHTMLElement[] = [];
  parent: FakeHTMLElement | null = null;
  isConnected = true;
  visible: boolean;
  focusable: boolean;
  dataClose: boolean;
  id: string;

  constructor(
    opts: { focusable?: boolean; dataClose?: boolean; visible?: boolean; id?: string } = {},
  ) {
    this.focusable = opts.focusable ?? false;
    this.dataClose = opts.dataClose ?? false;
    this.visible = opts.visible ?? true;
    this.id = opts.id ?? '';
  }

  append(...kids: FakeHTMLElement[]): this {
    for (const k of kids) {
      k.parent = this;
      this.children.push(k);
    }
    return this;
  }

  // visible -> a non-empty rect list (rendered); hidden -> [] (the manager treats a
  // zero-rect element as unfocusable, matching getClientRects().length on a real DOM).
  getClientRects(): { length: number }[] {
    return this.visible ? [{ length: 1 }] : [];
  }

  contains(el: FakeHTMLElement | null): boolean {
    for (let n: FakeHTMLElement | null = el; n; n = n.parent) if (n === this) return true;
    return false;
  }

  private descendants(): FakeHTMLElement[] {
    const out: FakeHTMLElement[] = [];
    const walk = (n: FakeHTMLElement): void => {
      for (const c of n.children) {
        out.push(c); // pre-order = document order
        walk(c);
      }
    };
    walk(this);
    return out;
  }

  querySelectorAll(sel: string): FakeHTMLElement[] {
    return sel === FOCUSABLE_SELECTOR ? this.descendants().filter((d) => d.focusable) : [];
  }

  querySelector(sel: string): FakeHTMLElement | null {
    if (sel === '#preferred') return this.descendants().find((d) => d.id === 'preferred') ?? null;
    return this.querySelectorAll(sel)[0] ?? null;
  }

  matches(sel: string): boolean {
    return sel === '[data-close]' ? this.dataClose : false;
  }

  focus(): void {
    fakeDoc.activeElement = this;
  }
}

let keydownHandler: ((e: FakeKeydown) => void) | null = null;

const fakeDoc = {
  activeElement: null as FakeHTMLElement | null,
  body: new FakeHTMLElement(),
  addEventListener(type: string, handler: (e: FakeKeydown) => void): void {
    if (type === 'keydown') keydownHandler = handler;
  },
  removeEventListener(type: string): void {
    if (type === 'keydown') keydownHandler = null;
  },
};

// setTimeout runs synchronously so focusFirst()/restore() (which defer a tick) resolve in
// the test without fake timers; the manager only schedules a single focus() call.
const fakeWin = {
  setTimeout: (fn: () => void): number => {
    fn();
    return 0;
  },
};

// The manager's API is typed against the real DOM; the fakes model only what it touches.
const el = (x: FakeHTMLElement): HTMLElement => x as unknown as HTMLElement;

function tab(shift = false): boolean {
  let prevented = false;
  keydownHandler?.({
    key: 'Tab',
    shiftKey: shift,
    preventDefault: () => {
      prevented = true;
    },
  });
  return prevented;
}

beforeEach(() => {
  keydownHandler = null;
  fakeDoc.activeElement = null;
  fakeDoc.body = new FakeHTMLElement();
  vi.stubGlobal('document', fakeDoc);
  vi.stubGlobal('window', fakeWin);
  vi.stubGlobal('HTMLElement', FakeHTMLElement);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('FocusManager.focusFirst', () => {
  it('skips the close (X) button on open and lands on the first meaningful control', () => {
    const root = new FakeHTMLElement();
    const x = new FakeHTMLElement({ focusable: true, dataClose: true });
    const a = new FakeHTMLElement({ focusable: true });
    const b = new FakeHTMLElement({ focusable: true });
    root.append(x, a, b); // X first in DOM order, but it is the dismiss affordance
    new FocusManager().focusFirst(el(root));
    expect(fakeDoc.activeElement).toBe(a);
  });

  it('falls back to the close button when it is the only focusable element', () => {
    const root = new FakeHTMLElement();
    const x = new FakeHTMLElement({ focusable: true, dataClose: true });
    root.append(x);
    new FocusManager().focusFirst(el(root));
    expect(fakeDoc.activeElement).toBe(x);
  });

  it('honors a preferred selector when it matches', () => {
    const root = new FakeHTMLElement();
    const a = new FakeHTMLElement({ focusable: true });
    const pref = new FakeHTMLElement({ focusable: true, id: 'preferred' });
    root.append(a, pref);
    new FocusManager().focusFirst(el(root), '#preferred');
    expect(fakeDoc.activeElement).toBe(pref);
  });
});

describe('FocusManager Tab trap cycle', () => {
  it('INCLUDES the close (X) button in the cycle so it is keyboard-reachable (regression fix)', () => {
    const root = new FakeHTMLElement();
    const a = new FakeHTMLElement({ focusable: true });
    const b = new FakeHTMLElement({ focusable: true });
    const x = new FakeHTMLElement({ focusable: true, dataClose: true });
    root.append(a, b, x); // X is last; native Tab order reached it before the trap existed
    const fm = new FocusManager();
    fm.open({ root: () => el(root) });
    fakeDoc.activeElement = b; // focus inside the window, on the control before the X
    expect(tab()).toBe(true); // intercepted
    expect(fakeDoc.activeElement).toBe(x); // the X (data-close) IS in the cycle
    tab(); // forward off the X wraps to the first control
    expect(fakeDoc.activeElement).toBe(a);
  });

  it('wraps backward off the first element to the last (Shift+Tab)', () => {
    const root = new FakeHTMLElement();
    const a = new FakeHTMLElement({ focusable: true });
    const b = new FakeHTMLElement({ focusable: true });
    root.append(a, b);
    new FocusManager().open({ root: () => el(root) });
    fakeDoc.activeElement = a;
    expect(tab(true)).toBe(true);
    expect(fakeDoc.activeElement).toBe(b);
  });

  it('skips a focusable element that is not rendered (zero client rects)', () => {
    const root = new FakeHTMLElement();
    const a = new FakeHTMLElement({ focusable: true });
    const hidden = new FakeHTMLElement({ focusable: true, visible: false });
    const b = new FakeHTMLElement({ focusable: true });
    root.append(a, hidden, b);
    new FocusManager().open({ root: () => el(root) });
    fakeDoc.activeElement = a;
    tab();
    expect(fakeDoc.activeElement).toBe(b); // the hidden member is not a cycle stop
  });

  it('does NOT trap Tab when focus is outside the window (game Tab-targeting preserved)', () => {
    const root = new FakeHTMLElement();
    root.append(new FakeHTMLElement({ focusable: true }));
    new FocusManager().open({ root: () => el(root) });
    const outside = new FakeHTMLElement({ focusable: true }); // not a descendant of root
    fakeDoc.activeElement = outside;
    expect(tab()).toBe(false); // not intercepted: Tab stays free for target-nearest
    expect(fakeDoc.activeElement).toBe(outside);
  });

  it('leaves non-Tab keys (Escape) alone so the single closeAll Esc path is intact', () => {
    const root = new FakeHTMLElement();
    const a = new FakeHTMLElement({ focusable: true });
    root.append(a);
    new FocusManager().open({ root: () => el(root) });
    fakeDoc.activeElement = a;
    let prevented = false;
    keydownHandler?.({
      key: 'Escape',
      shiftKey: false,
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(false); // the manager never owns Escape
  });
});

describe('FocusManager open/release stack', () => {
  it('returns focus to the recorded opener on release(true), and not on release(false)', () => {
    const opener = new FakeHTMLElement({ focusable: true });
    const root = new FakeHTMLElement();
    const a = new FakeHTMLElement({ focusable: true });
    root.append(a);

    fakeDoc.activeElement = opener; // the opener is active when the window opens
    const fm = new FocusManager();
    const returning = fm.open({ root: () => el(root) }); // captures opener
    a.focus();
    returning.release(true);
    expect(fakeDoc.activeElement).toBe(opener);

    fakeDoc.activeElement = opener;
    const keeping = fm.open({ root: () => el(root) });
    a.focus();
    keeping.release(false);
    expect(fakeDoc.activeElement).toBe(a); // focus left where it was
  });

  it('reactivates the trap beneath when the top window closes (nested modals)', () => {
    const root1 = new FakeHTMLElement();
    const a1 = new FakeHTMLElement({ focusable: true });
    root1.append(a1);
    const root2 = new FakeHTMLElement();
    const a2 = new FakeHTMLElement({ focusable: true });
    const b2 = new FakeHTMLElement({ focusable: true });
    root2.append(a2, b2);

    const fm = new FocusManager();
    fm.open({ root: () => el(root1) });
    const top = fm.open({ root: () => el(root2) });

    fakeDoc.activeElement = a2; // cycle within the top window
    tab();
    expect(fakeDoc.activeElement).toBe(b2);

    top.release(false); // close the top modal
    fakeDoc.activeElement = a1; // the window beneath is the active trap again
    expect(tab()).toBe(true);
    expect(fakeDoc.activeElement).toBe(a1); // single element wraps to itself
  });

  it('self-heals a leaked trap (window closed without release) on the next Tab and stops listening', () => {
    const root = new FakeHTMLElement();
    const a = new FakeHTMLElement({ focusable: true });
    root.append(a);
    new FocusManager().open({ root: () => el(root) });
    root.visible = false; // window torn down without calling release()
    fakeDoc.activeElement = a;
    expect(tab()).toBe(false); // the leaked trap is popped, nothing intercepts
    expect(keydownHandler).toBeNull(); // stack empty -> the document listener is removed
  });
});

describe('FocusManager listener lifecycle', () => {
  it('installs the keydown listener only while a trap is open', () => {
    const root = new FakeHTMLElement();
    root.append(new FakeHTMLElement({ focusable: true }));
    expect(keydownHandler).toBeNull(); // nothing listening before any open
    const fm = new FocusManager();
    const handle = fm.open({ root: () => el(root) });
    expect(keydownHandler).not.toBeNull(); // installed on open
    handle.release(false);
    expect(keydownHandler).toBeNull(); // removed once the stack empties
  });
});
