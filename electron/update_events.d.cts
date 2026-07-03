// Hand-written declarations for electron/update_events.cjs so the Vitest suite
// (tests/electron_update_events.test.ts) type-checks its imports. Keep in sync
// with the .cjs exports (same convention as shell_guards.d.cts).

export interface UpdateEventPayload {
  type: 'available' | 'downloaded' | 'progress';
  version?: string;
  percent?: number;
}

export function updateEventPayload(type: string, raw: unknown): UpdateEventPayload | null;
export function shouldNotifyProgress(lastPercent: number, percent: unknown): boolean;
