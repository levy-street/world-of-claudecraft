// The fail-closed boot gate: the LP staking rail is OFF unless
// WOC_LP_STAKING_ENABLED=1, and an enabled-but-half-configured setup throws at
// boot (loud) instead of running misconfigured. Postgres is mocked at the top
// (hoisted, per the server-test idiom) because the boot module transitively
// imports db.ts.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
});
vi.mock('pg', () => ({
  Pool: class {
    async query() {
      return { rows: [], rowCount: 0 };
    }
    async connect() {
      return { query: async () => ({ rows: [], rowCount: 0 }), release() {} };
    }
    async end() {}
  },
}));

import { buildLpStakingService } from '../server/lp_staking_boot';

const LP_ENV = [
  'WOC_LP_STAKING_ENABLED',
  'WOC_LP_VAULT_PROGRAM_ID',
  'WOC_LP_MINT',
  'WOC_LP_SEASON_ID',
  'WOC_LP_EMISSION_RATE_BASE',
] as const;

afterEach(() => {
  for (const k of LP_ENV) delete process.env[k];
});

describe('buildLpStakingService (fail-closed flag gate)', () => {
  it('returns null when the flag is unset: the default posture is rail-dark', async () => {
    expect(await buildLpStakingService()).toBeNull();
  });

  it('returns null for any non-"1" flag value', async () => {
    for (const v of ['0', 'true', 'yes', 'on', '']) {
      process.env.WOC_LP_STAKING_ENABLED = v;
      expect(await buildLpStakingService()).toBeNull();
    }
  });

  it('throws loudly on a half-configured enable (no silent disable)', async () => {
    process.env.WOC_LP_STAKING_ENABLED = '1';
    await expect(buildLpStakingService()).rejects.toThrow(/requires/);
    process.env.WOC_LP_VAULT_PROGRAM_ID = '9zSKCSDmcTBYc9VSyeDmSn55Hz2gNwS6JAtHGPQ1LRe6';
    await expect(buildLpStakingService()).rejects.toThrow(/requires/);
    process.env.WOC_LP_MINT = 'E6r4tqSuQ6VuCa9jpPZMqYHAj1x9GJaKaaXWxrfFsgFx';
    await expect(buildLpStakingService()).rejects.toThrow(/requires/);
  });

  it('builds the service when fully configured, with emissions dark by default', async () => {
    process.env.WOC_LP_STAKING_ENABLED = '1';
    process.env.WOC_LP_VAULT_PROGRAM_ID = '9zSKCSDmcTBYc9VSyeDmSn55Hz2gNwS6JAtHGPQ1LRe6';
    process.env.WOC_LP_MINT = 'E6r4tqSuQ6VuCa9jpPZMqYHAj1x9GJaKaaXWxrfFsgFx';
    process.env.WOC_LP_SEASON_ID = '9001';
    const svc = await buildLpStakingService();
    expect(svc).not.toBeNull();
    // Even fully enabled, WOC_LP_EMISSION_RATE_BASE defaults to 0: the epoch
    // budget is structurally zero, so no epoch can reserve a single base unit.
    const cfg = (svc as any).d.cfg;
    expect(cfg.emissionRateBase).toBe(0n);
    expect(cfg.seasonId).toBe(9001);
  });
});
