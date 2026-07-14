// Owner-gated character surface, ported onto RouteDefs.
//
// The account-scoped character endpoints move off the inline handleApi ladder in
// server/main.ts onto the shared server/http/ pipeline the registry dispatcher serves
// when API_DISPATCH is 'new':
//   GET    /api/me/characters             read-scoped character list (companion tokens)
//   GET    /api/characters                full-session character list (byte-identical body)
//   POST   /api/characters                create a character (capped)
//   GET    /api/characters/:id/sheet      the OWNER character sheet
//   GET    /api/characters/:id/standing   lifetime-XP standing
//   POST   /api/characters/:id/rename     moderator-sanctioned rename
//   POST   /api/characters/:id/takeover   free a stale live session
//   DELETE /api/characters/:id            delete (name-confirmed)
//
// It follows the server/leaderboard.ts + server/auth_routes.ts template:
//  - handlers are thin Ctx adapters that write the SAME legacy body shapes with the
//    same http_util json() helper, so every ported success/error body is byte-identical
//    to today and the parity harness proves it (the no-auth 401 goldens pin the guard
//    bodies). These bodies stay legacy prose plus the additive machine `code` the
//    client code-matcher (src/ui/api_error_i18n.ts userFacingApiError) keys on, with
//    the prose as its fallback, so a migrated route MUST keep the legacy prose body,
//    not a problem+json envelope.
//  - the bearer + moderation gates are decomposed into small per-route guard middleware
//    (activeGuard / readGuard) that mirror the legacy bearerActiveAccount /
//    bearerReadAccount resolvers and write the legacy { error } bodies, NOT the generic
//    requireAccount middleware (which throws a problem+json HttpError and would break the
//    goldens and the prose-matcher). Ownership is the shared requireOwned load-then-
//    authorize loader: it runs AFTER the auth guard, decodes the :id with num() (422 on a
//    non-numeric id, before any DB call, so a query never sees NaN), loads by an
//    ACCOUNT-SCOPED query, and on a miss answers the legacy 404 (player-owned
//    anti-enumeration) plus a bola_denied deny-log.
//  - the four character mutations get NEW per-action limiters (they had none): a 429 is
//    now possible where none was, the newLimiterCharacterMutations known deviation.
//  - runtime singletons the handlers need but cannot import without a cycle (the live
//    online-session check, takeOverCharacter, the market rekey/save, initialCharacterState,
//    publicOrigin) are INJECTED once at boot via configureCharactersRuntime, so
//    `export const routes` stays a static array registry.ts can spread. The db.ts reads
//    are bundled behind setCharactersDbForTests so the handlers are unit-testable with a
//    fake and no Postgres.
//
// Server-authority: the character core (list/create/rename/delete/takeover/standing/sheet)
// takes no req/res and is the one authority; the client never decides ownership.

import type * as http from 'node:http';
import type { CharacterState } from '../src/sim/sim';
import type { PlayerClass } from '../src/sim/types';
import { normalizeCharName, offensiveName } from './auth';
import { characterSheet, SHEET_RECENT_DEEDS, type SheetRank } from './character_sheet';
import {
  accountAndScopeForToken,
  type CharacterRow,
  createCharacterCapped,
  deleteCharacter,
  getCharacter,
  guildNameForCharacter,
  lifetimeXpRankForCharacter,
  lifetimeXpStanding,
  listCharacters,
  moderationStatusForAccount,
  reclaimDeactivatedName,
  renameCharacter,
  scopeAllowsMutation,
} from './db';
import { recentDeedsForCharacter } from './deeds_db';
import { ctxAccountId } from './http/context';
import { gameMetricsCounters } from './http/game_signals';
import { withBody } from './http/middleware/body';
import {
  CHARACTER_CREATE_POLICY,
  CHARACTER_DELETE_POLICY,
  CHARACTER_RENAME_POLICY,
  CHARACTER_TAKEOVER_POLICY,
  rateLimit,
} from './http/middleware/rate_limit';
import { requireOwned } from './http/middleware/require_owned';
import type { Ctx, Middleware, RouteDef } from './http/types';
import { isUniqueViolation, json, moderationErrorBody } from './http_util';
import { REALM } from './realm';

