// Deeds API surface: the public rarity read (runtime-injected cache, per-IP
// public-read budget), the account broadcast opt-out toggle, the
// character_deeds DDL literal pins, and the character sheet's deeds summary
// block (the shared normalizer every serving arm calls).
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_deeds_units';

import { readFileSync } from 'node:fs';
import type * as http from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';

// The toggle handlers read/write through the deeds SQL boundary; mock it so no
// test reaches the pool-less test db.
vi.mock('../../server/deeds_db', () => ({
  getDeedBroadcasts: vi.fn(async () => true),
  setDeedBroadcasts: vi.fn(async () => {}),
  recentDeedsForCharacter: vi.fn(async () => []),
}));

import { characterSheet, SHEET_RECENT_DEEDS, sheetTitleText } from '../../server/character_sheet';
import { type CharacterRow, SCHEMA } from '../../server/db';
import { configureDeedsRuntime, resetDeedsRuntimeForTests, routes } from '../../server/deeds';
import { getDeedBroadcasts, setDeedBroadcasts } from '../../server/deeds_db';
import {
  PUBLIC_READ_MAX_PER_MINUTE,
  publicReadRateLimited,
  resetPublicReadRateLimits,
} from '../../server/ratelimit';
import { DEEDS } from '../../src/sim/content/deeds';
import type { DeedsRarity } from '../../src/world_api';
import { type FakeRes, fakeCtx, makeReq } from './helpers';

const setFlagMock = vi.mocked(setDeedBroadcasts);
const getFlagMock = vi.mocked(getDeedBroadcasts);

/** Read a handler's response off the fakeCtx's FakeRes. */
function captured(res: http.ServerResponse): { status: number; body: unknown } {
  const fake = res as unknown as FakeRes;
  return { status: fake.statusCode, body: fake.body ? JSON.parse(fake.body) : undefined };
}

/** Grab a registered handler by its route path (+ method where the settings
 *  read and write share one path). */
function handlerFor(path: string, method = path === '/api/deeds/broadcasts' ? 'POST' : 'GET') {
  const route = routes.find((r) => r.path === path && r.method === method);
  if (!route) throw new Error(`no route registered for ${method} ${path}`);
  return route.handler;
}

