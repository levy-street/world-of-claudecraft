// Mob locomotion (M2), extracted from the Sim monolith.
//
// This module owns the mob-AI locomotion core: the updateMob dispatcher (its
// corpse-tick prologue, the vision/owner/Nythraxis-add early returns, the
// stun/polymorph/fear guard, and the idle/chase/attack/flee/evade switch), the
// melee-gated boss attack mechanics (runMobAttackMechanics) and engaged-tick
// pulses, plus the movement satellites resetEvadingMob, recoverFromFlee, and
// blockedTowardSpawn. The engaged chase/attack states route through the general
// combat-profile runner in the sibling mob/combat_profile.ts; the pet, Nythraxis
// encounter, and corpse-lifecycle branches the dispatcher interleaves stay on Sim
// and are reached through the SimContext seam.
//
// PRIME DIRECTIVE: this is a MOVE, not a rewrite. Every function below is the former
// `Sim` method verbatim, with `this.X` rewritten to `ctx.X` (the SimContext seam),
// to the sibling mob/targeting functions (retargetMob/updateMobTarget/isTrivialTo),
// or to the sibling locomotion functions in this module. Statement order, branch
// order, the `return`-vs-`break` early exits, and EVERY rng draw position
// (corpse-tick, detection scans, idle wander, the four boss-mechanic draws, and the
// resetEvadingMob wander draw) are preserved exactly so the parity gate's full-state
// trace AND rng draw-order log stay byte-identical. The in-place Entity mutation is
// intentional (the refactor's immutability waiver). The Nythraxis death-dialogue
// branch is factored out behind ctx.onBossDeath (its body stays on Sim for N1).
//
// `src/sim`-pure: no DOM/Three/render/ui/game/net imports, no Math.random/Date.now
// (enforced by tests/architecture.test.ts). data/types/world/threat/pathfind and the
// sibling targeting module are imported directly (already pure); everything that
// touches not-yet-extracted Sim state routes through the seam.

import { DUNGEON_X_THRESHOLD, MOBS } from '../data';
import { resetDrownedLitanyBossEncounter } from '../delves/drowned_litany_boss';
import { PLAYER_BODY_RADIUS, PLAYER_SWIM_DEPTH } from '../pathfind';
import type { SimContext } from '../sim_context';
import { clearThreat, stealthDetectionRadius } from '../threat';
import {
  type Aura,
  angleTo,
  DT,
  DUNGEON_LEASH_DISTANCE,
  dist2d,
  type Entity,
  LEASH_DISTANCE,
  MELEE_RANGE,
  NYTHRAXIS_ADD_ID,
  NYTHRAXIS_BOSS_ID,
  SISTER_NHALIA_BOSS_ID,
  TOLLING_BELL_TEMPLATE_ID,
  type Vec3,
} from '../types';
import { groundHeight, waterLevelAt } from '../world';
import { updateMobCombatProfile } from './combat_profile';
import { rallyFleeingAllies } from './social_aggro';
import { isTrivialTo, retargetMob, tickForcedTarget } from './targeting';
import { emitMobYell } from './yells';

const EVADE_SPEED_MULT = 1.6;
// An evading mob walks a straight line home (no pathfinding) and stalls if deep
// water or a collider sits between it and its spawn. Since evading mobs are
// immune while resetting, a permanent stall = a permanently unkillable mob. If it
// can't get closer to home for this long, it starts phasing through the blocker.
const EVADE_STALL_TIMEOUT = 3;
const FLEE_RETURN_GRACE = 8;
const SWIM_DEPTH = PLAYER_SWIM_DEPTH; // ground this far under the water line = deep water
const BODY_RADIUS = PLAYER_BODY_RADIUS;

