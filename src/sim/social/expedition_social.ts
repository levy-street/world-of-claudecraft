// Bounded session-only preferences and feedback, owned by the finder machine.
import type { DungeonFinderBoard } from '../../world_api/dungeon_finder';
import type { Role } from '../content/talents';

export type ExpeditionPurpose = 'first_time' | 'relaxed' | 'clear' | 'needs_help';
export type ExpeditionOutcome = 'accepted' | 'declined' | 'expired' | 'cancelled' | 'closed';
export interface ExpeditionDetails {
  purpose: ExpeditionPurpose;
  note: string;
}
export interface ExpeditionFeedback {
  seq: number;
  outcome: ExpeditionOutcome;
  leaderName: string;
}
export interface ExpeditionAvailability {
  enabled: boolean;
  roles: Role[];
  notice: { seq: number; listingIds: number[] } | null;
}
export const EXPEDITION_PURPOSES: readonly ExpeditionPurpose[] = [
  'first_time',
  'relaxed',
  'clear',
  'needs_help',
];
export const EXPEDITION_NOTE_MAX = 120;

export function validExpeditionDetails(value: unknown): value is ExpeditionDetails {
  if (!value || typeof value !== 'object') return false;
  const v = value as ExpeditionDetails;
  return (
    EXPEDITION_PURPOSES.includes(v.purpose) &&
    typeof v.note === 'string' &&
    v.note.length <= EXPEDITION_NOTE_MAX &&
    ![...v.note].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
  );
}

interface Subscription {
  roles: Role[];
  seen: Set<number>;
  nextNoticeAt: number;
  notice: ExpeditionAvailability['notice'];
}
export class ExpeditionSocialState {
  private seq = 0;
  private readonly subscriptions = new Map<number, Subscription>();
  private readonly feedback = new Map<number, ExpeditionFeedback>();
  setAvailable(pid: number, enabled: boolean, roles: Role[]): void {
    if (!enabled) {
      this.subscriptions.delete(pid);
      return;
    }
    const old = this.subscriptions.get(pid);
    this.subscriptions.set(pid, {
      roles: [...roles],
      seen: old?.seen ?? new Set(),
      nextNoticeAt: old?.nextNoticeAt ?? 0,
      notice: old?.notice ?? null,
    });
  }
  outcome(pid: number, outcome: ExpeditionOutcome, leaderName: string): void {
    this.feedback.set(pid, { seq: ++this.seq, outcome, leaderName });
  }
  clearFeedback(pid: number): void {
    this.feedback.delete(pid);
  }
  readFeedback(pid: number): ExpeditionFeedback | null {
    return this.feedback.get(pid) ?? null;
  }
  readAvailability(pid: number): ExpeditionAvailability {
    const sub = this.subscriptions.get(pid);
    return sub
      ? {
          enabled: true,
          roles: [...sub.roles],
          notice: sub.notice && { ...sub.notice, listingIds: [...sub.notice.listingIds] },
        }
      : { enabled: false, roles: [], notice: null };
  }
  remove(pid: number): void {
    this.subscriptions.delete(pid);
    this.feedback.delete(pid);
  }
  // Board is already capped at 50 and built once by the caller, never per self read.
  update(
    board: DungeonFinderBoard,
    now: number,
    eligible: (pid: number, row: DungeonFinderBoard[number], roles: Role[]) => boolean,
  ): void {
    const live = new Set(board.map((row) => row.id));
    for (const [pid, sub] of this.subscriptions) {
      for (const id of sub.seen) if (!live.has(id)) sub.seen.delete(id);
      const matches = board.filter((row) => row.expedition && eligible(pid, row, sub.roles));
      const ids = new Set(matches.map((row) => row.id));
      if (sub.notice)
        sub.notice = {
          ...sub.notice,
          listingIds: sub.notice.listingIds.filter((id) => ids.has(id)),
        };
      if (now < sub.nextNoticeAt) continue;
      const fresh = matches.filter((row) => !sub.seen.has(row.id)).slice(0, 5);
      if (!fresh.length) continue;
      for (const row of matches) sub.seen.add(row.id);
      sub.notice = { seq: ++this.seq, listingIds: fresh.map((row) => row.id) };
      sub.nextNoticeAt = now + 30;
    }
  }
}
