// Game-server REST routes for CLAUDIUM, the server-authoritative soft currency.
//
// The browser hits these same-origin /api/claudium/* routes on the GAME server;
// each route resolves the caller's account from the bearer token (activeGuard),
// then proxies to the external economy service through server/claudium_proxy.ts,
// which fails closed (typed unavailable results, never throws) when the service
// is unset or unreachable. This module therefore stays a thin authenticated
// pass-through: it computes NO peg/price/balance, it only forwards.
//
// One shared dispatch core, handleClaudiumApi(req, res, accountId), is called by
// BOTH the migrated RouteDef handlers (registered in server/http/registry.ts) and
// the legacy handleApi prefix arm in server/main.ts (startsWith('/api/claudium')),
// mirroring the daily-rewards twin. The dual-edit invariant keeps them in lockstep
// until the legacy ladder is removed.

import type * as http from 'node:http';
import { isKnownStorageSkuId } from '../src/sim/content/storage_charters';
import { WEAPON_SKINS } from '../src/sim/content/weapon_skins';
import {
  type ClaudiumNativeRail,
  type ClaudiumPriceRail,
  claudiumBalance,
  claudiumHistory,
  claudiumNativeConfirm,
  claudiumNativePrice,
  claudiumNativeQuote,
  claudiumNativeRails,
  claudiumPrice,
  claudiumPurchase,
  claudiumServiceConfigured,
  claudiumSkus,
  claudiumSolBalance,
  claudiumSpend,
  claudiumStore,
  claudiumStripeWebhook,
  claudiumUsdcBalance,
} from './claudium_proxy';
import { accountAndScopeForToken, grantAccountWeaponSkins, moderationStatusForAccount } from './db';
import { ctxAccountId } from './http/context';
import { type BearerActiveGuardDb, createActiveGuard } from './http/middleware/bearer_active_guard';
import {
  CLAUDIUM_CONFIRM_POLICY,
  CLAUDIUM_CONFIRM_PRE_AUTH_POLICY,
  CLAUDIUM_PURCHASE_POLICY,
  CLAUDIUM_PURCHASE_PRE_AUTH_POLICY,
  CLAUDIUM_QUOTE_POLICY,
  CLAUDIUM_QUOTE_PRE_AUTH_POLICY,
  CLAUDIUM_SPEND_POLICY,
  CLAUDIUM_SPEND_PRE_AUTH_POLICY,
  rateLimit,
} from './http/middleware/rate_limit';
import type { Ctx, RateLimitOutcome, RouteDef } from './http/types';
import { json, readBinaryBody, readBody } from './http_util';
import {
  type ClaudiumMutationAction,
  claudiumMutationRateLimited,
  claudiumPreAuthRateLimited as claudiumPreAuthIpRateLimited,
} from './ratelimit';
import { STORAGE_KEY_PATTERN, STORAGE_MAX_EXPECTED_COST_CLAUDIUM } from './storage_purchases';

const STRIPE_WEBHOOK_MAX_BYTES = 1024 * 1024;

function makeRealClaudiumDb() {
  return { accountAndScopeForToken, moderationStatusForAccount };
}
type ClaudiumGuardDb = ReturnType<typeof makeRealClaudiumDb>;
let realClaudiumDb: ClaudiumGuardDb | undefined;
let claudiumDbOverride: ClaudiumGuardDb | undefined;
function claudiumGuardDb(): BearerActiveGuardDb {
  if (claudiumDbOverride) return claudiumDbOverride;
  realClaudiumDb ??= makeRealClaudiumDb();
  return realClaudiumDb;
}

/** Override the guard db with a fake (test-only; merges over the real reads). */
export function setClaudiumDbForTests(overrides: Partial<ClaudiumGuardDb>): void {
  realClaudiumDb ??= makeRealClaudiumDb();
  claudiumDbOverride = { ...realClaudiumDb, ...overrides };
}

/** Restore the real guard db after a setClaudiumDbForTests override (test-only). */
export function resetClaudiumDbForTests(): void {
  claudiumDbOverride = undefined;
}

/** Full active-session gate (mirrors the daily-rewards prefix arm). */
const activeGuard = createActiveGuard(() => claudiumGuardDb());

function parseRail(value: unknown): ClaudiumPriceRail | null {
  return value === 'stripe' || value === 'woc' ? value : null;
}

function parseNativeRail(value: unknown): ClaudiumNativeRail | null {
  return value === 'sol' || value === 'usdc' || value === 'woc' ? value : null;
}

