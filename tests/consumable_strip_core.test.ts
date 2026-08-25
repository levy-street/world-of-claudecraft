// The consumables seat's decision core: what a release means, when the row comes
// up, and which way it grows. Every branch the gesture layer can take is driven
// here, so the DOM module (consumable_strip_gesture_controller.ts) stays rule-free.

import { describe, expect, it } from 'vitest';
import {
  CONSUMABLE_STRIP_PITCH_PX,
  consumableStripCancelIsLive,
  resolveConsumableStripDirection,
  resolveConsumableStripRelease,
  shouldRevealConsumableStrip,
} from '../src/ui/hud/action_bar/consumable_strip_core';
import {
  STRIP_PITCH_PX,
  shouldRevealStrip,
  stripCancelIsLive,
} from '../src/ui/hud/action_bar/radial_action_core';

// The row's cancel-is-live and reveal-early rules are the SHARED strip rules
// under this row's names, and its pitch is the shared constant: the menu strip
// held byte-identical copies of all three, so an edit to one taught two
// different gestures with nothing checking it.
describe('the consumables row shares the strip rules rather than restating them', () => {
  it('takes its pitch from the shared constant', () => {
    expect(CONSUMABLE_STRIP_PITCH_PX).toBe(STRIP_PITCH_PX);
  });

  it('takes the cancel-is-live and reveal-early rules from the shared core', () => {
    expect(consumableStripCancelIsLive).toBe(stripCancelIsLive);
    expect(shouldRevealConsumableStrip).toBe(shouldRevealStrip);
  });
});

import {
  placeConsumableStrip,
  resolveStripIndex,
  STRIP_DEADZONE_PX,
} from '../src/ui/hud/action_bar/radial_action_core';

describe('resolveConsumableStripRelease', () => {
  it('uses the FIRST consumable on a bare tap (the mid-fight "heal now" case)', () => {
    expect(resolveConsumableStripRelease({ index: -1, revealed: false, count: 6 })).toEqual({
      kind: 'use',
      index: 0,
    });
  });

  it('cancels instead when the row was open and the finger came back to the seat', () => {
    // The distinction the whole cancel affordance rests on: the SAME index (-1),
    // opposite outcomes, decided only by whether the player saw the row.
    expect(resolveConsumableStripRelease({ index: -1, revealed: true, count: 6 })).toEqual({
      kind: 'cancel',
    });
  });

  it('uses the item the drag ended on', () => {
    expect(resolveConsumableStripRelease({ index: 3, revealed: true, count: 6 })).toEqual({
      kind: 'use',
      index: 3,
    });
  });

  it('clamps an index past the carried count rather than using nothing', () => {
    expect(resolveConsumableStripRelease({ index: 9, revealed: true, count: 2 })).toEqual({
      kind: 'use',
      index: 1,
    });
  });

  it('carries nothing, so there is nothing to use even on a bare tap', () => {
    expect(resolveConsumableStripRelease({ index: -1, revealed: false, count: 0 })).toEqual({
      kind: 'cancel',
    });
    expect(resolveConsumableStripRelease({ index: 2, revealed: true, count: 0 })).toEqual({
      kind: 'cancel',
    });
  });
});

describe('consumableStripCancelIsLive', () => {
  it('is live only once the row is open and the finger is in the seat band', () => {
    expect(consumableStripCancelIsLive(-1, true)).toBe(true);
    // Before the row is up the seat band is a plain tap, not a way out.
    expect(consumableStripCancelIsLive(-1, false)).toBe(false);
    expect(consumableStripCancelIsLive(0, true)).toBe(false);
  });
});

describe('shouldRevealConsumableStrip', () => {
  it('pulls the row up the moment a drag reaches an item', () => {
    expect(shouldRevealConsumableStrip(0, false)).toBe(true);
    expect(shouldRevealConsumableStrip(4, false)).toBe(true);
  });

  it('stays quiet inside the deadzone and never re-reveals an open row', () => {
    expect(shouldRevealConsumableStrip(-1, false)).toBe(false);
    expect(shouldRevealConsumableStrip(2, true)).toBe(false);
  });
});

describe('resolveConsumableStripDirection', () => {
  const ROW = { count: 6, itemSize: 46, gap: 8, viewportWidth: 844, margin: 6 };

  it('grows LEFT from the shipped right-handed seat', () => {
    // The seat sits above the attack button at the ring's right edge: 844 - 60.
    expect(resolveConsumableStripDirection({ ...ROW, anchorX: 784 })).toBe('left');
  });

  it('flips RIGHT for the left-handed mirror, where the left cannot hold the row', () => {
    expect(resolveConsumableStripDirection({ ...ROW, anchorX: 60 })).toBe('right');
  });

  it('keeps LEFT wherever the left side still fits the whole row', () => {
    // Exactly the span (6 * 54 + 23 = 347) plus the margin: the last position
    // that must not flip, so an off-by-one in the span maths shows up here.
    expect(resolveConsumableStripDirection({ ...ROW, anchorX: 353 })).toBe('left');
    expect(resolveConsumableStripDirection({ ...ROW, anchorX: 352 })).toBe('right');
  });

  it('takes the roomier side when neither can hold the row', () => {
    expect(resolveConsumableStripDirection({ ...ROW, anchorX: 120, viewportWidth: 400 })).toBe(
      'right',
    );
    expect(resolveConsumableStripDirection({ ...ROW, anchorX: 280, viewportWidth: 400 })).toBe(
      'left',
    );
  });
});

describe('the gesture pitch against the placement it drives', () => {
  it('reaches the last of six items inside a comfortable thumb arc', () => {
    // The reason the gesture pitch is not the visual pitch: at the drawn spacing
    // the sixth item would sit over 300px away, which is past a thumb arc.
    const visualPitch = 46 + 8;
    expect(CONSUMABLE_STRIP_PITCH_PX).toBeLessThan(visualPitch);
    expect(CONSUMABLE_STRIP_PITCH_PX * 6).toBeLessThanOrEqual(210);
    expect(visualPitch * 6).toBeGreaterThan(300);
  });

  it('walks index 0..5 leftward across the whole row', () => {
    const seen = [0, 1, 2, 3, 4, 5].map((i) =>
      resolveStripIndex(
        -(STRIP_DEADZONE_PX + CONSUMABLE_STRIP_PITCH_PX * i),
        CONSUMABLE_STRIP_PITCH_PX,
        6,
        STRIP_DEADZONE_PX,
        'left',
      ),
    );
    // The deadzone is smaller than the pitch, so the first band is still item 0.
    expect(seen[0]).toBe(0);
    expect(seen[5]).toBe(5);
    expect(seen).toEqual([...seen].sort((a, b) => a - b));
  });

  it('places every item left of the seat, with the cancel X still right of them all', () => {
    const anchorX = 784;
    const placement = placeConsumableStrip({
      anchorX,
      anchorY: 120,
      count: 6,
      itemSize: 46,
      gap: 8,
      viewportWidth: 844,
      margin: 6,
      direction: 'left',
    });
    expect(placement.centers).toHaveLength(6);
    for (const cx of placement.centers) expect(cx).toBeLessThan(anchorX);
    // The X sits ON the seat, so it is right of the rightmost item by exactly the
    // pitch, and the whole row still clears the screen edge.
    expect(anchorX - Math.max(...placement.centers)).toBeCloseTo(placement.pitch, 5);
    expect(Math.min(...placement.centers) - 23).toBeGreaterThanOrEqual(6);
  });
});
