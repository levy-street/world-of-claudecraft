// Authored boss arenas are smaller than their instance claims. Combat belongs
// on their fighting floors, including when a boss is chained or planted.
import { MOON_ALTAR } from '../content/drowned_temple_layout';
import { LOCK_TERRACE, RITUAL_VAULT, WYRMS_HOLLOW } from '../content/gravewyrm_sanctum_layout';
import { MOBS } from '../data';
import { claimedInstanceForMob } from '../instances/dungeons';
import type { InstanceSlot } from '../sim';
import type { SimContext } from '../sim_context';
import { hasEscapeStealth } from '../threat';
import type { Entity } from '../types';
import { startEvadeHome } from './combat_profile';

interface Arena {
  readonly x: number;
  readonly z: number;
  readonly r: number;
  readonly h: number;
}

const KORZUL_ARENA: Arena = { ...WYRMS_HOLLOW, r: WYRMS_HOLLOW.shelfR };
// Door recesses and blocked exits hold a player up to 1.6 yd past the authored
// edge with nothing marking it, so combatants get this much slack.
const COMBATANT_EDGE_MARGIN = 2;
// Velkhar's north door stands at the foot of a ramp 3.8 yd below his floor.
const COMBATANT_FLOOR_DROP = 4;

function arenaOf(boss: Entity): Arena | null {
  switch (boss.templateId) {
    case 'korgath_the_bound':
      return LOCK_TERRACE;
    case 'grand_necromancer_velkhar':
      return RITUAL_VAULT;
    case 'korzul_the_gravewyrm':
      return KORZUL_ARENA;
    case 'ysolei':
      return MOON_ALTAR;
    default:
      return null;
  }
}

function inside(
  ctx: SimContext,
  inst: InstanceSlot,
  arena: Arena,
  entity: Entity,
  bodyMargin = 0,
): boolean {
  const o = ctx.instanceOriginOf(inst);
  return (
    Math.hypot(entity.pos.x - o.x - arena.x, entity.pos.z - o.z - arena.z) <=
    arena.r + bodyMargin + 1e-6
  );
}

function combatantInside(
  ctx: SimContext,
  inst: InstanceSlot,
  arena: Arena,
  entity: Entity,
): boolean {
  // Floors further below are outside the fighting floor. Class flights above it are
  // legal: encounter damage and target selection resolve in two dimensions.
  if (
    !inside(ctx, inst, arena, entity, COMBATANT_EDGE_MARGIN) ||
    entity.pos.y < arena.h - COMBATANT_FLOOR_DROP
  )
    return false;
  if (entity.ownerId !== null) {
    const owner = ctx.entities.get(entity.ownerId);
    return (
      !!owner &&
      inside(ctx, inst, arena, owner, COMBATANT_EDGE_MARGIN) &&
      owner.pos.y >= arena.h - COMBATANT_FLOOR_DROP
    );
  }
  return true;
}

function activeCombatant(
  ctx: SimContext,
  inst: InstanceSlot,
  arena: Arena,
  entity: Entity,
): boolean {
  if (entity.dead || hasEscapeStealth(entity) || !combatantInside(ctx, inst, arena, entity))
    return false;
  const owner = entity.ownerId !== null ? ctx.entities.get(entity.ownerId) : null;
  return !owner || (!owner.dead && !hasEscapeStealth(owner));
}

function bossOutside(ctx: SimContext, inst: InstanceSlot, arena: Arena, boss: Entity): boolean {
  // Break Free travels from the calving face to the lake before ordinary combat.
  const st = boss.sanctumFight;
  if (st?.kind === 'korzul' && st.phase === 'emerge') return false;
  return !inside(ctx, inst, arena, boss, MOBS[boss.templateId]?.bodyRadius ?? 0);
}

/** Gate the hit itself: a lethal ranged hit cannot beat the next AI tick.
 *  Pet damage requires both pet and owner on the fighting floor. */
export function bossArenaBlocksDamage(
  ctx: SimContext,
  boss: Entity,
  source: Entity | null,
): boolean {
  if (boss.kind !== 'mob' || boss.ownerId !== null) return false;
  const arena = arenaOf(boss);
  if (!arena) return false;
  const inst = claimedInstanceForMob(ctx, boss.id);
  if (!inst) return false;
  return (
    bossOutside(ctx, inst, arena, boss) ||
    (source !== null && source.id !== boss.id && !combatantInside(ctx, inst, arena, source))
  );
}

/** Run before planted casts, pins and other AI early returns. Keep the script's
 *  fight state intact so its encounter pass can clean hazards and summoned bodies. */
export function enforceBossArena(ctx: SimContext, boss: Entity): boolean {
  if (!boss.inCombat || boss.aiState === 'evade' || boss.dead || boss.ownerId !== null)
    return false;
  const arena = arenaOf(boss);
  if (!arena) return false;
  const inst = claimedInstanceForMob(ctx, boss.id);
  if (!inst) return false;
  if (boss.forcedTargetId !== null) {
    const forced = ctx.entities.get(boss.forcedTargetId);
    if (!forced || !activeCombatant(ctx, inst, arena, forced)) {
      boss.forcedTargetId = null;
      boss.forcedTargetTimer = 0;
    }
  }
  let target = boss.aggroTargetId !== null ? ctx.entities.get(boss.aggroTargetId) : undefined;
  if (target && !activeCombatant(ctx, inst, arena, target)) target = undefined;
  let fallback: Entity | undefined;
  let top = -Infinity;
  for (const [id, threat] of boss.threat) {
    const candidate = ctx.entities.get(id);
    if (!candidate || !activeCombatant(ctx, inst, arena, candidate)) boss.threat.delete(id);
    else if (threat > top) {
      top = threat;
      fallback = candidate;
    }
  }
  target ??= fallback;
  if (bossOutside(ctx, inst, arena, boss) || !target) {
    startEvadeHome(boss);
    return true;
  }
  if (boss.aggroTargetId !== target.id) {
    boss.aggroTargetId = target.id;
  }
  return false;
}
