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
import { equipReferenceEpicKitForDev } from '../src/sim/dev/bis_gear';
import { Sim } from '../src/sim/sim';

// The fixture loadout the live-mob and Bruin probes equip (scripts/
// druid_balance_probe.ts runDruidLiveMobProbe / bruinFixture:
// equipReferenceEpicKitForDev over a level-20 feral druid). The bands below are
// conditioned on EXACTLY this loadout (the identity-pin-plus-band precedent of
// tests/rogue_dps_balance.test.ts), so a picker or catalog change that swaps a
// piece reds HERE with a gear message, never in a band with a damage message.
// RE-DERIVED 2026-08-31 on the merged post-eighth/ninth-sync catalog (the
// Phase 18 druid-balance-harness-drift item): the fixture wears the Crucible
// raid leather (ashveil) plus the heroic Nythraxis crown, the raid jewelry,
// and, because the reference picker scores a feral druid's mainhand on the
// caster stat bag, the wand_of_quenched_sparks. No Masterwrought piece.
const FIXTURE_LOADOUT = {
  mainhand: 'wand_of_quenched_sparks',
  helmet: 'heroic_nighttalon_crown',
  neck: 'heartspring_amulet',
  shoulder: 'ashveil_shoulder',
  chest: 'ashveil_chest',
  waist: 'cinderbark_cinch',
  legs: 'ashveil_legs',
  gloves: 'ashveil_gloves',
  feet: 'ashenbark_treads',
  ring1: 'band_of_marked_strikes',
  ring2: 'circle_of_cinders',
} as const;

// MEASURED 2026-08-31 on the merged catalog at the fixed seeds (the harness
// records no numbers of its own; the Phase 15 audit read only that the bear
// arm took 12 percent more incoming damage after the packet's defs landed,
// against `> 0` assertions that could not say so). The recorded drift was 12
// percent, so the bands sit at 8 percent either side of the measurement: a
// repeat of that drift reds, deterministic noise cannot. Payoff counts are
// small integers and pinned exactly (a moved count is a rotation change).
const LIVE_MOB_MEASURED = {
  moongrove: { damage: 3429, incomingDamage: 214, threat: 3430, payoffs: 5 },
  wildfang: { damage: 4911, incomingDamage: 205, threat: 5755.24, payoffs: 12 },
  bruin: { damage: 2589, incomingDamage: 148, threat: 8461.88, payoffs: 4 },
} as const;
const BRUIN_TANK_MEASURED = {
  wolfIncomingDamage: 229,
  bruinIncomingDamage: 147,
  bruinMitigationPct: 0.358,
  bruinThreatFrom100Damage: 214.5,
  marrowbreakSnapThreat: 896.61,
} as const;
const BAND = 0.08;
const within = (measured: number) =>
  [measured * (1 - BAND), measured * (1 + BAND)] as [number, number];

