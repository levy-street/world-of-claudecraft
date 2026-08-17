// Hand-written declarations for electron/presentation_events.cjs so the Vitest
// suite (tests/electron_presentation_events.test.ts) type-checks its imports.
// Keep in sync with the .cjs exports (same convention as gpu_status_events.d.cts).

export interface PresentationStatePayload {
  hidden: boolean;
}

export function presentationStatePayload(hidden?: unknown): PresentationStatePayload;
