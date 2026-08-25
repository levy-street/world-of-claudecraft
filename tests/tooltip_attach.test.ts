// @vitest-environment happy-dom
// Binding an element to the shared #tooltip box (src/ui/tooltip_attach.ts).
//
// Extracted verbatim from hud.ts, and worth a suite of its own the moment it became
// reachable: almost every line in it is a workaround for a specific browser behaviour, none
// of which is visible from reading the code. There is ONE tooltip box for the whole HUD and
// something like fifteen elements bound to it, so the failure modes are all cross-talk:
// a card that shows on every action-bar click, a card that never shows for a keyboard user,
// a card left showing another element's content, a card under the finger mid-drag. Each of
// those shipped at some point and each is one assertion below.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { attachSharedTooltip, type SharedTooltipHost } from '../src/ui/tooltip_attach';
import { SharedTooltipOwner } from '../src/ui/tooltip_owner';

interface RigState {
  painted: { html: string; x: number; y: number }[];
  shown: ('touch' | 'mouse' | 'focus')[];
  presses: number;
  dragging: boolean;
}

interface Rig {
  host: SharedTooltipHost;
  box: HTMLElement;
  el: HTMLElement;
  other: HTMLElement;
  /** Live, not a snapshot: the counters are read after the events have run. */
  state: RigState;
}

function rig(): Rig {
  const box = document.createElement('div');
  const el = document.createElement('button');
  const other = document.createElement('button');
  document.body.append(box, el, other);
  const state: RigState = { painted: [], shown: [], presses: 0, dragging: false };
  const host: SharedTooltipHost = {
    box: () => box,
    dragActive: () => state.dragging,
    peekGuard: {
      tooltipShown: (trigger) => state.shown.push(trigger),
      press: () => {
        state.presses++;
      },
    },
    owner: new SharedTooltipOwner<HTMLElement>(),
    paintAt: (html, x, y) => {
      state.painted.push({ html, x, y });
      box.style.display = 'block';
      return { w: 120, h: 40 };
    },
  };
  return { host, box, el, other, state };
}

/** A pointer event happy-dom will carry `pointerType` and coordinates through. */
const pointer = (type: string, init: Record<string, unknown> = {}): Event => {
  const ev = new Event(type, { bubbles: true }) as Event & Record<string, unknown>;
  Object.assign(ev, { pointerType: 'mouse', pointerId: 1, clientX: 0, clientY: 0 }, init);
  return ev;
};

beforeEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
  vi.useRealTimers();
});

describe('the mouse path', () => {
  it('resolves the content only when the pointer arrives', () => {
    const r = rig();
    const html = vi.fn(() => '<i>card</i>');
    attachSharedTooltip(r.el, html, r.host);
    // The whole point of the thunk: a bar that builds its buttons once must not bake in the
    // state they were built on.
    expect(html).not.toHaveBeenCalled();
    r.el.dispatchEvent(new Event('mouseenter'));
    expect(html).toHaveBeenCalledTimes(1);
    expect(r.state.painted.at(-1)?.html).toBe('<i>card</i>');
  });

  it('hides the box and drops ownership on the way out', () => {
    const r = rig();
    attachSharedTooltip(r.el, () => 'x', r.host);
    r.el.dispatchEvent(new Event('mouseenter'));
    expect(r.host.owner.current()).toBe(r.el);
    r.el.dispatchEvent(new Event('mouseleave'));
    expect(r.box.style.display).toBe('none');
    // Released, so the next move over ANY bound element re-resolves rather than assuming
    // the box still holds its own content.
    expect(r.host.owner.current()).toBeNull();
  });

  it('repaints on a move that finds another element owning the box', () => {
    // The drag-drop case (#1626): a drop inside a slot fires no mouseenter, and Firefox
    // re-enters the drag SOURCE, so the visible card can belong to a different element
    // while the cursor sits over this one.
    const r = rig();
    attachSharedTooltip(r.el, () => 'mine', r.host);
    r.host.owner.claim(r.other);
    r.el.dispatchEvent(pointer('mousemove', { clientX: 30, clientY: 40 }));
    expect(r.state.painted.at(-1)).toEqual({ html: 'mine', x: 30, y: 40 });
    expect(r.host.owner.current()).toBe(r.el);
  });

  it('takes the cheap reposition path once it already owns the box', () => {
    const r = rig();
    attachSharedTooltip(r.el, () => 'mine', r.host);
    r.el.dispatchEvent(new Event('mouseenter'));
    const painted = r.state.painted.length;
    r.el.dispatchEvent(pointer('mousemove', { clientX: 200, clientY: 300 }));
    // No repaint: the content cannot have changed, and re-measuring the box per mousemove
    // is exactly the forced reflow the cached size exists to avoid.
    expect(r.state.painted).toHaveLength(painted);
    expect(r.box.style.top).not.toBe('');
  });

  it('stays away while a mobile hotbar drag owns the pointer', () => {
    const r = rig();
    r.state.dragging = true;
    attachSharedTooltip(r.el, () => 'x', r.host);
    r.el.dispatchEvent(new Event('mouseenter'));
    expect(r.state.painted).toHaveLength(0);
  });
});

