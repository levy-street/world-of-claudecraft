// The wallet step-up FLOW (B6/R1), extracted from the service coordinator
// (the monolith ratchet's rule: growth pays with extraction; this was the
// ratchet row's named candidate). The proof verdict and the challenge issuer
// are host-agnostic walks over the injected context: the coordinator keeps
// only its own guards (enabled/suspended, wallet resolution) and the refusal
// wrapping, so a Vitest drives these directly without a service.
//
// Contract notes carried with the move:
// - The proof screen SHAPE-checks before the store sees attacker-controlled
//   strings (a decided refusal, no query); the nonce shape is the issuer's
//   own hex form and the signature cap holds a base58 ed25519 signature and
//   the dev form.
// - The directed arm takes ONLY the offer id and derives item and price from
//   the authoritative offer row (seller-scoped, anti-enumeration not_found
//   for anyone else), so the wallet always shows the figures the deal
//   actually carries.
// - Functions RETURN refusal REASONS (never a Refused object): the reason
//   vocabulary lives with the caller, which keeps this module's imports
//   type-only toward the coordinator (no runtime cycle).

import { ITEMS } from '../src/sim/data';
import type { WocMarketDb, WocMarketRefusal } from './woc_market';
import {
  buildStepUpMessage,
  type NewWocStepUpChallenge,
  newStepUpNonce,
  stepUpBindingDigest,
  verifyStepUpProof,
  WOC_MARKET_STEPUP_TTL_MS,
  type WocStepUpBinding,
  type WocStepUpProof,
} from './woc_market_stepup';

/** The slice of the service's world the flow needs; the coordinator builds
 *  it from its own deps per call. */
export interface WocStepUpFlowCtx {
  db: Pick<
    WocMarketDb,
    | 'consumeStepUpChallenge'
    | 'directedOfferById'
    | 'pruneStepUpChallenges'
    | 'createStepUpChallenge'
  >;
  realm: string;
  /** The dev economy's double-gated switch; production is false. */
  devSig: boolean;
  now(): number;
}

/** Judge a custody move's step-up proof: null = verified, otherwise the
 *  refusal reason. */
export async function stepUpProofRefusal(
  ctx: WocStepUpFlowCtx,
  account: number,
  wallet: string,
  proof: WocStepUpProof | undefined,
  binding: WocStepUpBinding,
): Promise<WocMarketRefusal | null> {
  if (!proof) return 'stepup_required';
  // Shape screens before the store sees attacker-controlled strings: a
  // decided refusal, no query. The nonce shape is the issuer's own hex form;
  // the signature cap comfortably holds a base58 ed25519 signature and the
  // dev form.
  if (!/^[0-9a-f]{32}$/.test(proof.nonce) || proof.signature.length > 256) {
    return 'stepup_challenge_invalid';
  }
  const row = await ctx.db.consumeStepUpChallenge(ctx.realm, proof.nonce, account);
  const verdict = verifyStepUpProof({
    row,
    proof,
    expectedDigest: stepUpBindingDigest(binding),
    accountId: account,
    currentWallet: wallet,
    nowMs: ctx.now(),
    devSig: ctx.devSig,
  });
  return verdict.ok ? null : verdict.reason;
}

/** Issue a step-up challenge for one intended custody move; the caller has
 *  already gated market health, suspension, and wallet linkage. */
export async function issueStepUpChallengeFlow(
  ctx: WocStepUpFlowCtx,
  account: number,
  wallet: string,
  request:
    | Extract<WocStepUpBinding, { operation: 'create_listing' }>
    | { operation: 'accept_directed_offer'; offerId: number },
): Promise<
  | {
      ok: true;
      challenge: {
        nonce: string;
        message: string;
        expiresAtMs: number;
        signatureRequired: boolean;
      };
    }
  | { ok: false; reason: WocMarketRefusal }
> {
  let binding: WocStepUpBinding;
  if (request.operation === 'accept_directed_offer') {
    const offer = await ctx.db.directedOfferById(ctx.realm, request.offerId);
    // Only the SELLER's acceptance needs a proof, so only the seller can
    // mint one; not_found for everyone else, the directed convention.
    if (!offer || offer.sellerAccount !== account) return { ok: false, reason: 'not_found' };
    if (offer.status !== 'pending') return { ok: false, reason: 'not_pending' };
    if (offer.expiresAtMs <= ctx.now()) return { ok: false, reason: 'offer_expired' };
    // A legacy pre-pin offer with no item names nothing to sign for, and its
    // acceptance would refuse item_mismatch on the null pin anyway; refuse
    // rather than mint a blank "Item: " authorization.
    if (!offer.itemId) return { ok: false, reason: 'not_found' };
    binding = {
      operation: 'accept_directed_offer',
      offerId: request.offerId,
      itemId: offer.itemId,
      usdCents: offer.usdCents,
    };
  } else {
    // The item must be real BEFORE the wallet is asked to sign for it: a
    // free-text id (a newline forging a line in the popup, or a nonexistent
    // id createListing would refuse) never mints a challenge.
    if (!Object.hasOwn(ITEMS, request.itemId)) return { ok: false, reason: 'unknown_item' };
    binding = request;
  }
  // Issue-time prune: what bounds the table (plus the rate limiter).
  await ctx.db.pruneStepUpChallenges(ctx.realm, ctx.now());
  const nonce = newStepUpNonce();
  const expiresAtMs = ctx.now() + WOC_MARKET_STEPUP_TTL_MS;
  const message = buildStepUpMessage({
    binding,
    accountId: account,
    wallet,
    realm: ctx.realm,
    nonce,
    expiresAtIso: new Date(expiresAtMs).toISOString(),
  });
  const row: NewWocStepUpChallenge = {
    nonce,
    realm: ctx.realm,
    accountId: account,
    wallet,
    operation: binding.operation,
    bindingDigest: stepUpBindingDigest(binding),
    message,
    expiresAtMs,
  };
  await ctx.db.createStepUpChallenge(row);
  return {
    ok: true,
    challenge: { nonce, message, expiresAtMs, signatureRequired: !ctx.devSig },
  };
}
