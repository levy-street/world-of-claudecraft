// Browser owner for the entry-only resume gate. The pure core owns one-shot
// settlement; this adapter owns the cancelable timer used only once the entry
// reaches its first-paint wait.

import {
  createPrewarmResumeStartGate,
  PREWARM_RESUME_START_BACKSTOP_MS,
} from './prewarm_resume_start_gate_core';

export interface InitialPrewarmResumeStartGate {
  readonly wait: Promise<void>;
  release(): void;
  armBackstop(): void;
}

export function createInitialPrewarmResumeStartGate(): InitialPrewarmResumeStartGate {
  const gate = createPrewarmResumeStartGate();
  return {
    wait: gate.wait,
    release: gate.release,
    armBackstop: () =>
      gate.armBackstop({
        timeoutMs: PREWARM_RESUME_START_BACKSTOP_MS,
        schedule: (onTimeout, ms) => {
          const timer = window.setTimeout(onTimeout, ms);
          return () => window.clearTimeout(timer);
        },
      }),
  };
}
