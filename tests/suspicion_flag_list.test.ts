// The Flagged-view shaping (server/suspicion_flag_list.ts): status filter
// defaults, the 'all' passthrough, and the pagination offset math, over a
// literal dataset (no pool, no cache).
import { describe, expect, it } from 'vitest';
import { flagListResponse } from '../server/suspicion_flag_list';
import type { SuspicionFlagDataset, SuspicionFlagRow } from '../server/suspicion_flags_db';

function flag(id: number, status: SuspicionFlagRow['status']): SuspicionFlagRow {
  return {
    id,
    accountId: 40 + id,
    username: `player${id}`,
    bannedAt: null,
    suspendedUntil: null,
    source: 'bot_detector',
    kind: 'session_automation',
    severity: 'high',
    details: '',
    relatedAccounts: [],
    status,
    copperAtFlag: null,
    copperNow: null,
    occurrences: 1,
    firstSeenAt: '2026-08-01T00:00:00Z',
    lastSeenAt: '2026-08-18T00:00:00Z',
    updatedAt: '2026-08-18T00:00:00Z',
  };
}

const DATASET: SuspicionFlagDataset = {
  rows: [flag(1, 'new'), flag(2, 'under_review'), flag(3, 'cleared'), flag(4, 'actioned')],
  countsByStatus: { new: 1, under_review: 1, cleared: 1, actioned: 1 },
  truncated: false,
};

const params = (status?: string): Pick<URLSearchParams, 'get'> => ({
  get: (name: string) => (name === 'status' && status !== undefined ? status : null),
});

describe('flagListResponse', () => {
  it('defaults to the active tab (new + under_review) when status is absent or unrecognized', () => {
    for (const p of [params(), params('frobnicated')]) {
      const page = flagListResponse(DATASET, p, { page: 1, limit: 25 });
      expect(page.rows.map((row) => row.id)).toEqual([1, 2]);
      expect(page.total).toBe(2);
    }
  });

  it('filters to a concrete status and passes "all" through', () => {
    expect(
      flagListResponse(DATASET, params('cleared'), { page: 1, limit: 25 }).rows.map((r) => r.id),
    ).toEqual([3]);
    const all = flagListResponse(DATASET, params('all'), { page: 1, limit: 25 });
    expect(all.rows).toHaveLength(4);
    expect(all.total).toBe(4);
  });

  it('pages with the caller-supplied page/limit and echoes them back', () => {
    const page2 = flagListResponse(DATASET, params('all'), { page: 2, limit: 3 });
    expect(page2.rows.map((row) => row.id)).toEqual([4]);
    expect(page2).toMatchObject({ total: 4, page: 2, limit: 3 });
    // Past the end: empty rows, same totals.
    expect(flagListResponse(DATASET, params('all'), { page: 9, limit: 3 }).rows).toEqual([]);
  });

  it('passes the global counts and the truncation marker through untouched', () => {
    const page = flagListResponse({ ...DATASET, truncated: true }, params(), {
      page: 1,
      limit: 25,
    });
    expect(page.counts).toBe(DATASET.countsByStatus);
    expect(page.truncated).toBe(true);
  });
});