export function updateMob(ctx: SimContext, mob: Entity): void {
  if (mob.dead) {
    ctx.onBossDeath(mob);
    if (mob.ownerId !== null && MOBS[mob.templateId]?.family !== 'demon') return;
    mob.corpseTimer -= DT;
    mob.respawnTimer -= DT;
    if (mob.lootFfaTimer > 0) mob.lootFfaTimer -= DT; // owner-lock lapses, then loot goes FFA
    // Death Throes: a volatile corpse counts down its fuse, then detonates once.
    if (mob.detonateTimer !== Infinity) {
      mob.detonateTimer -= DT;
      if (mob.detonateTimer <= 0) {
        mob.detonateTimer = Infinity;
        ctx.detonateCorpse(mob);
      }
    }
    // a slain summoned demon unravels rather than respawning into the wild
    if (mob.ownerId !== null && MOBS[mob.templateId]?.family === 'demon') {
      if (mob.corpseTimer <= 0) ctx.despawnPet(mob);
      return;
    }
    // dungeon mobs stay dead until the instance resets
    const isInstanceMob = mob.spawnPos.x > DUNGEON_X_THRESHOLD;
    if (!isInstanceMob && mob.respawnTimer <= 0 && (mob.corpseTimer <= 0 || !mob.lootable)) {
      ctx.respawnMob(mob);
    }
    return;
  }

  mob.combatTimer += DT;

  if (mob.templateId.startsWith('vision_')) {
    mob.hostile = false;
    mob.aiState = 'idle';
    mob.inCombat = false;
    mob.aggroTargetId = null;
    clearThreat(mob);
    return;
  }

  // Tolling Bell projectiles (The Drowned Litany finale) are moved exclusively
  // by the boss driver: no aggro, no wander, no evade-home, and the hostility
  // safety net below must not re-hostile them.
  if (mob.templateId === TOLLING_BELL_TEMPLATE_ID) {
    mob.hostile = false;
    mob.aiState = 'idle';
    mob.inCombat = false;
    mob.aggroTargetId = null;
    clearThreat(mob);
    return;
  }

  if (mob.ownerId !== null) {
    if (ctx.isStunned(mob)) return;
    if (ctx.isDelveCompanionMob(mob)) {
      ctx.updateDelveCompanion(mob);
      return;
    }
    ctx.updatePet(mob);
    return;
  }

  // Self-healing safety net (#113/#99): every mob spawns hostile and only
  // taming clears that (which always assigns an owner). A live, owner-less,
  // non-hostile mob is therefore a leak — exactly the "immortal, invalid
  // target" wolves players hit. Restore hostility so no mob can ever be left
  // permanently untargetable, whatever path corrupted it.
  if (mob.templateId === NYTHRAXIS_ADD_ID && mob.despawnTimer !== undefined) {
    mob.hostile = false;
    mob.aiState = 'idle';
    mob.inCombat = false;
    mob.aggroTargetId = null;
    return;
  }

  if (!mob.hostile) mob.hostile = true;

  const isNythraxis = mob.templateId === NYTHRAXIS_BOSS_ID;
  if (mob.inCombat || (isNythraxis && mob.nythraxis && mob.nythraxis.phase !== 'dead')) {
    const nythraxisScriptLocked =
      isNythraxis &&
      mob.nythraxis &&
      (mob.nythraxis.phase === 'transition' ||
        mob.nythraxis.deathlessCastRemaining > 0 ||
        mob.nythraxis.deathlessStunRemaining > 0);
    if (isNythraxis) {
      ctx.updateNythraxisEncounter(mob);
      if (
        nythraxisScriptLocked ||
        (mob.nythraxis &&
          (mob.nythraxis.phase === 'transition' ||
            mob.nythraxis.deathlessCastRemaining > 0 ||
            mob.nythraxis.deathlessStunRemaining > 0))
      )
        return;
    } else {
      ctx.updateBossMechanics(mob);
    }
  }

  if (ctx.isStunned(mob)) {
    // A taunt/growl window is real-time: keep it counting down even while the mob
    // is stunned, since the stun path skips updateMobTarget where it normally ticks.
    tickForcedTarget(mob);
    if (ctx.updateFearMovement(mob)) return;
    if (mob.auras.some((a) => a.kind === 'polymorph')) {
      mob.wanderTimer -= DT;
      if (mob.wanderTimer <= 0) {
        mob.wanderTimer = ctx.rng.range(0.8, 2);
        mob.facing = ctx.rng.range(-Math.PI, Math.PI);
      }
      const step = 1.6 * DT;
      mob.pos.x += Math.sin(mob.facing) * step;
      mob.pos.z += Math.cos(mob.facing) * step;
      mob.pos.y = groundHeight(mob.pos.x, mob.pos.z, ctx.cfg.seed);
    }
    return;
  }

  switch (mob.aiState) {
    case 'idle': {
      if (mob.templateId === NYTHRAXIS_BOSS_ID && !mob.inCombat) {
        mob.wanderTarget = null;
        mob.wanderTimer = 3;
        mob.pos = { ...mob.spawnPos };
        mob.prevPos = { ...mob.pos };
        mob.facing = Math.PI;
        mob.prevFacing = Math.PI;
        const template = MOBS[mob.templateId];
        let detected: Entity | null = null;
        let detectedD = Infinity;
        ctx.playerGrid.forEachInRadius(mob.pos.x, mob.pos.z, 25, (e, d2) => {
          if (e.dead) return;
          const radius = Math.max(
            4,
            Math.min(20, template.aggroRadius + (mob.level - e.level) * 1.5),
          );
          const d = Math.sqrt(d2);
          if (d < radius && d < detectedD) {
            detected = e;
            detectedD = d;
          }
        });
        if (detected) ctx.aggroMob(mob, detected, true);
        return;
      }
      const template = MOBS[mob.templateId];
      let detected: Entity | null = null;
      let detectedD = Infinity;
      ctx.playerGrid.forEachInRadius(mob.pos.x, mob.pos.z, 25, (e, d2) => {
        if (e.dead) return;
        if (isTrivialTo(mob, e)) return;
        let radius = Math.max(4, Math.min(20, template.aggroRadius + (mob.level - e.level) * 1.5));
        radius *= ctx.delveDetectMult(e);
        // stealthed rogues are harder to detect, relative to observer level
        if (e.auras.some((a) => a.kind === 'stealth'))
          radius = stealthDetectionRadius(mob, e, radius);
        const d = Math.sqrt(d2);
        if (d < radius && d < detectedD) {
          detected = e;
          detectedD = d;
        }
      });
      if (detected) {
        ctx.aggroMob(mob, detected, true);
        break;
      }
      mob.wanderTimer -= DT;
      if (mob.wanderTimer <= 0) {
        if (mob.wanderTarget) {
          mob.wanderTarget = null;
          mob.wanderTimer = ctx.rng.range(3, 10);
        } else {
          const ang = ctx.rng.range(0, Math.PI * 2);
          const r = ctx.rng.range(2, 9);
          mob.wanderTarget = ctx.groundPos(
            mob.spawnPos.x + Math.sin(ang) * r,
            mob.spawnPos.z + Math.cos(ang) * r,
          );
          mob.wanderTimer = 30;
        }
      }
      if (mob.wanderTarget) {
        const arrived = ctx.moveToward(mob, mob.wanderTarget, mob.moveSpeed * 0.35);
        if (arrived) {
          mob.wanderTarget = null;
          mob.wanderTimer = ctx.rng.range(3, 10);
        }
      }
      break;
    }
    case 'chase':
    case 'attack': {
      const result = updateMobCombatProfile(ctx, mob, () => {
        // The anti-kite snare and loud battle cries fire once per engaged tick,
        // from either engaged state (mid-chase is the kite case they exist for).
        pulseAntiKiteSnare(ctx, mob);
        pulseLoudYell(ctx, mob);
      });
      if (result === 'runAttackMechanics') runMobAttackMechanics(ctx, mob);
      break;
    }
    case 'flee': {
      const target = mob.aggroTargetId !== null ? ctx.entities.get(mob.aggroTargetId) : null;
      if (!target || target.dead) {
        retargetMob(ctx, mob);
        break;
      }
      const fleeSpeed = ctx.fleeMoveSpeed(mob);
      // A panic flee should not be the thing that breaks leash and full-heals
      // the mob. If it reaches the leash edge, it recovers and re-engages;
      // normal chase/attack leash checks still handle genuine dragged pulls.
      const leash = mob.spawnPos.x > DUNGEON_X_THRESHOLD ? DUNGEON_LEASH_DISTANCE : LEASH_DISTANCE;
      const leashAnchor = mob.leashAnchor ?? mob.spawnPos;
      if (dist2d(mob.pos, leashAnchor) >= leash - fleeSpeed * DT) {
        recoverFromFlee(mob, target, leash, leashAnchor);
        break;
      }
      mob.fleeTimer -= DT;
      if (mob.fleeTimer <= 0) {
        // Recover nerve and turn to fight again; hasFled keeps it from re-fleeing.
        recoverFromFlee(mob, target, leash, leashAnchor);
        mob.swingTimer = Math.min(mob.swingTimer, 0.4);
        break;
      }
      // Each tick of the flee, look for a local same-family ally to run back with. The
      // instant the fleer reaches one (the first non-empty rally), that local cluster
      // joins the fight and the fleer turns back to re-engage WITH it. Ending the flee on
      // first contact is what keeps the rally LOCAL: the fleer pulls one cluster, then
      // heads back the way it came, so it never chains the rest of the pack down the lane.
      if (rallyFleeingAllies(ctx, mob, target) > 0) {
        recoverFromFlee(mob, target, leash, leashAnchor);
        mob.swingTimer = Math.min(mob.swingTimer, 0.4);
        break;
      }
      // Run directly away from the attacker. A root pins it in place (it just
      // cowers facing away); a stun is already handled by the early return above.
      const away = angleTo(target.pos, mob.pos);
      mob.facing = away;
      if (!ctx.isRooted(mob)) {
        const fleePos = ctx.groundPos(
          mob.pos.x + Math.sin(away) * 10,
          mob.pos.z + Math.cos(away) * 10,
        );
        ctx.moveToward(mob, fleePos, fleeSpeed);
      }
      break;
    }
    case 'evade': {
      // moveToward has no pathfinding: a straight line home that crosses a prop
      // (the camp tent/crate/campfire) or deep water makes no progress, so the
      // mob stays evading — and therefore immune — forever. Walk home normally,
      // but once stalled, phase straight through the blocker just until a normal
      // step works again. Phasing always makes progress, so arrival is the
      // backstop: worst case it phases the rest of the way home.
      const phasing = mob.evadeStall >= EVADE_STALL_TIMEOUT;
      const distBefore = dist2d(mob.pos, mob.spawnPos);
      const arrived = ctx.moveToward(mob, mob.spawnPos, mob.moveSpeed * EVADE_SPEED_MULT, phasing);
      if (arrived) {
        resetEvadingMob(ctx, mob);
      } else if (phasing) {
        if (!blockedTowardSpawn(ctx, mob, mob.spawnPos)) mob.evadeStall = 0; // cleared the obstacle
      } else if (dist2d(mob.pos, mob.spawnPos) < distBefore - 1e-3) {
        mob.evadeStall = 0; // walking home fine
      } else {
        mob.evadeStall += DT; // pinned on something
      }
      break;
    }
  }
}

