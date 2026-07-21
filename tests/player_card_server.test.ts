import { Readable } from 'node:stream';
import { deflateSync } from 'node:zlib';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Same DB-test pattern as wallet_server.test.ts: stub DATABASE_URL + mock pg so
// db.ts loads and every pool.query is a spy we route by SQL. Drives the REAL
// card/referral handlers through every branch with no live database.
const dbMock = vi.hoisted(() => {
  process.env.DATABASE_URL ??= 'postgres://test/test';
  delete process.env.PUBLIC_ORIGIN;
  delete process.env.REALMS;
  delete process.env.REALM_NAME;
  return { query: vi.fn() };
});
vi.mock('pg', () => ({
  Pool: vi.fn(function Pool() {
    return { query: dbMock.query };
  }),
}));

import { lifetimeXpStanding } from '../server/db';
import {
  captureReferral,
  handleCardRoutes,
  handleCardUpload,
  isValidSlug,
  MAX_CARD_BYTES,
  normalizePublicCardLocale,
  PUBLIC_CARD_COPY,
  PUBLIC_CARD_LOCALES,
  slugify,
} from '../server/player_card';
import { publicOriginForRealm, resolvePublicOrigin } from '../server/realm';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const fakeMagicHeaderPng = Buffer.concat([PNG_MAGIC, Buffer.from('IDATfake-pixels')]);

const TEST_CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < table.length; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function testCrc32(buf: Buffer, start: number, end: number): number {
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = TEST_CRC32_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data = Buffer.alloc(0)): Buffer {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, 4, 'ascii');
  data.copy(chunk, 8);
  chunk.writeUInt32BE(testCrc32(chunk, 4, 8 + data.length), 8 + data.length);
  return chunk;
}

function makePng(width: number, height: number): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // truecolor with alpha
  ihdr[10] = 0; // deflate compression
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace
  const raw = Buffer.alloc((width * 4 + 1) * height);
  return Buffer.concat([
    PNG_MAGIC,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND'),
  ]);
}
const validCardPng = makePng(2400, 1260);

// ── http fakes ──────────────────────────────────────────────────────────────
function makeBinaryReq(url: string, body: Buffer): any {
  const req: any = Readable.from([body]);
  req.url = url;
  req.headers = { host: 'realm.example' };
  req.socket = {};
  return req;
}
function makeUnreadableBinaryReq(
  url: string,
  headers: Record<string, string> = {},
): { req: any; wasRead: () => boolean } {
  let read = false;
  const req: any = new Readable({
    read() {
      read = true;
      this.destroy(new Error('body should not be read'));
    },
  });
  req.url = url;
  req.headers = { host: 'realm.example', ...headers };
  req.socket = {};
  return { req, wasRead: () => read };
}
function makeGetReq(
  url: string,
  opts: { headers?: Record<string, unknown>; socket?: unknown } = {},
): any {
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
  const req: any = new Readable({
    read() {
      this.destroy(new Error('stream boom'));
    },
  });
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
    writeHead(status: number, headers?: Record<string, unknown>) {
      this.statusCode = status;
      if (headers) this.headers = headers;
      return this;
    },
    end(data?: string | Buffer) {
      this.body = data ?? '';
      return this;
    },
  };
}

// per-test DB state, routed by SQL
let characterRows: any[] = [];
let slugRows: any[] | ((slug: string) => any[]) = []; // SELECT character_id FROM player_cards WHERE slug
let cardRows: any[] = []; // getPlayerCardBySlug
let accountForSlugRows: any[] = [];
let upsertThrows: Error | null = null;
// lifetimeXpStanding is now a single query (ahead + total via an `own` subquery
// that also gates ownership): no rows ⇒ not the caller's ⇒ null.
let standingCountRows: any[] = [];

beforeEach(() => {
  characterRows = [];
  slugRows = [];
  cardRows = [];
  accountForSlugRows = [];
  upsertThrows = null;
  standingCountRows = [];
  dbMock.query.mockReset();
  dbMock.query.mockImplementation((sql: string, params?: unknown[]) => {
    const s = String(sql).replace(/\s+/g, ' ').trim();
    if (s.includes('AS ahead'))
      return Promise.resolve({ rows: standingCountRows, rowCount: standingCountRows.length });
    if (s.includes('SELECT id, account_id, name, class, level, state'))
      return Promise.resolve({ rows: characterRows });
    if (s.includes('SELECT character_id FROM player_cards WHERE slug')) {
      const slug = String(params?.[0] ?? '');
      const rows = typeof slugRows === 'function' ? slugRows(slug) : slugRows;
      return Promise.resolve({ rows });
    }
    if (s.includes('INSERT INTO player_cards')) {
      if (upsertThrows) return Promise.reject(upsertThrows);
      return Promise.resolve({ rows: [] });
    }
    if (s.includes('SELECT character_id, account_id, png, title, description'))
      return Promise.resolve({ rows: cardRows });
    if (s.includes('SELECT title, description, locale')) return Promise.resolve({ rows: cardRows }); // metadata-only OG page read
    if (s.includes('SELECT account_id FROM player_cards WHERE slug'))
      return Promise.resolve({ rows: accountForSlugRows });
    if (s.includes('INSERT INTO referrals')) return Promise.resolve({ rows: [] });
    return Promise.resolve({ rows: [] });
  });
});

