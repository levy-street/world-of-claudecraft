// Non-custodial Solana wallet linking.
//
// The chain is the source of truth for wallet ownership; this server only
// *observes* it. To link a wallet to a World of ClaudeCraft account we issue a
// short-lived, single-use challenge message, the player signs it with their
// wallet (Solana = ed25519 over the raw UTF-8 bytes), and we verify the
// signature here. No private keys, seeds, or funds ever touch the server.

import { randomBytes } from 'node:crypto';
import type http from 'node:http';
import {
  accountAndScopeForToken,
  consumeWalletChallenge,
  createWalletChallenge,
  linkWalletToAccount,
  moderationStatusForAccount,
  primarySlugForAccount,
  pruneWalletChallenges,
  referralCountForAccount,
  scopeAllowsMutation,
  unlinkWallet,
  walletForAccount,
} from './db';
import { type DesktopWalletHandoffResult, desktopWalletHandoffs } from './desktop_wallet_handoff';
import { ctxAccountId } from './http/context';
import {
  CARD_UPLOAD_POLICY,
  PUBLIC_READ_POLICY,
  rateLimit,
  WALLET_LINK_POLICY,
  WOC_BALANCE_POLICY,
} from './http/middleware/rate_limit';
import type { Ctx, Middleware, RouteDef } from './http/types';
import { json, moderationErrorBody, readBody } from './http_util';
import { cardUploadContentLengthTooLarge, handleCardUpload } from './player_card';
import { recordUsageMetric } from './provider_usage';
import { requestIp, walletLinkRateLimited } from './ratelimit';
import { buildLinkMessage, isSolanaAddress, verifySolanaSignature } from './wallet_link';
import { handleWocBalance, parseWocBalanceQuery } from './woc_balance';

const CHALLENGE_TTL_MINUTES = 10;

function requestDomain(req: http.IncomingMessage): string {
  const host = (req.headers.host ?? '').split(':')[0];
  return host || 'world-of-claudecraft';
}

// POST /api/wallet/link/challenge  { address }  → { nonce, message }
export async function handleWalletChallenge(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  recordUsageMetric('wallet.challenge.request');
  if (!walletLinkRateLimited(req, accountId).allowed) {
    recordUsageMetric('wallet.challenge.rate_limited');
    return json(res, 429, { error: 'rate limited' });
  }
  return walletChallengeCore(req, res, accountId);
}

// The challenge body-read + validation + issuance, WITHOUT the rate-limit gate.
// The legacy handler above keeps its own walletLinkRateLimited check (unchanged
// prose 429); the RouteDef instead gates with rateLimit(WALLET_LINK_POLICY)
// as middleware (a coded 429) and then calls this core, so the ip+account bucket is
// recorded exactly once per request on either path (each walletLinkRateLimited call
// consumes a token, so the two must never both run).
async function walletChallengeCore(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  const body = await readBody(req);
  const address = typeof body.address === 'string' ? body.address.trim() : '';
  if (!isSolanaAddress(address)) return json(res, 400, { error: 'invalid Solana wallet address' });

  return json(res, 200, await issueWalletChallenge(req, accountId, address));
}

async function issueWalletChallenge(
  req: http.IncomingMessage,
  accountId: number,
  address: string,
): Promise<{ nonce: string; message: string }> {
  await pruneWalletChallenges();
  const nonce = randomBytes(16).toString('hex');
  const issuedAt = new Date().toISOString();
  const message = buildLinkMessage({
    domain: requestDomain(req),
    accountId,
    address,
    nonce,
    issuedAt,
  });
  await createWalletChallenge(nonce, accountId, address, message, CHALLENGE_TTL_MINUTES);
  return { nonce, message };
}

function handoffFailure(res: http.ServerResponse, error: unknown): void {
  const message = error instanceof Error ? error.message : 'wallet authorization failed';
  json(res, 400, { error: message, code: 'wallet.handoff_invalid' });
}

