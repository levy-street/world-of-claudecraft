// Daily-quest reset logic: a pure leaf (no SimContext, no rng, no clock) that decides
// whether a daily quest is still on cooldown for the current host calendar day and
// records a fresh completion. The day boundary is the host-injected `utcDay` string
// (the same one the honor arena daily taper and the Book of Deeds use); offline and
// headless leave it '' so a daily never rolls over and stays one-and-done there,
// deterministically. A Vitest imports these directly.
import type { DailyQuestState } from '../types';

// Coerce a persisted/unknown value into a well-formed DailyQuestState, or undefined
// when there is nothing to restore. Drops non-string entries and a non-string date.
export function normalizeDailyQuestState(value: unknown): DailyQuestState | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as { date?: unknown; done?: unknown };
  const date = typeof v.date === 'string' ? v.date : '';
  const done = Array.isArray(v.done)
    ? v.done.filter((id): id is string => typeof id === 'string')
    : [];
  if (date === '' && done.length === 0) return undefined;
  return { date, done };
}

// Whether `questId` was already completed on the current `utcDay`. A stale record
// from a previous day (date !== utcDay) counts as not-done, so the daily re-opens.
export function dailyQuestDoneToday(
  state: DailyQuestState | undefined,
  utcDay: string,
  questId: string,
): boolean {
  if (!state) return false;
  if (state.date !== utcDay) return false;
  return state.done.includes(questId);
}

// Record `questId` as completed today, returning the updated state. When the day has
// rolled (or there was no prior record), the done-list resets to just this quest.
export function recordDailyQuestDone(
  state: DailyQuestState | undefined,
  utcDay: string,
  questId: string,
): DailyQuestState {
  if (!state || state.date !== utcDay) return { date: utcDay, done: [questId] };
  if (state.done.includes(questId)) return state;
  return { date: state.date, done: [...state.done, questId] };
}
