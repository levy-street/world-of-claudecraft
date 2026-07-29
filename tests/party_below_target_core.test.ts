// The party frames' below-target offset: the pure calc that replaced the
// hand-tuned top constants (96px desktop, +135px/+105px mobile), which cleared
// only the target frame BODY and let the #tf-debuffs strip overlap the first
// party frame once the target carried enough auras. The frames' top now derives
// from the target stack's MEASURED bottom (frame + debuff strip), so it is
// correct at any buff count, UI scale, and dragged frame position. Also pins
// the var-driven CSS rules (desktop + both mobile tiers) and the painter's
// measure gating, so the magic constants cannot quietly return.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { PainterHostWriters } from '../src/ui/painter_host';
import {
  type MeasuredBox,
  type PartyBelowTargetInputs,
  partyBelowTargetBottom,
} from '../src/ui/party_below_target_core';
import {
  PARTY_BELOW_TARGET_BOTTOM_PROP,
  PARTY_ROWS_LIMIT_PROP,
  PARTY_ROWS_TOP_PROP,
  PartyBelowTargetPainter,
} from '../src/ui/party_below_target_painter';

const box = (left: number, right: number, bottom: number): MeasuredBox => ({
  left,
  right,
  bottom,
});

// The default-anchor scene at UI scale 1: frame at 12..232 ending at 88, party
// column at 12..182 (the real desktop defaults, rounded).
const base = (over: Partial<PartyBelowTargetInputs> = {}): PartyBelowTargetInputs => ({
  frame: box(12, 232, 88),
  debuffs: null,
  party: { left: 12, right: 182 },
  uiScale: 1,
  ...over,
});