// ---------------------------------------------------------------------------
// Ported response bodies (the exact legacy { error } identities). Named constants so
// the guards and handlers cannot drift; each carries its stable machine `code` (the
// client code-matcher keys on it, with the legacy prose as the fallback). NO em dash
// appears in any of these (the legacy character strings never used one).
// ---------------------------------------------------------------------------

const NOT_AUTHENTICATED = { error: 'not authenticated', code: 'auth.required' } as const;
const READ_ONLY_TOKEN = { error: 'this token is read-only', code: 'auth.forbidden' } as const;
const INVALID_CHAR_NAME = {
  error: 'invalid character name (2-16 letters)',
  code: 'character.name_invalid',
} as const;
const CHAR_NAME_NOT_ALLOWED = {
  error: 'character name is not allowed',
  code: 'character.name_not_allowed',
} as const;
const INVALID_CLASS = { error: 'invalid class', code: 'character.invalid_class' } as const;
const CHARACTER_LIMIT_REACHED = {
  error: 'character limit reached',
  code: 'character.limit_reached',
} as const;
const NAME_TAKEN = { error: 'that name is taken', code: 'character.name_taken' } as const;
// The owner sheet / standing / rename 404 body; takeover + delete use the shorter
// 'not found', byte-for-byte with their legacy arms (both are player-owned 404s).
const CHARACTER_NOT_FOUND = { error: 'character not found', code: 'character.not_found' } as const;
const NOT_FOUND = { error: 'not found', code: 'character.not_found' } as const;
const RENAME_NOT_PERMITTED = {
  error: 'character rename is not permitted',
  code: 'character.rename_not_permitted',
} as const;
const CHARACTER_ONLINE = {
  error: 'character is currently online',
  code: 'character.online',
} as const;
const DELETE_CONFIRM = {
  error: 'type the character name to confirm deletion',
  code: 'character.delete_confirm',
} as const;

/** The ctx.state key the owned, authorized character row is stashed under. */
const CHARACTER_RESOURCE = 'character';
/** Per-account character cap (mirrors the legacy createCharacterCapped default). */
const CHARACTER_LIMIT = 10;
/** The nine playable classes accepted by create (mirrors the legacy inline list). */
const VALID_CLASSES: readonly string[] = [
  'warrior',
  'paladin',
  'hunter',
  'rogue',
  'priest',
  'shaman',
  'mage',
  'warlock',
  'druid',
];
/** Highest selectable skin index (mirrors the legacy Math.min(7, ...) clamp). */
const MAX_SKIN = 7;
const BEARER_PATTERN = /^Bearer ([a-f0-9]{64})$/;

// ---------------------------------------------------------------------------
// Runtime injection. registry.ts spreads the static `routes` array at module load,
// before main.ts has booted the GameServer, so the handlers cannot close over `game`
// directly (that would be a cycle: main -> registry -> characters -> main). Instead
// main.ts injects the live singletons once at load via configureCharactersRuntime.
// ---------------------------------------------------------------------------

export interface CharactersRuntime {
  /** Is this character currently in a live world session? (game.clients scan.) */
  isCharacterOnline(characterId: number): boolean;
  /** game.takeOverCharacter: free a stale session so the owner can re-enter. */
  takeOverCharacter(accountId: number, characterId: number): Promise<'taken-over' | 'not-online'>;
  /** game.rekeyMarketSeller: re-key an online seller's listings after a rename. */
  rekeyMarketSeller(characterId: number, oldName: string, newName: string): boolean;
  /** game.saveMarket: persist the World Market after a rekey. */
  saveMarket(): Promise<void>;
  /** game.rekeyMailOwner: re-key the character's Ravenpost mailbox after a rename. */
  rekeyMailOwner(characterId: number, oldName: string, newName: string): boolean;
  /** game.saveMail: persist the Ravenpost mail book after a rekey. */
  saveMail(): Promise<void>;
  /** main.ts initialCharacterState: the serialized fresh-character state for create. */
  initialCharacterState(cls: PlayerClass, name: string, skin: number): CharacterState;
  /** main.ts publicOrigin: canonical share origin for the owner-sheet URLs. */
  publicOrigin(req: http.IncomingMessage): string;
}

let runtime: CharactersRuntime | null = null;

/** Inject the main.ts runtime the handlers need. Called once at boot. */
export function configureCharactersRuntime(rt: CharactersRuntime): void {
  runtime = rt;
}

