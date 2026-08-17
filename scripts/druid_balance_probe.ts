// Druid v0.29 playtest probe. The balance matrix uses the canonical owned-class
// fixtures for 123 seconds over eight deterministic seeds, including one-target,
// three-target, healer-pressure, and all-capstone comparisons.
// npx tsx scripts/druid_balance_probe.ts

import { pathToFileURL } from 'node:url';
import { druidEngineOnLandedStrike } from '../src/sim/combat/druid_engines';
import { MOBS } from '../src/sim/data';
import { equipBestInSlotForDev } from '../src/sim/dev/bis_gear';
import { createMob } from '../src/sim/entity';
import { updateMobTarget } from '../src/sim/mob/targeting';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import {
  type OwnedClassBalanceScenario,
  runOwnedClassDpsProbe,
  runOwnedHealerProbe,
} from './owned_class_balance_probe';

export const DRUID_PROBE_SECONDS = 123;
export const DRUID_PROBE_SEEDS = [4242, 777, 1313, 99, 2024, 555, 31337, 8080] as const;
export const DRUID_CAPSTONES = {
  naturesFury: 'dru_r20_improved_hurricane',
  wildApex: 'dru_r20_berserk',
  quickening: 'dru_r20_tranquility',
} as const;

export type DruidCapstone = keyof typeof DRUID_CAPSTONES;
export type DruidProbeProfile = 'moongrove_1t' | 'moongrove_3t' | 'wildfang' | 'groveheart';

export interface DruidBalanceResult {
  profile: DruidProbeProfile;
  capstone: DruidCapstone;
  metric: 'dps' | 'hps';
  value: number;
}

export interface DruidLiveMobResult {
  arm: 'moongrove' | 'wildfang' | 'bruin';
  damage: number;
  incomingDamage: number;
  threat: number;
  payoffs: number;
}

/** The Bruin Wildfang tank profile, the druid arm of the owned-class off-tank
 *  probe (runWarspiritOfftankProbe is the reference shape): mitigation vs the
 *  Wolf posture, threat generation, Menace forced-target uptime, Marrowbreak
 *  snap threat, and threat handoff after leaving the form. */
export interface DruidBruinTankResult {
  head: string;
  seed: number;
  wolfIncomingDamage: number;
  bruinIncomingDamage: number;
  bruinMitigationPct: number;
  bruinThreatFrom100Damage: number;
  marrowbreakSnapThreat: number;
  growlForcedUptimeSeconds: number;
  secondsToLoseThreatAfterLeaving: number;
}

// A single fixed open-field anchor cannot be flat and sight-clear at EVERY world
// seed. At a few seeds the terrain under the distance-18 caster target breaks its
// line of sight and the ranged Moongrove rotation degenerately idles for the whole
// window (0 damage, full GCD idle). Those runs are anchor-terrain artifacts, not
// balance signal, so a pure-zero result is dropped from the average; a live
// rotation never reads exactly 0 over 123 seconds. Melee Wildfang, targeting at
// range 3, is unaffected. If every seed stalled (never observed) the raw mean is
// returned so the degeneracy stays visible rather than dividing by zero.
function average(values: readonly number[]): number {
  const live = values.filter((value) => value > 0);
  const sample = live.length > 0 ? live : values;
  return sample.reduce((sum, value) => sum + value, 0) / sample.length;
}

export function runDruidBalanceMatrix(
  seeds: readonly number[] = DRUID_PROBE_SEEDS,
  seconds = DRUID_PROBE_SECONDS,
): DruidBalanceResult[] {
  const results: DruidBalanceResult[] = [];
  for (const [capstone, talentId] of Object.entries(DRUID_CAPSTONES) as [DruidCapstone, string][]) {
    const row = { 20: talentId };
    for (const targets of [1, 3] as const) {
      const scenario: OwnedClassBalanceScenario = { targets, seconds: 123, window: 'raid' };
      const values = seeds.map(
        (seed) => runOwnedClassDpsProbe('moongrove', scenario, seed, 'druid-v029', row).dps,
      );
      results.push({
        profile: `moongrove_${targets}t`,
        capstone,
        metric: 'dps',
        value: average(values),
      });
    }
    const wildfangScenario: OwnedClassBalanceScenario = {
      targets: 1,
      seconds: 123,
      window: 'raid',
    };
    results.push({
      profile: 'wildfang',
      capstone,
      metric: 'dps',
      value: average(
        seeds.map(
          (seed) =>
            runOwnedClassDpsProbe('wildfang', wildfangScenario, seed, 'druid-v029', row).dps,
        ),
      ),
    });
    results.push({
      profile: 'groveheart',
      capstone,
      metric: 'hps',
      value: average(
        seeds.map(
          (seed) => runOwnedHealerProbe('groveheart', 3, seed, 'druid-v029', row, seconds).hps,
        ),
      ),
    });
  }
  return results;
}

export function bestDruidBuilds(results: readonly DruidBalanceResult[]): DruidBalanceResult[] {
  return (['moongrove_1t', 'moongrove_3t', 'wildfang', 'groveheart'] as const).map(
    (profile) =>
      results
        .filter((result) => result.profile === profile)
        .sort(
          (left, right) => right.value - left.value || left.capstone.localeCompare(right.capstone),
        )[0],
  );
}

