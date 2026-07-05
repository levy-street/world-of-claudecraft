import { describe, expect, it } from 'vitest';
import {
  applyRadialDeadzone,
  BINDABLE_BUTTONS,
  DEFAULT_GAMEPAD_BINDINGS,
  detectGamepadKind,
  GP,
  gamepadButtonLabel,
  risingEdges,
  stickToLook,
  stickToMoveFlags,
} from '../src/game/gamepad_map';

describe('applyRadialDeadzone', () => {
  it('zeroes a vector inside the deadzone', () => {
    expect(applyRadialDeadzone(0.1, 0.05, 0.2)).toEqual({ x: 0, y: 0 });
    expect(applyRadialDeadzone(0, 0, 0.2)).toEqual({ x: 0, y: 0 });
  });

  it('rescales so the deadzone edge maps to ~0 and the unit circle to 1', () => {
    // straight up, just past the deadzone -> small magnitude
    const justOut = applyRadialDeadzone(0, -0.2001, 0.2);
    expect(Math.hypot(justOut.x, justOut.y)).toBeLessThan(0.01);
    // full deflection stays at magnitude 1
    const full = applyRadialDeadzone(0, -1, 0.2);
    expect(Math.hypot(full.x, full.y)).toBeCloseTo(1, 6);
  });

  it('clamps over-deflection past the unit circle (square corners) to magnitude 1', () => {
    // A raw (1,1) corner has magnitude ~1.41; the Math.min(1, ...) clamp must cap
    // it at 1 so a diagonal push never out-runs a cardinal one. (The (0,-1) case
    // above is already magnitude 1, so it cannot catch a deleted clamp.)
    const corner = applyRadialDeadzone(1, 1, 0.2);
    expect(Math.hypot(corner.x, corner.y)).toBeCloseTo(1, 6);
  });
});

describe('stickToMoveFlags', () => {
  it('produces nothing inside the deadzone', () => {
    expect(stickToMoveFlags(0.1, 0.1, 0.25)).toEqual({
      forward: false,
      back: false,
      strafeLeft: false,
      strafeRight: false,
    });
  });

  it('maps up to forward and down to back (y inverted)', () => {
    expect(stickToMoveFlags(0, -1, 0.2).forward).toBe(true);
    expect(stickToMoveFlags(0, 1, 0.2).back).toBe(true);
  });

  it('fires both axes on a diagonal', () => {
    const f = stickToMoveFlags(-0.9, -0.9, 0.2);
    expect(f.forward).toBe(true);
    expect(f.strafeLeft).toBe(true);
  });

  it('maps right to strafeRight and left to strafeLeft (x-axis sign)', () => {
    const right = stickToMoveFlags(1, 0, 0.2);
    expect(right.strafeRight).toBe(true);
    expect(right.strafeLeft).toBe(false);
    const left = stickToMoveFlags(-1, 0, 0.2);
    expect(left.strafeLeft).toBe(true);
    expect(left.strafeRight).toBe(false);
  });

  it('fires back + strafeRight on a down-right diagonal', () => {
    const f = stickToMoveFlags(0.9, 0.9, 0.2);
    expect(f.back).toBe(true);
    expect(f.strafeRight).toBe(true);
    expect(f.forward).toBe(false);
    expect(f.strafeLeft).toBe(false);
  });
});

describe('stickToLook', () => {
  it('returns zero inside the deadzone', () => {
    expect(stickToLook(0.1, 0.1, 0.2, 2, false, 0.016)).toEqual({ yaw: 0, pitch: 0 });
  });

  it('turns right (negative yaw delta) when pushed right and scales with dt', () => {
    const a = stickToLook(1, 0, 0.2, 2, false, 0.016);
    const b = stickToLook(1, 0, 0.2, 2, false, 0.032);
    expect(a.yaw).toBeLessThan(0);
    expect(b.yaw).toBeCloseTo(a.yaw * 2, 6);
  });

  it('inverts pitch when invertY is set', () => {
    const normal = stickToLook(0, -1, 0.2, 2, false, 0.016);
    const inverted = stickToLook(0, -1, 0.2, 2, true, 0.016);
    expect(Math.sign(normal.pitch)).toBe(-Math.sign(inverted.pitch));
  });
});

describe('risingEdges', () => {
  it('reports only up->down transitions', () => {
    const prev = [false, true, false];
    const cur = [true, true, true];
    expect(risingEdges(prev, cur)).toEqual([0, 2]);
  });

  it('reports nothing when held', () => {
    expect(risingEdges([true, true], [true, true])).toEqual([]);
  });
});

describe('default layout', () => {
  it('binds every console-MMO button to a known action and stays within the bindable set', () => {
    expect(DEFAULT_GAMEPAD_BINDINGS[GP.A]).toBe('jump');
    expect(DEFAULT_GAMEPAD_BINDINGS[GP.START]).toBe('escape');
    for (const idx of Object.keys(DEFAULT_GAMEPAD_BINDINGS).map(Number)) {
      expect(BINDABLE_BUTTONS).toContain(idx);
    }
  });

  it('assigns a default to every bindable button (catches a dropped binding)', () => {
    const bound = Object.keys(DEFAULT_GAMEPAD_BINDINGS)
      .map(Number)
      .sort((a, b) => a - b);
    expect(bound).toEqual(BINDABLE_BUTTONS);
  });

  it('covers action-bar slots 0..8 exactly once (catches a dropped or duplicated slotN)', () => {
    const values = Object.values(DEFAULT_GAMEPAD_BINDINGS);
    for (let slot = 0; slot <= 8; slot++) {
      // Exactly once: count 0 = a dropped slot, count >= 2 = a duplicated slot
      // (additive or displacing). The default layout binds each slot to one button.
      expect(values.filter((v) => v === `slot${slot}`).length, `slot${slot}`).toBe(1);
    }
  });
});