/** Create one browser-authorized wallet operation for the authenticated desktop account. */
export async function handleDesktopWalletHandoffCreate(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  const body = await readBody(req);
  try {
    if (body.kind === 'link') {
      return json(
        res,
        200,
        desktopWalletHandoffs.create(accountId, requestIp(req), { kind: 'link' }),
      );
    }
    const expectedAddress =
      typeof body.expectedAddress === 'string' ? body.expectedAddress.trim() : '';
    const reference = typeof body.reference === 'string' ? body.reference.trim() : '';
    if (
      body.kind !== 'transaction' ||
      !isSolanaAddress(expectedAddress) ||
      !reference ||
      reference.length > 256
    ) {
      return json(res, 400, {
        error: 'invalid desktop wallet operation',
        code: 'wallet.handoff_invalid',
      });
    }
    const linkedWallet = await walletForAccount(accountId);
    if (!linkedWallet || linkedWallet.pubkey !== expectedAddress) {
      return json(res, 400, {
        error: 'transaction wallet does not match the linked account wallet',
        code: 'wallet.handoff_invalid',
      });
    }
    return json(
      res,
      200,
      desktopWalletHandoffs.createTransaction(accountId, requestIp(req), {
        reference,
        expectedAddress,
      }),
    );
  } catch (error) {
    return handoffFailure(res, error);
  }
}

/** Reveal the single operation to the browser holding its fragment-only secret. */
export async function handleDesktopWalletHandoffClaim(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await readBody(req);
  try {
    const action = desktopWalletHandoffs.claim(body.code, requestIp(req));
    if (action.kind === 'transaction') return json(res, 200, action);
    const address = typeof body.address === 'string' ? body.address.trim() : '';
    if (!address) return json(res, 200, { kind: 'link' });
    if (!isSolanaAddress(address)) {
      return json(res, 400, {
        error: 'invalid Solana wallet address',
        code: 'wallet.handoff_invalid',
      });
    }
    const challenge = await desktopWalletHandoffs.claimLink(
      body.code,
      requestIp(req),
      address,
      (accountId, claimedAddress) => issueWalletChallenge(req, accountId, claimedAddress),
    );
    return json(res, 200, challenge);
  } catch (error) {
    return handoffFailure(res, error);
  }
}

/** Store a browser signature until the authenticated desktop app consumes it. */
export async function handleDesktopWalletHandoffComplete(
  req: http.IncomingMessage,
  res: http.ServerResponse,
): Promise<void> {
  const body = await readBody(req);
  const address = typeof body.address === 'string' ? body.address.trim() : '';
  const signature = typeof body.signature === 'string' ? body.signature.trim() : '';
  const nonce = typeof body.nonce === 'string' ? body.nonce.trim() : '';
  if (!isSolanaAddress(address) || !signature || (body.kind === 'link' && !nonce)) {
    return json(res, 400, {
      error: 'invalid wallet authorization result',
      code: 'wallet.handoff_invalid',
    });
  }
  let result: DesktopWalletHandoffResult;
  if (body.kind === 'link') result = { kind: 'link', address, signature, nonce };
  else if (body.kind === 'transaction') result = { kind: 'transaction', address, signature };
  else {
    return json(res, 400, {
      error: 'invalid wallet authorization result',
      code: 'wallet.handoff_invalid',
    });
  }
  try {
    desktopWalletHandoffs.complete(body.code, requestIp(req), result);
    return json(res, 200, { completed: true });
  } catch (error) {
    return handoffFailure(res, error);
  }
}

/** Poll and consume the result from the same authenticated account that created it. */
export async function handleDesktopWalletHandoffResult(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  const body = await readBody(req);
  return json(res, 200, desktopWalletHandoffs.result(accountId, body.code));
}

// POST /api/wallet/link  { address, signature, nonce }  → { pubkey, linked }
export async function handleWalletLink(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  recordUsageMetric('wallet.link.request');
  if (!walletLinkRateLimited(req, accountId).allowed) {
    recordUsageMetric('wallet.link.rate_limited');
    return json(res, 429, { error: 'rate limited' });
  }
  return walletLinkCore(req, res, accountId);
}

