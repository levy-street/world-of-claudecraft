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
// equipReferenceEpicKitForDev over a level-20 druid, balance and feral both).
// The bands below are conditioned on EXACTLY this loadout (the
// identity-pin-plus-band precedent of tests/rogue_dps_balance.test.ts), so a
// picker or catalog change that swaps a piece reds HERE with a gear message,
// never in a band with a damage message.
// RE-DERIVED 2026-09-08 after the v0.42.0 release merge (release integration
// dca7476) landed on the historical harness: a virtual replay of the
// pre-merge catalog at commit f73615a511 reproduces the old pin exactly
// (moongrove 3429/214/3430/5, wildfang 4911/205/5755.24/12, bruin
// 2589/148/8461.88/4, tank 229/147/0.358/214.5/896.61), confirming those
// anchors belong to the older tree, not this one. Against that confirmed
// baseline the merged catalog's reference picker changed exactly two slots:
// helmet heroic_nighttalon_crown -> heroic_bramblehide_crown and feet
// ashenbark_treads -> heroic_bramblehide_treads (Bramblehide is not
// spec-restricted at the equip gate). The other nine slots are unchanged.
// RE-DERIVED 2026-09-10 with the stamina baseline model (src/sim/item_budget.ts):
// the reference picker now scores only the class LINE plus stamina (a caster
// piece totals a third more than a physical one of the same tier, so a raw
// five-stat sum would have dressed every class in healer gear), which means the
// balance and feral fixtures no longer share one loadout. The balance druid
// wears caster leather (crucible caster chest and waist, Grovespring, the
// Thornpeak cowl, caster rings) instead of the Ashveil physical set and a
// Strength ring it wore by accident of the old sum; the feral and Bruin
// fixtures keep Ashveil and swap their two caster jewelry slots for Ignivar's
// Ember Choker and the Seal of the Forgewall. Both are pinned on their own.
// Since 2026-10-12 the picker skips Healing Power pieces for non-healer specs,
// so the balance druid wears Moonscorch and spell-damage jewelry in place of
// the Grovespring healer set, Heartspring Amulet and Loop of Quiet Springs.
const BALANCE_LOADOUT = {
  mainhand: 'wand_of_quenched_sparks',
  helmet: 'heroic_thornpeak_moonhide_cowl',
  neck: 'locket_of_the_last_flame',
  shoulder: 'moonscorch_shoulder',
  chest: 'crucible_caster_leather_chest',
  waist: 'crucible_caster_leather_waist',
  legs: 'moonscorch_legs',
  gloves: 'moonscorch_gloves',
  feet: 'heroic_bramblehide_treads',
  ring1: 'circle_of_cinders',
  ring2: 'champions_dawn_loop',
  // The trinket slot (PR 4173): the reference epic kit fills it with the
  // Varkhul caster trinket; the live-mob bands below held at the same seed.
  trinket: 'heart_of_the_crucible',
} as const;
const FERAL_LOADOUT = {
  mainhand: 'wand_of_quenched_sparks',
  helmet: 'heroic_bramblehide_crown',
  neck: 'ignivars_ember_choker',
  shoulder: 'ashveil_shoulder',
  chest: 'ashveil_chest',
  waist: 'cinderbark_cinch',
  legs: 'ashveil_legs',
  gloves: 'ashveil_gloves',
  feet: 'heroic_bramblehide_treads',
  ring1: 'band_of_marked_strikes',
  ring2: 'seal_of_the_forgewall',
  // The trinket slot (PR 4173): the reference epic kit's physical pick.
  trinket: 'forgefathers_temper',
} as const;

