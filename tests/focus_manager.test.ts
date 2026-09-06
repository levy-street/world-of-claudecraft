import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FOCUSABLE_SELECTOR, FocusManager } from '../src/ui/focus_manager';
import { MobileMoreDialogController } from '../src/ui/mobile_more_dialog';
import { dropPointerFocus } from '../src/ui/pointer_blur';
import { makeWindowFocus } from '../src/ui/window_focus';

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
  tagName: string;
  type: string;
  name: string;
  checked: boolean;

  constructor(
    opts: {
      focusable?: boolean;
      dataClose?: boolean;
      visible?: boolean;
      id?: string;
      tagName?: string;
      type?: string;
      name?: string;
      checked?: boolean;
    } = {},
  ) {
    this.focusable = opts.focusable ?? false;
    this.dataClose = opts.dataClose ?? false;
    this.visible = opts.visible ?? true;
    this.id = opts.id ?? '';
    this.tagName = opts.tagName ?? 'div';
    this.type = opts.type ?? '';
    this.name = opts.name ?? '';
    this.checked = opts.checked ?? false;
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
  // Rendering is INHERITED, so an ancestor being hidden empties this too: a button
  // inside a closed window has no rects of its own, which is exactly what makes
  // focusing it a silent no-op in a browser.
  getClientRects(): { length: number }[] {
    for (let n: FakeHTMLElement | null = this; n; n = n.parent) if (!n.visible) return [];
    return [{ length: 1 }];
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

  private readonly attrs = new Map<string, string>();

  setAttribute(name: string, value: string): void {
    this.attrs.set(name, value);
  }

  getAttribute(name: string): string | null {
    return this.attrs.get(name) ?? null;
  }

  focus(): void {
    fakeDoc.activeElement = this;
  }

  blur(): void {
    // A real blur moves document focus to the body.
    if (fakeDoc.activeElement === this) fakeDoc.activeElement = fakeDoc.body;
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

  it('treats a named radio group as one native Tab stop', () => {
    const root = new FakeHTMLElement();
    const mouse = new FakeHTMLElement({
      focusable: true,
      tagName: 'input',
      type: 'radio',
      name: 'camera-mode',
      checked: true,
    });
    const classic = new FakeHTMLElement({
      focusable: true,
      tagName: 'input',
      type: 'radio',
      name: 'camera-mode',
    });
    const confirm = new FakeHTMLElement({ focusable: true, tagName: 'button' });
    root.append(mouse, classic, confirm);
    new FocusManager().open({ root: () => el(root) });
    fakeDoc.activeElement = mouse;

    expect(tab()).toBe(true);
    expect(fakeDoc.activeElement).toBe(confirm);
    expect(classic).not.toBe(fakeDoc.activeElement);
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

  it('cycles from the focused root itself (pointer focus parked there by pointer_blur.ts) into the first and last controls', () => {
    // A mouse click inside a dialog-rooted window parks focus on the root rather
    // than the body (src/ui/pointer_blur.ts): root.contains(root) holds, so the
    // trap stays armed and the next Tab enters the cycle instead of leaving it.
    const root = new FakeHTMLElement();
    const a = new FakeHTMLElement({ focusable: true });
    const b = new FakeHTMLElement({ focusable: true });
    root.append(a, b);
    new FocusManager().open({ root: () => el(root) });
    fakeDoc.activeElement = root;
    expect(tab()).toBe(true);
    expect(fakeDoc.activeElement).toBe(a);
    fakeDoc.activeElement = root;
    expect(tab(true)).toBe(true);
    expect(fakeDoc.activeElement).toBe(b);
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

// A window can go away UNDER a modal it opened: the corpse popup despawns while
// its bind-on-pickup confirmation is still on screen. The window's own close then
// hands focus back to ITS opener, which used to yank the caret straight out of the
// live confirmation (and left that confirmation pointing at a return target inside
// the hidden window). The trap chain is the owner of both halves.
describe('a window released UNDER a live trap above it', () => {
  function rig() {
    const opener = new FakeHTMLElement({ focusable: true }); // the Professions entry
    const windowRoot = new FakeHTMLElement(); // the corpse popup
    const take = new FakeHTMLElement({ focusable: true }); // its Take Loot button
    windowRoot.append(take);
    const modalRoot = new FakeHTMLElement(); // the bind confirmation
    const ok = new FakeHTMLElement({ focusable: true });
    modalRoot.append(ok);
    const fm = new FocusManager();

    opener.focus();
    const windowTrap = fm.open({ root: () => el(windowRoot) }); // opener recorded
    take.focus();
    const modalTrap = fm.open({ root: () => el(modalRoot) }); // opener = take
    ok.focus();
    return { fm, opener, windowRoot, take, modalRoot, modalTrap, ok, windowTrap };
  }

  it('leaves focus in the modal instead of returning it to the closing window opener', () => {
    const { windowRoot, windowTrap, ok } = rig();
    windowRoot.visible = false; // the corpse despawned; the popup hid itself
    windowTrap.release(true);
    expect(fakeDoc.activeElement).toBe(ok);
  });

  it('bequeaths its opener to the modal, whose own opener died with the window', () => {
    const { windowRoot, windowTrap, modalTrap, opener } = rig();
    windowRoot.visible = false;
    windowTrap.release(true);
    expect(modalTrap.opener()).toBe(opener);
    modalTrap.release(true); // the player answers the confirmation
    expect(fakeDoc.activeElement).toBe(opener); // ... and lands somewhere real
  });

  it('carries an EXPLICIT return target up, not just the recorded opener', () => {
    // The window-focus bridge passes the target the window stored for itself.
    const { windowRoot, windowTrap, modalTrap } = rig();
    const elsewhere = new FakeHTMLElement({ focusable: true });
    windowRoot.visible = false;
    windowTrap.release(true, elsewhere as unknown as HTMLElement);
    expect(modalTrap.opener()).toBe(elsewhere);
  });

  it('still inherits when the window REBUILT the opener away before closing', () => {
    // These popups are live views: an ordinary loot change repaints the body and
    // destroys the element the modal was opened from, long before the corpse
    // itself goes. Ownership is recorded at open() precisely so the answer does
    // not depend on interrogating a node that no longer has a parent.
    const { windowRoot, windowTrap, modalTrap, take, opener } = rig();
    windowRoot.children.length = 0; // the popup repainted its body
    take.parent = null;
    take.isConnected = false;
    windowTrap.release(true); // ... and only then did the body despawn
    expect(modalTrap.opener()).toBe(opener);
    modalTrap.release(true);
    expect(fakeDoc.activeElement).toBe(opener);
  });

  it('keeps a still-focusable child opener when the window merely released its trap', () => {
    // Not every release is a close: the window is still on screen and the control
    // the modal came from still works, so the player's own return point wins.
    const { windowTrap, modalTrap, take } = rig();
    windowTrap.release(true);
    expect(modalTrap.opener()).toBe(take);
  });

  it('hands a grandchild up the chain when two windows close under one modal', () => {
    // professions -> corpse popup -> confirmation: with the middle window gone the
    // confirmation belongs to the professions window, so THAT closing under it
    // hands the chain up once more rather than stranding the return.
    const rail = new FakeHTMLElement({ focusable: true });
    const outerRoot = new FakeHTMLElement();
    const entry = new FakeHTMLElement({ focusable: true });
    outerRoot.append(entry);
    const innerRoot = new FakeHTMLElement();
    const take = new FakeHTMLElement({ focusable: true });
    innerRoot.append(take);
    const modalRoot = new FakeHTMLElement();
    const ok = new FakeHTMLElement({ focusable: true });
    modalRoot.append(ok);
    const fm = new FocusManager();

    rail.focus();
    const outer = fm.open({ root: () => el(outerRoot) });
    entry.focus();
    const inner = fm.open({ root: () => el(innerRoot) });
    take.focus();
    const modal = fm.open({ root: () => el(modalRoot) });
    ok.focus();

    innerRoot.visible = false;
    inner.release(true);
    expect(modal.opener()).toBe(entry); // the professions entry, still on screen
    outerRoot.visible = false;
    entry.visible = false;
    outer.release(true);
    expect(modal.opener()).toBe(rail); // ... and now the rail behind it
    expect(fakeDoc.activeElement).toBe(ok); // focus never left the confirmation
    modal.release(true);
    expect(fakeDoc.activeElement).toBe(rail);
  });

  it('leaves a modal opened from OUTSIDE the closing window pointing where it was', () => {
    const { fm, windowRoot, windowTrap } = rig();
    const outside = new FakeHTMLElement({ focusable: true });
    outside.focus();
    const later = fm.open({ root: () => el(new FakeHTMLElement()) });
    windowRoot.visible = false;
    windowTrap.release(true);
    expect(later.opener()).toBe(outside); // not adopted: it never lived in the window
  });

  it('still returns focus when the trap above was itself already released', () => {
    const { windowRoot, windowTrap, modalTrap, opener } = rig();
    modalTrap.release(false); // the confirmation was answered first
    windowRoot.visible = false;
    windowTrap.release(true);
    expect(fakeDoc.activeElement).toBe(opener); // the ordinary return is intact
  });

  it('still returns focus when the window above it is gone from the screen', () => {
    // A leaked trap (window torn down without release) must not strand the return.
    const { windowRoot, modalRoot, windowTrap, opener } = rig();
    modalRoot.visible = false;
    windowRoot.visible = false;
    windowTrap.release(true);
    expect(fakeDoc.activeElement).toBe(opener);
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

describe('opener capture vs the pointer-only focus drop (src/ui/pointer_blur.ts)', () => {
  it('records no opener for a window opened from a pointer-dropped trigger, and the trigger itself for a keyboard one', () => {
    // The focus-restore-to-trigger contract: a keyboard open (detail 0, no drop)
    // records the focused trigger and returns focus to it on close; a mouse open
    // ran the capture-phase drop first, so the trigger is no longer focused and
    // nothing stale is recorded for the close to re-plant focus on.
    const trigger = new FakeHTMLElement({ focusable: true });
    const root = new FakeHTMLElement();
    root.append(new FakeHTMLElement({ focusable: true }));
    const fm = new FocusManager();

    trigger.focus();
    dropPointerFocus(el(trigger));
    expect(fakeDoc.activeElement).toBe(fakeDoc.body);
    const mouse = fm.open({ root: () => el(root) });
    expect(mouse.opener()).toBeNull();
    mouse.release(false);

    trigger.focus();
    const keyboard = fm.open({ root: () => el(root) });
    expect(keyboard.opener()).toBe(trigger);
    keyboard.release(false);
  });

  it('records a focused window ROOT (where the pointer drop parks a click inside a dialog-rooted window) as the next opener', () => {
    // Inside a dialog-rooted window the drop parks focus on the window's root
    // (src/ui/pointer_blur.ts, pinned there and in the browser suite); the opener
    // capture accepts any rendered element, so the next window records that root,
    // never the clicked button. Restoring to a still-open window's root re-arms
    // its trap; a closed one fails canFocus and restores nothing.
    const parkedRoot = new FakeHTMLElement();
    const nextRoot = new FakeHTMLElement();
    nextRoot.append(new FakeHTMLElement({ focusable: true }));
    parkedRoot.focus();
    const trap = new FocusManager().open({ root: () => el(nextRoot) });
    expect(trap.opener()).toBe(parkedRoot);
    trap.release(false);
  });
});

// The {captureFocus, restoreFocus} bridge every painter window is wired through
// (src/ui/window_focus.ts), over the real manager: it is the ONE glue hud.ts and
// the browser E2E share, so its three cases belong beside the trap chain they use.
describe('the window-focus bridge', () => {
  function rig() {
    const opener = new FakeHTMLElement({ focusable: true });
    const root = new FakeHTMLElement();
    const a = new FakeHTMLElement({ focusable: true });
    const b = new FakeHTMLElement({ focusable: true });
    root.append(a, b);
    const fm = new FocusManager();
    const bridge = makeWindowFocus(fm, () => el(root));
    return { fm, bridge, opener, root, a, b };
  }

  it('returns focus to the opener it captured when the window closes', () => {
    const { bridge, opener, a } = rig();
    opener.focus();
    expect(bridge.captureFocus()).toBe(opener);
    a.focus();
    bridge.restoreFocus(opener as unknown as HTMLElement);
    expect(fakeDoc.activeElement).toBe(opener);
  });

  it('keeps the trap armed for an in-window refocus (a rebuilt row taking focus back)', () => {
    const { bridge, opener, a, b } = rig();
    opener.focus();
    bridge.captureFocus();
    bridge.restoreFocus(b as unknown as HTMLElement);
    expect(fakeDoc.activeElement).toBe(b);
    expect(tab()).toBe(true); // the window still owns Tab
    expect(fakeDoc.activeElement).toBe(a); // wrapped inside the window
  });

  it('leaves focus in a modal opened over it, and hands that modal its opener', () => {
    const { fm, bridge, opener, root, a } = rig();
    opener.focus();
    bridge.captureFocus();
    a.focus(); // the control that opened the prompt
    const modalRoot = new FakeHTMLElement();
    const ok = new FakeHTMLElement({ focusable: true });
    modalRoot.append(ok);
    const modal = fm.open({ root: () => el(modalRoot) });
    ok.focus();

    root.visible = false; // the window closed under the prompt
    bridge.restoreFocus(opener as unknown as HTMLElement);
    expect(fakeDoc.activeElement).toBe(ok);
    expect(modal.opener()).toBe(opener);
  });
});

// The mobile More tray's return-focus chain, end to end over the real manager.
// Its trigger (#mobile-more) is a Quick Actions STRIP item, so it is unrendered
// whenever that strip is closed, which is the ordinary state by the time the
// tray closes: focusing it is a silent no-op that drops the user to <body>.
describe('the mobile More tray return-focus chain', () => {
  function rig(triggerVisible: boolean) {
    const manager = new FocusManager();
    const trigger = new FakeHTMLElement({ focusable: true, visible: triggerVisible });
    const anchor = new FakeHTMLElement({ focusable: true });
    const closeX = new FakeHTMLElement({ focusable: true, dataClose: true });
    const dialog = new FakeHTMLElement();
    dialog.append(closeX);
    const controller = new MobileMoreDialogController(manager, {
      trigger: () => el(trigger),
      dialog: () => el(dialog),
      fallback: () => el(anchor),
    });
    return { controller, trigger, anchor, closeX };
  }

  it('falls back to the Quick Actions anchor when the strip holding the trigger is closed', () => {
    const { controller, trigger, anchor, closeX } = rig(false);
    controller.sync(true);
    expect(fakeDoc.activeElement).toBe(closeX);

    controller.sync(false);
    expect(fakeDoc.activeElement).toBe(anchor);
    expect(fakeDoc.activeElement).not.toBe(trigger);
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });

  it('still returns to the trigger itself while the strip holding it is open', () => {
    const { controller, trigger, anchor } = rig(true);
    controller.sync(true);
    controller.sync(false);
    expect(fakeDoc.activeElement).toBe(trigger);
    expect(fakeDoc.activeElement).not.toBe(anchor);
  });

  it('restores nothing during a More-to-window handoff', () => {
    const { controller, trigger, anchor } = rig(false);
    controller.sync(true);
    controller.sync(false, false);
    expect(fakeDoc.activeElement).not.toBe(anchor);
    expect(fakeDoc.activeElement).not.toBe(trigger);
  });
});
