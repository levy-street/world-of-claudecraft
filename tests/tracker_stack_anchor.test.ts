// @vitest-environment happy-dom

// The tracker-stack seat: trackerStackAnchorTopPx (the pure math in
// tracker_stack_anchor_core.ts) and the TrackerStackAnchor applier that
// measures the live minimap column and writes #right-tracker-stack's top.
// The seat exists because the stylesheet's per-tier `top` constants cannot see
// a wrapping zone label, the mobile chrome scale, or the compact-tier
// transform; the compact tier really did paint the Reliquary chip over the
// compass and clock (the bug that minted this module).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { installTrackerStackAnchor, TrackerStackAnchor } from '../src/ui/tracker_stack_anchor';
import {
  TRACKER_STACK_ANCHOR_GAP_PX,
  trackerStackAnchorTopPx,
} from '../src/ui/tracker_stack_anchor_core';

describe('trackerStackAnchorTopPx', () => {
  it('seats the stack a gap below the minimap bottom', () => {
    expect(
      trackerStackAnchorTopPx({ minimapBottomPx: 268, overhangBottomsPx: [], uiScale: 1 }),
    ).toBe(268 + TRACKER_STACK_ANCHOR_GAP_PX);
  });

  it('lets the lowest overhang win: the desktop zoom pill hangs below the wrap box', () => {
    expect(
      trackerStackAnchorTopPx({ minimapBottomPx: 268, overhangBottomsPx: [274, 240], uiScale: 1 }),
    ).toBe(274 + TRACKER_STACK_ANCHOR_GAP_PX);
    // An overhang ABOVE the wrap bottom (hidden element, zero rect) never pulls
    // the seat up.
    expect(
      trackerStackAnchorTopPx({ minimapBottomPx: 268, overhangBottomsPx: [0], uiScale: 1 }),
    ).toBe(268 + TRACKER_STACK_ANCHOR_GAP_PX);
  });

  it('divides the measured (visual) bottom back into UI space before writing', () => {
    // At uiScale 1.25 a 335px visual bottom is a 268px UI-space bottom: the
    // `top` the caller writes lives INSIDE the zoomed #ui layer.
    expect(
      trackerStackAnchorTopPx({ minimapBottomPx: 335, overhangBottomsPx: [], uiScale: 1.25 }),
    ).toBe(268 + TRACKER_STACK_ANCHOR_GAP_PX);
  });

  it('guards a broken scale (0 or NaN falls back to 1, never Infinity/NaN tops)', () => {
    expect(
      trackerStackAnchorTopPx({ minimapBottomPx: 268, overhangBottomsPx: [], uiScale: 0 }),
    ).toBe(268 + TRACKER_STACK_ANCHOR_GAP_PX);
    expect(
      trackerStackAnchorTopPx({ minimapBottomPx: 268, overhangBottomsPx: [], uiScale: Number.NaN }),
    ).toBe(268 + TRACKER_STACK_ANCHOR_GAP_PX);
  });

  it('answers null for a hidden column, so the stylesheet seat stands', () => {
    expect(
      trackerStackAnchorTopPx({ minimapBottomPx: null, overhangBottomsPx: [], uiScale: 1 }),
    ).toBeNull();
  });

  it('rounds to whole px so the elision compares stable integers', () => {
    const top = trackerStackAnchorTopPx({
      minimapBottomPx: 268.4,
      overhangBottomsPx: [],
      uiScale: 1,
    });
    expect(top).toBe(268 + TRACKER_STACK_ANCHOR_GAP_PX);
    expect(Number.isInteger(top)).toBe(true);
  });
});

interface Rig {
  anchor: TrackerStackAnchor;
  stack: HTMLElement;
  /** Mutable measured geometry the stubbed rect reads answer from. */
  geom: { wrapBottom: number; wrapSize: number; overhangBottom: number; scale: number };
  /** Every style.top the applier wrote ('' = removeProperty), in order. */
  writes: string[];
}

function makeRig(): Rig {
  const stack = document.createElement('div');
  const wrap = document.createElement('div');
  const overhang = document.createElement('div');
  const geom = { wrapBottom: 268, wrapSize: 170, overhangBottom: 274, scale: 1 };
  const rect = (bottom: () => number, size: () => number) => () =>
    ({ bottom: bottom(), width: size(), height: size() }) as DOMRect;
  wrap.getBoundingClientRect = rect(
    () => geom.wrapBottom,
    () => geom.wrapSize,
  );
  overhang.getBoundingClientRect = rect(
    () => geom.overhangBottom,
    () => 20,
  );
  const writes: string[] = [];
  const style = stack.style;
  const rawSet = style.setProperty.bind(style);
  const rawRemove = style.removeProperty.bind(style);
  style.setProperty = (name, value, priority) => {
    if (name === 'top') writes.push(String(value));
    rawSet(name, value, priority ?? undefined);
  };
  style.removeProperty = (name) => {
    if (name === 'top') writes.push('');
    return rawRemove(name);
  };
  // happy-dom routes `style.top = x` through the property setter, not
  // setProperty, so mirror the applier's writes by defining the property.
  Object.defineProperty(style, 'top', {
    get: () => style.getPropertyValue('top'),
    set: (value: string) => {
      writes.push(value);
      rawSet('top', value);
    },
  });
  const anchor = new TrackerStackAnchor({
    stack: () => stack,
    minimapWrap: () => wrap,
    overhangs: () => [overhang, null],
    uiScale: () => geom.scale,
  });
  return { anchor, stack, geom, writes };
}