// MEASURED 2026-09-08 on the merged release catalog (integration dca7476) at
// the fixed seeds. This is a full-world probe (shared RNG plus live mobs), so
// a release world change can move sampling on its own; not every delta below
// is a tuning change. It is also not gear alone: an old-gear-only virtual
// restriction against the historical catalog did NOT reproduce the old
// numbers. The merge does carry documented feral tuning in the same
// integration (src/sim/content/spec_baselines.ts stats.apPct +0.1;
// src/sim/spec_output_tuning.ts physical offensive +0.15). Bands stay at
// BAND=0.08 either side of the new measurement; payoff counts are small
// integers and stay pinned exactly (a moved count is a rotation change).
// RE-MEASURED 2026-09-10 on the stamina baseline model at the same seeds. The
// gear moved first (the loadout pins above), and the bands follow it: moongrove
// in caster leather instead of the Ashveil physical set (damage 3655 to 5956,
// payoffs 5 to 7), wildfang and bruin with physical jewelry instead of caster
// jewelry (5896 to 6378 and 2803 to 3082, payoffs 10 to 12 and 3 to 4). The
// Bruin tank probe below did not leave its bands (snap threat 990.99 to
// 1003.86) and keeps its 2026-09-08 anchors.
// RE-MEASURED 2026-09-20 for the wildfang arm only, at the v0.43 feral pass:
// Nature's Boon (src/sim/combat/druid_natures_boon.ts) draws one rng per
// LANDED feral melee auto-attack, so every feral trace after the first landed
// swing re-rolls. Not a rotation or tuning change: with that one draw
// commented out this seed reproduces the 2026-09-10 row exactly (6378/286/
// 7473.827/12), and across seeds 42421 to 42425 the same rotation lands 6316
// to 6801 with the draw and 5299 to 6928 without it, so seed 42420 simply
// re-rolled onto a low trace (8 payoffs, 4921). Moongrove is Balance (the
// draw is feral-gated) and Bruin stayed inside its bands, so both keep their
// 2026-09-10 anchors.
// RE-MEASURED 2026-09-24 for the wildfang arm only, at the release/v0.44.0
// base merge into integration/world-quests-v0440 (65d4218ba1 + 7054645a6b):
// the same seed on the merged world (the branch's quartermasters, taskmaster
// and world-quest content beside the release's Boon draw) re-rolls the feral
// trace onto a higher one (damage 4921 to 5315, incoming 159 to 201, threat
// 5766.952 to 6228.5225), still 8 payoffs, so the rotation did not change.
// Measured identically on the integration tip and on the faction ladder
// branch (PR 4169). Moongrove (5982/225/5983/7) and Bruin (3060/139/
// 10541.4575/4) stayed inside their bands and keep their anchors.
// RE-MEASURED 2026-10-13 for all three arms, at the four built dungeon
// entrances (src/sim/*_entrance.ts). No druid, combat or tuning code moved:
// the entrances' colliders push the spawn point of three neighbouring world
// mobs, the Wildheart Basin door moved and the Idol Guardian's camp with it,
// and every world mob's idle wander draws from the shared stream, so this
// seed's whole trace re-rolls. Moongrove 5956/212/5957/7 to 5637/273/5638/7
// (only the wolf's incoming left its old band), wildfang 5315/201/6228.5225/8
// to 6126/172/7178.609/10 (off the low eight-payoff trace it had sat on since
// 2026-09-20), bruin 3082/131/10651.925/4 to 2721/142/8804.0075/4. Each new
// row is an ordinary trace of the same rotation on this tree, read against
// the neighbouring seeds: moongrove 5329 to 6004 damage and 208 to 285
// incoming over seeds 42421 to 42436 (payoffs 7 on every one); wildfang 5962
// to 7419 damage, 168 to 266 incoming and 10 or 12 payoffs over 42421 to
// 42428; bruin 2309 to 3240 damage, 96 to 161 incoming and 3 or 4 payoffs
// over the same eight. The matrix test below, whose bands are design bands
// rather than measurements, still holds on this tree. BAND stays 0.08.
// RE-MEASURED 2026-10-15 for all three arms and the tank probe's two incoming
// figures, at the Fenbridge rebuild (src/sim/fenbridge_layout.ts: the painted
// buildings, the open ring, the walk-in floors, the re-threaded streets and
// lamps). No druid, combat or tuning code moved: the town's colliders and
// walkable ground are world-gen inputs and every world mob's idle wander draws
// from the shared stream, so this seed's whole trace re-rolls. Moongrove
// 5637/273/5638/7 to 5455/251/5456/7, wildfang 6126/172/7178.609/10 to
// 6558/197/7684.697/10, bruin 2721/142/8804.0075/4 to 2891/159/9807.33125/4.
// The neighbouring seeds on this tree: moongrove 5557 to 6068 damage and 193
// to 285 incoming over 42421 to 42436 (payoffs 7 on every one); wildfang 6120
// to 7439 damage, 191 to 278 incoming and 10 or 12 payoffs over 42421 to
// 42428; bruin 2309 to 3075 damage, 96 to 160 incoming and 3 or 4 payoffs over
// the same eight. The tank probe at 42920 re-rolls the same way: wolf incoming
// 220 to 262, bear 143 to 157 (40 percent less, inside the 30 to 42 percent
// bounds); its threat product and Marrowbreak snap stayed in band.
// RE-MEASURED 2026-10-20 for all three arms and the tank probe's two incoming
// figures, when the Mirefen mudfin huts became solid walls
// (src/sim/mudfin_huts.ts). No druid, combat or tuning code moved: the camp
// murlocs' idle wander now settles on other ticks, so this seed's whole trace
// re-rolls again. Moongrove 5455/251/5456/7 to 5492/241/5493/7, wildfang
// 6558/197/7684.697/10 to 6389/213/7486.7135/10, bruin 2891/159/9807.33125/4
// to 2765/162/9243.19625/4. The neighbouring seeds on this tree: moongrove 5346
// to 6045 damage and 190 to 277 incoming over 42421 to 42436 (payoffs 7 on
// every one); wildfang 5868 to 7233 damage, 216 to 262 incoming and 10 or 12
// payoffs over 42421 to 42428; bruin 2687 to 3082 damage, 112 to 163 incoming
// and 4 payoffs over the same eight. The tank probe at 42920 re-rolls the same
// way: wolf incoming 262 to 212, bear 157 to 126 (41 percent less, inside the
// 30 to 42 percent bounds); its threat product and Marrowbreak snap stayed in
// band.
// RE-MEASURED 2026-10-21 for the tank probe's two incoming figures, at the
// wander fix around those huts (an idle pick inside a hut wall is skipped for
// one more pause, mob/locomotion.ts). No druid, combat or tuning code moved:
// the murlocs' wander draws fork the shared stream again. Wolf incoming 212 to
// 216, bear 126 to 139 (36 percent less, inside the 30 to 42 percent bounds);
// its threat product (214.5) and Marrowbreak snap (1012.44) stayed in band, and
// all three live-mob arms stayed inside their bands, so they are unchanged.
// RE-MEASURED 2026-10-12 for the moongrove arm only: the reference picker
// (src/sim/dev/bis_gear.ts) stopped handing non-healer specs Healing Power
// pieces, so the balance druid swaps the Grovespring healer set and healer
// jewelry for its own Moonscorch set and spell-damage jewelry. Damage 5956 to
// 6115 and threat 5957 to 6116 stayed in band; incoming 212 to 242 left it
// (the healer pieces' extra Spirit and Stamina are gone), still 7 payoffs.
// RE-MEASURED 2026-10-14 after the v0.45 integration stack: moongrove kept
// its damage/threat/payoff trace, while incoming settled back to 214.
const LIVE_MOB_MEASURED = {
  // Release merge: the caster picker excludes healer gear; Bruin gains its new
  // double-swing/rage cadence. Authored-world wander also changes shared RNG.
  // Re-measured at 42420 with the unchanged 8% bands and exact payoff counts.
  moongrove: { damage: 6839, incomingDamage: 237, threat: 6840, payoffs: 7 },
  wildfang: { damage: 6389, incomingDamage: 213, threat: 7486.7135, payoffs: 10 },
  bruin: { damage: 3254, incomingDamage: 159, threat: 12206.51375, payoffs: 6 },
} as const;
const BRUIN_TANK_MEASURED = {
  wolfIncomingDamage: 216,
  bruinIncomingDamage: 139,
  bruinMitigationPct: 0.35,
  bruinThreatFrom100Damage: 214.5,
  marrowbreakSnapThreat: 990.99,
} as const;
const BAND = 0.08;
const within = (measured: number) =>
  [measured * (1 - BAND), measured * (1 + BAND)] as [number, number];