async function callUpload(
  url: string,
  body: Buffer,
  accountId = 1,
  liveLevelForCharacter?: (characterId: number) => number | null,
) {
  const res = makeRes();
  await handleCardUpload(makeBinaryReq(url, body), res, accountId, liveLevelForCharacter);
  return { status: res.statusCode, data: res.body ? JSON.parse(String(res.body)) : {} };
}

type CardOriginEnvKey = 'PUBLIC_ORIGIN' | 'REALM_NAME' | 'REALMS' | 'NODE_ENV';

async function withReloadedCardRoutes(
  env: Partial<Record<CardOriginEnvKey, string | undefined>>,
  run: (routes: typeof handleCardRoutes) => Promise<void>,
): Promise<void> {
  const keys: readonly CardOriginEnvKey[] = ['PUBLIC_ORIGIN', 'REALM_NAME', 'REALMS', 'NODE_ENV'];
  const previous = new Map<CardOriginEnvKey, string | undefined>();
  for (const key of keys) {
    previous.set(key, process.env[key]);
    const value = env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  vi.resetModules();
  const mod = await import('../server/player_card');
  try {
    await run(mod.handleCardRoutes);
  } finally {
    for (const key of keys) {
      const value = previous.get(key);
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    vi.resetModules();
  }
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

describe('public card origin config', () => {
  it('normalizes bare public origins and rejects URL shapes that are not origins', () => {
    expect(resolvePublicOrigin(' https://cards.example.com/// ')).toBe('https://cards.example.com');
    expect(resolvePublicOrigin('http://localhost:8787')).toBe('http://localhost:8787');
    expect(resolvePublicOrigin('javascript://cards.example.com')).toBe('');
    expect(resolvePublicOrigin('https://cards.example.com/path')).toBe('');
    expect(resolvePublicOrigin('https://user:pass@cards.example.com')).toBe('');
    expect(resolvePublicOrigin('https://cards.example.com?x=1')).toBe('');
  });

  it('selects the matching trusted realm origin', () => {
    expect(
      publicOriginForRealm('Ironforge', [
        { name: 'Claudemoon', url: 'https://claudemoon.example.com', type: 'Normal' },
        { name: 'Ironforge', url: 'https://ironforge.example.com', type: 'PvP' },
      ]),
    ).toBe('https://ironforge.example.com');
    expect(
      publicOriginForRealm('Missing', [
        { name: 'Claudemoon', url: 'https://claudemoon.example.com', type: 'Normal' },
      ]),
    ).toBe('');
  });
});

describe('POST /api/card', () => {
  it('stores the PNG and returns the name slug + url', async () => {
    characterRows = [{ id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12 }];
    slugRows = []; // slug free
    const { status, data } = await callUpload('/api/card?character=5', validCardPng);
    expect(status).toBe(200);
    expect(data).toEqual({ url: '/p/sir-test', ref: 'sir-test' });
    const insert = dbMock.query.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO player_cards'),
    );
    expect(insert?.[1][0]).toBe(5); // character_id
    expect(insert?.[1][2]).toBe('sir-test'); // slug
    const storedPng = insert?.[1][3];
    expect(Buffer.isBuffer(storedPng)).toBe(true); // png bytes
    expect(Buffer.isBuffer(storedPng) && storedPng.equals(validCardPng)).toBe(true);
    expect(insert?.[1][4]).toBe('Sir Test - Level 12 Paladin'); // title
    expect(insert?.[1][6]).toBe('en'); // locale
  });

  it('ignores client-reported levels and uses server-side character state for metadata', async () => {
    characterRows = [
      { id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12, state: { level: 12 } },
    ];
    slugRows = [];
    const { status } = await callUpload('/api/card?character=5&level=16', validCardPng);
    expect(status).toBe(200);
    const insert = dbMock.query.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO player_cards'),
    );
    expect(insert?.[1][4]).toBe('Sir Test - Level 12 Paladin');
  });

  it('uses the saved level when level query params are absent or forged', async () => {
    characterRows = [{ id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12 }];
    for (const url of [
      '/api/card?character=5',
      '/api/card?character=5&level=0',
      '/api/card?character=5&level=-3',
      '/api/card?character=5&level=abc',
      '/api/card?character=5&level=1.5',
      '/api/card?character=5&level=999',
    ]) {
      dbMock.query.mockClear();
      slugRows = [];
      const { status } = await callUpload(url, validCardPng);
      expect(status).toBe(200);
      const insert = dbMock.query.mock.calls.find((c) =>
        String(c[0]).includes('INSERT INTO player_cards'),
      );
      expect(insert?.[1][4]).toBe('Sir Test - Level 12 Paladin');
    }
  });

  it('prefers the JSONB state.level over the denormalized column when no level is reported', async () => {
    // The column can lag state by an autosave window; state.level is the fresher
    // server-side value, so it wins over the column when the client sends nothing.
    characterRows = [
      { id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12, state: { level: 14 } },
    ];
    slugRows = [];
    const { status } = await callUpload('/api/card?character=5', validCardPng);
    expect(status).toBe(200);
    const insert = dbMock.query.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO player_cards'),
    );
    expect(insert?.[1][4]).toBe('Sir Test - Level 14 Paladin');
  });

  it('prefers the live in-session level over persisted state', async () => {
    characterRows = [
      { id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12, state: { level: 14 } },
    ];
    slugRows = [];
    const { status } = await callUpload('/api/card?character=5', validCardPng, 1, (id) =>
      id === 5 ? 15 : null,
    );
    expect(status).toBe(200);
    const insert = dbMock.query.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO player_cards'),
    );
    expect(insert?.[1][4]).toBe('Sir Test - Level 15 Paladin');
  });

  it('falls back to persisted state when the character is not online', async () => {
    characterRows = [
      { id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12, state: { level: 14 } },
    ];
    slugRows = [];
    const { status } = await callUpload('/api/card?character=5', validCardPng, 1, () => null);
    expect(status).toBe(200);
    const insert = dbMock.query.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO player_cards'),
    );
    expect(insert?.[1][4]).toBe('Sir Test - Level 14 Paladin');
  });

  it('does not allow bounded-looking level query params to change metadata', async () => {
    characterRows = [{ id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12 }];
    slugRows = [];
    const atBound = await callUpload('/api/card?character=5&level=1000', validCardPng);
    expect(atBound.status).toBe(200);
    expect(
      dbMock.query.mock.calls.find((c) =>
        String(c[0]).includes('INSERT INTO player_cards'),
      )?.[1][4],
    ).toBe('Sir Test - Level 12 Paladin');

    dbMock.query.mockClear();
    slugRows = [];
    const pastBound = await callUpload('/api/card?character=5&level=1001', validCardPng);
    expect(pastBound.status).toBe(200);
    expect(
      dbMock.query.mock.calls.find((c) =>
        String(c[0]).includes('INSERT INTO player_cards'),
      )?.[1][4],
    ).toBe('Sir Test - Level 12 Paladin');
  });

  it('stores localized public-page metadata using the upload locale', async () => {
    characterRows = [{ id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12 }];
    slugRows = [];
    const { status } = await callUpload('/api/card?character=5&lang=es-ES', validCardPng);
    expect(status).toBe(200);
    const insert = dbMock.query.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO player_cards'),
    );
    expect(insert?.[1][4]).toBe('Sir Test - Nivel 12 Paladín');
    expect(insert?.[1][5]).toContain('Sir Test está forjando una leyenda');
    expect(insert?.[1][6]).toBe('es_ES');
  });

  it('falls back to a character-id-suffixed slug when the name slug is taken', async () => {
    characterRows = [{ id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12 }];
    slugRows = (slug) => (slug === 'sir-test' ? [{ character_id: 999 }] : []);
    const { status, data } = await callUpload('/api/card?character=5', validCardPng);
    expect(status).toBe(200);
    expect(data.ref).toBe('sir-test-5');
  });

  it('falls back past a colliding character-id-suffixed slug', async () => {
    characterRows = [{ id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12 }];
    slugRows = (slug) => {
      if (slug === 'sir-test') return [{ character_id: 999 }];
      if (slug === 'sir-test-5') return [{ character_id: 1000 }];
      return [];
    };
    const { status, data } = await callUpload('/api/card?character=5', validCardPng);
    expect(status).toBe(200);
    expect(data).toEqual({ url: '/p/sir-test-5-2', ref: 'sir-test-5-2' });
    const insert = dbMock.query.mock.calls.find((c) =>
      String(c[0]).includes('INSERT INTO player_cards'),
    );
    expect(insert?.[1][2]).toBe('sir-test-5-2');
  });

  it('retries with a suffixed slug on a unique violation', async () => {
    characterRows = [{ id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12 }];
    slugRows = []; // appears free, but the insert races a 23505
    let first = true;
    dbMock.query.mockImplementation((sql: string) => {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      if (s.includes('SELECT id, account_id, name, class, level, state'))
        return Promise.resolve({ rows: characterRows });
      if (s.includes('SELECT character_id FROM player_cards WHERE slug'))
        return Promise.resolve({ rows: [] });
      if (s.includes('INSERT INTO player_cards')) {
        if (first) {
          first = false;
          return Promise.reject(Object.assign(new Error('dup'), { code: '23505' }));
        }
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
    const { status, data } = await callUpload('/api/card?character=5', validCardPng);
    expect(status).toBe(200);
    expect(data.ref).toBe('sir-test-5');
  });

  it('keeps retrying deterministic suffixes after repeated unique violations', async () => {
    characterRows = [{ id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12 }];
    slugRows = []; // every candidate appears free, but the first two inserts race 23505
    let failuresLeft = 2;
    dbMock.query.mockImplementation((sql: string) => {
      const s = String(sql).replace(/\s+/g, ' ').trim();
      if (s.includes('SELECT id, account_id, name, class, level, state'))
        return Promise.resolve({ rows: characterRows });
      if (s.includes('SELECT character_id FROM player_cards WHERE slug'))
        return Promise.resolve({ rows: [] });
      if (s.includes('INSERT INTO player_cards')) {
        if (failuresLeft > 0) {
          failuresLeft--;
          return Promise.reject(Object.assign(new Error('dup'), { code: '23505' }));
        }
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [] });
    });
    const { status, data } = await callUpload('/api/card?character=5', validCardPng);
    expect(status).toBe(200);
    expect(data).toEqual({ url: '/p/sir-test-5-2', ref: 'sir-test-5-2' });
    const insertedSlugs = dbMock.query.mock.calls
      .filter((c) => String(c[0]).includes('INSERT INTO player_cards'))
      .map((c) => c[1][2]);
    expect(insertedSlugs).toEqual(['sir-test', 'sir-test-5', 'sir-test-5-2']);
  });

  it('uses a player-<id> slug for an all-symbol name', async () => {
    characterRows = [{ id: 7, account_id: 1, name: '✦✦✦', class: 'mage', level: 3 }];
    slugRows = [];
    const { data } = await callUpload('/api/card?character=7', validCardPng);
    expect(data.ref).toBe('player-7');
  });

  it('rejects a missing character id with 400', async () => {
    const { status } = await callUpload('/api/card', validCardPng);
    expect(status).toBe(400);
  });

  it('returns 404 when the character is not the caller’s', async () => {
    characterRows = []; // getCharacter finds nothing
    const { status } = await callUpload('/api/card?character=5', validCardPng);
    expect(status).toBe(404);
  });

  it('rejects a non-PNG body with 400', async () => {
    characterRows = [{ id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12 }];
    const { status } = await callUpload('/api/card?character=5', Buffer.from('not a png'));
    expect(status).toBe(400);
    expect(
      dbMock.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO player_cards')),
    ).toBe(false);
  });

  it('rejects a fake magic-header PNG with 400', async () => {
    characterRows = [{ id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12 }];
    const { status, data } = await callUpload('/api/card?character=5', fakeMagicHeaderPng);
    expect(status).toBe(400);
    expect(data.error).toBe('expected a PNG image');
    expect(
      dbMock.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO player_cards')),
    ).toBe(false);
  });

  it('rejects a structurally valid PNG with unexpected dimensions', async () => {
    characterRows = [{ id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12 }];
    const { status } = await callUpload('/api/card?character=5', makePng(32, 32));
    expect(status).toBe(400);
    expect(
      dbMock.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO player_cards')),
    ).toBe(false);
  });

  it('rejects an oversized body with 413 and stores nothing', async () => {
    characterRows = [{ id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12 }];
    const huge = Buffer.concat([PNG_MAGIC, Buffer.alloc(4 * 1024 * 1024 + 1)]); // > MAX_CARD_BYTES (4 MB)
    const { status } = await callUpload('/api/card?character=5', huge);
    expect(status).toBe(413);
    expect(
      dbMock.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO player_cards')),
    ).toBe(false);
  });

  it('rejects an oversized Content-Length before reading the body or looking up a character', async () => {
    const { req, wasRead } = makeUnreadableBinaryReq('/api/card?character=5', {
      'content-length': String(MAX_CARD_BYTES + 1),
    });
    const res = makeRes();
    await handleCardUpload(req, res, 1);
    expect(res.statusCode).toBe(413);
    expect(wasRead()).toBe(false);
    expect(dbMock.query).not.toHaveBeenCalled();
  });

  it('returns 400 when the body read fails with a non-size error', async () => {
    characterRows = [{ id: 5, account_id: 1, name: 'Sir Test', class: 'paladin', level: 12 }];
    const res = makeRes();
    await handleCardUpload(makeErrorBinaryReq('/api/card?character=5'), res, 1);
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(String(res.body)).error).toMatch(/could not read/i);
  });

  it('rejects a non-integer / non-positive character id with 400 and no lookup', async () => {
    for (const url of [
      '/api/card?character=abc',
      '/api/card?character=0',
      '/api/card?character=-5',
      '/api/card?character=1.5',
    ]) {
      dbMock.query.mockClear();
      const { status } = await callUpload(url, validCardPng);
      expect(status).toBe(400);
      expect(
        dbMock.query.mock.calls.some((c) =>
          String(c[0]).includes('SELECT id, account_id, name, class, level, state'),
        ),
      ).toBe(false);
    }
  });
});

