import type { MoveInput } from '../sim/types';

export function inputSignature(mi: MoveInput, mouselookFacing: number | null): string {
  const facing = mouselookFacing === null ? '' : Math.round(mouselookFacing * 10000).toString();
  return [
    mi.forward ? 1 : 0,
    mi.back ? 1 : 0,
    mi.turnLeft ? 1 : 0,
    mi.turnRight ? 1 : 0,
    mi.strafeLeft ? 1 : 0,
    mi.strafeRight ? 1 : 0,
    mi.jump ? 1 : 0,
    mi.dive ? 1 : 0,
    mi.surface ? 1 : 0,
    mi.swimSteer ?? 1,
    mi.gliderPitch ?? '',
    facing,
  ].join(',');
}

/** Two facings are the same heading (wrap-aware, to float noise): the input sender's
 *  "did the facing change" test (moved out of online.ts under the monolith ratchet). */
export const inputFacingsMatch = (a: number, b: number): boolean =>
  Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) <= 1e-12;
