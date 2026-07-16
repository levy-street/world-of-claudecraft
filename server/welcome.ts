// Welcome-screen server flags: GET /api/welcome/flags.
//
// Rung: AUTHENTICATED (bearer required), scaffolded by `npm run new:endpoint`. The one
// live field today is `armoryPromoEnabled`, the server-side half of the Season 1 Armory
// card gate (the client-side half is `shouldShowStorePromo` in `src/ui/store_promo_card.ts`,
// which excludes native/desktop/mobile-touch). Read is a plain env toggle, so it is cheap;
// the short in-process cache exists mainly to keep a burst of welcome-screen loads from
// re-reading `process.env` on every request, giving this endpoint the same tiny-cached
// shape as its sibling `/api/discord` and `/api/daily-rewards` reads.
// See server/CLAUDE.md "Adding an endpoint (REST)" and server/auth_routes.ts.

import { accountAndScopeForToken, moderationStatusForAccount } from './db';
import { type BearerActiveGuardDb, createReadGuard } from './http/middleware/bearer_active_guard';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';

// The bearer guard reads its token + moderation status through this seam; the
// production default is the real db.ts reads, so the guard bans/suspensions and
// enforces token scope out of the box. A test swaps in a fake, no Postgres.
export type WelcomeDb = BearerActiveGuardDb;

const REAL_WELCOME_DB: WelcomeDb = {
  accountAndScopeForToken,
  moderationStatusForAccount,
};
let welcomeDb: WelcomeDb = REAL_WELCOME_DB;

/** Override the db seam with a fake (test-only; merges over the real reads). */
export function setWelcomeDbForTests(overrides: Partial<WelcomeDb>): void {
  welcomeDb = { ...REAL_WELCOME_DB, ...overrides };
}

/** Restore the real db seam after an override (test-only). */
export function resetWelcomeDbForTests(): void {
  welcomeDb = REAL_WELCOME_DB;
}

// Shared bearer guard (moderation-gated + scope-enforced): accepts a read OR full token.
const authGuard = createReadGuard(() => welcomeDb);

export interface WelcomeFlags {
  /** Server-side half of the Season 1 Armory card gate (client half: shouldShowStorePromo). */
  armoryPromoEnabled: boolean;
}

const FLAGS_CACHE_MS = 30_000;
let cachedFlags: WelcomeFlags | null = null;
let cachedAt = 0;
let nowFn: () => number = () => Date.now();

/** Swap the clock for a deterministic test (test-only). */
export function setWelcomeClockForTests(fn: () => number): void {
  nowFn = fn;
  cachedFlags = null;
  cachedAt = 0;
}

/** Restore the real clock after a test override (test-only). */
export function resetWelcomeClockForTests(): void {
  nowFn = () => Date.now();
  cachedFlags = null;
  cachedAt = 0;
}

/** Env default is OFF: a fresh deploy never surfaces the store surface unannounced. */
function readWelcomeFlags(): WelcomeFlags {
  return { armoryPromoEnabled: process.env.ARMORY_PROMO_ENABLED === '1' };
}

/** Cached read so a burst of welcome-screen loads does not re-check env each time. */
export function welcomeFlags(): WelcomeFlags {
  const now = nowFn();
  if (!cachedFlags || now - cachedAt >= FLAGS_CACHE_MS) {
    cachedFlags = readWelcomeFlags();
    cachedAt = now;
  }
  return cachedFlags;
}

/** GET /api/welcome/flags: authenticated. */
async function welcomeHandler(ctx: Ctx): Promise<void> {
  json(ctx.res, 200, welcomeFlags());
}

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/welcome/flags',
    surface: 'api',
    middleware: [authGuard],
    handler: welcomeHandler,
  },
];