describe('focus, and the press that focuses as a side effect', () => {
  it('shows for a keyboard focus', () => {
    const r = rig();
    attachSharedTooltip(r.el, () => 'x', r.host);
    r.el.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(r.state.shown).toEqual(['focus']);
  });

  it('does not show for the focus a click causes', () => {
    // The regression this guards: every action-bar press popped a tooltip, because the
    // browser moves focus to whatever was pressed. Tab never fires pointerdown first.
    const r = rig();
    attachSharedTooltip(r.el, () => 'x', r.host);
    r.el.dispatchEvent(pointer('pointerdown'));
    r.el.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(r.state.painted).toHaveLength(0);
    // ...and the suppression is spent, so the NEXT real keyboard focus still works.
    r.el.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(r.state.shown).toEqual(['focus']);
  });

  it('does not let a swallowed press suppress a later keyboard focus', () => {
    // Safari desktop never focuses a button on click, so the pointerdown flag would sit
    // armed forever and eat the first real Tab tooltip. pointerup drops it.
    const r = rig();
    attachSharedTooltip(r.el, () => 'x', r.host);
    r.el.dispatchEvent(pointer('pointerdown'));
    r.el.dispatchEvent(pointer('pointerup'));
    r.el.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(r.state.shown).toEqual(['focus']);
  });

  it('honours the one-shot suppressFocusTooltip side channel', () => {
    const r = rig();
    attachSharedTooltip(r.el, () => 'x', r.host);
    r.el.dataset.suppressFocusTooltip = 'true';
    r.el.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(r.state.painted).toHaveLength(0);
    // Consumed, not sticky: the flag marks one expected focus, not a permanent opt-out.
    expect(r.el.dataset.suppressFocusTooltip).toBeUndefined();
    r.el.dispatchEvent(new Event('focusin', { bubbles: true }));
    expect(r.state.shown).toEqual(['focus']);
  });
});

describe('the touch path', () => {
  beforeEach(() => {
    document.body.classList.add('mobile-touch');
  });

  it('ignores mouse events entirely on a touch layout', () => {
    // Otherwise a tap's synthetic mouseenter shows the card AND fires the action.
    const r = rig();
    attachSharedTooltip(r.el, () => 'x', r.host);
    r.el.dispatchEvent(new Event('mouseenter'));
    r.el.dispatchEvent(pointer('mousemove', { clientX: 5, clientY: 5 }));
    expect(r.state.painted).toHaveLength(0);
  });

  it('shows on a hold, at the finger, and tells the peek guard it was a touch', () => {
    vi.useFakeTimers();
    const r = rig();
    attachSharedTooltip(r.el, () => 'x', r.host);
    r.el.dispatchEvent(pointer('pointerdown', { pointerType: 'touch', clientX: 9, clientY: 11 }));
    // A fresh press dismisses whatever was showing before the hold resolves.
    expect(r.state.presses).toBe(1);
    expect(r.state.painted).toHaveLength(0);
    vi.advanceTimersByTime(2000);
    expect(r.state.painted.at(-1)).toEqual({ html: 'x', x: 9, y: 11 });
    // 'touch' is what makes the release click PEEK instead of firing the verb.
    expect(r.state.shown).toEqual(['touch']);
  });

  it('cancels the hold when the finger lifts early', () => {
    vi.useFakeTimers();
    const r = rig();
    attachSharedTooltip(r.el, () => 'x', r.host);
    r.el.dispatchEvent(pointer('pointerdown', { pointerType: 'touch' }));
    r.el.dispatchEvent(pointer('pointerup', { pointerType: 'touch' }));
    vi.advanceTimersByTime(2000);
    expect(r.state.painted).toHaveLength(0);
  });

  it('cancels the hold when the gesture is taken away', () => {
    vi.useFakeTimers();
    const r = rig();
    attachSharedTooltip(r.el, () => 'x', r.host);
    r.el.dispatchEvent(pointer('pointerdown', { pointerType: 'touch' }));
    r.el.dispatchEvent(pointer('pointercancel', { pointerType: 'touch' }));
    vi.advanceTimersByTime(2000);
    expect(r.state.painted).toHaveLength(0);
  });

  it('leaves a real mouse alone even on a touch-flagged body', () => {
    // A hybrid laptop reports mobile-touch on the body while the user is on a trackpad;
    // the hold timer must not arm for a mouse press.
    vi.useFakeTimers();
    const r = rig();
    attachSharedTooltip(r.el, () => 'x', r.host);
    r.el.dispatchEvent(pointer('pointerdown', { pointerType: 'mouse' }));
    vi.advanceTimersByTime(2000);
    expect(r.state.painted).toHaveLength(0);
    expect(r.state.presses).toBe(0);
  });
});
