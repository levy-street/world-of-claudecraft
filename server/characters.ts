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
import { rekeyInstanceSigner } from '../src/sim/character_rename';
import { resolveActiveWeaponSkin } from '../src/sim/content/weapon_skin_rules';
import { DEEDS_RECENT_CAP } from '../src/sim/deeds';
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
  loadAccountCosmetics,
  moderationStatusForAccount,
  reclaimDeactivatedName,
  renameCharacter,
  saveCharacterState,
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
  /** game.purgeMarketSeller: drop a deleted character's listings + collection. */
  purgeMarketSeller(characterId: number, name: string): boolean;
  /** game.rekeyMailOwner: re-key the character's Ravenpost mailbox after a rename. */
  rekeyMailOwner(characterId: number, oldName: string, newName: string): boolean;
  /** game.saveMail: persist the Ravenpost mail book after a rekey. */
  saveMail(): Promise<void>;
  /** game.purgeMailOwner: clear a deleted character's Ravenpost mailbox. */
  purgeMailOwner(characterId: number, name: string): boolean;
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
  loadAccountCosmetics,
  moderationStatusForAccount,
  listCharacters,
  getCharacter,
  createCharacterCapped,
  reclaimDeactivatedName,
  renameCharacter,
  saveCharacterState,
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
 * scan). The retained legacy arm (main.ts characterListPayload) DELEGATES here, so the
 * two dispatch modes share one implementation and cannot diverge in payload shape.
 */
export function buildCharacterList(
  chars: CharacterRow[],
  isOnline: (characterId: number) => boolean,
  weaponSkinLoadout: Record<string, string>,
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
      // Keep the migrated RouteDef byte-identical with the retained legacy arm:
      // character select renders the same body and held items as the live world.
      skinCatalog: c.state?.skinCatalog === 'mech' ? 'mech' : 'class',
      mainhandItemId: c.state?.equipment?.mainhand ?? null,
      offhandItemId: c.state?.equipment?.offhand ?? null,
      // The account's active Armory weapon skin for THIS character's class and
      // held mainhand (the same shared rule the world and paperdoll use), so
      // the char-select turntable matches the in-world render. Loadout is
      // account state; resolution is per character.
      weaponSkinId: resolveActiveWeaponSkin(
        c.class,
        c.state?.equipment?.mainhand ?? null,
        weaponSkinLoadout,
        c.state?.skinCatalog === 'mech' ? 'mech' : 'class',
      ),
    })),
  };
}

/**
 * The world-state rekey that follows a successful deactivated-name reclaim: the
 * orphaned holder was just archived out of the freed name (a rename in effect),
 * so ALL THREE of renameHandler's rekeys run here too. The market rows and the
 * mailbox move onto the stable id plus the archived name; without that, the
 * next holder of the display name could claim the orphan's escrow through the
 * name-fallback read arms. The orphan's OWN signed item instances (bags, bank,
 * equipped) are swept to the archived name; without that, their persisted blob
 * keeps signing a name that now belongs to a stranger (the #1145 self-signed
 * discount, Battlefield Experience attribution, and the eqi inspect wire all
 * compare signer to a live display name). Every rekey matches the holder's
 * STORED casing (reclaimed.freedName), never the requester's typed casing: the
 * db lookup is case-insensitive and the book matches are exact. The no-nonce
 * blob save is safe for the same reason renameHandler's is: a deactivated
 * account cannot hold a live session, so no lease fence is in play. Like the
 * DB reclaim itself, this runs BEFORE the create retry; a crash between the
 * committed reclaim and these rekeys leaves the orphan archived with its
 * world state still name-keyed (the same class of unrecoverable window the
 * delete purge documents below; nothing re-triggers the rekey).
 * Exported so BOTH create dispatch arms share it.
 */
export async function rekeyReclaimedCharacterWorldState(
  rt: Pick<CharactersRuntime, 'rekeyMarketSeller' | 'saveMarket' | 'rekeyMailOwner' | 'saveMail'>,
  reclaimed: {
    id: number;
    archivedName: string;
    freedName: string;
    level: number;
    state: CharacterState | null;
  },
): Promise<void> {
  if (rt.rekeyMarketSeller(reclaimed.id, reclaimed.freedName, reclaimed.archivedName)) {
    await rt.saveMarket();
  }
  if (rt.rekeyMailOwner(reclaimed.id, reclaimed.freedName, reclaimed.archivedName)) {
    await rt.saveMail();
  }
  if (
    reclaimed.state &&
    rekeyInstanceSigner(reclaimed.state, reclaimed.freedName, reclaimed.archivedName)
  ) {
    // Swallow-and-log like the market and mail save wrappers above: this is
    // the helper's one await that can reject, and a throw here would skip
    // the caller's create retry and 500 a reclaim that already committed.
    // The cost of swallowing is bounded and accepted: a failed blob save
    // leaves the orphan's signers on the freed name with nothing to
    // re-trigger the sweep, the same unrecoverable-window class the purge
    // and crash comments record.
    try {
      await charactersDb.saveCharacterState(reclaimed.id, reclaimed.level, reclaimed.state);
    } catch (err) {
      console.error('failed to save the reclaimed holder signer sweep:', err);
    }
  }
}

