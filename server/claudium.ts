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
import {
  type ClaudiumFulfillment,
  type ClaudiumNativeRail,
  type ClaudiumRail,
  claudiumBalance,
  claudiumConfirmWoc,
  claudiumGiftCardRedeem,
  claudiumGiftCardStatus,
  claudiumHistory,
  claudiumNativeConfirm,
  claudiumNativeQuote,
  claudiumPrice,
  claudiumPurchase,
  claudiumServiceConfigured,
  claudiumSkus,
  claudiumSpend,
  claudiumStore,
  claudiumSupply,
  claudiumSupplyHistory,
  parseNativeRail,
} from './claudium_proxy';
import { accountAndScopeForToken, moderationStatusForAccount } from './db';
import { ctxAccountId } from './http/context';
import { type BearerActiveGuardDb, createActiveGuard } from './http/middleware/bearer_active_guard';
import type { Ctx, RouteDef } from './http/types';
import { json, readBody } from './http_util';

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

function parseRail(value: unknown): ClaudiumRail | null {
  return value === 'stripe' || value === 'woc' ? value : null;
}

function parseSpendKind(value: unknown): 'cosmetic' | 'skin' | 'item' | null {
  return value === 'cosmetic' || value === 'skin' || value === 'item' ? value : null;
}

/**
 * Build the native-quote fulfillment leg from the request body, resolving the
 * caller's own accountId for a 'credit' fulfillment (the client never chooses the
 * credited account). Returns null on an unrecognized kind so the route can reject.
 */
function parseFulfillment(value: unknown, account: string): ClaudiumFulfillment | null {
  if (typeof value !== 'object' || value === null) return null;
  const f = value as Record<string, unknown>;
  if (f.kind === 'credit') {
    // The credited account is ALWAYS the authenticated caller, never a body field.
    return { kind: 'credit', accountId: account };
  }
  if (f.kind === 'giftcard') {
    const out: ClaudiumFulfillment = { kind: 'giftcard' };
    if (typeof f.recipientEmail === 'string') out.recipientEmail = f.recipientEmail;
    if (typeof f.message === 'string') out.message = f.message;
    if (typeof f.deliverAtMs === 'number') out.deliverAtMs = f.deliverAtMs;
    return out;
  }
  return null;
}

