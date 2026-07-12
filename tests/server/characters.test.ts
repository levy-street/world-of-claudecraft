// Unit coverage for the owner-gated character domain (server/characters.ts).
//
// The migrated routes preserve their LEGACY { error } bodies byte-for-byte (RFC 9457
// is the client code-matcher), so every assertion pins the exact legacy status + body. Three
// layers are exercised:
//  - the two per-route auth guards (readGuard / activeGuard), driven alone through the
//    real compose() onion so their short-circuit + moderation gate are pinned;
//  - the handlers, driven directly with a fakeCtx (account + the owned row preset on
//    ctx.state) and a fake db bundle + injected runtime;
//  - the full route chains (auth guard -> per-action limiter -> requireOwnedCharacter ->
//    withBody -> handler) for the BOLA 404 and the newLimiterCharacterMutations 429.
//
// server/db.ts builds a pg Pool at module load and throws if DATABASE_URL is unset;
// characters.ts imports it, so set a dummy URL. The pool never connects: every db read
// under test is a fake supplied via setCharactersDbForTests, and the runtime singletons
// are fakes injected via configureCharactersRuntime.
process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_phase12_units';

import type * as http from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type CharactersRuntime,
  configureCharactersRuntime,
  resetCharactersDbForTests,
  resetCharactersRuntimeForTests,
  routes,
  setCharactersDbForTests,
} from '../../server/characters';
import type { AccountModerationStatus, CharacterRow } from '../../server/db';
import { compose } from '../../server/http/compose';
import {
  type GameMetricsCounters,
  noopGameMetricsCounters,
  setGameMetricsCounters,
} from '../../server/http/game_signals';
import { withErrors } from '../../server/http/middleware/with_errors';
import type { Ctx, Method, Middleware } from '../../server/http/types';
import {
  CHARACTER_MUTATION_MAX_PER_MINUTE,
  resetCharacterMutationRateLimits,
  resetRateLimitClock,
} from '../../server/ratelimit';
import type { CharacterState } from '../../src/sim/sim';
import { type FakeRes, fakeCtx } from './helpers';

// The realm this test process serves (REALM_NAME unset -> the default). The list
// handlers stamp it onto every body, so it is the expected `realm` field.
const REALM = 'Claudemoon';

// A well-formed bearer header (64 lowercase-hex, matching characters.ts BEARER_PATTERN).
const BEARER = `Bearer ${'a'.repeat(64)}`;

type DbOverrides = Parameters<typeof setCharactersDbForTests>[0];

// ---------------------------------------------------------------------------
// Local builders (redefined per-file, mirroring tests/server/leaderboard.test.ts).
// ---------------------------------------------------------------------------

/** A persisted characters row with sane defaults; override any field. */
function charRow(overrides: Partial<CharacterRow> = {}): CharacterRow {
  return {
    id: 1,
    account_id: 7,
    name: 'Hero',
    class: 'warrior',
    level: 1,
    state: null,
    is_gm: false,
    force_rename: false,
    ...overrides,
  };
}

/** A loose CharacterState stand-in; the sheet/list only read a few optional fields. */
function st(partial: Record<string, unknown> = {}): CharacterState {
  return partial as unknown as CharacterState;
}

/** A not-locked moderation status (the AccountModerationStatus happy-path shape). */
function modStatus(overrides: Partial<AccountModerationStatus> = {}): AccountModerationStatus {
  return {
    locked: false,
    banned: false,
    suspendedUntil: null,
    reason: '',
    message: '',
    chatMutedUntil: null,
    chatStrikes: 0,
    ...overrides,
  };
}

/** A fake accountAndScopeForToken resolving to account 7 with the given scope. */
function scopeOf(scope: 'read' | 'full') {
  return async () => ({ accountId: 7, scope });
}

/** The default injected runtime; every member is a stub, overridable per test. */
function fakeRuntime(overrides: Partial<CharactersRuntime> = {}): CharactersRuntime {
  return {
    isCharacterOnline: () => false,
    takeOverCharacter: async () => 'not-online',
    rekeyMarketSeller: () => false,
    saveMarket: async () => {},
    rekeyMailOwner: () => false,
    saveMail: async () => {},
    initialCharacterState: () => st(),
    publicOrigin: () => 'https://worldofclaudecraft.com',
    ...overrides,
  };
}

function installRuntime(overrides: Partial<CharactersRuntime> = {}): CharactersRuntime {
  const rt = fakeRuntime(overrides);
  configureCharactersRuntime(rt);
  return rt;
}

/** Seed the guard db (bearer + moderation) plus any per-route reads for a full chain. */
function authedDb(overrides: DbOverrides = {}): void {
  setCharactersDbForTests({
    accountAndScopeForToken: scopeOf('full'),
    moderationStatusForAccount: async () => modStatus(),
    ...overrides,
  });
}

/** Read status/body/content-type off the fakeCtx's FakeRes. */
function readRes(res: http.ServerResponse): {
  status: number;
  body: unknown;
  contentType: string | undefined;
} {
  const fake = res as unknown as FakeRes;
  return {
    status: fake.statusCode,
    body: fake.body ? JSON.parse(fake.body) : undefined,
    contentType: fake.headers['content-type'] as string | undefined,
  };
}

/** Narrow an unknown captured body to a record for a keyed dereference. */
function bodyRecord(body: unknown): Record<string, unknown> {
  return body as Record<string, unknown>;
}

/** Grab a route by method + path (paths repeat across methods, so both are needed). */
function routeFor(method: Method, path: string) {
  const route = routes.find((r) => r.method === method && r.path === path);
  if (!route) throw new Error(`no route ${method} ${path}`);
  return route;
}

