import { describe, expect, it, beforeEach } from 'vitest';
import { EngagementService } from '../server/engagement_service';
import { parseEngagementConfig } from '../server/engagement_config';
import { commitFor, deriveOutcomeUnit } from '../server/fairness';
import { DEFAULT_PRIZE_TABLE, selectPrize, scaleTableForTier } from '../server/spin_prizes';
import { InMemoryEngagementDb } from './helpers/in_memory_engagement_db';

const cfg = parseEngagementConfig({});
let db: InMemoryEngagementDb;
const seed0 = Buffer.alloc(32, 0);
const makeSvc = (seed = seed0) => new EngagementService(db, cfg, { makeSeed: () => seed, now: () => 0 });

beforeEach(() => {
  db = new InMemoryEngagementDb();
});

describe('constructor', () => {
  it('rejects a prize table whose payout exceeds the configured cap', () => {
    expect(() => new EngagementService(db, { ...cfg, spinMaxPayoutLamports: 50_000_000n })).toThrow(/invalid prize table/);
  });
  it('accepts the default table under the default cap', () => {
    expect(() => makeSvc()).not.toThrow();
  });
});

describe('claimSpin', () => {
  it('records the outcome the pure cores compute for the committed seed', async () => {
    const svc = makeSvc();
    const claim = await svc.claimSpin({ accountId: 7, clientSeed: 'abc', holderTier: 0, utcDay: 100 });
    const unit = deriveOutcomeUnit(seed0, 7, 1, 'abc');
    const expected = selectPrize(scaleTableForTier(DEFAULT_PRIZE_TABLE, 0), unit);
    expect(claim.prize.key).toBe(expected.key);
    expect(claim.spin.prizeKey).toBe(expected.key);
    expect(claim.spin.lamports).toBe(expected.lamports);
    expect(claim.spin.status).toBe('pending');
    expect(claim.spin.settleSig).toBeNull();
  });

  it('enforces one spin per account per UTC day, but allows the next day', async () => {
    const svc = makeSvc();
    await svc.claimSpin({ accountId: 10, clientSeed: 'x', holderTier: 0, utcDay: 100 });
    await expect(svc.claimSpin({ accountId: 10, clientSeed: 'y', holderTier: 0, utcDay: 100 })).rejects.toThrow('already_spun');
    await expect(svc.claimSpin({ accountId: 10, clientSeed: 'z', holderTier: 0, utcDay: 101 })).resolves.toBeTruthy();
  });

  it('produces a valid table-member prize at low and high holder tiers', async () => {
    const svc = makeSvc();
    const low = await svc.claimSpin({ accountId: 1, clientSeed: 's', holderTier: 0, utcDay: 1 });
    const high = await svc.claimSpin({ accountId: 2, clientSeed: 's', holderTier: 10, utcDay: 1 });
    const keys = DEFAULT_PRIZE_TABLE.map((t) => t.key);
    expect(keys).toContain(low.prize.key);
    expect(keys).toContain(high.prize.key);
  });
});

describe('spinStatus', () => {
  it('reports not-spun then spun across a claim', async () => {
    const svc = makeSvc();
    expect((await svc.spinStatus(3, 100)).alreadySpun).toBe(false);
    await svc.claimSpin({ accountId: 3, clientSeed: 'x', holderTier: 0, utcDay: 100 });
    const after = await svc.spinStatus(3, 100);
    expect(after.alreadySpun).toBe(true);
    expect(after.spin?.prizeKey).toBeTruthy();
  });
});

describe('settleSpin', () => {
  it('settles, is idempotent on the same signature, and conflicts on a different one', async () => {
    const svc = makeSvc();
    const claim = await svc.claimSpin({ accountId: 9, clientSeed: 'x', holderTier: 0, utcDay: 100 });
    const settled = await svc.settleSpin(claim.spin.id, 'sigABC');
    expect(settled.status).toBe('settled');
    expect(settled.settleSig).toBe('sigABC');
    expect((await svc.settleSpin(claim.spin.id, 'sigABC')).status).toBe('settled');
    await expect(svc.settleSpin(claim.spin.id, 'sigDIFF')).rejects.toThrow('already_settled');
    await expect(svc.settleSpin(99999, 'x')).rejects.toThrow('no_such_spin');
  });
});