describe('TrackerStackAnchor', () => {
  it('writes the computed seat, overhang included, and elides an unchanged re-apply', () => {
    const { anchor, geom, writes } = makeRig();
    anchor.apply();
    expect(writes).toEqual([`${274 + TRACKER_STACK_ANCHOR_GAP_PX}px`]);
    anchor.apply();
    anchor.apply();
    expect(writes).toHaveLength(1);
    // The column moved (a wrapping zone label): the seat follows.
    geom.wrapBottom = 300;
    geom.overhangBottom = 306;
    anchor.apply();
    expect(writes).toEqual([
      `${274 + TRACKER_STACK_ANCHOR_GAP_PX}px`,
      `${306 + TRACKER_STACK_ANCHOR_GAP_PX}px`,
    ]);
  });

  it('clears the inline seat when the column hides, restoring the stylesheet top', () => {
    const { anchor, geom, writes } = makeRig();
    anchor.apply();
    geom.wrapSize = 0; // display:none measures 0x0
    anchor.apply();
    expect(writes[writes.length - 1]).toBe('');
    // And hidden stays elided: no repeated removeProperty churn.
    anchor.apply();
    expect(writes).toHaveLength(2);
  });

  it('divides by the live uiScale at apply time', () => {
    const { anchor, geom, writes } = makeRig();
    geom.scale = 2;
    anchor.apply();
    expect(writes).toEqual([`${Math.round(274 / 2) + TRACKER_STACK_ANCHOR_GAP_PX}px`]);
  });

  interface InstallRig {
    stack: HTMLElement;
    geom: { bottom: number; measures: number };
    /** rAF callbacks captured by the stub, in schedule order. */
    frames: Array<() => void>;
    cancelled: number[];
    /** Every (type, handler) the install registered / removed on window. */
    added: Array<{ type: string; handler: unknown }>;
    removed: Array<{ type: string; handler: unknown }>;
    dispose(): void;
    restore(): void;
  }

  /** Install over a synchronous rAF stub so the coalescing is observable, with
   *  the resize listener registration captured so dispose can be proven to
   *  remove the SAME handler it added (not merely starve it via pending). */
  function installRig(): InstallRig {
    const stack = document.createElement('div');
    const wrap = document.createElement('div');
    const geom = { bottom: 268, measures: 0 };
    wrap.getBoundingClientRect = () => {
      geom.measures++;
      return { bottom: geom.bottom, width: 170, height: 250 } as DOMRect;
    };
    const frames: Array<() => void> = [];
    const cancelled: number[] = [];
    const added: Array<{ type: string; handler: unknown }> = [];
    const removed: Array<{ type: string; handler: unknown }> = [];
    const rawRaf = window.requestAnimationFrame;
    const rawCancel = window.cancelAnimationFrame;
    const rawAdd = window.addEventListener.bind(window);
    const rawRemove = window.removeEventListener.bind(window);
    window.requestAnimationFrame = ((cb: () => void) => frames.push(cb)) as never;
    window.cancelAnimationFrame = ((id: number) => cancelled.push(id)) as never;
    window.addEventListener = ((type: string, handler: never, opts: never) => {
      added.push({ type, handler });
      rawAdd(type, handler, opts);
    }) as never;
    window.removeEventListener = ((type: string, handler: never, opts: never) => {
      removed.push({ type, handler });
      rawRemove(type, handler, opts);
    }) as never;
    const installed = installTrackerStackAnchor({
      stack: () => stack,
      minimapWrap: () => wrap,
      overhangs: () => [],
      uiScale: () => 1,
    });
    expect(installed.anchor).toBeInstanceOf(TrackerStackAnchor);
    return {
      stack,
      geom,
      frames,
      cancelled,
      added,
      removed,
      dispose: installed.dispose,
      restore: () => {
        window.requestAnimationFrame = rawRaf;
        window.cancelAnimationFrame = rawCancel;
        window.addEventListener = rawAdd as never;
        window.removeEventListener = rawRemove as never;
      },
    };
  }

  it('install seats once immediately, then coalesces a resize burst into ONE frame', () => {
    const rig = installRig();
    try {
      expect(rig.stack.style.top).toBe(`${268 + TRACKER_STACK_ANCHOR_GAP_PX}px`);
      const measuresAfterInstall = rig.geom.measures;
      // A drag-resize fires the event at frame rate: five synchronous events
      // must schedule exactly one frame and measure NOTHING until it runs.
      rig.geom.bottom = 300;
      for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('resize'));
      expect(rig.frames).toHaveLength(1);
      expect(rig.geom.measures).toBe(measuresAfterInstall);
      rig.frames[0]();
      expect(rig.stack.style.top).toBe(`${300 + TRACKER_STACK_ANCHOR_GAP_PX}px`);
      expect(rig.geom.measures).toBe(measuresAfterInstall + 1);
      // The frame drained the pending slot: the next event schedules again.
      window.dispatchEvent(new Event('resize'));
      expect(rig.frames).toHaveLength(2);
    } finally {
      rig.dispose();
      rig.restore();
    }
  });

  it('dispose removes the resize listener and cancels a pending frame', () => {
    const rig = installRig();
    try {
      window.dispatchEvent(new Event('resize'));
      expect(rig.frames).toHaveLength(1);
      rig.dispose();
      // The EXACT scheduled handle is cancelled (the stub minted id 1), so a
      // stale or wrong-handle cancel cannot pass.
      expect(rig.cancelled).toEqual([1]);
      // The SAME handler reference the install registered is what dispose
      // removed: proving removal by identity, not by the pending-slot side
      // channel a two-line mutation could starve.
      expect(rig.added.filter((e) => e.type === 'resize')).toHaveLength(1);
      expect(rig.removed).toEqual(rig.added.filter((e) => e.type === 'resize'));
      // And behaviorally: a later resize schedules nothing.
      window.dispatchEvent(new Event('resize'));
      expect(rig.frames).toHaveLength(1);
    } finally {
      rig.restore();
    }
  });

  it('dispose with no pending frame cancels nothing, and a second dispose is inert', () => {
    const rig = installRig();
    try {
      rig.dispose();
      expect(rig.cancelled).toEqual([]);
      rig.dispose();
      expect(rig.cancelled).toEqual([]);
      expect(rig.removed.filter((e) => e.type === 'resize')).toHaveLength(2);
    } finally {
      rig.restore();
    }
  });

  it('one apply costs one rect read per measured element (the header ceiling)', () => {
    // The production shape passes two overhangs (zoom pill, clock), so one
    // apply is bounded at three reads; this rig drives that exact shape and
    // counts every rect call, closing the gap a source-count alone leaves
    // (the second call site is inside a map over however many overhangs the
    // host hands over).
    const mk = (bottom: number, reads: { n: number }): HTMLElement => {
      const el = document.createElement('div');
      el.getBoundingClientRect = () => {
        reads.n++;
        return { bottom, width: 20, height: 20 } as DOMRect;
      };
      return el;
    };
    const reads = { n: 0 };
    const anchor = new TrackerStackAnchor({
      stack: () => document.createElement('div'),
      minimapWrap: () => mk(268, reads),
      overhangs: () => [mk(274, reads), mk(266, reads)],
      uiScale: () => 1,
    });
    reads.n = 0;
    anchor.apply();
    expect(reads.n).toBe(3);
  });
});

