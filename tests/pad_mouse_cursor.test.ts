import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clickPadMouse, hidePadMouse, updatePadMouse } from '../src/game/pad_mouse_cursor';

// A fake DOM modelling what the virtual pointer touches: what sits under a point,
// and the events an element receives. jsdom is not a dependency here, and the
// shared helper has no elementFromPoint (tests/CLAUDE.md, "DOM in tests").
interface FakeNode {
  events: string[];
  classes: Set<string>;
  classList: { add(c: string): void; remove(c: string): void };
  dispatchEvent(e: { type: string }): boolean;
  click(): void;
  style: Record<string, string>;
  setAttribute(name: string, value: string): void;
  id: string;
  parentElement: FakeNode | null;
}

function node(parent: FakeNode | null = null): FakeNode {
  const n: FakeNode = {
    events: [],
    classes: new Set<string>(),
    classList: {
      add: (c) => {
        n.classes.add(c);
      },
      remove: (c) => {
        n.classes.delete(c);
      },
    },
    dispatchEvent: (e) => {
      n.events.push(e.type);
      return true;
    },
    click: () => n.events.push('click'),
    style: {},
    setAttribute: () => {},
    id: '',
    parentElement: parent,
  };
  return n;
}

let under: FakeNode | null = null;

beforeEach(() => {
  under = null;
  vi.stubGlobal('window', { innerWidth: 1000, innerHeight: 800 });
  vi.stubGlobal('document', {
    createElement: () => node(),
    body: { appendChild: () => {} },
    elementFromPoint: () => under,
  });
  // The module builds MouseEvents; Node has no DOM constructor for them.
  vi.stubGlobal(
    'MouseEvent',
    class {
      type: string;
      constructor(type: string) {
        this.type = type;
      }
    },
  );
  // Park the pointer somewhere known and clear any hover left by a prior case.
  updatePadMouse(0, 0, 0);
  hidePadMouse();
});
afterEach(() => vi.unstubAllGlobals());

describe('virtual pointer hover', () => {
  it('announces entering the element it moves onto', () => {
    // Without this the pointer could CLICK things whose hover state it could never
    // show: highlights, tooltips and popovers all hang off move and enter events.
    const target = node();
    under = target;
    updatePadMouse(1, 0, 0.1);
    expect(target.events).toContain('mouseover');
    expect(target.events).toContain('mouseenter');
    expect(target.events).toContain('mousemove');
  });

  it('announces leaving the one it moves off', () => {
    const first = node();
    under = first;
    updatePadMouse(1, 0, 0.1);
    const second = node();
    under = second;
    updatePadMouse(1, 0, 0.1);
    expect(first.events).toContain('mouseout');
    expect(first.events).toContain('mouseleave');
    expect(second.events).toContain('mouseenter');
  });

  it('marks the hovered element so CSS can light up too', () => {
    // :hover is driven by the REAL pointer and cannot be triggered synthetically,
    // so a rule that should also respond to the pad opts in through this class.
    const target = node();
    under = target;
    updatePadMouse(1, 0, 0.1);
    expect(target.classes.has('pad-hover')).toBe(true);
    under = node();
    updatePadMouse(1, 0, 0.1);
    expect(target.classes.has('pad-hover')).toBe(false);
  });

  it('keeps re-announcing movement over the SAME element', () => {
    // Anything tracking the pointer within one element (a drag, a slider) needs
    // the moves, not just the entry.
    const target = node();
    under = target;
    updatePadMouse(1, 0, 0.1);
    const afterEntry = target.events.length;
    updatePadMouse(1, 0, 0.1);
    expect(target.events.filter((e) => e === 'mousemove').length).toBeGreaterThan(1);
    expect(target.events.length).toBeGreaterThan(afterEntry);
    // and it does not re-enter what it never left
    expect(target.events.filter((e) => e === 'mouseenter')).toHaveLength(1);
  });

  it('leaves the element when the pointer is put away', () => {
    // Otherwise a tooltip stays open over a pointer that is no longer there.
    const target = node();
    under = target;
    updatePadMouse(1, 0, 0.1);
    hidePadMouse();
    expect(target.events).toContain('mouseleave');
    expect(target.classes.has('pad-hover')).toBe(false);
  });

  it('clicks what is under the pointer', () => {
    const target = node();
    under = target;
    updatePadMouse(1, 0, 0.1);
    clickPadMouse(0);
    expect(target.events).toContain('mousedown');
    expect(target.events).toContain('mouseup');
    expect(target.events).toContain('click');
  });

  it('sends a context menu rather than a click on the right button', () => {
    const target = node();
    under = target;
    updatePadMouse(1, 0, 0.1);
    clickPadMouse(2);
    expect(target.events).toContain('contextmenu');
    expect(target.events).not.toContain('click');
  });
});

describe('hover reaches the container, not only the deepest element', () => {
  it('enters every ancestor the pointer moved into', () => {
    // Tooltips are bound on the BUTTON, while elementFromPoint returns the icon
    // inside it, and mouseenter does not bubble. Firing it only on the deepest
    // element meant hovering a menu item showed no tooltip at all.
    const button = node();
    const icon = node(button);
    under = icon;
    updatePadMouse(1, 0, 0.1);
    expect(icon.events).toContain('mouseenter');
    expect(button.events).toContain('mouseenter');
  });

  it('leaves the ancestors it actually left, and keeps the ones it did not', () => {
    const button = node();
    const iconA = node(button);
    const iconB = node(button);
    under = iconA;
    updatePadMouse(1, 0, 0.1);
    button.events.length = 0;
    iconA.events.length = 0;
    // Moving between two children of the same button never leaves the button.
    under = iconB;
    updatePadMouse(1, 0, 0.1);
    expect(iconA.events).toContain('mouseleave');
    expect(button.events).not.toContain('mouseleave');
    expect(button.events).not.toContain('mouseenter');
  });
});