/** Clear the injected runtime so a unit test can install its own fake. */
export function resetCharactersRuntimeForTests(): void {
  runtime = null;
}

/** The injected runtime, or a loud failure if a request somehow beat boot wiring. */
function useRuntime(): CharactersRuntime {
  if (runtime === null) {
    throw new Error('characters runtime is not configured; call configureCharactersRuntime');
  }
  return runtime;
}

// ---------------------------------------------------------------------------
// Db seam. The db.ts reads/writes bundled once behind a test-only setter so the
// handlers can be driven with a fake and no Postgres. Production never calls the
// setter, so REAL_CHARACTERS_DB is the only runtime binding, and it references the
// exact functions the legacy arms call. scopeAllowsMutation is pure (no DB), so it
// stays a direct import rather than a seam member.
// ---------------------------------------------------------------------------

const REAL_CHARACTERS_DB = {
  accountAndScopeForToken,
  moderationStatusForAccount,
  listCharacters,
  getCharacter,
  createCharacterCapped,
  reclaimDeactivatedName,
  renameCharacter,
  deleteCharacter,
  lifetimeXpStanding,
  guildNameForCharacter,
  lifetimeXpRankForCharacter,
  recentDeedsForCharacter,
};
let charactersDb = REAL_CHARACTERS_DB;

/** Override the character db bundle with a fake (test-only; merges over the real reads). */
export function setCharactersDbForTests(overrides: Partial<typeof REAL_CHARACTERS_DB>): void {
  charactersDb = { ...REAL_CHARACTERS_DB, ...overrides };
}

/** Restore the real character db bundle after a setCharactersDbForTests override (test-only). */
export function resetCharactersDbForTests(): void {
  charactersDb = REAL_CHARACTERS_DB;
}

// ---------------------------------------------------------------------------
// Pure helpers (host-agnostic; no req/res, no DB).
// ---------------------------------------------------------------------------

/** The owned, authorized character row the requireOwnedCharacter loader stashed. */
function ownedCharacter(ctx: Ctx): CharacterRow {
  return ctx.state.get(CHARACTER_RESOURCE) as CharacterRow;
}

/** Server canonical form for the delete confirmation (mirrors the legacy inline helper). */
function normalizeDeleteConfirmation(name: unknown): string {
  return typeof name === 'string' ? name.trim().toLowerCase() : '';
}

/** Shape a realm rank lookup into the character-sheet's rank field (pure; mirrors main.ts). */
function toSheetRank(rank: { rank: number; total: number } | null): SheetRank | null {
  return rank ? { scope: 'realm', rank: rank.rank, total: rank.total } : null;
}

/**
 * The character-list body shared by GET /api/characters and GET /api/me/characters, so
 * both stay byte-identical. `isOnline` comes from the injected runtime (a live-session
 * scan). Mirrors the legacy characterListPayload exactly.
 */
function buildCharacterList(
  chars: CharacterRow[],
  isOnline: (characterId: number) => boolean,
): unknown {
  return {
    realm: REALM,
    characters: chars.map((c) => ({
      id: c.id,
      name: c.name,
      class: c.class,
      level: c.level,
      skin: c.state?.skin ?? 0,
      online: isOnline(c.id),
      forceRename: c.force_rename,
      lastPlayed: c.last_played ? new Date(c.last_played).toISOString() : null,
      playtimeSeconds: Number(c.playtime_seconds ?? 0),
    })),
  };
}

// ---------------------------------------------------------------------------
// Auth guards. activeGuard mirrors bearerActiveAccount (full-session, read-only 403),
// readGuard mirrors bearerReadAccount (accepts a read OR full token). Both apply the
// moderation gate for EVERY caller and write the legacy { error } bodies, short-
// circuiting (no next()) on rejection. A missing/malformed bearer 401s WITHOUT a DB
// call (so the no-auth goldens replay DB-free through both dispatch paths).
// ---------------------------------------------------------------------------

/** Resolve the bearer to { accountId, scope }, or null (no header, bad shape, or unknown). */
async function resolveBearer(
  req: http.IncomingMessage,
): Promise<{ accountId: number; scope: 'read' | 'full' } | null> {
  const m = BEARER_PATTERN.exec(req.headers.authorization ?? '');
  if (!m) return null;
  return charactersDb.accountAndScopeForToken(m[1]);
}

