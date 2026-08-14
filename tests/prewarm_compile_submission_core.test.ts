import { describe, expect, it, vi } from 'vitest';
import type { PrewarmPacing } from '../src/render/link_rate_budget';
import type { PrewarmCompileLifecycle } from '../src/render/prewarm_compile_lifecycle';
import { submitPrewarmCompileUnit } from '../src/render/prewarm_compile_submission_core';

function harness() {
  const events: string[] = [];
  const record = {
    id: 'scene:0',
    lane: 'programs.compile-submit',
    submittedAtMs: null,
    syncEndAtMs: null,
    settledAtMs: null,
    failedAtMs: null,
    statusAtReveal: null,
  } as const;
  const lifecycle = {
    recordFor: vi.fn(() => record),
    markSubmitted: vi.fn(() => events.push('lifecycle:submitted')),
    markSyncEnd: vi.fn(() => events.push('lifecycle:sync-end')),
    markSettled: vi.fn(() => events.push('lifecycle:settled')),
    markFailed: vi.fn(() => events.push('lifecycle:failed')),
  } as unknown as PrewarmCompileLifecycle;
  const pacing = {
    markSubmitted: vi.fn(() => events.push('pacing:submitted')),
    markSyncEnd: vi.fn((_id: string, links: number) => events.push(`pacing:sync-end:${links}`)),
    markSettled: vi.fn(() => events.push('pacing:settled')),
    markFailed: vi.fn(() => events.push('pacing:failed')),
  } as unknown as PrewarmPacing;
  return { events, lifecycle, pacing };
}

describe('prewarm compile submission core', () => {
  it('reports the synchronous program delta before the asynchronous settlement', async () => {
    const { events, lifecycle, pacing } = harness();
    let programs = 10;
    let settle!: () => void;
    const unit = {
      id: 'scene:0',
      run: () => {
        events.push('run');
        programs = 14;
        return new Promise<void>((resolve) => {
          settle = resolve;
        });
      },
    };

    const submitted = submitPrewarmCompileUnit(unit, 'programs.compile-submit', {
      lifecycle,
      pacing,
      programCount: () => programs,
      onError: vi.fn(),
    });

    expect(events).toEqual([
      'lifecycle:submitted',
      'pacing:submitted',
      'run',
      'lifecycle:sync-end',
      'pacing:sync-end:4',
    ]);
    settle();
    await submitted.done;
    expect(events.slice(-2)).toEqual(['lifecycle:settled', 'pacing:settled']);
  });

  it('turns a synchronous throw into a fail-soft settled submission', async () => {
    const { events, lifecycle, pacing } = harness();
    const error = new Error('compile failed');
    const onError = vi.fn();
    const submitted = submitPrewarmCompileUnit(
      {
        id: 'scene:0',
        run: () => {
          throw error;
        },
      },
      'programs.compile',
      { lifecycle, pacing, programCount: () => 10, onError },
    );

    await expect(submitted.done).resolves.toBeUndefined();
    expect(events).toEqual([
      'lifecycle:submitted',
      'pacing:submitted',
      'lifecycle:sync-end',
      'pacing:sync-end:0',
      'lifecycle:failed',
      'pacing:failed',
    ]);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it('turns a rejected promise into a fail-soft settled submission', async () => {
    // The arm that actually happens in the wild: an async compile whose driver
    // work rejects later, not a synchronous throw. Dropping markFailed here
    // leaves the unit in flight forever, so the adaptive window never reopens
    // and every remaining prewarm unit waits behind it.
    const { events, lifecycle, pacing } = harness();
    const error = new Error('link rejected');
    const onError = vi.fn();
    let programs = 10;
    const submitted = submitPrewarmCompileUnit(
      {
        id: 'scene:0',
        run: () => {
          programs = 13;
          return Promise.reject(error);
        },
      },
      'programs.compile',
      { lifecycle, pacing, programCount: () => programs, onError },
    );

    await expect(submitted.done).resolves.toBeUndefined();
    expect(events).toEqual([
      'lifecycle:submitted',
      'pacing:submitted',
      'lifecycle:sync-end',
      'pacing:sync-end:3',
      'lifecycle:failed',
      'pacing:failed',
    ]);
    expect(onError).toHaveBeenCalledWith(error);
  });
});
