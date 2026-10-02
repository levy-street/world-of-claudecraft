// The Fire and Fly feedback ring online, rebuilt from the owner-scoped
// `turretDefense` events rather than shipped in a key: a fresh or resumed
// client starts empty and nothing replays. An event frame reaches the client
// before the snapshot carrying its tick, so entries are held back and published
// at the next snapshot apply, where the entry and its tick's state appear in the
// same frame (offline both come from the same tick).
import { TURRET_FEEDBACK_LIMIT, type TurretFeedback } from '../sim/minigames/turret_feedback';
import type { SimEvent } from '../sim/types';
import { decodeTurretFeedback } from './turret_session_wire';

const EMPTY: readonly TurretFeedback[] = Object.freeze([]);

function newest(entries: readonly TurretFeedback[]): readonly TurretFeedback[] {
  return entries.length > TURRET_FEEDBACK_LIMIT
    ? entries.slice(entries.length - TURRET_FEEDBACK_LIMIT)
    : entries;
}

export class TurretFeedbackMirror {
  private held: readonly TurretFeedback[] = EMPTY;
  private published: readonly TurretFeedback[] = EMPTY;

  /** The published ring, oldest first: a new array whenever it moves, never mutated. */
  get entries(): readonly TurretFeedback[] {
    return this.published;
  }

  /** Holds one routed event for the next snapshot; a sequence that goes back starts a new seat. */
  apply(event: SimEvent): void {
    if (event.type !== 'turretDefense') return;
    const entry = decodeTurretFeedback(event);
    if (!entry) return;
    const last = this.held.at(-1) ?? this.published.at(-1);
    if (last && entry.seq <= last.seq) this.reset();
    this.held = newest([...this.held, entry]);
  }

  /** Publishes the held entries (a snapshot apply); true when the ring moved. */
  publish(): boolean {
    if (!this.held.length) return false;
    this.published = newest(this.published.concat(this.held));
    this.held = EMPTY;
    return true;
  }

  /** Drops the published ring (the seat is gone); entries held since wait for the next seat. */
  clear(): void {
    this.published = EMPTY;
  }

  reset(): void {
    this.held = EMPTY;
    this.published = EMPTY;
  }
}
