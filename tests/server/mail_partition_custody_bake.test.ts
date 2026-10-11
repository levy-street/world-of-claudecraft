import { describe, expect, it } from 'vitest';
import { writeMailPartitionsInTransaction } from '../../server/mail_db';

const partition = [{ recipientKey: '4242', letters: [] }];

function runWrite(failBake = false): { order: string[]; done: Promise<void> } {
  const order: string[] = [];
  const pool = {
    connect: async () => ({
      query: async (sql: string) => {
        const kind = sql.startsWith('INSERT INTO world_state')
          ? 'MAIL'
          : sql.startsWith('DELETE FROM world_state')
            ? 'MAIL'
            : sql.startsWith('DELETE FROM mail_custody_parcels')
              ? 'BAKE'
              : sql.startsWith('INSERT INTO mail_custody_watermark')
                ? 'WATERMARK'
                : sql;
        order.push(kind);
        if (failBake && kind === 'BAKE') throw new Error('bake failed');
        return { rowCount: 1 };
      },
      release: () => order.push('RELEASE'),
    }),
  };
  const custody = {
    snapshot: (keys: readonly string[]) => {
      expect(keys).toEqual(['4242']);
      order.push('SNAPSHOT');
      return ['vault:4242:1'];
    },
    deleteIn: async (
      query: (sql: string, values: unknown[]) => Promise<unknown>,
      refs: string[],
    ) => {
      expect(refs).toEqual(['vault:4242:1']);
      await query('DELETE FROM mail_custody_parcels', [refs]);
    },
    confirm: (refs: string[]) => {
      expect(refs).toEqual(['vault:4242:1']);
      order.push('CONFIRM');
    },
  };
  const done = (writeMailPartitionsInTransaction as (...args: unknown[]) => Promise<void>)(
    pool,
    'test',
    partition,
    custody,
  );
  return { order, done };
}

describe('partitioned mail custody bake', () => {
  it('bakes the saved recipient on the same client before committing', async () => {
    const { order, done } = runWrite();
    await done;
    expect(order).toEqual(['SNAPSHOT', 'BEGIN', 'MAIL', 'BAKE', 'COMMIT', 'RELEASE', 'CONFIRM']);
  });

  it('rolls back the mailbox and retains pending refs if the bake fails', async () => {
    const { order, done } = runWrite(true);
    await expect(done).rejects.toThrow('bake failed');
    expect(order).toEqual(['SNAPSHOT', 'BEGIN', 'MAIL', 'BAKE', 'ROLLBACK', 'RELEASE']);
  });
});