function addLiveMob(sim: Sim, player: Entity): Entity {
  const mob = createMob(99_200, MOBS.forest_wolf, 20, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + 2,
  });
  mob.hostile = true;
  mob.hp = mob.maxHp = 1_000_000;
  mob.aiState = 'attack';
  mob.aggroTargetId = player.id;
  mob.threat.set(player.id, 1);
  (sim as unknown as { addEntity(entity: Entity): void }).addEntity(mob);
  sim.targetEntity(mob.id);
  player.facing = 0;
  return mob;
}

export function runDruidLiveMobProbe(
  arm: DruidLiveMobResult['arm'],
  seed = 42_420,
): DruidLiveMobResult {
  const sim = new Sim({ seed, playerClass: 'druid', autoEquip: true });
  sim.setPlayerLevel(20);
  const spec = arm === 'moongrove' ? 'balance' : 'feral';
  const row14 = arm === 'moongrove' ? 'dru_r14_moonfury' : 'dru_r14_savage_fury';
  if (
    !sim.applyTalents({
      spec,
      rows: { 14: row14, 20: 'dru_r20_improved_hurricane' },
    })
  ) {
    throw new Error(`could not configure ${arm}`);
  }
  equipBestInSlotForDev(sim.ctx, sim.player.id);
  const player = sim.player;
  const mob = addLiveMob(sim, player);
  player.hp = player.maxHp = 1_000_000;
  player.resource = player.maxResource;
  sim.castAbility(
    arm === 'moongrove' ? 'moonkin_form' : arm === 'wildfang' ? 'cat_form' : 'bear_form',
  );
  for (let tick = 0; tick < 40; tick++) sim.tick();
  player.resource = player.maxResource;
  if (arm !== 'moongrove') sim.startAutoAttack();

  let damage = 0;
  let incomingDamage = 0;
  let payoffs = 0;
  for (let tick = 0; tick < 30 * 20; tick++) {
    if (!player.castingAbility && player.gcdRemaining <= 0.001) {
      if (arm === 'moongrove') {
        const tempest = mob.auras.find(
          (aura) => aura.id === 'moonfire' && aura.sourceId === player.id,
        );
        const moontide = player.auras.find((aura) => aura.id === 'moontide');
        const lowMana = player.resource < player.maxResource * 0.4;
        if (!tempest || tempest.remaining <= 3) sim.castAbility('moonfire');
        else if ((moontide?.stacks ?? 0) >= 3) sim.castAbility(lowMana ? 'starfire' : 'moonseed');
        else if (!player.cooldowns.has('moonseed')) sim.castAbility('moonseed');
        else sim.castAbility('wrath');
      } else if (arm === 'wildfang') {
        const oldBlood = player.auras.find((aura) => aura.id === 'old_blood');
        if ((oldBlood?.stacks ?? 0) >= 3 && player.comboPoints >= 1) {
          sim.castAbility('ferocious_bite');
        } else if (!mob.auras.some((aura) => aura.id === 'rake' && aura.sourceId === player.id)) {
          sim.castAbility('rake');
        } else if (player.comboPoints >= 5) {
          sim.castAbility('ferocious_bite');
        } else {
          sim.castAbility('claw');
        }
      } else {
        const oldBlood = player.auras.find((aura) => aura.id === 'old_blood');
        const roar = mob.auras.find(
          (aura) => aura.id === 'demoralizing_roar_ap' && aura.sourceId === player.id,
        );
        if (!roar || roar.remaining <= 1) sim.castAbility('demoralizing_roar');
        else if ((oldBlood?.stacks ?? 0) >= 3) sim.castAbility('maul');
        else sim.castAbility('swipe');
      }
    }
    for (const event of sim.tick()) {
      if (event.type !== 'damage') continue;
      if (event.sourceId === player.id && event.targetId === mob.id) {
        damage += event.amount;
        if (
          event.ability === 'Moonsurge' ||
          event.ability === 'Sunwake' ||
          event.ability === 'Redharvest' ||
          event.ability === 'Marrowbreak'
        ) {
          payoffs++;
        }
      } else if (event.sourceId === mob.id && event.targetId === player.id) {
        incomingDamage += event.amount;
      }
    }
  }
  return {
    arm,
    damage,
    incomingDamage,
    threat: mob.threat.get(player.id) ?? 0,
    payoffs,
  };
}

function bruinFixture(seed: number): Sim {
  const sim = new Sim({ seed, playerClass: 'druid', autoEquip: true });
  sim.setPlayerLevel(20);
  if (!sim.applyTalents({ spec: 'feral', rows: {} })) {
    throw new Error('failed to apply feral');
  }
  equipBestInSlotForDev(sim.ctx, sim.player.id);
  return sim;
}

