import { expect, it } from 'vitest';
import { GP } from '../src/game/gamepad_map';
import { VEHICLE_PAD_SLOTS, vehiclePadAction } from '../src/game/vehicle_gamepad_core';

it('maps physical buttons independently of class bindings and keeps cancel distinct from exit', () => {
  for (const [slot, button] of VEHICLE_PAD_SLOTS.entries()) {
    expect(vehiclePadAction(button)).toEqual({ kind: 'slot', slot });
  }
  expect(vehiclePadAction(GP.A)).toEqual({ kind: 'confirm' });
  expect(vehiclePadAction(GP.B)).toEqual({ kind: 'cancel' });
  expect(vehiclePadAction(GP.BACK)).toEqual({ kind: 'exit' });
  expect(vehiclePadAction(GP.START)).toEqual({ kind: 'menu' });
  expect(vehiclePadAction(GP.L3)).toBeNull();
  expect(vehiclePadAction(GP.LT)).toBeNull();
  expect(vehiclePadAction(GP.DPAD_LEFT)).toEqual({ kind: 'snap', direction: -1 });
});