function fixtureEquipment(seed: number): Record<string, string> {
  const sim = new Sim({ seed, playerClass: 'druid', autoEquip: true });
  sim.setPlayerLevel(20);
  if (!sim.applyTalents({ spec: 'feral', rows: {} })) throw new Error('failed to apply feral');
  equipReferenceEpicKitForDev(sim.ctx, sim.player.id);
  const meta = sim.meta(sim.player.id);
  if (!meta) throw new Error('fixture druid has no PlayerMeta');
  return { ...(meta.equipment as Record<string, string>) };
}

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

  it('the live-mob and Bruin fixtures wear the pinned reference loadout', () => {
    // Identity first: every band below is conditioned on this gear. Both
    // probes build the fixture the same way (a feral druid at 20 wearing
    // equipReferenceEpicKitForDev), so one construction pins both.
    for (const seed of [42_420, 42_920]) {
      const worn = fixtureEquipment(seed);
      expect(worn, `seed ${seed} loadout`).toEqual(FIXTURE_LOADOUT);
    }
  });

  it.each(['moongrove', 'wildfang', 'bruin'] as const)(
    'executes the %s rotation against an attacking live mob inside its measured band',
    (arm) => {
      const result = runDruidLiveMobProbe(arm, 42_420);
      const measured = LIVE_MOB_MEASURED[arm];
      const [dmgLo, dmgHi] = within(measured.damage);
      expect(result.damage, `${arm} damage`).toBeGreaterThanOrEqual(dmgLo);
      expect(result.damage, `${arm} damage`).toBeLessThanOrEqual(dmgHi);
      const [inLo, inHi] = within(measured.incomingDamage);
      expect(result.incomingDamage, `${arm} incoming`).toBeGreaterThanOrEqual(inLo);
      expect(result.incomingDamage, `${arm} incoming`).toBeLessThanOrEqual(inHi);
      const [thLo, thHi] = within(measured.threat);
      expect(result.threat, `${arm} threat`).toBeGreaterThanOrEqual(thLo);
      expect(result.threat, `${arm} threat`).toBeLessThanOrEqual(thHi);
      expect(result.payoffs, `${arm} payoffs`).toBe(measured.payoffs);
    },
    30_000,
  );

  it('records Bruin mitigation, threat, taunt uptime, and exit behavior', () => {
    const result = runDruidBruinTankProbe(42_920, 'test-head');
    expect(result.head).toBe('test-head');
    expect(result.bruinIncomingDamage).toBeLessThan(result.wolfIncomingDamage);
    // The two incoming figures and the mitigation they imply are banded on
    // the 2026-08-31 measurement (wolf 229, bear 147, 35.8 percent less):
    // the drift the audit read (bear +12 percent) reds on the bear figure.
    const [wolfLo, wolfHi] = within(BRUIN_TANK_MEASURED.wolfIncomingDamage);
    expect(result.wolfIncomingDamage).toBeGreaterThanOrEqual(wolfLo);
    expect(result.wolfIncomingDamage).toBeLessThanOrEqual(wolfHi);
    const [bearLo, bearHi] = within(BRUIN_TANK_MEASURED.bruinIncomingDamage);
    expect(result.bruinIncomingDamage).toBeGreaterThanOrEqual(bearLo);
    expect(result.bruinIncomingDamage).toBeLessThanOrEqual(bearHi);
    expect(result.bruinMitigationPct).toBeGreaterThanOrEqual(0.3);
    expect(result.bruinMitigationPct).toBeLessThanOrEqual(0.42);
    // Bear form multiplies all threat by 1.3 (threat.ts) on top of the feral
    // tank talent bonus; a 100-damage hit must clear the bare 100 by half,
    // and the measured figure is pinned exactly (a flat multiplier product).
    expect(result.bruinThreatFrom100Damage).toBeGreaterThanOrEqual(150);
    expect(result.bruinThreatFrom100Damage).toBeCloseTo(
      BRUIN_TANK_MEASURED.bruinThreatFrom100Damage,
      6,
    );
    // A full-bank Marrowbreak is the snap-threat button: several swings' worth
    // of threat in one press, banded on the measurement.
    expect(result.marrowbreakSnapThreat).toBeGreaterThanOrEqual(
      result.bruinThreatFrom100Damage * 4,
    );
    const [snapLo, snapHi] = within(BRUIN_TANK_MEASURED.marrowbreakSnapThreat);
    expect(result.marrowbreakSnapThreat).toBeGreaterThanOrEqual(snapLo);
    expect(result.marrowbreakSnapThreat).toBeLessThanOrEqual(snapHi);
    expect(result.growlForcedUptimeSeconds).toBeGreaterThanOrEqual(3);
    expect(result.growlForcedUptimeSeconds).toBeLessThanOrEqual(3.1);
    expect(result.secondsToLoseThreatAfterLeaving).toBeGreaterThan(0);
    expect(result.secondsToLoseThreatAfterLeaving).toBeLessThanOrEqual(60);
  }, 60_000);

  it('keeps the Bruin tank probe deterministic at the same fixed seed', () => {
    expect(runDruidBruinTankProbe(42_921)).toEqual(runDruidBruinTankProbe(42_921));
  }, 60_000);
});
