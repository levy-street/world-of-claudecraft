// Refer-a-friend API surface (docs/prd/refer-a-friend.md).
//
// GET /api/referral-code: the caller's stable referral code plus their private
// program readout (eligibility, counts against the caps). Mints the code on the
// first ELIGIBLE fetch; an ineligible account gets eligible:false and no code.
// The counts are the caller's OWN only; there is deliberately no public
// referral counter anywhere (the PRD's anti-farming rule).

import { accountAndScopeForToken, moderationStatusForAccount } from './db';
import { ctxAccountId } from './http/context';
import { type BearerActiveGuardDb, createActiveGuard } from './http/middleware/bearer_active_guard';
import type { Ctx, RouteDef } from './http/types';
import { json } from './http_util';
import { REALM_PUBLIC_ORIGIN } from './realm';
import { referralProgramConfig, referrerEligibility } from './referral_program';
import { getOrMintReferralCode, referrerProgramFacts } from './referrals_db';

// The bearer guard reads its token + moderation status through this seam; the
// production default is the real db.ts reads, so the guard bans/suspensions and
// enforces token scope out of the box. A test swaps in a fake, no Postgres.
export type ReferralsDb = BearerActiveGuardDb & {
  referrerProgramFacts: typeof referrerProgramFacts;
  getOrMintReferralCode: typeof getOrMintReferralCode;
};

const REAL_REFERRALS_DB: ReferralsDb = {
  accountAndScopeForToken,
  moderationStatusForAccount,
  referrerProgramFacts,
  getOrMintReferralCode,
};
let referralsDb: ReferralsDb = REAL_REFERRALS_DB;

/** Override the db seam with a fake (test-only; merges over the real reads). */
export function setReferralsDbForTests(overrides: Partial<ReferralsDb>): void {
  referralsDb = { ...REAL_REFERRALS_DB, ...overrides };
}

/** Restore the real db seam after an override (test-only). */
export function resetReferralsDbForTests(): void {
  referralsDb = REAL_REFERRALS_DB;
}

// Shared bearer guard (moderation-gated + scope-enforced): full-session tokens
// only, matching GET /api/referrals (server/wallet.ts activeGuard). Minting the
// code is account state, not a companion-app read.
const authGuard = createActiveGuard(() => referralsDb);

/** GET /api/referral-code: authenticated; the caller's own program readout. */
async function referralCodeHandler(ctx: Ctx): Promise<void> {
  const accountId = ctxAccountId(ctx);
  const cfg = referralProgramConfig();
  const facts = await referralsDb.referrerProgramFacts(accountId, cfg.seasonDays);
  const eligibility = referrerEligibility(facts, cfg);
  if (!eligibility.eligible) {
    json(ctx.res, 200, {
      eligible: false,
      reasons: eligibility.reasons,
      code: null,
      url: null,
      activeReferrals: facts.activeReferrals,
      completedReferrals: facts.completedTotal,
      maxActiveReferrals: cfg.maxActiveReferrals,
      seasonReferralCap: cfg.seasonReferralCap,
    });
    return;
  }
  const code = await referralsDb.getOrMintReferralCode(accountId, Math.random);
  json(ctx.res, 200, {
    eligible: true,
    reasons: [],
    code,
    url: `${REALM_PUBLIC_ORIGIN}/?ref=${code}`,
    activeReferrals: facts.activeReferrals,
    completedReferrals: facts.completedTotal,
    maxActiveReferrals: cfg.maxActiveReferrals,
    seasonReferralCap: cfg.seasonReferralCap,
  });
}

export const routes: RouteDef[] = [
  {
    method: 'GET',
    path: '/api/referral-code',
    surface: 'api',
    middleware: [authGuard],
    handler: referralCodeHandler,
  },
];
