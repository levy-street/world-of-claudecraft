# Refer a Friend

## Objective

Reward players for bringing friends who actually play, not for generating signups. Two
mechanics work together: a bond buff (shared XP boost while the referrer and the friend
play together) and a milestone reward ladder (the referrer earns cosmetics as the friend
hits real progression). There is no flat signup reward. The game is browser-based, so
redemption is a URL parameter with zero install friction.

This system unifies with the existing card-link referral capture (`?ref=<slug>`,
`server/player_card.ts` `captureReferral`, the `referrals` table in `server/db.ts`): a
player-card slug remains a working entry channel that resolves to the card owner's
referral code and binds into the same referral rows. The existing bank bonus-slot
entitlement (`server/bank_entitlements.ts`, +2 slots per qualified referral capped at 5)
keeps working, reading the unified referral graph. One referral graph, no double
counting.

## Decisions taken (2026-08-11)

- `BOND_END_LEVEL` starts at 20: the bond ends at the same level that completes the
  referral, one coherent milestone. Raiseable later via config.
- The tier-5 mount reward ships as an exclusive reskin of an existing mount, not a new
  two-seater mechanic. A true passenger mount is a separate future feature; the ladder
  reward id can be swapped later without touching the ladder.
- The card-link system is unified into this one, not run in parallel or retired.
- All three phases are in scope.

## Core entities / data model

- `referral_codes`: one stable code per eligible referrer account. Fields:
  owner_account_id, code, created_at, active.
- `referrals` (extends the existing table): created when a new account redeems a code or
  card slug. Existing fields: referee_account_id (PK, so a referee binds at most once),
  referrer_account_id, slug, created_at. New fields: code_used, status (pending / active
  / completed / voided), device_fingerprint, ip_hash, redeemed_character_id. Legacy rows
  backfill status from current qualification state.
- `referral_milestones`: which milestones a given referral has fired. Fields:
  referee_account_id, milestone_key, reached_at, reward_granted.
- Bond state derives from the referral row (status + the referred character's level
  against `BOND_END_LEVEL`) rather than a separate mutable table; the active buff is a
  server-side check, never client state.
- Reward grants write through the existing inventory / title / cosmetic grant paths,
  never a bespoke one.

## Eligibility gates (referrer)

- Account age at least `REFERRER_MIN_ACCOUNT_AGE_DAYS` (default 7).
- At least one character at level `REFERRER_MIN_LEVEL` (default 20) or above.
- At most `MAX_ACTIVE_REFERRALS` pending/active referrals at once; rewards past
  `SEASON_REFERRAL_CAP` per season grant nothing (hard cap with diminishing returns
  before it).

## Redemption flow (referred)

1. Friend lands via `/?ref=CODE` (or a card link `/?ref=<slug>`). The client stores the
   sanitized value for the registration form (the existing `REFERRAL_SLUG` capture in
   `src/main.ts`).
2. On new account creation only, the code binds. A code cannot be redeemed by an
   existing account, and the `referrals` PK on the referee account makes rebinding
   impossible.
3. The server captures device_fingerprint (client-supplied, opaque, validated shape)
   and ip_hash (server-derived, salted, reusing the `server/site_presence.ts` hashing
   pattern) at redemption for correlation checks.
4. The referral row is created with status `pending`. Self-referral and
   referrer/referee correlation void it.

## Bond buff

- Active only while the referrer's and the referred's characters are partied together
  and in the same zone, checked server-side on every XP award, never client-trusted.
- Grants `BOND_XP_MULTIPLIER` (default 2.0) XP to both characters on the XP-award path.
- Ends permanently for that referral when the referred character reaches
  `BOND_END_LEVEL` (default 20).
- A "summon friend" teleport on `SUMMON_FRIEND_COOLDOWN_SECONDS` cooldown is available
  while the bond is active, to remove level-gap co-play friction.

## Milestone reward ladder (referrer)

Rewards fire on the friend's real progression, never at signup. All config-driven:

- `referred_level_10`: small grant (gold or consumable).
- `referred_level_20`: marks the referral `completed`, counts toward the tier ladder.
- Tier ladder by completed-referral count: 1 grants the Recruiter title, 3 grants an
  exclusive cosmetic, 5 grants an exclusive mount reskin.
- Implementation note (2026-08-11): tier 3 ships as the exclusive Realm-Builder
  title rather than a skin or chroma, because every skin-family cosmetic requires a
  new texture asset (titles are the one cosmetic the catalog can mint without art).
  Swap the tier-3 reward to a bespoke cosmetic when the art ships. Tier 5 is the
  Verdant Valorsteed, a tinted reskin of the stablemaster's Valorsteed, delivered
  as its reins in a Ravenpost letter.
- Cosmetics, titles, and mounts only: nothing tradeable or convertible to the economy,
  so the ladder cannot feed the market or $WOC.

## Anti-abuse

- A (device_fingerprint, ip_hash) pair counts once; correlated pairs void the referral.
- Rewards gate on genuine play (level 20 completion), not signup.
- Behavioural checks on the referred character's levelling pattern go through the
  `BotDetector` contract seam (`server/bot_detector/contract.ts`); the public build's
  stub passes everything, the private detector implements the real checks.
- Hard cap plus diminishing returns per referrer per season.
- Self-referral and same-account correlation void the referral.
- No public referral counter that would let farmers gauge detection thresholds; the
  referrer sees only their own counts.

## Admin / observability

- Admin API to inspect the referral chain for an account and to void or reinstate a
  referral, permission-gated and audited like the existing moderation writes.
- Grants and voids are logged for audit.
- Metrics: redemptions, pending to completed conversion, rewards granted per tier.

## Config (env keys, defaults in .env.example, never hardcoded)

`REFERRER_MIN_ACCOUNT_AGE_DAYS`, `REFERRER_MIN_LEVEL`, `BOND_XP_MULTIPLIER`,
`BOND_END_LEVEL`, `REFERRAL_MILESTONE_LEVELS`, `REFERRAL_TIER_THRESHOLDS`,
`MAX_ACTIVE_REFERRALS`, `SEASON_REFERRAL_CAP`, `SUMMON_FRIEND_COOLDOWN_SECONDS`.

## Phasing

- Phase 1: code generation, redemption binding, referral tracking, anti-abuse
  fingerprint/ip capture.
- Phase 2: bond buff plus summon.
- Phase 3: milestone ladder plus cosmetic/mount grants, admin tooling.

## Explicitly out of scope

No tradeable rewards, no gold or $WOC payouts, no signup-triggered grants, no rewards
for existing-account redemptions, no passenger-seat mount mechanic.
