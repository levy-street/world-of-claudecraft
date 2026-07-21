// Pure, host-agnostic view model for the CLAUDIUM gift-card purchase journey.
//
// The pure-core half of the pure-core + thin-consumer split (root CLAUDE.md
// Conventions; reference claudium_view.ts / unit_portrait.ts). The gift flow is a
// small forward-only wizard: pick a denomination, a rail, a recipient (self or other),
// an occasion, an optional scheduled delivery + a delivery method, review the exact
// pay/receive line from the SERVER quote, then confirm and see the issued redeem link
// + QR. This core owns the step machine, the boundary validation (email format only),
// and the projection of a server quote into the review line. It computes NO money: the
// amount, split, and USD equivalent all ride in from the service quote. DOM-free and
// i18n-free so tests/claudium_gift_view.test.ts drives it directly.

import type { ClaudiumNativeRailId } from './claudium_view';
import { claudiumToUsd } from './claudium_view';

/** The five gift-card occasion templates the picker offers (matches the service). */
export type ClaudiumGiftOccasion = 'birthday' | 'holiday' | 'congrats' | 'thankyou' | 'generic';

/** How the buyer wants the issued card delivered once the payment settles. */
export type ClaudiumGiftDelivery = 'email' | 'link' | 'reveal';

/**
 * The gift-card purchase inputs the window collects and hands to the quote hook. All
 * money values (amount, split) come back on the quote; the window computes nothing.
 * recipientEmail is set only for email delivery to another person; toSelf tells the
 * service to issue the card to the buyer's own account.
 */
export interface ClaudiumGiftQuoteInput {
  claudium: number;
  rail: ClaudiumNativeRailId;
  occasion: ClaudiumGiftOccasion;
  delivery: ClaudiumGiftDelivery;
  toSelf: boolean;
  recipientEmail?: string;
  message?: string;
  deliverAtMs?: number;
}

/** The wizard steps, in forward order. review -> pending -> success is terminal. */
export type ClaudiumGiftStep =
  | 'denomination'
  | 'rail'
  | 'recipient'
  | 'occasion'
  | 'delivery'
  | 'review'
  | 'pending'
  | 'success'
  | 'error';

/** The four rails offered for a gift purchase (the same native + card set). */
export type ClaudiumGiftRail = ClaudiumNativeRailId | 'stripe';

/** One denomination rung: the Claudium credited + its USD equivalent from the peg. */
export interface ClaudiumGiftDenomination {
  claudium: number;
  usd: number;
}

/** The five occasion options in fixed display order. */
export const CLAUDIUM_GIFT_OCCASIONS: readonly ClaudiumGiftOccasion[] = [
  'birthday',
  'holiday',
  'congrats',
  'thankyou',
  'generic',
];

/** The three delivery methods in fixed display order. */
export const CLAUDIUM_GIFT_DELIVERIES: readonly ClaudiumGiftDelivery[] = [
  'email',
  'link',
  'reveal',
];

/**
 * The mutable draft the window collects across the steps. Money is never here; only
 * the buyer's selections. deliverAtMs is a wall-clock ms the buyer optionally picks;
 * the service stores it and schedules delivery server-side (the cron is not this UI's
 * concern). recipientEmail is required only for email delivery to another person.
 */
export interface ClaudiumGiftDraft {
  claudium: number | null;
  rail: ClaudiumGiftRail | null;
  toSelf: boolean;
  recipientEmail: string;
  message: string;
  occasion: ClaudiumGiftOccasion;
  delivery: ClaudiumGiftDelivery;
  deliverAtMs: number | null;
}

/** A fresh draft with sane defaults (generic occasion, email delivery, gift to other). */
export function emptyGiftDraft(): ClaudiumGiftDraft {
  return {
    claudium: null,
    rail: null,
    toSelf: false,
    recipientEmail: '',
    message: '',
    occasion: 'generic',
    delivery: 'email',
    deliverAtMs: null,
  };
}

/**
 * A permissive email shape check at the trust boundary ONLY (root CLAUDE.md: validate
 * at system boundaries). Not an RFC parser: one @, a non-empty local part, a dotted
 * domain with a 2+ char TLD, no whitespace. The service is the real authority.
 */
export function isValidGiftEmail(email: string): boolean {
  const e = email.trim();
  if (e.length === 0 || /\s/.test(e)) return false;
  return /^[^@]+@[^@.]+(\.[^@.]+)*\.[^@.]{2,}$/.test(e);
}

/**
 * Whether the recipient step is satisfied: a gift to self needs nothing; a gift to
 * another by email needs a valid email; link/reveal delivery needs no email even for
 * another person (the buyer shares the link themselves).
 */
export function giftRecipientReady(draft: ClaudiumGiftDraft): boolean {
  if (draft.toSelf) return true;
  if (draft.delivery === 'email') return isValidGiftEmail(draft.recipientEmail);
  return true;
}

/** Whether the draft has enough to request a quote (denomination + rail + recipient). */
export function giftDraftReadyToReview(draft: ClaudiumGiftDraft): boolean {
  return (
    draft.claudium !== null &&
    draft.claudium > 0 &&
    draft.rail !== null &&
    giftRecipientReady(draft)
  );
}

/**
 * Build the quote input the window hands to the giftcardQuote hook. Returns null when
 * the draft is not ready (no crypto is quoted for an incomplete draft). Native rails
 * only quote here; the card rail is quoted through the stripe path by the window, so a
 * stripe rail yields null (the window routes it separately). recipientEmail is included
 * only for email delivery to another person; message/deliverAtMs pass through as set.
 */