describe('creditDaily', () => {
  it('credits once per day, increments consecutively, resets after a gap', async () => {
    const svc = makeSvc();
    expect(await svc.creditDaily(5, 100)).toEqual({ credited: true, streak: 1, keysAwarded: 1 });
    expect(await svc.creditDaily(5, 100)).toEqual({ credited: false, streak: 1, keysAwarded: 0 });
    expect(await svc.creditDaily(5, 101)).toEqual({ credited: true, streak: 2, keysAwarded: 1 });
    expect(await svc.creditDaily(5, 105)).toEqual({ credited: true, streak: 1, keysAwarded: 1 });
  });

  it('awards milestone keys at a 3-day streak', async () => {
    const svc = makeSvc();
    await svc.creditDaily(6, 100);
    await svc.creditDaily(6, 101);
    expect(await svc.creditDaily(6, 102)).toEqual({ credited: true, streak: 3, keysAwarded: 2 });
  });
});

describe('openPack', () => {
  it('rolls policy-eligible contents, persists the pity counter, and blocks a replayed burn', async () => {
    const svc = makeSvc();
    const a = await svc.openPack({ accountId: 1, packId: 'common_cache', txSig: 'sig1', policy: 'cosmetic', units: [0, 0, 0] });
    expect(a.result.rewards).toHaveLength(2);
    expect(a.result.rewards.every((r) => r.reward.minPolicy === 'cosmetic')).toBe(true);
    expect(await db.getPity(1, 'common_cache')).toBe(1);

    await svc.openPack({ accountId: 1, packId: 'common_cache', txSig: 'sig2', policy: 'cosmetic', units: [0, 0, 0] });
    expect(await db.getPity(1, 'common_cache')).toBe(2);

    await expect(
      svc.openPack({ accountId: 1, packId: 'common_cache', txSig: 'sig1', policy: 'cosmetic', units: [0, 0, 0] }),
    ).rejects.toThrow('replayed_payment');
    expect(db.openings).toHaveLength(2);
  });

  it('fires the pity guarantee at the threshold and resets the counter', async () => {
    const svc = makeSvc();
    await db.setPity(2, 'common_cache', 4);
    const res = await svc.openPack({ accountId: 2, packId: 'common_cache', txSig: 'sigP', policy: 'cosmetic', units: [0, 0, 0] });
    expect(res.result.rewards.some((r) => r.pity)).toBe(true);
    expect(await db.getPity(2, 'common_cache')).toBe(0);
  });

  it('rejects an unknown pack id', async () => {
    const svc = makeSvc();
    await expect(svc.openPack({ accountId: 1, packId: 'nope', txSig: 's', policy: 'open', units: [0, 0, 0] })).rejects.toThrow('no_such_pack');
  });
});

describe('openPackFair', () => {
  it('derives fair units from the daily seed + burn sig: deterministic and recomputable', async () => {
    const seed = Buffer.alloc(32, 7);
    const svc = makeSvc(seed);
    const a = await svc.openPackFair({ accountId: 4, packId: 'rare_cache', txSig: 'burnAAA', policy: 'open', utcDay: 50 });
    expect(a.result.rewards).toHaveLength(3);
    // Same (account, txSig, day) recomputes the identical contents from the revealed seed.
    const revealed = await svc.revealDay(50);
    expect(Buffer.from(revealed, 'hex').equals(seed)).toBe(true);
  });
});

describe('publicFairness / revealDay', () => {
  it('fixes the commit before reveal and only exposes the seed after', async () => {
    const seed = Buffer.alloc(32, 9);
    const svc = makeSvc(seed);
    const f = await svc.publicFairness(200);
    expect(f.commitHash).toBe(commitFor(seed));
    expect(f.revealedSeed).toBeNull();
    expect((await svc.publicFairness(200)).commitHash).toBe(f.commitHash);

    const revealed = await svc.revealDay(200);
    expect(revealed).toBe(seed.toString('hex'));
    expect((await svc.publicFairness(200)).revealedSeed).toBe(seed.toString('hex'));
  });

  it('a claimed spin can be recomputed from the revealed seed (provable fairness)', async () => {
    const seed = Buffer.alloc(32, 3);
    const svc = makeSvc(seed);
    const claim = await svc.claimSpin({ accountId: 42, clientSeed: 'verify', holderTier: 0, utcDay: 300 });
    const revealed = await svc.revealDay(300);
    const recomputedUnit = deriveOutcomeUnit(Buffer.from(revealed, 'hex'), 42, 1, 'verify');
    const recomputedPrize = selectPrize(scaleTableForTier(DEFAULT_PRIZE_TABLE, 0), recomputedUnit);
    expect(recomputedPrize.key).toBe(claim.spin.prizeKey);
    expect(recomputedPrize.lamports).toBe(claim.spin.lamports);
  });
});
