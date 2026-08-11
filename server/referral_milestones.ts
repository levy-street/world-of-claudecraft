// Refer-a-friend milestone rewards (docs/prd/refer-a-friend.md, phase 3).
//
// Rewards fire on the recruited friend's REAL progression, never at signup:
// the referee's live level-up events (game.ts levelup arm) fire the referee
// milestones, and the referrer-join reconcile delivers anything that fired
// while the referrer was offline. Every grant is claim-once through the
// referral_milestones rows (the discord reward_ledger dedupe shape: durable
// claim FIRST, best-effort apply after, so a crashed apply can never double
// grant). Grants need a live referrer session in this realm (mail and deeds
// are per-character surfaces), so an offline referrer's grants simply wait
// for their next join. All DB work rides the same per-process FIFO shape as
// the bond service; the game loop never awaits it.
//
// Season cap: a completion past SEASON_REFERRAL_CAP still records (the graph
// stays truthful) but grants nothing, the PRD's diminishing-to-zero arm.

import type { LetterDef } from '../src/sim/content/letters';
import { REFERRAL_LEVEL10_LETTER, REFERRAL_MOUNT_LETTER } from '../src/sim/content/letters';
import {
  completionCountsForRewards,
  ladderTierForCount,
  referralProgramConfig,
} from './referral_program';
import {
  claimReferralMilestoneReward,
  completeReferralsForReferee,
  recordReferralMilestone,
  referralForReferee,
  referrerProgramFacts,
  ungrantedMilestonesForReferrer,
} from './referrals_db';

/** The host surface (GameServer + Sim) grants go through. */
export interface ReferralMilestoneHost {
  /** The first live session for an account on this realm, else null. */
  sessionForAccount(accountId: number): { pid: number } | null;
  sendSystemLetterTo(pid: number, letter: LetterDef): void;
  grantReferralLadder(pid: number, tier: number): void;
}

export interface ReferralMilestoneDb {
  referralForReferee: typeof referralForReferee;
  referrerProgramFacts: typeof referrerProgramFacts;
  recordReferralMilestone: typeof recordReferralMilestone;
  claimReferralMilestoneReward: typeof claimReferralMilestoneReward;
  ungrantedMilestonesForReferrer: typeof ungrantedMilestonesForReferrer;
  completeReferralsForReferee: typeof completeReferralsForReferee;
}

const REAL_MILESTONE_DB: ReferralMilestoneDb = {
  referralForReferee,
  referrerProgramFacts,
  recordReferralMilestone,
  claimReferralMilestoneReward,
  ungrantedMilestonesForReferrer,
  completeReferralsForReferee,
};

export function milestoneKeyForLevel(level: number): string {
  return `referred_level_${level}`;
}

export class ReferralMilestoneService {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly host: ReferralMilestoneHost,
    private readonly db: ReferralMilestoneDb = REAL_MILESTONE_DB,
  ) {}

  /** A live level-up dinged an exact milestone level (game.ts levelup arm). */
  onRefereeLevel(refereeAccountId: number, level: number): void {
    const cfg = referralProgramConfig();
    if (!cfg.milestoneLevels.includes(level)) return;
    this.enqueue(async () => {
      const referral = await this.db.referralForReferee(refereeAccountId);
      if (!referral || referral.status === 'voided') return;
      await this.db.recordReferralMilestone(refereeAccountId, milestoneKeyForLevel(level));
      await this.grantIfPossible(refereeAccountId, milestoneKeyForLevel(level));
    });
  }

  /** A referrer joined: deliver anything that fired while they were offline. */
  onReferrerJoin(referrerAccountId: number): void {
    this.enqueue(async () => {
      const pending = await this.db.ungrantedMilestonesForReferrer(referrerAccountId);
      for (const row of pending) {
        await this.grantIfPossible(row.refereeAccountId, row.milestoneKey);
      }
    });
  }

  /** Await the FIFO tail (tests only). */
  idle(): Promise<void> {
    return this.tail.then(
      () => {},
      () => {},
    );
  }

  private enqueue(run: () => Promise<void>): void {
    this.tail = this.tail
      .then(run)
      .catch((err) => console.error('referral milestone grant failed:', err));
  }

  /**
   * Claim-then-apply one referee milestone's referrer-side reward. Leaves the
   * row UNCLAIMED when the referrer has no live session here (the join
   * reconcile retries) and claims-without-applying when the referral is
   * voided or the season cap zeroes the reward (so it never retries).
   */
  private async grantIfPossible(refereeAccountId: number, milestoneKey: string): Promise<void> {
    const cfg = referralProgramConfig();
    const referral = await this.db.referralForReferee(refereeAccountId);
    if (!referral) return;
    if (referral.status === 'voided') {
      await this.db.claimReferralMilestoneReward(refereeAccountId, milestoneKey);
      return;
    }
    const referrerAccountId = referral.referrerAccountId;
    const session = this.host.sessionForAccount(referrerAccountId);
    if (!session) return; // referrer offline: the join reconcile delivers it
    if (milestoneKey === milestoneKeyForLevel(cfg.bondEndLevel)) {
      // Promote this referee's referral to completed BEFORE reading the
      // counts: the bond service's own completion rides a separate FIFO, so
      // ordering across the two is not guaranteed, and an under-count here
      // would claim the milestone while granting a too-low ladder tier.
      // Idempotent, event-backed (this milestone row only exists because the
      // ding really happened), and it never touches voided rows.
      await this.db.completeReferralsForReferee(refereeAccountId);
    }
    const facts = await this.db.referrerProgramFacts(referrerAccountId, cfg.seasonDays);
    // The completion that fired this milestone is already counted in
    // completedThisSeason, so the cap compares against the count MINUS the
    // one being rewarded.
    const withinCap = completionCountsForRewards(Math.max(0, facts.completedThisSeason - 1), cfg);
    const claimed = await this.db.claimReferralMilestoneReward(refereeAccountId, milestoneKey);
    if (!claimed) return; // another process (or an earlier run) already granted
    if (!withinCap) return; // claimed, deliberately nothing granted (past cap)
    if (milestoneKey === milestoneKeyForLevel(10)) {
      this.host.sendSystemLetterTo(session.pid, REFERRAL_LEVEL10_LETTER);
      return;
    }
    if (milestoneKey === milestoneKeyForLevel(cfg.bondEndLevel)) {
      // Completion: apply the tier ladder. Titles grant idempotently in the
      // sim for every rung at or below the tier; the tier-5 mount letter is
      // claim-once through its own referrer-keyed milestone row.
      const tier = ladderTierForCount(facts.completedTotal, cfg);
      if (tier >= 1) this.host.grantReferralLadder(session.pid, tier);
      const mountRung = cfg.tierThresholds.length; // the last authored rung
      if (tier >= mountRung && mountRung > 0) {
        await this.db.recordReferralMilestone(referrerAccountId, 'referrer_mount');
        const mountClaimed = await this.db.claimReferralMilestoneReward(
          referrerAccountId,
          'referrer_mount',
        );
        if (mountClaimed) this.host.sendSystemLetterTo(session.pid, REFERRAL_MOUNT_LETTER);
      }
    }
  }
}
