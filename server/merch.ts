// Game-server REST routes for the merch store (Printful dropship, homepage).
//
// The browser hits these same-origin /api/merch/* routes on the GAME server; each
// authed route resolves the caller's account from the bearer token (activeGuard),
// then proxies to the external economy service through server/merch_proxy.ts,
// which fails closed (typed unavailable results, never throws) when the store is
// off or the service is unreachable. This module therefore stays a thin
// authenticated pass-through: it computes NO price/total/verification, it only
// forwards. The shipping address in a checkout body passes through ONCE and is
// never stored or logged game-side.
//
// One shared dispatch core, handleMerchApi(req, res, accountId), is called by
// BOTH the migrated RouteDef handlers (registered in server/http/registry.ts) and
// the legacy handleApi prefix arm in server/main.ts (startsWith('/api/merch')),
// mirroring the claudium twin. The dual-edit invariant keeps them in lockstep
// until the legacy ladder is removed.

import type * as http from 'node:http';
import { accountAndScopeForToken, moderationStatusForAccount } from './db';
import { ctxAccountId } from './http/context';
import { type BearerActiveGuardDb, createActiveGuard } from './http/middleware/bearer_active_guard';
import {
  MERCH_CHECKOUT_POLICY,
  MERCH_CHECKOUT_PRE_AUTH_POLICY,
  MERCH_CONFIRM_POLICY,
  MERCH_CONFIRM_PRE_AUTH_POLICY,
  MERCH_PRODUCTS_POLICY,
  rateLimit,
} from './http/middleware/rate_limit';
import type { Ctx, RateLimitOutcome, RouteDef } from './http/types';
import { json, readBinaryBody, readBody } from './http_util';
import {
  type MerchCartItem,
  type MerchRail,
  type MerchShipping,
  merchCheckout,
  merchNativeConfirm,
  merchOrders,
  merchPrintfulWebhook,
  merchProducts,
  merchStripeWebhook,
} from './merch_proxy';
import {
  type MerchMutationAction,
  merchMutationRateLimited,
  merchPreAuthRateLimited as merchPreAuthIpRateLimited,
} from './ratelimit';

const WEBHOOK_MAX_BYTES = 1024 * 1024;
const MAX_CART_ITEMS = 50;
const MAX_ITEM_QTY = 99;

function makeRealMerchDb() {
  return { accountAndScopeForToken, moderationStatusForAccount };
}
type MerchGuardDb = ReturnType<typeof makeRealMerchDb>;
let realMerchDb: MerchGuardDb | undefined;
let merchDbOverride: MerchGuardDb | undefined;
function merchGuardDb(): BearerActiveGuardDb {
  if (merchDbOverride) return merchDbOverride;
  realMerchDb ??= makeRealMerchDb();
  return realMerchDb;
}

/** Override the guard db with a fake (test-only; merges over the real reads). */
export function setMerchDbForTests(overrides: Partial<MerchGuardDb>): void {
  realMerchDb ??= makeRealMerchDb();
  merchDbOverride = { ...realMerchDb, ...overrides };
}

/** Restore the real guard db after a setMerchDbForTests override (test-only). */
export function resetMerchDbForTests(): void {
  merchDbOverride = undefined;
}

/** Full active-session gate (mirrors the claudium/daily-rewards prefix arms). */
const activeGuard = createActiveGuard(() => merchGuardDb());

function parseRail(value: unknown): MerchRail | null {
  return value === 'stripe' || value === 'sol' || value === 'claudium' ? value : null;
}

function parseItems(value: unknown): MerchCartItem[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_CART_ITEMS) return null;
  const items: MerchCartItem[] = [];
  for (const raw of value) {
    const variantId = (raw as { variantId?: unknown })?.variantId;
    const qty = (raw as { qty?: unknown })?.qty;
    if (typeof variantId !== 'string' || variantId === '') return null;
    if (typeof qty !== 'number' || !Number.isInteger(qty) || qty <= 0 || qty > MAX_ITEM_QTY) {
      return null;
    }
    items.push({ variantId, qty });
  }
  return items;
}

/**
 * Shape-check the shipping block only (present, string fields, required ones
 * non-empty). Real address validation is the service's job; this never logs or
 * stores what it parses.
 */
function parseShipping(value: unknown): MerchShipping | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  const field = (key: string): string | null => {
    const raw = v[key];
    if (raw === undefined) return '';
    return typeof raw === 'string' ? raw : null;
  };
  const name = field('name');
  const address1 = field('address1');
  const address2 = field('address2');
  const city = field('city');
  const state = field('state');
  const zip = field('zip');
  const country = field('country');
  if (
    name === null ||
    address1 === null ||
    address2 === null ||
    city === null ||
    state === null ||
    zip === null ||
    country === null
  ) {
    return null;
  }
  if (name === '' || address1 === '' || city === '' || zip === '' || country === '') return null;
  return { name, address1, address2, city, state, zip, country };
}

function merchMutationAction(req: http.IncomingMessage): MerchMutationAction | null {
  if (req.method !== 'POST') return null;
  const path = new URL(req.url ?? '/', 'http://localhost').pathname;
  if (path === '/api/merch/checkout') return 'checkout';
  if (path === '/api/merch/checkout/native/confirm') return 'confirm';
  return null;
}

/** Legacy-dispatch pre-auth guard, shared with the registered route policies. */
export function merchPreAuthMutationRateLimited(
  req: http.IncomingMessage,
): RateLimitOutcome | null {
  const action = merchMutationAction(req);
  return action ? merchPreAuthIpRateLimited(req, action) : null;
}

