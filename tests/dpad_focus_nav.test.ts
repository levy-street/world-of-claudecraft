import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPadFocus,
  focusFirstInWindow,
  followDomFocus,
  moveDpadFocus,
  pressDpadFocus,
  restorePadFocus,
  syncWindowFocus,
} from '../src/game/dpad_focus_nav';

// A fake DOM modelling only what dpad_focus_nav touches: the two selector shapes
// it queries, visibility, boxes, focus and click. The shared tests/helpers/fake_dom
// has no querySelectorAll, and jsdom is not a dependency, so this follows the
// repo's hand-rolled-fake rule (tests/CLAUDE.md, "DOM in tests").
interface FakeEl {
  tag: string;
  role?: string;
  cls: string[];
  rect: { left: number; top: number; right: number; bottom: number };
  visible: boolean;
  disabled: boolean;
  clicks: number;
  classes: Set<string>;
  classList: { add(c: string): void; remove(c: string): void };
  focus(): void;
  click(): void;
  getBoundingClientRect(): {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  hasAttribute(name: string): boolean;
  attrs?: Record<string, string>;
}

let active: FakeEl | null = null;
let padCursorClasses = new Set<string>();
let padCursorStyle: Record<string, string> = {};
let allEls: FakeEl[] = [];

function el(
  tag: string,
  x: number,
  y: number,
  opts: { role?: string; cls?: string[]; visible?: boolean; disabled?: boolean } = {},
): FakeEl {
  const node: FakeEl = {
    tag,
    role: opts.role,
    cls: opts.cls ?? [],
    rect: { left: x, top: y, right: x + 40, bottom: y + 20 },
    visible: opts.visible ?? true,
    disabled: opts.disabled ?? false,
    clicks: 0,
    attrs: undefined,
    classes: new Set<string>(),
    get classList() {
      return {
        add: (c: string) => {
          node.classes.add(c);
        },
        remove: (c: string) => {
          node.classes.delete(c);
        },
      };
    },
    focus() {
      active = node;
    },
    click() {
      node.clicks++;
    },
    getBoundingClientRect: () => ({
      ...node.rect,
      width: node.rect.right - node.rect.left,
      height: node.rect.bottom - node.rect.top,
    }),
    hasAttribute: (name: string) =>
      (name === 'disabled' && node.disabled) || node.attrs?.[name] !== undefined,
  };
  return node;
}

// Only the two selectors the module actually passes.
function matches(node: FakeEl, selector: string): boolean {
  if (selector.includes('role="dialog"')) {
    return node.role === 'dialog' || (node.cls.includes('window') && node.cls.includes('panel'));
  }
  // FOCUSABLE_SELECTOR: button/input/select/textarea/[href]/[tabindex], not disabled
  return ['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA', 'A'].includes(node.tag) && !node.disabled;
}

/** Children of a container, by the box containment the fake models. */
function within(container: FakeEl | null, node: FakeEl): boolean {
  if (!container) return true;
  return (
    node !== container &&
    node.rect.left >= container.rect.left &&
    node.rect.right <= container.rect.right &&
    node.rect.top >= container.rect.top &&
    node.rect.bottom <= container.rect.bottom
  );
}

function install(): void {
  const queryAll = (root: FakeEl | null, selector: string): FakeEl[] =>
    allEls.filter((n) => matches(n, selector) && within(root, n));
  const bodyClasses = new Set<string>();
  const docLike = {
    querySelectorAll: (selector: string) => queryAll(null, selector),
    get activeElement() {
      return active;
    },
    body: {
      tagName: 'BODY',
      classList: {
        toggle: (c: string, on: boolean) => {
          if (on) bodyClasses.add(c);
          else bodyClasses.delete(c);
        },
      },
      appendChild: () => {},
    },
    createElement: () => {
      const node = { id: '', style: {} as Record<string, string>, setAttribute: () => {} };
      padCursorStyle = node.style;
      return node;
    },
  };
  padCursorClasses = bodyClasses;
  vi.stubGlobal('document', docLike);
  vi.stubGlobal('getComputedStyle', (n: FakeEl) => ({
    visibility: n.visible ? 'visible' : 'hidden',
    display: n.visible ? 'block' : 'none',
  }));
  // Scoped query: a container's own querySelectorAll.
  for (const node of allEls) {
    (node as unknown as { querySelectorAll: (s: string) => FakeEl[] }).querySelectorAll = (s) =>
      queryAll(node, s);
  }
}

beforeEach(() => {
  active = null;
  allEls = [];
  padCursorClasses = new Set<string>();
  // padCursorStyle is deliberately NOT reset: the module mints its pointer once
  // and caches it, so the live style object is the one to keep watching.
  // The module keeps the highlight, the pointer and the hidden-cursor flag at
  // module scope (one pad, one HUD), so reset them or state leaks between cases.
  clearPadFocus();
});
afterEach(() => vi.unstubAllGlobals());

describe('moveDpadFocus', () => {
  it('focuses the next control AND answers its centre for the cursor snap', () => {
    // The snap is the whole fix: focus alone is invisible on a pad, so a move
    // that reports no point leaves the cursor parked and looks like a no-op.
    const a = el('BUTTON', 0, 0);
    const b = el('BUTTON', 0, 50);
    allEls = [a, b];
    install();
    a.focus();

    const moved = moveDpadFocus('down');
    expect(active).toBe(b);
    expect(moved).toEqual({ x: 20, y: 60 });
  });

  it('marks the focused control so a pad player can SEE it', () => {
    // Programmatic focus() does not satisfy the browser's :focus-visible
    // heuristic, so without an explicit class there is no ring at all and the
    // navigation reads as broken.
    const a = el('BUTTON', 0, 0);
    const b = el('BUTTON', 0, 50);
    allEls = [a, b];
    install();
    a.focus();
    moveDpadFocus('down');
    expect(b.classes.has('pad-focus')).toBe(true);
    // and the mark follows focus rather than accumulating
    moveDpadFocus('up');
    expect(b.classes.has('pad-focus')).toBe(false);
    expect(a.classes.has('pad-focus')).toBe(true);
  });

  it('parks the arrow tip inside the selection bottom-right corner', () => {
    // The shipped art points up and left, so the bottom-right aims it back INTO
    // the control; the offsets put the TIP there, not the image's own corner.
    const a = el('BUTTON', 0, 0);
    const b = el('BUTTON', 0, 50); // right 40, bottom 70
    allEls = [a, b];
    install();
    a.focus();
    moveDpadFocus('down');
    const style = padCursorStyle as Record<string, string>;
    // right(40) - hotspotX(7) - inset(6) = 27 ; bottom(70) - hotspotY(2) - inset(6) = 62
    expect(style.left).toBe('27px');
    expect(style.top).toBe('62px');
    expect(style.display).toBe('block');
  });

  it('hides the OS pointer while navigating and restores it on the way out', () => {
    // The OS pointer would otherwise sit abandoned wherever it was last left.
    const a = el('BUTTON', 0, 0);
    const b = el('BUTTON', 0, 50);
    allEls = [a, b];
    install();
    a.focus();
    moveDpadFocus('down');
    expect(padCursorClasses.has('pad-nav')).toBe(true);
    clearPadFocus();
    expect(padCursorClasses.has('pad-nav')).toBe(false);
  });

  it('drops the mark when navigation ends', () => {
    const a = el('BUTTON', 0, 0);
    const b = el('BUTTON', 0, 50);
    allEls = [a, b];
    install();
    a.focus();
    moveDpadFocus('down');
    clearPadFocus();
    expect(b.classes.has('pad-focus')).toBe(false);
  });

  it('answers null when nothing lies that way, so the caller nudges the cursor', () => {
    const a = el('BUTTON', 0, 0);
    allEls = [a];
    install();
    a.focus();
    expect(moveDpadFocus('down')).toBeNull();
  });

  it('answers null on a surface with no focusable controls at all', () => {
    allEls = [el('DIV', 0, 0)];
    install();
    expect(moveDpadFocus('up')).toBeNull();
  });

  it('lands on the first control when nothing is focused yet', () => {
    const a = el('BUTTON', 0, 0);
    const b = el('BUTTON', 0, 50);
    allEls = [a, b];
    install();
    expect(moveDpadFocus('down')).not.toBeNull();
    expect(active).toBe(a);
  });

  it('stays inside the open window rather than wandering into the side rail', () => {
    // The rail sits outside the dialog's box; navigation must not reach it.
    const dialog = el('DIV', 0, 0, { role: 'dialog' });
    dialog.rect = { left: 0, top: 0, right: 300, bottom: 300 };
    const inside1 = el('BUTTON', 10, 10);
    const inside2 = el('BUTTON', 10, 60);
    const railButton = el('BUTTON', 900, 60);
    allEls = [dialog, inside1, inside2, railButton];
    install();
    inside1.focus();

    moveDpadFocus('down');
    expect(active).toBe(inside2);
    // and nothing can reach the rail, in any direction
    for (const dir of ['up', 'down', 'left', 'right'] as const) moveDpadFocus(dir);
    expect(active).not.toBe(railButton);
  });

  it('skips a hidden or disabled control', () => {
    const a = el('BUTTON', 0, 0);
    const hidden = el('BUTTON', 0, 40, { visible: false });
    const disabled = el('BUTTON', 0, 80, { disabled: true });
    const reachable = el('BUTTON', 0, 120);
    allEls = [a, hidden, disabled, reachable];
    install();
    a.focus();
    moveDpadFocus('down');
    expect(active).toBe(reachable);
  });
});

describe('focusFirstInWindow', () => {
  it('lands on the first control of the open window', () => {
    const dialog = el('DIV', 0, 0, { role: 'dialog' });
    dialog.rect = { left: 0, top: 0, right: 300, bottom: 300 };
    const first = el('BUTTON', 10, 10);
    const second = el('BUTTON', 10, 60);
    allEls = [dialog, first, second];
    install();

    expect(focusFirstInWindow()).toBe(true);
    expect(active).toBe(first);
    // and it is highlighted, so the pad player can see where they landed
    expect(first.classes.has('pad-focus')).toBe(true);
  });

  it('refuses when no window is open, rather than grabbing the whole page', () => {
    // Auto-focusing the document on any state change would yank focus around the
    // HUD instead of landing inside the thing that opened.
    allEls = [el('BUTTON', 0, 0)];
    install();
    expect(focusFirstInWindow()).toBe(false);
    expect(active).toBeNull();
  });

  it('refuses on a window with nothing focusable', () => {
    const dialog = el('DIV', 0, 0, { role: 'dialog' });
    dialog.rect = { left: 0, top: 0, right: 300, bottom: 300 };
    allEls = [dialog, el('DIV', 10, 10)];
    install();
    expect(focusFirstInWindow()).toBe(false);
  });
});

describe('syncWindowFocus', () => {
  function windowWith(x: number, ...labels: string[]) {
    const dlg = el('DIV', x, 0, { role: 'dialog' });
    dlg.rect = { left: x, top: 0, right: x + 300, bottom: 300 };
    const buttons = labels.map((_, i) => el('BUTTON', x + 10, 10 + i * 50));
    return { dlg, buttons };
  }

  it('follows focus into a window opened OVER the one the pad is already in', () => {
    // Talking to an NPC and accepting a quest opens the quest window on top of
    // the dialogue. There is no open/close edge to catch, so without this the
    // selection stays behind in the dialogue and the player has to walk it over.
    const first = windowWith(0, 'a', 'b');
    allEls = [first.dlg, ...first.buttons];
    install();
    focusFirstInWindow();
    expect(active).toBe(first.buttons[0]);

    // the quest window mounts after it in document order, so it is on top
    const second = windowWith(400, 'x', 'y');
    allEls = [...allEls, second.dlg, ...second.buttons];
    install();
    expect(syncWindowFocus()).toBe(true);
    expect(active).toBe(second.buttons[0]);
  });

  it('leaves the selection alone while the same window stays on top', () => {
    const w = windowWith(0, 'a', 'b');
    allEls = [w.dlg, ...w.buttons];
    install();
    focusFirstInWindow();
    moveDpadFocus('down');
    expect(active).toBe(w.buttons[1]);
    // a re-check must not yank the player back to the first control
    expect(syncWindowFocus()).toBe(false);
    expect(active).toBe(w.buttons[1]);
  });

  it('recovers when the focused control is rebuilt away under the pad', () => {
    const w = windowWith(0, 'a', 'b');
    allEls = [w.dlg, ...w.buttons];
    install();
    focusFirstInWindow();
    // the window swaps its contents; the focused node is gone
    const rebuilt = el('BUTTON', 10, 10);
    allEls = [w.dlg, rebuilt];
    install();
    expect(syncWindowFocus()).toBe(true);
    expect(active).toBe(rebuilt);
  });
});

describe('pressDpadFocus', () => {
  it('clicks whatever the d-pad focused', () => {
    const a = el('BUTTON', 0, 0);
    allEls = [a];
    install();
    a.focus();
    expect(pressDpadFocus()).toBe(true);
    expect(a.clicks).toBe(1);
  });

  it('refuses when nothing is focused, so A falls back to the cursor', () => {
    allEls = [el('BUTTON', 0, 0)];
    install();
    expect(pressDpadFocus()).toBe(false);
  });

  it('refuses to click an element the navigation could not have reached', () => {
    // A chat input holding focus must not be "pressed" by the A button.
    const dialog = el('DIV', 0, 0, { role: 'dialog' });
    dialog.rect = { left: 0, top: 0, right: 300, bottom: 300 };
    const inside = el('BUTTON', 10, 10);
    const outside = el('INPUT', 900, 900);
    allEls = [dialog, inside, outside];
    install();
    outside.focus();
    expect(pressDpadFocus()).toBe(false);
    expect(outside.clicks).toBe(0);
  });
});

describe('restorePadFocus', () => {
  it('returns the highlight and the cursor to whatever focus was restored to', () => {
    // The shared FocusManager already refocuses a window's opener on close; this
    // only follows it, which is what makes closing a window land the selection
    // back where the player opened it instead of in the middle of the screen.
    const opener = el('BUTTON', 200, 400);
    allEls = [opener];
    install();
    active = opener;

    expect(restorePadFocus()).toBe(true);
    expect(opener.classes.has('pad-focus')).toBe(true);
  });

  it('refuses when nothing holds focus, so the caller can clear instead', () => {
    allEls = [el('BUTTON', 0, 0)];
    install();
    active = null;
    expect(restorePadFocus()).toBe(false);
  });

  it('returns to an opener OUTSIDE the window that just closed', () => {
    // The regression this guards: scoping the check to the top-most window
    // rejects every legitimate return, because the opener is by definition not
    // inside the window it opened.
    const dialog = el('DIV', 0, 0, { role: 'dialog' });
    dialog.rect = { left: 0, top: 0, right: 300, bottom: 300 };
    const inside = el('BUTTON', 10, 10);
    const opener = el('BUTTON', 900, 500);
    allEls = [dialog, inside, opener];
    install();
    active = opener;

    expect(restorePadFocus()).toBe(true);
    expect(opener.classes.has('pad-focus')).toBe(true);
  });

  it('refuses an element the pad could never have navigated to', () => {
    // Same rule pressDpadFocus applies: focus parked on an unrelated control (a
    // chat input) is not where the pad was, so returning there would be a guess.
    const stray = el('INPUT', 0, 0, { visible: false });
    allEls = [stray];
    install();
    active = stray;
    expect(restorePadFocus()).toBe(false);
  });
});

describe('clearPadFocus', () => {
  it('blurs as well as unmarks, so a later confirm acts on nothing', () => {
    // Hiding the cursor alone left the element focused, and confirm then opened
    // whatever it had been resting on: the selection looked gone and was not.
    const btn = el('BUTTON', 10, 10);
    let blurred = false;
    (btn as unknown as { blur: () => void }).blur = () => {
      blurred = true;
    };
    allEls = [btn];
    install();
    moveDpadFocus('down');
    expect(btn.classes.has('pad-focus')).toBe(true);

    clearPadFocus();
    expect(btn.classes.has('pad-focus')).toBe(false);
    expect(blurred).toBe(true);
  });
});

describe('landing focus on a surface', () => {
  it('skips the dismiss button', () => {
    // Landing on the close X is worse than landing nowhere: the quest dialog
    // advancing to its accept page put the selection on the X, so the player had
    // to walk off it every time and a mistaken press dismissed what they were
    // reading. FocusManager already applies this rule for the keyboard.
    const dialog = el('DIV', 0, 0, { role: 'dialog' });
    dialog.rect = { left: 0, top: 0, right: 300, bottom: 300 };
    const close = el('BUTTON', 250, 4);
    close.attrs = { 'data-close': '' };
    const accept = el('BUTTON', 20, 200);
    allEls = [dialog, close, accept];
    install();

    expect(focusFirstInWindow()).toBe(true);
    expect(active).toBe(accept);
    expect(accept.classes.has('pad-focus')).toBe(true);
  });

  it('falls back to the dismiss button when it is the only control', () => {
    const dialog = el('DIV', 0, 0, { role: 'dialog' });
    dialog.rect = { left: 0, top: 0, right: 300, bottom: 300 };
    const close = el('BUTTON', 250, 4);
    close.attrs = { 'data-close': '' };
    allEls = [dialog, close];
    install();
    expect(focusFirstInWindow()).toBe(true);
    expect(active).toBe(close);
  });
});

describe('followDomFocus', () => {
  it('takes the mark to focus the INTERFACE moved', () => {
    // A window that advances its own contents focuses the control it wants next.
    // The pad knew nothing about it, so the highlight stayed behind and the
    // player, seeing nothing selected, pressed a direction until something lit up.
    const a = el('BUTTON', 10, 10);
    const b = el('BUTTON', 10, 60);
    allEls = [a, b];
    install();
    moveDpadFocus('down');
    const marked = a.classes.has('pad-focus') ? a : b;
    const other = marked === a ? b : a;

    active = other;
    expect(followDomFocus()).toBe(true);
    expect(other.classes.has('pad-focus')).toBe(true);
    expect(marked.classes.has('pad-focus')).toBe(false);
  });

  it('does nothing when the pad already agrees', () => {
    const only = el('BUTTON', 10, 10);
    allEls = [only];
    install();
    moveDpadFocus('down');
    active = only;
    expect(followDomFocus()).toBe(false);
  });

  it('ignores focus on something the navigation could not reach', () => {
    const stray = el('INPUT', 0, 0, { visible: false });
    allEls = [stray];
    install();
    active = stray;
    expect(followDomFocus()).toBe(false);
  });
});
