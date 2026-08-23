import { describe, expect, it, vi } from 'vitest';
import {
  createPrewarmResumeStartGate,
  PREWARM_RESUME_START_BACKSTOP_MS,
} from '../src/render/prewarm_resume_start_gate_core';

describe('prewarm resume start gate', () => {
  it('holds deferred GPU work until the first-paint owner releases it', async () => {
    const gate = createPrewarmResumeStartGate();
    const resumed = vi.fn();
    void gate.wait.then(resumed);

    await Promise.resolve();
    expect(resumed).not.toHaveBeenCalled();

    gate.release();
    await gate.wait;
    expect(resumed).toHaveBeenCalledOnce();
  });

  it('is safe to release more than once', async () => {
    const gate = createPrewarmResumeStartGate();
    gate.release();
    gate.release();
    await expect(gate.wait).resolves.toBeUndefined();
  });

  it('releases through a bounded backstop when the first-paint owner never arrives', async () => {
    let fire!: () => void;
    let armedMs = 0;
    const gate = createPrewarmResumeStartGate({
      timeoutMs: PREWARM_RESUME_START_BACKSTOP_MS,
      schedule: (onTimeout, ms) => {
        armedMs = ms;
        fire = onTimeout;
        return () => undefined;
      },
    });

    expect(armedMs).toBe(PREWARM_RESUME_START_BACKSTOP_MS);
    fire();
    await expect(gate.wait).resolves.toBeUndefined();
  });
});
