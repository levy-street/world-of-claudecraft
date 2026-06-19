import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Readable } from 'node:stream';

// Same DB-test pattern as wallet_server.test.ts: stub DATABASE_URL + mock pg so
// db.ts loads and every pool.query is a spy we route by SQL. Drives the REAL
// card/referral handlers through every branch with no live database.
const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  return { query: vi.fn() };
});
vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() { return { query: dbMock.query }; }),
}));

import {
  handleCardUpload, handleCardRoutes, captureReferral, slugify, isValidSlug,
} from '../server/player_card';
import { lifetimeXpStanding } from '../server/db';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const fakePng = Buffer.concat([PNG_MAGIC, Buffer.from('IDATfake-pixels')]);

// ── http fakes ──────────────────────────────────────────────────────────────
function makeBinaryReq(url: string, body: Buffer): any {
  const req: any = Readable.from([body]);
  req.url = url;
  req.headers = { host: 'realm.example' };
  req.socket = {};
  return req;
}
function makeGetReq(url: string, opts: { headers?: Record<string, unknown>; socket?: unknown } = {}): any {
  const req: any = Readable.from([]);
  req.method = 'GET';
  req.url = url;
  req.headers = { host: 'realm.example', ...(opts.headers ?? {}) };
  req.socket = opts.socket ?? {};
  return req;
}
// A binary request whose body read fails with a non-size error (stream error),
// to exercise the upload's 'could not read image' (400) branch.
function makeErrorBinaryReq(url: string): any {
  const req: any = new Readable({ read() { this.destroy(new Error('stream boom')); } });
  req.url = url;
  req.headers = { host: 'realm.example' };
  req.socket = {};
  return req;
}
function makeRes(): any {
  return {
    statusCode: 0,
    headers: {} as Record<string, unknown>,
    body: '' as string | Buffer,
    writeHead(status: number, headers?: Record<string, unknown>) { this.statusCode = status; if (headers) this.headers = headers; return this; },
    end(data?: string | Buffer) { this.body = data ?? ''; return this; },
  };
}

// per-test DB state, routed by SQL
let characterRows: any[] = [];
let slugRows: any[] = [];          // SELECT character_id FROM player_cards WHERE slug
let cardRows: any[] = [];          // getPlayerCardBySlug
let accountForSlugRows: any[] = [];
let upsertThrows: Error | null = null;
// lifetimeXpStanding is now a single query (ahead + total via an `own` subquery
// that also gates ownership): no rows ⇒ not the caller's ⇒ null.
let standingCountRows: any[] = [];

beforeEach(() => {
  characterRows = []; slugRows = []; cardRows = []; accountForSlugRows = []; upsertThrows = null;
  standingCountRows = [];
  dbMock.query.mockReset();
  dbMock.query.mockImplementation((sql: string) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s.includes('AS ahead')) return Promise.resolve({ rows: standingCountRows, rowCount: standingCountRows.length });
    if (s.includes('SELECT id, account_id, name, class, level, state')) return Promise.resolve({ rows: characterRows });
    if (s.includes('SELECT character_id FROM player_cards WHERE slug')) return Promise.resolve({ rows: slugRows });
    if (s.includes('INSERT INTO player_cards')) {
      if (upsertThrows) return Promise.reject(upsertThrows);
      return Promise.resolve({ rows: [] });
    }
    if (s.includes('SELECT character_id, account_id, png, title, description FROM player_cards')) return Promise.resolve({ rows: cardRows });
    if (s.includes('SELECT title, description FROM player_cards')) return Promise.resolve({ rows: cardRows }); // metadata-only OG page read
    if (s.includes('SELECT account_id FROM player_cards WHERE slug')) return Promise.resolve({ rows: accountForSlugRows });
    if (s.includes('INSERT INTO referrals')) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
});

