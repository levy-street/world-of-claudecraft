// Wallet-signature step-up for the $WOC Exchange's custody-moving operations
// (B6/R1): createListing and the seller side of acceptDirectedOffer require a
// fresh server-issued challenge signed by the account's LINKED wallet.
//
// SCOPE OF THE GUARANTEE (be honest about it): this raises the bar and makes a
// custody move loud and attributable (it demands a live wallet signature, not
// the bearer alone). On its own it was not an absolute "a stolen bearer cannot
// move custody" bar, because relinking the account's wallet
// (POST /api/wallet/link) needed only the INCOMING wallet's signature: a bearer
// thief could relink to their own wallet FIRST, then sign every challenge. That
// relink-first hole is now closed by the R11 wallet-link re-auth gate
// (server/wallet_reauth.ts): CHANGING an existing link demands the CURRENT
// wallet's co-signature or the account password plus its second factor, and
// REMOVING it demands the password arm (a link challenge cannot be
// action-scoped to a removal, so no signature arm is offered there), with a
// wallet-changed email as the compensating alert. This module's live
// re-read still closes the issue-to-use window (a relink between issuance and
// use refuses). History: docs/woc-marketplace-hardening/state.md (R11).
//
// Protocol shape (the wallet_link_challenges rules, tightened):
// - The server builds and stores the FULL signed message; the client can never
//   choose what gets signed, and the wallet popup shows the player exactly
//   which action and which money figures they are authorizing.
// - Single-use: consuming a challenge deletes its row atomically (DELETE ...
//   RETURNING under the nonce primary key), so two operations racing one
//   challenge resolve to exactly one verification; a failed verification has
//   still consumed it, which keeps a challenge from ever serving as a retry
//   oracle for probing bindings.
// - Bound, not bearer-shaped: the challenge stores a digest over the operation
//   and EVERY money figure the wallet showed (item, format, start, reserve,
//   buy-now, duration; offer id and agreed price on the directed arm), so a
//   signature can never replay onto a different action, item, or price.
// - Expiry is judged from the consumed row rather than inside the SQL WHERE
//   (a deliberate deviation from consumeWalletChallenge): an expired challenge
//   answers its own honest refusal instead of reading as unknown.
// - The verifier checks the CURRENT linked wallet against the one the
//   challenge was issued to, so an unlink-relink between issue and use
//   refuses (the same live re-read rule the directed rail's wallet twins use).
//
// This module is deliberately a sibling of server/woc_market.ts (the
// coordinator must not grow) and holds no SQL: the store lives behind the
// WocMarketDb seam so the service tests run on the in-memory fake and the pg
// suite proves the real predicates.

import { createHash, randomBytes } from 'node:crypto';
import { itemCopyPin } from '../src/sim/item_copy_ref';
import type { ItemInstancePayload } from '../src/sim/types';
import { verifySolanaSignature } from './wallet_link';

/** Challenge lifetime. Five minutes: the flow is immediate (the wallet popup
 *  is already open), shorter-lived than the ten-minute link challenge because
 *  a custody authorization should not outlive the player's attention. */
export const WOC_MARKET_STEPUP_TTL_MS = 5 * 60 * 1000;

export type WocStepUpOperation = 'create_listing' | 'accept_directed_offer';

/** What a challenge authorizes: the operation plus every figure the wallet
 *  showed. The digest over this is the ONE binding judge; the row's operation
 *  column is observability only and deliberately not a second comparator. */
export type WocStepUpBinding =
  | {
      operation: 'create_listing';
      itemId: string;
      /** The exact copy the player is listing, as they claimed it. Bound so a
       *  signature for a junk roll cannot escrow the best-rolled copy of the
       *  same id (a compromised-client copy swap); null for a plain stack. */
      expectInstance: ItemInstancePayload | null;
      format: string;
      startCents: number;
      reserveCents: number | null;
      buyNowCents: number | null;
      durationHours: number;
      /** The second-chance-to-the-next-bidder routing: it decides where the
       *  item goes on a settlement failure, so it is bound too. */
      offerNext: boolean;
    }
  | {
      operation: 'accept_directed_offer';
      offerId: number;
      itemId: string;
      usdCents: number;
    };

export type WocStepUpProof = { nonce: string; signature: string };

export interface WocStepUpChallengeRow {
  nonce: string;
  accountId: number;
  wallet: string;
  operation: WocStepUpOperation;
  bindingDigest: string;
  message: string;
  expiresAtMs: number;
}

/** The insert shape: the row plus the realm the store scopes every read by. */
export interface NewWocStepUpChallenge extends WocStepUpChallengeRow {
  realm: string;
}

