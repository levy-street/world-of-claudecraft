// Room-gated raid-trash casts for the corridor automata. Varkhul summons the
// same Sentinel template, so instance membership is the authority boundary.

import { isLockedOut, isSilenced } from '../combat/cc';
import type { ActiveIgnivarMeteorWarning } from '../ignivar_meteors';
import {
  IGNIVAR_EMBER_SENTINEL_ID,
  IGNIVAR_FORGE_APPROACH_ID,
  IGNIVAR_MOLTEN_ASSEMBLY_ID,
} from '../ignivar_raid_ids';
import type { SimContext } from '../sim_context';
import { CAST_COMPLETE_EPS, DT, type DungeonDifficulty, dist2d, type Entity } from '../types';

export const IGNIVAR_CINDER_LANCE_CAST_ID = 'Cinder Lance';
export const IGNIVAR_CINDER_LANCE_CAST_SECONDS = 2;
export const IGNIVAR_CINDER_LANCE_RADIUS = 4;
export const IGNIVAR_CINDER_LANCE_DAMAGE_MAX_HP = 0.3;
export const IGNIVAR_CINDER_LANCE_DAMAGE_MAX_HP_HEROIC = 0.55;

export function ignivarCinderLanceDamageMaxHp(difficulty: DungeonDifficulty): number {
  return difficulty === 'heroic'
    ? IGNIVAR_CINDER_LANCE_DAMAGE_MAX_HP_HEROIC
    : IGNIVAR_CINDER_LANCE_DAMAGE_MAX_HP;
}

const CINDER_LANCE_FIRST_SECONDS = 5;
const CINDER_LANCE_REPEAT_SECONDS = 11;
const INTERRUPTED_RETRY_SECONDS = 5;

function cinderLanceWarningId(mob: Entity): string {
  return `ignivar-trash:${mob.id}:${mob.ignivarTrashCastKey ?? 0}`;
}

export function activeIgnivarTrashMeteorWarning(mob: Entity): ActiveIgnivarMeteorWarning | null {
  if (
    mob.ignivarTrashSpell !== 'cinderLance' ||
    !mob.castAim ||
    mob.castRemaining <= CAST_COMPLETE_EPS
  ) {
    return null;
  }
  return {
    id: cinderLanceWarningId(mob),
    x: mob.castAim.x,
    z: mob.castAim.z,
    radius: IGNIVAR_CINDER_LANCE_RADIUS,
    duration: IGNIVAR_CINDER_LANCE_CAST_SECONDS,
    remaining: Math.min(mob.castRemaining, IGNIVAR_CINDER_LANCE_CAST_SECONDS),
    warningLead: 0,
  };
}

function trashInstanceFor(ctx: SimContext, mob: Entity) {
  const instance = ctx.instances.find(
    (candidate) => candidate.partyKey !== null && candidate.mobIds.includes(mob.id),
  );
  if (
    instance?.dungeonId !== IGNIVAR_FORGE_APPROACH_ID &&
    instance?.dungeonId !== IGNIVAR_MOLTEN_ASSEMBLY_ID
  ) {
    return null;
  }
  return instance;
}

function clearCinderLance(mob: Entity): void {
  mob.castingAbility = null;
  mob.castTotal = 0;
  mob.castRemaining = 0;
  mob.castTargetId = null;
  mob.castAim = null;
  mob.channeling = false;
  mob.ignivarTrashSpell = undefined;
  mob.ignivarTrashCastKey = undefined;
}

export function resetIgnivarTrashAutomaton(mob: Entity): void {
  if (
    mob.templateId === IGNIVAR_EMBER_SENTINEL_ID ||
    mob.ignivarTrashSpell !== undefined ||
    mob.ignivarTrashSpellTimer !== undefined
  ) {
    clearCinderLance(mob);
  }
  mob.ignivarTrashSpellTimer = undefined;
}

function playersInTrashInstance(
  ctx: SimContext,
  instance: NonNullable<ReturnType<typeof trashInstanceFor>>,
): Entity[] {
  if (instance.exitId === null) return [];
  const players: Entity[] = [];
  for (const meta of ctx.players.values()) {
    const player = ctx.entities.get(meta.entityId);
    if (player?.kind !== 'player' || player.dead) continue;
    if (ctx.instanceClaimIdAt(player.pos) !== instance.exitId) continue;
    players.push(player);
  }
  players.sort((a, b) => a.id - b.id);
  return players;
}

