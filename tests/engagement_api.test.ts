import { describe, expect, it, beforeEach } from 'vitest';
import {
  parseSpinClaim,
  parsePackRedeem,
  packBurnMemo,
  handleSpinStatus,
  handleSpinClaim,
  handleFairness,
  handlePackCatalog,
  handlePackRedeem,
  SpinDeps,
  PackDeps,
} from '../server/engagement_api';
import { EngagementService } from '../server/engagement_service';
import { parseEngagementConfig } from '../server/engagement_config';
import { InMemoryEngagementDb } from './helpers/in_memory_engagement_db';

const onCfg = parseEngagementConfig({ SPIN_ENABLED: '1', PACKS_ENABLED: '1' });
const SIG = (c: string) => c.repeat(64); // valid base58, length 64

let db: InMemoryEngagementDb;
let svc: EngagementService;
beforeEach(() => {
  db = new InMemoryEngagementDb();
  svc = new EngagementService(db, onCfg, { makeSeed: () => Buffer.alloc(32, 1), now: () => 0 });
});

const goodSpin: SpinDeps = { walletLinked: true, balanceWoc: 1000, holderTier: 4, antibotPassed: true };

describe('parseSpinClaim', () => {
  it('accepts a string clientSeed and rejects bad shapes', () => {
    expect(parseSpinClaim({ clientSeed: 'abc' })).toEqual({ ok: true, value: { clientSeed: 'abc' } });
    expect(parseSpinClaim(null).ok).toBe(false);
    expect(parseSpinClaim({}).ok).toBe(false);
    expect(parseSpinClaim({ clientSeed: 5 }).ok).toBe(false);
    expect((parseSpinClaim({ clientSeed: 'x'.repeat(200) }) as { error: string }).error).toBe('client_seed_too_long');
  });
});

describe('parsePackRedeem', () => {
  it('requires a known pack id and a base58 signature', () => {
    expect(parsePackRedeem({ packId: 'common_cache', txSig: SIG('3') }).ok).toBe(true);
    expect((parsePackRedeem({ packId: 'nope', txSig: SIG('3') }) as { error: string }).error).toBe('unknown_pack');
    expect((parsePackRedeem({ packId: 'common_cache', txSig: 'not!base58' }) as { error: string }).error).toBe('bad_signature');
    expect(parsePackRedeem(null).ok).toBe(false);
  });
});

describe('packBurnMemo', () => {
  it('binds account + pack deterministically', () => {
    expect(packBurnMemo(42, 'rare_cache')).toBe('pack:42:rare_cache');
  });
});

describe('handleSpinStatus', () => {
  it('reports eligible for a qualified holder and surfaces the daily commit', async () => {
    const res = await handleSpinStatus(svc, onCfg, 1, goodSpin);
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBe(true);
    expect(res.body.alreadySpunToday).toBe(false);
    expect(typeof res.body.dailyCommit).toBe('string');
  });

  it('reports the reason for an ineligible wallet', async () => {
    const res = await handleSpinStatus(svc, onCfg, 1, { ...goodSpin, balanceWoc: 10 });
    expect(res.body.eligible).toBe(false);
    expect(res.body.reason).toBe('below_min');
  });
});

describe('handleSpinClaim', () => {
  it('claims for a qualified holder and returns the prize + lamports as a string', async () => {
    const res = await handleSpinClaim(svc, onCfg, 1, goodSpin, { clientSeed: 'abc' });
    expect(res.status).toBe(200);
    expect(typeof res.body.prize).toBe('string');
    expect(typeof res.body.lamports).toBe('string');
    expect(res.body.settled).toBe(false);
  });

  it('maps each ineligibility to the right HTTP status', async () => {
    expect((await handleSpinClaim(svc, onCfg, 2, goodSpin, {})).status).toBe(400);
    expect((await handleSpinClaim(svc, onCfg, 2, { ...goodSpin, walletLinked: false }, { clientSeed: 'x' })).status).toBe(403);
    expect((await handleSpinClaim(svc, onCfg, 2, { ...goodSpin, balanceWoc: 1 }, { clientSeed: 'x' })).status).toBe(403);
    expect((await handleSpinClaim(svc, onCfg, 2, { ...goodSpin, balanceWoc: null }, { clientSeed: 'x' })).status).toBe(503);
    const off = parseEngagementConfig({});
    expect((await handleSpinClaim(svc, off, 2, goodSpin, { clientSeed: 'x' })).status).toBe(503);
  });

  it('returns 409 on the second claim of the same UTC day', async () => {
    expect((await handleSpinClaim(svc, onCfg, 3, goodSpin, { clientSeed: 'x' })).status).toBe(200);
    const second = await handleSpinClaim(svc, onCfg, 3, goodSpin, { clientSeed: 'y' });
    expect(second.status).toBe(409);
    expect(second.body.error).toBe('already_spun');
  });
});

