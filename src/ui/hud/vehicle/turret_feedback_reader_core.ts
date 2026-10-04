// One reader of a Fire and Fly seat's feedback ring, shared by the seat HUD's
// consumers (banners, sounds, damage numbers): each owns a reader and gets every
// entry exactly once, however often the same view is read.
import { type TurretFeedback, turretFeedbackSince } from '../../../sim/minigames/turret_feedback';
import type { TurretSessionView } from '../../../world_api/vehicles';

const NOTHING_NEW: readonly TurretFeedback[] = [];

export class TurretFeedbackReader {
  /** Whether the last read began a new seat. */
  newSeat = false;
  private startTick: number | null = null;
  private lastSeq = 0;

  /**
   * The entries not read yet, oldest first. The reader restarts with every seat: a
   * new start tick, or a sequence that went back (a seat taken again within the
   * same tick). A seat that goes missing between reads keeps its place.
   */
  read(session: TurretSessionView): readonly TurretFeedback[] {
    const ring = session.feedback;
    const newest = ring.length ? ring[ring.length - 1].seq : 0;
    this.newSeat = session.defense.startTick !== this.startTick || newest < this.lastSeq;
    if (this.newSeat) {
      this.startTick = session.defense.startTick;
      this.lastSeq = 0;
    }
    if (newest <= this.lastSeq) return NOTHING_NEW;
    const fresh = turretFeedbackSince(ring, this.lastSeq);
    this.lastSeq = newest;
    return fresh;
  }
}
