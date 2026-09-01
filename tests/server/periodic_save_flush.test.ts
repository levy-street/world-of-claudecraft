// The 30 s autosave flush (server/periodic_save_flush.ts), extracted from
// GameServer.flushPeriodicSaves at the masterwrought Phase 18 QA.
//
// WHY IT EXISTS AS A MODULE. The eighth v0.41.0 sync merged a release-side
// flushPeriodicSaves that issued the market, mail and Rift writes TWICE per
// autosave: the release added a profiler-sample argument to each of the three
// and the resolution kept both the sampled and the unsampled call, so every
// realm re-serialized and re-wrote the whole market blob and the whole shared
// Rift state a second time, every thirty seconds, forever. Nothing could see
// it: the flush is four unawaited fire-and-forget calls inside a monolith, and
// no test drove the body at all.
//
// So the write list is a MODULE now, and each write is named exactly once in
// one place. The unit tests below drive the real function; the source pin at
// the end keeps the coordinator from regrowing its own calls beside it.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  PERIODIC_SAVE_WRITE_NAMES,
  type PeriodicSaveWrites,
  runPeriodicSaveFlush,
} from '../../server/periodic_save_flush';
import { methodBody } from '../helpers/method_body';
import { stripComments } from '../helpers/strip_comments';

function fakeWrites(over: Partial<PeriodicSaveWrites> = {}) {
  const calls: string[] = [];
  const track = (name: string) => (): Promise<void> => {
    calls.push(name);
    return Promise.resolve();
  };
  const writes: PeriodicSaveWrites = {
    saveCharacters: vi.fn(track('saveCharacters')),
    saveMarket: vi.fn(track('saveMarket')),
    saveMail: vi.fn(track('saveMail')),
    saveRifts: vi.fn(track('saveRifts')),
    heartbeatLeases: vi.fn(track('heartbeatLeases')),
    pruneIdleGuards: vi.fn(() => {
      calls.push('pruneIdleGuards');
    }),
    ...over,
  };
  return { writes, calls };
}

describe('runPeriodicSaveFlush', () => {
  it('issues every periodic write EXACTLY once', async () => {
    // The regression this module exists for, attributed correctly: three of
    // these run twice per autosave on origin/release/v0.42.0, where a
    // sample-argument revision kept both the sampled and the unsampled call.
    // This branch never carried the doubling (its pre-merge tip has one call
    // each); what the merge cost this side was the profiler sample, so the
    // writes fell out of the saves phase budget. This arm holds the half a
    // count can hold, and it would have caught the release's shape too.
    const { writes, calls } = fakeWrites();
    runPeriodicSaveFlush(writes);
    await Promise.resolve();
    for (const name of PERIODIC_SAVE_WRITE_NAMES) {
      expect(
        calls.filter((c) => c === name),
        `${name} call count`,
      ).toHaveLength(1);
    }
    // And nothing beyond the named set ran.
    expect([...calls].sort()).toEqual([...PERIODIC_SAVE_WRITE_NAMES].sort());
  });

  it('names the whole flush, so a write cannot be issued without joining the list', () => {
    // The list IS the contract the count above is measured against, so a write
    // added to the runner but not the list would make that pin vacuous for it.
    expect([...PERIODIC_SAVE_WRITE_NAMES].sort()).toEqual([
      'heartbeatLeases',
      'pruneIdleGuards',
      'saveCharacters',
      'saveMail',
      'saveMarket',
      'saveRifts',
    ]);
  });

  it('never awaits a write, so a slow save cannot stall the 20 Hz loop', () => {
    // Fire-and-forget is the whole contract of this flush: it is called from
    // inside the tick body, which must return immediately.
    const never = () => new Promise<void>(() => {});
    const { writes } = fakeWrites({
      saveCharacters: vi.fn(never),
      saveMarket: vi.fn(never),
      saveMail: vi.fn(never),
      saveRifts: vi.fn(never),
      heartbeatLeases: vi.fn(never),
    });
    // Returns void, synchronously, with every write still pending.
    expect(runPeriodicSaveFlush(writes)).toBeUndefined();
    expect(writes.saveMarket).toHaveBeenCalledTimes(1);
  });

  it('isolates a rejected write: the others still run and nothing escapes', async () => {
    // One failing save must not take the rest of the flush with it, and must
    // not surface as an unhandled rejection in the tick.
    const errors: Array<{ write: string; err: unknown }> = [];
    const { writes, calls } = fakeWrites({
      saveMarket: vi.fn(() => Promise.reject(new Error('market down'))),
    });
    expect(() =>
      runPeriodicSaveFlush(writes, (write, err) => errors.push({ write, err })),
    ).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(errors).toHaveLength(1);
    expect(errors[0].write).toBe('saveMarket');
    expect((errors[0].err as Error).message).toBe('market down');
    for (const name of PERIODIC_SAVE_WRITE_NAMES) {
      expect(calls.filter((c) => c === name).length, name).toBeLessThanOrEqual(1);
    }
    expect(calls).toContain('saveMail');
    expect(calls).toContain('saveRifts');
  });

  it('survives a synchronous throw from a write the same way', async () => {
    const errors: string[] = [];
    const { writes, calls } = fakeWrites({
      saveCharacters: vi.fn(() => {
        throw new Error('sync boom');
      }),
    });
    expect(() => runPeriodicSaveFlush(writes, (write) => errors.push(write))).not.toThrow();
    await Promise.resolve();
    expect(errors).toEqual(['saveCharacters']);
    expect(calls).toContain('saveMarket');
  });
});