export async function handleMerchStripeWebhook(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const signature = String(req.headers['stripe-signature'] ?? '');
  const rawBody = await readBinaryBody(req, WEBHOOK_MAX_BYTES);
  const result = await merchStripeWebhook(rawBody, signature);
  return json(res, result.received ? 200 : 400, result);
}

export async function handleMerchPrintfulWebhook(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const signature = String(req.headers['x-pf-webhook-signature'] ?? '');
  const rawBody = await readBinaryBody(req, WEBHOOK_MAX_BYTES);
  const result = await merchPrintfulWebhook(rawBody, signature);
  return json(res, result.received ? 200 : 400, result);
}

/** The public catalog read (no account: the tab reveal probes this logged-out). */
export async function handleMerchProducts(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  return json(res, 200, await merchProducts());
}

const INVALID_CHECKOUT = {
  ok: false,
  orderId: null,
  rail: null,
  totalUsd: null,
  totalClaudium: null,
  stripe: null,
  native: null,
  paid: false,
  balance: null,
  reason: 'invalid_request',
};

/**
 * The one dispatch core the RouteDef handlers and the legacy prefix arm share. It
 * matches by method + pathname, forwards to the proxy (which fails closed), and
 * writes the JSON result. It never throws: an invalid request resolves to a typed
 * unavailable/invalid body, so the site stays up with the store off.
 */
export async function handleMerchApi(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
  options: { rateLimitApplied?: boolean } = {},
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const path = url.pathname;
  const account = String(accountId);

  const mutationAction = merchMutationAction(req);
  // The registered routes use the two-tier middleware. The retained legacy
  // dispatcher reaches this same core directly, so preserve rollback protection
  // with the identical tier-1 fused limiter instead of leaving that arm unlimited.
  if (mutationAction && !options.rateLimitApplied) {
    const outcome = merchMutationRateLimited(req, accountId, mutationAction);
    if (!outcome.allowed) return json(res, 429, { error: 'rate_limited' });
  }

  if (req.method === 'GET' && path === '/api/merch/orders') {
    return json(res, 200, await merchOrders(account));
  }
  if (req.method === 'POST' && path === '/api/merch/checkout') {
    const body = (await readBody(req).catch(() => ({}))) as Record<string, unknown>;
    const rail = parseRail(body.rail);
    const items = parseItems(body.items);
    const shipping = parseShipping(body.shipping);
    const email = typeof body.email === 'string' ? body.email : '';
    const idempotencyKey = typeof body.idempotencyKey === 'string' ? body.idempotencyKey : '';
    const payer = typeof body.payer === 'string' && body.payer !== '' ? body.payer : undefined;
    if (!rail || !items || !shipping || email === '' || idempotencyKey === '') {
      return json(res, 200, INVALID_CHECKOUT);
    }
    if (rail === 'sol' && !payer) {
      return json(res, 200, INVALID_CHECKOUT);
    }
    return json(
      res,
      200,
      await merchCheckout({
        accountId: account,
        rail,
        items,
        shipping,
        email,
        idempotencyKey,
        payer,
      }),
    );
  }
  if (req.method === 'POST' && path === '/api/merch/checkout/native/confirm') {
    const body = (await readBody(req).catch(() => ({}))) as Record<string, unknown>;
    const reference = typeof body.reference === 'string' ? body.reference : '';
    const signature = typeof body.signature === 'string' ? body.signature : '';
    if (reference === '' || signature === '') {
      return json(res, 200, { settled: false, orderId: null, reason: 'invalid_request' });
    }
    return json(res, 200, await merchNativeConfirm({ reference, signature }));
  }
  // An in-family unknown subpath / method (the account is already resolved).
  return json(res, 404, { error: 'unknown endpoint' });
}

/** A player route: the guard resolved the account; the shared core dispatches. */
function merchHandler(ctx: Ctx): Promise<void> {
  return handleMerchApi(ctx.req, ctx.res, ctxAccountId(ctx), { rateLimitApplied: true });
}

export const routes: RouteDef[] = [
  {
    method: 'POST',
    path: '/api/merch/stripe/webhook',
    surface: 'api',
    meta: { publicRead: true },
    handler: (ctx) => handleMerchStripeWebhook(ctx.req, ctx.res),
  },
  {
    method: 'POST',
    path: '/api/merch/printful/webhook',
    surface: 'api',
    meta: { publicRead: true },
    handler: (ctx) => handleMerchPrintfulWebhook(ctx.req, ctx.res),
  },
  {
    method: 'GET',
    path: '/api/merch/products',
    surface: 'api',
    // The catalog is intentionally public: the homepage probes it logged-out to
    // decide whether to reveal the Store tab, and it exposes no account state.
    // Public but IP rate-limited + TTL-cached, the /api/woc/balance shape.
    meta: { publicRead: true },
    middleware: [rateLimit(MERCH_PRODUCTS_POLICY)],
    handler: (ctx) => handleMerchProducts(ctx.req, ctx.res),
  },
  {
    method: 'POST',
    path: '/api/merch/checkout',
    surface: 'api',
    middleware: [
      rateLimit(MERCH_CHECKOUT_PRE_AUTH_POLICY),
      activeGuard,
      rateLimit(MERCH_CHECKOUT_POLICY),
    ],
    handler: merchHandler,
  },
  {
    method: 'POST',
    path: '/api/merch/checkout/native/confirm',
    surface: 'api',
    middleware: [
      rateLimit(MERCH_CONFIRM_PRE_AUTH_POLICY),
      activeGuard,
      rateLimit(MERCH_CONFIRM_POLICY),
    ],
    handler: merchHandler,
  },
  {
    method: 'GET',
    path: '/api/merch/orders',
    surface: 'api',
    middleware: [activeGuard],
    handler: merchHandler,
  },
];
