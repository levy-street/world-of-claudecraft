import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
}));

vi.mock('../server/db', () => {
  return { pool: { query: mocks.query } };
});

vi.mock('../server/realm', () => ({
  REALM: 'test-realm',
}));

import {
  currentSitePresenceUsers,
  onlineHistory,
  recordOnlineSample,
  recordSitePresence,
  recordSitePresenceSample,
} from '../server/admin_db';

describe('admin metrics db helpers', () => {
  beforeEach(() => {
    mocks.query.mockReset();
  });

  it('records online player and distinct account samples by realm', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });

    await recordOnlineSample(5, 3);

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO admin_online_samples'),
      ['test-realm', 5, 3],
    );
  });

  it('buckets 24 hour online history by hour', async () => {
    mocks.query.mockResolvedValueOnce({
      rows: [
        {
          bucket_start: '2026-06-24T18:00:00.000Z',
          avg_players: '2.50',
          peak_players: 4,
          avg_accounts: '1.50',
          peak_accounts: 3,
          avg_site_users: '8.25',
          peak_site_users: 11,
        },
      ],
    });

    await expect(onlineHistory('24h')).resolves.toEqual({
      range: '24h',
      bucket: 'hour',
      points: [
        {
          bucketStart: '2026-06-24T18:00:00.000Z',
          avgPlayers: 2.5,
          peakPlayers: 4,
          avgAccounts: 1.5,
          peakAccounts: 3,
          avgSiteUsers: 8.25,
          peakSiteUsers: 11,
        },
      ],
    });
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("date_trunc('hour'"), [
      'test-realm',
      '24 hours',
    ]);
  });

  it('buckets longer online history ranges by day and defaults unknown ranges to 30 days', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });

    await expect(onlineHistory('bogus')).resolves.toEqual({
      range: '30d',
      bucket: 'day',
      points: [],
    });

    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining("date_trunc('day'"), [
      'test-realm',
      '30 days',
    ]);
  });

  it('records anonymous site presence heartbeats with sanitized page names', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [] });

    await recordSitePresence({
      visitorId: 'visitor-123',
      page: 'guide/classes',
      ipHash: 'ip-hash',
      userAgentHash: 'ua-hash',
    });

    expect(mocks.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO site_presence_sessions'),
      ['visitor-123', 'guide/classes', 'ip-hash', 'ua-hash'],
    );
  });

  it('counts and samples recent anonymous site users', async () => {
    mocks.query.mockResolvedValueOnce({ rows: [{ count: 6 }] }).mockResolvedValueOnce({ rows: [] });

    await expect(currentSitePresenceUsers()).resolves.toBe(6);
    await recordSitePresenceSample(6);

    expect(mocks.query).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining('site_presence_sessions'),
    );
    expect(mocks.query).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('INSERT INTO admin_site_presence_samples'),
      [6],
    );
  });
});
