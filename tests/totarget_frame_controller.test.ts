// totarget_frame_controller.ts: the target-of-target mini frame's click,
// keyboard, context-menu and mouseover-cast routes.
//
// The interesting cases are the REFUSALS: an empty frame, a frame the interface
// editor currently owns, and an event that started on the frame's own move
// button. Per the repo testing convention this drives a small hand-rolled fake
// DOM (no jsdom), the same shape tests/movable_frame.test.ts uses.
import { beforeEach, describe, expect, it } from 'vitest';
import {
  installTargetOfTargetControls,
  type TargetOfTargetControlsDeps,
} from '../src/ui/totarget_frame_controller';

type Listener = (ev: unknown) => void;

class FakeEl {
  private listeners = new Map<string, Listener[]>();
  constructor(private readonly buttonAncestor = false) {}
  addEventListener(type: string, fn: Listener): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(fn);
    this.listeners.set(type, arr);
  }
  dispatch(type: string, ev: Record<string, unknown> = {}): void {
    for (const fn of this.listeners.get(type) ?? []) fn(ev);
  }
  closest(sel: string): FakeEl | null {
    return sel === 'button' && this.buttonAncestor ? this : null;
  }
}

interface Harness {
  frame: FakeEl;
  targeted: number[];
  menus: Array<{ id: number; x: number; y: number }>;
  hover: (() => number | null) | null;
  subject: number | null;
  unlocked: boolean;
  mobile: boolean;
  /** A plain element whose closest('button') misses, the ordinary event target. */
  body: FakeEl;
  /** An element inside the frame's corner move button. */
  moveBtn: FakeEl;
}

function harness(): Harness {
  const h: Harness = {
    frame: new FakeEl(),
    targeted: [],
    menus: [],
    hover: null,
    subject: 42,
    unlocked: false,
    mobile: false,
    body: new FakeEl(),
    moveBtn: new FakeEl(true),
  };
  const deps: TargetOfTargetControlsDeps = {
    subjectId: () => h.subject,
    onTarget: (id) => {
      h.targeted.push(id);
    },
    onMenu: (id, x, y) => {
      h.menus.push({ id, x, y });
    },
    onHover: (resolve) => {
      h.hover = resolve;
    },
    isInterfaceUnlocked: () => h.unlocked,
    isMobileLayout: () => h.mobile,
  };
  installTargetOfTargetControls(h.frame as unknown as HTMLElement, deps);
  return h;
}

let h: Harness;
beforeEach(() => {
  h = harness();
});

describe('target-of-target frame: click to target', () => {
  it('selects the unit the frame is showing, like every other unit frame', () => {
    h.frame.dispatch('click', { target: h.body });
    expect(h.targeted).toEqual([42]);
  });

  it('acts on the CURRENT unit, not one latched at hover time', () => {
    h.frame.dispatch('mouseenter');
    h.subject = 9; // the target switched while the cursor sat on the frame
    h.frame.dispatch('click', { target: h.body });
    expect(h.targeted).toEqual([9]);
  });

  it('does nothing while the frame is empty', () => {
    h.subject = null;
    h.frame.dispatch('click', { target: h.body });
    expect(h.targeted).toEqual([]);
  });

  it('does nothing while the interface editor owns the frame', () => {
    // Otherwise a completed drag would also select whoever is on the frame.
    h.unlocked = true;
    h.frame.dispatch('click', { target: h.body });
    expect(h.targeted).toEqual([]);
  });

  it('leaves a click on the frame move button to that button', () => {
    h.frame.dispatch('click', { target: h.moveBtn });
    expect(h.targeted).toEqual([]);
  });
});

describe('target-of-target frame: keyboard activation', () => {
  const keyEvent = (key: string, target: FakeEl) => {
    let prevented = false;
    let stopped = false;
    return {
      ev: {
        key,
        target,
        preventDefault: () => {
          prevented = true;
        },
        stopPropagation: () => {
          stopped = true;
        },
      },
      read: () => ({ prevented, stopped }),
    };
  };

  it('Enter and Space select the unit and stop the event reaching the game keybinds', () => {
    for (const key of ['Enter', ' ']) {
      const k = keyEvent(key, h.body);
      h.frame.dispatch('keydown', k.ev);
      expect(k.read()).toEqual({ prevented: true, stopped: true });
    }
    expect(h.targeted).toEqual([42, 42]);
  });

  it('passes every other key through untouched, so typing is never swallowed', () => {
    const k = keyEvent('a', h.body);
    h.frame.dispatch('keydown', k.ev);
    expect(h.targeted).toEqual([]);
    expect(k.read()).toEqual({ prevented: false, stopped: false });
  });

  it('does not swallow Enter while the frame is empty', () => {
    h.subject = null;
    const k = keyEvent('Enter', h.body);
    h.frame.dispatch('keydown', k.ev);
    expect(h.targeted).toEqual([]);
    expect(k.read()).toEqual({ prevented: false, stopped: false });
  });
});

describe('target-of-target frame: context menu', () => {
  const menuEvent = (target: FakeEl) => {
    let prevented = false;
    let stopped = false;
    return {
      ev: {
        target,
        clientX: 120,
        clientY: 64,
        preventDefault: () => {
          prevented = true;
        },
        stopPropagation: () => {
          stopped = true;
        },
      },
      read: () => ({ prevented, stopped }),
    };
  };

  it("opens the mini frame's OWN unit menu at the press point", () => {
    const e = menuEvent(h.body);
    h.frame.dispatch('contextmenu', e.ev);
    expect(h.menus).toEqual([{ id: 42, x: 120, y: 64 }]);
  });

  it("stops the event so the target frame's menu does not also open behind it", () => {
    // The mini is a #target-frame child until it is moved, and #target-frame
    // binds its own contextmenu handler.
    const e = menuEvent(h.body);
    h.frame.dispatch('contextmenu', e.ev);
    expect(e.read()).toEqual({ prevented: true, stopped: true });
  });

  it("lets the target frame's menu through when the mini has no unit", () => {
    h.subject = null;
    const e = menuEvent(h.body);
    h.frame.dispatch('contextmenu', e.ev);
    expect(h.menus).toEqual([]);
    expect(e.read()).toEqual({ prevented: false, stopped: false });
  });
});

describe('target-of-target frame: mouseover cast source', () => {
  it('publishes a resolver on enter and clears it on leave', () => {
    h.frame.dispatch('mouseenter');
    expect(h.hover?.()).toBe(42);
    h.frame.dispatch('mouseleave');
    expect(h.hover).toBeNull();
  });

  it('re-resolves through the live subject, so a swap under a still cursor follows', () => {
    h.frame.dispatch('mouseenter');
    h.subject = 9;
    expect(h.hover?.()).toBe(9);
    h.subject = null;
    expect(h.hover?.()).toBeNull();
  });

  it('resolves to nothing while the interface editor owns the frame', () => {
    h.frame.dispatch('mouseenter');
    h.unlocked = true;
    expect(h.hover?.()).toBeNull();
  });
});
