import type { AnimState } from './anim_state';

/** A cast opens a bounded window; displayed movement owns the actual loop.
 * No local-only charge fields or runtime bone offsets are needed for peers. */
export class WarriorRushPose {
  active = false;
  private remaining = 0;
  private age = 0;
  private stalled = 0;
  private moved = false;

  begin(): void {
    this.remaining = 3.2;
    this.age = this.stalled = 0;
    this.moved = false;
  }

  update(dt: number, state: AnimState): boolean {
    const previous = this.active;
    const step = Number.isFinite(dt) ? Math.max(0, dt) : 0;
    this.remaining -= step;
    this.age += step;
    // The actual rush travels at 21 yd/s. Ordinary running at 7 yd/s must
    // release this pose even when the player never becomes stationary.
    const moving = state.moving && state.speed > 10.5;
    if (moving) {
      this.moved = true;
      this.stalled = 0;
    } else this.stalled += step;
    if (
      state.dead ||
      state.swimming ||
      state.airborne ||
      state.casting ||
      (this.moved && this.stalled > 0.14) ||
      (!this.moved && this.age > 0.45)
    )
      this.remaining = 0;
    this.active = this.remaining > 0 && moving;
    return this.active !== previous;
  }
}
