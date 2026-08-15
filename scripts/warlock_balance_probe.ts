import { pathToFileURL } from 'node:url';
import { ruinAmount } from '../src/sim/combat/destruction';
import { addSoulFragments, soulFragmentCount } from '../src/sim/combat/necromancy';
import { MOBS } from '../src/sim/data';
import { createMob, type PlayerEquipment, recalcPlayerStats } from '../src/sim/entity';
import { Sim } from '../src/sim/sim';
import type { Entity, SimEvent } from '../src/sim/types';

export type WarlockBalanceSpec = 'affliction' | 'destruction' | 'demonology';

export interface WarlockBalanceResult {
  spec: WarlockBalanceSpec;
  seed: number;
  seconds: number;
  damage: number;
  dps: number;
  manaAveragePct: number;
  manaEndPct: number;
  starvedPct: number;
  damageByAbility: Record<string, number>;
}

const TALENT_ROWS = {
  affliction: {
    14: 'wlk_r14_ruin',
    17: 'wlk_r17_improved_fear',
    20: 'wlk_r20_chaos_bolt',
  },
  destruction: {
    14: 'wlk_r14_shadow_mastery',
    17: 'wlk_r17_improved_fear',
    20: 'wlk_r20_chaos_bolt',
  },
  demonology: {
    14: 'wlk_r14_shadow_mastery',
    17: 'wlk_r17_improved_fear',
    20: 'wlk_r20_chaos_bolt',
  },
} as const;

// Canonical PBE true-BiS caster kit from server/pbe_boost.ts. Keep this
// explicit so the benchmark neither imports the server/DB graph nor silently
// falls back to the generic epic-only /dev bis scorer.
export const WARLOCK_FULL_BIS_GEAR: PlayerEquipment = {
  helmet: 'sunbone_oracles_crown',
  neck: 'zense_meridian',
  shoulder: 'sunken_court_mantle',
  chest: 'shroud_of_the_gravewyrm',
  mainhand: 'heroic_deathless_heartwood',
  offhand: 'heroic_wraithfire_orb',
  gloves: 'shadowpulse_handwraps',
  waist: 'sash_of_the_sunken_court',
  legs: 'necromancers_legwraps',
  feet: 'shadowpulse_slippers',
  ring1: 'architects_cornerstone',
  ring2: 'zyzzs_deathless_signet',
};

type ProbeSim = Sim & {
  addEntity(entity: Entity): void;
};

function face(source: Entity, target: Entity): void {
  source.facing = Math.atan2(target.pos.x - source.pos.x, target.pos.z - source.pos.z);
  source.prevFacing = source.facing;
}

function addBossDummy(sim: ProbeSim): Entity {
  const player = sim.player;
  const templateId = 'warlock_balance_boss_dummy';
  MOBS[templateId] ??= {
    ...MOBS.training_dummy,
    id: templateId,
    name: 'Warlock Balance Dummy',
    boss: true,
  };
  const target = createMob(99_800, MOBS[templateId], 20, {
    x: player.pos.x,
    y: player.pos.y,
    z: player.pos.z + 18,
  });
  target.hostile = true;
  target.hp = target.maxHp = 10_000_000;
  target.aiState = 'idle';
  target.aggroTargetId = null;
  sim.addEntity(target);
  sim.targetEntity(target.id);
  face(player, target);
  return target;
}

function tickFor(sim: Sim, seconds: number): void {
  for (let tick = 0; tick < seconds * 20; tick++) sim.tick();
}

function cooldownReady(player: Entity, abilityId: string): boolean {
  return !player.cooldowns.has(abilityId);
}

function auraRemaining(entity: Entity, id: string, sourceId?: number): number {
  return (
    entity.auras.find(
      (aura) => aura.id === id && (sourceId === undefined || aura.sourceId === sourceId),
    )?.remaining ?? 0
  );
}

function hasAuraKind(entity: Entity, kind: Entity['auras'][number]['kind']): boolean {
  return entity.auras.some((aura) => aura.kind === kind && aura.remaining > 0);
}

