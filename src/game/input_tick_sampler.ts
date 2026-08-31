import { DT, emptyMoveInput, type MoveInput } from '../sim/types';

const DT_MS = DT * 1000;
export const STALE_DEADLINE_RESEED_MS = 250;
export const MAX_CATCHUP_FRAMES_PER_ADVANCE = 2;

export interface InputTickSample {
  mi: MoveInput;
  facing: number | null;
}

export interface InputTickFrame extends InputTickSample {
  ct: number;
}

export class InputTickSampler {
  staleDeadlineReseeds = 0;
  catchupBacklogDrops = 0;
  private nowMs = 0;
  private nextTickAtMs = DT_MS;
  private nextClientTick = 0;

  get interpolationAlpha(): number {
    const tickStartedAtMs = this.nextTickAtMs - DT_MS;
    return Math.min(1, Math.max(0, (this.nowMs - tickStartedAtMs) / DT_MS));
  }

  reset(now: number): void {
    this.nowMs = now;
    this.nextTickAtMs = now + DT_MS;
    this.nextClientTick = 0;
  }

  emitNeutralFrame(now: number): InputTickFrame {
    this.nowMs = now;
    this.nextTickAtMs = now + DT_MS;
    return {
      ct: this.nextClientTick++,
      mi: emptyMoveInput(),
      facing: null,
    };
  }

  advance(now: number, sampleFn: () => InputTickSample): InputTickFrame[] {
    this.nowMs = now;
    if (now - this.nextTickAtMs > STALE_DEADLINE_RESEED_MS) {
      this.nextTickAtMs = now;
      this.staleDeadlineReseeds++;
    }
    const frames: InputTickFrame[] = [];
    while (now >= this.nextTickAtMs && frames.length < MAX_CATCHUP_FRAMES_PER_ADVANCE) {
      frames.push({ ct: this.nextClientTick++, ...sampleFn() });
      this.nextTickAtMs += DT_MS;
    }
    if (now >= this.nextTickAtMs) {
      this.nextTickAtMs = now;
      this.catchupBacklogDrops++;
    }
    return frames;
  }
}
