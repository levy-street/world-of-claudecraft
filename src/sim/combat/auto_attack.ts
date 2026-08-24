// Player auto-attack + the melee/ranged white-hit table, extracted from the Sim
// monolith (C5). This module owns:
//   - startAutoAttack / stopAutoAttack: the public auto-attack toggle (validate
//     target, aggro an idle mob, enter combat).
//   - updatePlayerAutoAttack: the per-tick driver (swing-timer decay, facing/range
//     gates, the ranged-vs-melee branch, and queuedOnSwing consumption that feeds
//     on-next-swing abilities like Heroic Strike / Raptor Strike into the swing).
//   - rangedSwing: Auto Shot (hunters, 8yd dead zone) and Wand (casters, no dead
//     zone); miss roll, crit, and armor mitigation for physical shots only.
//   - meleeSwing: the white-hit table (single rng.next() miss -> dodge -> hit, crit,
//     weapon imbue bonus, armor mitigation, and the thorns / spiked-hide reflect
//     tail). Returns whether the swing connected so the effect_dispatch weaponStrike
//     handler can gate its combo award.
//
// The swing sites resolve crit/dodge/miss/armor UPSTREAM and hand dealDamage an
// already-mitigated amount; dealDamage (C1, combat/damage.ts) applies the
// post-mitigation amp/absorb/death routing on top.
//
// PRIME DIRECTIVE: this is a MOVE, not a rewrite. Each function below is the former
// `Sim` method verbatim, with `this.X` rewritten to `ctx.X` (the SimContext seam),
// `this.{isStunned,isDisarmed,blindMissBonus}` to sibling imports from ./cc, and
// `this.spendResource` to the sibling export from ./casting_lifecycle. Statement
// order, branch order, the single shared rng draw order, and the in-place Entity
// mutation (the refactor's immutability waiver) are preserved exactly so the parity
// gate's full-state trace and rng draw-order log stay byte-identical.
//
// `src/sim`-pure: no DOM/Three, no Math.random/Date.now; all randomness is the shared
// `ctx.rng` stream, drawn in the exact pre-move positions.

import { isArenaPos, MOBS } from '../data';
import { questGateBlocksAggro } from '../mob/quest_gated_aggro';
import { forceDismount } from '../mounts';
import { grantDevotionFromBlock } from '../paladin_devotion';
import { scheduleBallisticProjectile, scheduleProjectile } from '../projectile_travel';
import type { PlayerMeta } from '../sim';
import type { SimContext } from '../sim_context';
import { resolveTalentHitMult } from '../talent_hit_mult';
import { addThreat, hasEscapeStealth } from '../threat';
import {
  angleTo,
  armorReduction,
  BATTLE_TRANCE_CHANCE,
  BATTLE_TRANCE_DURATION,
  DT,
  dist2d,
  type Entity,
  MELEE_ARC,
  MELEE_RANGE,
  normAngle,
  STANCE_MASTERY_BERSERKER_HASTE,
  swingMissChance,
  type WeaponInfo,
} from '../types';
import { drawWeapon } from '../weapon_stow';
import { applyRageSpendCooldownRefund, spendResource } from './casting_lifecycle';
import { blindMissBonus, isDisarmed, isInStasis, isStunned } from './cc';
import {
  combatAimAngle,
  selectFirstTargetOnSegment,
  selectMeleeConeTargets,
} from './directional_attack';
import { druidEngineOnLandedStrike } from './druid_engines';
import { consumeNextAttackCrit } from './empower_next';
import { runWeaponProcs } from './equip_procs';
import {
  baseSwingSpeed,
  catAutoWeaponRollMult,
  catFormDamageMult,
  normalizedInstantSpeed,
  rangedAutoProfile,
} from './form_swing';
import { isTravelFormAuraKind } from './forms';
import { tryGrantDawnsWrath } from './paladin_dawns_wrath';
import { tryGrantSolarReprisal } from './paladin_solar_reprisal';
import { applyRequitalAutoAttack } from './paladin_talents';
import { isValkyrsCallingAirborne } from './paladin_valkyrs_calling_state';
import { rangedShotProfile } from './ranged_shot';
import { triggerWardCycle } from './shaman_talents';
import { advanceWarspiritCadence, stoneboundThreatMultiplier } from './shaman_warspirit';
import { blockedMeleeDamage } from './shield_block';
import { onCastCompleted, onMeleeSwing } from './talent_procs';
import { applyThornsReaction } from './thorns_charge';
import { warriorMeleeDefense } from './warrior_hit_table';

// Fraction of the mainhand weapon's damage a hunter's Auto Shot deals. There is no
// dedicated ranged-weapon slot, so the mainhand doubles as the "bow"; a full melee
// weapon's damage on ranged would push a fully geared hunter's white DPS well past
// the melee classes (measured ~+30%), so only part of it carries to the shot. The
// agility-driven ranged attack-power term is unaffected, and wands (the caster
// sidearm, fixed class damage) are exempt.
const RANGED_WEAPON_COEFF = 0.6;
const DUAL_WIELD_WHITE_MISS_PENALTY = 0.1;
const SUDDEN_DEATH_CHANCE = 0.1;
const SUDDEN_DEATH_DURATION = 10;
const OFFHAND_AUTO_ATTACK_DMG_MULT = 0.5;