// Real mob swings for 30 seconds against a passive druid: armor applies at the
// swing layer (auto_attack.ts), so a synthetic dealDamage would read 0%
// mitigation. The passive window isolates the defense delta between forms.
function incomingDamageForDruidForm(form: 'cat_form' | 'bear_form', seed: number): number {
  const sim = bruinFixture(seed);
  const player = sim.player;
  addLiveMob(sim, player);
  player.gcdRemaining = 0;
  player.resource = player.maxResource;
  sim.castAbility(form);
  sim.tick();
  player.hp = player.maxHp = 1_000_000;
  const before = player.hp;
  for (let tick = 0; tick < 30 * 20; tick++) sim.tick();
  return before - player.hp;
}

export function runDruidBruinTankProbe(seed = 42_920, head = 'working-tree'): DruidBruinTankResult {
  const wolfIncomingDamage = incomingDamageForDruidForm('cat_form', seed);
  const bruinIncomingDamage = incomingDamageForDruidForm('bear_form', seed);
  const sim = bruinFixture(seed);
  const player = sim.player;
  const rivalId = sim.addPlayer('warrior', 'Threat Rival');
  sim.setPlayerLevel(20, rivalId);
  const rival = sim.entities.get(rivalId);
  if (!rival) throw new Error('missing threat rival');
  const target = addLiveMob(sim, player);
  player.hp = player.maxHp = 1_000_000;
  player.gcdRemaining = 0;
  player.resource = player.maxResource;
  sim.castAbility('bear_form');
  sim.tick();

  target.threat.clear();
  sim.ctx.dealDamage(player, target, 100, false, 'physical', 'Threat Probe', 'hit', false);
  const bruinThreatFrom100Damage = target.threat.get(player.id) ?? 0;

  // Full-bank Marrowbreak above half health: burst plus snap threat.
  target.threat.clear();
  druidEngineOnLandedStrike(sim.ctx, player, 'maul');
  druidEngineOnLandedStrike(sim.ctx, player, 'swipe');
  druidEngineOnLandedStrike(sim.ctx, player, 'maul');
  player.hp = player.maxHp;
  player.resource = 100;
  player.gcdRemaining = 0;
  sim.castAbility('maul');
  const marrowbreakSnapThreat = target.threat.get(player.id) ?? 0;

  // Menace (growl): the taunt must force the boss for its full window.
  target.threat.set(rival.id, 1_000);
  target.aggroTargetId = rival.id;
  player.gcdRemaining = 0;
  sim.castAbility('growl');
  let forcedTicks = 0;
  while (target.forcedTargetTimer > 0 && forcedTicks < 100) {
    updateMobTarget(sim.ctx, target);
    forcedTicks++;
  }

  // Leaving Bruin keeps the accumulated threat; the rival overtakes on the
  // classic 110% rule while stacking 25 threat per second.
  target.forcedTargetId = null;
  target.forcedTargetTimer = 0;
  target.threat.set(rival.id, 1_000);
  target.threat.set(player.id, 1_000);
  target.aggroTargetId = player.id;
  player.gcdRemaining = 0;
  player.resource = player.maxResource;
  sim.castAbility('cat_form');
  sim.tick();
  let secondsToLoseThreatAfterLeaving = 0;
  while (target.aggroTargetId === player.id && secondsToLoseThreatAfterLeaving < 60) {
    secondsToLoseThreatAfterLeaving++;
    target.threat.set(rival.id, (target.threat.get(rival.id) ?? 0) + 25);
    updateMobTarget(sim.ctx, target);
  }
  return {
    head,
    seed,
    wolfIncomingDamage,
    bruinIncomingDamage,
    bruinMitigationPct: 1 - bruinIncomingDamage / wolfIncomingDamage,
    bruinThreatFrom100Damage,
    marrowbreakSnapThreat,
    growlForcedUptimeSeconds: forcedTicks / 20,
    secondsToLoseThreatAfterLeaving,
  };
}

function printResults(): void {
  const results = runDruidBalanceMatrix(
    process.env.WOC_PROBE_QUICK ? [DRUID_PROBE_SEEDS[0]] : DRUID_PROBE_SEEDS,
  );
  console.log('profile,capstone,metric,value');
  for (const result of results) {
    console.log(`${result.profile},${result.capstone},${result.metric},${result.value.toFixed(1)}`);
  }
  for (const arm of ['moongrove', 'wildfang', 'bruin'] as const) {
    const live = runDruidLiveMobProbe(arm);
    console.log(
      `live_${arm},best,damage,${live.damage}; incoming=${live.incomingDamage}; threat=${live.threat.toFixed(1)}; payoffs=${live.payoffs}`,
    );
  }
  const tank = runDruidBruinTankProbe();
  console.log(
    `bruin tank  ${tank.bruinIncomingDamage}/${tank.wolfIncomingDamage} incoming ` +
      `(${(tank.bruinMitigationPct * 100).toFixed(1)}% less), ` +
      `${tank.bruinThreatFrom100Damage} threat/100 damage, ` +
      `Marrowbreak ${tank.marrowbreakSnapThreat.toFixed(1)} snap threat, ` +
      `${tank.growlForcedUptimeSeconds.toFixed(1)} sec forced, ` +
      `${tank.secondsToLoseThreatAfterLeaving} sec to lose threat`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) printResults();
