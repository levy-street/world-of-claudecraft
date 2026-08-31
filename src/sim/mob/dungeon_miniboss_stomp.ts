// Placement-local body attack for promoted dungeon minibosses. The reusable
// Warden template keeps Crucible Quake; only entities stamped at claim time
// replace that cast with this instant Stomp.

import type { SimContext } from '../sim_context';
import { CAST_COMPLETE_EPS, DT, type DungeonDifficulty, dist2d, type Entity } from '../types';

export const DUNGEON_MINIBOSS_STOMP_ABILITY_ID = 'Crucible Stomp';
export const DUNGEON_MINIBOSS_STOMP_RADIUS = 9;
export const DUNGEON_MINIBOSS_STOMP_DAMAGE_MAX_HP = 0.4;
export const DUNGEON_MINIBOSS_STOMP_DAMAGE_MAX_HP_HEROIC = 0.7;
export const DUNGEON_MINIBOSS_STOMP_FIRST_SECONDS = 6;
export const DUNGEON_MINIBOSS_STOMP_REPEAT_SECONDS = 12;

function claimFor(ctx: SimContext, mob: Entity) {
  return ctx.instances.find(
    (candidate) => candidate.partyKey !== null && candidate.mobIds.includes(mob.id),
  );
}

export function dungeonMinibossStompDamageMaxHp(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? DUNGEON_MINIBOSS_STOMP_DAMAGE_MAX_HP_HEROIC
    : DUNGEON_MINIBOSS_STOMP_DAMAGE_MAX_HP;
}

function livingPlayersInClaim(ctx: SimContext, mob: Entity): Entity[] {
  const claim = claimFor(ctx, mob);
  if (!claim || claim.exitId === null) return [];
  const players: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const player = ctx.entities.get(meta.entityId);
    if (player?.kind !== 'player' || player.dead) continue;
    if (ctx.instanceClaimIdAt(player.pos) !== claim.exitId) continue;
    players.push(player);
  }
  return players;
}

export function resetDungeonMinibossStomp(mob: Entity): void {
  if (!mob.dungeonSpawnMiniboss) return;
  mob.stompTimer = DUNGEON_MINIBOSS_STOMP_FIRST_SECONDS;
  mob.bigCastTimer = Number.MAX_SAFE_INTEGER;
}

export function updateDungeonMinibossStomp(ctx: SimContext, mob: Entity): boolean {
  if (!mob.dungeonSpawnMiniboss) return false;
  const claim = claimFor(ctx, mob);
  const difficulty = claim?.difficulty ?? 'normal';

  // A promoted placement replaces the template's interruptible Quake. Keep
  // that generic cadence suppressed even while Stomp is waiting for a target.
  mob.bigCastTimer = Number.MAX_SAFE_INTEGER;
  mob.stompTimer = Math.max(0, mob.stompTimer - DT);
  if (mob.stompTimer > CAST_COMPLETE_EPS) return false;

  const targets = livingPlayersInClaim(ctx, mob).filter(
    (player) => dist2d(player.pos, mob.pos) <= DUNGEON_MINIBOSS_STOMP_RADIUS,
  );
  if (targets.length === 0) return false;

  mob.stompTimer = DUNGEON_MINIBOSS_STOMP_REPEAT_SECONDS;
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: mob.id,
    school: 'fire',
    fx: 'windup',
    ability: DUNGEON_MINIBOSS_STOMP_ABILITY_ID,
  });
  ctx.emit({
    type: 'spellfxAt',
    x: mob.pos.x,
    z: mob.pos.z,
    school: 'fire',
    fx: 'nova',
    sourceId: mob.id,
    radius: DUNGEON_MINIBOSS_STOMP_RADIUS,
    ability: DUNGEON_MINIBOSS_STOMP_ABILITY_ID,
  });
  for (const player of targets) {
    ctx.dealDamage(
      mob,
      player,
      Math.ceil(player.maxHp * dungeonMinibossStompDamageMaxHp(difficulty)),
      false,
      'fire',
      DUNGEON_MINIBOSS_STOMP_ABILITY_ID,
      'hit',
      true,
    );
  }
  return true;
}
