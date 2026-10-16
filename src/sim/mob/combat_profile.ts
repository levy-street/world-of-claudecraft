import { isLockedOut, isSilenced } from '../combat/cc';
import { DUNGEON_X_THRESHOLD, MOBS } from '../data';
import {
  advancePin,
  holdsAggroInInstance,
  pinInPlace,
  releasePin,
} from '../instances/instance_combat_hold';
import { combatProfileForMob, effectiveMobMeleeRange, type MobCombatProfile } from '../mob_combat';
import { holdHoardBoneReaper } from '../rift/hoard_bone_reaper';
import { holdHoardBoulder } from '../rift/hoard_boulder';
import { holdHoardCaveBoss } from '../rift/hoard_cave_kit';
import { holdHoardCharge } from '../rift/hoard_charge';
import { holdHoardIceAge } from '../rift/hoard_ice_age';
import { holdHoardOrbitalLightning } from '../rift/hoard_orbital_lightning';
import { holdHoardPulsars } from '../rift/hoard_pulsars';
import { holdHoardSilkSnare } from '../rift/hoard_silk_snare';
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
import {
  casterObeysSight,
  casterSightBlocked,
  lastSightBlocked,
  petSpellSightVerdict,
} from './cast_sight';
import { chainPullTransitHoldsLeash, clearChainPullInbound } from './chain_pull_transit';
import {
  chaseAroundObstacles,
  endChaseRoute,
  followChaseRoute,
  restChaseRoute,
} from './chase_route';
import { updateDerelictBomber } from './derelict_bomber';
import { dragonkinEngageShout } from './dragonkin_brood';
import { NYTHRAXIS_SPIRIT_MENDING_CAST_ID } from './healer_channel';
import { blockedTowardTarget, chaseStalledUnreachable } from './reachability';
import { resetRiftMechanicWindups } from './rift_escape_window';
import { retargetMob, updateMobTarget } from './targeting';

export type MobCombatProfileResult = 'done' | 'runAttackMechanics';

type EngagedTickHook = (mode: 'normal' | 'stationary') => void;

// Drop the pull and walk home: the shared evade entry used by the leash breaks,
// the unreachable-target stall, and a warpath boss giving up (mob/warpath.ts).
// The evade arm in locomotion.ts handles the walk, the immunity lives in
// combat/damage.ts, and resetEvadingMob heals to
// full on arrival. Any in-flight cast dies with the pull: the bar would
// otherwise freeze on an immune mob walking home, and a committed ranged
// windup (rangedWindupReleaseTick is an ABSOLUTE tick) would fire instantly
// on the next pull's first in-range tick.
export function startEvadeHome(mob: Entity): void {
  mob.aiState = 'evade';
  mob.aggroTargetId = null;
  mob.autoAttack = false; // leashing home: not swinging, whatever it was doing before
  clearThreat(mob);
  mob.leashAnchor = null;
  clearChainPullInbound(mob);
  releasePin(mob);
  endChaseRoute(mob);
  // A frozen windup must not detonate mid-walk-home (its ring is long gone);
  // the full evade reset on arrival clears the rest of the mechanic state.
  resetRiftMechanicWindups(mob);
  mob.castingAbility = null;
  mob.castTotal = 0;
  mob.castRemaining = 0;
  mob.castTargetId = null;
  mob.channeling = false;
  mob.rangedWindupReleaseTick = null;
}

export function mobCombatProfile(mob: Entity): MobCombatProfile {
  return combatProfileForMob(mob.templateId, mob.scale);
}

export function mobEffectiveMeleeRange(mob: Entity): number {
  const profile = mobCombatProfile(mob);
  const mobMoved = dist2d(mob.pos, mob.prevPos) > 0.05;
  return effectiveMobMeleeRange(profile, mobMoved);
}