function runMobAttackMechanics(ctx: SimContext, mob: Entity): void {
  // Boss/miniboss pulse mechanic.
  const pulse = MOBS[mob.templateId]?.aoePulse;
  if (pulse) {
    mob.pulseTimer -= DT;
    if (mob.pulseTimer <= 0) {
      mob.pulseTimer = pulse.every;
      const school = pulse.school ?? 'shadow';
      ctx.emit({
        type: 'spellfx',
        sourceId: mob.id,
        targetId: mob.id,
        school,
        fx: pulse.fx ?? 'nova',
      });
      for (const meta of ctx.players.values()) {
        const pe = ctx.entities.get(meta.entityId);
        if (pe && !pe.dead && dist2d(pe.pos, mob.pos) <= pulse.radius) {
          const dmg = Math.round(ctx.rng.range(pulse.min, pulse.max));
          ctx.dealDamage(mob, pe, dmg, false, school, pulse.name, 'hit', true);
        }
      }
    }
  }
  // Boss/miniboss War Stomp: a periodic ground slam that stuns and optionally
  // damages nearby players. Telegraphed via createMob, which seeds stompTimer to
  // one full interval so the first slam never lands the instant combat opens.
  const stomp = MOBS[mob.templateId]?.stomp;
  if (stomp) {
    mob.stompTimer -= DT;
    if (mob.stompTimer <= 0) {
      mob.stompTimer = stomp.every;
      const school = stomp.school ?? 'physical';
      ctx.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'nova' });
      ctx.emit({
        type: 'log',
        text: `${mob.name} unleashes ${stomp.name}!`,
        color: '#ff9933',
        entityId: mob.id,
      });
      for (const meta of ctx.players.values()) {
        const pe = ctx.entities.get(meta.entityId);
        if (!pe || pe.dead || dist2d(pe.pos, mob.pos) > stomp.radius) continue;
        if (stomp.min !== undefined && stomp.max !== undefined) {
          const dmg = Math.round(ctx.rng.range(stomp.min, stomp.max));
          ctx.dealDamage(mob, pe, dmg, false, school, stomp.name, 'hit', true);
        }
        if (pe.dead) continue; // a fatal slam should not also stun the corpse
        ctx.applyAura(pe, {
          id: 'stomp_stun',
          name: stomp.name,
          kind: 'stun',
          remaining: stomp.duration,
          duration: stomp.duration,
          value: 0,
          sourceId: mob.id,
          school: school as Aura['school'],
        });
      }
    }
  }
  // Telegraphed hardcast (bigCast): a periodic big spell with a real cast bar.
  // The cadence timer ticks like aoePulse; at zero the mob starts casting and
  // keeps meleeing while the bar fills, then the spell lands as an AoE nova on
  // every living player in radius.
  const bigCast = MOBS[mob.templateId]?.bigCast;
  if (bigCast) {
    if (mob.castingAbility === bigCast.castId) {
      mob.castRemaining = Math.max(0, mob.castRemaining - DT);
      if (mob.castRemaining <= 0) {
        mob.castingAbility = null;
        mob.castTotal = 0;
        mob.castRemaining = 0;
        mob.castTargetId = null;
        const school = (bigCast.school ?? 'nature') as Aura['school'];
        ctx.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'nova' });
        ctx.emit({
          type: 'log',
          text: `${mob.name} unleashes ${bigCast.name}!`,
          color: '#ff9933',
          entityId: mob.id,
        });
        for (const meta of ctx.players.values()) {
          const pe = ctx.entities.get(meta.entityId);
          if (pe && !pe.dead && dist2d(pe.pos, mob.pos) <= bigCast.radius) {
            const dmg = Math.round(ctx.rng.range(bigCast.min, bigCast.max));
            ctx.dealDamage(mob, pe, dmg, false, school, bigCast.name, 'hit', true);
          }
        }
      }
    } else {
      mob.bigCastTimer -= DT;
      if (mob.bigCastTimer <= 0) {
        mob.bigCastTimer = bigCast.every + bigCast.castTime;
        mob.castingAbility = bigCast.castId;
        mob.castTotal = bigCast.castTime;
        mob.castRemaining = bigCast.castTime;
        mob.castTargetId = null;
        mob.channeling = false;
        if (bigCast.yell) emitMobYell(ctx, mob, bigCast.yell);
      }
    }
  }
  // Stoneskin: a periodic self-absorb barrier. Telegraphed via createMob, which
  // seeds stoneskinTimer to one full interval so the first barrier never snaps up
  // the instant combat opens.
  const stoneskin = MOBS[mob.templateId]?.stoneskin;
  if (stoneskin) {
    mob.stoneskinTimer -= DT;
    if (mob.stoneskinTimer <= 0) {
      mob.stoneskinTimer = stoneskin.every;
      const school = (stoneskin.school ?? 'physical') as Aura['school'];
      ctx.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'nova' });
      ctx.emit({
        type: 'log',
        text: `${mob.name} unleashes ${stoneskin.name}!`,
        color: '#c9c2b5',
        entityId: mob.id,
      });
      ctx.applyAura(mob, {
        id: `stoneskin_${mob.templateId}`,
        name: stoneskin.name,
        kind: 'absorb',
        remaining: stoneskin.duration,
        duration: stoneskin.duration,
        value: stoneskin.amount,
        sourceId: mob.id,
        school,
      });
    }
  }
  // Banshee's Wail: a periodic, telegraphed scream that terrifies nearby players
  // into fleeing. It applies the `fear_incap` aura that `updateFearMovement` drives.
  const terrify = MOBS[mob.templateId]?.terrify;
  if (terrify) {
    mob.terrifyTimer -= DT;
    if (mob.terrifyTimer <= 0) {
      mob.terrifyTimer = terrify.every;
      const school = terrify.school ?? 'shadow';
      ctx.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'nova' });
      ctx.emit({
        type: 'log',
        text: `${mob.name} unleashes ${terrify.name}!`,
        color: '#ff9933',
        entityId: mob.id,
      });
      for (const meta of ctx.players.values()) {
        const pe = ctx.entities.get(meta.entityId);
        if (!pe || pe.dead || dist2d(pe.pos, mob.pos) > terrify.radius) continue;
        const remaining = ctx.diminishedCrowdControlDuration(mob, pe, 'fear', terrify.duration);
        if (remaining === null) continue;
        ctx.applyAura(pe, {
          id: 'fear_incap',
          name: terrify.name,
          kind: 'incapacitate',
          remaining,
          duration: remaining,
          value: ctx.rng.range(-Math.PI, Math.PI),
          sourceId: mob.id,
          school,
          breaksOnDamage: true,
        });
      }
    }
  }
}

