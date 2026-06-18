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
function makeGetReq(url: string): any {
  const req: any = Readable.from([]);
  req.method = 'GET';
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

beforeEach(() => {
  characterRows = []; slugRows = []; cardRows = []; accountForSlugRows = []; upsertThrows = null;
  dbMock.query.mockReset();
  dbMock.query.mockImplementation((sql: string) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s.includes('SELECT id, account_id, name, class, level, state')) return Promise.resolve({ rows: characterRows });
    if (s.includes('SELECT character_id FROM player_cards WHERE slug')) return Promise.resolve({ rows: slugRows });
    if (s.includes('INSERT INTO player_cards')) {
      if (upsertThrows) return Promise.reject(upsertThrows);
      return Promise.resolve({ rows: [] });
    }
    if (s.includes('SELECT character_id, account_id, png, title, description FROM player_cards')) return Promise.resolve({ rows: cardRows });
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
  });

  it('serves the PNG bytes with image/png', async () => {
    cardRows = [{ character_id: 5, account_id: 1, png: fakePng, title: 't', description: 'd' }];
    const res = makeRes();
    await handleCardRoutes(makeGetReq('/p/sir-test/card.png'), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('image/png');
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
