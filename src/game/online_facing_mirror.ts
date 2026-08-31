import { wrapAngle } from './camera_follow';

export interface OnlineFacingMirrorWire {
  movementWireVersion: 1 | 2;
  reconPreviousAuthoritativeFacing: number | null;
  reconAuthoritativeFacing: number | null;
}

export interface MirroredFacingEntity {
  prevFacing: number;
  facing: number;
}

/** Interpolate the self-facing source the active movement wire exposes for display. */
export function interpolatedOnlineSelfFacing(
  wire: OnlineFacingMirrorWire,
  entity: MirroredFacingEntity,
  alpha: number,
): number {
  const useFullPrecision =
    wire.movementWireVersion === 2 &&
    wire.reconPreviousAuthoritativeFacing !== null &&
    wire.reconAuthoritativeFacing !== null;
  const previous = useFullPrecision
    ? (wire.reconPreviousAuthoritativeFacing as number)
    : entity.prevFacing;
  const current = useFullPrecision ? (wire.reconAuthoritativeFacing as number) : entity.facing;
  return previous + wrapAngle(current - previous) * Math.min(1, alpha);
}