// Howling Gale: the anti-kite snare pulse. A boss whose template declares `aoeSlow`
// slams every player within `radius` with a movement slow on a fixed cadence. This is
// the ONE boss pulse that also fires mid-chase (the callers below invoke it from both
// the chase and attack states): the aoePulse/stomp/bigCast mechanics all gate on the
// boss being in melee range, which is exactly what lets a ranged kiter hold a
// sub-run-speed boss out of melee forever so none of them ever land. The snare closes
// that gap (moveSpeedMult already honors the `slow` aura), then the melee-gated pulses
// come online once the boss reaches the now-slowed target. Deals no damage and draws
// no rng, so it is inert for every template without the field and cannot perturb the
// parity gate. Called once per tick from whichever engaged state the mob is in, so the
// cadence timer advances exactly once per tick.
function pulseAntiKiteSnare(ctx: SimContext, mob: Entity): void {
  const aoeSlow = MOBS[mob.templateId]?.aoeSlow;
  if (!aoeSlow) return;
  mob.aoeSlowTimer -= DT;
  if (mob.aoeSlowTimer > 0) return;
  mob.aoeSlowTimer = aoeSlow.every;
  const school = (aoeSlow.school ?? 'nature') as Aura['school'];
  ctx.emit({ type: 'spellfx', sourceId: mob.id, targetId: mob.id, school, fx: 'nova' });
  for (const meta of ctx.players.values()) {
    const pe = ctx.entities.get(meta.entityId);
    if (!pe || pe.dead || dist2d(pe.pos, mob.pos) > aoeSlow.radius) continue;
    ctx.applyAura(pe, {
      id: 'aoe_slow',
      name: aoeSlow.name,
      kind: 'slow',
      remaining: aoeSlow.duration,
      duration: aoeSlow.duration,
      value: aoeSlow.mult,
      sourceId: mob.id,
      school,
    });
  }
}

