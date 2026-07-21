import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../server/db', () => ({
  pool: { query: vi.fn(), connect: vi.fn() },
}));

import { pool } from '../server/db';
import {
  createBugReport, listBugReports, getBugReportScreenshot,
  isStorableScreenshot, clampBugReportMeta,
  BugReportRateLimitError, BUG_REPORT_RATE_LIMIT, BUG_SCREENSHOT_MAX,
} from '../server/bug_report_db';

const query = vi.mocked(pool.query);

beforeEach(() => {
  query.mockReset();
});

const base = {
  accountId: 7,
  characterId: 3,
  characterName: 'Borin',
  realm: 'Eastbrook',
  pos: { x: 10, y: 5, z: -20 },
  description: 'fell through the floor',
  screenshot: 'data:image/jpeg;base64,AAAA',
  meta: { build: 'v1' },
};

describe('createBugReport', () => {
  it('inserts with parameterized SQL when under the rate limit', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ n: 0 }] } as any) // rate-limit count
      .mockResolvedValueOnce({ rows: [{ id: 42 }] } as any); // insert
    const res = await createBugReport(base);
    expect(res).toEqual({ id: 42, screenshotStored: true });
    const insert = query.mock.calls[1];
    expect(insert[0]).toContain('INSERT INTO bug_reports');
    expect(insert[1]?.[0]).toBe(7); // account_id bound, not interpolated
    expect(insert[1]?.[8]).toBe(base.screenshot); // valid screenshot retained
  });

  it('throws a rate-limit error at the cap', async () => {
    query.mockResolvedValueOnce({ rows: [{ n: BUG_REPORT_RATE_LIMIT }] } as any);
    await expect(createBugReport(base)).rejects.toBeInstanceOf(BugReportRateLimitError);
    expect(query).toHaveBeenCalledTimes(1); // no insert attempted
  });

  it('drops an oversized screenshot to null rather than storing it', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ n: 0 }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 1 }] } as any);
    const huge = 'data:image/jpeg;base64,' + 'A'.repeat(BUG_SCREENSHOT_MAX);
    const res = await createBugReport({ ...base, screenshot: huge });
    expect(query.mock.calls[1][1]?.[8]).toBeNull();
    expect(res.screenshotStored).toBe(false);
  });

  it('drops a non-image data URL (allowlist) rather than storing it', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ n: 0 }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 1 }] } as any);
    const res = await createBugReport({ ...base, screenshot: 'data:text/html,<b>hi</b>' });
    expect(query.mock.calls[1][1]?.[8]).toBeNull();
    expect(res.screenshotStored).toBe(false);
  });

  it('clamps the stored meta to the bounded shape', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ n: 0 }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 1 }] } as any);
    await createBugReport({ ...base, meta: { build: 'v1', evil: 'x'.repeat(99999), nested: { a: 1 } } });
    const stored = JSON.parse(query.mock.calls[1][1]?.[9] as string);
    expect(stored.build).toBe('v1');
    expect(stored.evil).toBeUndefined(); // unknown field dropped
    expect(stored).toHaveProperty('viewport');
  });

  it('coerces non-finite coordinates to 0', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ n: 0 }] } as any)
      .mockResolvedValueOnce({ rows: [{ id: 1 }] } as any);
    await createBugReport({ ...base, pos: { x: NaN, y: 5, z: Infinity } });
    const params = query.mock.calls[1][1]!;
    expect(params[4]).toBe(0); // pos_x
    expect(params[5]).toBe(5); // pos_y
    expect(params[6]).toBe(0); // pos_z
  });
});

describe('isStorableScreenshot', () => {
  it('accepts only base64 raster image data URLs within the size cap', () => {
    expect(isStorableScreenshot('data:image/jpeg;base64,AAAA')).toBe(true);
    expect(isStorableScreenshot('data:image/png;base64,AAAA')).toBe(true);
    expect(isStorableScreenshot('data:image/webp;base64,AAAA')).toBe(true);
    expect(isStorableScreenshot('data:image/svg+xml;base64,AAAA')).toBe(false);
    expect(isStorableScreenshot('data:text/html,<b>x</b>')).toBe(false);
    expect(isStorableScreenshot('https://example.com/x.jpg')).toBe(false);
    expect(isStorableScreenshot(null)).toBe(false);
    expect(isStorableScreenshot(42)).toBe(false);
    expect(isStorableScreenshot('data:image/jpeg;base64,' + 'A'.repeat(BUG_SCREENSHOT_MAX))).toBe(false);
  });
});

describe('clampBugReportMeta', () => {
  it('returns the bounded shape and drops unknown fields', () => {
    const m = clampBugReportMeta({ build: 'b', extra: 'drop me', viewport: { w: 100, h: 200 } });
    expect(m).toEqual({
      build: 'b', userAgent: '', viewport: { w: 100, h: 200, dpr: 1 },
      zone: '', level: 0, className: '', cameraYaw: 0,
    });
    expect(m).not.toHaveProperty('extra');
  });

  it('truncates over-long strings and coerces non-finite numbers', () => {
    const m = clampBugReportMeta({ userAgent: 'x'.repeat(5000), level: Infinity, cameraYaw: NaN });
    expect(m.userAgent.length).toBe(512);
    expect(m.level).toBe(0);
    expect(m.cameraYaw).toBe(0);
  });

  it('is robust to non-object input', () => {
    expect(clampBugReportMeta(null).build).toBe('');
    expect(clampBugReportMeta('nope').viewport.dpr).toBe(1);
  });
});

describe('listBugReports', () => {
  it('returns rows + total, never selects the raw screenshot, newest first, capped', async () => {
    query
      .mockResolvedValueOnce({ rows: [{ id: 2, has_screenshot: true }, { id: 1, has_screenshot: false }] } as any)
      .mockResolvedValueOnce({ rows: [{ total: 2 }] } as any);
    const { rows, total } = await listBugReports(9999, 0);
    expect(rows.map((r) => r.id)).toEqual([2, 1]);
    expect(rows[0].has_screenshot).toBe(true);
    expect(total).toBe(2);
    const listSql = query.mock.calls[0][0] as string;
    expect(listSql).toContain('ORDER BY created_at DESC');
    expect(listSql).toContain('(screenshot IS NOT NULL) AS has_screenshot');
    expect(listSql).not.toMatch(/SELECT[\s\S]*\bscreenshot\b,/); // raw column not selected
    expect(query.mock.calls[0][1]?.[0]).toBe(200); // clamped to max
  });
});

describe('getBugReportScreenshot', () => {
  it('returns the stored screenshot for an id', async () => {
    query.mockResolvedValueOnce({ rows: [{ screenshot: 'data:image/jpeg;base64,ZZ' }] } as any);
    expect(await getBugReportScreenshot(5)).toBe('data:image/jpeg;base64,ZZ');
    expect(query.mock.calls[0][1]?.[0]).toBe(5);
  });

  it('returns null when the report has no screenshot or does not exist', async () => {
    query.mockResolvedValueOnce({ rows: [] } as any);
    expect(await getBugReportScreenshot(99)).toBeNull();
  });

  it('returns null for a non-finite id without querying', async () => {
    expect(await getBugReportScreenshot(NaN)).toBeNull();
    expect(query).not.toHaveBeenCalled();
  });
});