// WEAPON DAMAGE CONTRACT: `weapon.min/max` is RAW per-swing damage at the weapon's
// real speed, with the two-hand premium already folded in by itemization. A weapon's
// power level is `avg / speed`, which is exactly how `item_budget.ts`
// (`weaponDpsBudget`, `scaleWeaponDamage`) authors it and how
// `tests/twohand_rebudget.test.ts` pins every two-hander to the curve. A slow weapon
// therefore ALREADY hits harder per swing, because the author wrote a bigger number.
//
// So the swing path must NOT re-derive that. v0.30.0 briefly multiplied the roll by
// `speed / 2 * TWOHAND_DPS_MULT`, treating min/max as a speed-normalized figure. That
// double-counted both terms: four weapons authored at an identical 15.0 dps delivered
// 12.9 / 15.0 / 22.7 / 25.6 dps at speeds 1.7 / 2.0 / 3.0 / 3.4 (only the 2.0 baseline
// came out right, the signature of a conversion applied to already-converted data), and
// it silently moved sustained Fury from 147.2 to 186.3 on `scripts/fury_dps_probe.ts`
// with no warrior change in between. The offhand's classic 50% penalty is the one
// genuine swing-time adjustment and stays here.
type AutoAttackHand = 'mainhand' | 'offhand';

function hasDualWieldWhiteMissPenalty(ctx: SimContext, player: Entity, meta: PlayerMeta): boolean {
  if (!player.dualWielding) return false;
  // Both Warspirit weapons feed one shared three-hit cadence. Applying the generic
  // dual-wield penalty here suppresses the specialization's damage and signature
  // procs twice, especially against higher-level bosses.
  return meta.cls !== 'shaman' || ctx.playerMods(meta).spec !== 'enhancement';
}

function autoAttackWeaponDamageMult(hand: AutoAttackHand): number {
  return hand === 'offhand' ? OFFHAND_AUTO_ATTACK_DMG_MULT : 1;
}

export function startAutoAttack(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (!r) return;
  const p = r.e;
  if (p.dead) return;
  if (isInStasis(p)) return;
  if (isValkyrsCallingAirborne(p)) return;
  if (p.auras.some((a) => isTravelFormAuraKind(a.kind))) return;
  if (ctx.playerDirectionalCombat === undefined) {
    const target = p.targetId !== null ? ctx.entities.get(p.targetId) : null;
    if (target?.dead) return;
    if (!target || !ctx.isHostileTo(p, target) || hasEscapeStealth(target)) {
      ctx.error(p.id, 'Invalid attack target.');
      return;
    }
    if (p.mountKey !== '') forceDismount(ctx, p);
    if (p.sitting) ctx.standUp(p);
    if (p.weaponStowed) drawWeapon(p);
    p.autoAttack = true;
    r.meta.lastActiveTick = ctx.tickCount;
    const distance = dist2d(p.pos, target.pos);
    if (
      distance <= MELEE_RANGE &&
      !p.castingAbility &&
      target.kind === 'mob' &&
      target.hostile &&
      target.ownerId === null &&
      target.aiState !== 'evade'
    ) {
      if (questGateBlocksAggro(ctx.players, target, p)) {
        p.autoAttack = false;
        return;
      }
      if (target.aiState === 'idle' && !ctx.aggroMob(target, p, true)) {
        p.autoAttack = false;
        return;
      }
      if (target.aggroTargetId === null) target.aggroTargetId = p.id;
      addThreat(target, p.id, 1);
      p.combatTimer = 0;
      p.inCombat = true;
    }
    return;
  }
  // Auto-dismount when the player is mounted and starts auto-attack.
  if (p.mountKey !== '') forceDismount(ctx, p);
  if (p.sitting) ctx.standUp(p);
  if (p.weaponStowed) drawWeapon(p);
  p.autoAttack = true;
  r.meta.basicAttackHeld = true;
  r.meta.lastActiveTick = ctx.tickCount; // starting auto-attack is a deliberate action
}

export function stopAutoAttack(ctx: SimContext, pid?: number): void {
  const r = ctx.resolve(pid);
  if (r) {
    r.e.autoAttack = false;
    r.meta.basicAttackHeld = false;
  }
}

function autoAttackCandidates(ctx: SimContext, player: Entity, maxRange: number): Entity[] {
  const candidates: Entity[] = [];
  const paddedRange = Math.max(0, maxRange) + 2;
  const paddedRangeSq = paddedRange * paddedRange;
  for (const entity of ctx.entities.values()) {
    if (
      entity.id === player.id ||
      entity.dead ||
      !ctx.isHostileTo(player, entity) ||
      hasEscapeStealth(entity)
    )
      continue;
    const dx = entity.pos.x - player.pos.x;
    const dz = entity.pos.z - player.pos.z;
    if (dx * dx + dz * dz <= paddedRangeSq) candidates.push(entity);
  }
  return candidates;
}

