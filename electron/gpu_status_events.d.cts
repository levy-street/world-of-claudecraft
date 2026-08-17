// Hand-written declarations for electron/gpu_status_events.cjs so the Vitest
// suite (tests/electron_gpu_status_events.test.ts) type-checks its imports.
// Keep in sync with the .cjs exports (same convention as shell_guards.d.cts).

export interface GpuStatusPayload {
  softwareRendering: boolean;
  discreteInactive: boolean;
  adapter: string;
}

export function gpuStatusPayload(raw?: unknown): GpuStatusPayload;