async function callUpload(url: string, body: Buffer, accountId = 1) {
  const res = makeRes();
  await handleCardUpload(makeBinaryReq(url, body), res, accountId);
  return { status: res.statusCode, data: res.body ? JSON.parse(String(res.body)) : {} };
}

describe('slugify / isValidSlug', () => {
  it('builds url-safe slugs from names', () => {
    expect(slugify('Sir Test')).toBe('sir-test');
    expect(slugify("D'Argath the Bold!!")).toBe('d-argath-the-bold');
    expect(slugify('  Mixed__Case  ')).toBe('mixed-case');
    expect(slugify('日本語')).toBe(''); // non-latin collapses to empty → caller falls back
    expect(slugify('a'.repeat(80)).length).toBe(40);
  });
  it('validates incoming slugs and rejects traversal / junk', () => {
    expect(isValidSlug('sir-test')).toBe(true);
    expect(isValidSlug('player-42')).toBe(true);
    expect(isValidSlug('')).toBe(false);
    expect(isValidSlug('-leading')).toBe(false);
    expect(isValidSlug('../etc/passwd')).toBe(false);
    expect(isValidSlug('has space')).toBe(false);
    expect(isValidSlug('UPPER')).toBe(false);
    expect(isValidSlug('a'.repeat(65))).toBe(false);
  });
});