function updateLegacyPlayerAutoAttack(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  p.swingTimer = Math.max(0, p.swingTimer - DT);
  p.offhandSwingTimer = Math.max(0, p.offhandSwingTimer - DT);
  if (isValkyrsCallingAirborne(p)) return;
  if (p.auras.some((a) => isTravelFormAuraKind(a.kind))) {
    p.autoAttack = false;
    return;
  }
  if (!p.autoAttack || p.castingAbility) return;
  const target = p.targetId !== null ? ctx.entities.get(p.targetId) : null;
  if (!target || target.dead || !ctx.isHostileTo(p, target) || hasEscapeStealth(target)) {
    p.autoAttack = false;
    return;
  }
  if (p.swingTimer > 0 && (!p.dualWielding || !p.offhandWeapon || p.offhandSwingTimer > 0)) return;
  if (isStunned(p) || isDisarmed(p)) return;
  const distance = dist2d(p.pos, target.pos);
  const facingDiff = Math.abs(normAngle(angleTo(p.pos, target.pos) - p.facing));
  if (facingDiff > MELEE_ARC) return;

  if (p.mountKey !== '') forceDismount(ctx, p);
  const ranged = rangedAutoProfile(p, meta.cls);
  if (ranged && distance <= ranged.maxRange && distance >= (ranged.wand ? 0 : ranged.minRange)) {
    if (!ctx.hasLineOfSight(p, target)) return;
    ctx.breakGhostWolf(p);
    const shot = rangedShotProfile(ranged, p.weapon);
    rangedSwing(ctx, p, target, { ...ranged, min: shot.min, max: shot.max, speed: shot.speed });
    p.swingTimer = (shot.speed * ctx.swingIntervalMult(p)) / (1 + p.rangedHaste);
    return;
  }
  if (distance > MELEE_RANGE) return;
  if (isArenaPos(p.pos.x) && !ctx.hasLineOfSight(p, target)) return;
  ctx.breakGhostWolf(p);
  const dualWieldWhiteMissPenalty = hasDualWieldWhiteMissPenalty(ctx, p, meta);

  if (p.swingTimer <= 0) {
    let bonus = 0;
    let abilityName: string | null = null;
    let abilityId: string | undefined;
    let threatFlat = 0;
    let threatMult = 1;
    let weaponMult = 1;
    if (p.queuedOnSwing) {
      const queued = ctx.resolvedAbility(p.queuedOnSwing, p.id);
      if (queued) {
        const effect = queued.effects.find((entry) => entry.type === 'weaponDamage');
        const queuedCost =
          p.queuedOnSwingFree === true
            ? 0
            : Math.ceil(queued.cost * (p.queuedOnSwingCostMultiplier ?? 1));
        if (p.resource >= queuedCost && effect && effect.type === 'weaponDamage') {
          spendResource(p, queuedCost);
          applyRageSpendCooldownRefund(ctx, p, meta, p.resourceType === 'rage' ? queuedCost : 0);
          if (queued.def.cooldown > 0) p.cooldowns.set(queued.def.id, queued.def.cooldown);
          bonus = effect.bonus;
          abilityName = queued.def.name;
          abilityId = queued.def.id;
          threatFlat = queued.threatFlat;
          threatMult = queued.threatMult;
          weaponMult = resolveTalentHitMult(queued.def, ctx.playerMods(meta)).dmgMult;
        }
      }
      p.queuedOnSwing = null;
      delete p.queuedOnSwingFree;
      delete p.queuedOnSwingCostMultiplier;
    }
    const connected = meleeSwing(ctx, p, target, bonus, abilityName, {
      autoAttackHand: 'mainhand',
      abilityId,
      threatFlat,
      threatMult,
      weaponMult,
      whiteDualWieldPenalty: dualWieldWhiteMissPenalty && abilityName === null,
      autoAttack: true,
    });
    const extraAttackPct = ctx.playerMods(meta).global.extraAttackPct;
    if (connected && abilityName === null && extraAttackPct > 0 && ctx.rng.chance(extraAttackPct)) {
      meleeSwing(ctx, p, target, 0, null, {
        autoAttackHand: 'mainhand',
        whiteDualWieldPenalty: dualWieldWhiteMissPenalty,
        autoAttack: true,
      });
    }
    maybeProcBattleTrance(ctx, p, meta, connected);
    maybeProcSuddenDeath(ctx, p, meta, connected);
    p.swingTimer =
      (baseSwingSpeed(p) * ctx.swingIntervalMult(p)) / (1 + stanceMasteryAutoHaste(ctx, p, meta));
  }
  if (p.dualWielding && p.offhandWeapon && p.offhandSwingTimer <= 0) {
    const offhand = p.offhandWeapon;
    const connected = meleeSwing(ctx, p, target, 0, null, {
      weapon: offhand,
      autoAttackHand: 'offhand',
      apSwingSpeed: offhand.speed,
      whiteDualWieldPenalty: dualWieldWhiteMissPenalty,
      autoAttack: true,
    });
    maybeProcBattleTrance(ctx, p, meta, connected);
    maybeProcSuddenDeath(ctx, p, meta, connected);
    p.offhandSwingTimer =
      (offhand.speed * ctx.swingIntervalMult(p)) / (1 + stanceMasteryAutoHaste(ctx, p, meta));
  }
}

