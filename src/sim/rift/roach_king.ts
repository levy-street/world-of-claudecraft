// Asmon's two-stage rift encounter. The existing mob loop owns locomotion
// between casts; this module owns the pull clock and locks movement while a
// fixed-position warning resolves. All state lives on the boss Entity.
import { isLockedOut, isSilenced } from '../combat/cc';
import {
  GARBAGE_BEETLE_ID,
  ROACH_CROWN_AURA,
  ROACH_KING_ID,
  ROACHLING_ID,
} from '../content/rift/roach_king';
import { MOBS } from '../data';
import {
  impairedZoneFuseMult,
  openRiftEscapeWindow,
  RIFT_POST_MECHANIC_SWING_GAP_SEC,
} from '../mob/rift_escape_window';
import type { SimContext } from '../sim_context';
import { DT, dist2d, type Entity } from '../types';
import { capRiftNonLethalMechanicDamage, riftDeathZoneFuse, riftRankForBaseLevel } from './ranks';
import { clearRiftBossDeathZones, instancePlayerIds } from './runs';
import type { RiftInstance, RoachKingState } from './types';

const CAST = {
  crown: 'rift_asmon_coronation',
  slam: 'rift_asmon_desk_slam',
  tribute: 'rift_asmon_tribute',
  filth: 'rift_asmon_filth',
  swarm: 'rift_asmon_swarm',
} as const;
const CORONATION_SECONDS = 3;
const TRIBUTE_SECONDS = 5;
const POST_CAST_GAP = 4;
const MAX_LIVE_ADDS = 6;
const TRIBUTE_HEAL_FRACTION = 0.03;

export function createRoachKingState(): RoachKingState {
  return {
    crowned: false,
    nextCast: 5,
    sequence: 0,
    cast: null,
    x: 0,
    z: 0,
    radius: 0,
    tributeIds: [],
  };
}

function instanceFor(ctx: SimContext, boss: Entity): RiftInstance | undefined {
  return ctx.riftInstances.find((inst) => inst.partyKey !== null && inst.mobIds.includes(boss.id));
}

function livingPlayers(ctx: SimContext, inst: RiftInstance): Entity[] {
  return instancePlayerIds(ctx, inst).flatMap((id) => {
    const player = ctx.entities.get(id);
    return player && !player.dead ? [player] : [];
  });
}

function clearCast(boss: Entity): void {
  boss.castingAbility = null;
  boss.castRemaining = 0;
  boss.castTotal = 0;
  boss.castTargetId = null;
  boss.channeling = false;
  boss.swingTimer = RIFT_POST_MECHANIC_SWING_GAP_SEC;
}

/** Clear everything that could land on a later pull, including online zones. */
export function resetRoachKing(ctx: SimContext, boss: Entity): void {
  if (boss.templateId !== ROACH_KING_ID || !boss.roachKing) return;
  const inst = instanceFor(ctx, boss);
  if (inst) {
    clearRiftBossDeathZones(ctx, inst, boss.id);
    const summoned = new Set(boss.summonedIds);
    inst.mobIds = inst.mobIds.filter((id) => !summoned.has(id));
  }
  ctx.despawnSummonedAdds(boss);
  clearCast(boss);
  boss.escapeWindowUntil = 0;
  // Retain the corpse's crowned silhouette. Resetting a living boss removes it.
  if (!boss.dead) boss.auras = boss.auras.filter((aura) => aura.id !== ROACH_CROWN_AURA);
  boss.roachKing = undefined;
}

function spawnWave(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  id: string,
  count: number,
): number[] {
  const live = boss.summonedIds.filter((addId) => {
    const add = ctx.entities.get(addId);
    return add && !add.dead;
  }).length;
  const allowed = Math.min(count, MAX_LIVE_ADDS - live);
  if (allowed <= 0) return [];
  const first = boss.summonedIds.length;
  ctx.spawnBossAdds(boss, id, allowed);
  const ids = boss.summonedIds.slice(first);
  // The generic spawner applies rift level and add-role scaling, but its
  // historical membership registration covers only dungeon/delve instances.
  // Join the rift too, for control suppression, floor teardown and snapshots.
  for (const addId of ids) if (!inst.mobIds.includes(addId)) inst.mobIds.push(addId);
  return ids;
}