const readGuard: Middleware = async (ctx, next) => {
  const info = await resolveBearer(ctx.req);
  if (info === null) {
    json(ctx.res, 401, NOT_AUTHENTICATED);
    return;
  }
  const status = await charactersDb.moderationStatusForAccount(info.accountId);
  if (status.locked) {
    json(ctx.res, 403, moderationErrorBody(status));
    return;
  }
  ctx.account = { accountId: info.accountId, scope: info.scope };
  await next();
};

const activeGuard: Middleware = async (ctx, next) => {
  const info = await resolveBearer(ctx.req);
  if (info === null) {
    json(ctx.res, 401, NOT_AUTHENTICATED);
    return;
  }
  if (!scopeAllowsMutation(info.scope)) {
    json(ctx.res, 403, READ_ONLY_TOKEN);
    return;
  }
  const status = await charactersDb.moderationStatusForAccount(info.accountId);
  if (status.locked) {
    json(ctx.res, 403, moderationErrorBody(status));
    return;
  }
  ctx.account = { accountId: info.accountId, scope: info.scope };
  await next();
};

/**
 * The character BOLA loader: an account-scoped find (id AND account_id AND realm),
 * populating ctx.state.character on a hit and answering the given legacy 404 body on a
 * miss (both a cross-account id and an absent id are indistinguishable 404s). `notFound`
 * is per-route: the sheet/standing/rename arms say 'character not found', the
 * takeover/delete arms say 'not found', byte-for-byte with their legacy arms.
 */
function requireOwnedCharacter(notFoundBody: Record<string, unknown>): Middleware {
  return requireOwned<CharacterRow>({
    resource: CHARACTER_RESOURCE,
    param: 'id',
    load: (accountId, id) => charactersDb.getCharacter(accountId, id),
    notFoundBody,
  });
}

// ---------------------------------------------------------------------------
// Handlers (thin Ctx adapters). Each starts after its guards have run and writes the
// legacy-identical body with json().
// ---------------------------------------------------------------------------

/** GET /api/me/characters: read-scoped list (companion/OAuth read tokens). */
async function meCharactersHandler(ctx: Ctx): Promise<void> {
  const rt = useRuntime();
  const chars = await charactersDb.listCharacters(ctxAccountId(ctx));
  json(ctx.res, 200, buildCharacterList(chars, rt.isCharacterOnline));
}

/** GET /api/characters: full-session list (byte-identical body to me/characters). */
async function listCharactersHandler(ctx: Ctx): Promise<void> {
  const rt = useRuntime();
  const chars = await charactersDb.listCharacters(ctxAccountId(ctx));
  json(ctx.res, 200, buildCharacterList(chars, rt.isCharacterOnline));
}

/** POST /api/characters: validate, create the capped character, reclaim a freed name once. */
async function createCharacterHandler(ctx: Ctx): Promise<void> {
  const rt = useRuntime();
  const accountId = ctxAccountId(ctx);
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const name = normalizeCharName(body.name);
  if (name === null) {
    json(ctx.res, 400, INVALID_CHAR_NAME);
    return;
  }
  if (offensiveName(name)) {
    json(ctx.res, 400, CHAR_NAME_NOT_ALLOWED);
    return;
  }
  if (typeof body.class !== 'string' || !VALID_CLASSES.includes(body.class)) {
    json(ctx.res, 400, INVALID_CLASS);
    return;
  }
  const cls = body.class as PlayerClass;
  const skin = Math.max(
    0,
    Math.min(MAX_SKIN, Math.floor(typeof body.skin === 'number' ? body.skin : 0)),
  );
  const create = () =>
    charactersDb.createCharacterCapped(
      accountId,
      name,
      cls,
      CHARACTER_LIMIT,
      rt.initialCharacterState(cls, name, skin),
    );
  const respondCreated = (c: CharacterRow): void => {
    gameMetricsCounters().characterCreated();
    json(ctx.res, 200, {
      id: c.id,
      name: c.name,
      class: c.class,
      level: c.level,
      skin: c.state?.skin ?? skin,
      forceRename: c.force_rename,
    });
  };
  try {
    const c = await create();
    if (!c) {
      json(ctx.res, 400, CHARACTER_LIMIT_REACHED);
      return;
    }
    respondCreated(c);
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    // The name collided. Free it if held only by a deactivated account, then retry
    // once; otherwise it is genuinely taken.
    if (!(await charactersDb.reclaimDeactivatedName(name))) {
      json(ctx.res, 409, NAME_TAKEN);
      return;
    }
    try {
      const c = await create();
      if (!c) {
        json(ctx.res, 400, CHARACTER_LIMIT_REACHED);
        return;
      }
      respondCreated(c);
    } catch (err2) {
      if (isUniqueViolation(err2)) {
        json(ctx.res, 409, NAME_TAKEN);
        return;
      }
      throw err2;
    }
  }
}