/** The step-up refusal vocabulary. stepup_required is the bearer-only arm
 *  (no proof supplied at all); the rest come out of verifyStepUpProof. */
export type WocStepUpRefusal =
  | 'stepup_required'
  | 'stepup_challenge_invalid'
  | 'stepup_challenge_expired'
  | 'stepup_wallet_mismatch'
  | 'stepup_binding_mismatch'
  | 'stepup_signature_invalid';

/** 16 random bytes hex, the issueWalletChallenge convention. */
export function newStepUpNonce(): string {
  return randomBytes(16).toString('hex');
}

/**
 * The canonical binding digest. Field order is FIXED and versioned by the
 * leading tag; a null money figure serializes as '-' so absent and zero can
 * never collide. Every member is load-bearing: dropping one from this string
 * reopens a replay lane onto a different value of that member.
 */
export function stepUpBindingDigest(binding: WocStepUpBinding): string {
  const parts =
    binding.operation === 'create_listing'
      ? [
          'v1',
          binding.operation,
          // The copy identity (id + instance payload), not just the id, so a
          // different roll of the same id moves the digest. itemCopyPin also
          // covers craftedRecipeId, but the public listing arm does not carry
          // it (only the directed rail does), so its `c` slot is null here;
          // extraction's itemInstancePayloadsEqual likewise ignores it, so the
          // binding and the extraction agree on exactly the id + instance.
          itemCopyPin({
            itemId: binding.itemId,
            count: 1,
            ...(binding.expectInstance === null ? {} : { instance: binding.expectInstance }),
          }),
          binding.format,
          String(binding.startCents),
          binding.reserveCents === null ? '-' : String(binding.reserveCents),
          binding.buyNowCents === null ? '-' : String(binding.buyNowCents),
          String(binding.durationHours),
          binding.offerNext ? '1' : '0',
        ]
      : [
          'v1',
          binding.operation,
          String(binding.offerId),
          binding.itemId,
          String(binding.usdCents),
        ];
  return createHash('sha256').update(parts.join('|')).digest('hex');
}

/** One line of the signed message, hardened against forgery: the instance
 *  fields are client-supplied free text (a crafted item's signer name, a
 *  claimed quality), so any control character (a newline forging a fake
 *  terminator or a second action block) is stripped and the whole descriptor
 *  is length-capped before it can reach the wallet popup. The binding digest
 *  covers the REAL fields regardless; this is purely the human-readable line. */