function fixtureEquipment(
  seed: number,
  spec: 'balance' | 'feral',
  rows: Record<number, string>,
): Record<string, string> {
  const sim = new Sim({ seed, playerClass: 'druid', autoEquip: true });
  sim.setPlayerLevel(20);
  if (!sim.applyTalents({ spec, rows })) throw new Error(`failed to apply ${spec}`);
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
    // On the v0.45.0 integration world it measured 362s on a green lane run
    // (39322453017) and passed 420s on a slower runner (39338836719), so it
    // takes the single-test cap.
  }, 480_000);

  it('the live-mob and Bruin fixtures wear the pinned reference loadout', () => {
    // Identity first: every band below is conditioned on this gear, and the
    // three probes do NOT build the fixture the same way, so each
    // construction is pinned on its own rather than assuming one covers all
    // (mirrors scripts/druid_balance_probe.ts exactly):
    // runDruidLiveMobProbe builds moongrove on balance (row14
    // dru_r14_moonfury) and wildfang/bruin on feral (row14
    // dru_r14_savage_fury), both with row20 dru_r20_improved_hurricane; the
    // Bruin tank probe (bruinFixture) builds feral with no talent rows.
    const balanceLive = fixtureEquipment(42_420, 'balance', {
      14: 'dru_r14_moonfury',
      20: 'dru_r20_improved_hurricane',
    });
    expect(balanceLive, 'balance live loadout').toEqual(BALANCE_LOADOUT);
    const feralLive = fixtureEquipment(42_420, 'feral', {
      14: 'dru_r14_savage_fury',
      20: 'dru_r20_improved_hurricane',
    });
    expect(feralLive, 'feral live loadout').toEqual(FERAL_LOADOUT);
    const tank = fixtureEquipment(42_920, 'feral', {});
    expect(tank, 'Bruin tank loadout').toEqual(FERAL_LOADOUT);
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
    // the 2026-09-08 measurement (wolf 220, bear 143, 35 percent less),
    // re-measured 2026-10-15 for the Fenbridge rebuild (wolf 262, bear 157)
    // and 2026-10-20 for the solid Mirefen mudfin huts (wolf 212, bear 126),
    // then 2026-10-21 for the wander fix around them (wolf 216, bear 139):
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
