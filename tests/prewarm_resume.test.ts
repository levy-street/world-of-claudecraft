import { describe, expect, it } from 'vitest';
import { type PrewarmResumeEntry, resumeDroppedPrewarmEntries } from '../src/render/prewarm_resume';

function entry(id: string): PrewarmResumeEntry {
  return { id };
}

describe('resumeDroppedPrewarmEntries', () => {
  it('resumes every dropped entry in order, each behind its own idle slot and a fresh deadline', async () => {
    const dropped = [
      entry('foliage.materials'),
      entry('weather.materials'),
      entry('programs.compile'),
    ];
    const events: string[] = [];
    await resumeDroppedPrewarmEntries(dropped, {
      idleSlot: async () => {
        events.push('idle');
      },
      extendDeadline: () => {
        events.push('extend');
      },
      runEntry: async (e) => {
        events.push(`run:${e.id}`);
      },
      afterEntry: (e) => {
        events.push(`after:${e.id}`);
      },
    });
    expect(events).toEqual([
      'idle',
      'extend',
      'run:foliage.materials',
      'after:foliage.materials',
      'idle',
      'extend',
      'run:weather.materials',
      'after:weather.materials',
      'idle',
      'extend',
      'run:programs.compile',
      'after:programs.compile',
    ]);
  });

  it('waits for the idle slot to resolve before extending the deadline or running the entry', async () => {
    const dropped = [entry('vfx.atlas')];
    let idleResolved = false;
    await resumeDroppedPrewarmEntries(dropped, {
      idleSlot: () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            idleResolved = true;
            resolve();
          }, 0);
        }),
      extendDeadline: () => {
        expect(idleResolved).toBe(true);
      },
      runEntry: async () => {
        expect(idleResolved).toBe(true);
      },
    });
  });

  it('does nothing when there are no dropped entries', async () => {
    let calls = 0;
    await resumeDroppedPrewarmEntries([], {
      idleSlot: async () => {
        calls++;
      },
      extendDeadline: () => {
        calls++;
      },
      runEntry: async () => {
        calls++;
      },
    });
    expect(calls).toBe(0);
  });

  it('tolerates a missing afterEntry hook', async () => {
    await expect(
      resumeDroppedPrewarmEntries([entry('sky.current-zone')], {
        idleSlot: async () => {},
        extendDeadline: () => {},
        runEntry: async () => {},
      }),
    ).resolves.toBeUndefined();
  });

  it('stops resuming the remaining entries when runEntry rejects', async () => {
    const dropped = [entry('a'), entry('b')];
    const ran: string[] = [];
    await expect(
      resumeDroppedPrewarmEntries(dropped, {
        idleSlot: async () => {},
        extendDeadline: () => {},
        runEntry: async (e) => {
          ran.push(e.id);
          if (e.id === 'a') throw new Error('boom');
        },
      }),
    ).rejects.toThrow('boom');
    expect(ran).toEqual(['a']);
  });
});