// Loud boss battle cry: a mob with `battleYells` bellows the next line in its list
// every `every`s while engaged (from the chase and attack states, like the snare),
// broadcast at the wide battleYells.range so a "loud" boss is heard across the zone.
// Cycles the lines in order (loudYellIndex), so it draws no rng and stays parity-inert
// for every template without the field.
function pulseLoudYell(ctx: SimContext, mob: Entity): void {
  const loud = MOBS[mob.templateId]?.battleYells;
  if (!loud || loud.lines.length === 0) return;
  mob.loudYellTimer -= DT;
  if (mob.loudYellTimer > 0) return;
  mob.loudYellTimer = loud.every;
  const line = loud.lines[mob.loudYellIndex % loud.lines.length];
  mob.loudYellIndex = (mob.loudYellIndex + 1) % loud.lines.length;
  emitMobYell(ctx, mob, line, loud.range);
}

// An evading mob has reached its spawn (walking or phasing): drop the pull
// entirely and return to idle at full health, ready to be pulled again.
export function resetEvadingMob(ctx: SimContext, mob: Entity): void {
  mob.aiState = 'idle';
  mob.hp = mob.maxHp;
  mob.auras = [];
  mob.inCombat = false;
  mob.tappedById = null;
  mob.leashAnchor = null;
  mob.evadeStall = 0;
  mob.fleeTimer = 0;
  mob.fleeReturnTimer = 0;
  mob.hasFled = false;
  clearThreat(mob);
  ctx.despawnSummonedAdds(mob);
  mob.firedSummons = 0;
  mob.enraged = false;
  mob.healedThisPull = false;
  mob.stompTimer = MOBS[mob.templateId]?.stomp?.every ?? 0;
  mob.terrifyTimer = MOBS[mob.templateId]?.terrify?.every ?? 0;
  mob.aoeSlowTimer = MOBS[mob.templateId]?.aoeSlow?.every ?? 0;
  mob.loudYellTimer = MOBS[mob.templateId]?.battleYells?.every ?? 0;
  mob.loudYellIndex = 0;
  mob.mendTimer = MOBS[mob.templateId]?.mendAlly?.every ?? 0;
  mob.wardTimer = MOBS[mob.templateId]?.wardAllies?.every ?? 0;
  mob.stoneskinTimer = MOBS[mob.templateId]?.stoneskin?.every ?? 0;
  mob.rallyTimer = MOBS[mob.templateId]?.rally?.every ?? 0;
  mob.warcryTimer = MOBS[mob.templateId]?.warcry?.every ?? 0;
  // A mid-flight bigCast dies with the pull: clear the bar, reseed the cadence,
  // and let the next pull bark its engage line again.
  const bigCastDef = MOBS[mob.templateId]?.bigCast;
  mob.bigCastTimer = bigCastDef?.every ?? 0;
  if (bigCastDef && mob.castingAbility === bigCastDef.castId) {
    mob.castingAbility = null;
    mob.castTotal = 0;
    mob.castRemaining = 0;
    mob.castTargetId = null;
  }
  mob.yelledEngage = false;
  mob.wanderTimer = ctx.rng.range(2, 8);
  if (mob.templateId === NYTHRAXIS_BOSS_ID) ctx.resetNythraxisEncounter(mob);
  if (mob.templateId === SISTER_NHALIA_BOSS_ID) resetDrownedLitanyBossEncounter(ctx, mob);
}