export function updatePlayerAutoAttack(ctx: SimContext, p: Entity, meta: PlayerMeta): void {
  if (ctx.playerDirectionalCombat === undefined) {
    updateLegacyPlayerAutoAttack(ctx, p, meta);
    return;
  }
  p.swingTimer = Math.max(0, p.swingTimer - DT);
  p.offhandSwingTimer = Math.max(0, p.offhandSwingTimer - DT);
  if (isValkyrsCallingAirborne(p)) return;
  if (p.auras.some((a) => isTravelFormAuraKind(a.kind))) {
    p.autoAttack = false;
    return;
  }
  if (!p.autoAttack || p.castingAbility) return;
  if (p.swingTimer > 0 && (!p.dualWielding || !p.offhandWeapon || p.offhandSwingTimer > 0)) return;
  if (isStunned(p)) return;
  if (isDisarmed(p)) return; // weapon knocked away: no auto-attack swings

  // ranged auto-attack: hunters (auto shot, dead zone inside minRange) and
  // casters (wand-style, no dead zone so they don't run into melee, #94).
  // Form-aware: a druid keeps the class wand only in caster or Moonwing Form;
  // bear/cat/travel resolve to undefined here and fall through to melee.
  // A pre-armed auto-attack that fires while mounted (e.g. mounted player who
  // somehow retained autoAttack=true) force-dismounts before the swing lands,
  // mirroring the ghost_wolf break pattern below and the startAutoAttack guard.
  if (p.mountKey !== '') forceDismount(ctx, p);
  const ranged = rangedAutoProfile(p, meta.cls);
  if (ranged) {
    ctx.breakGhostWolf(p);
    // Hunters shoot with their equipped weapon (damage range + speed), casters
    // with their fixed class wand; the shot then fires at that resolved profile.
    const shot = rangedShotProfile(ranged, p.weapon);
    const angle = combatAimAngle(p, meta);
    p.facing = angle;
    const rangedProfile = { ...ranged, min: shot.min, max: shot.max, speed: shot.speed };
    if (ctx.playerDirectionalCombat === false) {
      const target = selectFirstTargetOnSegment({
        origin: p.pos,
        angle,
        maxDistance: ranged.maxRange,
        minDistance: ranged.wand ? 0 : ranged.minRange,
        candidates: autoAttackCandidates(ctx, p, ranged.maxRange),
      });
      if (target) rangedSwing(ctx, p, target, rangedProfile);
      else {
        ctx.emit({
          type: 'spellfx',
          sourceId: p.id,
          targetId: p.id,
          school: ranged.wand ? (ranged.school ?? 'arcane') : 'physical',
          fx: 'selfCast',
          ability: ranged.wand ? 'wand' : 'auto_shot',
        });
      }
    } else {
      rangedSwing(ctx, p, null, rangedProfile, {
        angle,
        maxDistance: ranged.maxRange,
        minDistance: ranged.wand ? 0 : ranged.minRange,
      });
    }
    // The weapon's speed sets the cadence; ranged haste (item-set bonus) then
    // shortens the auto-shot interval.
    p.swingTimer = (shot.speed * ctx.swingIntervalMult(p)) / (1 + p.rangedHaste);
    return;
  }
  const targets = selectMeleeConeTargets({
    origin: p.pos,
    facing: p.facing,
    range: MELEE_RANGE,
    candidates: autoAttackCandidates(ctx, p, MELEE_RANGE).filter(
      (candidate) => !isArenaPos(p.pos.x) || ctx.hasLineOfSight(p, candidate),
    ),
    cap: ctx.playerDirectionalCombat === false ? 1 : undefined,
  });
  if (targets.length === 0) {
    if (p.swingTimer <= 0) {
      ctx.emit({
        type: 'spellfx',
        sourceId: p.id,
        targetId: p.id,
        school: 'physical',
        fx: 'selfCast',
        ability: 'attack',
      });
      p.swingTimer =
        (baseSwingSpeed(p) * ctx.swingIntervalMult(p)) / (1 + stanceMasteryAutoHaste(ctx, p, meta));
    }
    if (p.dualWielding && p.offhandWeapon && p.offhandSwingTimer <= 0) {
      p.offhandSwingTimer =
        (p.offhandWeapon.speed * ctx.swingIntervalMult(p)) /
        (1 + stanceMasteryAutoHaste(ctx, p, meta));
    }
    return;
  }
  p.targetId = targets[0].id;
  ctx.breakGhostWolf(p);
  const dualWieldWhiteMissPenalty = hasDualWieldWhiteMissPenalty(ctx, p, meta);

  if (p.swingTimer <= 0) {
    let bonus = 0;
    let abilityName: string | null = null;
    let abilityId: string | undefined;
    let threatFlat = 0;
    let threatMult = 1;
    // The resolved talent/mastery damage multiplier for the queued on-swing
    // ability (weaponMult, mirroring weaponStrike's own field): meleeSwing
    // applies it to the WHOLE swing (weapon roll + AP), not just `bonus`, so a
    // "+X%" mastery/talent reaches the weapon+AP portion of a Heroic Strike /
    // Raptor Strike style on-next-swing hit too (issue #1803).
    let weaponMult = 1;
    if (p.queuedOnSwing) {
      const queued = ctx.resolvedAbility(p.queuedOnSwing, p.id);
      if (queued) {
        const eff = queued.effects.find((e) => e.type === 'weaponDamage');
        const queuedCost =
          p.queuedOnSwingFree === true
            ? 0
            : Math.ceil(queued.cost * (p.queuedOnSwingCostMultiplier ?? 1));
        if (p.resource >= queuedCost && eff && eff.type === 'weaponDamage') {
          spendResource(p, queuedCost);
          applyRageSpendCooldownRefund(ctx, p, meta, p.resourceType === 'rage' ? queuedCost : 0);
          // on-next-swing abilities (e.g. Raptor Strike) resolve here rather than
          // in castAbility, so their cooldown must be applied on the swing too (#56)
          if (queued.def.cooldown > 0) p.cooldowns.set(queued.def.id, queued.def.cooldown);
          bonus = eff.bonus;
          abilityName = queued.def.name;
          abilityId = queued.def.id;
          threatFlat = queued.threatFlat;
          threatMult = queued.threatMult;
          weaponMult = resolveTalentHitMult(queued.def, ctx.playerMods(meta)).dmgMult;
        }
      }
      p.queuedOnSwing = null;
      delete p.queuedOnSwingFree;
      delete p.queuedOnSwingCostMultiplier;
    }
    let primaryConnected = false;
    for (let index = 0; index < targets.length; index++) {
      const connected = meleeSwing(ctx, p, targets[index], bonus, abilityName, {
        autoAttackHand: 'mainhand',
        abilityId,
        threatFlat,
        threatMult,
        weaponMult,
        whiteDualWieldPenalty: dualWieldWhiteMissPenalty && abilityName === null,
        autoAttack: true,
      });
      if (index === 0) primaryConnected = connected;
      maybeProcBattleTrance(ctx, p, meta, connected);
      maybeProcSuddenDeath(ctx, p, meta, connected);
    }
    // Thuggery mastery (Sword Specialization shape): a landed mainhand auto has
    // a chance to swing once more. The pct gate keeps the rng stream untouched
    // for everyone without the mastery, and the extra swing cannot chain.
    const extraAttackPct = ctx.playerMods(meta).global.extraAttackPct;
    if (
      primaryConnected &&
      abilityName === null &&
      extraAttackPct > 0 &&
      ctx.rng.chance(extraAttackPct)
    ) {
      for (const target of targets) {
        meleeSwing(ctx, p, target, 0, null, {
          autoAttackHand: 'mainhand',
          whiteDualWieldPenalty: dualWieldWhiteMissPenalty,
          autoAttack: true,
        });
      }
    }
    // Wolf Form swings at the fixed fast cat cadence, not the carried weapon's
    // speed (see combat/form_swing.ts); everyone else uses their weapon speed.
    // Melee haste (item sets + Enrage + haste buffs) lives in the ONE additive
    // bucket inside swingIntervalMult (v0.27.1); only the stance-mastery auto
    // haste stays a separate factor (it needs the meta the seam call lacks).
    p.swingTimer =
      (baseSwingSpeed(p) * ctx.swingIntervalMult(p)) / (1 + stanceMasteryAutoHaste(ctx, p, meta));
  }
  if (p.dualWielding && p.offhandWeapon && p.offhandSwingTimer <= 0) {
    const offhand = p.offhandWeapon;
    for (const target of targets) {
      const connected = meleeSwing(ctx, p, target, 0, null, {
        weapon: offhand,
        autoAttackHand: 'offhand',
        apSwingSpeed: offhand.speed,
        whiteDualWieldPenalty: dualWieldWhiteMissPenalty,
        autoAttack: true,
      });
      maybeProcBattleTrance(ctx, p, meta, connected);
      maybeProcSuddenDeath(ctx, p, meta, connected);
    }
    p.offhandSwingTimer =
      (offhand.speed * ctx.swingIntervalMult(p)) / (1 + stanceMasteryAutoHaste(ctx, p, meta));
  }
}