describe('partyBelowTargetBottom (pure calc)', () => {
  it('returns the frame bottom when the strip is empty', () => {
    expect(partyBelowTargetBottom(base())).toBe(88);
  });

  it('extends to the debuff strip bottom when it hangs lower (the bug case)', () => {
    // Three wrapped debuff rows ending at 199px: the old fixed 96px offset left
    // the first party frame overlapped by 103px; the calc must clear it.
    expect(partyBelowTargetBottom(base({ debuffs: box(12, 232, 199) }))).toBe(199);
  });

  it('divides the measured (post-zoom) bottom back to author space by uiScale', () => {
    expect(partyBelowTargetBottom(base({ debuffs: box(12, 232, 199), uiScale: 1.25 }))).toBe(
      199 / 1.25,
    );
  });

  it('falls back to scale 1 for a non-finite or non-positive uiScale', () => {
    expect(partyBelowTargetBottom(base({ uiScale: Number.NaN }))).toBe(88);
    expect(partyBelowTargetBottom(base({ uiScale: 0 }))).toBe(88);
    expect(partyBelowTargetBottom(base({ uiScale: -2 }))).toBe(88);
  });

  it('returns null when there is no target frame', () => {
    expect(partyBelowTargetBottom(base({ frame: null }))).toBeNull();
  });

  it('returns null when the stack does not horizontally overlap the party column', () => {
    // Target frame dragged to the right half of the screen: the frames keep
    // their base anchor instead of dropping for no reason.
    expect(
      partyBelowTargetBottom(base({ frame: box(900, 1120, 88), debuffs: box(900, 1120, 199) })),
    ).toBeNull();
  });

  it('still pushes when only the debuff strip reaches the party column', () => {
    expect(
      partyBelowTargetBottom(base({ frame: box(400, 620, 88), debuffs: box(100, 620, 144) })),
    ).toBe(144);
  });

  it('returns null for a missing or zero-width party span', () => {
    expect(partyBelowTargetBottom(base({ party: null }))).toBeNull();
    expect(partyBelowTargetBottom(base({ party: { left: 12, right: 12 } }))).toBeNull();
  });

  it('returns null for a degenerate measure (hidden frame rect)', () => {
    expect(partyBelowTargetBottom(base({ frame: box(0, 0, 0) }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The painter's measure gating: rect reads happen only when the cheap key
// changes, and the property write routes through the elided setStyleProp.
// ---------------------------------------------------------------------------

interface StubRect {
  left: number;
  right: number;
  bottom: number;
  top?: number;
  height?: number;
}

interface StubEl {
  attrs: Record<string, string>;
  rect: StubRect;
  children: number;
  rectReads: number;
}

function stubEl(rect: StubRect, children = 0): StubEl {
  return { attrs: {}, rect, children, rectReads: 0 };
}

function asHtmlEl(el: StubEl, root: StubEl): HTMLElement {
  return {
    getAttribute: (name: string) => el.attrs[name] ?? null,
    get childElementCount() {
      return el.children;
    },
    getBoundingClientRect() {
      el.rectReads++;
      return {
        left: el.rect.left,
        right: el.rect.right,
        bottom: el.rect.bottom,
        top: el.rect.top ?? 0,
        height: el.rect.height ?? 0,
      };
    },
    ownerDocument: {
      documentElement: {
        getAttribute: (name: string) => root.attrs[name] ?? null,
      },
    },
  } as unknown as HTMLElement;
}

function recordingWriters(): { writers: PainterHostWriters; props: Map<string, string> } {
  const props = new Map<string, string>();
  const noop = () => {};
  return {
    writers: {
      setText: noop,
      setDisplay: noop,
      setTransform: noop,
      setWidth: noop,
      setStyleProp: (_el, prop, value) => props.set(prop, value),
      toggleClass: noop,
      setAttr: noop,
    },
    props,
  };
}

describe('PartyBelowTargetPainter (measure gating + property write)', () => {
  function build() {
    const root = stubEl({ left: 0, right: 0, bottom: 0 });
    const frame = stubEl({ left: 12, right: 232, bottom: 88 });
    const debuffs = stubEl({ left: 12, right: 232, bottom: 199 }, 8);
    const container = stubEl({ left: 12, right: 182, bottom: 400 });
    const rows = stubEl({ left: 12, right: 236, bottom: 296, top: 227 });
    const moveWheel = stubEl({ left: 18, right: 136, bottom: 364, top: 266, height: 98 });
    const moveZone = stubEl({ left: 0, right: 132, bottom: 390, top: 250, height: 140 });
    const { writers, props } = recordingWriters();
    const painter = new PartyBelowTargetPainter(
      writers,
      {
        container: asHtmlEl(container, root),
        frame: asHtmlEl(frame, root),
        debuffs: asHtmlEl(debuffs, root),
        rows: () => asHtmlEl(rows, root),
        moveWheel: () => asHtmlEl(moveWheel, root),
        moveZone: () => asHtmlEl(moveZone, root),
      },
      { innerWidth: 1600, innerHeight: 900 },
    );
    return { painter, frame, debuffs, container, rows, moveWheel, moveZone, props };
  }

  it('measures once, writes the author-space bottom, and elides steady frames', () => {
    const { painter, frame, debuffs, props } = build();
    expect(painter.update(true, 5, false)).toBe(199);
    expect(props.get(PARTY_BELOW_TARGET_BOTTOM_PROP)).toBe('199.0px');
    expect(frame.rectReads).toBe(1);
    expect(debuffs.rectReads).toBe(1);
    // Steady state: same inputs, no further layout reads.
    for (let i = 0; i < 5; i++) expect(painter.update(true, 5, false)).toBe(199);
    expect(frame.rectReads).toBe(1);
    expect(debuffs.rectReads).toBe(1);
  });

  it('re-measures when the debuff count changes and when the frame moves', () => {
    const { painter, frame, debuffs, props } = build();
    painter.update(true, 5, false);
    debuffs.children = 18;
    debuffs.rect.bottom = 254;
    expect(painter.update(true, 5, false)).toBe(254);
    expect(props.get(PARTY_BELOW_TARGET_BOTTOM_PROP)).toBe('254.0px');
    expect(frame.rectReads).toBe(2);
    // A drag commit updates the frame's inline style: the key must catch it.
    frame.attrs.style = 'left: 900px; top: 40px;';
    frame.rect = { left: 900, right: 1120, bottom: 116 };
    debuffs.rect = { left: 900, right: 1120, bottom: 254 };
    expect(painter.update(true, 5, false)).toBeNull();
    expect(props.get(PARTY_BELOW_TARGET_BOTTOM_PROP)).toBe('initial');
  });

  it('writes the rows-bound sensors while pushing: pad top on mobile, viewport bottom on desktop', () => {
    const { painter, props } = build();
    // Desktop: the limit is the viewport bottom (the injected 900px window),
    // so a long roster scrolls instead of running off screen.
    painter.update(true, 5, false);
    expect(props.get(PARTY_ROWS_TOP_PROP)).toBe('227.0px');
    expect(props.get(PARTY_ROWS_LIMIT_PROP)).toBe('900.0px');
    // Mobile with a resting wheel: the rows top and the WHEEL top written
    // (author space); the zone's invisible top band is tradeable, so the
    // resting wheel is the preferred bound.
    painter.update(true, 5, true);
    expect(props.get(PARTY_ROWS_TOP_PROP)).toBe('227.0px');
    expect(props.get(PARTY_ROWS_LIMIT_PROP)).toBe('266.0px');
  });

  it('does not re-measure for the wheel class alone (no layout read mid-drag)', () => {
    // memberCount is held FIXED across every assertion here: the wheel's class
    // is deliberately absent from the invalidation key, so it must be the only
    // thing that changed for this to pin the documented behavior (an earlier
    // version of this test bumped memberCount between arms, which meant the
    // class was never shown to drive anything).
    const { painter, moveWheel, rows, props } = build();
    painter.update(true, 5, true);
    expect(props.get(PARTY_ROWS_LIMIT_PROP)).toBe('266.0px');
    const readsAfterFirst = rows.rectReads;
    // Drag starts: the wheel springs under the thumb and gains .floating. The
    // bound stays the (now stale) resting-wheel value and costs NO layout read,
    // which is the point: keying this would measure on every drag start/end.
    moveWheel.attrs.class = 'mobile-joystick floating';
    painter.update(true, 5, true);
    expect(rows.rectReads).toBe(readsAfterFirst);
    expect(props.get(PARTY_ROWS_LIMIT_PROP)).toBe('266.0px');
    // A real key change landing mid-drag DOES re-measure, and then the sprung
    // wheel is skipped in favor of the static capture zone.
    painter.update(true, 6, true);
    expect(rows.rectReads).toBe(readsAfterFirst + 1);
    expect(props.get(PARTY_ROWS_LIMIT_PROP)).toBe('250.0px');
  });

  it('falls back to the viewport bottom on mobile when the pad is unusable', () => {
    // Symmetry with desktop: an unusable pad must not leave the rows unbounded
    // (the mobile below-target rule out-specifies the base tier's own bound,
    // so "no sensors" would mean "no bound" and reintroduce the off-screen
    // roster this PR fixed).
    const { painter, moveWheel, moveZone, props } = build();
    moveWheel.rect.height = 0;
    moveZone.rect.height = 0;
    painter.update(true, 5, true);
    expect(props.get(PARTY_ROWS_LIMIT_PROP)).toBe('900.0px');
    expect(props.get(PARTY_ROWS_TOP_PROP)).toBe('227.0px');
  });

  it('re-measures after a content-driven size change (ResizeObserver epoch)', () => {
    // A cast bar appearing under the target's HP grows the frame without
    // touching any attribute the key reads; the painter's ResizeObserver must
    // bump its epoch so the next update re-measures.
    const fired: Array<() => void> = [];
    class FakeResizeObserver {
      constructor(cb: () => void) {
        fired.push(cb);
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    const globals = globalThis as { ResizeObserver?: unknown };
    const prev = globals.ResizeObserver;
    globals.ResizeObserver = FakeResizeObserver;
    try {
      const { painter, frame, props } = build();
      expect(fired.length).toBe(1);
      expect(painter.update(true, 5, false)).toBe(199);
      expect(frame.rectReads).toBe(1);
      frame.rect.bottom = 250;
      for (const cb of fired) cb();
      expect(painter.update(true, 5, false)).toBe(250);
      expect(props.get(PARTY_BELOW_TARGET_BOTTOM_PROP)).toBe('250.0px');
      expect(frame.rectReads).toBe(2);
    } finally {
      globals.ResizeObserver = prev;
    }
  });

  it('unsets the property and reports null while no target is shown', () => {
    const { painter, frame, props } = build();
    painter.update(true, 5, false);
    expect(painter.update(false, 5, false)).toBeNull();
    expect(props.get(PARTY_BELOW_TARGET_BOTTOM_PROP)).toBe('initial');
    // No re-measure while off, and a fresh measure once a target returns.
    expect(frame.rectReads).toBe(1);
    expect(painter.update(true, 5, false)).toBe(199);
    expect(frame.rectReads).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// CSS pins: the below-target rules derive from the measured var on desktop AND
// both mobile tiers; the old magic constants must not return.
// ---------------------------------------------------------------------------

describe('below-target CSS derives from the measured bottom', () => {
  // Biome wraps a long declaration across lines, so pin against a
  // whitespace-normalized view of the source (collapse runs of whitespace,
  // drop the space a wrap leaves inside parentheses); a reformat then never
  // breaks a pin, only a value change does.
  const flat = (css: string): string =>
    css.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')');
  const hudCss = flat(readFileSync(new URL('../src/styles/hud.css', import.meta.url), 'utf8'));
  const hudMobileCss = flat(
    readFileSync(new URL('../src/styles/hud.mobile.css', import.meta.url), 'utf8'),
  );

  it('desktop: var-driven top with the old 96px only as the var fallback', () => {
    expect(hudCss).toContain('top: calc(var(--party-below-target-bottom, 88px) + 8px);');
    expect(hudCss).not.toContain('top: 96px');
  });

  it('desktop: pushed rows are viewport-bounded and scroll (10-raid off-screen case)', () => {
    const rule = hudCss.match(/#party-frames\.below-target \.party-rows \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain(
      'max-height: max(40px, calc((var(--party-rows-limit, 100dvh) - var(--party-rows-top, 0px) - 12px + var(--party-rows-frame-pad)) / var(--party-frame-scale, 1)));',
    );
    expect(rule).toContain('overflow: auto;');
  });

  it('desktop: the scroll container leaves room for the keyline and focus ring', () => {
    // The grid column is exactly one frame wide, so a bare overflow container
    // clips the .panel outline (1px) and the 5px :focus-visible ring on every
    // frame whenever a target is selected, overflow or not. The padding gives
    // that paint room; the equal negative margin keeps the frames in place.
    const rule = hudCss.match(/#party-frames\.below-target \.party-rows \{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toContain('--party-rows-frame-pad: 6px;');
    expect(rule).toContain('padding: var(--party-rows-frame-pad);');
    expect(rule).toContain('margin: calc(-1 * var(--party-rows-frame-pad));');
  });

  it('strip box owns its hanging timer text (wrap row gap + last-row padding)', () => {
    // The wrap row gap reserves the 13px .buff .dur overhang between rows and
    // the bottom padding folds the last row's timers into the measured box.
    const strip = hudCss.match(/#target-frame > #tf-debuffs \{([^}]*)\}/)?.[1] ?? '';
    expect(strip).toContain('gap: 17px 4px;');
    expect(strip).toContain('padding-bottom: 13px;');
  });

  it('mobile base tier: var-driven top and a measured joystick-clearing rows bound', () => {
    expect(hudMobileCss).toContain(
      'top: calc(var(--party-below-target-bottom, calc(max(8px, env(safe-area-inset-top)) + 127px)) + 8px);',
    );
    expect(hudMobileCss).toContain(
      'max-height: max(40px, calc(var(--party-rows-limit, 100dvh) - var(--party-rows-top, 0px) - 8px + var(--party-rows-frame-pad, 6px)));',
    );
    expect(hudMobileCss).not.toContain('top: calc(max(8px, env(safe-area-inset-top)) + 135px);');
    // The old fixed screen-bottom reserve must not return alongside the
    // measured bound.
    expect(hudMobileCss).not.toContain(
      'max-height: calc(100dvh - max(8px, env(safe-area-inset-top)) - 190px);',
    );
  });

  it('mobile landscape tier: var-driven top, measured bound inherited from base', () => {
    expect(hudMobileCss).toContain(
      'top: calc(var(--party-below-target-bottom, calc(max(6px, env(safe-area-inset-top)) + 97px)) + 8px);',
    );
    expect(hudMobileCss).not.toContain('top: calc(max(6px, env(safe-area-inset-top)) + 105px);');
    expect(hudMobileCss).not.toContain(
      'max-height: calc(100dvh - max(6px, env(safe-area-inset-top)) - 160px);',
    );
  });
});
