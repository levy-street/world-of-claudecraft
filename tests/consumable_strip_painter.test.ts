// Routing + elision + no-magic-values guard for the consumables strip painter.
// It is registered in HOT_PAINTERS, so the shared gate scans it for raw writes
// and forced-reflow reads; what the gate cannot say is whether the painter DOES
// the right thing, and its only behavioural coverage was the opt-in browser
// suite.
//
// The three things that are genuinely this painter's, and are pinned here: the
// TAIL positions the player is not carrying stay hidden (the row is six seats
// wide whatever the bag holds), the live highlight follows the finger, and the
// local dim is a BAND sized from the open row rather than a circle at the seat.
// The per-item icon / cooldown / usability math is ActionBarPainter's and has
// its own suite; what this asserts about it is that the seat is painted from
// slot 0 of the SAME state the row's items come from, so the two cannot disagree.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { ActionBarSlotElements } from '../src/ui/hud/action_bar/action_bar_painter';
import type { ActionBarSlotState, ActionBarState } from '../src/ui/hud/action_bar/action_bar_view';
import {
  type ConsumableStripOpenState,
  ConsumableStripPainter,
} from '../src/ui/hud/action_bar/consumable_strip_painter';
import { placeConsumableStrip } from '../src/ui/hud/action_bar/radial_action_core';
import { makeWriterFacet, type PainterHostWriters } from '../src/ui/painter_host';

// ---------------------------------------------------------------------------
// Source guards
// ---------------------------------------------------------------------------