function stanceMasteryAutoHaste(ctx: SimContext, player: Entity, meta: PlayerMeta): number {
  if (meta.cls !== 'warrior') return 0;
  if (!player.auras.some((aura) => aura.kind === 'berserker_stance')) return 0;
  return ctx.playerMods(meta).global.stanceMastery > 0 ? STANCE_MASTERY_BERSERKER_HASTE : 0;
}

function maybeProcBattleTrance(
  ctx: SimContext,
  player: Entity,
  meta: PlayerMeta,
  connected: boolean,
): void {
  if (!connected || meta.cls !== 'warrior') return;
  const proc = ctx.rng.chance(BATTLE_TRANCE_CHANCE);
  if (!proc || ctx.playerMods(meta).spec === 'fury') return;
  ctx.applyAura(player, {
    id: 'battle_trance',
    name: 'Battle Trance',
    kind: 'battle_trance',
    remaining: BATTLE_TRANCE_DURATION,
    duration: BATTLE_TRANCE_DURATION,
    value: 0,
    sourceId: player.id,
    school: 'physical',
  });
}

function maybeProcSuddenDeath(
  ctx: SimContext,
  p: Entity,
  meta: PlayerMeta,
  connected: boolean,
): void {
  if (!connected || meta.cls !== 'warrior') return;
  if (ctx.playerMods(meta).spec !== 'arms') return;
  if (!meta.known.some((known) => known.def.id === 'sudden_death' && known.def.passive)) return;
  if (!ctx.rng.chance(SUDDEN_DEATH_CHANCE)) return;
  ctx.applyAura(p, {
    id: 'sudden_death',
    name: 'Sudden Death',
    kind: 'sudden_death',
    remaining: SUDDEN_DEATH_DURATION,
    duration: SUDDEN_DEATH_DURATION,
    value: 0,
    sourceId: p.id,
    school: 'physical',
  });
}