describe('tracker_stack_anchor source pins', () => {
  // The module is bare-named on purpose (a controller/painter name would put
  // it under the painter gate's scans, whose write contract it cannot satisfy:
  // the fallback path needs removeProperty, a verb the elided facet lacks).
  // These pins are what hold the header's cadence and write claims instead.
  // COMMENT-STRIPPED before every pin: the module header narrates the same
  // tokens in prose, so a raw read would let a comment stand in for the real
  // call (and would red the exact counts on a harmless comment edit). The
  // counts assume the house formatting (biome keeps a member call on one
  // line); a spelling like a captured window alias would move them, which is
  // accepted: it would be a deliberate edit to a five-line module, not drift.
  // Resolved via node:path, not `new URL`: this suite runs under happy-dom,
  // whose URL global refuses the file scheme composition the node arm allows.
  const stripComments = (text: string): string =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const src = stripComments(
    readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../src/ui/tracker_stack_anchor.ts'),
      'utf8',
    ),
  );

  it('bounds the layout reads: exactly two getBoundingClientRect call sites', () => {
    // The per-apply ceiling itself is behavioral (the three-read test above);
    // this pin holds the SITE count so a new read cannot land unnoticed.
    expect(src.split('.getBoundingClientRect()').length - 1).toBe(2);
  });

  it('owns exactly one seat write and one removal, both elided behind lastTopPx', () => {
    expect(src.split('.style.top =').length - 1).toBe(1);
    expect(src.split(".removeProperty('top')").length - 1).toBe(1);
    expect(src).toContain('if (top === this.lastTopPx) return;');
  });

  it('keeps the resize path coalesced and disposable', () => {
    expect(src.split('window.addEventListener').length - 1).toBe(1);
    expect(src).toContain('window.requestAnimationFrame');
    expect(src).toContain('window.removeEventListener');
    expect(src).toContain('window.cancelAnimationFrame');
  });
});
