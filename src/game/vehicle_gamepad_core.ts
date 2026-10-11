import { GP } from './gamepad_map';

export const VEHICLE_PAD_SLOTS = [GP.LB, GP.RB, GP.X] as const;
export type VehiclePadAction =
  | { kind: 'slot'; slot: number }
  | { kind: 'snap'; direction: -1 | 1 }
  | { kind: 'confirm' | 'cancel' | 'exit' | 'menu' };

/** Contextual vehicle controls never consult or mutate saved class bindings. */
export function vehiclePadAction(button: number): VehiclePadAction | null {
  const slot = VEHICLE_PAD_SLOTS.findIndex((index) => index === button);
  if (slot >= 0) return { kind: 'slot', slot };
  switch (button) {
    case GP.A:
      return { kind: 'confirm' };
    case GP.B:
      return { kind: 'cancel' };
    case GP.BACK:
      return { kind: 'exit' };
    case GP.START:
      return { kind: 'menu' };
    case GP.DPAD_LEFT:
      return { kind: 'snap', direction: -1 };
    case GP.DPAD_RIGHT:
      return { kind: 'snap', direction: 1 };
    default:
      return null;
  }
}