function parseSpendKind(value: unknown): 'cosmetic' | 'skin' | 'item' | 'storage' | null {
  return value === 'cosmetic' || value === 'skin' || value === 'item' || value === 'storage'
    ? value
    : null;
}

function isKnownWeaponSkinId(itemId: string): boolean {
  return Object.hasOwn(WEAPON_SKINS, itemId);
}

function claudiumMutationAction(req: http.IncomingMessage): ClaudiumMutationAction | null {
  if (req.method !== 'POST') return null;
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (path === '/api/claudium/purchase') return 'purchase';
  if (path === '/api/claudium/native/quote') return 'quote';
  if (path === '/api/claudium/native/confirm') {
    return 'confirm';
  }
  if (path === '/api/claudium/spend') return 'spend';
  return null;
}

/** Legacy-dispatch pre-auth guard, shared with the registered route policies. */
export function claudiumPreAuthMutationRateLimited(
  req: http.IncomingMessage,
): RateLimitOutcome | null {
  const action = claudiumMutationAction(req);
  return action ? claudiumPreAuthIpRateLimited(req, action) : null;
}

/** Whether the economy service env is configured (does not confirm reachability). */
export function claudiumConfigured(): boolean {
  return claudiumServiceConfigured();
}

// Live-game hooks, injected from server/main.ts exactly like configureDiscordRuntime
// so `export const routes` stays a static array. The economy service is the
// ownership source of truth for Claudium purchases; these hooks mirror weapon-skin
// grants into the rollback-safe game entitlement table so the in-game equip gate
// and identity wire see them immediately (and the self-snapshot pushes to any live
// session).
interface ClaudiumGameHooks {
  grantWeaponSkins(accountId: number, skinIds: string[]): void;
  /** The whole storage purchase flow (Bank Storage phase 11): resolve the
   *  live character session, gate, persist the pending record, spend, and
   *  apply the slots exactly once (server/storage_purchases.ts). The result
   *  is the spend wire shape verbatim. Unlike the skin mirror there is NO
   *  no-runtime fallback: a storage purchase REQUIRES the live game, so the
   *  spend branch fails closed as 'unavailable' when the runtime itself is
   *  not configured (tests/tools). */
  storagePurchase(input: {
    accountId: number;
    itemId: string;
    expectedCostClaudium: number;
    idempotencyKey: string;
  }): Promise<{
    granted: boolean;
    balance: number | null;
    costClaudium: number | null;
    reason: string | null;
  }>;
}
let claudiumRuntime: ClaudiumGameHooks | null = null;

export function configureClaudiumRuntime(rt: ClaudiumGameHooks): void {
  claudiumRuntime = rt;
}

function noteWeaponSkinGrants(accountId: number, skinIds: string[]): void {
  const known = skinIds.filter(isKnownWeaponSkinId);
  if (known.length === 0) return;
  if (claudiumRuntime) {
    claudiumRuntime.grantWeaponSkins(accountId, known);
    return;
  }
  // No live game wired (tests/tools): persist directly so ownership still lands.
  void grantAccountWeaponSkins(accountId, known).catch((err) =>
    console.error('failed to persist weapon skin grant:', err),
  );
}

export async function handleClaudiumStripeWebhook(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const signature = String(req.headers['stripe-signature'] ?? '');
  const rawBody = await readBinaryBody(req, STRIPE_WEBHOOK_MAX_BYTES);
  const result = await claudiumStripeWebhook(rawBody, signature);
  return json(res, result.received ? 200 : 400, result);
}

/**
 * The one dispatch core the RouteDef handlers and the legacy prefix arm share. It
 * matches by method + pathname, forwards to the proxy (which fails closed), and
 * writes the JSON result. It never throws: an invalid request resolves to a typed
 * unavailable/invalid body, so the game stays playable with the service off.
 */
