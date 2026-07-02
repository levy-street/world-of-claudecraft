import type { MoveInput } from '../sim/types';

export function visualFacingForMove(mi: MoveInput, facing: number): number | null {
  let mx = 0;
  let mz = 0;
  if (mi.forward) mz += 1;
  if (mi.back) mz -= 1;
  if (mi.strafeLeft) mx -= 1;
  if (mi.strafeRight) mx += 1;

  if (mx === 0 || mz === 0) return null;

  const len = Math.hypot(mx, mz);
  mx /= len;
  mz /= len;
  const sin = Math.sin(facing);
  const cos = Math.cos(facing);
  const wx = mz * sin - mx * cos;
  const wz = mz * cos + mx * sin;
  return Math.atan2(wx, wz);
}