function cinderLanceTarget(ctx: SimContext, mob: Entity): Entity | null {
  const instance = trashInstanceFor(ctx, mob);
  if (!instance) return null;
  let target: Entity | null = null;
  let targetDistance = -1;
  for (const player of playersInTrashInstance(ctx, instance)) {
    const distance = dist2d(mob.pos, player.pos);
    if (distance > targetDistance) {
      target = player;
      targetDistance = distance;
    }
  }
  return target;
}

function startCinderLance(ctx: SimContext, mob: Entity): boolean {
  const target = cinderLanceTarget(ctx, mob);
  if (!target) {
    mob.ignivarTrashSpellTimer = 1;
    return false;
  }
  mob.ignivarTrashSpell = 'cinderLance';
  mob.ignivarTrashCastKey = ctx.tickCount;
  mob.castingAbility = IGNIVAR_CINDER_LANCE_CAST_ID;
  mob.castTotal = IGNIVAR_CINDER_LANCE_CAST_SECONDS;
  mob.castRemaining = IGNIVAR_CINDER_LANCE_CAST_SECONDS;
  mob.castTargetId = target.id;
  mob.castAim = { ...target.pos };
  mob.channeling = false;
  mob.aiState = 'attack';
  ctx.emit({
    type: 'spellfxAt',
    x: target.pos.x,
    z: target.pos.z,
    school: 'fire',
    fx: 'meteorFall',
    sourceId: mob.id,
    radius: IGNIVAR_CINDER_LANCE_RADIUS,
    duration: IGNIVAR_CINDER_LANCE_CAST_SECONDS,
    warningLead: 0,
    persistentId: cinderLanceWarningId(mob),
    ability: IGNIVAR_CINDER_LANCE_CAST_ID,
  });
  return true;
}

function resolveCinderLance(ctx: SimContext, mob: Entity): void {
  const instance = trashInstanceFor(ctx, mob);
  const impact = mob.castAim;
  if (!instance || !impact || ctx.instanceClaimIdAt(impact) !== instance.exitId) return;
  ctx.emit({
    type: 'spellfxAt',
    x: impact.x,
    z: impact.z,
    school: 'fire',
    fx: 'nova',
    sourceId: mob.id,
    radius: IGNIVAR_CINDER_LANCE_RADIUS,
    ability: IGNIVAR_CINDER_LANCE_CAST_ID,
  });
  for (const player of playersInTrashInstance(ctx, instance)) {
    if (dist2d(player.pos, impact) > IGNIVAR_CINDER_LANCE_RADIUS) continue;
    ctx.dealDamage(
      mob,
      player,
      Math.ceil(player.maxHp * ignivarCinderLanceDamageMaxHp(instance.difficulty)),
      false,
      'fire',
      IGNIVAR_CINDER_LANCE_CAST_ID,
      'hit',
      true,
    );
  }
}

export function updateIgnivarTrashAutomaton(ctx: SimContext, mob: Entity): boolean {
  const instance = trashInstanceFor(ctx, mob);
  if (!instance) {
    if (mob.ignivarTrashSpell !== undefined || mob.ignivarTrashSpellTimer !== undefined) {
      resetIgnivarTrashAutomaton(mob);
    }
    return false;
  }
  if (mob.templateId !== IGNIVAR_EMBER_SENTINEL_ID) return false;

  mob.ignivarTrashSpellTimer ??= CINDER_LANCE_FIRST_SECONDS;
  if (mob.ignivarTrashSpell === 'cinderLance') {
    if (
      mob.castingAbility !== IGNIVAR_CINDER_LANCE_CAST_ID ||
      isSilenced(mob) ||
      isLockedOut(mob, 'fire')
    ) {
      clearCinderLance(mob);
      mob.ignivarTrashSpellTimer = INTERRUPTED_RETRY_SECONDS;
      return false;
    }
    mob.castRemaining = Math.max(0, mob.castRemaining - DT);
    if (mob.castRemaining > CAST_COMPLETE_EPS) return true;
    resolveCinderLance(ctx, mob);
    clearCinderLance(mob);
    mob.ignivarTrashSpellTimer = CINDER_LANCE_REPEAT_SECONDS;
    return true;
  }

  if (mob.castingAbility !== null || isSilenced(mob) || isLockedOut(mob, 'fire')) return false;
  mob.ignivarTrashSpellTimer = Math.max(0, mob.ignivarTrashSpellTimer - DT);
  if (mob.ignivarTrashSpellTimer > CAST_COMPLETE_EPS) return false;
  return startCinderLance(ctx, mob);
}