function cast(sim: Sim, abilityId: string, target: Entity): boolean {
  const player = sim.player;
  if (player.castingAbility || player.gcdRemaining > 0.001) return false;
  const known = sim.known.find((entry) => entry.def.id === abilityId);
  if (!known || player.cooldowns.has(abilityId) || player.resource < known.cost) return false;
  const before = `${player.castingAbility}|${player.gcdRemaining}|${player.resource}|${player.auras.length}`;
  const aim =
    known.def.targetMode === 'position' ? { x: target.pos.x, z: target.pos.z } : undefined;
  player.targetId = target.id;
  face(player, target);
  sim.castAbility(abilityId, undefined, aim);
  const after = `${player.castingAbility}|${player.gcdRemaining}|${player.resource}|${player.auras.length}`;
  return before !== after;
}

function castAndSettle(sim: Sim, abilityId: string, target: Entity): void {
  sim.player.gcdRemaining = 0;
  if (!cast(sim, abilityId, target)) throw new Error(`Could not prepare ${abilityId}`);
  for (let tick = 0; tick < 20 * 8 && sim.player.castingAbility; tick++) sim.tick();
  while (sim.player.gcdRemaining > 0.001) sim.tick();
}

function prepareAffliction(sim: Sim, target: Entity): void {
  castAndSettle(sim, 'cursed_accomplice', target);
}

function prepareDestruction(sim: Sim, target: Entity): void {
  castAndSettle(sim, 'summon_imp', target);
  tickFor(sim, 6.5);
}

function prepareDemonology(sim: Sim, target: Entity): void {
  addSoulFragments(sim.ctx, sim.player, 5);
  castAndSettle(sim, 'raise_bone_mage', target);
  addSoulFragments(sim.ctx, sim.player, 5);
  castAndSettle(sim, 'raise_gravewing', target);
  addSoulFragments(sim.ctx, sim.player, 5);
}

function equipFullBis(sim: Sim): void {
  const meta = sim.ctx.players.get(sim.player.id);
  if (!meta) throw new Error('Warlock benchmark player metadata is missing');
  meta.equipment = { ...WARLOCK_FULL_BIS_GEAR };
  recalcPlayerStats(
    sim.player,
    meta.cls,
    meta.equipment,
    sim.ctx.playerMods(meta),
    meta.equipmentInstance,
  );
  sim.player.hp = sim.player.maxHp;
  sim.player.resource = sim.player.maxResource;
}

function tryAffliction(sim: Sim, target: Entity): boolean {
  const player = sim.player;
  if (!hasAuraKind(target, 'affliction_eye')) return cast(sim, 'evil_eye', target);
  if (!hasAuraKind(player, 'affliction_accomplice')) {
    return cast(sim, 'cursed_accomplice', target);
  }
  const possessed = hasAuraKind(player, 'affliction_possession');
  if (!possessed && cooldownReady(player, 'hour_of_judgment')) {
    return cast(sim, 'hour_of_judgment', target);
  }
  if (!possessed && cooldownReady(player, 'possess_evil_eye')) {
    return cast(sim, 'possess_evil_eye', target);
  }
  if (cooldownReady(player, 'cruel_pact')) return cast(sim, 'cruel_pact', target);
  const doom = player.auras.find((aura) => aura.kind === 'affliction_doom')?.stacks ?? 0;
  const nextNeedle = possessed ? 9 : 7;
  if (doom + nextNeedle > 100) return cast(sim, 'sentence', target);
  return cast(sim, 'needle_of_fate', target);
}

function tryDestruction(sim: Sim, target: Entity): boolean {
  const player = sim.player;
  if (cooldownReady(player, 'summon_infernal') && cast(sim, 'summon_infernal', target)) {
    return true;
  }
  const pactRemaining = auraRemaining(target, 'immolate', player.id);
  if (pactRemaining < 3.5 && cast(sim, 'immolate', target)) return true;
  if (cast(sim, 'conflagrate', target)) return true;
  if (
    pactRemaining >= 6 &&
    cooldownReady(player, 'ruinous_brand') &&
    cast(sim, 'ruinous_brand', target)
  ) {
    return true;
  }
  if (ruinAmount(player) >= 3 && cast(sim, 'chaos_bolt', target)) return true;
  if (player.resource < player.maxResource * 0.3 && cast(sim, 'life_tap', target)) return true;
  return cast(sim, 'shadow_bolt', target);
}