afterEach(() => {
  resetDeedsRuntimeForTests();
  resetPublicReadRateLimits();
  setFlagMock.mockClear();
  getFlagMock.mockClear();
  getFlagMock.mockImplementation(async () => true);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Route table shape
// ---------------------------------------------------------------------------

describe('deeds route table', () => {
  it('registers exactly the rarity read and the broadcasts read/write pair', () => {
    expect(routes).toHaveLength(3);
    const rarity = routes.find((r) => r.path === '/api/deeds/rarity');
    expect(rarity?.method).toBe('GET');
    expect(rarity?.surface).toBe('api');
    expect(rarity?.middleware).toBeUndefined(); // anonymous; the budget guard is in-handler
    const read = routes.find((r) => r.path === '/api/deeds/broadcasts' && r.method === 'GET');
    expect(read?.surface).toBe('api');
    // The read-tier bearer gate alone (no body parser on a GET); the gate 401s
    // an anonymous request before the handler ever runs.
    expect(read?.middleware).toHaveLength(1);
    const toggle = routes.find((r) => r.path === '/api/deeds/broadcasts' && r.method === 'POST');
    expect(toggle?.surface).toBe('api');
    // The mutation bearer gate + body parser.
    expect(toggle?.middleware).toHaveLength(2);
  });

  it('mounts the READ-scope gate on the GET (source pin: a scope swap must red)', () => {
    // The middleware array only holds opaque functions, so the scope tier is
    // pinned at the source: the read gate is built with scope 'read' and the
    // GET route mounts exactly that gate.
    const src = readFileSync(new URL('../../server/deeds.ts', import.meta.url), 'utf8');
    expect(src).toContain("const readAccount = requireAccount({ scope: 'read' });");
    expect(src).toMatch(
      /method: 'GET',\s*path: '\/api\/deeds\/broadcasts',\s*surface: 'api',\s*middleware: \[readAccount\]/,
    );
  });
});

// ---------------------------------------------------------------------------
// GET /api/deeds/rarity
// ---------------------------------------------------------------------------

describe('rarity handler', () => {
  it('serves the injected runtime payload verbatim', async () => {
    const payload: DeedsRarity = {
      totalEligible: 120,
      earned: { prog_veteran: 30, cmb_thunzharr: 2 },
    };
    configureDeedsRuntime({ deedsRarity: async () => payload });
    const ctx = fakeCtx({ method: 'GET', url: '/api/deeds/rarity' });
    await handlerFor('/api/deeds/rarity')(ctx);
    expect(captured(ctx.res)).toEqual({ status: 200, body: payload });
  });

  it('answers 429 { error } once the public-read budget is exhausted, before the runtime read', async () => {
    const rarityRead = vi.fn(async (): Promise<DeedsRarity> => ({ totalEligible: 0, earned: {} }));
    configureDeedsRuntime({ deedsRarity: rarityRead });
    for (let i = 0; i < PUBLIC_READ_MAX_PER_MINUTE + 1; i++) {
      publicReadRateLimited(makeReq({ method: 'GET', url: '/api/deeds/rarity' }));
    }
    const ctx = fakeCtx({ method: 'GET', url: '/api/deeds/rarity' });
    await handlerFor('/api/deeds/rarity')(ctx);
    expect(captured(ctx.res)).toEqual({ status: 429, body: { error: 'rate limited' } });
    expect(rarityRead).not.toHaveBeenCalled();
  });

  it('fails loudly if a request somehow beats the boot wiring', async () => {
    const ctx = fakeCtx({ method: 'GET', url: '/api/deeds/rarity' });
    await expect(handlerFor('/api/deeds/rarity')(ctx)).rejects.toThrow(
      /deeds runtime is not configured/,
    );
  });
});

// ---------------------------------------------------------------------------
// GET /api/deeds/broadcasts
// ---------------------------------------------------------------------------

describe('broadcasts read handler', () => {
  it('serves the AUTHENTICATED account flag, both values', async () => {
    for (const enabled of [true, false]) {
      getFlagMock.mockImplementation(async () => enabled);
      const ctx = fakeCtx({
        method: 'GET',
        url: '/api/deeds/broadcasts',
        account: { accountId: 7, scope: 'read' },
      });
      await handlerFor('/api/deeds/broadcasts', 'GET')(ctx);
      expect(captured(ctx.res)).toEqual({ status: 200, body: { enabled } });
      expect(getFlagMock).toHaveBeenLastCalledWith(7);
    }
    expect(setFlagMock).not.toHaveBeenCalled();
  });

  it('throws (and never reads) on a ctx with no authenticated account', async () => {
    const ctx = fakeCtx({ method: 'GET', url: '/api/deeds/broadcasts' });
    await expect(handlerFor('/api/deeds/broadcasts', 'GET')(ctx)).rejects.toThrow();
    expect(getFlagMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// POST /api/deeds/broadcasts
// ---------------------------------------------------------------------------

describe('broadcasts toggle handler', () => {
  it('writes the flag for the AUTHENTICATED account and echoes it', async () => {
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/deeds/broadcasts',
      account: { accountId: 7, scope: 'full' },
      body: { enabled: false },
    });
    await handlerFor('/api/deeds/broadcasts')(ctx);
    expect(captured(ctx.res)).toEqual({ status: 200, body: { enabled: false } });
    expect(setFlagMock).toHaveBeenCalledTimes(1);
    expect(setFlagMock).toHaveBeenCalledWith(7, false);
  });

  it('re-enabling writes TRUE (both arms of the boolean are real writes)', async () => {
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/deeds/broadcasts',
      account: { accountId: 9, scope: 'full' },
      body: { enabled: true },
    });
    await handlerFor('/api/deeds/broadcasts')(ctx);
    expect(captured(ctx.res)).toEqual({ status: 200, body: { enabled: true } });
    expect(setFlagMock).toHaveBeenCalledWith(9, true);
  });

  it('rejects a non-boolean enabled with the stable domain code and writes nothing', async () => {
    for (const body of [{}, { enabled: 'yes' }, { enabled: 1 }, null]) {
      const ctx = fakeCtx({
        method: 'POST',
        url: '/api/deeds/broadcasts',
        account: { accountId: 7, scope: 'full' },
        body,
      });
      await handlerFor('/api/deeds/broadcasts')(ctx);
      expect(captured(ctx.res)).toEqual({
        status: 400,
        body: { error: 'invalid input', code: 'deeds.invalid_input' },
      });
    }
    expect(setFlagMock).not.toHaveBeenCalled();
  });

  it('throws (and never writes) on a ctx with no authenticated account', async () => {
    // The requireAccount middleware 401s first in production; this pins that
    // even a bypassed handler cannot write without an account on the ctx.
    const ctx = fakeCtx({
      method: 'POST',
      url: '/api/deeds/broadcasts',
      body: { enabled: false },
    });
    await expect(handlerFor('/api/deeds/broadcasts')(ctx)).rejects.toThrow();
    expect(setFlagMock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// character_deeds DDL literal pins (the SCHEMA string, not a constant echo)
// ---------------------------------------------------------------------------

describe('character_deeds DDL', () => {
  // The block runs from its CREATE TABLE to the retired-index reconcile that
  // immediately follows it; slicing keeps the realm/UNIQUE pins scoped to THIS
  // table, not a lookalike elsewhere.
  const start = SCHEMA.indexOf('CREATE TABLE IF NOT EXISTS character_deeds');
  const end = SCHEMA.indexOf('DROP INDEX IF EXISTS character_deeds_deed');
  const block = SCHEMA.slice(start, end);

  it('exists, with the idempotence backbone and the explicit-realm column', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    expect(block).toContain('UNIQUE (character_id, deed_id)');
    // realm demands an explicit value on every insert: NOT NULL and NO default
    // (the interpolated default is last-boot-wins across realm processes).
    expect(block).toMatch(/realm TEXT NOT NULL,/);
    expect(block).not.toMatch(/realm TEXT NOT NULL DEFAULT/);
    expect(block).toContain(
      'character_id INT NOT NULL REFERENCES characters(id) ON DELETE CASCADE',
    );
    expect(block).toContain('account_id INT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE');
    expect(block).toContain('earned_at TIMESTAMPTZ NOT NULL DEFAULT now()');
  });

  it('carries the two read-path indexes (account roll-up, sheet strip) and retires the deed_id index', () => {
    expect(SCHEMA).toContain(
      'CREATE INDEX IF NOT EXISTS character_deeds_account ON character_deeds(account_id)',
    );
    expect(SCHEMA).toMatch(
      /CREATE INDEX IF NOT EXISTS character_deeds_character_earned\s+ON character_deeds\(character_id, earned_at DESC\)/,
    );
    // The lone deed_id index was pure write amplification (no query seeks by
    // deed_id): its CREATE is gone, and the boot DDL converges already-deployed
    // databases with an idempotent DROP INDEX IF EXISTS.
    expect(SCHEMA).not.toContain('CREATE INDEX IF NOT EXISTS character_deeds_deed');
    expect(SCHEMA).toContain('DROP INDEX IF EXISTS character_deeds_deed;');
  });

  it('is additive-only, like every block in the boot-reapplied SCHEMA', () => {
    expect(block).not.toMatch(/\b(?:DROP|TRUNCATE|ALTER COLUMN)\b/i);
  });

  it('adds the accounts opt-out column additively with a TRUE default', () => {
    expect(SCHEMA).toContain(
      'ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deed_broadcasts BOOLEAN NOT NULL DEFAULT TRUE',
    );
  });
});

// ---------------------------------------------------------------------------
// The sheet's deeds summary block (shared normalizer; both visibilities)
// ---------------------------------------------------------------------------

function sheetRow(state: unknown): CharacterRow {
  return {
    id: 42,
    account_id: 7,
    name: 'Hilda',
    class: 'warrior',
    level: 12,
    state: state as CharacterRow['state'],
    is_gm: false,
    force_rename: false,
  };
}

function buildSheet(
  state: unknown,
  extras: {
    deedsRecent?: { deedId: string; earnedAt: string }[];
    visibility?: 'owner' | 'public';
  } = {},
) {
  return characterSheet({
    row: sheetRow(state),
    visibility: extras.visibility ?? 'public',
    realm: 'Claudemoon',
    origin: 'https://worldofclaudecraft.com',
    guild: null,
    rank: null,
    deedsRecent: extras.deedsRecent,
  });
}

describe('characterSheet deeds summary', () => {
  it('reads renown, earned count, and the active title from the state blob', () => {
    const sheet = buildSheet({
      level: 12,
      deeds: { prog_first_steps: '2026-07-01', prog_veteran: '2026-07-08' },
      renown: 15,
      activeTitle: 'prog_veteran',
    });
    expect(sheet.deeds).toEqual({
      renown: 15,
      earnedCount: 2,
      activeTitle: 'prog_veteran',
      recent: [],
    });
  });

  it('passes the strip verbatim to the owner; the public arm coarsens earnedAt to the UTC day', () => {
    const recent = [
      { deedId: 'prog_veteran', earnedAt: '2026-07-08T10:00:00.000Z' },
      { deedId: 'prog_first_steps', earnedAt: '2026-07-01T09:00:00.000Z' },
    ];
    // Public: same rows, day-granularity stamps (activity-timing privacy).
    expect(buildSheet({ level: 12 }, { deedsRecent: recent }).deeds.recent).toEqual([
      { deedId: 'prog_veteran', earnedAt: '2026-07-08' },
      { deedId: 'prog_first_steps', earnedAt: '2026-07-01' },
    ]);
    expect(
      buildSheet({ level: 12 }, { deedsRecent: recent, visibility: 'owner' }).deeds.recent,
    ).toEqual(recent);
  });

  it('strips hidden deeds from recent on the public arm only (the owner earned theirs)', () => {
    // Fixture guard: the exemplar must actually be hidden in the catalog.
    expect(DEEDS.hid_saul_footnote.hidden).toBe(true);
    const recent = [
      { deedId: 'hid_saul_footnote', earnedAt: '2026-07-08T10:00:00.000Z' },
      { deedId: 'prog_veteran', earnedAt: '2026-07-07T09:00:00.000Z' },
    ];
    expect(buildSheet({ level: 12 }, { deedsRecent: recent }).deeds.recent).toEqual([
      { deedId: 'prog_veteran', earnedAt: '2026-07-07' },
    ]);
    expect(
      buildSheet({ level: 12 }, { deedsRecent: recent, visibility: 'owner' }).deeds.recent,
    ).toEqual(recent);
  });

  it('a pre-deeds save reads as zeros and untitled, never undefined', () => {
    const sheet = buildSheet({ level: 12 });
    expect(sheet.deeds).toEqual({ renown: 0, earnedCount: 0, activeTitle: null, recent: [] });
  });

  it('sheetTitleText resolves the English title text, null for stale/non-title/unset ids', () => {
    expect(sheetTitleText('prog_veteran')).toBe('Veteran');
    expect(sheetTitleText('hid_saul_footnote')).toBe('the Footnote');
    expect(sheetTitleText(null)).toBeNull();
    expect(sheetTitleText('removed_deed')).toBeNull(); // content drift in an old blob
    expect(sheetTitleText('prog_first_steps')).toBeNull(); // no reward
    expect(sheetTitleText('prog_prestige_10')).toBeNull(); // border, not a title
  });

  it('the shared recent bound is the contracted five', () => {
    expect(SHEET_RECENT_DEEDS).toBe(5);
  });
});