// The link verification, WITHOUT the rate-limit gate (see walletChallengeCore for
// the split rationale: the legacy handler self-limits with a prose 429, the
// RouteDef limits via rateLimit(WALLET_LINK_POLICY) middleware with a coded 429).
async function walletLinkCore(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  const body = await readBody(req);
  const address = typeof body.address === 'string' ? body.address.trim() : '';
  const signature = typeof body.signature === 'string' ? body.signature.trim() : '';
  const nonce = typeof body.nonce === 'string' ? body.nonce.trim() : '';
  if (!isSolanaAddress(address) || !signature || !nonce) {
    recordUsageMetric('wallet.link.failure');
    return json(res, 400, { error: 'address, signature, and nonce are required' });
  }

  const challenge = await consumeWalletChallenge(nonce, accountId);
  if (!challenge) {
    recordUsageMetric('wallet.link.failure');
    return json(res, 400, { error: 'challenge expired or already used - request a new one' });
  }
  if (challenge.address !== address) {
    recordUsageMetric('wallet.link.failure');
    return json(res, 400, { error: 'wallet address does not match the challenge' });
  }
  if (!verifySolanaSignature(challenge.message, signature, address)) {
    recordUsageMetric('wallet.link.failure');
    return json(res, 401, { error: 'signature verification failed' });
  }

  const linked = await linkWalletToAccount(accountId, address);
  if (!linked) {
    recordUsageMetric('wallet.link.failure');
    return json(res, 409, { error: 'this wallet is already linked to another account' });
  }
  return json(res, 200, { pubkey: address, linked: true });
}

// GET /api/wallet  → { wallet: { pubkey, linkedAt } | null }
export async function handleWalletGet(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  const row = await walletForAccount(accountId);
  return json(res, 200, { wallet: row ? { pubkey: row.pubkey, linkedAt: row.linked_at } : null });
}

// DELETE /api/wallet/link  → { unlinked: true }
export async function handleWalletUnlink(
  _req: http.IncomingMessage,
  res: http.ServerResponse,
  accountId: number,
): Promise<void> {
  await unlinkWallet(accountId);
  return json(res, 200, { unlinked: true });
}

// ===========================================================================
// Route layer, ported onto RouteDefs.
//
// The wallet / card / referral surface moves off the inline handleApi ladder in
// server/main.ts onto the shared server/http/ pipeline the registry dispatcher
// serves under API_DISPATCH 'new'. It follows the server/account.ts template:
//  - the bearer + moderation gate is a per-route guard middleware (activeGuard)
//    that mirrors the legacy bearerActiveAccount resolver and writes the legacy
//    { error } bodies, NOT the generic requireAccount middleware (which throws a
//    problem+json HttpError and would break the goldens and the prose-matcher).
//    /api/woc/balance is PUBLIC (on-chain balances are public), so it carries no
//    auth guard, exactly like the legacy arm.
//  - the handlers self-read their body (the wallet challenge/link core with
//    readBody, the card handler with readBinaryBody), so NO withBody / withRawBody
//    middleware is composed (either would double-consume the stream). The card
//    pre-auth Content-Length over-cap short-circuit (413 + Connection: close,
//    BEFORE auth and before the body is read) is preserved as a dedicated
//    cardContentLengthGuard mirroring the legacy pre-auth check byte-for-byte;
//    it reuses the existing MAX_CARD_BYTES cap via cardUploadContentLengthTooLarge.
//  - the four previously-raw { error: 'rate limited' } 429s (wallet link
//    challenge, wallet link, woc balance, card) become a coded 429 on the new
//    path: the limiter is a rateLimit(policy) middleware that throws
//    HttpError(429, 'rate_limit.exceeded', { retryAfterSeconds }), serialized as
//    RFC 9457 problem+json by the withErrors error boundary. The legacy arms keep
//    the prose body for the flag-off rollback (the rateLimitedBodyToCode known
//    deviation). The ip+account limiters (WALLET_LINK_POLICY / CARD_UPLOAD_POLICY)
//    are a single fused call recording both the IP and account buckets, so they
//    mount AFTER activeGuard (ctxAccountId is set) and run exactly once per
//    request; the woc limiter (WOC_BALANCE_POLICY) is IP-only and needs no auth.
//  - the card level lookup (game.liveLevelForCharacter) is the one main.ts-local
//    singleton the handlers need; it is INJECTED once at boot via
//    configureWalletRuntime, so `export const routes` stays a static array
//    registry.ts can spread. The db.ts reads the guard uses are bundled behind
//    setWalletDbForTests for unit tests. The legacy handleApi arms stay in
//    main.ts as the flag-off rollback path until the ladder-deletion PR (next release).
// ===========================================================================