describe('detectGamepadKind', () => {
  it('classifies a PlayStation pad by name and by Sony vendor id', () => {
    expect(
      detectGamepadKind(
        'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)',
      ),
    ).toBe('playstation');
    // DualShock 4 often reports the generic name "Wireless Controller"; the 054c
    // vendor id is what still identifies it.
    expect(
      detectGamepadKind('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)'),
    ).toBe('playstation');
  });

  it('classifies an Xbox pad by name and by Microsoft vendor id', () => {
    expect(
      detectGamepadKind('Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 02fd)'),
    ).toBe('xbox');
  });

  it('classifies Nintendo pads (Switch Pro, Joy-Con) by name and vendor id', () => {
    expect(detectGamepadKind('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)')).toBe(
      'nintendo',
    );
    expect(detectGamepadKind('Joy-Con (L/R)')).toBe('nintendo');
  });

  it('classifies Xbox pads reported with hyphenated or XInput-only names', () => {
    expect(detectGamepadKind('Xbox 360 Controller (XInput STANDARD GAMEPAD)')).toBe('xbox');
    expect(detectGamepadKind('Microsoft X-Box 360 pad')).toBe('xbox');
  });

  it('reads the vendor id from the Firefox "vendor-product-name" id format', () => {
    expect(detectGamepadKind('054c-0ce6-DualSense Wireless Controller')).toBe('playstation');
    // Vendor-only Firefox id with no recognizable product name still resolves.
    expect(detectGamepadKind('045e-02fd-')).toBe('xbox');
  });

  it('prefers the product NAME over a colliding product-id hex (no misclassification)', () => {
    // The product id here is 054c (Sony's vendor code), but the pad is an Xbox pad.
    // Name must win, and the vendor must be read from its field, not the product.
    expect(detectGamepadKind('Xbox Wireless Controller (Vendor: 045e Product: 054c)')).toBe('xbox');
  });

  it('reads the vendor from its field, not a colliding product id, when no name matches', () => {
    // No name keyword; vendor 045e (Xbox) but product 054c (Sony's vendor code). A
    // naive whole-string scan for "054c" would wrongly return 'playstation'; reading
    // the vendor field returns 'xbox'. This is the case that actually pins the parse.
    expect(detectGamepadKind('Wireless Controller (Vendor: 045e Product: 054c)')).toBe('xbox');
  });

  it('pins the PlayStation name arm alone (no vendor id present)', () => {
    expect(detectGamepadKind('DualSense Wireless Controller')).toBe('playstation');
  });

  it('pins the Nintendo vendor arm alone (no name keyword present)', () => {
    expect(detectGamepadKind('Wireless Controller (Vendor: 057e Product: 2009)')).toBe('nintendo');
  });

  it('falls back to generic for an unknown or empty id', () => {
    expect(detectGamepadKind('Some Random Pad (Vendor: 1234 Product: 5678)')).toBe('generic');
    expect(detectGamepadKind('')).toBe('generic');
  });
});

describe('gamepadButtonLabel', () => {
  it('mirrors the Nintendo A/B and X/Y face-button swap (labels follow the silk-screen)', () => {
    // Position index 0 is the bottom face button: "B" on a Switch pad, "A" on Xbox.
    expect(gamepadButtonLabel(GP.A, 'nintendo')).toBe('B');
    expect(gamepadButtonLabel(GP.B, 'nintendo')).toBe('A');
    expect(gamepadButtonLabel(GP.X, 'nintendo')).toBe('Y');
    expect(gamepadButtonLabel(GP.Y, 'nintendo')).toBe('X');
    // Xbox is unswapped: the same positions read A/B/X/Y.
    expect(gamepadButtonLabel(GP.A, 'xbox')).toBe('A');
    expect(gamepadButtonLabel(GP.Y, 'xbox')).toBe('Y');
  });

  it("uses each brand's shoulder/face names", () => {
    expect(gamepadButtonLabel(GP.A, 'playstation')).toBe('Cross');
    expect(gamepadButtonLabel(GP.X, 'playstation')).toBe('Square');
    expect(gamepadButtonLabel(GP.LT, 'playstation')).toBe('L2');
    expect(gamepadButtonLabel(GP.LT, 'nintendo')).toBe('ZL');
    expect(gamepadButtonLabel(GP.LT, 'xbox')).toBe('LT');
  });

  it('shares identical d-pad arrows across brands', () => {
    for (const kind of ['generic', 'xbox', 'playstation', 'nintendo'] as const) {
      expect(gamepadButtonLabel(GP.DPAD_UP, kind)).toBe('D-pad ↑');
    }
  });

  it('keeps the brand-neutral combined labels for the generic kind', () => {
    expect(gamepadButtonLabel(GP.A, 'generic')).toBe('A / Cross');
  });

  it('falls back to a raw index for an out-of-range button', () => {
    expect(gamepadButtonLabel(99, 'xbox')).toBe('#99');
  });

  it('labels every bindable button for every brand (no undefined glyphs)', () => {
    for (const kind of ['generic', 'xbox', 'playstation', 'nintendo'] as const) {
      for (const button of BINDABLE_BUTTONS) {
        const label = gamepadButtonLabel(button, kind);
        expect(label, `${kind} #${button}`).toBeTruthy();
        expect(label.startsWith('#'), `${kind} #${button} unlabeled`).toBe(false);
      }
    }
  });
});
