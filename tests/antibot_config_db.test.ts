import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  connect: vi.fn(),
  poolQuery: vi.fn(),
}));

vi.mock('../server/db', () => ({
  pool: {
    connect: mocks.connect,
    query: mocks.poolQuery,
  },
}));

vi.mock('../server/realm', () => ({ REALM: 'test-realm' }));

import { listAntibotConfigHistory, saveAntibotConfigChange } from '../server/antibot_config_db';

function fakeClient(
  handler: (sql: string, params: unknown[] | undefined) => Promise<{ rows: unknown[] }>,
) {
  const query = vi.fn(handler);
  const release = vi.fn();
  mocks.connect.mockResolvedValue({ query, release });
  return { query, release };
}

beforeEach(() => {
  mocks.connect.mockReset();
  mocks.poolQuery.mockReset();
});

describe('saveAntibotConfigChange', () => {
  it('updates the current document and appends its audit row in one transaction', async () => {
    const { query, release } = fakeClient(async (sql) => {
      if (sql.includes('SELECT data')) {
        return {
          rows: [
            {
              data: { 'demo.limit': 10 },
              updated_at: '2026-07-04T00:00:00.000Z',
              unchanged: false,
            },
          ],
        };
      }
      if (sql.includes('RETURNING updated_at')) {
        return { rows: [{ updated_at: '2026-07-04T00:00:01.000Z' }] };
      }
      return { rows: [] };
    });

    await expect(
      saveAntibotConfigChange({ 'demo.limit': 20 }, 7, 'Increase preview limit'),
    ).resolves.toEqual({
      changed: true,
      updatedAt: '2026-07-04T00:00:01.000Z',
    });

    expect(query.mock.calls.map(([sql]) => String(sql).trim().split(/\s+/)[0])).toEqual([
      'BEGIN',
      'SELECT',
      'INSERT',
      'INSERT',
      'COMMIT',
    ]);
    const auditCall = query.mock.calls.find(([sql]) =>
      String(sql).includes('bot_detector_config_changes'),
    );
    expect(auditCall?.[1]).toEqual([
      'test-realm',
      7,
      JSON.stringify({ 'demo.limit': 10 }),
      JSON.stringify({ 'demo.limit': 20 }),
      'Increase preview limit',
    ]);
    expect(release).toHaveBeenCalledOnce();
  });

  it('does not update timestamps or history for an unchanged document', async () => {
    const { query } = fakeClient(async (sql) => {
      if (sql.includes('SELECT data')) {
        return {
          rows: [
            {
              data: { 'demo.limit': 10 },
              updated_at: '2026-07-04T00:00:00.000Z',
              unchanged: true,
            },
          ],
        };
      }
      return { rows: [] };
    });

    await expect(saveAntibotConfigChange({ 'demo.limit': 10 }, 7, '')).resolves.toEqual({
      changed: false,
      updatedAt: '2026-07-04T00:00:00.000Z',
    });
    expect(
      query.mock.calls.some(([sql]) => String(sql).includes('bot_detector_config_changes')),
    ).toBe(false);
  });

  it('audits resetting every override as a change to an empty document', async () => {
    const { query } = fakeClient(async (sql) => {
      if (sql.includes('SELECT data')) {
        return {
          rows: [
            {
              data: { 'demo.limit': 10 },
              updated_at: '2026-07-04T00:00:00.000Z',
              unchanged: false,
            },
          ],
        };
      }
      if (sql.includes('RETURNING updated_at')) {
        return { rows: [{ updated_at: '2026-07-04T00:00:01.000Z' }] };
      }
      return { rows: [] };
    });

    await saveAntibotConfigChange({}, 7, 'Return to defaults');
    const auditCall = query.mock.calls.find(([sql]) =>
      String(sql).includes('bot_detector_config_changes'),
    );
    expect(auditCall?.[1]).toEqual([
      'test-realm',
      7,
      JSON.stringify({ 'demo.limit': 10 }),
      JSON.stringify({}),
      'Return to defaults',
    ]);
  });

  it('rolls back and releases the client when the audited write fails', async () => {
    const { query, release } = fakeClient(async (sql) => {
      if (sql.includes('SELECT data')) return { rows: [] };
      if (sql.includes('RETURNING updated_at')) {
        return { rows: [{ updated_at: '2026-07-04T00:00:01.000Z' }] };
      }
      if (sql.includes('bot_detector_config_changes')) throw new Error('audit insert failed');
      return { rows: [] };
    });

    await expect(saveAntibotConfigChange({ 'demo.limit': 20 }, 7, '')).rejects.toThrow(
      'audit insert failed',
    );
    expect(query).toHaveBeenCalledWith('ROLLBACK');
    expect(release).toHaveBeenCalledOnce();
  });
});

describe('listAntibotConfigHistory', () => {
  it('maps the latest realm rows and preserves a deleted admin as unknown', async () => {
    mocks.poolQuery.mockResolvedValue({
      rows: [
        {
          id: '4',
          before_data: {},
          after_data: { 'demo.limit': 20 },
          note: '',
          created_at: '2026-07-04T00:00:01.000Z',
          admin_account_id: null,
          admin_username: null,
        },
      ],
    });

    await expect(listAntibotConfigHistory()).resolves.toEqual([
      {
        id: 4,
        beforeData: {},
        afterData: { 'demo.limit': 20 },
        note: '',
        createdAt: '2026-07-04T00:00:01.000Z',
        adminAccountId: null,
        adminUsername: null,
      },
    ]);
    expect(mocks.poolQuery.mock.calls[0][1]).toEqual(['test-realm', 50]);
  });
});