describe('POST /api/card', () => {
  it('stores the PNG and returns the name slug + url', async () => {
    characterRows = [{ id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12 }];
    slugRows = []; // slug free
    const { status, data } = await callUpload('/api/card?character=5', fakePng);
    expect(status).toBe(200);
    expect(data).toEqual({ url: '/p/sir-test', ref: 'sir-test' });
    const insert = dbMock.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO player_cards'));
    expect(insert?.[1][0]).toBe(5);        // character_id
    expect(insert?.[1][2]).toBe('sir-test'); // slug
    expect(Buffer.isBuffer(insert?.[1][3])).toBe(true); // png bytes
    expect(insert?.[1][4]).toBe('Sir Test — Level 12 Paladin'); // title
  });

  it('falls back to a character-id-suffixed slug when the name slug is taken', async () => {
    characterRows = [{ id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12 }];
    slugRows = [{ character_id: 999 }]; // taken by a different character
    const { status, data } = await callUpload('/api/card?character=5', fakePng);
    expect(status).toBe(200);
    expect(data.ref).toBe('sir-test-5');
  });

  it('retries with a suffixed slug on a unique violation', async () => {
    characterRows = [{ id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12 }];
    slugRows = []; // appears free, but the insert races a 23505
    let first = true;
    dbMock.query.mockImplementation((sql: string) => {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      if (s.includes('SELECT id, account_id, name, class, level, state')) return Promise.resolve({ rows: characterRows });
      if (s.includes('SELECT character_id FROM player_cards WHERE slug')) return Promise.resolve({ rows: [] });
      if (s.includes('INSERT INTO player_cards')) {
        if (first) { first = false; return Promise.reject(Object.assign(new Error('dup'), { code: '23505' })); }
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
    const { status, data } = await callUpload('/api/card?character=5', fakePng);
    expect(status).toBe(200);
    expect(data.ref).toBe('sir-test-5');
  });

  it('uses a player-<id> slug for an all-symbol name', async () => {
    characterRows = [{ id: 7, account_id: 1, name: '✦✦✦', class: 'mage', level: 3 }];
    slugRows = [];
    const { data } = await callUpload('/api/card?character=7', fakePng);
    expect(data.ref).toBe('player-7');
  });

  it('rejects a missing character id with 400', async () => {
    const { status } = await callUpload('/api/card', fakePng);
    expect(status).toBe(400);
  });

  it('returns 404 when the character is not the caller’s', async () => {
    characterRows = []; // getCharacter finds nothing
    const { status } = await callUpload('/api/card?character=5', fakePng);
    expect(status).toBe(404);
  });

  it('rejects a non-PNG body with 400', async () => {
    characterRows = [{ id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12 }];
    const { status } = await callUpload('/api/card?character=5', Buffer.from('not a png'));
    expect(status).toBe(400);
    expect(dbMock.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO player_cards'))).toBe(false);
  });

  it('rejects an oversized body with 413 and stores nothing', async () => {
    characterRows = [{ id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12 }];
    const huge = Buffer.concat([PNG_MAGIC, Buffer.alloc(4 * 1024 * 1024 + 1)]); // > MAX_CARD_BYTES (4 MB)
    const { status } = await callUpload('/api/card?character=5', huge);
    expect(status).toBe(413);
    expect(dbMock.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO player_cards'))).toBe(false);
  });

  it('returns 400 when the body read fails with a non-size error', async () => {
    characterRows = [{ id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12 }];
    const res = makeRes();
    await handleCardUpload(makeErrorBinaryReq('/api/card?character=5'), res, 1);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(String(res.body)).error).toMatch(/could not read/i);
  });

  it('rejects a non-integer / non-positive character id with 400 and no lookup', async () => {
    for (const url of ['/api/card?character=abc', '/api/card?character=0', '/api/card?character=-5', '/api/card?character=1.5']) {
      dbMock.query.mockClear();
      const { status } = await callUpload(url, fakePng);
      expect(status).toBe(400);
      expect(dbMock.query.mock.calls.some((c) => String(c[0]).includes('SELECT id, account_id, name, class, level, state'))).toBe(false);
    }
  });
});

describe('GET /p/<slug>', () => {
  it('serves an OG page with escaped meta + the og:image', async () => {
    cardRows = [{ character_id: 5, account_id: 1, png: fakePng, title: 'A "Quote" <b>', description: 'desc & more' }];
    const res = makeRes();
    await handleCardRoutes(makeGetReq('/p/sir-test'), res);
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['Content-Type'])).toContain('text/html');
    const html = String(res.body);
    expect(html).toContain('property="og:image" content="http://realm.example/p/sir-test/card.png"');
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('href="http://realm.example/?ref=sir-test"');
    // title/description are HTML-escaped
    expect(html).toContain('A &quot;Quote&quot; &lt;b&gt;');
    expect(html).toContain('desc &amp; more');
    expect(html).not.toContain('<b>A "Quote"');
    expect(res.headers['Cache-Control']).toBe('public, max-age=120');
  });

  it('HTML-escapes an apostrophe in the title', async () => {
    cardRows = [{ character_id: 5, account_id: 1, png: fakePng, title: "D'Argath the Bold", description: 'd' }];
    const res = makeRes();
    await handleCardRoutes(makeGetReq('/p/sir-test'), res);
    const html = String(res.body);
    expect(html).toContain('D&#39;Argath');
    expect(html).not.toContain("D'Argath");
  });

  it('builds an https origin from x-forwarded-proto (Caddy/proxy)', async () => {
    cardRows = [{ character_id: 5, account_id: 1, png: fakePng, title: 't', description: 'd' }];
    const res = makeRes();
    await handleCardRoutes(makeGetReq('/p/sir-test', { headers: { 'x-forwarded-proto': 'https' } }), res);
    const html = String(res.body);
    expect(html).toContain('property="og:image" content="https://realm.example/p/sir-test/card.png"');
    expect(html).toContain('href="https://realm.example/?ref=sir-test"');
  });

  it('builds an https origin from an encrypted socket', async () => {
    cardRows = [{ character_id: 5, account_id: 1, png: fakePng, title: 't', description: 'd' }];
    const res = makeRes();
    await handleCardRoutes(makeGetReq('/p/sir-test', { socket: { encrypted: true } }), res);
    expect(String(res.body)).toContain('property="og:url" content="https://realm.example/p/sir-test"');
  });

  it('serves the OG page with a trailing slash', async () => {
    cardRows = [{ character_id: 5, account_id: 1, png: fakePng, title: 't', description: 'd' }];
    const res = makeRes();
    await handleCardRoutes(makeGetReq('/p/sir-test/'), res);
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['Content-Type'])).toContain('text/html');
  });

  it('returns 500 when the card metadata lookup throws', async () => {
    dbMock.query.mockImplementation((sql: string) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (s.includes('SELECT title, description FROM player_cards')) return Promise.reject(new Error('db down'));
      return Promise.resolve({ rows: [] });
    });
    const res = makeRes();
    await handleCardRoutes(makeGetReq('/p/sir-test'), res);
    expect(res.statusCode).toBe(500);
  });

  it('serves the PNG bytes with image/png', async () => {
    cardRows = [{ character_id: 5, account_id: 1, png: fakePng, title: 't', description: 'd' }];
    const res = makeRes();
    await handleCardRoutes(makeGetReq('/p/sir-test/card.png'), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('image/png');
    expect(res.headers['Content-Length']).toBe(fakePng.length);
    expect(res.headers['Cache-Control']).toBe('public, max-age=300');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).equals(fakePng)).toBe(true);
  });

  it('404s an unknown slug', async () => {
    cardRows = [];
    const res = makeRes();
    await handleCardRoutes(makeGetReq('/p/nope'), res);
    expect(res.statusCode).toBe(404);
  });

  it('404s an invalid slug without touching the database', async () => {
    const res = makeRes();
    await handleCardRoutes(makeGetReq('/p/..%2f..%2fetc'), res);
    expect(res.statusCode).toBe(404);
    expect(dbMock.query).not.toHaveBeenCalled();
  });
});