// The exact legacy { error } identities the guard + card pre-auth check emit.
// Named constants so they cannot drift from the bearerActiveAccount / card arms
// they mirror. No em dash appears in any (the legacy strings never used one).
const NOT_AUTHENTICATED = { error: 'not authenticated', code: 'auth.required' } as const;
const READ_ONLY_TOKEN = { error: 'this token is read-only', code: 'auth.forbidden' } as const;
const IMAGE_TOO_LARGE = { error: 'image too large' } as const;

// The bearer token shape: a 64-hex secret behind the "Bearer " scheme. Mirrors
// the regex the legacy bearer* resolvers in server/main.ts use.
const BEARER_PATTERN = /^Bearer ([a-f0-9]{64})$/;

// ---------------------------------------------------------------------------
// Runtime injection. registry.ts spreads the static `routes` array at module
// load, before main.ts has booted the GameServer, so the card handler cannot
// close over `game` directly (that would be a cycle: main -> registry -> wallet
// -> main). Instead main.ts injects the live level lookup once at boot via
// configureWalletRuntime; a request never arrives before that runs. It is the
// exact (characterId) => game.liveLevelForCharacter(characterId) the legacy
// /api/card arm passed to handleCardUpload.
// ---------------------------------------------------------------------------

/** The main.ts game-session hook the card handler needs (the live authoritative level). */
export interface WalletGameHooks {
  /** The live Sim level for an online character, or null when it is offline. */
  liveLevelForCharacter(characterId: number): number | null;
}

let runtime: WalletGameHooks | null = null;

/** Inject the main.ts game-session hook the card handler needs (boot). */
export function configureWalletRuntime(rt: WalletGameHooks): void {
  runtime = rt;
}

/** Clear the injected runtime so a unit test can install its own fake. */
export function resetWalletRuntimeForTests(): void {
  runtime = null;
}

/** The injected runtime, or a loud failure if a request somehow beat boot wiring. */
function useRuntime(): WalletGameHooks {
  if (runtime === null) {
    throw new Error('wallet runtime is not configured; call configureWalletRuntime');
  }
  return runtime;
}

// ---------------------------------------------------------------------------
// Db seam. The bearer-resolution reads the guard uses, bundled once behind a
// test-only setter so the guard can be driven with a fake and no Postgres.
// Production never calls the setter, so REAL_WALLET_DB is the only runtime
// binding and it references the exact functions the legacy bearerActiveAccount
// arm calls. scopeAllowsMutation is pure (no DB), so it stays a direct import.
// The wallet / card / referral domain functions keep their own direct db.ts
// imports (driven by the existing pg-mock test harnesses); this seam covers only
// the NEW guard code.
// ---------------------------------------------------------------------------

const REAL_WALLET_DB = { accountAndScopeForToken, moderationStatusForAccount };
let walletDb = REAL_WALLET_DB;

/** Override the wallet db bundle with a fake (test-only; merges over the real reads). */
export function setWalletDbForTests(overrides: Partial<typeof REAL_WALLET_DB>): void {
  walletDb = { ...REAL_WALLET_DB, ...overrides };
}

/** Restore the real wallet db bundle after a setWalletDbForTests override (test-only). */
export function resetWalletDbForTests(): void {
  walletDb = REAL_WALLET_DB;
}

// ---------------------------------------------------------------------------
// Bearer guard. activeGuard mirrors bearerActiveAccount (full-session, read-only
// 403, moderation 403). It writes the legacy { error } bodies and short-circuits
// (no next()) on rejection; a missing/malformed bearer 401s WITHOUT a DB call (so
// the no-auth goldens replay DB-free through both dispatch paths).
// ---------------------------------------------------------------------------

/** The raw 64-hex bearer token, or null (no header or bad shape). */
function bearerToken(req: http.IncomingMessage): string | null {
  const m = BEARER_PATTERN.exec(req.headers.authorization ?? '');
  return m ? m[1] : null;
}

