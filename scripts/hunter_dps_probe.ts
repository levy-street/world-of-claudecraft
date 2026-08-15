import { MOBS } from '../src/sim/data';
import { createMob } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import { dist2d, type Entity, type SimEvent } from '../src/sim/types';
import { anchorProbeInOpenField } from './probe_anchor';

type HunterSpec = 'beast_mastery' | 'marksmanship' | 'survival';
type ProbeSim = Sim & {
  addEntity(entity: Entity): void;
  nextId: number;
};

export interface HunterDpsResult {
  spec: HunterSpec;
  targets: number;
  seconds: number;
  damage: number;
  dps: number;
  breakdown: Record<string, number>;
}

const SPECS: HunterSpec[] = ['beast_mastery', 'marksmanship', 'survival'];

function addTarget(sim: ProbeSim, xOffset: number, distance: number): Entity {
  const target = createMob(sim.nextId++, MOBS.training_dummy, 20, {
    x: sim.player.pos.x + xOffset,
    y: sim.player.pos.y,
    z: sim.player.pos.z + distance,
  });
  target.hostile = true;
  target.aiState = 'idle';
  target.moveSpeed = 0;
  target.maxHp = 100_000_000;
  target.hp = target.maxHp;
  target.weapon.min = 0;
  target.weapon.max = 0;
  target.weapon.speed = 100;
  sim.addEntity(target);
  return target;
}

function addPet(sim: ProbeSim, target: Entity): Entity {
  const pet = createMob(sim.nextId++, MOBS.forest_wolf, 20, {
    x: target.pos.x + 1,
    y: target.pos.y,
    z: target.pos.z - 2,
  });
  pet.hostile = false;
  pet.ownerId = sim.playerId;
  pet.maxHp = 1_000_000;
  pet.hp = pet.maxHp;
  pet.aggroTargetId = target.id;
  pet.inCombat = true;
  sim.addEntity(pet);
  return pet;
}

function ready(sim: Sim, abilityId: string): boolean {
  const resolved = sim.resolvedAbility(abilityId);
  if (!resolved) return false;
  if (sim.player.cooldowns.has(resolved.def.id)) return false;
  return sim.player.resource >= resolved.cost;
}

function castPacklord(sim: Sim): void {
  const command = sim.resolvedAbility('pack_command');
  if (command?.def.id === 'unleash_beast' && ready(sim, 'pack_command')) {
    sim.castAbility('pack_command');
    return;
  }
  if (ready(sim, 'bestial_wrath')) {
    sim.castAbility('bestial_wrath');
    return;
  }
  if (ready(sim, 'arcane_shot')) {
    sim.castAbility('arcane_shot');
    return;
  }
  if (ready(sim, 'pack_command')) sim.castAbility('pack_command');
}

function castColdsight(sim: Sim): void {
  if (ready(sim, 'cold_focus')) {
    sim.castAbility('cold_focus');
    return;
  }
  if (ready(sim, 'rapid_fire')) {
    sim.castAbility('rapid_fire');
    return;
  }
  if (ready(sim, 'aimed_shot')) {
    sim.castAbility('aimed_shot');
    return;
  }
  if (ready(sim, 'measured_shot')) sim.castAbility('measured_shot');
}

function castFieldcraft(sim: Sim, target: Entity): void {
  const wound = target.auras.some(
    (aura) => aura.id === 'bloodhook_bleed' && aura.sourceId === sim.playerId,
  );
  if (ready(sim, 'bloodtrail_assault')) {
    sim.castAbility('bloodtrail_assault');
    return;
  }
  if (!wound && ready(sim, 'bloodhook')) {
    if (dist2d(sim.player.pos, target.pos) >= 8) sim.castAbility('bloodhook');
    else if (ready(sim, 'trailbreak')) sim.castAbility('trailbreak');
    return;
  }
  if (ready(sim, 'shrapnel_charge')) {
    sim.castAbility('shrapnel_charge');
    return;
  }
  if (wound && ready(sim, 'mongoose_bite')) {
    sim.castAbility('mongoose_bite');
    return;
  }
  if (dist2d(sim.player.pos, target.pos) <= 5 && ready(sim, 'raptor_strike')) {
    sim.castAbility('raptor_strike');
  }
}

