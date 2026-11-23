import { describe, expect, it, vi } from 'vitest';
import { writeMailPartitions } from '../server/mail_db';
import { grantEarnedHeroicMarks } from '../src/sim/earned_heroic_marks';
import { Sim } from '../src/sim/sim';
import { expectDefined } from './helpers/defined';

const { saveMailPartitions } = vi.hoisted(() => ({
  saveMailPartitions: vi.fn(async (_partitions: unknown[]) => {}),
}));
vi.mock('../server/db', () => ({ saveMailPartitions }));

import { writeDirtyMailPartitions } from '../server/mail_partition_rearm';

function rig() {
  const sim = new Sim({ seed: 52, playerClass: 'warrior', noPlayer: true });
  const pid = sim.addPlayer('warrior', 'Owner', { characterId: 7 });
  const meta = expectDefined(sim.meta(pid));
  const box = expectDefined(sim.entities.get(sim.postOffice.mailboxIds[0]));
  const player = expectDefined(sim.entities.get(pid));
  player.pos = { ...box.pos };
  player.prevPos = { ...box.pos };
  sim.rebucket(player);
  for (const letter of sim.serializeMail().mail) {
    sim.mailTake(letter.id, pid);
    sim.mailDelete(letter.id, pid);
  }
  sim.takeDirtyMailPartitions();
  return { sim, pid, meta };
}

describe('earned Heroic Marks delivery', () => {
  it('credits the representable boundary directly and defers only the next earned credit', () => {
    const { sim, pid, meta } = rig();
    meta.heroicMarks = Number.MAX_SAFE_INTEGER - 1;
    grantEarnedHeroicMarks(sim.ctx, pid, 1);
    expect(meta.heroicMarks).toBe(Number.MAX_SAFE_INTEGER);
    expect(sim.serializeMail().mail).toEqual([]);
    grantEarnedHeroicMarks(sim.ctx, pid, 2);
    expect(meta.heroicMarks).toBe(Number.MAX_SAFE_INTEGER);
    expect(sim.serializeMail().mail.map((letter) => letter.items)).toEqual([
      [{ itemId: 'heroic_mark', count: 2 }],
    ]);
  });

  it('refuses invalid amounts and excludes leaving characters before admission', () => {
    const { sim, pid, meta } = rig();
    meta.heroicMarks = Number.MAX_SAFE_INTEGER;
    expect(() => grantEarnedHeroicMarks(sim.ctx, pid, Number.MAX_SAFE_INTEGER + 1)).toThrow();
    meta.leaving = true;
    grantEarnedHeroicMarks(sim.ctx, pid, 1);
    expect(meta.heroicMarks).toBe(Number.MAX_SAFE_INTEGER);
    expect(sim.serializeMail().mail).toEqual([]);
  });

  it.each([0, 100, 10_000])(
    'coalesces and rearms earned mail with %s existing authored letters',
    async (backlog) => {
      const { sim, pid, meta } = rig();
      saveMailPartitions.mockReset();
      for (let i = 0; i < backlog; i++) sim.postOffice.sendWelcome(meta);
      sim.takeDirtyMailPartitions();
      meta.heroicMarks = Number.MAX_SAFE_INTEGER;
      for (let i = 0; i < 3; i++) grantEarnedHeroicMarks(sim.ctx, pid, 2);
      expect(saveMailPartitions).not.toHaveBeenCalled();
      const start = performance.now();
      const partitions = sim.takeDirtyMailPartitions();
      const drainMs = performance.now() - start;
      expect(partitions).toHaveLength(1);
      const partition = expectDefined(partitions[0]);
      expect(partition.recipientKey).toBe('7');
      expect(partition.letters).toHaveLength(backlog + 3);
      expect(
        partition.letters.filter((letter) => letter.letterId === 'heroic_marks_reward'),
      ).toHaveLength(3);
      expect(sim.takeDirtyMailPartitions()).toEqual([]);
      sim.markMailPartitionsDirty(['7']);
      saveMailPartitions.mockRejectedValueOnce(new Error('injected save failure'));
      await expect(writeDirtyMailPartitions(sim, async (write) => write(), true)).rejects.toThrow(
        'injected save failure',
      );
      const failed = saveMailPartitions.mock.calls[0][0];
      expect(failed).toEqual(partitions);
      saveMailPartitions.mockResolvedValueOnce(undefined);
      const rewriteStart = performance.now();
      await writeDirtyMailPartitions(sim, async (write) => write(), true);
      const rewriteMs = performance.now() - rewriteStart;
      expect(saveMailPartitions.mock.calls[1][0]).toEqual(partitions);
      expect(sim.takeDirtyMailPartitions()).toEqual([]);
      await writeDirtyMailPartitions(sim, async (write) => write(), true);
      expect(saveMailPartitions).toHaveBeenCalledTimes(2);
      const query = vi.fn(async (_text: string, _values?: unknown[]) => ({ rows: [] }));
      const encodeStart = performance.now();
      await writeMailPartitions({ query }, 'test', partitions);
      const encodeAndRecordMs = performance.now() - encodeStart;
      expect(query).toHaveBeenCalledOnce();
      expect(query.mock.calls[0][0]).toContain('INSERT INTO world_state');
      expect(query.mock.calls[0][1]?.[0]).toEqual(['mail:test:r:7']);
      await writeMailPartitions({ query }, 'test', []);
      expect(query).toHaveBeenCalledOnce();
      console.log(
        JSON.stringify({
          authoredBacklog: backlog,
          recipients: partitions.length,
          letters: partition.letters.length,
          encodedBucketBytes: Buffer.byteLength(JSON.stringify(partition.letters)),
          encodedBatchBytes: Buffer.byteLength(JSON.stringify(partitions)),
          bookingQueries: 0,
          recordedNonemptyUpserts: query.mock.calls.length,
          encodeAndRecordMs,
          failedFlushCalls: 1,
          retryFlushCalls: 1,
          quietFlushCalls: 0,
          drainMs,
          mockedRewriteMs: rewriteMs,
        }),
      );
    },
  );
});