describe('ConsumableStripPainter: no raw DOM writes, no magic values', () => {
  const src = readFileSync(
    new URL('../src/ui/hud/action_bar/consumable_strip_painter.ts', import.meta.url),
    'utf8',
  );
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

  it('makes no raw style / textContent / classList / setAttribute / innerHTML write', () => {
    expect(code).not.toMatch(/\.style\b/);
    expect(code).not.toMatch(/\.textContent\b/);
    expect(code).not.toMatch(/\.classList\b/);
    expect(code).not.toMatch(/\.className\b/);
    expect(code).not.toMatch(/\.setAttribute\b/);
    expect(code).not.toMatch(/\.setProperty\b/);
    expect(code).not.toMatch(/\.innerHTML\b/);
    expect(code).not.toMatch(/addEventListener/);
  });

  it('takes no forced-reflow layout read', () => {
    expect(code).not.toMatch(/getBoundingClientRect/);
    expect(code).not.toMatch(/getComputedStyle/);
    expect(code).not.toMatch(/\.offsetWidth\b/);
    expect(code).not.toMatch(/\.offsetHeight\b/);
  });

  it('carries no literal hex / rgb color and no bare px constant', () => {
    // Every px this painter writes is a template over a value the gesture
    // measured or the pure core computed, never a number authored here: static
    // size, shape and colour are hud.mobile.css's per tier.
    expect(code.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
    expect(code.match(/\brgba?\s*\(/g) ?? []).toEqual([]);
    expect(code.match(/\b\d+px\b/g) ?? []).toEqual([]);
    expect(code.match(/\$\{[^}]+\}px/g) ?? []).not.toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// A recording facet + fake elements drive the real painter (node env).
// ---------------------------------------------------------------------------

type Call = { m: keyof PainterHostWriters; args: unknown[] };

function recordingFacet() {
  const calls: Call[] = [];
  const writers: PainterHostWriters = {
    setText: (el, text) => {
      calls.push({ m: 'setText', args: [el, text] });
    },
    setDisplay: (el, display) => {
      calls.push({ m: 'setDisplay', args: [el, display] });
    },
    setTransform: (el, transform) => {
      calls.push({ m: 'setTransform', args: [el, transform] });
    },
    setWidth: (el, width) => {
      calls.push({ m: 'setWidth', args: [el, width] });
    },
    setStyleProp: (el, prop, value) => {
      calls.push({ m: 'setStyleProp', args: [el, prop, value] });
    },
    toggleClass: (el, cls, on) => {
      calls.push({ m: 'toggleClass', args: [el, cls, on] });
    },
    setAttr: (el, name, value) => {
      calls.push({ m: 'setAttr', args: [el, name, value] });
    },
  };
  return { calls, writers };
}

/** Six seats, the shipped CONSUMABLE_BAR_SLOTS width. */
const SLOTS = 6;
const ANCHOR_X = 800;
const ANCHOR_Y = 300;
const ITEM_SIZE = 40;
const GAP = 8;
const VIEWPORT_WIDTH = 844;
const MARGIN = 6;

function node(tag: string): HTMLElement {
  return { tag } as unknown as HTMLElement;
}

function slotElements(tag: string): ActionBarSlotElements {
  return {
    btn: node(`${tag}-btn`),
    label: node(`${tag}-label`),
    countEl: node(`${tag}-count`),
    keybindEl: node(`${tag}-keybind`),
    cdOverlay: node(`${tag}-cd`),
    cdText: node(`${tag}-cdtext`),
    rechargeOverlay: node(`${tag}-recharge`),
  };
}

function descriptor() {
  return {
    strip: node('strip'),
    cancel: node('cancel'),
    seat: slotElements('seat'),
    items: Array.from({ length: SLOTS }, (_unused, i) => slotElements(`item-${i}`)),
  };
}

function slotState(iconKey: string): ActionBarSlotState {
  return {
    kind: 'item',
    abilityId: null,
    itemId: iconKey,
    iconKey,
    cooldownRemaining: 0,
    cooldownTotal: 0,
    cooldownPercent: 0,
    cdText: '',
    count: '',
    isCharges: false,
    rechargePercent: 0,
    usable: true,
    outOfRange: false,
    queued: false,
    aiming: false,
    procGlow: false,
    empowered: false,
    ascensionSpender: false,
    ascensionCostLabel: '',
    fateConsumeReady: false,
    fateSentenceReady: false,
    ariaLabel: iconKey,
    ariaDescription: '',
    keybindLabel: '',
  };
}

/** The seat at slot 0 plus the row at 1..n, exactly as the controller builds it. */
function barState(): ActionBarState {
  return {
    manySpells: false,
    slots: Array.from({ length: SLOTS + 1 }, (_unused, i) => slotState(`potion-${i}`)),
  };
}

function openState(over: Partial<ConsumableStripOpenState> = {}): ConsumableStripOpenState {
  const count = over.count ?? SLOTS;
  return {
    placement: placeConsumableStrip({
      anchorX: ANCHOR_X,
      anchorY: ANCHOR_Y,
      count: SLOTS,
      itemSize: ITEM_SIZE,
      gap: GAP,
      viewportWidth: VIEWPORT_WIDTH,
      margin: MARGIN,
      direction: 'left',
    }),
    anchorX: ANCHOR_X,
    anchorY: ANCHOR_Y,
    live: -1,
    cancelLive: false,
    itemSize: ITEM_SIZE,
    ...over,
    count,
  };
}

function styleProp(calls: Call[], target: HTMLElement, prop: string): string | undefined {
  const hit = calls.filter(
    (c) => c.m === 'setStyleProp' && c.args[0] === target && c.args[1] === prop,
  );
  return hit.length === 0 ? undefined : (hit[hit.length - 1].args[2] as string);
}

function display(calls: Call[], target: HTMLElement): string | undefined {
  const hit = calls.filter((c) => c.m === 'setDisplay' && c.args[0] === target);
  return hit.length === 0 ? undefined : (hit[hit.length - 1].args[1] as string);
}

describe('ConsumableStripPainter: what it writes', () => {
  it('paints the seat every frame and touches no row position while closed', () => {
    const { calls, writers } = recordingFacet();
    const d = descriptor();
    new ConsumableStripPainter(writers, d, (key) => `url(${key})`).paint(barState(), null);
    // The seat is slot 0 of the SAME state the row reads, so it can never show a
    // different item from the one the row's first position holds.
    expect(calls).toContainEqual({
      m: 'setStyleProp',
      args: [d.seat.label, 'background-image', 'url(potion-0)'],
    });
    expect(calls).toContainEqual({ m: 'toggleClass', args: [d.strip, 'open', false] });
    expect(styleProp(calls, d.items[0].btn, 'left')).toBeUndefined();
  });

  it('seats the open row on the measured placement', () => {
    const { calls, writers } = recordingFacet();
    const d = descriptor();
    const open = openState();
    new ConsumableStripPainter(writers, d, () => '').paint(barState(), open);
    expect(calls).toContainEqual({ m: 'toggleClass', args: [d.strip, 'open', true] });
    for (let i = 0; i < SLOTS; i++) {
      expect(styleProp(calls, d.items[i].btn, 'left')).toBe(`${open.placement.centers[i]}px`);
      expect(styleProp(calls, d.items[i].btn, 'top')).toBe(`${ANCHOR_Y}px`);
    }
    // The cancel X sits ON the seat: releasing where the gesture started is the
    // way out, and it is only the live choice when the finger came back.
    expect(styleProp(calls, d.cancel, 'left')).toBe(`${ANCHOR_X}px`);
    expect(calls).toContainEqual({ m: 'toggleClass', args: [d.cancel, 'live', false] });
  });

  it('hides the tail positions the player is not carrying', () => {
    const { calls, writers } = recordingFacet();
    const d = descriptor();
    new ConsumableStripPainter(writers, d, () => '').paint(barState(), openState({ count: 2 }));
    expect(display(calls, d.items[0].btn)).toBe('');
    expect(display(calls, d.items[1].btn)).toBe('');
    for (let i = 2; i < SLOTS; i++) {
      expect(display(calls, d.items[i].btn)).toBe('none');
      // A hidden tail position is never seated either: nothing is written for it
      // beyond the one display toggle.
      expect(styleProp(calls, d.items[i].btn, 'left')).toBeUndefined();
    }
  });

  it('lights exactly the item under the finger', () => {
    const { calls, writers } = recordingFacet();
    const d = descriptor();
    new ConsumableStripPainter(writers, d, () => '').paint(barState(), openState({ live: 2 }));
    const lit = calls.filter((c) => c.m === 'toggleClass' && c.args[1] === 'live' && c.args[2]);
    expect(lit.map((c) => c.args[0])).toEqual([d.items[2].btn]);
  });

  it('sizes the local dim from the OPEN row, flipped because it grows leftward', () => {
    const d = descriptor();
    const full = recordingFacet();
    new ConsumableStripPainter(full.writers, d, () => '').paint(barState(), openState());
    const short = recordingFacet();
    new ConsumableStripPainter(short.writers, d, () => '').paint(
      barState(),
      openState({ count: 2 }),
    );
    const extent = (calls: Call[]) =>
      Number.parseFloat(styleProp(calls, d.strip, '--strip-extent-px') ?? '');
    // A two-potion row dims far less screen than a six-potion one, which is the
    // whole reason the dim is a band rather than a circle at the seat.
    expect(extent(short.calls)).toBeLessThan(extent(full.calls));
    expect(full.calls).toContainEqual({ m: 'toggleClass', args: [d.strip, 'dim-flip', true] });
    expect(styleProp(full.calls, d.strip, '--strip-y')).toBe(`${ANCHOR_Y}px`);
  });
});

// ---------------------------------------------------------------------------
// Elision against a REAL facet over recording elements.
// ---------------------------------------------------------------------------

/** A node that appends every real DOM write to a SHARED log, so "an unchanged
 *  repaint writes nothing" can be asserted over the whole descriptor at once. */
function recordingEl(tag: string, writes: string[]): HTMLElement {
  return {
    tag,
    textContent: '',
    style: {
      setProperty(prop: string, value: string): void {
        writes.push(`${prop}=${value}`);
      },
      set display(value: string) {
        writes.push(`display=${value}`);
      },
      get display(): string {
        return '';
      },
    },
    classList: {
      toggle(cls: string, on: boolean): void {
        writes.push(`${cls}:${on}`);
      },
    },
    setAttribute(name: string, value: string): void {
      writes.push(`${name}=${value}`);
    },
    removeAttribute(name: string): void {
      writes.push(`${name}=REMOVED`);
    },
  } as unknown as HTMLElement;
}

function recordingSlot(tag: string, writes: string[]): ActionBarSlotElements {
  return {
    btn: recordingEl(`${tag}-btn`, writes),
    label: recordingEl(`${tag}-label`, writes),
    countEl: recordingEl(`${tag}-count`, writes),
    keybindEl: recordingEl(`${tag}-keybind`, writes),
    cdOverlay: recordingEl(`${tag}-cd`, writes),
    cdText: recordingEl(`${tag}-cdtext`, writes),
    rechargeOverlay: recordingEl(`${tag}-recharge`, writes),
  };
}

describe('ConsumableStripPainter: an unchanged repaint costs no DOM write', () => {
  it('establishes on the first paint and elides every repeat', () => {
    const writes: string[] = [];
    const writers = makeWriterFacet(
      new Map(),
      new Map(),
      new Map(),
      new Map(),
      () => {},
      () => {},
    );
    const painter = new ConsumableStripPainter(
      writers,
      {
        strip: recordingEl('strip', writes),
        cancel: recordingEl('cancel', writes),
        seat: recordingSlot('seat', writes),
        items: Array.from({ length: SLOTS }, (_unused, i) => recordingSlot(`item-${i}`, writes)),
      },
      () => '',
    );

    painter.paint(barState(), openState({ live: 1 }));
    const established = writes.length;
    expect(established).toBeGreaterThan(0);
    painter.paint(barState(), openState({ live: 1 }));
    expect(writes).toHaveLength(established);
    // A moved finger still writes: the elision is per (element, slot) value, not
    // a latch that goes quiet after the first frame.
    painter.paint(barState(), openState({ live: 2 }));
    expect(writes.length).toBeGreaterThan(established);
  });
});
