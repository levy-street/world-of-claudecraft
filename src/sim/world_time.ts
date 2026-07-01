export const DAY_NIGHT_CYCLE_SECONDS = 20 * 60;
export const DEFAULT_TIME_OF_DAY = 0.28;

export function normalizeTimeOfDay(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_TIME_OF_DAY;
  return ((value % 1) + 1) % 1;
}

export function timeOfDayAt(simTimeSeconds: number): number {
  return normalizeTimeOfDay(DEFAULT_TIME_OF_DAY + simTimeSeconds / DAY_NIGHT_CYCLE_SECONDS);
}