function tryDemonology(sim: Sim, target: Entity): boolean {
  const player = sim.player;
  const markRemaining = auraRemaining(target, 'ossuary_mark', player.id);
  if (markRemaining <= 0 && cast(sim, 'ossuary_mark', target)) return true;
  if (cooldownReady(player, 'army_of_the_dead') && cast(sim, 'army_of_the_dead', target)) {
    return true;
  }
  if (cooldownReady(player, 'metamorphosis') && cast(sim, 'metamorphosis', target)) return true;
  if (cooldownReady(player, 'unholy_command') && cast(sim, 'unholy_command', target)) return true;
  if (
    player.resource > player.maxResource * 0.35 &&
    soulFragmentCount(player) >= 5 &&
    cast(sim, 'reaping_command', target)
  ) {
    return true;
  }
  if (
    player.resource > player.maxResource * 0.35 &&
    markRemaining > 0 &&
    cooldownReady(player, 'soul_lance') &&
    cast(sim, 'soul_lance', target)
  ) {
    return true;
  }
  if (player.resource < player.maxResource * 0.3 && cast(sim, 'life_tap', target)) return true;
  return cast(sim, 'soul_harvest', target);
}

function attributeDamage(
  events: readonly SimEvent[],
  sim: Sim,
  target: Entity,
  result: WarlockBalanceResult,
): void {
  for (const event of events) {
    if (event.type !== 'damage' || event.targetId !== target.id) continue;
    const source = sim.entities.get(event.sourceId);
    if (event.sourceId !== sim.player.id && source?.ownerId !== sim.player.id) continue;
    result.damage += event.amount;
    const key = event.ability ?? source?.name ?? 'melee';
    result.damageByAbility[key] = (result.damageByAbility[key] ?? 0) + event.amount;
  }
}

export function runWarlockBalanceProbe(
  spec: WarlockBalanceSpec,
  seed = 42,
  seconds = 300,
): WarlockBalanceResult {
  const sim = new Sim({ seed, playerClass: 'warlock', autoEquip: true }) as ProbeSim;
  sim.setPlayerLevel(20);
  if (!sim.applyTalents({ spec, rows: TALENT_ROWS[spec] })) {
    throw new Error(`Could not apply ${spec} benchmark talents`);
  }
  equipFullBis(sim);
  const target = addBossDummy(sim);
  if (spec === 'affliction') prepareAffliction(sim, target);
  else if (spec === 'destruction') prepareDestruction(sim, target);
  else prepareDemonology(sim, target);
  sim.player.hp = sim.player.maxHp;
  sim.player.resource = sim.player.maxResource;
  target.hp = target.maxHp;

  const result: WarlockBalanceResult = {
    spec,
    seed,
    seconds,
    damage: 0,
    dps: 0,
    manaAveragePct: 0,
    manaEndPct: 0,
    starvedPct: 0,
    damageByAbility: {},
  };
  let manaPctTotal = 0;
  let starvedTicks = 0;
  for (let tick = 0; tick < seconds * 20; tick++) {
    const player = sim.player;
    if (!player.castingAbility && player.gcdRemaining <= 0.001) {
      const acted =
        spec === 'affliction'
          ? tryAffliction(sim, target)
          : spec === 'destruction'
            ? tryDestruction(sim, target)
            : tryDemonology(sim, target);
      if (!acted) starvedTicks++;
    }
    const events = sim.tick();
    attributeDamage(events, sim, target, result);
    manaPctTotal += player.maxResource > 0 ? player.resource / player.maxResource : 0;
  }
  result.dps = result.damage / seconds;
  result.manaAveragePct = manaPctTotal / (seconds * 20);
  result.manaEndPct = sim.player.resource / sim.player.maxResource;
  result.starvedPct = starvedTicks / (seconds * 20);
  return result;
}

function printResults(): void {
  const seconds = Number.parseInt(process.env.WOC_WARLOCK_SECONDS ?? '300', 10);
  const seeds = (process.env.WOC_WARLOCK_SEEDS ?? '42,1337,9001,777')
    .split(',')
    .map((seed) => Number.parseInt(seed, 10));
  for (const spec of ['affliction', 'destruction', 'demonology'] as const) {
    const rows = seeds.map((seed) => runWarlockBalanceProbe(spec, seed, seconds));
    const average = (key: 'dps' | 'manaAveragePct' | 'manaEndPct' | 'starvedPct') =>
      rows.reduce((sum, row) => sum + row[key], 0) / rows.length;
    console.log(
      [
        spec,
        `${average('dps').toFixed(1)} DPS`,
        `${(average('manaAveragePct') * 100).toFixed(1)}% average mana`,
        `${(average('manaEndPct') * 100).toFixed(1)}% end mana`,
        `${(average('starvedPct') * 100).toFixed(1)}% starved`,
      ].join(', '),
    );
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) printResults();
