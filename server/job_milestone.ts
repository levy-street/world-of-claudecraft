// Pure milestone logic for player-to-player job contracts ("paid bodyguard").
//
// A player (the PAYER) hires another player (the HELPER) for an agreed in-game
// goal and locks a reward in on-chain escrow. The authoritative server is the
// oracle: each tick it observes the Sim and feeds that observation here, and
// this module — with no DB, no chain, and no Sim imports — decides whether the
// job is still `pending`, has been `completed` (→ release escrow to the helper),
// or has been `voided` (→ refund the payer). Kept pure so the fairness rules are
// unit-tested in isolation (tests/job_milestone.test.ts), exactly the part where
// a bug would pay the wrong person.
//
// SUBJECT = the payer's character (the one being helped/escorted/levelled). For
// every milestone the helper must be present (grouped with the subject) at the
// moment of completion, so payment only ever follows actual help.

export type JobMilestone =
  | { kind: 'reach_level'; target: number }       // subject reaches >= target level
  | { kind: 'clear_dungeon'; dungeonId: string }  // subject's party clears the dungeon
  | { kind: 'complete_quest'; questId: string }   // subject turns in the agreed quest
  | { kind: 'escort'; x: number; z: number; radius: number } // subject reaches a place alive
  | { kind: 'survive'; durationTicks: number };   // subject survives N ticks with the helper

export type JobStatus = 'pending' | 'completed' | 'voided';

// Milestones whose whole point is keeping the subject alive: the subject dying
// fails the job (→ refund). A raid/dungeon clear is NOT here — deaths happen in
// raids and the goal is the clear, not flawless survival.
const VOID_ON_DEATH: ReadonlySet<JobMilestone['kind']> = new Set(['escort', 'survive']);

// Everything the evaluator needs about THIS tick, computed server-side from the
// authoritative Sim. `helperPresent` folds together party membership / proximity
// (the server decides what "present" means; the engine just consumes the flag).
export interface JobObservation {
  tick: number;                       // current sim tick (monotonic, 20/sec)
  subjectLevel: number;
  subjectAlive: boolean;
  subjectDiedThisTick: boolean;
  subjectPos: { x: number; z: number } | null;
  helperPresent: boolean;
  questTurnIns: readonly string[];    // quests the subject turned in this tick
  dungeonClears: readonly string[];   // dungeons the subject cleared this tick
}

// Progress the contract carries between ticks (persisted alongside it). Once the
// status is terminal it never changes again, so a late observation can't flip a
// settled job.
export interface JobProgress {
  status: JobStatus;
  startedTick: number | null;         // 'survive': when the protected window began
  reason?: string;                    // why it voided / completed (audit + UI)
}

export function initialProgress(): JobProgress {
  return { status: 'pending', startedTick: null };
}

export interface JobConfig {
  milestone: JobMilestone;
  deadlineTick: number;               // hard expiry: still pending at/after ⇒ refund
  requireHelperPresent: boolean;      // default true — the helper must earn it
}

/**
 * Pure state transition for one tick. Returns the (possibly new) progress.
 * Terminal states are sticky — a no-op once completed/voided. The order of
 * checks matters: a hard deadline and a fatal death are evaluated before any
 * success, so neither a stale tick nor a same-tick death can mis-pay.
 */
export function stepJob(cfg: JobConfig, prev: JobProgress, obs: JobObservation): JobProgress {
  if (prev.status !== 'pending') return prev;

  // Hard deadline → refund the payer.
  if (obs.tick >= cfg.deadlineTick) return { ...prev, status: 'voided', reason: 'expired' };

  const m = cfg.milestone;
  // Death fails the protective jobs outright (the helper failed to keep them alive).
  if (obs.subjectDiedThisTick && VOID_ON_DEATH.has(m.kind)) {
    return { ...prev, status: 'voided', reason: 'subject_died' };
  }

  const helperOk = !cfg.requireHelperPresent || obs.helperPresent;
  const complete: JobProgress = { ...prev, status: 'completed', reason: undefined };

  switch (m.kind) {
    case 'reach_level':
      return helperOk && obs.subjectLevel >= m.target ? complete : prev;

    case 'complete_quest':
      return helperOk && obs.questTurnIns.includes(m.questId) ? complete : prev;

    case 'clear_dungeon':
      return helperOk && obs.dungeonClears.includes(m.dungeonId) ? complete : prev;

    case 'escort': {
      if (!helperOk || !obs.subjectAlive || !obs.subjectPos) return prev;
      const dx = obs.subjectPos.x - m.x;
      const dz = obs.subjectPos.z - m.z;
      return dx * dx + dz * dz <= m.radius * m.radius ? complete : prev;
    }

    case 'survive': {
      // The protected timer only runs while the helper is present and the subject
      // is alive; if the helper leaves (or the subject is down), the clock resets
      // so a job can't be passively completed during the helper's absence.
      if (!helperOk || !obs.subjectAlive) return { ...prev, startedTick: null };
      const startedTick = prev.startedTick ?? obs.tick;
      if (obs.tick - startedTick >= m.durationTicks) return { ...complete, startedTick };
      return { ...prev, startedTick };
    }
  }
}

/** Human-readable, currency-agnostic summary of the agreed goal (for UI / logs). */
export function describeMilestone(m: JobMilestone): string {
  switch (m.kind) {
    case 'reach_level': return `Reach level ${m.target}`;
    case 'clear_dungeon': return `Clear ${m.dungeonId}`;
    case 'complete_quest': return `Complete quest ${m.questId}`;
    case 'escort': return `Escort to (${m.x}, ${m.z})`;
    case 'survive': return `Survive ${Math.round(m.durationTicks / 20)}s together`;
  }
}
