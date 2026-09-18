// The touch-layout drag of the class engine indicators, pure half
// (src/ui/touch_frame_drag_core.ts): the frames table resolves exactly the
// three engine indicators against the unlock registry under the pre-registry
// storage keys, the viewport-fraction clamp keeps a frame's VISUAL body inside
// every side of the safe area (each inset exercised on its own), the storage
// round-trip survives malformed input, the drag arithmetic keeps the grab
// offset, and the inset parse survives an unresolved env(). The DOM attacher
// is the thin consumer (tests/touch_frame_drag.test.ts).
import { describe, expect, it } from 'vitest';
import { HUD_FRAME_SPECS } from '../src/ui/interface_unlock_core';
import { transferKeyAllowed } from '../src/ui/settings_transfer_core';
import {
  clampTouchFrameAnchor,
  draggedTouchFrameAnchor,
  parseTouchFrameAnchor,
  safeAreaFromPadding,
  serializeTouchFrameAnchor,
  TOUCH_ANCHOR_X_PROP,
  TOUCH_ANCHOR_Y_PROP,
  TOUCH_DRAG_FRAMES,
  TOUCH_DRAGGING_CLASS,
  TOUCH_PLACED_CLASS,
  touchFrameAnchorCss,
} from '../src/ui/touch_frame_drag_core';

describe('TOUCH_DRAG_FRAMES', () => {
  it('names exactly the three class engine indicators, resolved against the unlock registry', () => {
    expect(TOUCH_DRAG_FRAMES.map((row) => row.frameId)).toEqual([
      'procOverlay',
      'paladinDevotion',
      'doomMeter',
    ]);
    for (const row of TOUCH_DRAG_FRAMES) {
      const spec = HUD_FRAME_SPECS.find((s) => s.id === row.frameId);
      expect(spec, row.frameId).toBeDefined();
      expect(row.elementId, row.frameId).toBe(spec?.elementId);
    }
    // The elements the desktop editor moves, by their real ids.
    expect(TOUCH_DRAG_FRAMES.map((row) => row.elementId)).toEqual([
      'proc-overlay',
      'paladin-devotion-frame',
      'warlock-doom-frame',
    ]);
  });

  it('keeps the pre-registry storage keys, so a parked phoenix or medallion is found where it was left', () => {
    const keys = Object.fromEntries(TOUCH_DRAG_FRAMES.map((row) => [row.frameId, row.storageKey]));
    expect(keys).toEqual({
      procOverlay: 'procOverlayAnchor',
      paladinDevotion: 'paladinDevotionAnchor',
      doomMeter: 'warlockDoomAnchor',
    });
    expect(new Set(TOUCH_DRAG_FRAMES.map((row) => row.storageKey)).size).toBe(
      TOUCH_DRAG_FRAMES.length,
    );
  });

  it('never shares a key with a registry row: the desktop spot and the touch spot coexist', () => {
    const registryKeys = new Set(HUD_FRAME_SPECS.map((s) => s.storageKey));
    // The positive control: every registry row really carries a distinct key,
    // so the negative below cannot pass vacuously against a set of undefineds.
    expect(registryKeys.size).toBe(HUD_FRAME_SPECS.length);
    for (const { storageKey } of TOUCH_DRAG_FRAMES) {
      expect(registryKeys.has(storageKey), storageKey).toBe(false);
    }
  });

  it('rides the FULL transfer code like the two anchors always did, never the layout code', () => {
    for (const { storageKey } of TOUCH_DRAG_FRAMES) {
      expect(transferKeyAllowed('full', storageKey), storageKey).toBe(true);
      expect(transferKeyAllowed('frames', storageKey), storageKey).toBe(false);
    }
  });

  it('pins the class and property names the stylesheet reads', () => {
    expect(TOUCH_PLACED_CLASS).toBe('tf-touch-placed');
    expect(TOUCH_DRAGGING_CLASS).toBe('tf-touch-dragging');
    expect(TOUCH_ANCHOR_X_PROP).toBe('--touch-fx');
    expect(TOUCH_ANCHOR_Y_PROP).toBe('--touch-fy');
  });
});