function rotation(sim: Sim, spec: HunterSpec, target: Entity): void {
  if (sim.player.dead || sim.player.castingAbility || sim.player.gcdRemaining > 0.001) return;
  if (sim.player.chargeTargetId !== null) return;
  if (spec === 'beast_mastery') castPacklord(sim);
  else if (spec === 'marksmanship') castColdsight(sim);
  else castFieldcraft(sim, target);
}

function damageFrom(
  events: SimEvent[],
  sourceIds: ReadonlySet<number>,
  breakdown: Record<string, number>,
): number {
  let damage = 0;
  for (const event of events) {
    if (event.type === 'damage' && sourceIds.has(event.sourceId) && event.amount > 0) {
      damage += event.amount;
      const ability = event.ability ?? 'Auto Attack';
      breakdown[ability] = (breakdown[ability] ?? 0) + event.amount;
    }
  }
  return damage;
}

export function runHunterDpsProbe(
  spec: HunterSpec,
  seed: number,
  targets = 1,
  seconds = 120,
): HunterDpsResult {
  const sim = new Sim({ seed, playerClass: 'hunter', autoEquip: true }) as ProbeSim;
  sim.setPlayerLevel(20);
  anchorProbeInOpenField(sim);
  if (!sim.applyTalents({ spec, rows: {} })) throw new Error(`failed to apply ${spec}`);
  const primary = addTarget(sim, 0, spec === 'survival' ? 12 : 20);
  for (let index = 1; index < targets; index++) {
    addTarget(sim, index % 2 === 0 ? -2 : 2, spec === 'survival' ? 12 : 20);
  }
  const pet = addPet(sim, primary);
  sim.targetEntity(primary.id);
  sim.startAutoAttack();
  const sourceIds = new Set([sim.playerId, pet.id]);
  let damage = 0;
  const breakdown: Record<string, number> = {};
  for (let tick = 0; tick < seconds * 20; tick++) {
    rotation(sim, spec, primary);
    damage += damageFrom(sim.tick(), sourceIds, breakdown);
  }
  return { spec, targets, seconds, damage, dps: damage / seconds, breakdown };
}

export function averageHunterDps(
  spec: HunterSpec,
  targets: number,
  seconds: number,
  seeds = [29001, 29002, 29003, 29004, 29005],
): HunterDpsResult {
  const runs = seeds.map((seed) => runHunterDpsProbe(spec, seed, targets, seconds));
  const damage = runs.reduce((sum, result) => sum + result.damage, 0) / runs.length;
  const breakdown: Record<string, number> = {};
  for (const run of runs) {
    for (const [ability, amount] of Object.entries(run.breakdown)) {
      breakdown[ability] = (breakdown[ability] ?? 0) + amount / runs.length;
    }
  }
  return { spec, targets, seconds, damage, dps: damage / seconds, breakdown };
}

if (process.argv[1]?.endsWith('hunter_dps_probe.ts')) {
  for (const targets of [1, 3]) {
    const results = SPECS.map((spec) => averageHunterDps(spec, targets, 120));
    const packlord = results[0].dps;
    console.log(`Hunter deterministic ${targets}-target fixture`);
    for (const result of results) {
      console.log(
        `${result.spec.padEnd(15)} ${result.dps.toFixed(2)} DPS  index ${((result.dps / packlord) * 100).toFixed(1)}`,
      );
      const composition = Object.entries(result.breakdown)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([ability, amount]) => `${ability} ${(amount / result.seconds).toFixed(1)}`)
        .join(', ');
      console.log(`  ${composition}`);
    }
  }
}
