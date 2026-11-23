import type { Quaternion, Vector3 } from 'three';

/** Fractions of the arm's swing out of the bind that the pad takes. */
export const PAULDRON_FOLLOW: Readonly<{ swing: number; drop: number; lift: number }>;

/** The pad's local rotation for its arm's local rotation (both under the clavicle);
 *  `down` is the body's down in the arm's bind frame. */
export function pauldronLocal(
  armBind: Quaternion,
  armLocal: Quaternion,
  padBind: Quaternion,
  down: Vector3,
): Quaternion;
