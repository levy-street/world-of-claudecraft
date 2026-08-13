import { describe, expect, it } from 'vitest';
import {
  bestDruidBuilds,
  DRUID_CAPSTONES,
  DRUID_PROBE_SECONDS,
  DRUID_PROBE_SEEDS,
  runDruidBalanceMatrix,
  runDruidBruinTankProbe,
  runDruidLiveMobProbe,
} from '../scripts/druid_balance_probe';

describe('Druid v0.29 balance and live-mob harness', () => {
  it('defines the PDF-required 123-second, eight-seed, all-capstone matrix', () => {
    expect(DRUID_PROBE_SECONDS).toBe(123);
    expect(DRUID_PROBE_SEEDS).toHaveLength(8);
    expect(Object.keys(DRUID_CAPSTONES)).toEqual(['naturesFury', 'wildApex', 'quickening']);

    const results = runDruidBalanceMatrix([DRUID_PROBE_SEEDS[0]]);
    expect(results).toHaveLength(12);
    expect(new Set(results.map((result) => result.profile))).toEqual(
      new Set(['moongrove_1t', 'moongrove_3t', 'wildfang', 'groveheart']),
    );
    expect(new Set(results.map((result) => result.capstone))).toEqual(
      new Set(['naturesFury', 'wildApex', 'quickening']),
    );

    const best = bestDruidBuilds(results);
    const moongrove = best.find((result) => result.profile === 'moongrove_1t');
    const wildfang = best.find((result) => result.profile === 'wildfang');
    // This probe runs a fixed level-20 loadout, a low-SP proxy for Balance (spell
    // power ~105). Balance is re-seated onto spell-power coefficients calibrated
    // so its real searched best-in-slot (spell power ~150) lands at the ~200 DPS
    // Nythraxis anchor; on this proxy it reads ~160. Wildfang (agility melee) is
    // not under-geared here, so the arms are not directly comparable on the proxy
    // (real BiS parity is the montecarlo's job). These bands guard the proxy only.
    expect(moongrove?.value).toBeGreaterThanOrEqual(140);
    expect(moongrove?.value).toBeLessThanOrEqual(185);
    expect(wildfang?.value).toBeGreaterThanOrEqual(165);
    expect(wildfang?.value).toBeLessThanOrEqual(205);
    expect(best.find((result) => result.profile === 'moongrove_3t')?.value).toBeGreaterThan(0);
    expect(best.find((result) => result.profile === 'groveheart')?.value).toBeGreaterThan(0);
    // 12 profile x capstone combos over a 123s window: ~90-105s solo. In the
    // long-sims lane (workers=2) two heavy suites share the runner, roughly
    // doubling wall time (run 31288946173 killed this at 150s mid-matrix).
  }, 420_000);

  it.each(['moongrove', 'wildfang', 'bruin'] as const)(
    'executes the %s rotation against an attacking live mob',
    (arm) => {
      const result = runDruidLiveMobProbe(arm, 42_420);
      expect(result.damage).toBeGreaterThan(0);
      expect(result.incomingDamage).toBeGreaterThan(0);
      expect(result.threat).toBeGreaterThan(0);
      expect(result.payoffs).toBeGreaterThan(0);
    },
    30_000,
  );

  it('records Bruin mitigation, threat, taunt uptime, and exit behavior', () => {
    const result = runDruidBruinTankProbe(42_920, 'test-head');
    expect(result.head).toBe('test-head');
    expect(result.bruinIncomingDamage).toBeLessThan(result.wolfIncomingDamage);
    expect(result.bruinMitigationPct).toBeGreaterThanOrEqual(0.15);
    // Bear form multiplies all threat by 1.3 (threat.ts) on top of the feral
    // tank talent bonus; a 100-damage hit must clear the bare 100 by half.
    expect(result.bruinThreatFrom100Damage).toBeGreaterThanOrEqual(150);
    // A full-bank Marrowbreak is the snap-threat button: several swings' worth
    // of threat in one press.
    expect(result.marrowbreakSnapThreat).toBeGreaterThanOrEqual(
      result.bruinThreatFrom100Damage * 4,
    );
    expect(result.growlForcedUptimeSeconds).toBeGreaterThanOrEqual(3);
    expect(result.growlForcedUptimeSeconds).toBeLessThanOrEqual(3.1);
    expect(result.secondsToLoseThreatAfterLeaving).toBeGreaterThan(0);
    expect(result.secondsToLoseThreatAfterLeaving).toBeLessThanOrEqual(60);
  }, 60_000);

  it('keeps the Bruin tank probe deterministic at the same fixed seed', () => {
    expect(runDruidBruinTankProbe(42_921)).toEqual(runDruidBruinTankProbe(42_921));
  }, 60_000);
});
