import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../server/db', () => ({ pool: { query: db.query } }));

import { takePendingBuddyGrants } from '../../server/buddy_grants_db';
import { BUDDY_KEYS } from '../../src/sim/content/buddies';

beforeEach(() => db.query.mockReset());

describe('queued buddy grant transfer', () => {
  it('moves the queued keys through the catalog roster, not a SQL copy of it', async () => {
    db.query.mockResolvedValue({
      rows: [
        { buddy_key: null, cosmetic_id: 'stag_acorn', id: 2 },
        { buddy_key: 'horse', cosmetic_id: null, id: 1 },
      ],
    });
    await expect(takePendingBuddyGrants(11)).resolves.toEqual([
      { buddyKey: 'horse' },
      { cosmeticId: 'stag_acorn' },
    ]);
    const [sql, values] = db.query.mock.calls[0];
    expect(sql).toContain('g.buddy_key = ANY($2::text[])');
    for (const key of BUDDY_KEYS) expect(sql).not.toContain(`'${key}'`);
    expect(values).toEqual([11, BUDDY_KEYS]);
  });
});