describe('the coordinator does not regrow its own calls beside the runner', () => {
  it('flushPeriodicSaves issues each periodic write exactly once', () => {
    // The source half of the exactly-once pin. It is what actually caught the
    // duplicated merge resolution, and it is what stops the next one: the unit
    // tests above cannot see a second `void this.saveMarket()` typed straight
    // into the coordinator beside the runner call.
    //
    // Comments are stripped, so this very defect being described in a comment
    // cannot satisfy or break the count.
    const game = stripComments(readFileSync(resolve(process.cwd(), 'server/game.ts'), 'utf8'));
    const body = methodBody(game, '  private flushPeriodicSaves(');
    // Anchor: the method still gates on the autosave interval. Without this a
    // renamed or gutted method would satisfy every count below with zeroes.
    expect(body).toContain('AUTOSAVE_SECONDS');
    for (const call of ['this.saveAll(', 'this.saveMarket(', 'this.saveMail(', 'this.saveRifts(']) {
      expect(body.split(call).length - 1, `${call} in flushPeriodicSaves`).toBe(1);
    }
  });

  it('still hands the profiler sample to all three shared-blob writers', () => {
    // What tests/server/loop_lateness_instrumentation.test.ts measured through
    // the literal `void this.saveMarket(sample);` text, which the extraction
    // reshaped into a closure. The PROPERTY is unchanged and load-bearing: the
    // market, mail and Rift writes are deferred onto serial writers, so without
    // the sample their cost never lands in the `saves` phase or in `total`, and
    // the loop-lateness readout under-reports the persistence burst.
    const game = stripComments(readFileSync(resolve(process.cwd(), 'server/game.ts'), 'utf8'));
    const body = methodBody(game, '  private flushPeriodicSaves(');
    expect(body).toContain('const sample = this.tickProfiler.currentSample();');
    for (const call of [
      'this.saveMarket(sample)',
      'this.saveMail(sample)',
      'this.saveRifts(sample)',
    ]) {
      expect(body, call).toContain(call);
    }
    // saveAll takes a reason, not a sample: its cost is the per-character FIFO's,
    // which is measured where those writes are enqueued, not here.
    expect(body).toContain("this.saveAll('autosave')");
  });
});