describe('GET /p/<slug>', () => {
  it('serves an OG page with escaped meta + the og:image', async () => {
    cardRows = [
      {
        character_id: 5,
        account_id: 1,
        png: validCardPng,
        title: 'A "Quote" <b>',
        description: 'desc & more',
      },
    ];
    const res = makeRes();
    await handleCardRoutes(makeGetReq('/p/sir-test'), res);
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['Content-Type'])).toContain('text/html');
    const html = String(res.body);
    expect(html).toContain('<link rel="canonical" href="http://realm.example/p/sir-test">');
    expect(html).toContain(
      'property="og:image" content="http://realm.example/p/sir-test/card.png"',
    );
    expect(html).toContain('name="twitter:card" content="summary_large_image"');
    expect(html).toContain('src="/p/sir-test/card.png"');
    expect(html).toContain('href="/?ref=sir-test"');
    // title/description are HTML-escaped
    expect(html).toContain('A &quot;Quote&quot; &lt;b&gt;');
    expect(html).toContain('desc &amp; more');
    expect(html).not.toContain('<b>A "Quote"');
    expect(res.headers['Cache-Control']).toBe('public, max-age=120');
  });

  it('serves a bare (unversioned) og:image when the card has no updated_at', async () => {
    // No timestamp (e.g. a legacy row) means no cache-buster: the URL stays the
    // plain /card.png with no ?v=, which is exactly the no-version code path.
    cardRows = [
      {
        character_id: 5,
        account_id: 1,
        png: validCardPng,
        title: 't',
        description: 'd',
        locale: 'en',
      },
    ];
    const res = makeRes();
    await handleCardRoutes(makeGetReq('/p/sir-test'), res);
    const html = String(res.body);
    expect(html).toContain(
      'property="og:image" content="http://realm.example/p/sir-test/card.png"',
    );
    expect(html).not.toContain('card.png?v=');
  });

  it('cache-busts the og:image with the card updated_at so a re-published card is re-fetched', async () => {
    // Without a version query, X/Discord/browsers keep serving the cached PNG for
    // the stable /p/<slug>/card.png URL even after a level-up re-publish.
    const updatedAt = '2026-06-23T19:33:14.000Z';
    const v = Date.parse(updatedAt);
    cardRows = [
      {
        character_id: 5,
        account_id: 1,
        png: validCardPng,
        title: 't',
        description: 'd',
        locale: 'en',
        updated_at: updatedAt,
      },
    ];
    const res = makeRes();
    await handleCardRoutes(makeGetReq('/p/sir-test'), res);
    const html = String(res.body);
    expect(html).toContain(
      `property="og:image" content="http://realm.example/p/sir-test/card.png?v=${v}"`,
    );
    expect(html).toContain(
      `name="twitter:image" content="http://realm.example/p/sir-test/card.png?v=${v}"`,
    );
    expect(html).toContain(`src="/p/sir-test/card.png?v=${v}"`);
    // the canonical/page URL itself is never versioned
    expect(html).toContain('<link rel="canonical" href="http://realm.example/p/sir-test">');
    expect(html).toContain('property="og:url" content="http://realm.example/p/sir-test"');
  });

  it('renders localized server-side public card copy from the stored card locale', async () => {
    cardRows = [
      {
        character_id: 5,
        account_id: 1,
        png: validCardPng,
        title: 't',
        description: 'd',
        locale: 'es_ES',
      },
    ];
    const res = makeRes();
    await handleCardRoutes(makeGetReq('/p/sir-test'), res);
    const html = String(res.body);
    expect(html).toContain('<html lang="es-ES">');
    expect(html).toContain(`>${PUBLIC_CARD_COPY.es_ES.cta}</a>`);
    expect(html).toContain(`<footer>${PUBLIC_CARD_COPY.es_ES.gameName}</footer>`);
    expect(html).not.toContain('\u2192');
    expect(html).not.toContain('\u2014');

    cardRows = [];
    const missing = makeRes();
    await handleCardRoutes(makeGetReq('/p/nope?lang=fr-CA'), missing);
    const missingHtml = String(missing.body);
    expect(missing.statusCode).toBe(404);
    expect(missingHtml).toContain('<html lang="fr-CA">');
    expect(missingHtml).toContain('Cette carte n&#39;est plus disponible.');
    expect(missingHtml).toContain('Elle a peut-être été retirée ou n&#39;a jamais existé.');
    expect(missingHtml).toContain(`>${PUBLIC_CARD_COPY.fr_CA.missingCta}</a>`);
    expect(missingHtml).not.toContain('\u2192');
    expect(missingHtml).not.toContain('\u2014');
  });

  it('has public card wrapper copy for every supported card locale', async () => {
    for (const locale of PUBLIC_CARD_LOCALES) {
      cardRows = [
        { character_id: 5, account_id: 1, png: validCardPng, title: 't', description: 'd', locale },
      ];
      const res = makeRes();
      await handleCardRoutes(makeGetReq('/p/sir-test'), res);
      const html = String(res.body);
      expect(html).toContain(`<html lang="${locale.replace('_', '-')}">`);
      expect(html).toContain(`>${PUBLIC_CARD_COPY[locale].cta}</a>`);
      expect(html).toContain(`<footer>${PUBLIC_CARD_COPY[locale].gameName}</footer>`);
    }
  });

  it('normalizes card locale inputs and falls back to English', () => {
    expect(normalizePublicCardLocale('fr-CA')).toBe('fr_CA');
    expect(normalizePublicCardLocale('zh-Hant')).toBe('zh_TW');
    expect(normalizePublicCardLocale('pt')).toBe('pt_BR');
    expect(normalizePublicCardLocale('unknown')).toBe('en');
  });

  it('uses Accept-Language for missing public card pages when no lang query is present', async () => {
    cardRows = [];
    const res = makeRes();
    await handleCardRoutes(
      makeGetReq('/p/nope', {
        headers: { 'accept-language': 'de-DE;q=0.9,fr-CA;q=0.8,en;q=0.1' },
      }),
      res,
    );
    const html = String(res.body);
    expect(res.statusCode).toBe(404);
    expect(html).toContain('<html lang="de-DE">');
    expect(html).toContain(PUBLIC_CARD_COPY.de_DE.missingCta);
  });

  it('HTML-escapes an apostrophe in the title', async () => {
    cardRows = [
      {
        character_id: 5,
        account_id: 1,
        png: validCardPng,
        title: "D'Argath the Bold",
        description: 'd',
      },
    ];
    const res = makeRes();
    await handleCardRoutes(makeGetReq('/p/sir-test'), res);
    const html = String(res.body);
    expect(html).toContain('D&#39;Argath');
    expect(html).not.toContain("D'Argath");
  });

  it('builds an https origin from x-forwarded-proto (Caddy/proxy)', async () => {
    cardRows = [
      { character_id: 5, account_id: 1, png: validCardPng, title: 't', description: 'd' },
    ];
    const res = makeRes();
    await handleCardRoutes(
      makeGetReq('/p/sir-test', { headers: { 'x-forwarded-proto': 'https' } }),
      res,
    );
    const html = String(res.body);
    expect(html).toContain(
      'property="og:image" content="https://realm.example/p/sir-test/card.png"',
    );
    expect(html).toContain('src="/p/sir-test/card.png"');
    expect(html).toContain('href="/?ref=sir-test"');
  });

  it('builds an https origin from an encrypted socket', async () => {
    cardRows = [
      { character_id: 5, account_id: 1, png: validCardPng, title: 't', description: 'd' },
    ];
    const res = makeRes();
    await handleCardRoutes(makeGetReq('/p/sir-test', { socket: { encrypted: true } }), res);
    expect(String(res.body)).toContain(
      'property="og:url" content="https://realm.example/p/sir-test"',
    );
  });

  it('uses PUBLIC_ORIGIN for canonical URLs instead of hostile Host and forwarded proto', async () => {
    await withReloadedCardRoutes(
      { PUBLIC_ORIGIN: 'https://cards.example.com/' },
      async (routes) => {
        cardRows = [
          { character_id: 5, account_id: 1, png: validCardPng, title: 't', description: 'd' },
        ];
        const res = makeRes();
        await routes(
          makeGetReq('/p/sir-test', {
            headers: { host: 'evil.example', 'x-forwarded-proto': 'javascript' },
          }),
          res,
        );
        const html = String(res.body);
        expect(res.statusCode).toBe(200);
        expect(html).toContain(
          '<link rel="canonical" href="https://cards.example.com/p/sir-test">',
        );
        expect(html).toContain('property="og:url" content="https://cards.example.com/p/sir-test"');
        expect(html).toContain(
          'property="og:image" content="https://cards.example.com/p/sir-test/card.png"',
        );
        expect(html).toContain('src="/p/sir-test/card.png"');
        expect(html).toContain('href="/?ref=sir-test"');
        expect(html).not.toContain('evil.example');
        expect(html).not.toContain('javascript://');
      },
    );
  });

  it('uses a stable production origin instead of hostile headers when no public origin is configured', async () => {
    await withReloadedCardRoutes({ NODE_ENV: 'production' }, async (routes) => {
      cardRows = [
        { character_id: 5, account_id: 1, png: validCardPng, title: 't', description: 'd' },
      ];
      const res = makeRes();
      await routes(
        makeGetReq('/p/sir-test', {
          headers: { host: 'evil.example', 'x-forwarded-proto': 'javascript' },
        }),
        res,
      );
      const html = String(res.body);
      expect(res.statusCode).toBe(200);
      expect(html).toContain(
        '<link rel="canonical" href="https://worldofclaudecraft.com/p/sir-test">',
      );
      expect(html).toContain(
        'property="og:url" content="https://worldofclaudecraft.com/p/sir-test"',
      );
      expect(html).toContain(
        'property="og:image" content="https://worldofclaudecraft.com/p/sir-test/card.png"',
      );
      expect(html).toContain('src="/p/sir-test/card.png"');
      expect(html).toContain('href="/?ref=sir-test"');
      expect(html).not.toContain('evil.example');
      expect(html).not.toContain('javascript://');
    });
  });

  it('uses the trusted dev host in production mode instead of the production fallback', async () => {
    await withReloadedCardRoutes({ NODE_ENV: 'production' }, async (routes) => {
      cardRows = [
        { character_id: 5, account_id: 1, png: validCardPng, title: 't', description: 'd' },
      ];
      const res = makeRes();
      await routes(
        makeGetReq('/p/sir-test', {
          headers: { host: 'dev.worldofclaudecraft.com', 'x-forwarded-proto': 'https' },
        }),
        res,
      );
      const html = String(res.body);
      expect(res.statusCode).toBe(200);
      expect(html).toContain(
        '<link rel="canonical" href="https://dev.worldofclaudecraft.com/p/sir-test">',
      );
      expect(html).toContain(
        'property="og:url" content="https://dev.worldofclaudecraft.com/p/sir-test"',
      );
      expect(html).toContain(
        'property="og:image" content="https://dev.worldofclaudecraft.com/p/sir-test/card.png"',
      );
      expect(html).toContain('src="/p/sir-test/card.png"');
      expect(html).toContain('href="/?ref=sir-test"');
    });
  });

  it('uses the matching REALMS origin for canonical URLs instead of hostile headers', async () => {
    await withReloadedCardRoutes(
      {
        REALM_NAME: 'Ironforge',
        REALMS:
          'Claudemoon=https://claudemoon.example.com=Normal,Ironforge=https://ironforge.example.com=PvP',
      },
      async (routes) => {
        cardRows = [
          { character_id: 5, account_id: 1, png: validCardPng, title: 't', description: 'd' },
        ];
        const res = makeRes();
        await routes(
          makeGetReq('/p/sir-test', {
            headers: { host: 'evil.example', 'x-forwarded-proto': 'http' },
          }),
          res,
        );
        const html = String(res.body);
        expect(res.statusCode).toBe(200);
        expect(html).toContain(
          '<link rel="canonical" href="https://ironforge.example.com/p/sir-test">',
        );
        expect(html).toContain(
          'property="og:url" content="https://ironforge.example.com/p/sir-test"',
        );
        expect(html).toContain(
          'property="og:image" content="https://ironforge.example.com/p/sir-test/card.png"',
        );
        expect(html).toContain('src="/p/sir-test/card.png"');
        expect(html).toContain('href="/?ref=sir-test"');
        expect(html).not.toContain('evil.example');
      },
    );
  });

  it('serves the OG page with a trailing slash', async () => {
    cardRows = [
      { character_id: 5, account_id: 1, png: validCardPng, title: 't', description: 'd' },
    ];
    const res = makeRes();
    await handleCardRoutes(makeGetReq('/p/sir-test/'), res);
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['Content-Type'])).toContain('text/html');
  });

  it('returns 500 when the card metadata lookup throws', async () => {
    dbMock.query.mockImplementation((sql: string) => {
      const s = String(sql).replace(/\s+/g, ' ');
      if (s.includes('SELECT title, description, locale'))
        return Promise.reject(new Error('db down'));
      return Promise.resolve({ rows: [] });
    });
    const res = makeRes();
    await handleCardRoutes(makeGetReq('/p/sir-test'), res);
    expect(res.statusCode).toBe(500);
  });

  it('serves the PNG bytes with image/png', async () => {
    cardRows = [
      { character_id: 5, account_id: 1, png: validCardPng, title: 't', description: 'd' },
    ];
    const res = makeRes();
    await handleCardRoutes(makeGetReq('/p/sir-test/card.png'), res);
    expect(res.statusCode).toBe(200);
    expect(res.headers['Content-Type']).toBe('image/png');
    expect(res.headers['Content-Length']).toBe(validCardPng.length);
    expect(res.headers['Cache-Control']).toBe('public, max-age=300');
    expect(Buffer.isBuffer(res.body)).toBe(true);
    expect((res.body as Buffer).equals(validCardPng)).toBe(true);
  });

  it('404s an unknown slug', async () => {
    cardRows = [];
    const res = makeRes();
    await handleCardRoutes(makeGetReq('/p/nope'), res);
    expect(res.statusCode).toBe(404);
    expect(res.headers['Cache-Control']).toBe('no-store, max-age=0');
  });

  it('404s card.png for an unknown slug without serving image bytes', async () => {
    cardRows = []; // getPlayerCardBySlug finds nothing
    const res = makeRes();
    await handleCardRoutes(makeGetReq('/p/ghost/card.png'), res);
    expect(res.statusCode).toBe(404);
    expect(String(res.headers['Content-Type'])).toContain('text/plain');
    expect(res.headers['Cache-Control']).toBe('no-store, max-age=0');
    expect(res.body).toBe('not found');
    expect(res.headers['Content-Type']).not.toBe('image/png');
    // a card-lookup query DID run (the slug was valid), but nothing was served
    expect(
      dbMock.query.mock.calls.some((c) =>
        String(c[0]).includes(
          'SELECT character_id, account_id, png, title, description, locale FROM player_cards',
        ),
      ),
    ).toBe(true);
  });

  it('404s an invalid slug without touching the database', async () => {
    const res = makeRes();
    await handleCardRoutes(makeGetReq('/p/..%2f..%2fetc'), res);
    expect(res.statusCode).toBe(404);
    expect(dbMock.query).not.toHaveBeenCalled();
  });

  // Regression: a malformed percent-escape makes decodeURIComponent THROW a
  // URIError. That's an unparseable slug → 404 (NOT a 500 server fault), and we
  // must never reach the card-lookup query with it.
  it('404s a malformed percent-escape (decodeURIComponent throws) without a 500 or db lookup', async () => {
    for (const url of ['/p/%E0%A4', '/p/%', '/p/%E0%A4/card.png', '/p/%ZZ']) {
      dbMock.query.mockClear();
      const res = makeRes();
      await handleCardRoutes(makeGetReq(url), res);
      expect(res.statusCode).toBe(404);
      expect(res.statusCode).not.toBe(500);
      expect(String(res.headers['Content-Type'])).toContain('text/plain');
      expect(res.headers['Cache-Control']).toBe('no-store, max-age=0');
      expect(res.body).toBe('not found');
      expect(dbMock.query).not.toHaveBeenCalled();
    }
  });
});

