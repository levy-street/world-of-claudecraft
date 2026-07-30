// Deeds API surface: the global rarity aggregate (anonymous public read) and
// the account broadcast opt-out toggle (authenticated write). Scaffolded by
// `npm run new:endpoint`, filled in per the two reference rungs: the rarity
// read copies server/leaderboard.ts (static `routes` array, a
// configureDeedsRuntime injection so the handlers can reach the main.ts TTL
// cache without an import cycle, publicReadRateLimited in-handler), and the
// toggle copies the authenticated-write shape (requireAccount + withBody +
// ctxAccountId). New routes are registry-only: there is no legacy-ladder twin
// for either path, by design.

import type { DeedsRarity } from '../src/world_api';
import { getDeedBroadcasts, setDeedBroadcasts } from './deeds_db';
import { ctxAccountId } from './http/context';
import { withBody } from './http/middleware/body';
import { requireAccount } from './http/middleware/require_account';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';
import { publicReadRateLimited } from './ratelimit';

/** The stable machine code this domain emits on invalid input (see error_codes.ts). */
const INVALID_INPUT_CODE = 'deeds.invalid_input';

/**
 * The main.ts-owned runtime the rarity handler depends on but cannot import
 * without a cycle (main -> registry -> deeds -> main): the cache-fronted
 * rarity read (5 minute TTL; rarity moves slowly and the refresh scans
 * character_deeds).
 */
export interface DeedsRuntime {
  deedsRarity(): Promise<DeedsRarity>;
}

let runtime: DeedsRuntime | null = null;

/** Inject the main.ts runtime the handlers need. Called once at boot. */
export function configureDeedsRuntime(rt: DeedsRuntime): void {
  runtime = rt;
}

/** Clear the injected runtime so a unit test can install its own fake. */
export function resetDeedsRuntimeForTests(): void {
  runtime = null;
}

/** The injected runtime, or a loud failure if a request somehow beat boot wiring. */
function useRuntime(): DeedsRuntime {
  if (runtime === null) {
    throw new Error('deeds runtime is not configured; call configureDeedsRuntime');
  }
  return runtime;
}

/**
 * GET /api/deeds/rarity: the global deed rarity aggregate,
 * `{ totalEligible, earned: { [deedId]: count } }` with zero-earn deeds
 * absent. Anonymous and DB-cache-backed, so it takes the same per-IP
 * public-read budget the sheet and search use (in-handler, keeping the 429
 * body shape those routes established).
 */
async function rarityHandler(ctx: Ctx): Promise<void> {
  if (!publicReadRateLimited(ctx.req).allowed) {
    json(ctx.res, 429, { error: 'rate limited' });
    return;
  }
  json(ctx.res, 200, await useRuntime().deedsRarity());
}

/**
 * GET /api/deeds/broadcasts: the account's current marquee-unlock broadcast
 * setting, `{ enabled }`, so the options toggle renders the persisted state
 * before the first write. Read-tier bearer (the steam status shape); a
 * missing row reads as the column default TRUE.
 */
async function broadcastsReadHandler(ctx: Ctx): Promise<void> {
  json(ctx.res, 200, { enabled: await getDeedBroadcasts(ctxAccountId(ctx)) });
}

/**
 * POST /api/deeds/broadcasts { enabled: boolean }: set the account's
 * marquee-unlock broadcast opt-out (accounts.deed_broadcasts). The flag only
 * gates the guild/friend fan-out; unlocks themselves are never affected.
 * Requires a mutation-scope bearer; the strict boolean check answers the
 * domain's stable invalid-input code.
 */
async function broadcastsHandler(ctx: Ctx): Promise<void> {
  const enabled = (ctx.body as Record<string, unknown> | null | undefined)?.enabled;
  if (typeof enabled !== 'boolean') {
    json(ctx.res, 400, { error: 'invalid input', code: INVALID_INPUT_CODE });
    return;
  }
  await setDeedBroadcasts(ctxAccountId(ctx), enabled);
  json(ctx.res, 200, { enabled });
}

/** The mutation-tier bearer gate the toggle route mounts. */
const activeAccount = requireAccount({ scope: 'active' });
/** Read-tier bearer gate for the settings read (the steam status shape). */
const readAccount = requireAccount({ scope: 'read' });

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/deeds/rarity',
    surface: 'api',
    handler: rarityHandler,
  },
  {
    method: 'GET',
    path: '/api/deeds/broadcasts',
    surface: 'api',
    middleware: [readAccount],
    handler: broadcastsReadHandler,
  },
  {
    method: 'POST',
    path: '/api/deeds/broadcasts',
    surface: 'api',
    middleware: [activeAccount, withBody()],
    handler: broadcastsHandler,
  },
];