export function tryMobMeleeSwingInRange(ctx: SimContext, mob: Entity, target: Entity): boolean {
  if (dist2d(mob.pos, target.pos) > mobEffectiveMeleeRange(mob)) {
    mob.autoAttack = false;
    return false;
  }
  mob.aiState = 'attack';
  mob.autoAttack = true;
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
// tail then). A cast bar already started keeps counting down on the other
// engaged ticks too (mob/mob_cast_bars.ts); only STARTING one is melee-gated.
export function updateMobCombatProfile(
  ctx: SimContext,
  mob: Entity,
  onEngagedTick?: EngagedTickHook,
): MobCombatProfileResult {
  const profile = mobCombatProfile(mob);
  updateMobTarget(ctx, mob);
  const target = mob.aggroTargetId !== null ? ctx.entities.get(mob.aggroTargetId) : null;
  if (!target || target.dead) {
    mob.autoAttack = false;
    // No target, no pin: a mob that lost its fight never keeps the immune stance.
    releasePin(mob);
    // Its path goes with the target; its route throttle stays for whoever it
    // turns on next (mob/chase_route.ts), and ends with the pull.
    restChaseRoute(mob);
    retargetMob(ctx, mob);
    return 'done';
  }
  if (ctx.maybeFlee(mob, target)) return 'done';

  // Inside a claimed instance slot a mob never resets by distance
  // (instances/instance_combat_hold.ts): neither leash sends it home, and a
  // stall holds it in place immune and aggro'd instead.
  const instanceHold = profile.canLeash && holdsAggroInInstance(ctx, mob);
  if (profile.canLeash) {
    // The hard tether measures from the SPAWN, never the refreshing anchor,
    // and ignores the flee-recovery grace: past it the mob goes home, however
    // the fight has been dragged. Checked before the soft leash so a tethered
    // mob can never be walked out one anchor-refresh at a time. Inside a slot
    // neither leash ever sends the mob home; the bookkeeping below still runs
    // so a chain pull's transit grace is spent on arrival as before.
    const hardLeash = mob.ignoreHardLeash ? undefined : MOBS[mob.templateId]?.hardLeashRadius;
    if (!instanceHold && hardLeash !== undefined && dist2d(mob.pos, mob.spawnPos) > hardLeash) {
      startEvadeHome(mob);
      return 'done';
    }
    const leash = mob.spawnPos.x > DUNGEON_X_THRESHOLD ? DUNGEON_LEASH_DISTANCE : LEASH_DISTANCE;
    const leashAnchor = mob.leashAnchor ?? mob.spawnPos;
    if (mob.fleeReturnTimer > 0) {
      mob.fleeReturnTimer = Math.max(0, mob.fleeReturnTimer - DT);
      if (dist2d(mob.pos, leashAnchor) <= leash - 1) mob.fleeReturnTimer = 0;
    }
    // A chain-pulled mob answering the call from the far end of the instance
    // starts OUTSIDE its own leash sphere by design (the pull anchors it on the
    // puller), so the soft leash is suspended until it arrives. Evaluated
    // unconditionally, like the flee grace above: the call is what SPENDS the
    // grace on the arrival tick, so short-circuiting it past the distance test
    // would leave an arrived mob permanently unleashed. It holds nothing else,
    // so the hard tether above and the stall postlude below still apply. See
    // mob/chain_pull_transit.ts.
    const inTransit = chainPullTransitHoldsLeash(mob, leashAnchor, leash);
    if (
      !instanceHold &&
      dist2d(mob.pos, leashAnchor) > leash &&
      mob.fleeReturnTimer <= 0 &&
      !inTransit
    ) {
      startEvadeHome(mob);
      return 'done';
    }
  }

  // Suicide-bomber mechs own their whole engaged tick (face-before-move approach,
  // arming windup, detonation) in place of the normal pursuit + melee swing.
  if (MOBS[mob.templateId]?.meleeBomb) {
    updateDerelictBomber(ctx, mob, target, profile);
    return 'done';
  }

  if (
    holdHoardOrbitalLightning(ctx, mob) ||
    holdHoardBoneReaper(ctx, mob) ||
    holdHoardIceAge(ctx, mob) ||
    holdHoardPulsars(ctx, mob) ||
    holdHoardBoulder(ctx, mob) ||
    holdHoardCharge(ctx, mob) ||
    holdHoardSilkSnare(ctx, mob)
  ) {
    onEngagedTick?.('stationary');
    mob.swingTimer = Math.max(0, mob.swingTimer - DT);
    tryMobMeleeSwingInRange(ctx, mob, target);
    return 'done';
  }
  // A cave boss its module is moving (a leap, a dive) or has underground swings
  // at nobody: it is in the air or under the floor (src/sim/rift/hoard_cave_kit.ts).
  if (holdHoardCaveBoss(ctx, mob)) {
    onEngagedTick?.('stationary');
    return 'done';
  }
  onEngagedTick?.('normal');

  // Dragonkin engage shout: the brood bellows BEFORE it walks. Fires once per
  // pull (shoutFired resets on evade/respawn with the other pull state); for
  // the shout window the mob stands rooted facing its target, not moving and
  // not swinging (the player's cue to pre-position), while the broodlords'
  // shout also cracks the surrounding eggs awake and wards their hatchlings
  // (mob/dragonkin_brood.ts).
  const shout = MOBS[mob.templateId]?.engageShout;
  if (shout) {
    if (!mob.shoutFired) {
      mob.shoutFired = true;
      mob.shoutIntroUntil = ctx.time + shout.rootSeconds;
      dragonkinEngageShout(ctx, mob, shout);
    }
    if (mob.shoutIntroUntil !== undefined && ctx.time < mob.shoutIntroUntil) {
      mob.facing = steadyAngleTo(mob.pos, target.pos, mob.facing);
      mob.aiState = 'attack';
      mob.autoAttack = false; // standing through the shout window, not swinging yet
      return 'done';
    }
  }

  // A channelHeal caster (Malric, the Nythraxis spirit healer) is a HEALER, not a
  // bruiser: it holds a standoff near its protectee (the boss) and channels a
  // visible heal instead of running the raid down. Falls back to melee only when
  // there is no ally in range to heal. The heal itself still resolves in
  // updateBossMechanics; this only governs where the healer stands.
  const healHold = updateHealerHold(ctx, mob);
  if (healHold) return healHold;

  // The unreachable-target stall runs as a POSTLUDE, after the combat arm has
  // moved the mob, so "did it move this tick" is measurable. States that must
  // not accumulate never reach it: CC early-returns and charge dashes own their
  // tick upstream in updateMob, a holding healer returned above, and canLeash
  // opts an encounter out entirely (same gate as the leash prelude).
  const spell = MOBS[mob.templateId]?.petSpell;
  const chaseSpeed = mob.moveSpeed * profile.chaseSpeedMult * ctx.moveSpeedMult(mob);
  if (spell) {
    const sight = casterObeysSight(mob, profile);
    const result = updateCasterCombat(ctx, mob, target, profile, spell, sight);
    // Standing at spell range is "in reach" only for a caster that can see its
    // target (mob/cast_sight.ts): one walled off from it must close like a
    // melee mob, so a caster no route brings to a sight line stalls like any
    // other unreachable chase instead of standing in range forever. With a
    // clear line the bookkeeping is the base's, tick for tick.
    const walledOff = sight && lastSightBlocked(mob, target);
    const reach = walledOff ? profile.meleeRange : spell.range;
    // Intended, and only for a walled-off caster: one standing through its
    // own cast bar is planted by the cast (an area bar holds it on its spot,
    // mob/trash_kit/cast_hold.ts), not pinned by the wall, so the stall clock
    // holds for the bar, as it does for a root. Without this a caster that
    // lost sight mid-bar would count the bar toward an evade it never earned.
    if (
      profile.canLeash &&
      !(walledOff && mob.castingAbility !== null) &&
      chaseStalledUnreachable(ctx, mob, target, reach, chaseSpeed)
    ) {
      onChaseStalled(mob, instanceHold);
      return 'done';
    }
    return result;
  }

  updatePursuitProfileCombat(ctx, mob, target, profile);
  if (
    profile.canLeash &&
    chaseStalledUnreachable(ctx, mob, target, profile.meleeRange, chaseSpeed)
  ) {
    onChaseStalled(mob, instanceHold);
    return 'done';
  }
  return mob.aiState === 'attack' ? 'runAttackMechanics' : 'done';
}

/**
 * The pinned arm (instances/instance_combat_hold.ts): the whole engaged tick of
 * a mob holding in place. It stands, faces its target, swings and casts nothing
 * (the caller skips every mechanic), and re-checks the hold each tick: the
 * target back in reach, or an open step toward it, releases the pin and the
 * normal chase resumes next tick. Once the grace is spent it phases straight
 * through the blocking geometry toward the target every tick until in reach,
 * so a perch ends in a fight rather than a stalemate. A lost target drops the
 * pin with the fight. Draws no rng.
 */
export function holdPinnedMob(ctx: SimContext, mob: Entity): void {
  const target = mob.aggroTargetId !== null ? ctx.entities.get(mob.aggroTargetId) : null;
  if (!target || target.dead) {
    releasePin(mob);
    mob.autoAttack = false;
    retargetMob(ctx, mob);
    return;
  }
  const profile = mobCombatProfile(mob);
  const spell = MOBS[mob.templateId]?.petSpell;
  const reach = spell?.range ?? profile.meleeRange;
  const chaseSpeed = mob.moveSpeed * profile.chaseSpeedMult * ctx.moveSpeedMult(mob);
  mob.autoAttack = false;
  mob.facing = steadyAngleTo(mob.pos, target.pos, mob.facing);
  // A caster is in reach at spell range only when it also sees its target
  // (mob/cast_sight.ts); walled off, it holds and then phases like a melee mob.
  if (
    dist2d(mob.pos, target.pos) <= reach &&
    !(
      spell !== undefined &&
      casterObeysSight(mob, profile) &&
      casterSightBlocked(ctx, mob, target, spell.range)
    )
  ) {
    releasePin(mob);
    return;
  }
  if (advancePin(mob)) {
    ctx.moveToward(mob, target.pos, chaseSpeed, true);
    return;
  }
  if (!blockedTowardTarget(ctx, mob, target.pos, chaseSpeed)) releasePin(mob);
}

/** The stall verdict: an unreachable target sends an open-world mob home (the
 *  classic evade, full heal on arrival), while an instance mob holds in place
 *  immune and aggro'd (instances/instance_combat_hold.ts) so a perch inside a
 *  dungeon neither resets the pull nor yields free damage. */
export function onChaseStalled(mob: Entity, instanceHold: boolean): void {
  if (instanceHold) {
    pinInPlace(mob);
    return;
  }
  startEvadeHome(mob);
}

// Healer-hold behavior for channelHeal mobs: stand a short distance from the
// biggest friendly mob in heal range (the boss) and channel; close the gap if too
// far. Returns 'done' while healing (no melee), or null when there is nobody to
// heal so the caller runs the normal melee AI.
function updateHealerHold(ctx: SimContext, mob: Entity): MobCombatProfileResult | null {
  const heal = MOBS[mob.templateId]?.channelHeal;
  if (!heal) return null;
  // Cached protectee: only walk the whole entity map when the cached one is gone,
  // dead, or out of range (mirrors the timer-gated mendAlly/wardAllies scans rather
  // than scanning every tick while engaged).
  let protectee =
    mob.healProtecteeId != null ? (ctx.entities.get(mob.healProtecteeId) ?? null) : null;
  if (!protectee || protectee.dead || dist2d(protectee.pos, mob.pos) > heal.radius) {
    protectee = null;
    for (const ally of ctx.entities.values()) {
      if (ally.kind !== 'mob' || ally.dead || ally.ownerId !== null) continue;
      if (ally.hostile !== mob.hostile || ally.id === mob.id) continue;
      if (dist2d(ally.pos, mob.pos) > heal.radius) continue;
      if (!protectee || ally.maxHp > protectee.maxHp) protectee = ally;
    }
    mob.healProtecteeId = protectee?.id ?? null;
  }
  if (!protectee) return null; // nobody to heal: fall back to melee AI
  mob.autoAttack = false; // healing/standing off, never melee, in every branch below
  mob.facing = Math.atan2(protectee.pos.x - mob.pos.x, protectee.pos.z - mob.pos.z);
  const clearBar = () => {
    mob.castingAbility = null;
    mob.castTotal = 0;
    mob.castRemaining = 0;
    mob.channeling = false;
  };
  const HEALER_STANDOFF = 6;
  if (dist2d(mob.pos, protectee.pos) > HEALER_STANDOFF) {
    ctx.moveToward(mob, protectee.pos, mob.moveSpeed * ctx.moveSpeedMult(mob));
    mob.aiState = 'chase';
    clearBar();
  } else if (isSilenced(mob) || isLockedOut(mob, heal.school ?? 'shadow')) {
    // Interrupted (silenced or school-locked): stand idle with no cast bar. The
    // channelHeal break in updateBossMechanics has already reset the ramp.
    mob.aiState = 'attack';
    clearBar();
  } else {
    // In position and free: stand still and channel a visible cast bar counting
    // down to the next heal tick (driven by channelTimer in updateBossMechanics).
    mob.aiState = 'attack';
    mob.castingAbility = NYTHRAXIS_SPIRIT_MENDING_CAST_ID;
    mob.castTotal = heal.every;
    mob.castRemaining = Math.max(0, mob.channelTimer);
    mob.channeling = true;
  }
  return 'done';
}

// The classic caster loop, keyed on the mob's engaged state: in attack it
// stands and casts until the target leaves spell range or its sight; in chase
// it closes until the target is in spell range AND in sight, then flips to
// attack with the fast-cast clamp. A cast needs a line of sight to begin and
// to land (mob/cast_sight.ts), and a caster without one walks its route round
// the wall (mob/chase_route.ts) instead of casting through it. The chase-arm
// melee probes are dead in practice (every shipped petSpell range dwarfs melee
// reach) but are kept verbatim from the legacy chase arm so a hypothetical
// short-range caster behaves exactly as before.
function updateCasterCombat(
  ctx: SimContext,
  mob: Entity,
  target: Entity,
  profile: MobCombatProfile,
  spell: Parameters<SimContext['updateRangedPetAttack']>[2],
  // Does this caster obey the sight rule (cast_sight.ts casterObeysSight)? One
  // that does not (a boss, a pet, a canLeash-false script) asks for no line of
  // sight and plans no route: every branch below that `sight` gates is skipped
  // and what is left is the loop as it was, the straight ctx.moveToward chase
  // included.
  sight: boolean,
): MobCombatProfileResult {
  const d = dist2d(mob.pos, target.pos);
  if (mob.aiState === 'attack') {
    if (d > spell.range) {
      mob.aiState = 'chase';
      return 'done';
    }
    mob.autoAttack = false; // casting from range, not swinging
    if (sight) {
      // Sight is asked for when a cast begins and when its windup ends, never
      // in between: a target that hides mid-windup lets the windup run out and
      // then takes nothing.
      const verdict = petSpellSightVerdict(ctx, mob, target);
      if (verdict === 'seek') {
        mob.aiState = 'chase';
        return 'done';
      }
      // A failed cast is over; one whose start must wait for the tick's
      // sight budget begins next tick. Neither runs the attack this tick.
      if (verdict === 'failed' || verdict === 'wait') return 'done';
    }
    ctx.updateRangedPetAttack(mob, target, spell);
    return 'done';
  }
  const blocked = sight && casterSightBlocked(ctx, mob, target, spell.range);
  if (d <= spell.range && !blocked) {
    mob.aiState = 'attack';
    mob.swingTimer = Math.min(mob.swingTimer, 0.4);
    // The path is done with; its throttle and spent plans are kept, so a
    // target dancing in and out of sight cannot buy a fresh plan each time.
    restChaseRoute(mob);
    return 'done';
  }
  mob.swingTimer = Math.max(0, mob.swingTimer - DT);
  if (tryMobMeleeSwingInRange(ctx, mob, target)) return 'done';
  if (!ctx.isRooted(mob)) {
    const speed = mob.moveSpeed * profile.chaseSpeedMult * ctx.moveSpeedMult(mob);
    // No line of sight: round the wall by its route. Otherwise (the target is
    // only out of range, or there is no route to take) the ordinary chase
    // step: straight at it, unless the mob is still walking a route it began
    // or has stopped dead on geometry (chaseAroundObstacles).
    if (!sight) ctx.moveToward(mob, target.pos, speed);
    else if (!(blocked && followChaseRoute(ctx, mob, target, speed))) {
      chaseAroundObstacles(ctx, mob, target, speed);
    }
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
  mob.autoAttack = false; // default: tryMobMeleeSwingInRange will overwrite to true if genuinely in range
  mob.swingTimer = Math.max(0, mob.swingTimer - DT);
  if (profile.swingWhilePursuing || mob.aiState === 'attack') {
    tryMobMeleeSwingInRange(ctx, mob, target);
  }

  if (dist2d(mob.pos, target.pos) > profile.desiredRange) {
    if (!ctx.isRooted(mob)) {
      // Straight at the target, and (a mob that leashes; chase_route.ts
      // leaves bosses and pets out itself) round a wall the straight chase has
      // stopped dead on instead of standing against it.
      const speed = mob.moveSpeed * profile.chaseSpeedMult * ctx.moveSpeedMult(mob);
      if (profile.canLeash) chaseAroundObstacles(ctx, mob, target, speed);
      else ctx.moveToward(mob, target.pos, speed);
    } else {
      mob.facing = steadyAngleTo(mob.pos, target.pos, mob.facing);
    }
  } else {
    mob.facing = steadyAngleTo(mob.pos, target.pos, mob.facing);
    // Where it wants to stand: whatever route brought it here is done with
    // (its throttle and spent plans are kept).
    restChaseRoute(mob);
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