/** Whether the economy service env is configured (does not confirm reachability). */
export function claudiumConfigured(): boolean {
  return claudiumServiceConfigured();
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
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const account = String(accountId);

  if (req.method === 'GET' && path === '/api/claudium/balance') {
    return json(res, 200, await claudiumBalance(account));
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
  if (req.method === 'GET' && path === '/api/claudium/store') {
    return json(res, 200, await claudiumStore());
  }
  if (req.method === 'GET' && path === '/api/claudium/history') {
    return json(res, 200, await claudiumHistory(account));
  }
  if (req.method === 'GET' && path === '/api/claudium/supply') {
    return json(res, 200, await claudiumSupply());
  }
  if (req.method === 'GET' && path === '/api/claudium/supply/history') {
    // The window is chosen by the client, but bounded HERE: an unbounded range
    // with a tiny bucket would make the service scan and bucket the whole
    // ledger. Range caps at 90 days and the bucket floors at 1 minute; the
    // service clamps again independently, so neither side trusts the other.
    // A blank param ("?untilMs=") is not null and Number('') is 0, which passes
    // Number.isFinite, so treat blank as absent rather than as zero.
    const numParam = (key: string, fallback: number): number => {
      const raw = url.searchParams.get(key);
      return raw === null || raw.trim() === '' ? fallback : Number(raw);
    };
    const untilMs = numParam('untilMs', Date.now());
    const sinceMs = numParam('sinceMs', untilMs - 7 * 86_400_000);
    const bucketMs = numParam('bucketMs', 3_600_000);
    if (!Number.isFinite(untilMs) || !Number.isFinite(sinceMs) || !Number.isFinite(bucketMs)) {
      return json(res, 200, { points: [], bucketMs: null, sinceMs: null, untilMs: null });
    }
    const boundedSince = Math.max(sinceMs, untilMs - 90 * 86_400_000);
    return json(
      res,
      200,
      await claudiumSupplyHistory({
        sinceMs: boundedSince,
        untilMs,
        bucketMs: Math.max(bucketMs, 60_000),
      }),
    );
  }
  if (req.method === 'POST' && path === '/api/claudium/purchase') {
    const body = (await readBody(req).catch(() => ({}))) as Record<string, unknown>;
    const rail = parseRail(body.rail);
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
    return json(
      res,
      200,
      await claudiumPurchase({ accountId: account, rail, sku, idempotencyKey }),
    );
  }
  if (req.method === 'POST' && path === '/api/claudium/purchase/woc/confirm') {
    const body = (await readBody(req).catch(() => ({}))) as Record<string, unknown>;
    const purchaseId = typeof body.purchaseId === 'string' ? body.purchaseId : '';
    const inboundSignature = typeof body.inboundSignature === 'string' ? body.inboundSignature : '';
    if (purchaseId === '' || inboundSignature === '') {
      return json(res, 200, { credited: false, balance: null, reason: 'invalid_request' });
    }
    return json(res, 200, await claudiumConfirmWoc({ purchaseId, inboundSignature }));
  }
  if (req.method === 'POST' && path === '/api/claudium/spend') {
    const body = (await readBody(req).catch(() => ({}))) as Record<string, unknown>;
    const itemId = typeof body.itemId === 'string' ? body.itemId : '';
    const kind = parseSpendKind(body.kind);
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
    if (itemId === '' || !kind || idempotencyKey === '') {
      return json(res, 200, {
        granted: false,
        balance: null,
        costClaudium: null,
        reason: 'invalid_request',
      });
    }
    return json(
      res,
      200,
      await claudiumSpend({ accountId: account, itemId, kind, idempotencyKey }),
    );
  }
  if (req.method === 'POST' && path === '/api/claudium/native/quote') {
    const body = (await readBody(req).catch(() => ({}))) as Record<string, unknown>;
    const rail: ClaudiumNativeRail | null = parseNativeRail(body.rail);
    const claudium = typeof body.claudium === 'number' ? body.claudium : Number.NaN;
    const fulfillment = parseFulfillment(body.fulfillment, account);
    if (!rail || !Number.isFinite(claudium) || claudium <= 0 || !fulfillment) {
      return json(res, 200, {
        reference: null,
        rail: null,
        claudium: null,
        amountBase: null,
        destination: null,
        mint: null,
        memo: null,
        quoteExpiryMs: null,
        split: null,
        discount: null,
        reason: 'invalid_request',
      });
    }
    return json(res, 200, await claudiumNativeQuote({ rail, claudium, fulfillment }));
  }
  if (req.method === 'POST' && path === '/api/claudium/native/confirm') {
    const body = (await readBody(req).catch(() => ({}))) as Record<string, unknown>;
    const reference = typeof body.reference === 'string' ? body.reference : '';
    const signature = typeof body.signature === 'string' ? body.signature : '';
    if (reference === '' || signature === '') {
      return json(res, 200, {
        settled: false,
        reason: 'invalid_request',
        observedAmountBase: null,
        fulfillment: null,
      });
    }
    return json(res, 200, await claudiumNativeConfirm({ reference, signature }));
  }
  if (req.method === 'POST' && path === '/api/claudium/giftcard/redeem') {
    const body = (await readBody(req).catch(() => ({}))) as Record<string, unknown>;
    const code = typeof body.code === 'string' ? body.code : '';
    if (code === '') {
      return json(res, 200, {
        credited: false,
        balance: null,
        denominationClaudium: null,
        reason: 'invalid_request',
      });
    }
    // The redeemed balance always credits the authenticated caller's account.
    return json(res, 200, await claudiumGiftCardRedeem({ code, accountId: account }));
  }
  if (req.method === 'GET' && path === '/api/claudium/giftcard/status') {
    const code = url.searchParams.get('code') ?? '';
    if (code === '') {
      return json(res, 200, { status: 'not_found', denominationClaudium: null });
    }
    return json(res, 200, await claudiumGiftCardStatus(code));
  }
  // An in-family unknown subpath / method (the account is already resolved).
  return json(res, 404, { error: 'unknown endpoint' });
}

/** A player route: the guard resolved the account; the shared core dispatches. */
function claudiumHandler(ctx: Ctx): Promise<void> {
  return handleClaudiumApi(ctx.req, ctx.res, ctxAccountId(ctx));
}

export const routes: RouteDef[] = [
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
    method: 'GET',
    path: '/api/claudium/supply/history',
    surface: 'api',
    middleware: [activeGuard],
    handler: claudiumHandler,
  },
  {
    method: 'GET',
    path: '/api/claudium/supply',
    surface: 'api',
    middleware: [activeGuard],
    handler: claudiumHandler,
  },
  {
    method: 'POST',
    path: '/api/claudium/purchase',
    surface: 'api',
    middleware: [activeGuard],
    handler: claudiumHandler,
  },
  {
    method: 'POST',
    path: '/api/claudium/purchase/woc/confirm',
    surface: 'api',
    middleware: [activeGuard],
    handler: claudiumHandler,
  },
  {
    method: 'POST',
    path: '/api/claudium/spend',
    surface: 'api',
    middleware: [activeGuard],
    handler: claudiumHandler,
  },
  {
    method: 'POST',
    path: '/api/claudium/native/quote',
    surface: 'api',
    middleware: [activeGuard],
    handler: claudiumHandler,
  },
  {
    method: 'POST',
    path: '/api/claudium/native/confirm',
    surface: 'api',
    middleware: [activeGuard],
    handler: claudiumHandler,
  },
  {
    method: 'POST',
    path: '/api/claudium/giftcard/redeem',
    surface: 'api',
    middleware: [activeGuard],
    handler: claudiumHandler,
  },
  {
    method: 'GET',
    path: '/api/claudium/giftcard/status',
    surface: 'api',
    middleware: [activeGuard],
    handler: claudiumHandler,
  },
];
