import type { CannonFeedback, VehicleSession } from '../../../sim/types';

/** Consume authoritative one-shot cues once, without replaying a reconnect backlog. */
export class CannonFeedbackCursor {
  private tick = -1;
  private lastId = 0;
  private readonly pending: CannonFeedback[] = [];
  consume(session: VehicleSession | null | undefined): CannonFeedback[] {
    this.pending.length = 0;
    if (!session) {
      this.tick = -1;
      this.lastId = 0;
      return this.pending;
    }
    const state = session.encounter;
    const fresh = this.tick < 0 || state.tick < this.tick;
    this.tick = state.tick;
    if (fresh) this.lastId = 0;
    for (const event of state.feedback)
      if (event.id > this.lastId) {
        this.lastId = event.id;
        if (!fresh) this.pending.push(event);
      }
    return this.pending;
  }
}
