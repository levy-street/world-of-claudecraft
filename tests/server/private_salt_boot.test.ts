import { describe, expect, it } from 'vitest';
import { buildRealmSimConfig, freshPrivateSalt } from '../../server/sim_boot_config';
import { inertVaultConsumptionAdmission } from '../../src/sim/sim_context';

function isLane(n: unknown): boolean {
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
}

describe('the realm boot salt', () => {
  it('hands the realm Sim 64 fresh secret bits at every boot', () => {
    const cfg = buildRealmSimConfig(undefined, inertVaultConsumptionAdmission);
    const salt = cfg.privateSalt;
    expect(salt).toHaveLength(2);
    expect(salt?.every(isLane)).toBe(true);
    const again = buildRealmSimConfig(undefined, inertVaultConsumptionAdmission).privateSalt;
    expect(again).not.toEqual(salt);
  });

  it('draws two full uint32 lanes from the OS random source', () => {
    const seen = new Set<string>();
    let high = 0;
    for (let i = 0; i < 64; i++) {
      const salt = freshPrivateSalt();
      expect(salt.every(isLane)).toBe(true);
      seen.add(salt.join(':'));
      if (salt[0] >= 0x80000000) high++;
      if (salt[1] >= 0x80000000) high++;
    }
    expect(seen.size).toBe(64);
    expect(high).toBeGreaterThan(16);
    expect(high).toBeLessThan(112);
  });
});