function beginCast(
  ctx: SimContext,
  boss: Entity,
  state: RoachKingState,
  id: string,
  seconds: number,
): void {
  state.cast = id;
  state.x = boss.pos.x;
  state.z = boss.pos.z;
  boss.castingAbility = id;
  boss.castTotal = seconds;
  boss.castRemaining = seconds;
  boss.castTargetId = boss.aggroTargetId;
  boss.channeling = id === CAST.tribute;
  boss.swingTimer = Math.max(boss.swingTimer, seconds + RIFT_POST_MECHANIC_SWING_GAP_SEC);
  openRiftEscapeWindow(ctx, boss, seconds);
}

function warnRing(ctx: SimContext, boss: Entity, state: RoachKingState): void {
  ctx.emit({
    type: 'spellfxAt',
    x: state.x,
    z: state.z,
    sourceId: boss.id,
    school: state.cast === CAST.slam ? 'physical' : 'nature',
    fx: 'runeCircle',
    ability: state.cast ?? undefined,
    radius: state.radius,
    duration: boss.castTotal,
  });
}

function crown(ctx: SimContext, boss: Entity, state: RoachKingState): void {
  state.crowned = true;
  state.sequence = 0;
  beginCast(ctx, boss, state, CAST.crown, CORONATION_SECONDS);
  ctx.emit({
    type: 'log',
    text: 'The hermit rises. The Roach King claims his crown!',
    color: '#e8b54a',
    entityId: boss.id,
    telegraph: true,
  });
}

function startFilth(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: RoachKingState,
  players: Entity[],
): void {
  const rank = riftRankForBaseLevel(inst.baseLevel);
  const def = (
    rank === 'S' ? MOBS[ROACH_KING_ID].deathZoneStrike : MOBS[ROACH_KING_ID].deathZoneCast
  )!;
  const anchor = players[ctx.rng.int(0, players.length - 1)];
  const anchors = rank === 'S' ? players : [anchor];
  const fuse = riftDeathZoneFuse(def.castTime, rank);
  let longest = fuse;
  for (const player of anchors) {
    const seconds = fuse * impairedZoneFuseMult(ctx, player);
    longest = Math.max(longest, seconds);
    inst.bossDeathZones.push({
      x: player.pos.x,
      z: player.pos.z,
      radius: def.radius,
      remaining: seconds,
      total: seconds,
      sourceId: boss.id,
      ability: CAST.filth,
    });
    ctx.emit({
      type: 'riftDeathZoneSpawn',
      x: player.pos.x,
      z: player.pos.z,
      radius: def.radius,
      durationSecs: seconds,
    });
    ctx.emit({
      type: 'spellfxAt',
      x: player.pos.x,
      z: player.pos.z,
      sourceId: boss.id,
      school: 'nature',
      fx: 'runeCircle',
      ability: CAST.filth,
      radius: def.radius,
      duration: seconds,
    });
  }
  beginCast(ctx, boss, state, CAST.filth, longest);
  ctx.emit({
    type: 'log',
    text: 'Mountain of Filth: leave the marked ground!',
    color: '#d7f070',
    entityId: boss.id,
    telegraph: true,
  });
}

function resolveCast(
  ctx: SimContext,
  inst: RiftInstance,
  boss: Entity,
  state: RoachKingState,
): void {
  const id = state.cast;
  if (id === CAST.slam || id === CAST.swarm) {
    const def = MOBS[ROACH_KING_ID].bigCast!;
    const school = id === CAST.slam ? (def.school ?? 'physical') : 'nature';
    const raw = ctx.rng.range(def.min, def.max) * (boss.mechanicDamageMult ?? 1);
    for (const player of livingPlayers(ctx, inst)) {
      if (dist2d(player.pos, { x: state.x, y: player.pos.y, z: state.z }) > state.radius) continue;
      const amount = capRiftNonLethalMechanicDamage(Math.round(raw), player.maxHp);
      ctx.dealDamage(
        boss,
        player,
        amount,
        false,
        school,
        id === CAST.slam ? 'Desk Slam' : 'Royal Swarm',
        'hit',
        true,
      );
    }
    ctx.emit({
      type: 'spellfxAt',
      x: state.x,
      z: state.z,
      sourceId: boss.id,
      school,
      fx: 'nova',
      ability: id,
      radius: state.radius,
    });
    if (id === CAST.swarm) spawnWave(ctx, inst, boss, ROACHLING_ID, 2);
  } else if (id === CAST.tribute) {
    const survivors = state.tributeIds.filter((addId) => {
      const add = ctx.entities.get(addId);
      return add && !add.dead;
    }).length;
    const amount = Math.round(boss.maxHp * TRIBUTE_HEAL_FRACTION * survivors);
    if (amount > 0) ctx.applyHeal(boss, boss, amount, 'Tribute Feast');
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'nature',
      fx: 'nova',
      ability: CAST.tribute,
    });
  } else if (id === CAST.crown) {
    // A zero-value stat aura carries the authoritative form over the ordinary
    // entity snapshot. It grants no power and needs no new client-only state.
    ctx.applyAura(boss, {
      id: ROACH_CROWN_AURA,
      name: "Roach King's Crown",
      kind: 'buff_ap',
      undispellable: true,
      remaining: 86400,
      duration: 86400,
      value: 0,
      sourceId: boss.id,
      school: 'nature',
    });

    spawnWave(ctx, inst, boss, ROACHLING_ID, 2);
    ctx.emit({
      type: 'spellfx',
      sourceId: boss.id,
      targetId: boss.id,
      school: 'nature',
      fx: 'selfCast',
      ability: CAST.crown,
    });
  }
  clearCast(boss);
  state.cast = null;
  state.nextCast = POST_CAST_GAP;
}