export async function handleClaudiumApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
  options: { rateLimitApplied?: boolean } = {},
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;

  const mutationAction = claudiumMutationAction(req);
  // The registered routes use the two-tier middleware. The retained legacy
  // dispatcher reaches this same core directly, so preserve rollback protection
  // with the identical tier-1 fused limiter instead of leaving that arm unlimited.
  if (mutationAction && !options.rateLimitApplied) {
    const outcome = claudiumMutationRateLimited(req, accountId, mutationAction);
    if (!outcome.allowed) return json(res, 429, { error: 'rate_limited' });
  }

  if (req.method === 'GET' && path === '/api/claudium/balance') {
    return json(res, 200, await claudiumBalance(accountId));
  }
  // The one :param route in the family. The Match-regex idiom (a single capture
  // group over the :rail segment) is what the pipeline's route-inventory scanner
  // recognizes as the legacy dispatch arm for /api/claudium/price/:rail.
  const priceMatch = /^\/api\/claudium\/price\/(\w+)$/.exec(path);
  if (req.method === 'GET' && priceMatch) {
    const rail = parseRail(decodeURIComponent(priceMatch[1]));
    if (!rail) {
      return json(res, 200, { rail: '', usdPerClaudium: null, wocBaseUnitsPerClaudium: null });
    }
    return json(res, 200, await claudiumPrice(rail));
  }
  if (req.method === 'GET' && path === '/api/claudium/skus') {
    return json(res, 200, await claudiumSkus());
  }
  if (req.method === 'GET' && path === '/api/claudium/native/rails') {
    return json(res, 200, await claudiumNativeRails());
  }
  const nativePriceMatch = /^\/api\/claudium\/native\/price\/(\w+)$/.exec(path);
  if (req.method === 'GET' && nativePriceMatch) {
    const rail = parseNativeRail(decodeURIComponent(nativePriceMatch[1]));
    const sku = url.searchParams.get('sku')?.trim() ?? '';
    if (!rail || sku === '') {
      return json(res, 200, {
        rail: rail ?? 'sol',
        claudium: null,
        amountBase: null,
        reason: 'invalid_request',
      });
    }
    return json(res, 200, await claudiumNativePrice(rail, sku));
  }
  const solBalanceMatch = /^\/api\/claudium\/native\/balance\/sol\/(\w+)$/.exec(path);
  if (req.method === 'GET' && solBalanceMatch) {
    return json(res, 200, await claudiumSolBalance(decodeURIComponent(solBalanceMatch[1])));
  }
  const usdcBalanceMatch = /^\/api\/claudium\/native\/balance\/usdc\/(\w+)$/.exec(path);
  if (req.method === 'GET' && usdcBalanceMatch) {
    return json(res, 200, await claudiumUsdcBalance(decodeURIComponent(usdcBalanceMatch[1])));
  }
  if (req.method === 'GET' && path === '/api/claudium/store') {
    const store = await claudiumStore(accountId);
    // The same allowlist rule per family: the service can never mint an id
    // the game registry does not carry. Storage rows (Bank Storage phase 11)
    // pass through for the phase 12 store category and the phase 13 banker
    // price tag; their `owned` is false forever and is never interpreted.
    const supportedStore = {
      ...store,
      items: store.items.filter(
        (item) =>
          (item.kind === 'skin' && isKnownWeaponSkinId(item.itemId)) ||
          (item.kind === 'storage' && isKnownStorageSkuId(item.itemId)),
      ),
    };
    // Reconcile: the service's grant ledger is authoritative for purchases, so
    // mirror any owned weapon skins the game DB does not know about yet.
    // Filtering on `owned` alone is safe here, and it is worth saying why so a
    // later reader does not "fix" it the wrong way. `owned` means the service
    // holds a GRANT row, which only the skin family ever has: a storage spend
    // writes no grant row, so a storage row's owned is false by construction and
    // forever. Two independent gates keep a storage id out of the weapon-skin
    // entitlement table even if the service ever set the flag on one: the filter
    // just above admits a row only under its OWN family's registry, and
    // noteWeaponSkinGrants re-filters its input through isKnownWeaponSkinId.
    // Reaching the table would take an id carried by BOTH registries, and they
    // are disjoint (tests/server/storage_gates.test.ts pins the tampered
    // owned:true storage row never reaching the mirror).
    noteWeaponSkinGrants(
      accountId,
      supportedStore.items.filter((item) => item.owned).map((item) => item.itemId),
    );
    return json(res, 200, supportedStore);
  }
  if (req.method === 'GET' && path === '/api/claudium/history') {
    return json(res, 200, await claudiumHistory(accountId));
  }
  if (req.method === 'POST' && path === '/api/claudium/purchase') {
    const body = (await readBody(req).catch(() => ({}))) as Record<string, unknown>;
    const rail = body.rail === 'stripe' ? 'stripe' : null;
    const sku = typeof body.sku === 'string' ? body.sku : '';
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
    if (!rail || sku === '' || idempotencyKey === '') {
      return json(res, 200, {
        ok: false,
        purchaseId: null,
        rail: null,
        claudium: null,
        stripe: null,
        woc: null,
        reason: 'invalid_request',
      });
    }
    return json(res, 200, await claudiumPurchase({ accountId, rail, sku, idempotencyKey }));
  }
  if (req.method === 'POST' && path === '/api/claudium/native/quote') {
    const body = (await readBody(req).catch(() => ({}))) as Record<string, unknown>;
    const rail = parseNativeRail(body.rail);
    const sku = typeof body.sku === 'string' ? body.sku : '';
    const payer = typeof body.payer === 'string' ? body.payer : '';
    if (!rail || sku === '' || payer === '') {
      return json(res, 200, {
        ok: false,
        reference: null,
        rail: null,
        claudium: null,
        amountBase: null,
        destination: null,
        mint: null,
        memo: null,
        quoteExpiryMs: null,
        transactionBase64: null,
        split: null,
        reason: 'invalid_request',
      });
    }
    return json(res, 200, await claudiumNativeQuote({ accountId, rail, sku, payer }));
  }
  if (req.method === 'POST' && path === '/api/claudium/native/confirm') {
    const body = (await readBody(req).catch(() => ({}))) as Record<string, unknown>;
    const reference = typeof body.reference === 'string' ? body.reference : '';
    const signature = typeof body.signature === 'string' ? body.signature : '';
    if (reference === '' || signature === '') {
      return json(res, 200, { settled: false, balance: null, reason: 'invalid_request' });
    }
    return json(res, 200, await claudiumNativeConfirm({ accountId, reference, signature }));
  }
  if (req.method === 'POST' && path === '/api/claudium/spend') {
    const body = (await readBody(req).catch(() => ({}))) as Record<string, unknown>;
    const itemId = typeof body.itemId === 'string' ? body.itemId : '';
    const kind = parseSpendKind(body.kind);
    const expectedCostClaudium =
      typeof body.expectedCostClaudium === 'number' ? body.expectedCostClaudium : Number.NaN;
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
    if (
      itemId === '' ||
      !kind ||
      !Number.isSafeInteger(expectedCostClaudium) ||
      expectedCostClaudium <= 0 ||
      idempotencyKey === ''
    ) {
      return json(res, 200, {
        granted: false,
        balance: null,
        costClaudium: null,
        reason: 'invalid_request',
      });
    }
    if (kind === 'storage') {
      // Bank Storage phase 11: repeatable bank-capacity SKUs. The storage id
      // allowlist mirrors the skin one (a skin id declared as storage falls
      // through here as unknown_item, exactly as a storage id declared as
      // skin falls through the gate below), and the flow itself lives behind
      // the runtime hook: it must resolve the LIVE character session, hold
      // the per-character purchase mutex, persist the pending record, and
      // apply the slots exactly once against the idempotent receipt. The
      // skin path's owned re-read mirror below deliberately does NOT run for
      // storage: a storage spend writes no grant row, so `owned` stays false
      // forever and re-reading it would refuse every purchase.
      //
      // The key and cost bounds are load-bearing, not hygiene: the key must
      // fit the SHARED bound the sim persists and reloads (an overlong key
      // would apply, save, and then vanish on the next load, voiding the
      // exactly-once dedupe), and the declared cost must fit the pending
      // row's INT column (it is fingerprint-bound and persisted verbatim).
      if (
        !STORAGE_KEY_PATTERN.test(idempotencyKey) ||
        expectedCostClaudium > STORAGE_MAX_EXPECTED_COST_CLAUDIUM
      ) {
        return json(res, 200, {
          granted: false,
          balance: null,
          costClaudium: null,
          reason: 'invalid_request',
        });
      }
      if (!isKnownStorageSkuId(itemId)) {
        return json(res, 200, {
          granted: false,
          balance: null,
          costClaudium: null,
          reason: 'unknown_item',
        });
      }
      if (!claudiumRuntime?.storagePurchase) {
        // No live game wired (tests/tools). Unlike noteWeaponSkinGrants there
        // is no persist-directly fallback: without a live character session
        // nothing may spend, so fail closed as unavailable.
        return json(res, 200, {
          granted: false,
          balance: null,
          costClaudium: null,
          reason: 'unavailable',
        });
      }
      return json(
        res,
        200,
        await claudiumRuntime.storagePurchase({
          accountId,
          itemId,
          expectedCostClaudium,
          idempotencyKey,
        }),
      );
    }
    if (kind !== 'skin' || !isKnownWeaponSkinId(itemId)) {
      return json(res, 200, {
        granted: false,
        balance: null,
        costClaudium: null,
        reason: 'unknown_item',
      });
    }
    const result = await claudiumSpend({
      accountId,
      itemId,
      kind,
      expectedCostClaudium,
      idempotencyKey,
    });
    // Never mirror the caller-supplied item from the spend response alone. Spend
    // idempotency belongs to the economy service, and a stale or cross-item replay
    // must not turn an arbitrary request body into a paid entitlement. Re-read the
    // authoritative grant ledger and mirror only this exact owned skin. A transient
    // store failure leaves the game mirror untouched; the next store open heals it.
    if (result.granted || result.reason === 'already_granted') {
      const store = await claudiumStore(accountId);
      const ownsRequestedSkin = store.items.some(
        (item) => item.kind === 'skin' && item.itemId === itemId && item.owned,
      );
      if (ownsRequestedSkin) noteWeaponSkinGrants(accountId, [itemId]);
    }
    return json(res, 200, result);
  }
  // An in-family unknown subpath / method (the account is already resolved).
  return json(res, 404, { error: 'unknown endpoint' });
}

