import type { SceneAttachFrame } from '../sim/types';

export interface HarborShipAttachHandle {
  readonly group: {
    readonly position: {
      readonly x: number;
      readonly y: number;
      readonly z: number;
    };
    readonly rotation: {
      readonly y: number;
    };
  };
}

/** Read the current world frame from a harbor ship registry without mutating its group. */
export function harborShipAttachFrameFrom(
  handles: ReadonlyMap<string, HarborShipAttachHandle>,
  target: string,
  out?: SceneAttachFrame,
): SceneAttachFrame | null {
  const handle = handles.get(target);
  if (!handle) return null;
  const frame = out ?? {
    position: { x: 0, y: 0, z: 0 },
    yaw: 0,
  };
  frame.position.x = handle.group.position.x;
  frame.position.y = handle.group.position.y;
  frame.position.z = handle.group.position.z;
  frame.yaw = handle.group.rotation.y;
  return frame;
}