function safeMessagePiece(raw: string): string {
  // Guard, do NOT coerce: the route's optionalInstance is a size-capped
  // UNCHECKED cast (server/woc_market_routes.ts), so a client can send a
  // non-string in a descriptor slot. String() itself throws on an object whose
  // toString and valueOf are both non-callable ({toString:1}), which would 500
  // the challenge issue; a non-string descriptor has no human-readable value
  // anyway (the digest binds the REAL field), so it collapses to empty here.
  const text = typeof raw === 'string' ? raw : '';
  // Drop control chars by code point (no control-char regex, so biome's
  // noControlCharactersInRegex stays quiet): C0 and DEL are the newline-forge
  // vector, and C1 (0x80 to 0x9f, e.g. NEL) can read as a line break in some
  // wallet renderers. Then strip Unicode format chars (Cf: bidi overrides and
  // isolates, zero-width joiners) that would misrender the copy line, and lone
  // surrogates (Cs) that node-pg would mangle to U+FFFD and desync the stored
  // message from the signed one. Collapse whitespace, then cap by CODE POINT so
  // an astral pair is never split into a broken surrogate at the boundary.
  const cleaned = Array.from(text)
    .filter((ch) => {
      const code = ch.codePointAt(0) ?? 0;
      return code >= 0x20 && code !== 0x7f && !(code >= 0x80 && code <= 0x9f);
    })
    .join('')
    .replace(/[\p{Cf}\p{Cs}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(cleaned).slice(0, 48).join('');
}

/** A short human descriptor of the copy for the signed message: the rolled
 *  quality/masterwork, enchant, and provenance a player recognizes, so
 *  "list <id>" names WHICH copy leaves the bags. Empty when the copy carries
 *  no distinguishing payload. Every interpolated field is sanitized. */
function copyDescriptor(instance: ItemInstancePayload | null): string {
  if (!instance) return '';
  const bits: string[] = [];
  // Prefer the live differentiators (masterwork/enchant/provenance) over the
  // legacy quality string, but name whatever the copy actually carries so a
  // modern masterwork copy is never a blank Copy line.
  if (instance.rolled?.masterwork) bits.push('masterwork');
  else if (instance.rolled?.quality) bits.push(safeMessagePiece(instance.rolled.quality));
  if (instance.enchant) bits.push('enchanted');
  if (instance.rift) bits.push('rift-forged');
  if (instance.signer) bits.push(`crafted by ${safeMessagePiece(instance.signer)}`);
  if (bits.length === 0 && (instance.rolled?.stats || instance.charges)) bits.push('customized');
  return bits.join(', ');
}

const usd = (cents: number): string => `$${(cents / 100).toFixed(2)}`;

/**
 * The exact human-readable text the wallet is asked to sign. English by
 * protocol: the signature binds these bytes, so localizing them would fork
 * verification (the buildLinkMessage precedent). The first line is the domain
 * separator: it shares no prefix with the wallet-link message, so a step-up
 * signature can never verify as a link proof or the reverse.
 */
export function buildStepUpMessage(opts: {
  binding: WocStepUpBinding;
  accountId: number;
  wallet: string;
  realm: string;
  nonce: string;
  expiresAtIso: string;
}): string {
  const b = opts.binding;
  const action =
    b.operation === 'create_listing'
      ? [
          `Action: list ${b.itemId} on the $WOC Exchange`,
          ...(copyDescriptor(b.expectInstance) === ''
            ? []
            : [`Copy: ${copyDescriptor(b.expectInstance)}`]),
          `Format: ${b.format}`,
          `Starting price: ${usd(b.startCents)}`,
          `Reserve: ${b.reserveCents === null ? 'none' : usd(b.reserveCents)}`,
          `Buy now: ${b.buyNowCents === null ? 'none' : usd(b.buyNowCents)}`,
          `Duration: ${b.durationHours}h`,
          `Second chance to next bidder: ${b.offerNext ? 'yes' : 'no'}`,
        ]
      : [
          `Action: accept directed offer #${b.offerId} on the $WOC Exchange`,
          `Item: ${b.itemId}`,
          `Agreed price: ${usd(b.usdCents)}`,
        ];
  return [
    'World of ClaudeCraft $WOC Exchange: authorize moving an item into escrow.',
    '',
    ...action,
    '',
    `Account: #${opts.accountId}`,
    `Realm: ${opts.realm}`,
    `Wallet: ${opts.wallet}`,
    `Nonce: ${opts.nonce}`,
    `Expires At: ${opts.expiresAtIso}`,
    '',
    'Signing is free and authorizes ONLY the action above, once.',
  ].join('\n');
}

/**
 * Judge a consumed challenge against the operation actually being performed.
 *
 * The caller has already consumed the row (or got null); consumption on a
 * refused proof is deliberate, see the header. Refusal order is fixed and
 * affects only WHICH honest reason the player sees; every check must pass.
 * The dev arm accepts `devsig:<nonce>` ONLY when devSig is true, which the
 * caller wires from the same double-gated switch that selects the dev economy
 * (ALLOW_DEV_COMMANDS and WOC_MARKET_DEV_SERVICE both set); in production the
 * string falls through to ed25519 verification and refuses.
 */
export function verifyStepUpProof(args: {
  row: WocStepUpChallengeRow | null;
  proof: WocStepUpProof;
  expectedDigest: string;
  accountId: number;
  currentWallet: string | null;
  nowMs: number;
  devSig: boolean;
}): { ok: true } | { ok: false; reason: Exclude<WocStepUpRefusal, 'stepup_required'> } {
  const { row } = args;
  // Unknown, already consumed (replay), or another account's nonce: one
  // constant answer, so existence never leaks across accounts.
  if (row === null || row.accountId !== args.accountId) {
    return { ok: false, reason: 'stepup_challenge_invalid' };
  }
  if (args.nowMs >= row.expiresAtMs) return { ok: false, reason: 'stepup_challenge_expired' };
  // The CURRENT linked wallet must still be the one the challenge named: a
  // relink between issue and use invalidates the authorization.
  if (args.currentWallet === null || row.wallet !== args.currentWallet) {
    return { ok: false, reason: 'stepup_wallet_mismatch' };
  }
  if (row.bindingDigest !== args.expectedDigest) {
    return { ok: false, reason: 'stepup_binding_mismatch' };
  }
  if (args.devSig && args.proof.signature === `devsig:${row.nonce}`) return { ok: true };
  if (!verifySolanaSignature(row.message, args.proof.signature, row.wallet)) {
    return { ok: false, reason: 'stepup_signature_invalid' };
  }
  return { ok: true };
}