/** A player route: the guard resolved the account; the shared core dispatches. */
function claudiumHandler(ctx: Ctx): Promise<void> {
  return handleClaudiumApi(ctx.req, ctx.res, ctxAccountId(ctx), { rateLimitApplied: true });
}

export const routes: RouteDef[] = [
  {
    method: 'POST',
    path: '/api/claudium/stripe/webhook',
    surface: 'api',
    meta: { publicRead: true },
    handler: (ctx) => handleClaudiumStripeWebhook(ctx.req, ctx.res),
  },
  {
    method: 'GET',
    path: '/api/claudium/balance',
    surface: 'api',
    middleware: [activeGuard],
    handler: claudiumHandler,
  },
  {
    method: 'GET',
    path: '/api/claudium/price/:rail',
    surface: 'api',
    // :rail is a public enum ('stripe'|'woc'), NOT an account-owned resource, so
    // it carries no requireOwned loader; publicRead marks that intentional.
    meta: { publicRead: true },
    middleware: [activeGuard],
    handler: claudiumHandler,
  },
  {
    method: 'GET',
    path: '/api/claudium/skus',
    surface: 'api',
    middleware: [activeGuard],
    handler: claudiumHandler,
  },
  {
    method: 'GET',
    path: '/api/claudium/native/rails',
    surface: 'api',
    middleware: [activeGuard],
    handler: claudiumHandler,
  },
  {
    method: 'GET',
    path: '/api/claudium/native/price/:rail',
    surface: 'api',
    meta: { publicRead: true },
    middleware: [activeGuard],
    handler: claudiumHandler,
  },
  {
    method: 'GET',
    path: '/api/claudium/native/balance/sol/:owner',
    surface: 'api',
    meta: { publicRead: true },
    middleware: [activeGuard],
    handler: claudiumHandler,
  },
  {
    method: 'GET',
    path: '/api/claudium/native/balance/usdc/:owner',
    surface: 'api',
    meta: { publicRead: true },
    middleware: [activeGuard],
    handler: claudiumHandler,
  },
  {
    method: 'GET',
    path: '/api/claudium/store',
    surface: 'api',
    middleware: [activeGuard],
    handler: claudiumHandler,
  },
  {
    method: 'GET',
    path: '/api/claudium/history',
    surface: 'api',
    middleware: [activeGuard],
    handler: claudiumHandler,
  },
  {
    method: 'POST',
    path: '/api/claudium/purchase',
    surface: 'api',
    middleware: [
      rateLimit(CLAUDIUM_PURCHASE_PRE_AUTH_POLICY),
      activeGuard,
      rateLimit(CLAUDIUM_PURCHASE_POLICY),
    ],
    handler: claudiumHandler,
  },
  {
    method: 'POST',
    path: '/api/claudium/native/quote',
    surface: 'api',
    middleware: [
      rateLimit(CLAUDIUM_QUOTE_PRE_AUTH_POLICY),
      activeGuard,
      rateLimit(CLAUDIUM_QUOTE_POLICY),
    ],
    handler: claudiumHandler,
  },
  {
    method: 'POST',
    path: '/api/claudium/native/confirm',
    surface: 'api',
    middleware: [
      rateLimit(CLAUDIUM_CONFIRM_PRE_AUTH_POLICY),
      activeGuard,
      rateLimit(CLAUDIUM_CONFIRM_POLICY),
    ],
    handler: claudiumHandler,
  },
  {
    method: 'POST',
    path: '/api/claudium/spend',
    surface: 'api',
    middleware: [
      rateLimit(CLAUDIUM_SPEND_PRE_AUTH_POLICY),
      activeGuard,
      rateLimit(CLAUDIUM_SPEND_POLICY),
    ],
    handler: claudiumHandler,
  },
];