/** GET /api/characters/:id/standing: the owner's realm lifetime-XP standing. */
async function standingHandler(ctx: Ctx): Promise<void> {
  const character = ownedCharacter(ctx);
  const standing = await charactersDb.lifetimeXpStanding(ctxAccountId(ctx), character.id);
  if (!standing) {
    json(ctx.res, 404, CHARACTER_NOT_FOUND);
    return;
  }
  json(ctx.res, 200, standing);
}

/** GET /api/characters/:id/sheet: the OWNER character sheet (full detail). */
async function ownerSheetHandler(ctx: Ctx): Promise<void> {
  const rt = useRuntime();
  const row = ownedCharacter(ctx);
  const [guild, rank, deedsRecent] = await Promise.all([
    charactersDb.guildNameForCharacter(row.id),
    charactersDb.lifetimeXpRankForCharacter(row.id),
    charactersDb.recentDeedsForCharacter(row.id, SHEET_RECENT_DEEDS),
  ]);
  json(
    ctx.res,
    200,
    characterSheet({
      row,
      visibility: 'owner',
      realm: REALM,
      origin: rt.publicOrigin(ctx.req),
      guild,
      rank: toSheetRank(rank),
      deedsRecent,
    }),
  );
}

/** POST /api/characters/:id/rename: moderator-sanctioned rename (force_rename gated). */
async function renameHandler(ctx: Ctx): Promise<void> {
  const rt = useRuntime();
  const accountId = ctxAccountId(ctx);
  const character = ownedCharacter(ctx);
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  const name = normalizeCharName(body.name);
  if (name === null) {
    json(ctx.res, 400, INVALID_CHAR_NAME);
    return;
  }
  if (offensiveName(name)) {
    json(ctx.res, 400, CHAR_NAME_NOT_ALLOWED);
    return;
  }
  // The UI hides the rename control unless a moderator set force_rename; the API is the
  // real boundary, so re-check here. renameCharacter's UPDATE re-checks race-free.
  if (!character.force_rename) {
    json(ctx.res, 403, RENAME_NOT_PERMITTED);
    return;
  }
  // Renaming an online character desyncs the live session's cached name (used by
  // reports/chat/status) and would let a force-renamed player clear the flag without
  // leaving; require offline, mirroring the DELETE guard.
  if (rt.isCharacterOnline(character.id)) {
    json(ctx.res, 400, CHARACTER_ONLINE);
    return;
  }
  try {
    const c = await charactersDb.renameCharacter(accountId, character.id, name);
    if (!c) {
      // The force_rename-gated UPDATE matched no row though the pre-check passed: a
      // concurrent rename cleared the flag, or the character was just deleted. Re-resolve
      // so the status matches the pre-check (403 still-exists-not-flagged, 404 gone).
      const still = await charactersDb.getCharacter(accountId, character.id);
      if (still && !still.force_rename) {
        json(ctx.res, 403, RENAME_NOT_PERMITTED);
        return;
      }
      json(ctx.res, 404, CHARACTER_NOT_FOUND);
      return;
    }
    if (rt.rekeyMarketSeller(character.id, character.name, c.name)) {
      await rt.saveMarket();
    }
    if (rt.rekeyMailOwner(character.id, character.name, c.name)) {
      await rt.saveMail();
    }
    json(ctx.res, 200, {
      id: c.id,
      name: c.name,
      class: c.class,
      level: c.level,
      forceRename: c.force_rename,
    });
  } catch (err) {
    if (isUniqueViolation(err)) {
      json(ctx.res, 409, NAME_TAKEN);
      return;
    }
    throw err;
  }
}

/** POST /api/characters/:id/takeover: free a stale live session so the owner can re-enter. */
async function takeoverHandler(ctx: Ctx): Promise<void> {
  const rt = useRuntime();
  const character = ownedCharacter(ctx);
  const result = await rt.takeOverCharacter(ctxAccountId(ctx), character.id);
  json(ctx.res, 200, { ok: true, takenOver: result === 'taken-over' });
}