export const AUTO_SHOT_LABEL = 'Auto Shot';

export function rangedSwing(
  ctx: SimContext,
  attacker: Entity,
  target: Entity | null,
  ranged: { min: number; max: number; speed: number; wand?: boolean; school?: string },
  directional?: { angle: number; maxDistance: number; minDistance?: number },
): void {
  const school = ranged.wand ? (ranged.school ?? 'arcane') : 'physical';
  const label = ranged.wand ? 'Wand' : AUTO_SHOT_LABEL;
  if (target && !directional) {
    ctx.emit({
      type: 'spellfx',
      sourceId: attacker.id,
      targetId: target.id,
      school,
      fx: 'projectile',
      ...(ranged.wand ? { wand: true as const } : { attackAnimation: 'ranged-shot' as const }),
    });
  }
  if (!ranged.wand && attacker.kind === 'player') {
    onCastCompleted(ctx, attacker, 'auto_shot', target);
  }
  // The shot/bolt is in flight: its miss roll and damage land when it reaches the
  // target (projectile_travel), and fizzle if the target dies before impact.
  const resolve = (atk: Entity, tgt: Entity) => {
    // Physical contact, even one whose hit table becomes miss/dodge/parry,
    // owns the hard target. Empty travel leaves manual click/Tab selection alone.
    atk.targetId = tgt.id;
    const missChance = swingMissChance(atk, tgt) + blindMissBonus(atk);
    if (ctx.rng.chance(missChance)) {
      ctx.emit({
        type: 'damage',
        sourceId: atk.id,
        targetId: tgt.id,
        amount: 0,
        crit: false,
        school,
        ability: label,
        kind: 'miss',
        ...(ranged.wand ? {} : { attackAnimationStarted: true as const }),
      });
      ctx.enterCombat(atk, tgt);
      return;
    }
    // Only part of a melee weapon's roll carries to a hunter's Auto Shot (see
    // RANGED_WEAPON_COEFF); a wand deals its full fixed damage. The ranged AP term
    // (agility) is unaffected either way.
    const weaponRoll = ctx.rng.range(ranged.min, ranged.max);
    let dmg =
      (ranged.wand ? weaponRoll : weaponRoll * RANGED_WEAPON_COEFF) +
      (atk.rangedPower / 14) * ranged.speed;
    // ranged white hits suffer the same higher-level crit suppression as melee
    const critChance = Math.max(0.005, atk.critChance - Math.max(0, tgt.level - atk.level) * 0.002);
    const crit = ctx.rng.chance(consumeNextAttackCrit(ctx, atk) ? 1 : critChance);
    if (crit) dmg *= 2 + atk.critDmgPhysBonus;
    // wand bolts are magic — armor doesn't apply; physical auto shot is mitigated
    if (!ranged.wand) dmg *= 1 - armorReduction(ctx.effectiveArmor(tgt), atk.level);
    ctx.dealDamage(
      atk,
      tgt,
      Math.max(1, Math.round(dmg)),
      crit,
      school,
      label,
      'hit',
      false,
      undefined,
      true,
      !ranged.wand,
    );
    applyRequitalAutoAttack(ctx, atk, tgt);
    // 4-piece set procs keyed to weapon crits (ranged arm). Gated on setProcs
    // inside applySetProcs, so proc-less players draw no rng.
    if (crit && atk.kind === 'player') ctx.applySetProcs(atk, tgt, 'weaponCrit');
    // Legendary on-hit weapon procs (e.g. Thronebane's Chain Arc) fire on a hunter's
    // Auto Shot too, since it strikes with the equipped mainhand. Wand bolts do not
    // swing the mainhand, so casters never roll it. No-op (no rng draw) unless the
    // shooter wields a proc weapon with a weaponHit proc.
    if (!ranged.wand) runWeaponProcs(ctx, atk, tgt, 'weaponHit');
  };
  if (directional) {
    scheduleBallisticProjectile(
      ctx,
      attacker,
      {
        angle: directional.angle,
        minDistance: directional.minDistance,
        maxDistance: directional.maxDistance,
        school,
        ability: ranged.wand ? 'wand' : 'auto_shot',
        ...(ranged.wand ? { wand: true as const } : { attackAnimation: 'ranged-shot' as const }),
      },
      resolve,
    );
  } else if (target) {
    scheduleProjectile(ctx, attacker, target, resolve);
  }
}

