import type { SceneAttachFrame } from '../sim/types';
import type { PropPathSample } from './prop_path_core';

export interface HarborShipBasePose {
  readonly baseX: number;
  readonly baseY: number;
  readonly baseZ: number;
  readonly baseRot: number;
}

/** Compose a parked or live ship pose into its world attach frame. */
export function composeHarborShipAttachFrame(
  base: HarborShipBasePose,
  pose: PropPathSample | null,
  out: SceneAttachFrame,
): SceneAttachFrame {
  if (pose === null) {
    out.position.x = base.baseX;
    out.position.y = base.baseY;
    out.position.z = base.baseZ;
    out.yaw = base.baseRot;
    return out;
  }

  const yaw = base.baseRot + pose.yaw;
  const cosYaw = Math.cos(yaw);
  const sinYaw = Math.sin(yaw);
  out.position.x = base.baseX + pose.x * cosYaw + pose.z * sinYaw;
  out.position.y = base.baseY + pose.y;
  out.position.z = base.baseZ - pose.x * sinYaw + pose.z * cosYaw;
  out.yaw = yaw;
  return out;
}
