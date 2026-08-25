// Routing + elision + no-magic-values guard for the menu strip painter, the last
// of the touch gesture painters to get its own Node-side suite. It is registered
// in HOT_PAINTERS, so the shared gate scans it for raw writes and forced-reflow
// reads; what the gate cannot say is whether the painter DOES the right thing,
// and its only behavioural coverage was the opt-in browser suite.
//
// A recording facet proves every write goes through the elided writers and
// nothing else, and a real facet over recording elements proves an unchanged
// repaint costs no DOM mutation at all. The seating maths itself belongs to
// radial_action_core / menu_strip_core and has its own suites; what is pinned
// here is that the painter hands them the CACHED placement and writes what they
// return.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { placeConsumableStrip } from '../src/ui/hud/action_bar/radial_action_core';
import { type MenuStripOpenState, MenuStripPainter } from '../src/ui/hud/menu/menu_strip_painter';
import { makeWriterFacet, type PainterHostWriters } from '../src/ui/painter_host';

// ---------------------------------------------------------------------------
// Source guards
// ---------------------------------------------------------------------------

describe('MenuStripPainter: no raw DOM writes, no magic values', () => {
  const src = readFileSync(
    new URL('../src/ui/hud/menu/menu_strip_painter.ts', import.meta.url),
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

const ITEM_COUNT = 9;
const ANCHOR_X = 40;
const ANCHOR_Y = 300;
const ITEM_SIZE = 40;
const GAP = 8;
const VIEWPORT_WIDTH = 844;
const MARGIN = 6;

function el(tag: string): HTMLElement {
  return { tag } as unknown as HTMLElement;
}

function descriptor() {
  const items = Array.from({ length: ITEM_COUNT }, (_unused, i) => el(`item-${i}`));
  return {
    strip: el('strip'),
    items,
    cancel: el('cancel'),
    caption: el('caption'),
    captionText: el('caption-text'),
  };
}

function openState(over: Partial<MenuStripOpenState> = {}): MenuStripOpenState {
  return {
    placement: placeConsumableStrip({
      anchorX: ANCHOR_X,
      anchorY: ANCHOR_Y,
      count: ITEM_COUNT,
      itemSize: ITEM_SIZE,
      gap: GAP,
      viewportWidth: VIEWPORT_WIDTH,
      margin: MARGIN,
      direction: 'right',
    }),
    anchorX: ANCHOR_X,
    anchorY: ANCHOR_Y,
    live: -1,
    cancelLive: false,
    viewportWidth: VIEWPORT_WIDTH,
    margin: MARGIN,
    itemSize: ITEM_SIZE,
    caption: '',
    ...over,
  };
}

function styleProp(calls: Call[], target: HTMLElement, prop: string): string | undefined {
  const hit = calls.filter(
    (c) => c.m === 'setStyleProp' && c.args[0] === target && c.args[1] === prop,
  );
  return hit.length === 0 ? undefined : (hit[hit.length - 1].args[2] as string);
}

describe('MenuStripPainter: what it writes', () => {
  it('closes with one class toggle and hides the caption, writing nothing else', () => {
    const { calls, writers } = recordingFacet();
    const d = descriptor();
    new MenuStripPainter(writers, d).paint(null);
    expect(calls).toEqual([
      { m: 'toggleClass', args: [d.strip, 'open', false] },
      { m: 'toggleClass', args: [d.caption, 'shown', false] },
    ]);
  });

  it('seats every item on the placement the gesture measured', () => {
    const { calls, writers } = recordingFacet();
    const d = descriptor();
    const open = openState();
    new MenuStripPainter(writers, d).paint(open);
    expect(calls).toContainEqual({ m: 'toggleClass', args: [d.strip, 'open', true] });
    for (let i = 0; i < ITEM_COUNT; i++) {
      expect(styleProp(calls, d.items[i], 'left')).toBe(`${open.placement.centers[i]}px`);
      expect(styleProp(calls, d.items[i], 'top')).toBe(`${ANCHOR_Y}px`);
    }
    // The cancel X sits ON the anchor, which is what makes releasing where the
    // gesture started the way out.
    expect(styleProp(calls, d.cancel, 'left')).toBe(`${ANCHOR_X}px`);
    expect(styleProp(calls, d.cancel, 'top')).toBe(`${ANCHOR_Y}px`);
  });

  it('lights exactly the live item, and the cancel target only when it is live', () => {
    const { calls, writers } = recordingFacet();
    const d = descriptor();
    new MenuStripPainter(writers, d).paint(openState({ live: 3 }));
    const lit = calls.filter((c) => c.m === 'toggleClass' && c.args[1] === 'live' && c.args[2]);
    expect(lit.map((c) => c.args[0])).toEqual([d.items[3]]);

    const second = recordingFacet();
    new MenuStripPainter(second.writers, d).paint(openState({ cancelLive: true }));
    expect(second.calls).toContainEqual({ m: 'toggleClass', args: [d.cancel, 'live', true] });
  });

  it('shows ONE caption over the live item, and none while nothing is live', () => {
    const d = descriptor();
    const lit = recordingFacet();
    const open = openState({ live: 2, caption: 'Bags' });
    new MenuStripPainter(lit.writers, d).paint(open);
    expect(lit.calls).toContainEqual({ m: 'setText', args: [d.captionText, 'Bags'] });
    expect(lit.calls).toContainEqual({ m: 'toggleClass', args: [d.caption, 'shown', true] });
    // Exact position, computed once from the core's own pinned math rather
    // than a loose bound: centers[2] = ANCHOR_X + (ITEM_SIZE + GAP) * 3 =
    // 40 + 48 * 3 = 184 (placeConsumableStrip, direction 'right',
    // unclamped since the row never reaches the 844px viewport's right
    // edge), and 184 sits inside menuCaptionCenterX's clamp band
    // [MARGIN + MENU_CAPTION_HALF_PX, VIEWPORT_WIDTH - MARGIN -
    // MENU_CAPTION_HALF_PX] = [62, 782], so it comes back unclamped.
    expect(styleProp(lit.calls, d.caption, 'left')).toBe('184px');

    const idle = recordingFacet();
    new MenuStripPainter(idle.writers, d).paint(openState({ live: -1, caption: '' }));
    expect(idle.calls).toContainEqual({ m: 'toggleClass', args: [d.caption, 'shown', false] });
    expect(styleProp(idle.calls, d.caption, 'left')).toBeUndefined();
  });

  it('writes the local dim as a BAND along the row, flipped from the placement', () => {
    const { calls, writers } = recordingFacet();
    const d = descriptor();
    new MenuStripPainter(writers, d).paint(openState());
    expect(styleProp(calls, d.strip, '--strip-x')).toBe(`${ANCHOR_X}px`);
    expect(styleProp(calls, d.strip, '--strip-y')).toBe(`${ANCHOR_Y}px`);
    // The row grows RIGHT, so the anchor is at the band's left edge and the fade
    // is not flipped. The extent is the reach of the open row, not a circle.
    expect(styleProp(calls, d.strip, '--strip-dim-x')).toBe(`${ANCHOR_X}px`);
    expect(Number.parseFloat(styleProp(calls, d.strip, '--strip-extent-px') ?? '')).toBeGreaterThan(
      ITEM_SIZE * ITEM_COUNT,
    );
    expect(calls).toContainEqual({ m: 'toggleClass', args: [d.strip, 'dim-flip', false] });
  });
});

// ---------------------------------------------------------------------------
// Elision against a REAL facet over recording elements.
// ---------------------------------------------------------------------------

function recordingEl(tag: string) {
  const writes: string[] = [];
  const node = {
    tag,
    textContent: '',
    style: {
      setProperty(prop: string, value: string): void {
        writes.push(`${prop}=${value}`);
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
  };
  return { writes, el: node as unknown as HTMLElement };
}

describe('MenuStripPainter: an unchanged repaint costs no DOM write', () => {
  it('establishes on the first paint and elides every repeat', () => {
    const strip = recordingEl('strip');
    const d = {
      strip: strip.el,
      items: Array.from({ length: ITEM_COUNT }, (_unused, i) => recordingEl(`item-${i}`).el),
      cancel: recordingEl('cancel').el,
      caption: recordingEl('caption').el,
      captionText: recordingEl('caption-text').el,
    };
    const writers = makeWriterFacet(
      new Map(),
      new Map(),
      new Map(),
      new Map(),
      () => {},
      () => {},
    );
    const painter = new MenuStripPainter(writers, d);
    painter.paint(openState({ live: 1, caption: 'Map' }));
    const established = strip.writes.length;
    expect(established).toBeGreaterThan(0);
    painter.paint(openState({ live: 1, caption: 'Map' }));
    expect(strip.writes).toHaveLength(established);
    // A real change still writes: the elision is per (element, slot) value, not
    // a latch that goes quiet after the first frame.
    painter.paint(null);
    expect(strip.writes.length).toBeGreaterThan(established);
  });
});