// Returns true if the swing connected.
export function meleeSwing(
  ctx: SimContext,
  attacker: Entity,
  target: Entity,
  bonus: number,
  abilityName: string | null,
  opts: {
    cannotBeDodged?: boolean;
    weapon?: WeaponInfo;
    weaponMult?: number;
    autoAttackHand?: AutoAttackHand;
    apSwingSpeed?: number;
    threatFlat?: number;
    threatMult?: number;
    forceCrit?: boolean;
    // Ability-scoped crit chance ADD (talent ResolvedAbilityMod.critPct); the
    // weaponStrike path threads it here so per-ability crit talents reach the
    // shared hit table.
    critBonus?: number;
    onDealt?: (amount: number) => void;
    onEffectiveDamage?: (amount: number) => void;
    whiteDualWieldPenalty?: boolean;
    autoAttack?: boolean;
    // The casting ability's stable content id, threaded onto the landed-hit
    // damage event's abilityId field (the weaponStrike path only; a plain
    // auto-attack swing has no ability and leaves this unset). abilityName
    // above stays the display label, so a client-side impact-cue lookup
    // keyed off it silently breaks on the next rename (review finding, PR
    // #2861: this is what left Ambush/Backstab/Sinister Strike's dedicated
    // impact cues unreachable).
    abilityId?: string | null;
    // Classic instant-attack normalization (weaponStrike effect `normalized`):
    // scale the weapon-damage portion to a fixed normalized speed by weapon
    // class instead of the weapon's real speed. Only meaningful for an ability
    // swing (autoAttackHand undefined); a real auto attack ignores it.
    normalizedInstant?: boolean;
  },
): boolean {
  const missChance =
    swingMissChance(attacker, target) +
    blindMissBonus(attacker) +
    (opts.whiteDualWieldPenalty ? DUAL_WIELD_WHITE_MISS_PENALTY : 0);
  const dodgeChance = opts.cannotBeDodged
    ? 0
    : target.kind === 'player'
      ? target.dodgeChance
      : 0.05 + Math.max(0, target.level - attacker.level) * 0.005;
  const { parryChance, blockChance } = warriorMeleeDefense(target, attacker);
  const roll = ctx.rng.next();
  if (roll < missChance) {
    ctx.emit({
      type: 'damage',
      sourceId: attacker.id,
      targetId: target.id,
      amount: 0,
      crit: false,
      school: 'physical',
      ability: abilityName,
      kind: 'miss',
    });
    ctx.enterCombat(attacker, target);
    return false;
  }
  if (roll < missChance + dodgeChance) {
    ctx.emit({
      type: 'damage',
      sourceId: attacker.id,
      targetId: target.id,
      amount: 0,
      crit: false,
      school: 'physical',
      ability: abilityName,
      kind: 'dodge',
    });
    ctx.enterCombat(attacker, target);
    if (attacker.kind === 'player') attacker.overpowerUntil = ctx.time + 5;
    return false;
  }
  if (roll < missChance + dodgeChance + parryChance) {
    ctx.emit({
      type: 'damage',
      sourceId: attacker.id,
      targetId: target.id,
      amount: 0,
      crit: false,
      school: 'physical',
      ability: abilityName,
      kind: 'parry',
    });
    ctx.enterCombat(attacker, target);
    return false;
  }
  const mult = opts.weaponMult ?? 1;
  const weapon = opts.weapon ?? attacker.weapon;
  // An instant special attack that opts into normalization is resolved as if
  // the weapon swung at its normalized speed: both the weapon-roll portion and
  // the AP-per-swing contribution use the normalized speed, not the real one.
  // A real auto attack (autoAttackHand set) never normalizes. Under the raw
  // per-swing weapon contract (see the header comment) the roll rescale stays
  // coherent: roll times normSpeed over speed reads as the weapon's authored
  // dps at the normalized speed, so the special is speed-neutral by design.
  const normSpeed =
    opts.normalizedInstant && opts.autoAttackHand === undefined
      ? normalizedInstantSpeed(weapon)
      : undefined;
  // The cat mainhand auto is the one REAL auto attack that normalizes: Wolf
  // Form swings its claws at the fixed cat cadence, so the carried weapon's
  // roll is rescaled to that cadence (catAutoWeaponRollMult, the same shape as
  // the instant rescale above) and white DPS equals the weapon's authored dps
  // whatever its speed. Every other auto keeps the raw per-swing contract.
  const weaponRollMult =
    opts.autoAttackHand === undefined
      ? normSpeed !== undefined
        ? normSpeed / Math.max(0.1, weapon.speed)
        : 1
      : autoAttackWeaponDamageMult(opts.autoAttackHand) *
        (opts.autoAttackHand === 'mainhand' ? catAutoWeaponRollMult(attacker, weapon) : 1);
  const apSwingSpeed = opts.apSwingSpeed ?? normSpeed ?? baseSwingSpeed(attacker);
  // weapon imbues (seals, rockbiter) add flat damage to every swing
  let imbueBonus = 0;
  for (const a of attacker.auras) if (a.kind === 'imbue') imbueBonus += a.value;
  let dmg =
    (ctx.rng.range(weapon.min, weapon.max) * weaponRollMult +
      // Normalize the attack-power contribution to the SAME cadence the swing
      // fires at: Wolf Form swings at the fixed cat speed (baseSwingSpeed), so
      // its AP-per-swing must use that speed too, not the slow staff's, or
      // feral would double-dip (fast swings AND heavy slow-weapon AP weighting).
      (ctx.effectiveAttackPower(attacker) / 14) * apSwingSpeed) *
      mult *
      // The feral form damage knob (form_swing.ts): the one bench-neutrality
      // constant for the cat cadence standardization; 1 for everyone else.
      catFormDamageMult(attacker) +
    bonus +
    imbueBonus;
  const critChance = Math.max(
    0.005,
    attacker.critChance +
      (opts.critBonus ?? 0) -
      Math.max(0, target.level - attacker.level) * 0.002,
  );
  const crit =
    ctx.rng.chance(consumeNextAttackCrit(ctx, attacker) ? 1 : critChance) ||
    opts.forceCrit === true;
  if (crit) dmg *= 2 + attacker.critDmgPhysBonus;
  dmg *= 1 - armorReduction(ctx.effectiveArmor(target), attacker.level);
  const blocked = blockChance > 0 && roll < missChance + dodgeChance + parryChance + blockChance;
  if (blocked) {
    const targetMeta = target.kind === 'player' ? ctx.players.get(target.id) : undefined;
    const targetSpec = targetMeta ? ctx.playerMods(targetMeta).spec : null;
    dmg = blockedMeleeDamage(
      dmg,
      target.blockValue,
      target.templateId === 'paladin' && targetSpec === 'protection',
    );
    if (targetMeta && targetSpec === 'protection') {
      grantDevotionFromBlock(target);
      tryGrantSolarReprisal(ctx, target, 'block');
    }
  }
  const dealtAmount = Math.max(1, Math.round(dmg));
  const hpBefore = target.hp;
  const resolvedAmount = ctx.dealDamage(
    attacker,
    target,
    dealtAmount,
    crit,
    'physical',
    abilityName,
    blocked ? 'block' : 'hit',
    false,
    {
      flat: opts.threatFlat ?? 0,
      mult: (opts.threatMult ?? 1) * stoneboundThreatMultiplier(ctx, attacker),
    },
    true,
    false,
    false,
    // Cue-presentation only on this path: onSpellCrit skips the physical
    // school, so the id can never newly arm an ability-filtered proc here.
    opts.abilityId ?? null,
  );
  opts.onDealt?.(resolvedAmount);
  opts.onEffectiveDamage?.(Math.max(0, hpBefore - target.hp));
  if (opts.autoAttack) {
    applyRequitalAutoAttack(ctx, attacker, target);
    tryGrantDawnsWrath(ctx, attacker);
  }
  druidEngineOnLandedStrike(ctx, attacker, opts.abilityId ?? undefined);
  // 4-piece set procs keyed to weapon crits (melee arm; covers auto-attack AND
  // the weaponStrike ability path, which resolves through this shell). Gated on
  // setProcs inside applySetProcs, so proc-less players draw no rng.
  if (crit && attacker.kind === 'player') ctx.applySetProcs(attacker, target, 'weaponCrit');
  // Landed-swing talent responses resolve before the target retaliates or the
  // weapon's on-hit proc fires. This is observable for defensive healing and
  // preserves the authored Oathwheel, Venom Dividend, and imbue proc cadence.
  if (attacker.kind === 'player') {
    if (abilityName === null) advanceWarspiritCadence(ctx, attacker, target, dealtAmount, 1);
    else if (abilityName === 'Ancestral Strike') {
      advanceWarspiritCadence(ctx, attacker, target, dealtAmount, 2);
      triggerWardCycle(ctx, attacker);
    }
    onMeleeSwing(ctx, attacker);
  }
  // thorns / lightning shield: melee attackers take damage back. Charge-limited
  // thorns (Lightning Shield) consume a charge and gate on an internal cooldown.
  if (!attacker.dead) {
    applyThornsReaction(ctx, target, attacker);
    // innate "spiked hide" mobs (e.g. bristleback boars) reflect on every hit
    const spikes = MOBS[target.templateId]?.thorns;
    if (spikes && !attacker.dead) {
      ctx.dealDamage(
        target,
        attacker,
        spikes.value,
        false,
        spikes.school ?? 'physical',
        spikes.name ?? 'Spiked Hide',
        'hit',
        true,
        undefined,
        false, // reflected damage shield: incidental, never walks the leash anchor
      );
    }
  }
  // Legendary on-hit weapon procs (e.g. Thronebane's Chain Arc). No-op (no rng
  // draw) unless the SWINGING hand's weapon carries a weaponHit proc: an
  // off-hand swing rolls the OFF-HAND weapon's procs, not the mainhand's (the
  // dual-wield bug). Ability strikes (autoAttackHand undefined) use the mainhand.
  const procWeaponId =
    opts.autoAttackHand === 'offhand' ? attacker.offhandItemId : attacker.mainhandItemId;
  runWeaponProcs(ctx, attacker, target, 'weaponHit', procWeaponId);
  return true;
}
