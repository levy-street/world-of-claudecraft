import { DT } from '../sim/types';

/** Fixed simulation steps remain 20 Hz at every playback speed. */
export class StudioPlayback {
  speed = 1;
  paused = false;
  accumulator = 0;
  advance(realDt: number, tick: () => void): number {
    if (this.paused || !Number.isFinite(realDt) || realDt <= 0) return 0;
    const dt = Math.min(realDt, 0.1) * this.speed;
    const previousAccumulator = this.accumulator;
    this.accumulator += dt;
    let ticks = 0;
    while (!this.paused && this.accumulator + 1e-9 >= DT) {
      this.accumulator = Math.max(0, this.accumulator - DT);
      tick();
      ticks++;
    }
    if (this.paused) {
      this.accumulator = 0;
      return Math.max(0, ticks * DT - previousAccumulator);
    }
    return dt;
  }
  get alpha(): number {
    return this.accumulator / DT;
  }
}
