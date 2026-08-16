import type { MoveInput } from '../sim/types';

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
    }
    return this.frame;
  }
}