/** The composed guards, pulled off their routes so they can be driven in isolation. */
const readGuard = routeFor('GET', '/api/me/characters').middleware?.[0] as Middleware;
const activeGuard = routeFor('GET', '/api/characters').middleware?.[0] as Middleware;

/** Build a ctx.state Map carrying the owned character the requireOwned loader stashes. */
function stateWith(character: CharacterRow): Map<string, unknown> {
  return new Map<string, unknown>([['character', character]]);
}

/** Drive a middleware stack + a terminal that records whether the chain proceeded. */
async function runChain(stack: Middleware[], ctx: Ctx) {
  let reached = false;
  await compose([
    ...stack,
    async () => {
      reached = true;
    },
  ])(ctx);
  return { reached, ctx, ...readRes(ctx.res) };
}

/** Call a route handler directly with a preset ctx (account/state/body). */
async function callHandler(method: Method, path: string, overrides: Parameters<typeof fakeCtx>[0]) {
  const ctx = fakeCtx(overrides);
  await routeFor(method, path).handler(ctx);
  return { ctx, ...readRes(ctx.res) };
}

/** Drive a full route chain (its real middleware + handler) under withErrors. */
async function runRoute(
  method: Method,
  path: string,
  opts: { params?: Record<string, string>; body?: unknown; headers?: Record<string, string> } = {},
) {
  const route = routeFor(method, path);
  let reached = false;
  const terminal: Middleware = async (c) => {
    reached = true;
    await route.handler(c);
  };
  const ctx = fakeCtx({
    method,
    url: path,
    headers: { authorization: BEARER, ...(opts.headers ?? {}) },
    params: opts.params,
    body: opts.body,
  });
  const stack: Middleware[] = [
    withErrors({ surface: 'problem+json' }),
    ...(route.middleware ?? []),
    terminal,
  ];
  await compose(stack)(ctx);
  return { reached, ...readRes(ctx.res) };
}

beforeEach(() => {
  installRuntime();
});