/** True holds ordinary locomotion/white swings this tick, false lets the shared
 * mob AI pursue its target between casts. Called before the generic boss kit. */
export function updateRoachKing(ctx: SimContext, boss: Entity): boolean {
  if (boss.templateId !== ROACH_KING_ID) return false;
  if (boss.dead || boss.aiState === 'evade' || !boss.inCombat) {
    resetRoachKing(ctx, boss);
    return false;
  }
  const inst = instanceFor(ctx, boss);
  if (!inst) return false;
  const players = livingPlayers(ctx, inst);
  if (players.length === 0) {
    resetRoachKing(ctx, boss);
    return false;
  }
  boss.roachKing ??= createRoachKingState();
  const state = boss.roachKing;
  if (state.cast !== null) {
    if (boss.castingAbility !== state.cast) {
      // Only Tribute is interruptible. The combat interrupt path clears the
      // ordinary cast fields; losing that cast forfeits the feast's healing.
      clearCast(boss);
      state.cast = null;
      state.tributeIds = [];
      state.nextCast = POST_CAST_GAP;
      return true;
    }
    boss.castRemaining = Math.max(0, boss.castRemaining - DT);
    if (boss.castRemaining <= 0) resolveCast(ctx, inst, boss, state);
    return true;
  }
  const natureBlocked = isSilenced(boss) || isLockedOut(boss, 'nature');
  if (!state.crowned && boss.hp <= boss.maxHp * 0.5) {
    if (natureBlocked) return false;
    crown(ctx, boss, state);
    return true;
  }
  state.nextCast -= DT;
  if (state.nextCast > 0) return false;
  // Do not cast from across the dungeon: approach until the party reaches
  // the arena. Once started, every warning resolves on its fixed clock.
  if (players.every((player) => dist2d(player.pos, boss.pos) > 24)) return false;
  // Waiting on a locked school does not consume the next mechanic. Physical
  // Desk Slam remains available during silence and Nature school lockout.
  if (natureBlocked && (state.crowned || state.sequence % 3 === 1)) return false;
  const rank = riftRankForBaseLevel(inst.baseLevel);
  const sequence = state.sequence++;
  if (state.crowned && (rank === 'A' || rank === 'S') && sequence % 3 === 2) {
    startFilth(ctx, inst, boss, state, players);
  } else if (sequence % 3 === 1) {
    beginCast(ctx, boss, state, CAST.tribute, TRIBUTE_SECONDS);
    state.tributeIds = spawnWave(ctx, inst, boss, GARBAGE_BEETLE_ID, rank === 'C' ? 1 : 2);
    ctx.emit({
      type: 'log',
      text: 'Tribute Feast: interrupt the channel or kill the tribute beetles!',
      color: '#e8b54a',
      entityId: boss.id,
      telegraph: true,
    });
  } else {
    state.radius = state.crowned ? 10 : 8;
    const cast = state.crowned ? CAST.swarm : CAST.slam;
    beginCast(ctx, boss, state, cast, state.crowned ? 3 : 2.2);
    warnRing(ctx, boss, state);
    ctx.emit({
      type: 'log',
      text: 'The Roach King winds up: get outside the ring!',
      color: '#e8b54a',
      entityId: boss.id,
      telegraph: true,
    });
  }
  return true;
}
