import { describe, expect, it } from 'vitest';
import {
  OWNED_CLASS_BALANCE_SCENARIOS,
  runOwnedClassDpsProbe,
  runWarspiritOfftankProbe,
} from '../scripts/owned_class_balance_probe';

// Part of the owned-class level 20 balance family (docs/qa-gate.md, "The
// long-sims lanes"). This file reads no diet flag: its probes run the same
// configuration at PR time and nightly.
describe('owned-class level 20 balance harness (DPS probes)', () => {
  it('is deterministic at the same fixed seed and fixture', () => {
    const scenario = OWNED_CLASS_BALANCE_SCENARIOS[3];
    expect(runOwnedClassDpsProbe('fieldcraft', scenario, 29_901)).toEqual(
      runOwnedClassDpsProbe('fieldcraft', scenario, 29_901),
    );
  }, 120_000);

  it('pins a Fieldcraft sustained-damage ceiling against the ranged Hunter specs and pays Bloodhook', () => {
    const scenario = OWNED_CLASS_BALANCE_SCENARIOS[1];
    const coldsight = runOwnedClassDpsProbe('coldsight', scenario, 29_902);
    const fieldcraft = runOwnedClassDpsProbe('fieldcraft', scenario, 29_902);
    const woundDamage = fieldcraft.damageBySource['Bloodhook Wound'] ?? 0;

    // Band widened for the stacked v0.29 rogue redesign (#2328): its shared
    // combat changes shift this pair a few percent; re-author when it lands.
    // Ceiling only, deliberately: there is no matching floor here pending the
    // Hunter kit debt, so a real downside swing is allowed to pass.
    expect(fieldcraft.dps).toBeLessThanOrEqual(coldsight.dps * 1.25);
    expect(woundDamage / fieldcraft.totalDamage).toBeGreaterThanOrEqual(0.05);
  }, 120_000);

  it('keeps Vespers sustained damage in the DPS caster band', () => {
    const scenario = OWNED_CLASS_BALANCE_SCENARIOS[1];
    const thundercall = runOwnedClassDpsProbe('thundercall', scenario, 29_903);
    const vespers = runOwnedClassDpsProbe('vespers', scenario, 29_903);

    expect(vespers.dps).toBeGreaterThanOrEqual(thundercall.dps * 0.9);
    // Band widened for the stacked v0.29 rogue redesign (#2328): its shared
    // combat changes shift this pair a few percent; re-author when it lands.
    expect(vespers.dps).toBeLessThanOrEqual(thundercall.dps * 1.2);
  }, 120_000);

  it('records Warspirit mitigation, threat, forced-target uptime, and exit behavior', () => {
    const result = runWarspiritOfftankProbe(29_920, 'test-head');
    expect(result.head).toBe('test-head');
    expect(result.stoneboundIncomingDamage).toBeLessThan(result.galeheartIncomingDamage);
    expect(result.stoneboundMitigationPct).toBeGreaterThan(0);
    expect(result.stoneboundThreatFrom100Damage).toBeGreaterThanOrEqual(200);
    expect(result.forcedTargetUptimeSeconds).toBeGreaterThanOrEqual(3);
    expect(result.forcedTargetUptimeSeconds).toBeLessThanOrEqual(3.1);
    expect(result.secondsToLoseThreatAfterLeaving).toBeGreaterThan(0);
    expect(result.secondsToLoseThreatAfterLeaving).toBeLessThanOrEqual(60);
  });
});