afterEach(() => {
  resetCharactersDbForTests();
  resetCharactersRuntimeForTests();
  resetCharacterMutationRateLimits();
  resetRateLimitClock();
  setGameMetricsCounters(noopGameMetricsCounters);
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Auth guards (readGuard / activeGuard), driven alone through the onion.
// ---------------------------------------------------------------------------

describe('auth guards', () => {
  it('401s a missing Authorization header on both guards, with no db read', async () => {
    const accountAndScopeForToken = vi.fn(scopeOf('full'));
    const moderationStatusForAccount = vi.fn(async () => modStatus());
    setCharactersDbForTests({ accountAndScopeForToken, moderationStatusForAccount });

    const read = await runChain([readGuard], fakeCtx({}));
    expect(read).toMatchObject({ reached: false, status: 401 });
    expect(read.body).toEqual({ error: 'not authenticated', code: 'auth.required' });

    const active = await runChain([activeGuard], fakeCtx({}));
    expect(active).toMatchObject({ reached: false, status: 401 });
    expect(active.body).toEqual({ error: 'not authenticated', code: 'auth.required' });

    // A malformed/absent bearer 401s before any db call (so the goldens replay DB-free).
    expect(accountAndScopeForToken).not.toHaveBeenCalled();
    expect(moderationStatusForAccount).not.toHaveBeenCalled();
  });

  it('401s an unknown token (accountAndScopeForToken -> null) without a moderation read', async () => {
    const moderationStatusForAccount = vi.fn(async () => modStatus());
    setCharactersDbForTests({
      accountAndScopeForToken: async () => null,
      moderationStatusForAccount,
    });
    const r = await runChain([activeGuard], fakeCtx({ headers: { authorization: BEARER } }));
    expect(r).toMatchObject({ reached: false, status: 401 });
    expect(r.body).toEqual({ error: 'not authenticated', code: 'auth.required' });
    expect(moderationStatusForAccount).not.toHaveBeenCalled();
  });

  it('activeGuard 403s a read-only token before the moderation read; readGuard accepts it', async () => {
    const moderationStatusForAccount = vi.fn(async () => modStatus());
    setCharactersDbForTests({
      accountAndScopeForToken: scopeOf('read'),
      moderationStatusForAccount,
    });

    const active = await runChain([activeGuard], fakeCtx({ headers: { authorization: BEARER } }));
    expect(active).toMatchObject({ reached: false, status: 403 });
    expect(active.body).toEqual({ error: 'this token is read-only', code: 'auth.forbidden' });
    // The read-only rejection precedes the moderation gate.
    expect(moderationStatusForAccount).not.toHaveBeenCalled();

    const read = await runChain([readGuard], fakeCtx({ headers: { authorization: BEARER } }));
    expect(read.reached).toBe(true);
    expect(read.ctx.account).toEqual({ accountId: 7, scope: 'read' });
  });

  it('403s a moderation-locked account with the status message on both guards', async () => {
    setCharactersDbForTests({
      accountAndScopeForToken: scopeOf('full'),
      moderationStatusForAccount: async () =>
        modStatus({ locked: true, banned: true, message: 'this account has been banned.' }),
    });
    const active = await runChain([activeGuard], fakeCtx({ headers: { authorization: BEARER } }));
    expect(active).toMatchObject({ reached: false, status: 403 });
    expect(active.body).toEqual({
      error: 'this account has been banned.',
      code: 'moderation.banned',
    });

    const read = await runChain([readGuard], fakeCtx({ headers: { authorization: BEARER } }));
    expect(read).toMatchObject({ reached: false, status: 403 });
    expect(read.body).toEqual({
      error: 'this account has been banned.',
      code: 'moderation.banned',
    });
  });

  it('happy path sets ctx.account and proceeds (activeGuard, full token)', async () => {
    setCharactersDbForTests({
      accountAndScopeForToken: scopeOf('full'),
      moderationStatusForAccount: async () => modStatus(),
    });
    const r = await runChain([activeGuard], fakeCtx({ headers: { authorization: BEARER } }));
    expect(r.reached).toBe(true);
    expect(r.ctx.account).toEqual({ accountId: 7, scope: 'full' });
  });
});

// ---------------------------------------------------------------------------
// Read handlers.
// ---------------------------------------------------------------------------

describe('character list handlers', () => {
  it('GET /api/me/characters and GET /api/characters return byte-identical bodies', async () => {
    const rowA = charRow({
      id: 1,
      name: 'Aaa',
      class: 'warrior',
      level: 10,
      state: st({ skin: 3 }),
      force_rename: false,
      last_played: new Date('2026-01-02T03:04:05.000Z'),
      playtime_seconds: '120',
    });
    const rowB = charRow({
      id: 2,
      name: 'Bbb',
      class: 'mage',
      level: 5,
      state: null,
      force_rename: true,
      last_played: null,
      playtime_seconds: null,
    });
    setCharactersDbForTests({ listCharacters: async () => [rowA, rowB] });
    // Online status comes from the injected runtime: row 1 online, row 2 offline.
    installRuntime({ isCharacterOnline: (id) => id === 1 });

    const expected = {
      realm: REALM,
      characters: [
        {
          id: 1,
          name: 'Aaa',
          class: 'warrior',
          level: 10,
          skin: 3,
          online: true,
          forceRename: false,
          lastPlayed: '2026-01-02T03:04:05.000Z',
          playtimeSeconds: 120,
        },
        {
          id: 2,
          name: 'Bbb',
          class: 'mage',
          level: 5,
          skin: 0, // state null -> state?.skin ?? 0
          online: false,
          forceRename: true,
          lastPlayed: null,
          playtimeSeconds: 0, // null -> 0
        },
      ],
    };

    const me = await callHandler('GET', '/api/me/characters', {
      account: { accountId: 7, scope: 'read' },
    });
    const full = await callHandler('GET', '/api/characters', {
      account: { accountId: 7, scope: 'full' },
    });

    expect(me.status).toBe(200);
    expect(full.status).toBe(200);
    expect(me.body).toEqual(expected);
    // Byte-identical: the two arms share buildCharacterList, so the serialized JSON matches.
    expect(JSON.stringify(me.body)).toBe(JSON.stringify(full.body));
  });
});

describe('standing handler', () => {
  it('200s { rank, total } from lifetimeXpStanding', async () => {
    setCharactersDbForTests({ lifetimeXpStanding: async () => ({ rank: 5, total: 100 }) });
    const res = await callHandler('GET', '/api/characters/:id/standing', {
      account: { accountId: 7, scope: 'full' },
      state: stateWith(charRow({ id: 1 })),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ rank: 5, total: 100 });
  });

  it('404s character-not-found when lifetimeXpStanding is null', async () => {
    setCharactersDbForTests({ lifetimeXpStanding: async () => null });
    const res = await callHandler('GET', '/api/characters/:id/standing', {
      account: { accountId: 7, scope: 'full' },
      state: stateWith(charRow({ id: 1 })),
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'character not found', code: 'character.not_found' });
  });
});

describe('owner sheet handler', () => {
  it('200s an owner-visibility sheet built from the owned row + guild + rank', async () => {
    setCharactersDbForTests({
      guildNameForCharacter: async () => 'Guildy',
      lifetimeXpRankForCharacter: async () => ({ rank: 2, total: 50 }),
      recentDeedsForCharacter: async () => [
        { deedId: 'prog_veteran', earnedAt: '2026-07-08T10:00:00.000Z' },
      ],
    });
    installRuntime({ publicOrigin: () => 'https://worldofclaudecraft.com' });
    const row = charRow({
      id: 3,
      name: 'Sheety',
      class: 'warrior',
      level: 20,
      state: st({ skin: 1 }),
    });
    const res = await callHandler('GET', '/api/characters/:id/sheet', {
      account: { accountId: 7, scope: 'full' },
      state: stateWith(row),
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: 'Sheety',
      realm: REALM,
      visibility: 'owner',
      guild: 'Guildy',
      rank: { scope: 'realm', rank: 2, total: 50 },
    });
    // Owner visibility carries the private stats block (absent on the public sheet).
    expect(bodyRecord(res.body).stats).toBeDefined();
    // The owner sheet carries the same deeds summary block the public sheet
    // serves, with the recent strip read through the db seam.
    expect(bodyRecord(res.body).deeds).toEqual({
      renown: 0,
      earnedCount: 0,
      activeTitle: null,
      recent: [{ deedId: 'prog_veteran', earnedAt: '2026-07-08T10:00:00.000Z' }],
    });
  });

  it('200s an owner sheet with rank:null when the character has no lifetime-XP rank', async () => {
    // toSheetRank(null) -> null: a guild-less, rank-less owned character still serializes.
    setCharactersDbForTests({
      guildNameForCharacter: async () => null,
      lifetimeXpRankForCharacter: async () => null,
      recentDeedsForCharacter: async () => [],
    });
    const row = charRow({ id: 4, name: 'Rankless', level: 5, state: st({ skin: 0 }) });
    const res = await callHandler('GET', '/api/characters/:id/sheet', {
      account: { accountId: 7, scope: 'full' },
      state: stateWith(row),
    });
    expect(res.status).toBe(200);
    expect(bodyRecord(res.body).rank).toBeNull();
    expect(bodyRecord(res.body).guild).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Create handler.
// ---------------------------------------------------------------------------

describe('create handler', () => {
  it('200s the created character for a valid name + class + skin', async () => {
    const created = charRow({
      id: 10,
      name: 'Valid',
      class: 'warrior',
      level: 1,
      state: st({ skin: 2 }),
      force_rename: false,
    });
    setCharactersDbForTests({ createCharacterCapped: async () => created });
    const res = await callHandler('POST', '/api/characters', {
      account: { accountId: 7, scope: 'full' },
      body: { name: 'Valid', class: 'warrior', skin: 2 },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 10,
      name: 'Valid',
      class: 'warrior',
      level: 1,
      skin: 2,
      forceRename: false,
    });
  });

  it('increments the characters-created counter on the created path', async () => {
    let created = 0;
    const counters: GameMetricsCounters = {
      ...noopGameMetricsCounters,
      characterCreated: () => {
        created++;
      },
    };
    setGameMetricsCounters(counters);
    setCharactersDbForTests({ createCharacterCapped: async () => charRow({ id: 11 }) });
    const res = await callHandler('POST', '/api/characters', {
      account: { accountId: 7, scope: 'full' },
      body: { name: 'Valid', class: 'warrior' },
    });
    expect(res.status).toBe(200);
    expect(created).toBe(1);
  });

  it('does not increment the characters-created counter when creation is rejected', async () => {
    let created = 0;
    setGameMetricsCounters({
      ...noopGameMetricsCounters,
      characterCreated: () => {
        created++;
      },
    });
    setCharactersDbForTests({ createCharacterCapped: async () => null });
    const res = await callHandler('POST', '/api/characters', {
      account: { accountId: 7, scope: 'full' },
      body: { name: 'Valid', class: 'warrior' },
    });
    expect(res.status).toBe(400);
    expect(created).toBe(0);
  });

  it('400s an invalid name (normalizeCharName -> null)', async () => {
    const createCharacterCapped = vi.fn(async () => charRow());
    setCharactersDbForTests({ createCharacterCapped });
    const res = await callHandler('POST', '/api/characters', {
      account: { accountId: 7, scope: 'full' },
      body: { name: 'A', class: 'warrior' }, // one letter fails the 2-16 shape
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'invalid character name (2-16 letters)',
      code: 'character.name_invalid',
    });
    expect(createCharacterCapped).not.toHaveBeenCalled();
  });

  it('400s a disallowed (offensive) name', async () => {
    const createCharacterCapped = vi.fn(async () => charRow());
    setCharactersDbForTests({ createCharacterCapped });
    const res = await callHandler('POST', '/api/characters', {
      account: { accountId: 7, scope: 'full' },
      body: { name: 'Hitler', class: 'warrior' }, // in the built-in banlist
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'character name is not allowed',
      code: 'character.name_not_allowed',
    });
    expect(createCharacterCapped).not.toHaveBeenCalled();
  });

  it('400s an invalid class', async () => {
    setCharactersDbForTests({ createCharacterCapped: async () => charRow() });
    const res = await callHandler('POST', '/api/characters', {
      account: { accountId: 7, scope: 'full' },
      body: { name: 'Valid', class: 'jester' },
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'invalid class', code: 'character.invalid_class' });
  });

  it('400s the character limit when createCharacterCapped returns null', async () => {
    setCharactersDbForTests({ createCharacterCapped: async () => null });
    const res = await callHandler('POST', '/api/characters', {
      account: { accountId: 7, scope: 'full' },
      body: { name: 'Valid', class: 'warrior' },
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'character limit reached', code: 'character.limit_reached' });
  });

  it('409s a unique violation when the freed name cannot be reclaimed', async () => {
    setCharactersDbForTests({
      createCharacterCapped: async () => {
        throw { code: '23505' };
      },
      reclaimDeactivatedName: async () => false,
    });
    const res = await callHandler('POST', '/api/characters', {
      account: { accountId: 7, scope: 'full' },
      body: { name: 'Valid', class: 'warrior' },
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'that name is taken', code: 'character.name_taken' });
  });

  it('reclaims a freed name, retries once, and 200s on the second create', async () => {
    const created = charRow({
      id: 11,
      name: 'Valid',
      class: 'warrior',
      level: 1,
      state: st({ skin: 0 }),
    });
    const createCharacterCapped = vi
      .fn()
      .mockRejectedValueOnce({ code: '23505' })
      .mockResolvedValueOnce(created);
    const reclaimDeactivatedName = vi.fn(async () => true);
    setCharactersDbForTests({ createCharacterCapped, reclaimDeactivatedName });
    const res = await callHandler('POST', '/api/characters', {
      account: { accountId: 7, scope: 'full' },
      body: { name: 'Valid', class: 'warrior' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: 11, name: 'Valid', forceRename: false });
    expect(reclaimDeactivatedName).toHaveBeenCalledTimes(1);
    expect(createCharacterCapped).toHaveBeenCalledTimes(2);
  });

  it('409s when the reclaimed name collides AGAIN on the retry (second 23505)', async () => {
    const createCharacterCapped = vi
      .fn()
      .mockRejectedValueOnce({ code: '23505' })
      .mockRejectedValueOnce({ code: '23505' });
    setCharactersDbForTests({ createCharacterCapped, reclaimDeactivatedName: async () => true });
    const res = await callHandler('POST', '/api/characters', {
      account: { accountId: 7, scope: 'full' },
      body: { name: 'Valid', class: 'warrior' },
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'that name is taken', code: 'character.name_taken' });
    expect(createCharacterCapped).toHaveBeenCalledTimes(2);
  });

  it('rethrows a non-unique create error (surfaces as a 500 through withErrors)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    authedDb({
      createCharacterCapped: async () => {
        throw new Error('db exploded');
      },
    });
    const r = await runRoute('POST', '/api/characters', {
      body: { name: 'Valid', class: 'warrior' },
    });
    expect(r.status).toBe(500);
    expect(bodyRecord(r.body).code).toBe('internal.error');
  });

  it('400s the character limit when the reclaimed retry also hits the cap (retry null)', async () => {
    // First create collides (23505), the name is reclaimed, but the RETRY create then
    // hits the per-account cap: the second-attempt null must map to 400, not a throw.
    const createCharacterCapped = vi
      .fn()
      .mockRejectedValueOnce({ code: '23505' })
      .mockResolvedValueOnce(null);
    setCharactersDbForTests({ createCharacterCapped, reclaimDeactivatedName: async () => true });
    const res = await callHandler('POST', '/api/characters', {
      account: { accountId: 7, scope: 'full' },
      body: { name: 'Valid', class: 'warrior' },
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'character limit reached', code: 'character.limit_reached' });
    expect(createCharacterCapped).toHaveBeenCalledTimes(2);
  });

  it('rethrows a non-unique error on the reclaimed retry (500 through withErrors)', async () => {
    // First create collides (23505), the name is reclaimed, but the RETRY create throws
    // a non-unique db error: it must be rethrown (500), never swallowed as a stale 409.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const createCharacterCapped = vi
      .fn()
      .mockRejectedValueOnce({ code: '23505' })
      .mockRejectedValueOnce(new Error('db exploded on retry'));
    authedDb({ createCharacterCapped, reclaimDeactivatedName: async () => true });
    const r = await runRoute('POST', '/api/characters', {
      body: { name: 'Valid', class: 'warrior' },
    });
    expect(r.status).toBe(500);
    expect(bodyRecord(r.body).code).toBe('internal.error');
    expect(createCharacterCapped).toHaveBeenCalledTimes(2);
  });

  it.each([
    [99, 7],
    [-3, 0],
    ['not-a-number', 0],
  ])('clamps skin %o into [0, MAX_SKIN] for create (-> %i)', async (input, expected) => {
    // The created row carries no state, so respondCreated echoes back the CLAMPED input
    // skin (c.state?.skin ?? skin), and the same clamp is threaded to initialCharacterState.
    const initialCharacterState = vi.fn(() => st());
    installRuntime({ initialCharacterState });
    setCharactersDbForTests({
      createCharacterCapped: async () => charRow({ id: 12, name: 'Clamped', state: null }),
    });
    const res = await callHandler('POST', '/api/characters', {
      account: { accountId: 7, scope: 'full' },
      body: { name: 'Clamped', class: 'warrior', skin: input },
    });
    expect(res.status).toBe(200);
    expect(bodyRecord(res.body).skin).toBe(expected);
    expect(initialCharacterState).toHaveBeenCalledWith('warrior', 'Clamped', expected);
  });
});

// ---------------------------------------------------------------------------
// Rename handler.
// ---------------------------------------------------------------------------

describe('rename handler', () => {
  it('200s a rename and rekeys the market seller (saveMarket when a rekey lands)', async () => {
    const renamed = charRow({
      id: 5,
      name: 'Newname',
      class: 'rogue',
      level: 8,
      force_rename: false,
    });
    setCharactersDbForTests({ renameCharacter: async () => renamed });
    const rekeyMarketSeller = vi.fn(() => true);
    const saveMarket = vi.fn(async () => {});
    installRuntime({ isCharacterOnline: () => false, rekeyMarketSeller, saveMarket });

    const character = charRow({
      id: 5,
      name: 'Oldname',
      class: 'rogue',
      level: 8,
      force_rename: true,
    });
    const res = await callHandler('POST', '/api/characters/:id/rename', {
      account: { accountId: 7, scope: 'full' },
      state: stateWith(character),
      body: { name: 'Newname' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 5,
      name: 'Newname',
      class: 'rogue',
      level: 8,
      forceRename: false,
    });
    expect(rekeyMarketSeller).toHaveBeenCalledWith(5, 'Oldname', 'Newname');
    expect(saveMarket).toHaveBeenCalledTimes(1);
  });

  it('rekeys the Ravenpost mailbox on rename (saveMail when a rekey lands), mirroring the legacy arm', async () => {
    // v0.20.0 added the mail rekey to the LEGACY rename arm; this pins the migrated
    // handler's mirror so the two dispatch paths cannot silently diverge.
    const renamed = charRow({
      id: 5,
      name: 'Newname',
      class: 'rogue',
      level: 8,
      force_rename: false,
    });
    setCharactersDbForTests({ renameCharacter: async () => renamed });
    const rekeyMailOwner = vi.fn(() => true);
    const saveMail = vi.fn(async () => {});
    installRuntime({ isCharacterOnline: () => false, rekeyMailOwner, saveMail });

    const character = charRow({
      id: 5,
      name: 'Oldname',
      class: 'rogue',
      level: 8,
      force_rename: true,
    });
    const res = await callHandler('POST', '/api/characters/:id/rename', {
      account: { accountId: 7, scope: 'full' },
      state: stateWith(character),
      body: { name: 'Newname' },
    });
    expect(res.status).toBe(200);
    expect(rekeyMailOwner).toHaveBeenCalledWith(5, 'Oldname', 'Newname');
    expect(saveMail).toHaveBeenCalledTimes(1);
  });

  it('does not save mail when no mailbox rekey landed', async () => {
    const renamed = charRow({ id: 5, name: 'Newname', force_rename: false });
    setCharactersDbForTests({ renameCharacter: async () => renamed });
    const saveMail = vi.fn(async () => {});
    installRuntime({ isCharacterOnline: () => false, rekeyMailOwner: () => false, saveMail });

    const character = charRow({ id: 5, name: 'Oldname', force_rename: true });
    const res = await callHandler('POST', '/api/characters/:id/rename', {
      account: { accountId: 7, scope: 'full' },
      state: stateWith(character),
      body: { name: 'Newname' },
    });
    expect(res.status).toBe(200);
    expect(saveMail).not.toHaveBeenCalled();
  });

  it('400s an invalid new name (normalizeCharName -> null) before the force_rename gate', async () => {
    // The owned character IS force_rename-flagged, so a bad name must be rejected on
    // its own merits (400), never let through by the flag. renameCharacter must not run.
    const renameCharacter = vi.fn(async () => charRow());
    setCharactersDbForTests({ renameCharacter });
    const character = charRow({ id: 5, name: 'Oldname', force_rename: true });
    const res = await callHandler('POST', '/api/characters/:id/rename', {
      account: { accountId: 7, scope: 'full' },
      state: stateWith(character),
      body: { name: 'A' }, // one letter fails the 2-16 shape
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'invalid character name (2-16 letters)',
      code: 'character.name_invalid',
    });
    expect(renameCharacter).not.toHaveBeenCalled();
  });

  it('400s a disallowed (offensive) new name on the owned rename path', async () => {
    // The API is the real moderation boundary: a force_rename'd player must not be
    // able to rename to an offensive name, so the offensiveName re-check stands here
    // just as it does on create.
    const renameCharacter = vi.fn(async () => charRow());
    setCharactersDbForTests({ renameCharacter });
    const character = charRow({ id: 5, name: 'Oldname', force_rename: true });
    const res = await callHandler('POST', '/api/characters/:id/rename', {
      account: { accountId: 7, scope: 'full' },
      state: stateWith(character),
      body: { name: 'Hitler' }, // in the built-in banlist
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'character name is not allowed',
      code: 'character.name_not_allowed',
    });
    expect(renameCharacter).not.toHaveBeenCalled();
  });

  it('403s when the character is not flagged force_rename', async () => {
    const renameCharacter = vi.fn(async () => charRow());
    setCharactersDbForTests({ renameCharacter });
    const character = charRow({ id: 5, name: 'Oldname', force_rename: false });
    const res = await callHandler('POST', '/api/characters/:id/rename', {
      account: { accountId: 7, scope: 'full' },
      state: stateWith(character),
      body: { name: 'Newname' },
    });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'character rename is not permitted',
      code: 'character.rename_not_permitted',
    });
    expect(renameCharacter).not.toHaveBeenCalled();
  });

  it('400s when the character is currently online', async () => {
    const renameCharacter = vi.fn(async () => charRow());
    setCharactersDbForTests({ renameCharacter });
    installRuntime({ isCharacterOnline: () => true });
    const character = charRow({ id: 5, name: 'Oldname', force_rename: true });
    const res = await callHandler('POST', '/api/characters/:id/rename', {
      account: { accountId: 7, scope: 'full' },
      state: stateWith(character),
      body: { name: 'Newname' },
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'character is currently online', code: 'character.online' });
    expect(renameCharacter).not.toHaveBeenCalled();
  });

  it('403s when the UPDATE matched no row but the character still exists un-flagged', async () => {
    setCharactersDbForTests({
      renameCharacter: async () => null,
      getCharacter: async () => charRow({ id: 5, name: 'Oldname', force_rename: false }),
    });
    installRuntime({ isCharacterOnline: () => false });
    const character = charRow({ id: 5, name: 'Oldname', force_rename: true });
    const res = await callHandler('POST', '/api/characters/:id/rename', {
      account: { accountId: 7, scope: 'full' },
      state: stateWith(character),
      body: { name: 'Newname' },
    });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'character rename is not permitted',
      code: 'character.rename_not_permitted',
    });
  });

  it('404s when the UPDATE matched no row and the character is gone', async () => {
    setCharactersDbForTests({
      renameCharacter: async () => null,
      getCharacter: async () => null,
    });
    installRuntime({ isCharacterOnline: () => false });
    const character = charRow({ id: 5, name: 'Oldname', force_rename: true });
    const res = await callHandler('POST', '/api/characters/:id/rename', {
      account: { accountId: 7, scope: 'full' },
      state: stateWith(character),
      body: { name: 'Newname' },
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'character not found', code: 'character.not_found' });
  });

  it('409s a unique violation on rename', async () => {
    setCharactersDbForTests({
      renameCharacter: async () => {
        throw { code: '23505' };
      },
    });
    installRuntime({ isCharacterOnline: () => false });
    const character = charRow({ id: 5, name: 'Oldname', force_rename: true });
    const res = await callHandler('POST', '/api/characters/:id/rename', {
      account: { accountId: 7, scope: 'full' },
      state: stateWith(character),
      body: { name: 'Newname' },
    });
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'that name is taken', code: 'character.name_taken' });
  });

  it('rethrows a non-unique rename error (surfaces as a 500 through withErrors)', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    authedDb({
      getCharacter: async () => charRow({ id: 1, name: 'Oldname', force_rename: true }),
      renameCharacter: async () => {
        throw new Error('db exploded');
      },
    });
    installRuntime({ isCharacterOnline: () => false });
    const r = await runRoute('POST', '/api/characters/:id/rename', {
      params: { id: '1' },
      body: { name: 'Newname' },
    });
    expect(r.status).toBe(500);
    expect(bodyRecord(r.body).code).toBe('internal.error');
  });
});

