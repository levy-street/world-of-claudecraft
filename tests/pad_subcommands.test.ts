import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openTargetSubcommands } from '../src/game/pad_subcommands';

// A fake DOM modelling only what the module touches: a selector lookup, a frame's
// box, and the events a frame receives. The default Vitest env is plain Node with
// no document, and jsdom is not a dependency (tests/CLAUDE.md, "DOM in tests").
interface FakeEvent {
  type: string;
  bubbles: boolean;
  cancelable: boolean;
  clientX: number;
  clientY: number;
  button: number;
}

interface FakeFrame {
  events: FakeEvent[];
  rect: { left: number; top: number; width: number; height: number };
  getBoundingClientRect(): { left: number; top: number; width: number; height: number };
  dispatchEvent(event: FakeEvent): boolean;
}

function frame(rect: Partial<FakeFrame['rect']> = {}): FakeFrame {
  const box = { left: 0, top: 0, width: 200, height: 60, ...rect };
  const f: FakeFrame = {
    events: [],
    rect: box,
    getBoundingClientRect: () => f.rect,
    dispatchEvent: (event) => {
      f.events.push(event);
      return true;
    },
  };
  return f;
}

let frames: Record<string, FakeFrame>;

beforeEach(() => {
  frames = {};
  vi.stubGlobal('document', {
    querySelector: (selector: string) => frames[selector] ?? null,
  });
  // The module constructs a MouseEvent; Node has no DOM constructor for one.
  vi.stubGlobal(
    'MouseEvent',
    class {
      type: string;
      bubbles: boolean;
      cancelable: boolean;
      clientX: number;
      clientY: number;
      button: number;
      constructor(type: string, init: Partial<FakeEvent> = {}) {
        this.type = type;
        this.bubbles = init.bubbles ?? false;
        this.cancelable = init.cancelable ?? false;
        this.clientX = init.clientX ?? 0;
        this.clientY = init.clientY ?? 0;
        this.button = init.button ?? 0;
      }
    },
  );
});
afterEach(() => vi.unstubAllGlobals());

describe('pad subcommands frame choice', () => {
  it('asks the target frame first when both frames are up', () => {
    // The button asks about what the player is pointing at, so a visible target
    // must win over the always-present player frame.
    const target = frame();
    const player = frame();
    frames['#target-frame'] = target;
    frames['#player-frame'] = player;
    expect(openTargetSubcommands()).toBe(true);
    expect(target.events.map((e) => e.type)).toEqual(['contextmenu']);
    expect(player.events).toHaveLength(0);
  });

  it('falls back to the player frame when there is no target frame', () => {
    // Untargeted, the pad should still reach the player's own menu rather than
    // reporting nothing to open.
    const player = frame();
    frames['#player-frame'] = player;
    expect(openTargetSubcommands()).toBe(true);
    expect(player.events.map((e) => e.type)).toEqual(['contextmenu']);
  });

  it('skips a frame that is present but has no size', () => {
    // The target frame stays in the document and is merely hidden between targets,
    // so a presence-only check would fire a menu at an invisible box and swallow
    // the press the player expected to reach the player frame.
    const target = frame({ width: 0, height: 0 });
    const player = frame();
    frames['#target-frame'] = target;
    frames['#player-frame'] = player;
    expect(openTargetSubcommands()).toBe(true);
    expect(target.events).toHaveLength(0);
    expect(player.events.map((e) => e.type)).toEqual(['contextmenu']);
  });

  it('never opens a party row, so the list stays the target and player frames', () => {
    // A party row binds its own context menu, but a pad reaches a party member by
    // TARGETING them, and it has no way to say which row it means: an unclaimed
    // press must fall through to the caller's fallback instead.
    const row = frame();
    frames['#party-row-1'] = row;
    expect(openTargetSubcommands()).toBe(false);
    expect(row.events).toHaveLength(0);
  });

  it('answers false when no frame is up at all', () => {
    // The caller falls back to the map on false, so a press is never dead.
    expect(openTargetSubcommands()).toBe(false);
  });

  it('answers false when every candidate frame is collapsed', () => {
    // Zero size on the LAST candidate too: nothing was dispatched, so the caller
    // must still get its fallback rather than a true it cannot see the effect of.
    const target = frame({ width: 0, height: 0 });
    const player = frame({ width: 0, height: 0 });
    frames['#target-frame'] = target;
    frames['#player-frame'] = player;
    expect(openTargetSubcommands()).toBe(false);
    expect(target.events).toHaveLength(0);
    expect(player.events).toHaveLength(0);
  });

  it('answers false with no document at all', () => {
    // The headless and native hosts import this module; a bare document read there
    // would throw out of the pad poll instead of falling back.
    vi.stubGlobal('document', undefined);
    expect(openTargetSubcommands()).toBe(false);
  });
});

describe('pad subcommands synthetic event', () => {
  it('anchors the press at the middle of the frame it acts on', () => {
    // The HUD opens its menu AT the pointer, so coordinates left at 0,0 would put
    // the menu in the screen corner instead of over the frame.
    const target = frame({ left: 40, top: 100, width: 200, height: 60 });
    frames['#target-frame'] = target;
    openTargetSubcommands();
    const event = target.events[0];
    expect(event.clientX).toBe(140);
    expect(event.clientY).toBe(130);
  });

  it('presses the right button, bubbling and cancelable', () => {
    // The HUD binds contextmenu on the frame and calls preventDefault on it, and
    // some handlers read button: an event that neither bubbles nor cancels reaches
    // the wrong listeners and lets the browser menu through underneath.
    const player = frame();
    frames['#player-frame'] = player;
    openTargetSubcommands();
    const event = player.events[0];
    expect(event.button).toBe(2);
    expect(event.bubbles).toBe(true);
    expect(event.cancelable).toBe(true);
  });
});
