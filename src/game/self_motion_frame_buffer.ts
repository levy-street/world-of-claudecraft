import type { DelveMotionState } from '../sim/delves/geometry';
import type { MoveInput } from '../sim/types';
import type { RiftFloorView } from '../world_api/dungeons';

/** The two per-frame instanced-region descriptors this buffer carries
 *  alongside the plain scalar fields, bundled into one trailing param so a
 *  new one (this is how delve support landed, issue #3480) never grows the
 *  positional argument list. */
export interface InstancedMotionState extends DelveMotionState {
  riftFloor: RiftFloorView | null;
}

export interface BufferedSelfMotionFrame extends InstancedMotionState {
  enabled: boolean;
  moveInput: MoveInput;
  displayFacing: number;
  echoMs: number;
  jitterMs: number;
  alpha: number;
  frameDt: number;
  snapAgeMs: number;
  snapIntervalMs: number;
}

export class SelfMotionFrameBuffer {
  private frame: BufferedSelfMotionFrame | null = null;

  write(
    enabled: boolean,
    moveInput: MoveInput,
    displayFacing: number,
    echoMs: number,
    jitterMs: number,
    alpha: number,
    frameDt: number,
    snapAgeMs: number,
    snapIntervalMs: number,
    instanced: InstancedMotionState,
  ): BufferedSelfMotionFrame {
    if (this.frame === null) {
      this.frame = {
        enabled,
        moveInput,
        displayFacing,
        echoMs,
        jitterMs,
        alpha,
        frameDt,
        snapAgeMs,
        snapIntervalMs,
        riftFloor: instanced.riftFloor,
        delveRun: instanced.delveRun,
        delveSolids: instanced.delveSolids,
      };
    } else {
      this.frame.enabled = enabled;
      this.frame.moveInput = moveInput;
      this.frame.displayFacing = displayFacing;
      this.frame.echoMs = echoMs;
      this.frame.jitterMs = jitterMs;
      this.frame.alpha = alpha;
      this.frame.frameDt = frameDt;
      this.frame.snapAgeMs = snapAgeMs;
      this.frame.snapIntervalMs = snapIntervalMs;
      this.frame.riftFloor = instanced.riftFloor;
      this.frame.delveRun = instanced.delveRun;
      this.frame.delveSolids = instanced.delveSolids;
    }
    return this.frame;
  }
}
