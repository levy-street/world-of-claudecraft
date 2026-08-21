// The suspicion-flag workflow vocabulary and state machine: a pure leaf shared
// by the SQL module (suspicion_flags_db.ts), the emitters
// (suspicion_flags.ts), and the admin route handlers. The admin SPA keeps its
// own mirror in src/admin/flag_workflow.ts (the permissions.ts precedent:
// admin client code never imports server modules), pinned in lockstep by
// tests/suspicion_flags.test.ts.

export const SUSPICION_FLAG_STATUSES = ['new', 'under_review', 'cleared', 'actioned'] as const;
export type SuspicionFlagStatus = (typeof SUSPICION_FLAG_STATUSES)[number];

// A flag is ACTIVE while an admin still owes it a decision. Cleared and
// actioned flags are terminal-but-reopenable history: they never disappear
// from the account's record, and reopening is an explicit under_review move.
export const SUSPICION_FLAG_ACTIVE_STATUSES = ['new', 'under_review'] as const;

export const SUSPICION_FLAG_SEVERITIES = ['low', 'medium', 'high'] as const;
export type SuspicionFlagSeverity = (typeof SUSPICION_FLAG_SEVERITIES)[number];

// The emitters that mint flags today, plus the seam the economy-watch
// detectors land on: a new detector adds its source here and calls
// upsertSuspicionFlag with it; storage, workflow, and the admin UI need no
// change.
export const SUSPICION_FLAG_SOURCES = [
  'bot_detector',
  'registration_burst',
  'economy_watch',
] as const;
export type SuspicionFlagSource = (typeof SUSPICION_FLAG_SOURCES)[number];

// Every workflow move is an explicit admin action; there is no automatic
// clear anywhere (flags never silently disappear). Cleared and actioned rows
// can be reopened into under_review when new evidence lands.
const TRANSITIONS: Record<SuspicionFlagStatus, readonly SuspicionFlagStatus[]> = {
  new: ['under_review', 'cleared', 'actioned'],
  under_review: ['cleared', 'actioned'],
  cleared: ['under_review'],
  actioned: ['under_review'],
};

export function isSuspicionFlagStatus(value: unknown): value is SuspicionFlagStatus {
  return (
    typeof value === 'string' && (SUSPICION_FLAG_STATUSES as readonly string[]).includes(value)
  );
}

export function allowedSuspicionFlagTransition(
  from: SuspicionFlagStatus,
  to: SuspicionFlagStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Severity for a bot-detector confirmation. Only CONFIRMED sessions (the
 *  detector's own bar for filing an automated report) are persisted, always
 *  high; the live SUSPICIOUS pool stays on the existing real-time page. */
export function severityForDetectorState(state: 'SUSPICIOUS' | 'CONFIRMED'): SuspicionFlagSeverity {
  return state === 'CONFIRMED' ? 'high' : 'medium';
}

/** Severity for a registration burst: one tripped signal is medium; a
 *  multi-signal burst (e.g. shared prefix AND shared IP) is high. */
export function severityForRegistrationBurst(signalCount: number): SuspicionFlagSeverity {
  return signalCount >= 2 ? 'high' : 'medium';
}
