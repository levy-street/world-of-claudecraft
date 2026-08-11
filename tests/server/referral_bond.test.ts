process.env.DATABASE_URL ||= 'postgres://test:test@127.0.0.1:5433/wocc_referral_bond';

import { beforeEach, describe, expect, it } from 'vitest';
import { ReferralBondService } from '../../server/referral_bond';
import { resetReferralProgramConfigForTests } from '../../server/referral_program';
import type { BondBuffStamp } from '../../src/sim/bond_buff';

interface Edge {
  refereeAccountId: number;
  referrerAccountId: number;
}

// In-memory referral graph + session roster fakes (no Postgres, no GameServer).
function makeRig(options: { edges?: Edge[] } = {}) {
  let edges: Edge[] = options.edges ?? [];
  const sessions = new Map<number, { pid: number; characterId: number }[]>();
  const stamps = new Map<number, BondBuffStamp | null>();
  const service = new ReferralBondService(
    {
      sessionsForAccount: (accountId) => sessions.get(accountId) ?? [],
      setPlayerBond: (pid, stamp) => {
        stamps.set(pid, stamp);
      },
    },
    {
      activeBondEdgesForAccount: async (accountId) =>
        edges.filter((e) => e.refereeAccountId === accountId || e.referrerAccountId === accountId),
      completeReferralsForReferee: async (refereeAccountId) => {
        const completed = edges.filter((e) => e.refereeAccountId === refereeAccountId);
        edges = edges.filter((e) => e.refereeAccountId !== refereeAccountId);
        return completed;
      },
      // The row-driven refresh is a no-op in the fake: the durable level is not
      // modeled here; onRefereeBondEnd covers the promotion arm.
      refreshReferralStatuses: async () => [],
    },
  );
  return { service, sessions, stamps, setEdges: (next: Edge[]) => (edges = next) };
}

beforeEach(() => resetReferralProgramConfigForTests());

describe('ReferralBondService', () => {
  it('stamps both sides when referrer and referee are online', async () => {
    const rig = makeRig({ edges: [{ refereeAccountId: 2, referrerAccountId: 1 }] });
    rig.sessions.set(1, [{ pid: 10, characterId: 101 }]);
    rig.sessions.set(2, [{ pid: 20, characterId: 202 }]);
    rig.service.onSessionChange(2);
    await rig.service.idle();
    expect(rig.stamps.get(20)).toEqual({
      partnerCharacterIds: [101],
      multiplier: 2,
      summonCooldownSeconds: 1800,
    });
    expect(rig.stamps.get(10)).toEqual({
      partnerCharacterIds: [202],
      multiplier: 2,
      summonCooldownSeconds: 1800,
    });
  });

  it('stamps null when no bond partner is online', async () => {
    const rig = makeRig({ edges: [{ refereeAccountId: 2, referrerAccountId: 1 }] });
    rig.sessions.set(2, [{ pid: 20, characterId: 202 }]);
    rig.service.onSessionChange(2);
    await rig.service.idle();
    expect(rig.stamps.get(20)).toBeNull();
  });

  it('a referrer with several online referees carries every partner character', async () => {
    const rig = makeRig({
      edges: [
        { refereeAccountId: 2, referrerAccountId: 1 },
        { refereeAccountId: 3, referrerAccountId: 1 },
      ],
    });
    rig.sessions.set(1, [{ pid: 10, characterId: 101 }]);
    rig.sessions.set(2, [{ pid: 20, characterId: 202 }]);
    rig.sessions.set(3, [{ pid: 30, characterId: 303 }]);
    rig.service.onSessionChange(1);
    await rig.service.idle();
    expect(rig.stamps.get(10)?.partnerCharacterIds.sort()).toEqual([202, 303]);
    expect(rig.stamps.get(20)?.partnerCharacterIds).toEqual([101]);
    expect(rig.stamps.get(30)?.partnerCharacterIds).toEqual([101]);
  });

  it('a leave restamps the remaining partner to null', async () => {
    const rig = makeRig({ edges: [{ refereeAccountId: 2, referrerAccountId: 1 }] });
    rig.sessions.set(1, [{ pid: 10, characterId: 101 }]);
    rig.sessions.set(2, [{ pid: 20, characterId: 202 }]);
    rig.service.onSessionChange(2);
    await rig.service.idle();
    expect(rig.stamps.get(10)?.partnerCharacterIds).toEqual([202]);
    // The referee logs out: its sessions empty, then the leave recompute runs.
    rig.sessions.delete(2);
    rig.service.onSessionChange(2);
    await rig.service.idle();
    expect(rig.stamps.get(10)).toBeNull();
  });

  it('onRefereeBondEnd completes the referral and drops both stamps', async () => {
    const rig = makeRig({ edges: [{ refereeAccountId: 2, referrerAccountId: 1 }] });
    rig.sessions.set(1, [{ pid: 10, characterId: 101 }]);
    rig.sessions.set(2, [{ pid: 20, characterId: 202 }]);
    rig.service.onSessionChange(2);
    await rig.service.idle();
    expect(rig.stamps.get(10)?.partnerCharacterIds).toEqual([202]);
    rig.service.onRefereeBondEnd(2);
    await rig.service.idle();
    expect(rig.stamps.get(20)).toBeNull();
    expect(rig.stamps.get(10)).toBeNull();
  });

  it('serializes recomputes on the FIFO tail and survives a failing run', async () => {
    const rig = makeRig({ edges: [{ refereeAccountId: 2, referrerAccountId: 1 }] });
    rig.sessions.set(1, [{ pid: 10, characterId: 101 }]);
    rig.sessions.set(2, [{ pid: 20, characterId: 202 }]);
    // A throwing db call must not poison the tail for later recomputes.
    const throwing = new ReferralBondService(
      {
        sessionsForAccount: () => [],
        setPlayerBond: () => {},
      },
      {
        activeBondEdgesForAccount: async () => {
          throw new Error('db down');
        },
        completeReferralsForReferee: async () => [],
        refreshReferralStatuses: async () => {
          throw new Error('db down');
        },
      },
    );
    throwing.onSessionChange(1);
    await throwing.idle();
    throwing.onSessionChange(1);
    await expect(throwing.idle()).resolves.toBeUndefined();
    rig.service.onSessionChange(2);
    await rig.service.idle();
    expect(rig.stamps.get(20)?.partnerCharacterIds).toEqual([101]);
  });
});