describe('clampTouchFrameAnchor', () => {
  it('keeps the whole element on screen', () => {
    // 300x232 element in a 1600x900 viewport: half-width = 150/1600.
    expect(clampTouchFrameAnchor(0, 0, 300, 232, 1600, 900)).toEqual({
      fx: 150 / 1600,
      fy: 116 / 900,
    });
    expect(clampTouchFrameAnchor(1, 1, 300, 232, 1600, 900)).toEqual({
      fx: 1 - 150 / 1600,
      fy: 1 - 116 / 900,
    });
  });

  it('passes an in-bounds anchor through unchanged', () => {
    expect(clampTouchFrameAnchor(0.5, 0.42, 300, 232, 1600, 900)).toEqual({ fx: 0.5, fy: 0.42 });
  });

  it('keeps the whole element clear of every side of an asymmetric mobile safe area', () => {
    // All four insets distinct and non-zero, so each is exercised on its own:
    // the notch (top), the home indicator (bottom) and both landscape ears.
    const safeArea = { top: 47, right: 44, bottom: 21, left: 12 };
    const bottomLeft = clampTouchFrameAnchor(0, 1, 72, 72, 844, 390, safeArea);
    expect(bottomLeft.fx).toBeCloseTo((12 + 36) / 844);
    expect(bottomLeft.fy).toBeCloseTo((390 - 21 - 36) / 390);
    const topRight = clampTouchFrameAnchor(1, 0, 72, 72, 844, 390, safeArea);
    expect(topRight.fx).toBeCloseTo((844 - 44 - 36) / 844);
    expect(topRight.fy).toBeCloseTo((47 + 36) / 390);
  });

  it('clamps by the VISUAL size it is given, so a scaled-down phoenix can reach the edges', () => {
    // The 300x232 overlay at the touch layout's 0.2 scale measures 60x46: its
    // center may sit 30px from a side, not 150px.
    expect(clampTouchFrameAnchor(0, 0.5, 60, 46, 844, 390)).toEqual({ fx: 30 / 844, fy: 0.5 });
  });

  it('centers an element wider or taller than the usable area instead of pinning it to one side', () => {
    expect(clampTouchFrameAnchor(0, 0.5, 1000, 46, 844, 390).fx).toBe(0.5);
    expect(clampTouchFrameAnchor(0.5, 0, 60, 1000, 844, 390).fy).toBe(0.5);
    // With insets, the center of the usable band, not of the viewport.
    const banded = clampTouchFrameAnchor(0, 0, 1000, 1000, 844, 390, {
      top: 0,
      right: 0,
      bottom: 90,
      left: 44,
    });
    expect(banded.fx).toBeCloseTo((44 + 844) / 2 / 844);
    expect(banded.fy).toBeCloseTo((390 - 90) / 2 / 390);
  });

  it('caps an inset at the viewport and treats an unparseable one as none, so the bounds never invert', () => {
    // A left inset wider than the viewport leaves no usable band at all: the
    // capped bounds put the center at the far edge (finite, in range) rather
    // than off screen or NaN.
    const capped = clampTouchFrameAnchor(0.5, 0.5, 60, 46, 844, 390, {
      top: 0,
      right: 0,
      bottom: 0,
      left: 9999,
    });
    expect(capped).toEqual({ fx: 1, fy: 0.5 });
    // Without the cap the inverted bounds would have thrown the center past 1.
    expect(capped.fx).toBeLessThanOrEqual(1);
    expect(
      clampTouchFrameAnchor(0.1, 0.1, 60, 46, 844, 390, {
        top: Number.NaN,
        right: 0,
        bottom: 0,
        left: Number.NaN,
      }),
    ).toEqual({ fx: 0.1, fy: 0.1 });
  });

  it('degrades to center on a degenerate viewport instead of NaN', () => {
    expect(clampTouchFrameAnchor(Number.NaN, 0.5, 300, 232, 0, 0)).toEqual({ fx: 0.5, fy: 0.5 });
  });
});

describe('the storage round-trip', () => {
  it('serializes and parses an anchor exactly', () => {
    const raw = serializeTouchFrameAnchor({ fx: 0.25, fy: 0.75 });
    expect(JSON.parse(raw)).toEqual({ fx: 0.25, fy: 0.75 });
    expect(parseTouchFrameAnchor(raw)).toEqual({ fx: 0.25, fy: 0.75 });
  });

  it('clamps a stored anchor into 0..1 and rejects anything malformed', () => {
    expect(parseTouchFrameAnchor(JSON.stringify({ fx: 1.5, fy: -2 }))).toEqual({ fx: 1, fy: 0 });
    expect(parseTouchFrameAnchor(null)).toBeNull();
    expect(parseTouchFrameAnchor('')).toBeNull();
    expect(parseTouchFrameAnchor('garbage')).toBeNull();
    expect(parseTouchFrameAnchor(JSON.stringify({ fx: '0.5', fy: 0.5 }))).toBeNull();
    expect(parseTouchFrameAnchor(JSON.stringify({ fx: Number.NaN, fy: 0.5 }))).toBeNull();
    expect(parseTouchFrameAnchor(JSON.stringify({ fy: 0.5 }))).toBeNull();
  });
});

describe('draggedTouchFrameAnchor', () => {
  it('puts the center where the pointer is, minus the offset it grabbed the frame at', () => {
    // Grabbed 20px right of and 13px below the center, now at (420, 213).
    expect(draggedTouchFrameAnchor(420, 213, 20, 13, 1000, 500)).toEqual({ fx: 0.4, fy: 0.4 });
  });

  it('degrades to center on a degenerate viewport instead of NaN', () => {
    expect(draggedTouchFrameAnchor(10, 10, 0, 0, 0, 0)).toEqual({ fx: 0.5, fy: 0.5 });
  });
});

describe('touchFrameAnchorCss', () => {
  it('writes the anchor as two-decimal percentages', () => {
    expect(touchFrameAnchorCss({ fx: 0.5, fy: 0.42 })).toEqual({ x: '50.00%', y: '42.00%' });
    expect(touchFrameAnchorCss({ fx: 1 / 3, fy: 2 / 3 })).toEqual({ x: '33.33%', y: '66.67%' });
  });
});

describe('safeAreaFromPadding', () => {
  it('reads the four resolved paddings as px insets', () => {
    expect(
      safeAreaFromPadding({ top: '47px', right: '44px', bottom: '21px', left: '12.5px' }),
    ).toEqual({ top: 47, right: 44, bottom: 21, left: 12.5 });
  });

  it('counts an unresolved or empty value as no inset', () => {
    expect(
      safeAreaFromPadding({
        top: 'env(safe-area-inset-top)',
        right: '',
        bottom: 'auto',
        left: '0px',
      }),
    ).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });
});
