import type { MoveInput } from '../sim/types';
import type { RiftFloorView } from '../world_api/dungeons';

export interface BufferedSelfMotionFrame {
  enabled: boolean;
  moveInput: MoveInput;
  displayFacing: number;
  echoMs: number;
  jitterMs: number;
  alpha: number;
  frameDt: number;
  snapAgeMs: number;
  snapIntervalMs: number;
  riftFloor: RiftFloorView | null;
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
    riftFloor: RiftFloorView | null,
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
        riftFloor,
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
      this.frame.riftFloor = riftFloor;
    }
    return this.frame;
  }
}
