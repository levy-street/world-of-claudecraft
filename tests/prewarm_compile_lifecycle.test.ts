import { describe, expect, it } from 'vitest';
import { createPrewarmCompileLifecycle } from '../src/render/prewarm_compile_lifecycle';

describe('prewarm compile lifecycle', () => {
  it('records the synchronous and asynchronous boundaries on the injected clock', () => {
    let now = 100.1234;
    const lifecycle = createPrewarmCompileLifecycle(() => now);
    const record = lifecycle.recordFor({ id: 'unit-a' }, 'programs.compile-submit');
    lifecycle.markSubmitted(record);
    now = 102.5678;
    lifecycle.markSyncEnd(record);
    now = 140.555;
    lifecycle.markSettled(record);
    expect(record).toMatchObject({
      submittedAtMs: 100.12,
      syncEndAtMs: 102.57,
      settledAtMs: 140.56,
    });
  });

  it('classifies settled, pending, deferred and failed units at reveal', () => {
    let now = 1;
    const lifecycle = createPrewarmCompileLifecycle(() => now++);
    const settled = lifecycle.recordFor({ id: 'settled' }, 'submit');
    lifecycle.markSubmitted(settled);
    lifecycle.markSyncEnd(settled);
    lifecycle.markSettled(settled);
    const pending = lifecycle.recordFor({ id: 'pending' }, 'submit');
    lifecycle.markSubmitted(pending);
    lifecycle.markSyncEnd(pending);
    lifecycle.recordFor({ id: 'deferred' }, 'submit');
    const failed = lifecycle.recordFor({ id: 'failed' }, 'submit');
    lifecycle.markSubmitted(failed);
    lifecycle.markFailed(failed);
    lifecycle.markReveal();
    expect(lifecycle.records.map((record) => [record.id, record.statusAtReveal])).toEqual([
      ['settled', 'settled'],
      ['pending', 'pending'],
      ['deferred', 'deferred'],
      ['failed', 'failed'],
    ]);
  });

  it('labels units first discovered after reveal and preserves unit identity', () => {
    const lifecycle = createPrewarmCompileLifecycle(() => 1);
    const unit = { id: 'late' };
    const first = lifecycle.recordFor(unit, 'planned');
    expect(lifecycle.recordFor(unit, 'submit')).toBe(first);
    expect(first.lane).toBe('submit');
    lifecycle.markReveal();
    expect(lifecycle.recordFor({ id: 'post' }, 'resume').statusAtReveal).toBe('post-reveal');
  });
});
