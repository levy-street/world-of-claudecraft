import { DUNGEON_X_THRESHOLD, MOBS } from '../data';
import { combatProfileForMob, effectiveMobMeleeRange, type MobCombatProfile } from '../mob_combat';
import type { SimContext } from '../sim_context';
import { clearThreat } from '../threat';
import {
  DT,
  DUNGEON_LEASH_DISTANCE,
  dist2d,
  type Entity,
  LEASH_DISTANCE,
  steadyAngleTo,
} from '../types';
import { retargetMob, updateMobTarget } from './targeting';

export type MobCombatProfileResult = 'done' | 'runAttackMechanics';

type EngagedTickHook = () => void;

export function mobCombatProfile(mob: Entity): MobCombatProfile {
  return combatProfileForMob(mob.templateId, mob.scale);
}

export function mobEffectiveMeleeRange(mob: Entity): number {
  const profile = mobCombatProfile(mob);
  const mobMoved = dist2d(mob.pos, mob.prevPos) > 0.05;
  return effectiveMobMeleeRange(profile, mobMoved);
}

export function tryMobMeleeSwingInRange(ctx: SimContext, mob: Entity, target: Entity): boolean {
  if (dist2d(mob.pos, target.pos) > mobEffectiveMeleeRange(mob)) return false;
  mob.aiState = 'attack';
  mob.facing = steadyAngleTo(mob.pos, target.pos, mob.facing);
  if (mob.swingTimer <= 0) {
    ctx.mobSwing(mob, target);
    mob.swingTimer = mob.weapon.speed * ctx.swingIntervalMult(mob);
  }
  return true;
}

// The one general engaged-mob runner: every hostile mob in the chase or attack
// state goes through here. Ranged petSpell casters keep the classic caster
// loop (close to spell range, stand, cast); every melee mob fights hit-and-run
// through the pursuit path. The leash prelude is modeless: a mob dragged while
// in melee still evades past the leash. Boss attack mechanics stay melee-gated
// via the return value: 'runAttackMechanics' on any engaged tick that ENDS in
// melee contact (the caller runs the aoePulse/stomp/bigCast/stoneskin/terrify
// tail then).
export function updateMobCombatProfile(
  ctx: SimContext,
  mob: Entity,
  onEngagedTick?: EngagedTickHook,
): MobCombatProfileResult {
  const profile = mobCombatProfile(mob);
  updateMobTarget(ctx, mob);
  const target = mob.aggroTargetId !== null ? ctx.entities.get(mob.aggroTargetId) : null;
  if (!target || target.dead) {
    retargetMob(ctx, mob);
    return 'done';
  }
  if (ctx.maybeFlee(mob, target)) return 'done';

  if (profile.canLeash) {
    const leash = mob.spawnPos.x > DUNGEON_X_THRESHOLD ? DUNGEON_LEASH_DISTANCE : LEASH_DISTANCE;
    const leashAnchor = mob.leashAnchor ?? mob.spawnPos;
    if (mob.fleeReturnTimer > 0) {
      mob.fleeReturnTimer = Math.max(0, mob.fleeReturnTimer - DT);
      if (dist2d(mob.pos, leashAnchor) <= leash - 1) mob.fleeReturnTimer = 0;
    }
    if (dist2d(mob.pos, leashAnchor) > leash && mob.fleeReturnTimer <= 0) {
      mob.aiState = 'evade';
      mob.aggroTargetId = null;
      clearThreat(mob);
      mob.leashAnchor = null;
      return 'done';
    }
  }

  onEngagedTick?.();

  const spell = MOBS[mob.templateId]?.petSpell;
  if (spell) return updateCasterCombat(ctx, mob, target, profile, spell);

  updatePursuitProfileCombat(ctx, mob, target, profile);
  return mob.aiState === 'attack' ? 'runAttackMechanics' : 'done';
}

// The classic caster loop, keyed on the mob's engaged state: in attack it
// stands and casts until the target leaves spell range; in chase it closes
// until the target is in spell range, then flips to attack with the fast-cast
// clamp. The chase-arm melee probes are dead in practice (every shipped
// petSpell range dwarfs melee reach) but are kept verbatim from the legacy
// chase arm so a hypothetical short-range caster behaves exactly as before.
function updateCasterCombat(
  ctx: SimContext,
  mob: Entity,
  target: Entity,
  profile: MobCombatProfile,
  spell: Parameters<SimContext['updateRangedPetAttack']>[2],
): MobCombatProfileResult {
  const d = dist2d(mob.pos, target.pos);
  if (mob.aiState === 'attack') {
    if (d > spell.range) {
      mob.aiState = 'chase';
      return 'done';
    }
    ctx.updateRangedPetAttack(mob, target, spell);
    return 'done';
  }
  if (d <= spell.range) {
    mob.aiState = 'attack';
    mob.swingTimer = Math.min(mob.swingTimer, 0.4);
    return 'done';
  }
  mob.swingTimer = Math.max(0, mob.swingTimer - DT);
  if (tryMobMeleeSwingInRange(ctx, mob, target)) return 'done';
  if (!ctx.isRooted(mob)) {
    ctx.moveToward(
      mob,
      target.pos,
      mob.moveSpeed * profile.chaseSpeedMult * ctx.moveSpeedMult(mob),
    );
  } else {
    mob.facing = steadyAngleTo(mob.pos, target.pos, mob.facing);
  }
  tryMobMeleeSwingInRange(ctx, mob, target);
  return 'done';
}

function updatePursuitProfileCombat(
  ctx: SimContext,
  mob: Entity,
  target: Entity,
  profile: MobCombatProfile,
): void {
  mob.swingTimer = Math.max(0, mob.swingTimer - DT);
  if (profile.swingWhilePursuing || mob.aiState === 'attack') {
    tryMobMeleeSwingInRange(ctx, mob, target);
  }

  if (dist2d(mob.pos, target.pos) > profile.desiredRange) {
    if (!ctx.isRooted(mob)) {
      ctx.moveToward(
        mob,
        target.pos,
        mob.moveSpeed * profile.chaseSpeedMult * ctx.moveSpeedMult(mob),
      );
    } else {
      mob.facing = steadyAngleTo(mob.pos, target.pos, mob.facing);
    }
  } else {
    mob.facing = steadyAngleTo(mob.pos, target.pos, mob.facing);
  }

  if (
    profile.immediateSwingOnEnterRange ||
    profile.swingWhilePursuing ||
    mob.aiState === 'attack'
  ) {
    tryMobMeleeSwingInRange(ctx, mob, target);
  }
  mob.aiState = dist2d(mob.pos, target.pos) <= profile.meleeRange ? 'attack' : 'chase';
}