// Cowardly mobs panic once per pull at low HP, then recover their nerve and turn to
// fight again. This is the flee->chase/attack recovery the flee arm calls when the
// fleeing mob reaches the leash edge or its flee timer expires.
export function recoverFromFlee(
  mob: Entity,
  target: Entity,
  leash: number,
  leashAnchor: Vec3,
): void {
  mob.aiState = dist2d(mob.pos, target.pos) > MELEE_RANGE ? 'chase' : 'attack';
  mob.fleeTimer = 0;
  if (dist2d(mob.pos, leashAnchor) >= leash - 1) mob.fleeReturnTimer = FLEE_RETURN_GRACE;
}

// Would a normal (collision- and water-aware) step toward `dest` be blocked —
// i.e. is a prop or deep water right in front of this mob? Used to decide when
// a phasing evader has cleared the obstacle and can walk normally again.
export function blockedTowardSpawn(ctx: SimContext, e: Entity, dest: Vec3): boolean {
  const d = dist2d(e.pos, dest);
  if (d < 0.3) return false;
  const facing = angleTo(e.pos, dest);
  const step = Math.min(e.moveSpeed * EVADE_SPEED_MULT * DT, d);
  const nx = e.pos.x + Math.sin(facing) * step;
  const nz = e.pos.z + Math.cos(facing) * step;
  if (
    !ctx.mobCanSwim(MOBS[e.templateId]) &&
    groundHeight(nx, nz, ctx.cfg.seed) < waterLevelAt(nx, nz) - SWIM_DEPTH
  )
    return true;
  const resolved = ctx.resolveMovePoint(nx, nz, BODY_RADIUS, e);
  // a collider ate most of the intended movement -> still blocked
  return Math.hypot(nx - resolved.x, nz - resolved.z) > step * 0.5;
}
