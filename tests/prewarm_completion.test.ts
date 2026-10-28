import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPrewarmCompileLifecycle } from '../src/render/prewarm_compile_lifecycle';
import {
  assertCompletePrewarmEntry,
  assertPrewarmLinksSettled,
  awaitPrewarmCompletion,
  completeDesktopPrewarm,
  completePrewarmRemainder,
  PrewarmCompletionError,
  PrewarmCompletionScope,
  settleInitialPrewarmRemainder,
} from '../src/render/prewarm_completion';
import { createPrewarmResumeLedger } from '../src/render/prewarm_resume_ledger_core';

afterEach(() => vi.useRealTimers());

describe('complete desktop shader preparation', () => {
  it('rejects unrecoverable partial catalogs while retaining explicit bounded remainders', () => {
    const partial = {
      status: 'partial' as const,
      progress: { done: 0, planned: 1, trimmed: true },
      partialUnits: [],
    };
    expect(() => assertCompletePrewarmEntry('entities.player-archetypes', partial)).toThrow(
      'partial',
    );
    expect(() => assertCompletePrewarmEntry('views.nearby', partial)).not.toThrow();
    expect(() =>
      assertCompletePrewarmEntry('vfx.mount-programs', {
        ...partial,
        partialUnits: [{ id: 'mount', run() {} }],
      }),
    ).not.toThrow();
  });

  it('stops new work on failure and waits for the in-flight owner before cleanup', async () => {
    const scope = new PrewarmCompletionScope();
    let finish!: () => void;
    const task = scope.track(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    const cleanup = vi.fn();
    expect(() => scope.fail(new Error('driver'), cleanup)).toThrow(PrewarmCompletionError);
    expect(() => scope.check()).toThrow('cancelled');
    expect(cleanup).not.toHaveBeenCalled();
    finish();
    await task;
    await Promise.resolve();
    await Promise.resolve();
    expect(cleanup).toHaveBeenCalledOnce();
  });
  it('preserves constrained and synchronous-driver streaming', () => {
    expect(completeDesktopPrewarm(false, true)).toBe(true);
    expect(completeDesktopPrewarm(true, true)).toBe(false);
    expect(completeDesktopPrewarm(false, false)).toBe(false);
  });

  it('rejects a stuck driver and clears its watchdog on successful completion', async () => {
    vi.useFakeTimers();
    await expect(awaitPrewarmCompletion(Promise.resolve(7), 100, 'links')).resolves.toBe(7);
    expect(vi.getTimerCount()).toBe(0);
    await expect(awaitPrewarmCompletion(Promise.resolve(), 0, 'expired')).rejects.toThrow(
      'expired',
    );
    const pending = awaitPrewarmCompletion(new Promise<void>(() => {}), 100, 'links');
    const check = expect(pending).rejects.toThrow(PrewarmCompletionError);
    await vi.advanceTimersByTimeAsync(100);
    await check;
    expect(vi.getTimerCount()).toBe(0);
  });

  it('never calls a deferred compile record settled', () => {
    const lifecycle = createPrewarmCompileLifecycle(() => 1);
    lifecycle.recordFor({ id: 'hidden' }, 'programs.compile');
    expect(() => assertPrewarmLinksSettled(lifecycle.records)).toThrow('hidden');
  });

  it('rejects failed links even after settlement and accepts successful settled links', () => {
    const lifecycle = createPrewarmCompileLifecycle(() => 1);
    const record = lifecycle.recordFor({ id: 'driver-link' }, 'programs.compile');
    record.settledAtMs = 2;
    expect(() => assertPrewarmLinksSettled(lifecycle.records)).not.toThrow();
    record.failedAtMs = 1;
    expect(() => assertPrewarmLinksSettled(lifecycle.records)).toThrow('driver-link');
  });

  it('waits for the first paint before constrained remainder work or publication', async () => {
    const events: string[] = [];
    let paint!: () => void;
    const afterFirstPaint = new Promise<void>((resolve) => {
      paint = resolve;
    });
    const ledger = createPrewarmResumeLedger();
    const task = settleInitialPrewarmRemainder({
      entries: [
        {
          id: 'catalog',
          units: [
            {
              id: 'last',
              run: () => {
                events.push('last');
              },
            },
          ],
        },
      ],
      submitted: [{ done: Promise.resolve() }],
      ledger,
      hooks: { idleSlot: async () => {} },
      afterFirstPaint,
      publish() {
        events.push('publish');
      },
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual([]);
    paint();
    await task;
    expect(events).toEqual(['last', 'publish']);
    expect(ledger.stats().status).toBe('done');
  });

  it('drains later units but reports any failed unit instead of publishing success', async () => {
    const ran: string[] = [];
    const failure = vi.fn();
    await expect(
      completePrewarmRemainder(
        [
          {
            id: 'catalog',
            units: [
              {
                id: 'broken',
                run() {
                  throw new Error('driver');
                },
              },
              {
                id: 'next',
                run() {
                  ran.push('next');
                },
              },
            ],
          },
        ],
        { idleSlot: async () => {}, onUnitError: failure },
      ),
    ).rejects.toThrow('catalog:broken');
    expect(ran).toEqual(['next']);
    expect(failure).toHaveBeenCalledOnce();
  });

  it('keeps owners alive until submitted links and all remainder units settle', async () => {
    const events: string[] = [];
    let settle!: () => void;
    const submitted = new Promise<void>((resolve) => {
      settle = resolve;
    });
    const ledger = createPrewarmResumeLedger();
    const task = settleInitialPrewarmRemainder({
      entries: [
        {
          id: 'catalog',
          units: [
            {
              id: 'last',
              run() {
                events.push('last');
              },
            },
          ],
        },
      ],
      submitted: [{ done: submitted }],
      ledger,
      hooks: { idleSlot: async () => {} },
      publish() {
        events.push('publish');
      },
    });
    await Promise.resolve();
    expect(events).toEqual([]);
    settle();
    await task;
    expect(events).toEqual(['last', 'publish']);
    expect(ledger.stats().status).toBe('done');
  });
});
