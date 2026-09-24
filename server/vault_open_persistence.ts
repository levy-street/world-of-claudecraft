// The shared Sim opens a sealed hoard entrance when a map is dug. The live
// server must commit the consumed map and retry marker in the character blob
// before the entrance becomes usable. This observer never owns game rules:
// it only acknowledges the exact attempt after the existing fenced save FIFO.

import type { Sim } from '../src/sim/sim';
import { confirmVaultAttemptDurable } from '../src/sim/treasure_vault';
import type { SimEvent } from '../src/sim/types';

export interface VaultOpenPersistenceDeps {
  attemptIdFor(pid: number): string | null;
  save(pid: number): Promise<boolean>;
  confirm(pid: number, attemptId: string): boolean;
  onError(pid: number, error: unknown): void;
}

const RETRY_MS = 5_000;
const MAX_IN_FLIGHT_SAVES = 2;

export interface VaultOpenPersistenceState {
  inFlight: Set<string>;
  retryAt: Map<string, { pid: number; nextAt: number }>;
  nextSweepAt: number;
}

export function createVaultOpenPersistenceState(): VaultOpenPersistenceState {
  return { inFlight: new Set(), retryAt: new Map(), nextSweepAt: 0 };
}

export function createVaultOpenPersistenceDeps<Session extends { left: boolean }>(
  sim: () => Sim,
  sessionFor: (pid: number) => Session | undefined,
  saveSession: (session: Session) => Promise<boolean>,
): VaultOpenPersistenceDeps {
  return {
    attemptIdFor: (pid) => {
      const meta = sim().meta(pid);
      return meta?.vaultAttemptDurable ? null : (meta?.vaultAttempt?.id ?? null);
    },
    save: (pid) => {
      const session = sessionFor(pid);
      return session && !session.left ? saveSession(session) : Promise.resolve(false);
    },
    confirm: (pid, attemptId) => confirmVaultAttemptDurable(sim().ctx, pid, attemptId),
    onError: (pid, error) => console.error(`vault open save failed for pid ${pid}:`, error),
  };
}

export function persistNewVaultOpens(
  events: readonly SimEvent[],
  state: VaultOpenPersistenceState,
  deps: VaultOpenPersistenceDeps,
  now = Date.now(),
): Promise<void>[] {
  const tasks: Promise<void>[] = [];
  const newAttempts: string[] = [];
  for (const event of events) {
    if (event.type !== 'treasureVaultOpened' || event.pid === undefined) continue;
    const pid = event.pid;
    const attemptId = deps.attemptIdFor(pid);
    if (attemptId && !state.retryAt.has(attemptId)) {
      state.retryAt.set(attemptId, { pid, nextAt: now });
      newAttempts.push(attemptId);
    }
  }
  const sweep = now >= state.nextSweepAt;
  if (sweep) state.nextSweepAt = now + RETRY_MS;
  const candidates = sweep ? [...state.retryAt.keys()] : newAttempts;
  for (const attemptId of candidates) {
    const retry = state.retryAt.get(attemptId);
    if (!retry) continue;
    if (retry.nextAt > now || state.inFlight.has(attemptId)) continue;
    if (deps.attemptIdFor(retry.pid) !== attemptId) {
      state.retryAt.delete(attemptId);
      continue;
    }
    if (state.inFlight.size >= MAX_IN_FLIGHT_SAVES) break;
    const pid = retry.pid;
    // Rotate attempted work behind still-sealed owners, even on repeated failure.
    state.retryAt.delete(attemptId);
    state.retryAt.set(attemptId, retry);
    state.inFlight.add(attemptId);
    tasks.push(
      deps
        .save(pid)
        .then((saved) => {
          if (saved) {
            state.retryAt.delete(attemptId);
            deps.confirm(pid, attemptId);
          } else retry.nextAt = now + RETRY_MS;
        })
        .catch((error: unknown) => {
          retry.nextAt = now + RETRY_MS;
          deps.onError(pid, error);
        })
        .finally(() => state.inFlight.delete(attemptId)),
    );
  }
  return tasks;
}
