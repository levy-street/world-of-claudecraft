import { describe, expect, it } from 'vitest';
import {
  COOP_LEAVE_HOLD_MS,
  COOP_PAD_ACTIONS,
  type CoopPadSnapshot,
  CoopSlots,
} from '../src/game/coop_slots';
import { GP, STANDARD_BUTTON_COUNT } from '../src/game/gamepad_map';

function pad(
  index: number,
  opts: { buttons?: Partial<Record<number, boolean>>; axes?: number[] } = {},
): CoopPadSnapshot {
  const buttons = new Array(STANDARD_BUTTON_COUNT).fill(false);
  for (const [k, v] of Object.entries(opts.buttons ?? {})) buttons[Number(k)] = v === true;
  return { index, connected: true, buttons, axes: opts.axes ?? [0, 0, 0, 0] };
}

describe('join gesture', () => {
  it('an unassigned pad pressing Start requests to join (rising edge only)', () => {
    const slots = new CoopSlots();
    // Frame 1: Start not yet pressed -> no request.
    expect(slots.frame([pad(1)], 0, 16).joinRequests).toEqual([]);
    // Frame 2: Start down -> one request.
    expect(slots.frame([pad(1, { buttons: { [GP.START]: true } })], 0, 16).joinRequests).toEqual([
      1,
    ]);
    // Frame 3: still held -> no repeat (edge, not level).
    expect(slots.frame([pad(1, { buttons: { [GP.START]: true } })], 0, 16).joinRequests).toEqual(
      [],
    );
  });

  it("Player 1's pad is excluded from co-op joining", () => {
    const slots = new CoopSlots();
    slots.frame([pad(0)], 0, 16);
    const f = slots.frame([pad(0, { buttons: { [GP.START]: true } })], 0, 16);
    expect(f.joinRequests).toEqual([]);
  });

  it('claim assigns the lowest free slot and blocks further requests when full', () => {
    const slots = new CoopSlots();
    expect(slots.claim(pad(1))).toBe(2);
    expect(slots.claim(pad(2))).toBe(3);
    expect(slots.claim(pad(3))).toBe(4);
    expect(slots.claim(pad(4))).toBeNull(); // table full
    expect(slots.claim(pad(1))).toBeNull(); // already assigned
    // A fifth pad pressing Start gets no join request while full.
    slots.frame([pad(1), pad(2), pad(3), pad(4)], 0, 16);
    const f = slots.frame(
      [pad(1), pad(2), pad(3), pad(4, { buttons: { [GP.START]: true } })],
      0,
      16,
    );
    expect(f.joinRequests).toEqual([]);
  });

  it('releasing a slot lets the next pad take it again', () => {
    const slots = new CoopSlots();
    expect(slots.claim(pad(1))).toBe(2);
    slots.release(2);
    expect(slots.claim(pad(2))).toBe(2);
  });

  it('the Start press that opened the join flow does not leak into the overlay', () => {
    const slots = new CoopSlots();
    const held = pad(1, { buttons: { [GP.START]: true } });
    slots.claim(held);
    const f = slots.frame([held], 0, 16);
    expect(f.slots[0].menuEdges).toEqual([]);
  });
});

describe('joining phase', () => {
  it('routes rising edges to menuEdges, not actions, and never emits movement', () => {
    const slots = new CoopSlots();
    slots.claim(pad(1));
    slots.frame([pad(1)], 0, 16);
    const f = slots.frame(
      [pad(1, { buttons: { [GP.A]: true, [GP.DPAD_LEFT]: true }, axes: [1, 0, 0, 0] })],
      0,
      16,
    );
    expect(f.slots[0].menuEdges.sort()).toEqual([GP.A, GP.DPAD_LEFT].sort());
    expect(f.slots[0].actions).toEqual([]);
    expect(f.slots[0].moveAngle).toBeNull();
    expect(f.slots[0].jump).toBe(false);
  });
});

describe('active phase', () => {
  function activeSlots(): CoopSlots {
    const slots = new CoopSlots();
    slots.claim(pad(1));
    slots.activate(2);
    slots.frame([pad(1)], 0, 16); // settle edge state
    return slots;
  }

  it('maps the left stick to a camera-relative move angle', () => {
    const slots = activeSlots();
    // Stick straight up: angle 0 (travel along the camera yaw).
    let f = slots.frame([pad(1, { axes: [0, -1, 0, 0] })], 0, 16);
    expect(f.slots[0].moveAngle).toBeCloseTo(0, 6);
    expect(f.slots[0].moveStrength).toBeCloseTo(1, 6);
    // Stick right: +PI/2 (world facing = camYaw - PI/2, screen right).
    f = slots.frame([pad(1, { axes: [1, 0, 0, 0] })], 0, 16);
    expect(f.slots[0].moveAngle).toBeCloseTo(Math.PI / 2, 6);
    // Inside the deadzone: no movement.
    f = slots.frame([pad(1, { axes: [0.05, 0.05, 0, 0] })], 0, 16);
    expect(f.slots[0].moveAngle).toBeNull();
    expect(f.slots[0].moveStrength).toBe(0);
  });

  it('emits bound action ids on rising edges only', () => {
    const slots = activeSlots();
    let f = slots.frame([pad(1, { buttons: { [GP.X]: true, [GP.RB]: true } })], 0, 16);
    expect(f.slots[0].actions.sort()).toEqual(
      [COOP_PAD_ACTIONS[GP.X], COOP_PAD_ACTIONS[GP.RB]].sort(),
    );
    // Held, not re-pressed: no repeats.
    f = slots.frame([pad(1, { buttons: { [GP.X]: true, [GP.RB]: true } })], 0, 16);
    expect(f.slots[0].actions).toEqual([]);
  });

  it('A is jump (level, like a held key), not an action edge', () => {
    const slots = activeSlots();
    const f = slots.frame([pad(1, { buttons: { [GP.A]: true } })], 0, 16);
    expect(f.slots[0].jump).toBe(true);
    expect(f.slots[0].actions).toEqual([]);
  });

  it('holding Start fires leave exactly once after the hold threshold', () => {
    const slots = activeSlots();
    const held = pad(1, { buttons: { [GP.START]: true } });
    expect(slots.frame([held], 0, COOP_LEAVE_HOLD_MS - 1).slots[0].leave).toBe(false);
    expect(slots.frame([held], 0, 1).slots[0].leave).toBe(true);
    // Still held: does not fire again.
    expect(slots.frame([held], 0, 1000).slots[0].leave).toBe(false);
    // Released and re-held: a fresh countdown.
    slots.frame([pad(1)], 0, 16);
    expect(slots.frame([held], 0, COOP_LEAVE_HOLD_MS).slots[0].leave).toBe(true);
  });

  it('a disconnected pad emits a leave frame', () => {
    const slots = activeSlots();
    const f = slots.frame([], 0, 16);
    expect(f.slots[0].leave).toBe(true);
    expect(f.slots[0].moveAngle).toBeNull();
  });
});