/**
 * The world-state purge that follows a successful character delete (R43). A deleted
 * character can never collect again, so its World Market listings, its Merchant
 * collection, and its Ravenpost mailbox leave the realm's shared books here instead
 * of sitting uncollectable forever.
 *
 * The purge mutates the LIVE sim through the injected runtime and only then persists:
 * the realm process serving this request is the one running the world, and it
 * re-persists the market and mail blobs from memory every autosave, so editing the
 * world_state rows alone (inside db.deleteCharacter, say) would be clobbered within
 * seconds. Each save is skipped when its purge reports no change. This assumes the
 * current one-process-per-realm topology: a second process serving the same realm
 * would re-persist its own un-purged copy. The two saves are deliberately NOT one
 * transaction (unlike the leave path, whose atomicity guards an item duplicating
 * between a bag and its escrow): a market listing and a mail parcel are independent
 * escrows and each half is idempotent. The autosave bounds a SAVE FAILURE (the
 * wrappers swallow write errors; memory re-persists within thirty seconds); a
 * process CRASH between the two saves loses the un-saved half permanently, the
 * same unrecoverable window the delete handler's comment records, because the
 * committed row delete leaves nothing to re-trigger the purge.
 *
 * Exported so BOTH delete dispatch arms share one behavior: this module's
 * deleteHandler and the retained legacy ladder arm in main.ts (the API_DISPATCH=legacy
 * rollback path), the buildCharacterList delegation precedent. Call it only AFTER the
 * DB delete reports success, mirroring renameHandler: a delete that matched no row
 * must never purge a live character's escrow.
 */
export async function purgeDeletedCharacterWorldState(
  rt: Pick<CharactersRuntime, 'purgeMarketSeller' | 'saveMarket' | 'purgeMailOwner' | 'saveMail'>,
  characterId: number,
  name: string,
): Promise<void> {
  // Never let a purge failure turn a COMMITTED delete into a 500: the row is
  // gone and a client retry would 404 with the mail half never purged. The
  // live-book mutations self-heal through the autosave (the save wrappers
  // swallow their own write errors already); this catch covers the walks
  // themselves, matching that posture.
  try {
    if (rt.purgeMarketSeller(characterId, name)) await rt.saveMarket();
    if (rt.purgeMailOwner(characterId, name)) await rt.saveMail();
  } catch (err) {
    console.error('failed to purge deleted character world state:', err);
  }
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
  const cosmetics = await charactersDb.loadAccountCosmetics(ctxAccountId(ctx));
  json(ctx.res, 200, buildCharacterList(chars, rt.isCharacterOnline, cosmetics.weaponSkinLoadout));
}

/** GET /api/characters: full-session list (byte-identical body to me/characters). */
async function listCharactersHandler(ctx: Ctx): Promise<void> {
  const rt = useRuntime();
  const chars = await charactersDb.listCharacters(ctxAccountId(ctx));
  const cosmetics = await charactersDb.loadAccountCosmetics(ctxAccountId(ctx));
  json(ctx.res, 200, buildCharacterList(chars, rt.isCharacterOnline, cosmetics.weaponSkinLoadout));
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
    const reclaimed = await charactersDb.reclaimDeactivatedName(name);
    if (!reclaimed) {
      json(ctx.res, 409, NAME_TAKEN);
      return;
    }
    await rekeyReclaimedCharacterWorldState(rt, reclaimed);
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

/**
 * GET /api/characters/:id/deeds-recent: the owner's newest-first deed unlock
 * ids from the character_deeds observer table, `{ deeds: [id, ...] }` capped
 * at DEEDS_RECENT_CAP. The state blob only keeps the earn DAY, so this read is
 * the client's one source of exact earn order (the Book of Deeds recent
 * strip). Ids only: the owner's Book already holds every earned day, and the
 * timestamps stay server-side.
 */
async function deedsRecentHandler(ctx: Ctx): Promise<void> {
  const character = ownedCharacter(ctx);
  const rows = await charactersDb.recentDeedsForCharacter(character.id, DEEDS_RECENT_CAP);
  json(ctx.res, 200, { deeds: rows.map((row) => row.deedId) });
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
    // The renamed character's OWN signed instances still carry the old signer
    // name; two sweeps split the work by WHERE the copies live. The market and
    // mail rekeys above cover the world-state books (ownership keys, display
    // names, AND the renamer's own escrowed payload signers, the fix-round
    // completion); this blob sweep covers the five signer-bearing regions of
    // the persisted character state, so the self-signed crafting discount,
    // Battlefield Experience attribution, and the eqi inspect wire follow the
    // new name everywhere a copy can come back from. A live entity/meta needs
    // no sweep: the isCharacterOnline gate above guarantees there is none at
    // rename time. Foreign-held copies signed with the old name live in other
    // characters' blobs or parcels and are out of scope. renameCharacter's
    // RETURNING row carries the current blob, and the no-nonce save is safe
    // for the same offline reason.
    if (c.state && rekeyInstanceSigner(c.state, character.name, c.name)) {
      await charactersDb.saveCharacterState(c.id, c.level, c.state);
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
  // The row is gone; take its shared world state with it (R43). Read freshness
  // comes from the SYNCHRONOUS in-memory purge (both reads serve from the live
  // sim in this process). The AWAITED saves NARROW the crash window before the
  // 200: a death after the committed DELETE but before the blobs persist would
  // reload listings and mail keyed to a character that no longer exists, with
  // no way to re-trigger the purge. They cannot close it outright (the game
  // save wrappers swallow their own errors and answer anyway; the 30 s
  // autosave is the failure-path backstop), but do not drop the await.
  if (ok) await purgeDeletedCharacterWorldState(rt, character.id, character.name);
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
    method: 'GET',
    path: '/api/characters/:id/deeds-recent',
    surface: 'api',
    // Registry-only (the new-route rule): no legacy ladder twin. Read-tier
    // bearer + ownership, the owner-sheet gate pair exactly.
    middleware: [readGuard, requireOwnedCharacter(CHARACTER_NOT_FOUND)],
    handler: deedsRecentHandler,
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
