process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_referral_milestones';

import { beforeEach, describe, expect, it } from 'vitest';
import { milestoneKeyForLevel, ReferralMilestoneService } from '../../server/referral_milestones';
import { resetReferralProgramConfigForTests } from '../../server/referral_program';
import type { ReferralStatus } from '../../server/referrals_db';

// In-memory graph + grant recorder (no Postgres, no GameServer, no Sim).
function makeRig(options: {
  referrals?: {
    refereeAccountId: number;
    referrerAccountId: number;
    status: ReferralStatus;
  }[];
  online?: number[];
  completedThisSeason?: number;
  completedTotal?: number;
}) {
  const referrals = options.referrals ?? [];
  const online = new Set(options.online ?? []);
  const milestones = new Map<string, { granted: boolean }>();
  const letters: { pid: number; letterId: string }[] = [];
  const ladders: { pid: number; tier: number }[] = [];
  const service = new ReferralMilestoneService(
    {
      sessionForAccount: (accountId) => (online.has(accountId) ? { pid: accountId * 10 } : null),
      sendSystemLetterTo: (pid, letter) => letters.push({ pid, letterId: letter.letterId }),
      grantReferralLadder: (pid, tier) => ladders.push({ pid, tier }),
    },
    {
      referralForReferee: async (refereeAccountId) => {
        const row = referrals.find((r) => r.refereeAccountId === refereeAccountId);
        return row
          ? {
              refereeAccountId: row.refereeAccountId,
              referrerAccountId: row.referrerAccountId,
              slug: 'x',
              codeUsed: null,
              status: row.status,
              createdAt: new Date(0),
            }
          : null;
      },
      referrerProgramFacts: async () => ({
        accountAgeDays: 30,
        maxCharacterLevel: 20,
        activeReferrals: 0,
        completedThisSeason: options.completedThisSeason ?? 1,
        completedTotal: options.completedTotal ?? 1,
      }),
      recordReferralMilestone: async (subject, key) => {
        const mapKey = `${subject}:${key}`;
        if (milestones.has(mapKey)) return false;
        milestones.set(mapKey, { granted: false });
        return true;
      },
      claimReferralMilestoneReward: async (subject, key) => {
        const row = milestones.get(`${subject}:${key}`);
        if (!row || row.granted) return false;
        row.granted = true;
        return true;
      },
      ungrantedMilestonesForReferrer: async (referrerAccountId) =>
        [...milestones.entries()]
          .filter(([mapKey, row]) => {
            if (row.granted) return false;
            const refereeAccountId = Number(mapKey.split(':')[0]);
            return referrals.some(
              (r) =>
                r.refereeAccountId === refereeAccountId &&
                r.referrerAccountId === referrerAccountId &&
                r.status !== 'voided',
            );
          })
          .map(([mapKey]) => ({
            refereeAccountId: Number(mapKey.split(':')[0]),
            milestoneKey: mapKey.split(':')[1],
          })),
      completeReferralsForReferee: async (refereeAccountId) => {
        const completed: { refereeAccountId: number; referrerAccountId: number }[] = [];
        for (const r of referrals) {
          if (r.refereeAccountId === refereeAccountId && r.status !== 'voided') {
            r.status = 'completed';
            completed.push({
              refereeAccountId: r.refereeAccountId,
              referrerAccountId: r.referrerAccountId,
            });
          }
        }
        return completed;
      },
    },
  );
  return { service, letters, ladders, milestones, online };
}

beforeEach(() => resetReferralProgramConfigForTests());

describe('ReferralMilestoneService', () => {
  it('level 10 sends the gold letter to an online referrer', async () => {
    const rig = makeRig({
      referrals: [{ refereeAccountId: 2, referrerAccountId: 1, status: 'active' }],
      online: [1],
    });
    rig.service.onRefereeLevel(2, 10);
    await rig.service.idle();
    expect(rig.letters).toEqual([{ pid: 10, letterId: 'referral_level10_reward' }]);
    // Claim-once: a duplicate firing grants nothing more.
    rig.service.onRefereeLevel(2, 10);
    await rig.service.idle();
    expect(rig.letters).toHaveLength(1);
  });

  it('a non-milestone level and a voided referral grant nothing', async () => {
    const rig = makeRig({
      referrals: [{ refereeAccountId: 2, referrerAccountId: 1, status: 'voided' }],
      online: [1],
    });
    rig.service.onRefereeLevel(2, 11);
    rig.service.onRefereeLevel(2, 10);
    await rig.service.idle();
    expect(rig.letters).toEqual([]);
    expect(rig.ladders).toEqual([]);
  });

  it('level 20 completes the referral and applies the ladder tier', async () => {
    const rig = makeRig({
      referrals: [{ refereeAccountId: 2, referrerAccountId: 1, status: 'active' }],
      online: [1],
      completedTotal: 1,
      completedThisSeason: 1,
    });
    rig.service.onRefereeLevel(2, 20);
    await rig.service.idle();
    expect(rig.ladders).toEqual([{ pid: 10, tier: 1 }]);
    expect(rig.letters).toEqual([]); // tier 1 has no letter reward
  });

  it('the fifth completion grants the mount letter exactly once', async () => {
    const rig = makeRig({
      referrals: [{ refereeAccountId: 2, referrerAccountId: 1, status: 'active' }],
      online: [1],
      completedTotal: 5,
      // Cap check compares against completedThisSeason - 1, so 5 is within a
      // default cap of 5.
      completedThisSeason: 5,
    });
    rig.service.onRefereeLevel(2, 20);
    await rig.service.idle();
    expect(rig.ladders).toEqual([{ pid: 10, tier: 3 }]);
    expect(rig.letters).toEqual([{ pid: 10, letterId: 'referral_mount_reward' }]);
    // The referrer-keyed mount milestone is claim-once even if another
    // completion lands later at the same tier.
    rig.milestones.set('2:referred_level_20', { granted: false });
    rig.service.onRefereeLevel(2, 20);
    await rig.service.idle();
    expect(rig.letters).toHaveLength(1);
  });

  it('a completion past the season cap claims but grants nothing', async () => {
    const rig = makeRig({
      referrals: [{ refereeAccountId: 2, referrerAccountId: 1, status: 'active' }],
      online: [1],
      completedTotal: 6,
      completedThisSeason: 6,
    });
    rig.service.onRefereeLevel(2, 20);
    await rig.service.idle();
    expect(rig.ladders).toEqual([]);
    expect(rig.letters).toEqual([]);
    expect(rig.milestones.get('2:referred_level_20')?.granted).toBe(true);
  });

  it('an offline referrer keeps the milestone unclaimed until the join reconcile', async () => {
    const rig = makeRig({
      referrals: [{ refereeAccountId: 2, referrerAccountId: 1, status: 'active' }],
      online: [],
    });
    rig.service.onRefereeLevel(2, 10);
    await rig.service.idle();
    expect(rig.letters).toEqual([]);
    expect(rig.milestones.get(`2:${milestoneKeyForLevel(10)}`)?.granted).toBe(false);
    // The referrer logs in: the reconcile delivers it.
    rig.online.add(1);
    rig.service.onReferrerJoin(1);
    await rig.service.idle();
    expect(rig.letters).toEqual([{ pid: 10, letterId: 'referral_level10_reward' }]);
    expect(rig.milestones.get(`2:${milestoneKeyForLevel(10)}`)?.granted).toBe(true);
  });
});
