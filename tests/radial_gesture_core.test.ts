// Tests for the radial gesture's decision core: what a press, a drag and a
// release MEAN. The DOM half (radial_gesture_controller.ts) owns no rules, so
// every branch
// a finger can take is decided here and driven without a browser.

import { describe, expect, it } from 'vitest';
import {
  FLICK_DEADZONE_PX,
  RADIAL_DIRECTIONS,
  type RadialDirection,
  resolveRadialDirection,
} from '../src/ui/hud/action_bar/radial_action_core';
import {
  radialCancelIsLive,
  resolveRadialPress,
  resolveRadialRelease,
  shouldRevealOnDrag,
} from '../src/ui/hud/action_bar/radial_gesture_core';

describe('resolveRadialPress', () => {
  it('claims a press when the active aim belongs to its physical button', () => {
    expect(resolveRadialPress({ aimOwnedByButton: true })).toEqual({ kind: 'cancel-aim' });
  });

  it('leaves a button that does not own the active aim on its normal path', () => {
    expect(resolveRadialPress({ aimOwnedByButton: false })).toEqual({ kind: 'continue' });
  });
});

function release(over: Partial<Parameters<typeof resolveRadialRelease>[0]> = {}) {
  return resolveRadialRelease({
    direction: 'center',
    revealed: false,
    hasSlot: true,
    consumedElsewhere: false,
    ...over,
  });
}

describe('resolveRadialRelease', () => {
  it('a quick tap casts the centre action', () => {
    expect(release()).toEqual({ kind: 'cast', direction: 'center' });
  });

  it('a flick casts the direction it resolved to, revealed or not', () => {
    for (const direction of RADIAL_DIRECTIONS.filter((d) => d !== 'center')) {
      expect(release({ direction })).toEqual({ kind: 'cast', direction });
      expect(release({ direction, revealed: true })).toEqual({ kind: 'cast', direction });
    }
  });

  it('releasing back at the anchor with the petals open CANCELS instead of casting', () => {
    // The centre action stays one plain tap away, so committing to it here
    // would turn an inspect-then-think-better-of-it into an accidental cast.
    expect(release({ revealed: true })).toEqual({ kind: 'cancel' });
  });

  it('does nothing when the resolved direction has no slot on this page', () => {
    expect(release({ direction: 'left', hasSlot: false })).toEqual({ kind: 'none' });
    expect(release({ hasSlot: false })).toEqual({ kind: 'none' });
  });

  it("a 'toggle' control's bare tap OPENS its petals rather than casting", () => {
    // Quick Actions' rule, on a radial: a control with no action of its own has
    // nothing for the centre to commit to, so the tap that would have cast is
    // the one that reveals the choices. The stance control is the first such
    // radial; the ring's buttons keep the 'action' default above.
    expect(release({ anchorRole: 'toggle' })).toEqual({ kind: 'open' });
    // Even with no petal on the centre: 'open' is about the CONTROL, not a slot.
    expect(release({ anchorRole: 'toggle', hasSlot: false })).toEqual({ kind: 'open' });
    // Directions still choose, and the open-then-back-out cancel is unchanged.
    expect(release({ anchorRole: 'toggle', direction: 'up' })).toEqual({
      kind: 'cast',
      direction: 'up',
    });
    expect(release({ anchorRole: 'toggle', revealed: true })).toEqual({ kind: 'cancel' });
    // A consumed press still wins over everything, including the open.
    expect(release({ anchorRole: 'toggle', consumedElsewhere: true })).toEqual({ kind: 'none' });
  });

  it("the 'action' default is what the ring keeps, stated explicitly", () => {
    expect(release({ anchorRole: 'action' })).toEqual({ kind: 'cast', direction: 'center' });
    expect(release()).toEqual(release({ anchorRole: 'action' }));
  });

  it('stays silent when another owner consumed the press', () => {
    // A rearrange drag or an empowered hold owns the finger; casting on top of
    // it is the double-fire that ate the player's next cast before.
    expect(release({ consumedElsewhere: true })).toEqual({ kind: 'none' });
    expect(release({ direction: 'up', consumedElsewhere: true })).toEqual({ kind: 'none' });
    expect(release({ revealed: true, consumedElsewhere: true })).toEqual({ kind: 'none' });
  });

  it('lets the consumed check win over the empty-slot and cancel checks', () => {
    expect(release({ hasSlot: false, consumedElsewhere: true })).toEqual({ kind: 'none' });
  });
});

describe('shouldRevealOnDrag', () => {
  it('pulls the petals up as soon as a drag leaves the centre', () => {
    expect(shouldRevealOnDrag('up', false)).toBe(true);
    expect(shouldRevealOnDrag('left', false)).toBe(true);
  });

  it('never re-reveals what is already showing', () => {
    expect(shouldRevealOnDrag('up', true)).toBe(false);
  });

  it('does not reveal while the drag is still inside the deadzone', () => {
    expect(shouldRevealOnDrag('center', false)).toBe(false);
  });
});

describe('radialCancelIsLive', () => {
  it('exists only once the petals are up', () => {
    expect(radialCancelIsLive('center', true)).toBe(true);
    expect(radialCancelIsLive('center', false)).toBe(false);
  });

  it('is never live while a direction is chosen', () => {
    expect(radialCancelIsLive('right', true)).toBe(false);
  });
});

describe('the gesture reads the same deadzone the core defines', () => {
  it('a travel just under the deadzone still releases as the centre tap', () => {
    const direction: RadialDirection = resolveRadialDirection(FLICK_DEADZONE_PX - 1, 0);
    expect(direction).toBe('center');
    expect(release({ direction })).toEqual({ kind: 'cast', direction: 'center' });
  });

  it('a travel just past the deadzone releases as that direction', () => {
    const direction = resolveRadialDirection(FLICK_DEADZONE_PX + 1, 0);
    expect(direction).toBe('right');
    expect(shouldRevealOnDrag(direction, false)).toBe(true);
    expect(release({ direction })).toEqual({ kind: 'cast', direction: 'right' });
  });
});
