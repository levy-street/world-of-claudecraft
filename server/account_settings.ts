import {
  ACCOUNT_SETTINGS_MAX_BYTES,
  isDeviceType,
  validateAccountSettingsEntries,
} from '../src/account_settings_contract';
import { type AccountSettingsDb, accountSettingsDb } from './account_settings_db';
import { ctxAccountId } from './http/context';
import { HttpError } from './http/errors';
import { withBody } from './http/middleware/body';
import { type RateLimitPolicy, rateLimit } from './http/middleware/rate_limit';
import { requireAccount } from './http/middleware/require_account';
import type { Ctx, RateLimitOutcome, RouteDef } from './http/types';
import { json } from './http_util';
import { mergeFusedOutcomes, rateLimitNow, WINDOW_MS, windowedRateLimitOutcome } from './ratelimit';

let db: AccountSettingsDb = accountSettingsDb;
export function configureAccountSettingsRuntime(runtime: AccountSettingsDb): void {
  db = runtime;
}
const attempts = new Map<string, number[]>();
function attempt(key: string): RateLimitOutcome {
  const now = rateLimitNow();
  const active = (attempts.get(key) ?? []).filter((time) => time > now - WINDOW_MS);
  if (active.length <= 30) active.push(now);
  attempts.set(key, active);
  if (attempts.size > 4_000) {
    const oldest = attempts.keys().next().value;
    if (oldest !== undefined) attempts.delete(oldest);
  }
  return windowedRateLimitOutcome(active.length, 30, active[0] ?? now, WINDOW_MS, now);
}
/** Fused account/IP budget, globally backed for cross-realm account authority. */
export const ACCOUNT_SETTINGS_POLICY: RateLimitPolicy = {
  name: 'account_settings',
  keyClass: 'ip+account',
  limit: 30,
  windowSeconds: WINDOW_MS / 1000,
  tier2: 'global',
  tier1: (ctx) =>
    mergeFusedOutcomes(attempt(`ip:${ctx.ip}`), attempt(`account:${ctxAccountId(ctx)}`)),
};
/** Cheap IP gate precedes bearer database resolution; no tier-2 query here. */
export const ACCOUNT_SETTINGS_PREAUTH_POLICY: RateLimitPolicy = {
  name: 'account_settings_pre_auth',
  keyClass: 'ip',
  limit: 30,
  windowSeconds: WINDOW_MS / 1000,
  tier2: 'none',
  tier1: (ctx) => attempt('preauth:' + ctx.ip),
};
export function resetAccountSettingsRateLimitsForTests(): void {
  attempts.clear();
}
function invalid(): never {
  throw new HttpError(422, 'validation.failed', {
    issues: JSON.stringify([{ pointer: '/settings', code: 'type' }]),
  });
}
function payload(ctx: Ctx) {
  const body = ctx.body as Record<string, unknown> | null;
  if (!body || !isDeviceType(body.deviceType)) return invalid();
  const entries = validateAccountSettingsEntries(body.entries);
  if (!entries) return invalid();
  return { body, deviceType: body.deviceType, entries };
}
async function status(ctx: Ctx): Promise<void> {
  json(ctx.res, 200, {
    acknowledged: await db.acknowledged(ctxAccountId(ctx)),
    accountId: ctxAccountId(ctx),
  });
}
async function acknowledge(ctx: Ctx): Promise<void> {
  if ((ctx.body as Record<string, unknown> | null)?.understood !== true) return invalid();
  await db.acknowledge(ctxAccountId(ctx));
  json(ctx.res, 200, { acknowledged: true });
}
async function initialize(ctx: Ctx): Promise<void> {
  const { body, deviceType, entries } = payload(ctx);
  if (!Number.isSafeInteger(body.characterId) || Number(body.characterId) <= 0) return invalid();
  const profile = await db.initialize(
    ctxAccountId(ctx),
    deviceType,
    Number(body.characterId),
    entries,
  );
  if (!profile) throw new HttpError(404, 'character.not_found');
  json(ctx.res, 200, { entries: profile, accountId: ctxAccountId(ctx) });
}
async function save(ctx: Ctx): Promise<void> {
  const { deviceType, entries } = payload(ctx);
  if (!(await db.save(ctxAccountId(ctx), deviceType, entries)))
    throw new HttpError(404, 'account.not_found');
  json(ctx.res, 200, { saved: true });
}
const guards = [
  rateLimit(ACCOUNT_SETTINGS_PREAUTH_POLICY),
  requireAccount({ scope: 'full' }),
  rateLimit(ACCOUNT_SETTINGS_POLICY),
];
export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/account/settings',
    surface: 'api',
    middleware: guards,
    handler: status,
  },
  {
    method: 'POST',
    path: '/api/account/settings/ack',
    surface: 'api',
    middleware: [...guards, withBody(1_024)],
    handler: acknowledge,
  },
  {
    method: 'POST',
    path: '/api/account/settings/initialize',
    surface: 'api',
    middleware: [...guards, withBody(ACCOUNT_SETTINGS_MAX_BYTES + 1_024)],
    handler: initialize,
  },
  {
    method: 'POST',
    path: '/api/account/settings/save',
    surface: 'api',
    middleware: [...guards, withBody(ACCOUNT_SETTINGS_MAX_BYTES + 1_024)],
    handler: save,
  },
];