/** DELETE /api/characters/:id: delete after an offline + name-confirmation check. */
async function deleteHandler(ctx: Ctx): Promise<void> {
  const rt = useRuntime();
  const accountId = ctxAccountId(ctx);
  const character = ownedCharacter(ctx);
  const body = (ctx.body ?? {}) as Record<string, unknown>;
  if (rt.isCharacterOnline(character.id)) {
    json(ctx.res, 400, CHARACTER_ONLINE);
    return;
  }
  if (normalizeDeleteConfirmation(body.name) !== normalizeDeleteConfirmation(character.name)) {
    json(ctx.res, 400, DELETE_CONFIRM);
    return;
  }
  const ok = await charactersDb.deleteCharacter(accountId, character.id);
  json(ctx.res, ok ? 200 : 404, ok ? { ok: true } : NOT_FOUND);
}

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes. The account-owned :id
// routes carry meta.requireOwned { kind:'character', ownerScope:'account' } so the
// registry BOLA-shadow guard and the deny-by-default ownership-coverage test recognize
// them; their middleware runs the auth guard, then the per-action limiter (bounds every
// authenticated attempt), then requireOwnedCharacter, then (for the create/rename/delete
// body routes) withBody. Middleware order per route is cheap-reject-first.
// ---------------------------------------------------------------------------

/** The meta marking an account-owned (BOLA-protected) character :id route. */
const OWNED_CHARACTER_META = {
  requireOwned: { kind: CHARACTER_RESOURCE, ownerScope: 'account' },
} as const;

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/me/characters',
    surface: 'api',
    middleware: [readGuard],
    handler: meCharactersHandler,
  },
  {
    method: 'GET',
    path: '/api/characters',
    surface: 'api',
    middleware: [activeGuard],
    handler: listCharactersHandler,
  },
  {
    method: 'POST',
    path: '/api/characters',
    surface: 'api',
    middleware: [activeGuard, rateLimit(CHARACTER_CREATE_POLICY), withBody()],
    handler: createCharacterHandler,
  },
  {
    method: 'GET',
    path: '/api/characters/:id/standing',
    surface: 'api',
    middleware: [activeGuard, requireOwnedCharacter(CHARACTER_NOT_FOUND)],
    handler: standingHandler,
    meta: OWNED_CHARACTER_META,
  },
  {
    method: 'GET',
    path: '/api/characters/:id/sheet',
    surface: 'api',
    middleware: [readGuard, requireOwnedCharacter(CHARACTER_NOT_FOUND)],
    handler: ownerSheetHandler,
    meta: OWNED_CHARACTER_META,
  },
  {
    method: 'POST',
    path: '/api/characters/:id/rename',
    surface: 'api',
    // withBody BEFORE requireOwnedCharacter mirrors the legacy readBody-then-getCharacter
    // order, so a malformed body answers the withBody 400/413 for any :id (owned or not),
    // keeping the framework-error divergence uniform (the characterBodyValidationRemap
    // known deviation) rather than a non-owned malformed body 404ing on ownership first.
    middleware: [
      activeGuard,
      rateLimit(CHARACTER_RENAME_POLICY),
      withBody(),
      requireOwnedCharacter(CHARACTER_NOT_FOUND),
    ],
    handler: renameHandler,
    meta: OWNED_CHARACTER_META,
  },
  {
    method: 'POST',
    path: '/api/characters/:id/takeover',
    surface: 'api',
    middleware: [
      activeGuard,
      rateLimit(CHARACTER_TAKEOVER_POLICY),
      requireOwnedCharacter(NOT_FOUND),
    ],
    handler: takeoverHandler,
    meta: OWNED_CHARACTER_META,
  },
  {
    method: 'DELETE',
    path: '/api/characters/:id',
    surface: 'api',
    // withBody BEFORE requireOwnedCharacter mirrors the legacy readBody-then-getCharacter
    // order exactly (body, then ownership, then online/confirm/delete).
    middleware: [
      activeGuard,
      rateLimit(CHARACTER_DELETE_POLICY),
      withBody(),
      requireOwnedCharacter(NOT_FOUND),
    ],
    handler: deleteHandler,
    meta: OWNED_CHARACTER_META,
  },
];