// ---------------------------------------------------------------------------
// Takeover handler.
// ---------------------------------------------------------------------------

describe('takeover handler', () => {
  it('200s takenOver:true when a stale session was freed', async () => {
    installRuntime({ takeOverCharacter: async () => 'taken-over' });
    const res = await callHandler('POST', '/api/characters/:id/takeover', {
      account: { accountId: 7, scope: 'full' },
      state: stateWith(charRow({ id: 1 })),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, takenOver: true });
  });

  it('200s takenOver:false when the character was not online', async () => {
    installRuntime({ takeOverCharacter: async () => 'not-online' });
    const res = await callHandler('POST', '/api/characters/:id/takeover', {
      account: { accountId: 7, scope: 'full' },
      state: stateWith(charRow({ id: 1 })),
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, takenOver: false });
  });
});

// ---------------------------------------------------------------------------
// Delete handler.
// ---------------------------------------------------------------------------

describe('delete handler', () => {
  it('200s ok:true when offline, name-confirmed, and the delete lands', async () => {
    setCharactersDbForTests({ deleteCharacter: async () => true });
    installRuntime({ isCharacterOnline: () => false });
    const res = await callHandler('DELETE', '/api/characters/:id', {
      account: { accountId: 7, scope: 'full' },
      state: stateWith(charRow({ id: 9, name: 'Deleteme' })),
      body: { name: 'Deleteme' },
    });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('404s not-found when the delete matched no row', async () => {
    setCharactersDbForTests({ deleteCharacter: async () => false });
    installRuntime({ isCharacterOnline: () => false });
    const res = await callHandler('DELETE', '/api/characters/:id', {
      account: { accountId: 7, scope: 'full' },
      state: stateWith(charRow({ id: 9, name: 'Deleteme' })),
      body: { name: 'Deleteme' },
    });
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'not found', code: 'character.not_found' });
  });

  it('400s when the character is currently online', async () => {
    const deleteCharacter = vi.fn(async () => true);
    setCharactersDbForTests({ deleteCharacter });
    installRuntime({ isCharacterOnline: () => true });
    const res = await callHandler('DELETE', '/api/characters/:id', {
      account: { accountId: 7, scope: 'full' },
      state: stateWith(charRow({ id: 9, name: 'Deleteme' })),
      body: { name: 'Deleteme' },
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'character is currently online', code: 'character.online' });
    expect(deleteCharacter).not.toHaveBeenCalled();
  });

  it('400s when the typed confirmation name does not match', async () => {
    const deleteCharacter = vi.fn(async () => true);
    setCharactersDbForTests({ deleteCharacter });
    installRuntime({ isCharacterOnline: () => false });
    const res = await callHandler('DELETE', '/api/characters/:id', {
      account: { accountId: 7, scope: 'full' },
      state: stateWith(charRow({ id: 9, name: 'Deleteme' })),
      body: { name: 'wrong' },
    });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: 'type the character name to confirm deletion',
      code: 'character.delete_confirm',
    });
    expect(deleteCharacter).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// BOLA: a cross-account / absent id 404s at the loader; the handler never runs.
// ---------------------------------------------------------------------------

describe('BOLA cross-account 404 (full route chain)', () => {
  beforeEach(() => {
    // The account-scoped loader misses (row absent OR another account's): the two are
    // indistinguishable 404s by construction.
    authedDb({ getCharacter: async () => null });
    // Silence the structured bola_denied deny-log line.
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('standing 404s character-not-found, handler unreached', async () => {
    const r = await runRoute('GET', '/api/characters/:id/standing', { params: { id: '1' } });
    expect(r).toMatchObject({ status: 404, reached: false });
    expect(r.body).toEqual({ error: 'character not found', code: 'character.not_found' });
  });

  it('owner sheet 404s character-not-found, handler unreached', async () => {
    const r = await runRoute('GET', '/api/characters/:id/sheet', { params: { id: '1' } });
    expect(r).toMatchObject({ status: 404, reached: false });
    expect(r.body).toEqual({ error: 'character not found', code: 'character.not_found' });
  });

  it('rename 404s character-not-found, handler unreached', async () => {
    const r = await runRoute('POST', '/api/characters/:id/rename', {
      params: { id: '1' },
      body: { name: 'Newname' },
    });
    expect(r).toMatchObject({ status: 404, reached: false });
    expect(r.body).toEqual({ error: 'character not found', code: 'character.not_found' });
  });

  it('rename checks ownership BEFORE name validation: a non-owned id + invalid name 404s (not 400)', async () => {
    // requireOwnedCharacter (ownership -> 404) runs as middleware BEFORE the handler
    // validates the name, so a non-owned/absent id with an INVALID name answers 404 where
    // the legacy arm validated the name first and answered 400. This locks the intended
    // BOLA-first ordering (the caller learns nothing about name validity from a 404); the
    // divergence is the ordering note on the characterBodyValidationRemap known deviation.
    const r = await runRoute('POST', '/api/characters/:id/rename', {
      params: { id: '1' },
      body: { name: 'A' }, // one letter: a 400 invalid-name only if the handler ran
    });
    expect(r).toMatchObject({ status: 404, reached: false });
    expect(r.body).toEqual({ error: 'character not found', code: 'character.not_found' });
  });

  it('takeover 404s not-found, handler unreached', async () => {
    const r = await runRoute('POST', '/api/characters/:id/takeover', { params: { id: '1' } });
    expect(r).toMatchObject({ status: 404, reached: false });
    expect(r.body).toEqual({ error: 'not found', code: 'character.not_found' });
  });

  it('delete 404s not-found, handler unreached', async () => {
    const r = await runRoute('DELETE', '/api/characters/:id', {
      params: { id: '1' },
      body: { name: 'whatever' },
    });
    expect(r).toMatchObject({ status: 404, reached: false });
    expect(r.body).toEqual({ error: 'not found', code: 'character.not_found' });
  });
});

// ---------------------------------------------------------------------------
// Limiters: the newLimiterCharacterMutations deviation, realized as a 21st-attempt 429.
// The full chain runs 20 successful mutations, then the 21st is limited (same IP+account).
// ---------------------------------------------------------------------------

describe('character-mutation limiters (newLimiterCharacterMutations 429)', () => {
  /** Fire the same route N times, asserting the first succeeds and none is limited. */
  async function drainToLimit(
    method: Method,
    path: string,
    opts: { params?: Record<string, string>; body?: unknown },
  ): Promise<void> {
    for (let i = 0; i < CHARACTER_MUTATION_MAX_PER_MINUTE; i++) {
      const r = await runRoute(method, path, opts);
      expect(r.status).not.toBe(429);
      if (i === 0) expect(r.status).toBe(200); // an allowed attempt otherwise succeeds
    }
  }

  /** Assert the given (over-cap) result is the limiter's problem+json 429. */
  function expectLimited(r: {
    status: number;
    body: unknown;
    contentType: string | undefined;
  }): void {
    expect(r.status).toBe(429);
    expect(r.contentType).toBe('application/problem+json');
    expect(bodyRecord(r.body).code).toBe('rate_limit.exceeded');
  }

  it('POST /api/characters (create) limits the 21st attempt', async () => {
    authedDb({
      createCharacterCapped: async () => charRow({ id: 10, name: 'Valid', state: st({ skin: 0 }) }),
    });
    const opts = { body: { name: 'Valid', class: 'warrior' } };
    await drainToLimit('POST', '/api/characters', opts);
    expectLimited(await runRoute('POST', '/api/characters', opts));
  });

  it('POST /api/characters/:id/rename limits the 21st attempt', async () => {
    authedDb({
      getCharacter: async () =>
        charRow({ id: 1, name: 'Oldname', class: 'rogue', level: 8, force_rename: true }),
      renameCharacter: async () =>
        charRow({ id: 1, name: 'Newname', class: 'rogue', level: 8, force_rename: false }),
    });
    installRuntime({ isCharacterOnline: () => false, rekeyMarketSeller: () => false });
    const opts = { params: { id: '1' }, body: { name: 'Newname' } };
    await drainToLimit('POST', '/api/characters/:id/rename', opts);
    expectLimited(await runRoute('POST', '/api/characters/:id/rename', opts));
  });

  it('POST /api/characters/:id/takeover limits the 21st attempt', async () => {
    authedDb({ getCharacter: async () => charRow({ id: 1 }) });
    installRuntime({ takeOverCharacter: async () => 'taken-over' });
    const opts = { params: { id: '1' } };
    await drainToLimit('POST', '/api/characters/:id/takeover', opts);
    expectLimited(await runRoute('POST', '/api/characters/:id/takeover', opts));
  });

  it('DELETE /api/characters/:id limits the 21st attempt', async () => {
    authedDb({
      getCharacter: async () => charRow({ id: 1, name: 'Confirmme' }),
      deleteCharacter: async () => true,
    });
    installRuntime({ isCharacterOnline: () => false });
    const opts = { params: { id: '1' }, body: { name: 'Confirmme' } };
    await drainToLimit('DELETE', '/api/characters/:id', opts);
    expectLimited(await runRoute('DELETE', '/api/characters/:id', opts));
  });

  it('keys each limiter BY ACTION: fully throttling create leaves delete unaffected', async () => {
    // The whole point of the `${action}:` bucket prefix: create/rename/delete/takeover
    // never share a window. Drive create to a hard 429, then prove a first delete (same
    // IP AND account) still succeeds, since it hits its OWN delete:<key> bucket.
    authedDb({
      createCharacterCapped: async () => charRow({ id: 10, name: 'Valid', state: st({ skin: 0 }) }),
      getCharacter: async () => charRow({ id: 1, name: 'Confirmme' }),
      deleteCharacter: async () => true,
    });
    installRuntime({ isCharacterOnline: () => false });
    const createOpts = { body: { name: 'Valid', class: 'warrior' } };
    await drainToLimit('POST', '/api/characters', createOpts);
    expectLimited(await runRoute('POST', '/api/characters', createOpts));
    // create is fully throttled; delete has an independent bucket, so it still 200s.
    const del = await runRoute('DELETE', '/api/characters/:id', {
      params: { id: '1' },
      body: { name: 'Confirmme' },
    });
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// The route table contract.
// ---------------------------------------------------------------------------

describe('routes table', () => {
  it('registers the eight character routes on the api surface', () => {
    expect(routes).toHaveLength(8);
    for (const r of routes) {
      expect(r.surface).toBe('api');
      expect(typeof r.handler).toBe('function');
    }
  });

  it('marks every owned :id route with the account-scoped requireOwned meta', () => {
    const ownedPaths = [
      'GET /api/characters/:id/standing',
      'GET /api/characters/:id/sheet',
      'POST /api/characters/:id/rename',
      'POST /api/characters/:id/takeover',
      'DELETE /api/characters/:id',
    ];
    for (const key of ownedPaths) {
      const [method, path] = key.split(' ');
      const route = routeFor(method as Method, path);
      expect(route.meta?.requireOwned).toEqual({ kind: 'character', ownerScope: 'account' });
    }
  });
});
