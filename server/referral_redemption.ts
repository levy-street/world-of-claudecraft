// Refer-a-friend redemption shell (docs/prd/refer-a-friend.md): binds a brand-new
// account to its referrer at registration time. The ?ref= channel is unified: a
// referral CODE resolves first, then a player-card SLUG, so both entry links keep
// working against one referral graph. Safe to call with any untrusted ref:
// invalid tokens, unknown tokens, self-referrals, and over-cap referrers are
// silently dropped (no signal a farmer can probe; the register response is
// identical either way).
import { accountForSlug } from './db';
import { canAcceptRedemption, referralProgramConfig } from './referral_program';
import {
  accountForReferralCode,
  insertReferralRedemption,
  referrerProgramFacts,
} from './referrals_db';
import { hashPresenceText } from './site_presence';

/** Redemption-time request facts, from the register handler's requestMetadata. */
export interface RedemptionMeta {
  ip?: string | null;
  userAgent?: string | null;
}

// Mirrors the client's REFERRAL_SLUG capture shape (src/main.ts) and
// player_card.ts isValidSlug; inlined here rather than imported because
// player_card.ts delegates captureReferral to this module (a cycle otherwise).
const REF_TOKEN_SHAPE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Bind refereeAccountId to the referrer the ref token resolves to. The row
 * lands 'pending' (or 'voided' when the redemption correlates with the
 * referrer or a prior redemption; see insertReferralRedemption). Only the raw
 * IP's HASH is stored; the raw value is used solely for the in-statement
 * correlation compare. The device fingerprint is the user-agent hash: weak but
 * zero-friction, and the correlation check requires BOTH hashes to match
 * before it voids, so a shared household IP alone never voids a referral.
 */
export async function redeemReferral(
  refereeAccountId: number,
  ref: unknown,
  meta?: RedemptionMeta,
): Promise<void> {
  const token = typeof ref === 'string' ? ref.trim().toLowerCase() : '';
  if (!REF_TOKEN_SHAPE.test(token)) return;
  const cfg = referralProgramConfig();
  let codeUsed: string | null = null;
  let referrer = await accountForReferralCode(token);
  if (referrer !== null) {
    codeUsed = token;
  } else {
    referrer = await accountForSlug(token);
  }
  if (referrer === null || referrer === refereeAccountId) return;
  const facts = await referrerProgramFacts(referrer, cfg.seasonDays);
  if (!canAcceptRedemption(facts.activeReferrals, cfg)) return;
  const ip = meta?.ip?.trim() || null;
  const userAgent = meta?.userAgent?.trim() || null;
  await insertReferralRedemption({
    refereeAccountId,
    referrerAccountId: referrer,
    redeemedToken: token,
    codeUsed,
    deviceFingerprint: userAgent ? hashPresenceText(userAgent) : null,
    ipHash: ip ? hashPresenceText(ip) : null,
    rawRefereeIp: ip,
  });
}
