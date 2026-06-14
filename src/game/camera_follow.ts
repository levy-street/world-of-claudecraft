export interface CameraFollowInput {
  camYaw: number;
  interpFacing: number;
  frameDt: number;
  lastInterpFacing: number | null;
  mouselook: boolean;
  moving: boolean;
  orbiting: boolean;
}

export interface CameraFollowResult {
  camYaw: number;
  lastInterpFacing: number;
}

const SETTLE_RATE = 6;
const HARD_SETTLE_RATE = 10;
const HARD_SETTLE_ANGLE = Math.PI / 3;
const SNAP_ANGLE = Math.PI * 0.75;

export function wrapAngle(d: number): number {
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

export function updateFollowCameraYaw(input: CameraFollowInput): CameraFollowResult {
  let camYaw = input.camYaw;
  if (!input.mouselook) {
    if (input.lastInterpFacing !== null) camYaw += wrapAngle(input.interpFacing - input.lastInterpFacing);
    if (input.moving && !input.orbiting) {
      const delta = wrapAngle(input.interpFacing - camYaw);
      if (Math.abs(delta) >= SNAP_ANGLE) {
        camYaw = input.interpFacing;
      } else {
        const rate = Math.abs(delta) >= HARD_SETTLE_ANGLE ? HARD_SETTLE_RATE : SETTLE_RATE;
        camYaw += delta * (1 - Math.exp(-Math.max(0, input.frameDt) * rate));
      }
    }
  }
  return { camYaw, lastInterpFacing: input.interpFacing };
}