describe('lifetimeXpStanding', () => {
  it('uses the lifetime XP expression index shape for the count-ahead predicate', async () => {
    standingCountRows = [{ ahead: 2, total: 4 }];
    await lifetimeXpStanding(1, 42);

    const sql = String(dbMock.query.mock.calls[0]?.[0]).replace(/\s+/g, ' ').trim();
    expect(sql).toContain("WHERE realm = $1 AND ((state->>'lifetimeXp')::bigint) > own.xp");
    expect(sql).toContain("FROM (SELECT COALESCE(((state->>'lifetimeXp')::bigint), 0) AS xp");
    expect(sql).not.toContain(
      "WHERE realm = $1 AND COALESCE((state->>'lifetimeXp')::bigint, 0) > own.xp",
    );
  });

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
    expect(
      dbMock.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO referrals')),
    ).toBe(false);
  });

  it('ignores an unknown slug', async () => {
    accountForSlugRows = [];
    await captureReferral(42, 'ghost');
    expect(
      dbMock.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO referrals')),
    ).toBe(false);
  });

  it('ignores an invalid/empty ref without querying', async () => {
    await captureReferral(42, '../evil');
    await captureReferral(42, '');
    await captureReferral(42, undefined);
    expect(dbMock.query).not.toHaveBeenCalled();
  });
});