// FOLLOW-UP (rule-of-three, filed in docs/api-pipeline/progress.md): this activeGuard
// (with bearerToken + BEARER_PATTERN + NOT_AUTHENTICATED + READ_ONLY_TOKEN) is now the
// THIRD byte-identical copy of the bearerActiveAccount mirror, alongside
// server/characters.ts and server/account.ts. The clean resolution is a shared
// db-seam-parameterized bearer-guard middleware, but extracting it here would touch two
// already-shipped, byte-parity-pinned surfaces that also carry sibling guards (readGuard,
// logoutGuard), so it belongs in a dedicated packet step (a natural fit alongside the
// ladder-deletion follow-up PR), NOT this small wallet migration. Do NOT add a 4th copy
// on any future surface.
/** Mutating + account-scoped gate (mirrors server/main.ts bearerActiveAccount). */
const activeGuard: Middleware = async (ctx, next) => {
  const token = bearerToken(ctx.req);
  const info = token === null ? null : await walletDb.accountAndScopeForToken(token);
  if (info === null) {
    json(ctx.res, 401, NOT_AUTHENTICATED);
    return;
  }
  if (!scopeAllowsMutation(info.scope)) {
    json(ctx.res, 403, READ_ONLY_TOKEN);
    return;
  }
  const status = await walletDb.moderationStatusForAccount(info.accountId);
  if (status.locked) {
    json(ctx.res, 403, moderationErrorBody(status));
    return;
  }
  ctx.account = { accountId: info.accountId, scope: info.scope };
  await next();
};

/**
 * Card pre-auth Content-Length gate. Mirrors the legacy /api/card arm exactly: it
 * records the publish request, and when the declared Content-Length exceeds the
 * existing MAX_CARD_BYTES cap it short-circuits 413 { error: 'image too large' }
 * with Connection: close (and shouldKeepAlive = false) BEFORE the auth guard and
 * before any body is read, so a huge upload is rejected without a DB lookup and
 * the socket is told to close rather than keep streaming. Uses the existing named
 * cap via cardUploadContentLengthTooLarge (no new literal).
 */
const cardContentLengthGuard: Middleware = async (ctx, next) => {
  recordUsageMetric('card.publish.request');
  if (cardUploadContentLengthTooLarge(ctx.req)) {
    recordUsageMetric('card.publish.rejected');
    ctx.res.shouldKeepAlive = false;
    ctx.res.setHeader('Connection', 'close');
    json(ctx.res, 413, IMAGE_TOO_LARGE);
    return;
  }
  await next();
};

// ---------------------------------------------------------------------------
// Thin Ctx handlers. Each starts after its guard chain has run, resolves the
// account from the Ctx, and delegates to the matching domain function above (or
// the shared card / woc handlers) UNCHANGED, so the response bytes are identical
// to the legacy arm. The wallet challenge/link handlers call the limiter-free
// *Core (the RouteDef's rateLimit middleware owns the throttle on the new path);
// woc/balance is public and parses its query exactly as the legacy arm did.
// ---------------------------------------------------------------------------

/** POST /api/wallet/link/challenge: issue a signing challenge (rate-limited by middleware). */
async function walletChallengeHandler(ctx: Ctx): Promise<void> {
  recordUsageMetric('wallet.challenge.request');
  return walletChallengeCore(ctx.req, ctx.res, ctxAccountId(ctx));
}

/** POST /api/wallet/link: verify a signature and link the wallet (rate-limited by middleware). */
async function walletLinkHandler(ctx: Ctx): Promise<void> {
  recordUsageMetric('wallet.link.request');
  return walletLinkCore(ctx.req, ctx.res, ctxAccountId(ctx));
}

/** DELETE /api/wallet/link: unlink the account's wallet. */
async function walletUnlinkHandler(ctx: Ctx): Promise<void> {
  return handleWalletUnlink(ctx.req, ctx.res, ctxAccountId(ctx));
}

/** GET /api/wallet: the account's linked wallet, or null. */
async function walletGetHandler(ctx: Ctx): Promise<void> {
  return handleWalletGet(ctx.req, ctx.res, ctxAccountId(ctx));
}

async function desktopWalletCreateHandler(ctx: Ctx): Promise<void> {
  return handleDesktopWalletHandoffCreate(ctx.req, ctx.res, ctxAccountId(ctx));
}

async function desktopWalletClaimHandler(ctx: Ctx): Promise<void> {
  return handleDesktopWalletHandoffClaim(ctx.req, ctx.res);
}

async function desktopWalletCompleteHandler(ctx: Ctx): Promise<void> {
  return handleDesktopWalletHandoffComplete(ctx.req, ctx.res);
}

async function desktopWalletResultHandler(ctx: Ctx): Promise<void> {
  return handleDesktopWalletHandoffResult(ctx.req, ctx.res, ctxAccountId(ctx));
}