export function buildGiftQuoteInput(draft: ClaudiumGiftDraft): ClaudiumGiftQuoteInput | null {
  if (!giftDraftReadyToReview(draft)) return null;
  const rail = draft.rail;
  if (rail === null || rail === 'stripe') return null;
  const email =
    !draft.toSelf && draft.delivery === 'email' && isValidGiftEmail(draft.recipientEmail)
      ? draft.recipientEmail.trim()
      : undefined;
  const message = draft.message.trim();
  return {
    claudium: draft.claudium as number,
    rail,
    occasion: draft.occasion,
    delivery: draft.delivery,
    toSelf: draft.toSelf,
    recipientEmail: email,
    message: message === '' ? undefined : message,
    deliverAtMs: draft.deliverAtMs ?? undefined,
  };
}

/**
 * The review line inputs, projected from the SERVER quote (never recomputed here).
 * amountDisplay is the exact rail amount the service quoted (already base-unit-scaled
 * by the caller); claudium + usd are the amount received and its peg equivalent. The
 * window formats these through i18n; this core only assembles the fields.
 */
export interface ClaudiumGiftReview {
  payAmount: string;
  rail: ClaudiumGiftRail;
  claudium: number;
  usd: number;
  toSelf: boolean;
  occasion: ClaudiumGiftOccasion;
  delivery: ClaudiumGiftDelivery;
  recipientEmail: string | null;
  scheduled: boolean;
}

/**
 * Assemble the review model. usdPerClaudium is the service peg; claudiumToUsd only
 * projects it (never prices). payAmount is the service-scaled rail amount string the
 * caller passes (the window scales amountBase via the same scaleBaseUnits the credit
 * flow uses). Returns null when the draft is incomplete.
 */
export function buildGiftReview(
  draft: ClaudiumGiftDraft,
  payAmount: string,
  usdPerClaudium: number | null,
): ClaudiumGiftReview | null {
  if (draft.claudium === null || draft.rail === null) return null;
  return {
    payAmount,
    rail: draft.rail,
    claudium: draft.claudium,
    usd: claudiumToUsd(draft.claudium, usdPerClaudium),
    toSelf: draft.toSelf,
    occasion: draft.occasion,
    delivery: draft.delivery,
    recipientEmail: draft.toSelf ? null : draft.recipientEmail.trim() || null,
    scheduled: draft.deliverAtMs !== null,
  };
}

/** The plain-language error class a failed quote/confirm maps to (never a raw code). */
export type ClaudiumGiftErrorKind = 'expired' | 'oracle' | 'declined' | 'generic';

/**
 * Map a service reason string to a friendly error class with a recovery. expired /
 * oracle_unavailable get a re-quote path; a hard decline gets a plain retry; anything
 * else is the generic try-again. Mirrors the credit flow's reason mapping (D6).
 */
export function classifyGiftError(reason: string | null): ClaudiumGiftErrorKind {
  if (reason === 'expired') return 'expired';
  if (reason === 'oracle_unavailable') return 'oracle';
  if (reason === 'declined' || reason === 'rail_disabled') return 'declined';
  return 'generic';
}

/**
 * Build the issued-card redeem URL from the code the confirm returned. The base is the
 * play origin; the code is URL-encoded. Returns null for an empty code (no fake URL is
 * ever fabricated). The window renders this as a copyable link + a QR of the same URL.
 */
export function giftRedeemUrl(baseOrigin: string, code: string | null): string | null {
  if (!code) return null;
  const trimmed = baseOrigin.replace(/\/+$/, '');
  return `${trimmed}/claudium/redeem?code=${encodeURIComponent(code)}`;
}

/** The forward step order the wizard advances through (review onward is terminal). */
export const CLAUDIUM_GIFT_STEP_ORDER: readonly ClaudiumGiftStep[] = [
  'denomination',
  'rail',
  'recipient',
  'occasion',
  'delivery',
  'review',
];

/** The step that follows `step` in the forward wizard, or null past review. */
export function nextGiftStep(step: ClaudiumGiftStep): ClaudiumGiftStep | null {
  const i = CLAUDIUM_GIFT_STEP_ORDER.indexOf(step);
  if (i < 0 || i >= CLAUDIUM_GIFT_STEP_ORDER.length - 1) return null;
  return CLAUDIUM_GIFT_STEP_ORDER[i + 1];
}

/** The step before `step`, or null at the first step. */
export function prevGiftStep(step: ClaudiumGiftStep): ClaudiumGiftStep | null {
  const i = CLAUDIUM_GIFT_STEP_ORDER.indexOf(step);
  if (i <= 0) return null;
  return CLAUDIUM_GIFT_STEP_ORDER[i - 1];
}

/** Whether the current step's inputs let the wizard advance to the next step. */
export function canAdvanceGiftStep(step: ClaudiumGiftStep, draft: ClaudiumGiftDraft): boolean {
  switch (step) {
    case 'denomination':
      return draft.claudium !== null && draft.claudium > 0;
    case 'rail':
      return draft.rail !== null;
    case 'recipient':
      return giftRecipientReady(draft);
    case 'occasion':
      return true;
    case 'delivery':
      return giftRecipientReady(draft);
    case 'review':
      return giftDraftReadyToReview(draft);
    default:
      return false;
  }
}