describe('handleFairness', () => {
  it('exposes the commit before reveal and the seed after', async () => {
    const before = await handleFairness(svc, 10);
    expect(before.body.seed).toBeNull();
    expect(typeof before.body.commit).toBe('string');
    await svc.revealDay(10);
    const after = await handleFairness(svc, 10);
    expect(typeof after.body.seed).toBe('string');
  });
});

describe('handlePackCatalog', () => {
  it('publishes the realm policy and per-reward odds that sum to 1', () => {
    const res = handlePackCatalog(onCfg);
    expect(res.body.policy).toBe('cosmetic');
    const packs = res.body.packs as Array<{ odds: Array<{ probability: number }> }>;
    expect(packs.length).toBe(3);
    for (const p of packs) {
      const sum = p.odds.reduce((s, o) => s + o.probability, 0);
      expect(sum).toBeCloseTo(1, 10);
    }
  });

  it('an open realm exposes more drops than a cosmetic realm', () => {
    const cosmetic = handlePackCatalog(parseEngagementConfig({ PACK_POWER_POLICY: 'cosmetic' })).body.packs as Array<{ odds: unknown[] }>;
    const open = handlePackCatalog(parseEngagementConfig({ PACK_POWER_POLICY: 'open' })).body.packs as Array<{ odds: unknown[] }>;
    expect(open[1].odds.length).toBeGreaterThan(cosmetic[1].odds.length);
  });
});

describe('handlePackRedeem', () => {
  const okBurn: PackDeps = { payerPubkey: 'PAYER', policy: 'cosmetic', verifyBurn: async () => ({ ok: true }) };

  it('verifies the burn (with the bound memo) then rips the pack', async () => {
    let seenMemo = '';
    const deps: PackDeps = {
      payerPubkey: 'PAYER',
      policy: 'cosmetic',
      verifyBurn: async (_sig, _payer, _price, memo) => {
        seenMemo = memo;
        return { ok: true };
      },
    };
    const res = await handlePackRedeem(svc, onCfg, 7, deps, { packId: 'common_cache', txSig: SIG('3') });
    expect(res.status).toBe(200);
    expect((res.body.rewards as unknown[]).length).toBe(2);
    expect(seenMemo).toBe('pack:7:common_cache');
  });

  it('rejects a disabled feature, a bad body, and an unverified burn', async () => {
    const off = parseEngagementConfig({});
    expect((await handlePackRedeem(svc, off, 7, okBurn, { packId: 'common_cache', txSig: SIG('3') })).status).toBe(503);
    expect((await handlePackRedeem(svc, onCfg, 7, okBurn, { packId: 'nope', txSig: SIG('3') })).status).toBe(400);
    const badBurn: PackDeps = { ...okBurn, verifyBurn: async () => ({ ok: false, reason: 'underpaid' }) };
    const res = await handlePackRedeem(svc, onCfg, 7, badBurn, { packId: 'common_cache', txSig: SIG('4') });
    expect(res.status).toBe(402);
    expect(res.body.error).toBe('underpaid');
  });

  it('a replayed burn signature is rejected by the service (route maps to 409)', async () => {
    await handlePackRedeem(svc, onCfg, 8, okBurn, { packId: 'common_cache', txSig: SIG('5') });
    await expect(
      handlePackRedeem(svc, onCfg, 8, okBurn, { packId: 'common_cache', txSig: SIG('5') }),
    ).rejects.toThrow('replayed_payment');
  });
});