/** GET /api/woc/balance: the public $WOC balance proxy (IP rate-limited by middleware). */
async function wocBalanceHandler(ctx: Ctx): Promise<void> {
  const { owner, fresh } = parseWocBalanceQuery(ctx.req.url ?? '');
  return handleWocBalance(ctx.res, owner, fresh);
}

/** POST /api/card: publish a shareable player-card PNG (binary body; self-read). */
async function cardHandler(ctx: Ctx): Promise<void> {
  return handleCardUpload(ctx.req, ctx.res, ctxAccountId(ctx), (characterId) =>
    useRuntime().liveLevelForCharacter(characterId),
  );
}

/** GET /api/referrals: the account's referral count + primary card slug. */
async function referralsHandler(ctx: Ctx): Promise<void> {
  const accountId = ctxAccountId(ctx);
  const [count, slug] = await Promise.all([
    referralCountForAccount(accountId),
    primarySlugForAccount(accountId),
  ]);
  return json(ctx.res, 200, { count, slug });
}

// ---------------------------------------------------------------------------
// The route table. registry.ts spreads this into apiRoutes. Under API_DISPATCH
// 'new' the registry dispatcher serves these via the onion; the legacy handleApi
// arms stay in main.ts for the flag-off rollback until the ladder-deletion PR. All routes carry
// [activeGuard] EXCEPT /api/woc/balance (public, IP-limited only). The rate-limit
// middleware sits AFTER activeGuard on the two wallet-link routes + card (the
// fused ip+account limiter needs ctx.account), and is the sole limiter on the
// public woc route; the card route additionally runs cardContentLengthGuard FIRST
// (the pre-auth 413 short-circuit).
// ---------------------------------------------------------------------------

export const routes: RouteDef[] = [
  {
    method: 'POST',
    path: '/api/desktop-wallet/create',
    surface: 'api',
    middleware: [activeGuard, rateLimit(WALLET_LINK_POLICY)],
    handler: desktopWalletCreateHandler,
  },
  {
    method: 'POST',
    path: '/api/desktop-wallet/claim',
    surface: 'api',
    middleware: [rateLimit(PUBLIC_READ_POLICY)],
    handler: desktopWalletClaimHandler,
  },
  {
    method: 'POST',
    path: '/api/desktop-wallet/complete',
    surface: 'api',
    middleware: [rateLimit(PUBLIC_READ_POLICY)],
    handler: desktopWalletCompleteHandler,
  },
  {
    method: 'POST',
    path: '/api/desktop-wallet/result',
    surface: 'api',
    middleware: [activeGuard],
    handler: desktopWalletResultHandler,
  },
  {
    method: 'POST',
    path: '/api/wallet/link/challenge',
    surface: 'api',
    middleware: [activeGuard, rateLimit(WALLET_LINK_POLICY)],
    handler: walletChallengeHandler,
  },
  {
    method: 'POST',
    path: '/api/wallet/link',
    surface: 'api',
    middleware: [activeGuard, rateLimit(WALLET_LINK_POLICY)],
    handler: walletLinkHandler,
  },
  {
    method: 'DELETE',
    path: '/api/wallet/link',
    surface: 'api',
    middleware: [activeGuard],
    handler: walletUnlinkHandler,
  },
  {
    method: 'GET',
    path: '/api/wallet',
    surface: 'api',
    middleware: [activeGuard],
    handler: walletGetHandler,
  },
  {
    method: 'GET',
    path: '/api/woc/balance',
    surface: 'api',
    middleware: [rateLimit(WOC_BALANCE_POLICY)],
    handler: wocBalanceHandler,
  },
  {
    method: 'POST',
    path: '/api/card',
    surface: 'api',
    middleware: [cardContentLengthGuard, activeGuard, rateLimit(CARD_UPLOAD_POLICY)],
    handler: cardHandler,
    // The card upload is the one registered /api route whose request body is raw
    // bytes (image/png), not JSON: the Content-Type 415 gate exempts it via
    // this classification (the response error envelope stays the surface default).
    meta: { requestBody: 'binary' },
  },
  {
    method: 'GET',
    path: '/api/referrals',
    surface: 'api',
    middleware: [activeGuard],
    handler: referralsHandler,
  },
];