describe('lifetimeXpStanding', () => {
  it('returns 1-based rank + realm total for an owned character', async () => {
    standingCountRows = [{ ahead: 9, total: 500 }];
    const s = await lifetimeXpStanding(1, 42);
    expect(s).toEqual({ rank: 10, total: 500 }); // 9 ahead → rank 10
  });

  it('returns the rank for a mid-pack character', async () => {
    standingCountRows = [{ ahead: 49, total: 100 }];
    expect(await lifetimeXpStanding(1, 42)).toEqual({ rank: 50, total: 100 });
  });

  it('returns null when the character is not the caller’s (no rows)', async () => {
    standingCountRows = []; // the `own` subquery matched nothing → rowCount 0
    expect(await lifetimeXpStanding(1, 999)).toBeNull();
  });

  it('ranks a brand-new character (0 ahead) as rank 1', async () => {
    standingCountRows = [{ ahead: 0, total: 3 }];
    expect(await lifetimeXpStanding(1, 5)).toEqual({ rank: 1, total: 3 });
  });

  it('falls back to rank 1 / total 0 when the count columns are absent', async () => {
    standingCountRows = [{}]; // owned (one row) but ahead/total null → COALESCE-to-0 path
    expect(await lifetimeXpStanding(1, 5)).toEqual({ rank: 1, total: 0 });
  });
});

describe('captureReferral', () => {
  it('records a referral for a known slug owned by another account', async () => {
    accountForSlugRows = [{ account_id: 10 }];
    await captureReferral(42, 'sir-test');
    const ins = dbMock.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO referrals'));
    expect(ins?.[1]).toEqual([42, 10, 'sir-test']);
  });

  it('ignores a self-referral', async () => {
    accountForSlugRows = [{ account_id: 42 }];
    await captureReferral(42, 'sir-test');
    expect(dbMock.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO referrals'))).toBe(false);
  });

  it('ignores an unknown slug', async () => {
    accountForSlugRows = [];
    await captureReferral(42, 'ghost');
    expect(dbMock.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO referrals'))).toBe(false);
  });

  it('ignores an invalid/empty ref without querying', async () => {
    await captureReferral(42, '../evil');
    await captureReferral(42, '');
    await captureReferral(42, undefined);
    expect(dbMock.query).not.toHaveBeenCalled();
  });
});
