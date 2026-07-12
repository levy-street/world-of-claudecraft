// Effect dispatch (C4b): the per-effect switch that fans a RESOLVED ability's
// `effects[]` into damage, auras, CC, threat, combo, pets, healing, ground-AoE,
// charge, and stat-recalc. Lifted verbatim out of the 17.5k-line `Sim` monolith
// (the old `Sim.runEffects` body) behind `SimContext`, a MOVE not a rewrite: same
// statements, same branch order, same effect-iteration order, same RNG draw order.
//
// runEffects is reached only through `ctx.runEffects` (the casting lifecycle's
// applyAbility / applyChannelTick call it after the cast resolves); it has no other
// caller. The C1/C2 damage/heal primitives, the shared aura/CC helpers, the P1 pet
// hooks, and the shared `pulseGroundAoE`/`applyTaunt`/`meleeSwing` entry points all
// STAY on Sim and are consumed via the seam. The pure module fns/consts the switch
// uses (preservesStealth, armorReduction, recalcPlayerStats, addThreat,
// meleeMissChance, CHARGE_MAX_DURATION) are imported/inlined directly.
//
// `src/sim`-pure: no DOM/Three, no Math.random/Date.now; all randomness is the
// shared `ctx.rng` stream, drawn in the exact pre-move order.

import { isDebuffAura } from '../aura_classify';
import { ABILITIES, isDelvePos } from '../data';
import { recalcPlayerStats } from '../entity';
import type { GroundAoE } from '../entity_roster';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE, PLAYER_SWIM_DEPTH } from '../pathfind';
import { scheduleProjectile } from '../projectile_travel';
import type { PlayerMeta, ResolvedAbility } from '../sim';
import type { SimContext } from '../sim_context';
import {
  abilityScalingPower,
  directHealBonus,
  directHitBonus,
  dotTickBonus,
  hotTickBonus,
} from '../spell_scaling';
import { stunDrCategory } from '../stun_dr';
import { addThreat } from '../threat';
import type { AbilityDef, Entity } from '../types';
import { armorReduction, FISHING_CAST_ID, meleeMissChance } from '../types';
import { groundHeight, WATER_LEVEL } from '../world';
import {
  abilityQualifiesForAreaEcho,
  consumeAreaEchoCharge,
  echoAreaDamage,
  hasAreaEchoAura,
} from './area_echo';
import { isRootedOrChilled } from './cc';
import { consumeNextAttackCrit } from './empower_next';
import { runWeaponProcs } from './equip_procs';
import { exclusiveAuraConflicts } from './exclusive_aura';
import { noteSpellHit, spellDamageMultFromAuras } from './spell_combat';
import { consumeSureCritCharge, hasSureCritAura } from './sure_crit';

const CHARGE_MAX_DURATION = 3; // seconds before a blocked charge gives up

function isStealthToggle(ability: AbilityDef): boolean {
  return ability.effects.some((e) => e.type === 'selfBuff' && e.kind === 'stealth');
}

function preservesStealth(ability: AbilityDef): boolean {
  return isStealthToggle(ability) || ability.id === 'sprint';
}

// Swept-teleport tuning: step the reposition line and stop at walls, fences,
// steep climbs, or deep water so a teleport can never clip through geometry.
const TELEPORT_SWEEP_STEP = 0.5;
const TELEPORT_MAX_CLIMB_SLOPE = PLAYER_MAX_CLIMB_SLOPE;
const TELEPORT_MIN_GROUND = WATER_LEVEL - PLAYER_SWIM_DEPTH;

function removeRootAuras(ctx: SimContext, p: Entity): void {
  for (let i = p.auras.length - 1; i >= 0; i--) {
    const aura = p.auras[i];
    if (aura.kind !== 'root') continue;
    p.auras.splice(i, 1);
    ctx.emit({ type: 'aura', targetId: p.id, name: aura.name, gained: false });
  }
}

function sweptReposition(ctx: SimContext, p: Entity, destX: number, destZ: number): void {
  const fromX = p.pos.x;
  const fromZ = p.pos.z;
  const dx = destX - fromX;
  const dz = destZ - fromZ;
  const distance = Math.hypot(dx, dz);
  let safeX = fromX;
  let safeZ = fromZ;
  let prevGround = groundHeight(fromX, fromZ, ctx.cfg.seed);
  if (distance > 1e-6) {
    const steps = Math.max(1, Math.ceil(distance / TELEPORT_SWEEP_STEP));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const nextX = fromX + dx * t;
      const nextZ = fromZ + dz * t;
      const step = Math.hypot(nextX - safeX, nextZ - safeZ);
      const nextGround = groundHeight(nextX, nextZ, ctx.cfg.seed);
      if (nextGround < TELEPORT_MIN_GROUND) break;
      if (
        nextGround > prevGround &&
        step > 1e-6 &&
        (nextGround - prevGround) / step > TELEPORT_MAX_CLIMB_SLOPE
      ) {
        break;
      }
      const resolved = ctx.resolveMove(safeX, safeZ, nextX, nextZ, PLAYER_BODY_RADIUS, p);
      const moved = Math.hypot(resolved.x - safeX, resolved.z - safeZ);
      const blocked =
        Math.hypot(resolved.x - nextX, resolved.z - nextZ) > PLAYER_BODY_RADIUS * 0.25;
      if (blocked || moved < step * 0.5) break;
      safeX = resolved.x;
      safeZ = resolved.z;
      prevGround = groundHeight(safeX, safeZ, ctx.cfg.seed);
    }
  }
  p.pos.x = safeX;
  p.pos.z = safeZ;
  p.pos.y = groundHeight(safeX, safeZ, ctx.cfg.seed);
  p.vy = 0;
  p.onGround = true;
  p.fallStartY = p.pos.y;
  p.chargeTargetId = null;
  p.chargePath = [];
}

function consumeMatchingAura(
  ctx: SimContext,
  caster: Entity,
  target: Entity | null,
  eff: Extract<ResolvedAbility['effects'][number], { type: 'consumeAura' }>,
): number {
  if (!target) return -1;
  return target.auras.findIndex((a) => {
    // Only dot/hot auras are consumable, even by id: a raw splice skips the
    // stat-aura teardown expiry performs, so consuming a stat-carrying aura
    // (buff_*/form_*) would leak its contribution permanently.
    if (a.kind !== 'dot' && a.kind !== 'hot') return false;
    const matchesId = eff.auraIds?.includes(a.id);
    const matchesKind = eff.auraKind !== undefined && a.kind === eff.auraKind;
    if (!matchesId && !matchesKind) return false;
    if (target !== caster && ctx.isHostileTo(caster, target) && a.kind === 'dot') {
      return a.sourceId === caster.id;
    }
    return true;
  });
}

function friendliesInRadius(ctx: SimContext, source: Entity, radius: number): Entity[] {
  const out: Entity[] = [];
  const r2 = radius * radius;
  for (const e of ctx.entities.values()) {
    if (e.dead) continue;
    const dx = e.pos.x - source.pos.x;
    const dz = e.pos.z - source.pos.z;
    if (dx * dx + dz * dz > r2) continue;
    if (e.id === source.id || ctx.isFriendlyTo(source, e)) out.push(e);
  }
  return out;
}

export function runEffects(
  ctx: SimContext,
  p: Entity,
  meta: PlayerMeta,
  target: Entity | null,
  res: ResolvedAbility,
): void {
  const ability = res.def;
  const isSpell = ability.school !== 'physical';
  const spentCombo = ability.spendsCombo ? p.comboPoints : 0;
  let comboAwarded = false;
  const mods = ctx.playerMods(meta);
  const forceCrit = hasSureCritAura(p);
  const canAreaEcho = hasAreaEchoAura(p) && abilityQualifiesForAreaEcho(res.effects);
  let spentSureCrit = false;
  let spentAreaEcho = false;
  let lastDirectDamage = 0;
  // acting breaks stealth (the opener itself still lands first inside the swing).
  // Stealth toggles and Rogue Sprint are allowed while remaining hidden.
  if (!preservesStealth(ability)) ctx.breakStealth(p);
  // Casting a healing spell drops a Shadow priest out of Shadowform: the form
  // amplifies Shadow damage but forbids healing (classic Shadowform rule).
  if (res.effects.some((e) => e.type === 'heal' || e.type === 'hot' || e.type === 'aoeHeal')) {
    const sf = p.auras.findIndex((a) => a.kind === 'form_shadow');
    if (sf >= 0) {
      const lost = p.auras[sf];
      p.auras.splice(sf, 1);
      ctx.emit({ type: 'aura', targetId: p.id, name: lost.name, gained: false });
      recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta));
    }
  }
  const threatOpts = { flat: res.threatFlat, mult: res.threatMult };

  for (const eff of res.effects) {
    switch (eff.type) {
      case 'weaponStrike': {
        if (!target) break;
        const hit = ctx.meleeSwing(p, target, eff.bonus, ability.name, {
          cannotBeDodged: eff.cannotBeDodged,
          weaponMult: eff.weaponMult ?? 1,
          threatFlat: res.threatFlat,
          threatMult: res.threatMult,
        });
        if (hit && ability.awardsCombo) {
          ctx.awardCombo(p, target, ability.awardsCombo);
          comboAwarded = true;
        }
        if (ability.requiresDodgeProc) p.overpowerUntil = -1;
        break;
      }
      case 'directDamage': {
        if (!target) break;
        if (!ctx.isHostileTo(p, target)) break;
        const rooted = isRootedOrChilled(target);
        const critChance =
          isSpell && rooted
            ? ctx.spellCrit(p) + mods.global.critVsRooted
            : isSpell
              ? ctx.spellCrit(p)
              : p.critChance;
        let dmg = ctx.rng.range(eff.min, eff.max);
        // The flat rider scales with the school's rating: Spell Power for spells,
        // Ranged AP for hunter shots, melee Attack Power for physical specials.
        // abilityScalingPower picks the rating; powerScale (inside directHitBonus)
        // applies the AP scale-down. A non-scaling effect just contributes 0.
        dmg += directHitBonus(abilityScalingPower(p, ability), ability, res.castTime);
        if (eff.vsRootedMult !== undefined && rooted) dmg *= eff.vsRootedMult;
        // Conditional talent damage vs a target carrying the CASTER'S DoT
        // (Twisted Faith style). Deterministic aura scan, no rng.
        const abilityMod = mods.abilities[ability.id];
        const vsDotted = abilityMod?.dmgPctVsDotted ?? 0;
        const requiredDot = abilityMod?.dmgPctVsDottedAbility;
        if (
          vsDotted > 0 &&
          target.auras.some(
            (a) =>
              a.kind === 'dot' &&
              a.sourceId === p.id &&
              (requiredDot === undefined || a.id === requiredDot),
          )
        ) {
          dmg *= 1 + vsDotted;
        }
        const rolledCrit = ctx.rng.chance(consumeNextAttackCrit(ctx, p) ? 1 : critChance);
        const crit = forceCrit || rolledCrit;
        if (forceCrit) spentSureCrit = true;
        if (crit) dmg *= (isSpell ? 1.5 : 2) + p.critDmgBonus;
        if (isSpell) dmg *= spellDamageMultFromAuras(p);
        if (!isSpell) dmg *= 1 - armorReduction(ctx.effectiveArmor(target), p.level);
        const finalDamage = Math.round(dmg);
        lastDirectDamage = finalDamage;
        ctx.dealDamage(
          p,
          target,
          finalDamage,
          crit,
          ability.school,
          ability.name,
          'hit',
          false,
          threatOpts,
          true,
          ability.id,
        );
        if (canAreaEcho && finalDamage > 0 && !target.dead) {
          echoAreaDamage(ctx, p, target, finalDamage, ability.school, ability.name, threatOpts);
          spentAreaEcho = true;
        }
        if (isSpell) noteSpellHit(ctx, p, crit);
        if (!target.dead && ability.awardsCombo && !comboAwarded) {
          ctx.awardCombo(p, target, ability.awardsCombo);
          comboAwarded = true;
        }
        // Legendary on-spell-damage weapon procs (e.g. Deathless Heartwood's
        // Deathbloom). Only a landed damaging SPELL triggers it; a physical special
        // routed through this same case does not. No-op (no rng draw) unless the
        // caster wields a proc weapon with a spellDamage proc.
        if (isSpell) runWeaponProcs(ctx, p, target, 'spellDamage');
        break;
      }
      case 'chainDamage': {
        if (!target || !ctx.isHostileTo(p, target)) break;
        const baseDamage =
          ctx.rng.range(eff.min, eff.max) +
          directHitBonus(abilityScalingPower(p, ability), ability, res.castTime);
        const hitIds = new Set<number>();

        const hitAndBounce = (victim: Entity, hop: number): void => {
          if (victim.dead || !ctx.isHostileTo(p, victim) || hitIds.has(victim.id)) return;
          hitIds.add(victim.id);

          const critChance = isSpell ? ctx.spellCrit(p) : p.critChance;
          const rolledCrit = ctx.rng.chance(consumeNextAttackCrit(ctx, p) ? 1 : critChance);
          const crit = hop === 0 && forceCrit ? true : rolledCrit;
          if (hop === 0 && forceCrit) spentSureCrit = true;
          let dmg = baseDamage * eff.falloff ** hop;
          if (crit) dmg *= (isSpell ? 1.5 : 2) + p.critDmgBonus;
          if (isSpell) dmg *= spellDamageMultFromAuras(p);
          if (!isSpell) dmg *= 1 - armorReduction(ctx.effectiveArmor(victim), p.level);
          ctx.dealDamage(
            p,
            victim,
            Math.round(dmg),
            crit,
            ability.school,
            ability.name,
            'hit',
            false,
            threatOpts,
            true,
            ability.id,
          );
          if (isSpell) noteSpellHit(ctx, p, crit);
          // A chain is one damaging spell cast. Roll equipment procs once on the
          // primary impact, never once per bounce.
          if (isSpell && hop === 0) runWeaponProcs(ctx, p, victim, 'spellDamage');
          if (hop >= eff.jumps || p.dead) return;

          const radiusSq = eff.radius * eff.radius;
          let next: Entity | null = null;
          let nextDistanceSq = Infinity;
          for (const candidate of ctx.entities.values()) {
            if (candidate.dead || hitIds.has(candidate.id) || !ctx.isHostileTo(p, candidate)) {
              continue;
            }
            const dx = candidate.pos.x - victim.pos.x;
            const dz = candidate.pos.z - victim.pos.z;
            const distanceSq = dx * dx + dz * dz;
            if (distanceSq > radiusSq || !ctx.hasLineOfSight(victim, candidate)) continue;
            if (
              next === null ||
              distanceSq < nextDistanceSq ||
              (distanceSq === nextDistanceSq && candidate.id < next.id)
            ) {
              next = candidate;
              nextDistanceSq = distanceSq;
            }
          }
          if (next === null) return;
          ctx.emit({
            type: 'spellfx',
            sourceId: victim.id,
            targetId: next.id,
            school: ability.school,
            fx: 'projectile',
          });
          scheduleProjectile(ctx, p, next, (_source, landed) => hitAndBounce(landed, hop + 1), {
            ...victim.pos,
          });
        };

        hitAndBounce(target, 0);
        break;
      }
      case 'finisherDamage': {
        if (!target || spentCombo <= 0) break;
        let dmg =
          eff.base +
          eff.perCombo * spentCombo +
          ctx.rng.range(0, eff.variance) +
          ctx.effectiveAttackPower(p) / 14;
        const rolledCrit = ctx.rng.chance(consumeNextAttackCrit(ctx, p) ? 1 : p.critChance);
        const crit = forceCrit || rolledCrit;
        if (forceCrit) spentSureCrit = true;
        if (crit) dmg *= 2 + p.critDmgBonus;
        dmg *= 1 - armorReduction(ctx.effectiveArmor(target), p.level);
        ctx.dealDamage(
          p,
          target,
          Math.round(dmg),
          crit,
          'physical',
          ability.name,
          'hit',
          false,
          threatOpts,
        );
        break;
      }
      case 'finisherHaste': {
        if (spentCombo <= 0) break;
        ctx.applyAura(p, {
          id: ability.id,
          name: ability.name,
          kind: 'buff_haste',
          remaining: eff.basedur + eff.perCombo * spentCombo,
          duration: eff.basedur + eff.perCombo * spentCombo,
          value: eff.mult,
          sourceId: p.id,
          school: 'physical',
        });
        break;
      }
      case 'finisherStun': {
        if (!target || target.dead || spentCombo <= 0) break;
        const dur = ctx.diminishedCrowdControlDuration(
          p,
          target,
          stunDrCategory(ability.id),
          eff.base + eff.perCombo * spentCombo,
        );
        if (dur === null) break;
        ctx.applyAura(target, {
          id: `${ability.id}_stun`,
          name: ability.name,
          kind: 'stun',
          remaining: dur,
          duration: dur,
          value: 0,
          sourceId: p.id,
          school: ability.school,
        });
        ctx.enterCombat(p, target);
        break;
      }
      case 'weaponDamage':
        break;
      case 'heal': {
        const healTarget = target ?? p;
        if (healTarget !== p && ctx.isHostileTo(p, healTarget)) break;
        // Heals scale with Spell Power at the direct cast-time coefficient, the
        // healing mirror of the direct-nuke rider (applyHeal fires the crit).
        const healAmount =
          ctx.rng.range(eff.min, eff.max) + directHealBonus(p.spellPower, res.castTime);
        ctx.applyHeal(p, healTarget, healAmount, ability.name, ability.id);
        break;
      }
      case 'chainHeal': {
        // Chain Heal: heal the target, then arc hop by hop to nearby allies. The
        // hop choice is DETERMINISTIC (most injured by hp fraction, then nearest,
        // then lowest id), so the only rng draws are the one base roll plus each
        // applyHeal's crit, and the same world state always builds the same chain.
        // Selection and the per-hop spellfx arc adopted from Blaine1705's #1434.
        const first = target ?? p;
        const baseAmount =
          ctx.rng.range(eff.min, eff.max) + directHealBonus(p.spellPower, res.castTime);
        const chain: Entity[] = [first];
        while (chain.length <= eff.jumps) {
          const from = chain[chain.length - 1];
          let best: Entity | null = null;
          let bestFrac = Infinity;
          let bestD2 = Infinity;
          // The main grid holds every entity (players AND player-owned pets AND
          // mobs); isFriendlyTo filters to healable allies, so one scan suffices.
          // The pick is a deterministic min (hp fraction, then distance, then id),
          // so it is independent of grid iteration order (no rng here).
          ctx.grid.forEachInRadius(from.pos.x, from.pos.z, eff.radius, (e, d2) => {
            if (e.dead || chain.includes(e)) return;
            // Allies only: players and player-owned pets (what a friendly-target
            // heal may hit), never a hostile or an NPC bystander.
            if (e.id !== p.id && !ctx.isFriendlyTo(p, e)) return;
            // hp/maxHp are integers, so equal fractions compute the identical float:
            // an EXACT ladder (frac, then distance, then id) is transitive and thus
            // order-independent, no epsilon window needed.
            const frac = e.maxHp > 0 ? e.hp / e.maxHp : 1;
            const better =
              best === null ||
              frac < bestFrac ||
              (frac === bestFrac && (d2 < bestD2 || (d2 === bestD2 && e.id < best.id)));
            if (better) {
              best = e;
              bestFrac = frac;
              bestD2 = d2;
            }
          });
          if (best === null) break;
          chain.push(best);
        }
        for (let i = 0; i < chain.length; i++) {
          // The green healing arc: caster to the first target, then previous hop to
          // the next (a dedicated fx so it reads as a healing cord, not a nuke beam).
          ctx.emit({
            type: 'spellfx',
            sourceId: i === 0 ? p.id : chain[i - 1].id,
            targetId: chain[i].id,
            school: ability.school,
            fx: 'chainHeal',
          });
          const hopAmount = Math.max(1, Math.round(baseAmount * eff.falloff ** i));
          ctx.applyHeal(p, chain[i], hopAmount, ability.name, ability.id);
        }
        break;
      }
      case 'feralCharge': {
        // Druid Feral signature (Feral Instinct): a form-gated resource burst. Cat Form
        // (Energy) gains a regeneration buff; Bear Form (Rage) gets an instant Rage jolt.
        if (p.auras.some((a) => a.kind === 'form_cat')) {
          ctx.applyAura(p, {
            id: 'feral_instinct_energy',
            name: ability.name,
            kind: 'buff_energyregen',
            remaining: 10,
            duration: 10,
            value: 1,
            sourceId: p.id,
            school: ability.school,
          });
        } else if (p.auras.some((a) => a.kind === 'form_bear') && p.resourceType === 'rage') {
          p.resource = Math.min(p.maxResource, p.resource + 50);
        }
        break;
      }
      case 'hot': {
        const hotTarget = target ?? p;
        // A HoT that RIDES a direct heal (Regrowth-style) does NOT also scale here:
        // the direct component already took the cast-time coefficient, so scaling the
        // rider too would double-dip. Only pure HoTs (Rejuvenation) take the rider.
        const hybridHeal = res.effects.some((e) => e.type === 'heal');
        const hotBase = Math.max(1, Math.round(eff.total / (eff.duration / eff.interval)));
        const hotSp = hybridHeal ? 0 : hotTickBonus(p.spellPower, eff.duration, eff.interval);
        ctx.applyAura(hotTarget, {
          id: ability.id,
          name: ability.name,
          kind: 'hot',
          remaining: eff.duration,
          duration: eff.duration,
          value: hotBase + hotSp,
          tickInterval: eff.interval,
          tickTimer: eff.interval,
          sourceId: p.id,
          school: ability.school,
        });
        break;
      }
      case 'absorb': {
        const shieldTarget = target ?? p;
        const hasStasisSelfBuff = ability.effects.some(
          (e) => e.type === 'selfBuff' && e.kind === 'stasis',
        );
        ctx.applyAura(shieldTarget, {
          id: hasStasisSelfBuff ? `${ability.id}_absorb` : ability.id,
          name: ability.name,
          kind: 'absorb',
          remaining: eff.duration,
          duration: eff.duration,
          value: eff.amount,
          sourceId: p.id,
          school: ability.school,
        });
        break;
      }
      case 'imbue': {
        for (let i = p.auras.length - 1; i >= 0; i--) {
          const a = p.auras[i];
          if (a.kind === 'imbue' && a.id !== ability.id) {
            p.auras.splice(i, 1);
            ctx.emit({ type: 'aura', targetId: p.id, name: a.name, gained: false });
          }
        }
        ctx.applyAura(p, {
          id: ability.id,
          name: ability.name,
          kind: 'imbue',
          remaining: eff.duration,
          duration: eff.duration,
          value: eff.bonus,
          value2: eff.judgeMin,
          value3: eff.judgeMax,
          sourceId: p.id,
          school: ability.school,
        });
        break;
      }
      case 'judgement': {
        if (!target) break;
        const sealIdx = p.auras.findIndex((a) => a.kind === 'imbue' && a.value2 !== undefined);
        if (sealIdx < 0) {
          ctx.error(p.id, 'You have no active Seal.');
          break;
        }
        const seal = p.auras[sealIdx];
        p.auras.splice(sealIdx, 1);
        ctx.emit({ type: 'aura', targetId: p.id, name: seal.name, gained: false });
        // Judgement is an instant holy nuke; scale it with Spell Power too.
        const baseDmg = ctx.rng.range(seal.value2 ?? 10, seal.value3 ?? 15);
        let dmg =
          baseDmg * (eff.dmgMult ?? 1) +
          (eff.flat ?? 0) +
          directHitBonus(p.spellPower, ability, res.castTime);
        const rolledCrit = ctx.rng.chance(consumeNextAttackCrit(ctx, p) ? 1 : ctx.spellCrit(p));
        const crit = forceCrit || rolledCrit;
        if (forceCrit) spentSureCrit = true;
        if (crit) dmg *= 1.5 + p.critDmgBonus;
        ctx.dealDamage(
          p,
          target,
          Math.round(dmg),
          crit,
          'holy',
          ability.name,
          'hit',
          false,
          undefined,
          true,
          ability.id,
        );
        noteSpellHit(ctx, p, crit);
        break;
      }
      case 'extendDot': {
        // Channel-tick rider: stretch the caster's named DoT on the target,
        // capped per DoT application (extendedBy bookkeeping on the aura).
        if (!target) break;
        const dotAura = target.auras.find(
          (a) => a.kind === 'dot' && a.id === eff.dot && a.sourceId === p.id,
        );
        if (!dotAura) break;
        const already = dotAura.extendedBy ?? 0;
        const add = Math.min(eff.seconds, eff.maxBonus - already);
        if (add <= 0) break;
        dotAura.extendedBy = already + add;
        dotAura.remaining += add;
        dotAura.duration += add;
        break;
      }
      case 'consumeDot': {
        // Detonate the caster's named DoT: its remaining damage lands now as
        // this ability's school, and the DoT is removed. Deterministic: the
        // remaining-tick count is plain math on the aura's timers, no rng.
        if (!target) break;
        const di = target.auras.findIndex(
          (a) => a.kind === 'dot' && a.id === eff.dot && a.sourceId === p.id,
        );
        if (di < 0) break;
        const dot = target.auras[di];
        const interval = dot.tickInterval ?? 1;
        const untilNextTick = dot.tickTimer ?? interval;
        const ticksLeft =
          untilNextTick <= dot.remaining
            ? 1 + Math.max(0, Math.floor((dot.remaining - untilNextTick) / interval))
            : 0;
        const remainingDmg = Math.round(dot.value * ticksLeft);
        target.auras.splice(di, 1);
        ctx.emit({ type: 'aura', targetId: target.id, name: dot.name, gained: false });
        ctx.emit({
          type: 'spellfx',
          sourceId: p.id,
          targetId: target.id,
          school: dot.school,
          fx: 'detonate',
        });
        if (remainingDmg > 0) {
          ctx.dealDamage(
            p,
            target,
            remainingDmg,
            false,
            ability.school,
            ability.name,
            'hit',
            false,
            threatOpts,
          );
        }
        break;
      }
      case 'interrupt': {
        if (!target || target.castingAbility === null || target.castingAbility === FISHING_CAST_ID)
          break;
        if (p.kind === 'player' && target.kind === 'player' && !ctx.isHostileTo(p, target)) break;
        // Resolve per-player when possible (rank/mods), but fall back to the
        // global ability table so a non-player caster (a mob whose cast is an
        // ability id) is interruptible too; scripted pseudo-casts resolve to
        // nothing and are immune by design.
        const interruptedDef =
          ctx.resolvedAbility(target.castingAbility, target.id)?.def ??
          ABILITIES[target.castingAbility];
        if (
          !interruptedDef ||
          interruptedDef.school === 'physical' ||
          interruptedDef.uninterruptible
        )
          break;
        const school = interruptedDef.school;
        const remaining = ctx.diminishedCrowdControlDuration(p, target, 'lockout', eff.lockout);
        ctx.cancelCast(target);
        if (remaining === null) break;
        ctx.applyAura(target, {
          id: `${ability.id}_lockout`,
          name: ability.name,
          kind: 'lockout',
          remaining,
          duration: remaining,
          value: 0,
          sourceId: p.id,
          school,
        });
        break;
      }
      case 'dispel': {
        if (!target || target.dead) break;
        // Direction follows the target relation: strip harmful MAGIC debuffs off an ally
        // or yourself, or beneficial MAGIC buffs off a hostile target. Physical auras
        // (bleeds, sunders) are never dispellable. Iterate back-to-front so splices are safe.
        const offensive = ctx.isHostileTo(p, target);
        let dispelled = 0;
        for (let i = target.auras.length - 1; i >= 0 && dispelled < eff.count; i--) {
          const a = target.auras[i];
          if (a.school === 'physical') continue;
          const harmful = isDebuffAura(a.kind, a.value);
          if (offensive ? harmful : !harmful) continue;
          target.auras.splice(i, 1);
          ctx.emit({ type: 'aura', targetId: target.id, name: a.name, gained: false });
          // Spellsteal: a beneficial buff taken off an enemy is re-applied to the caster,
          // its remaining duration carried over (re-homed to the caster as the source).
          if (eff.steal && offensive) {
            ctx.applyAura(p, { ...a, sourceId: p.id });
          }
          dispelled++;
        }
        // A stripped stat aura (a buff/debuff carrying stat mods) must re-derive stats.
        if (dispelled > 0 && target.kind === 'player') {
          const tmeta = ctx.players.get(target.id);
          if (tmeta) recalcPlayerStats(target, tmeta.cls, tmeta.equipment, ctx.playerMods(tmeta));
        }
        if (dispelled === 0) ctx.error(p.id, 'Nothing to dispel.');
        break;
      }
      case 'silence': {
        if (!target || target.dead) break;
        const remaining = ctx.diminishedCrowdControlDuration(p, target, 'lockout', eff.duration);
        if (remaining === null) break;
        ctx.applyAura(target, {
          id: `${ability.id}_silence`,
          name: ability.name,
          kind: 'silence',
          remaining,
          duration: remaining,
          value: 0,
          sourceId: p.id,
          school: ability.school,
        });
        ctx.enterCombat(p, target);
        break;
      }
      case 'aoeFear': {
        ctx.emit({
          type: 'spellfx',
          sourceId: p.id,
          targetId: p.id,
          school: ability.school,
          fx: 'nova',
        });
        for (const m of ctx.hostilesInRadius(p, p.pos, eff.radius)) {
          if (!ctx.hasLineOfSight(p, m)) continue;
          const remaining = ctx.diminishedCrowdControlDuration(p, m, 'fear', eff.duration);
          if (remaining === null) continue;
          ctx.applyAura(m, {
            id: 'fear_incap',
            name: ability.name,
            kind: 'incapacitate',
            remaining,
            duration: remaining,
            value: ctx.rng.range(-Math.PI, Math.PI),
            sourceId: p.id,
            school: ability.school,
            breaksOnDamage: true,
            breakThreshold:
              mods.global.fearBreakPct > 0
                ? Math.round(m.maxHp * mods.global.fearBreakPct)
                : undefined,
          });
          ctx.enterCombat(p, m);
        }
        break;
      }
      case 'clearCooldowns': {
        for (const id of eff.abilities) p.cooldowns.delete(id);
        break;
      }
      case 'breakControl': {
        for (let i = p.auras.length - 1; i >= 0; i--) {
          const aura = p.auras[i];
          if (
            aura.kind !== 'stun' &&
            aura.kind !== 'root' &&
            aura.kind !== 'incapacitate' &&
            aura.kind !== 'polymorph' &&
            aura.kind !== 'silence' &&
            aura.kind !== 'blind' &&
            aura.kind !== 'disarm'
          ) {
            continue;
          }
          p.auras.splice(i, 1);
          ctx.emit({ type: 'aura', targetId: p.id, name: aura.name, gained: false });
        }
        break;
      }
      case 'repositionToAim': {
        if (eff.breakRoots) removeRootAuras(ctx, p);
        const aim = p.castAim ?? p.pos;
        sweptReposition(ctx, p, aim.x, aim.z);
        break;
      }
      case 'blinkForward': {
        if (eff.breakRoots) removeRootAuras(ctx, p);
        let distance = eff.distance;
        let facing = p.facing;
        const target = p.targetId !== null ? (ctx.entities.get(p.targetId) ?? null) : null;
        if (ability.id === 'shadowstep' && target && !target.dead) {
          const dx = target.pos.x - p.pos.x;
          const dz = target.pos.z - p.pos.z;
          const toTarget = Math.hypot(dx, dz);
          if (toTarget <= 1.5) break;
          facing = Math.atan2(dx, dz);
          p.facing = facing;
          distance = Math.min(toTarget - 1.5, eff.distance);
        }
        const x = p.pos.x + Math.sin(facing) * distance;
        const z = p.pos.z + Math.cos(facing) * distance;
        sweptReposition(ctx, p, x, z);
        break;
      }
      case 'lifeTap': {
        if (p.hp <= eff.hp) {
          ctx.error(p.id, 'Not enough health.');
          break;
        }
        p.hp -= eff.hp;
        ctx.emit({
          type: 'damage',
          sourceId: p.id,
          targetId: p.id,
          amount: eff.hp,
          crit: false,
          school: ability.school,
          ability: ability.name,
          kind: 'hit',
        });
        p.resource = Math.min(p.maxResource, p.resource + eff.mana);
        // The sap is a MOMENT: the life-fountain burst sells health becoming power.
        ctx.emit({
          type: 'spellfx',
          sourceId: p.id,
          targetId: p.id,
          school: ability.school,
          fx: 'echoBurst',
        });
        break;
      }
      case 'drainTick':
        break; // handled per channel tick
      case 'buffTarget': {
        const applyBuff = (e: Entity) =>
          ctx.applyAura(e, {
            id: ability.id,
            name: ability.name,
            kind: eff.kind,
            remaining: eff.duration,
            duration: eff.duration,
            value: eff.value,
            sourceId: p.id,
            school: ability.school,
          });
        if (eff.party) {
          // Raid buff: land on the explicit target (self, ally, or a controlled pet),
          // the caster, and every living member of the caster's party/raid, regardless
          // of range. One cast buffs the whole group.
          const party = ctx.partyOf(p.id);
          const seen = new Set<number>();
          const give = (e: Entity | null | undefined) => {
            if (e && !e.dead && !seen.has(e.id)) {
              seen.add(e.id);
              applyBuff(e);
            }
          };
          give(target ?? p);
          give(p);
          if (party) {
            for (const pid of party.members) give(ctx.entities.get(pid));
          }
        } else {
          applyBuff(target ?? p);
        }
        break;
      }
      case 'faerieFire': {
        // Fixed-percent armor-reduction debuff (see effectiveArmor); does not stack
        // with Sunder Armor. The percent is a constant, so the aura value is unused.
        if (!target || target.dead) break;
        ctx.applyAura(target, {
          id: ability.id,
          name: ability.name,
          kind: 'faerie_fire',
          remaining: eff.duration,
          duration: eff.duration,
          value: 0,
          sourceId: p.id,
          school: ability.school,
        });
        ctx.enterCombat(p, target);
        break;
      }
      case 'dot': {
        if (!target || target.dead) break;
        // Snapshot Spell Power (or Ranged AP) into the per-tick value at cast time,
        // classic-style: the total DoT coefficient spread across its ticks. A DoT
        // that RIDES a direct/AoE nuke (Fireball, Pyroblast, Immolate) does NOT also
        // scale here: the direct component already took the cast-time coefficient, so
        // scaling the rider too would double-dip and over-reward hybrids. Only pure
        // DoTs (Corruption, SW:P, Serpent Sting) scale through this path.
        const hybrid = res.effects.some(
          (e) =>
            e.type === 'directDamage' ||
            e.type === 'chainDamage' ||
            e.type === 'aoeDamage' ||
            e.type === 'aoeRoot',
        );
        if (eff.directPct !== undefined && lastDirectDamage <= 0) break;
        const dotTotal =
          eff.directPct === undefined ? eff.total : Math.round(lastDirectDamage * eff.directPct);
        const dotBase = Math.max(1, Math.round(dotTotal / (eff.duration / eff.interval)));
        // Physical bleeds (Rend, Rupture, Garrote, Rip) scale off melee Attack
        // Power here just like a spell DoT scales off Spell Power; `hybrid` still
        // suppresses the rider on a DoT that trails its own direct nuke.
        const dotSp = !hybrid
          ? dotTickBonus(abilityScalingPower(p, ability), ability, eff.duration, eff.interval)
          : 0;
        ctx.applyAura(target, {
          id: ability.id,
          name: ability.name,
          kind: 'dot',
          remaining: eff.duration,
          duration: eff.duration,
          value: dotBase + dotSp,
          tickInterval: eff.interval,
          tickTimer: eff.interval,
          sourceId: p.id,
          school: eff.school ?? ability.school,
          leechPct: eff.leechPct,
        });
        ctx.enterCombat(p, target);
        break;
      }
      case 'slow': {
        if (!target || target.dead) break;
        ctx.applyAura(target, {
          id: `${ability.id}_slow`,
          name: ability.name,
          kind: 'slow',
          remaining: eff.duration,
          duration: eff.duration,
          value: eff.mult,
          sourceId: p.id,
          school: ability.school,
        });
        ctx.enterCombat(p, target);
        break;
      }
      case 'root': {
        if (!target || target.dead) break;
        ctx.applyRootAura(
          p,
          target,
          ability.name,
          `${ability.id}_root`,
          eff.duration,
          ability.school,
        );
        ctx.enterCombat(p, target);
        break;
      }
      case 'stun': {
        if (!target || target.dead) break;
        const remaining = ctx.diminishedCrowdControlDuration(
          p,
          target,
          stunDrCategory(ability.id),
          eff.duration,
        );
        if (remaining === null) break;
        ctx.applyAura(target, {
          id: `${ability.id}_stun`,
          name: ability.name,
          kind: 'stun',
          remaining,
          duration: remaining,
          value: 0,
          sourceId: p.id,
          school: ability.school,
        });
        ctx.enterCombat(p, target);
        break;
      }
      case 'incapacitate': {
        if (!target || target.dead) break;
        const remaining = ability.fearDr
          ? ctx.diminishedCrowdControlDuration(p, target, 'fear', eff.duration)
          : eff.duration;
        if (remaining === null) break;
        ctx.applyAura(target, {
          id: `${ability.id}_incap`,
          name: ability.name,
          kind: 'incapacitate',
          remaining,
          duration: remaining,
          value: ability.fearDr ? ctx.rng.range(-Math.PI, Math.PI) : 0,
          sourceId: p.id,
          school: ability.school,
          breaksOnDamage: true,
        });
        if (ability.awardsCombo && !comboAwarded) {
          ctx.awardCombo(p, target, ability.awardsCombo);
          comboAwarded = true;
        }
        ctx.enterCombat(p, target);
        break;
      }
      case 'polymorph': {
        if (!target || target.dead) break;
        const remaining = ctx.diminishedCrowdControlDuration(p, target, 'polymorph', eff.duration);
        if (remaining === null) break;
        target.hp = target.maxHp;
        ctx.applyAura(target, {
          id: ability.id,
          name: ability.name,
          kind: 'polymorph',
          remaining,
          duration: remaining,
          value: 0,
          tickInterval: 1,
          tickTimer: 1,
          sourceId: p.id,
          school: ability.school,
          breaksOnDamage: true,
        });
        target.auras = target.auras.filter((a) => a.kind !== 'dot' || a.id === ability.id);
        ctx.enterCombat(p, target);
        break;
      }
      case 'aoeDamage': {
        // Ground-targeted casts blast where they were aimed; others detonate on
        // the caster. The fx follows the same center (a world-anchored burst for
        // an aimed blast, the entity-anchored nova otherwise).
        const aoeCenter = p.castAim ?? p.pos;
        if (p.castAim) {
          ctx.emit({
            type: 'spellfxAt',
            x: aoeCenter.x,
            z: aoeCenter.z,
            school: ability.school,
            fx: 'nova',
            radius: eff.radius,
          });
        } else {
          ctx.emit({
            type: 'spellfx',
            sourceId: p.id,
            targetId: p.id,
            school: ability.school,
            fx: 'nova',
          });
        }
        const aoeSpBonus = directHitBonus(
          abilityScalingPower(p, ability),
          ability,
          res.castTime,
          true,
        );
        for (const m of ctx.hostilesInRadius(p, aoeCenter, eff.radius)) {
          if (!ctx.hasLineOfSight(p, m)) continue;
          let dmg = ctx.rng.range(eff.min, eff.max) + aoeSpBonus;
          if (isSpell) dmg *= spellDamageMultFromAuras(p);
          // Armor only mitigates physical damage, mirroring the single-target
          // path above — spell-school AoE (Arcane Explosion, Consecration) is
          // not reduced by the target's armor.
          if (!isSpell) dmg *= 1 - armorReduction(ctx.effectiveArmor(m), p.level);
          ctx.dealDamage(
            p,
            m,
            Math.round(dmg),
            false,
            ability.school,
            ability.name,
            'hit',
            false,
            threatOpts,
          );
        }
        break;
      }
      case 'aoeHeal': {
        ctx.emit({
          type: 'spellfx',
          sourceId: p.id,
          targetId: p.id,
          school: ability.school,
          fx: 'nova',
        });
        const aoeHealBonus = directHealBonus(p.spellPower, res.castTime);
        for (const m of friendliesInRadius(ctx, p, eff.radius)) {
          if (!ctx.hasLineOfSight(p, m)) continue;
          const healAmount = ctx.rng.range(eff.min, eff.max) + aoeHealBonus;
          ctx.applyHeal(p, m, healAmount, ability.name, ability.id);
        }
        break;
      }
      case 'groundAoE': {
        // Ground-targeted casts drop the zone where they were aimed; others lay it
        // under the caster (e.g. Consecration at your feet).
        const zoneCenter = p.castAim ?? p.pos;
        const groundEffect: GroundAoE = {
          sourceId: p.id,
          pos: { ...zoneCenter },
          radius: eff.radius,
          min: eff.min,
          max: eff.max,
          remaining: eff.duration,
          interval: eff.interval,
          tickTimer: eff.interval,
          school: ability.school,
          ability: ability.name,
          // Each pulse is an AoE hit; scale per tick off the school's rating
          // (Spell Power, Ranged AP, or melee Attack Power for physical pulses).
          spBonus: directHitBonus(abilityScalingPower(p, ability), ability, res.castTime, true),
        };
        if (p.castAim) {
          ctx.emit({
            type: 'spellfxAt',
            x: zoneCenter.x,
            z: zoneCenter.z,
            school: ability.school,
            fx: 'nova',
            radius: eff.radius,
          });
        } else {
          ctx.emit({
            type: 'spellfx',
            sourceId: p.id,
            targetId: p.id,
            school: ability.school,
            fx: 'nova',
          });
        }
        ctx.pulseGroundAoE(groundEffect, threatOpts, true);
        ctx.groundAoEs.push(groundEffect);
        break;
      }
      case 'aoeAttackSpeed': {
        for (const m of ctx.hostilesInRadius(p, p.pos, eff.radius)) {
          if (m.dead) continue;
          if (!ctx.hasLineOfSight(p, m)) continue;
          ctx.applyAura(m, {
            id: `${ability.id}_as`,
            name: ability.name,
            kind: 'attackspeed',
            remaining: eff.duration,
            duration: eff.duration,
            value: eff.mult,
            sourceId: p.id,
            school: ability.school,
          });
        }
        break;
      }
      case 'aoeAttackPower': {
        for (const m of ctx.hostilesInRadius(p, p.pos, eff.radius)) {
          if (m.dead) continue;
          ctx.applyAura(m, {
            id: `${ability.id}_ap`,
            name: ability.name,
            kind: 'debuff_ap',
            remaining: eff.duration,
            duration: eff.duration,
            value: eff.amount,
            sourceId: p.id,
            school: ability.school,
          });
          ctx.enterCombat(p, m);
          if (m.kind === 'mob' && m.hostile)
            addThreat(m, p.id, 10 * ctx.threatMod(p, ability.school));
        }
        break;
      }
      case 'aoeAllyAttackPower': {
        // The friendly mirror of aoeAttackPower: an AP BUFF on the caster and
        // nearby allies (Trueshot Aura), riding the PR3a friendlies seam.
        const kind = eff.apPct !== undefined ? 'buff_ap_pct' : 'buff_ap';
        const value = eff.apPct ?? eff.amount ?? 0;
        const party = ctx.partyOf(p.id);
        for (const m of friendliesInRadius(ctx, p, eff.radius)) {
          if (m.id !== p.id && !party?.members.includes(m.id)) continue;
          ctx.applyAura(m, {
            id: `${ability.id}_ap`,
            name: ability.name,
            kind,
            remaining: eff.duration,
            duration: eff.duration,
            value,
            sourceId: p.id,
            school: ability.school,
          });
          if (m.kind === 'player') {
            const targetMeta = ctx.players.get(m.id);
            if (targetMeta)
              recalcPlayerStats(
                m,
                targetMeta.cls,
                targetMeta.equipment,
                ctx.playerMods(targetMeta),
              );
          }
        }
        break;
      }
      case 'aoeAllyHaste': {
        for (const m of friendliesInRadius(ctx, p, eff.radius)) {
          ctx.applyAura(m, {
            id: ability.id,
            name: ability.name,
            kind: 'buff_haste',
            remaining: eff.duration,
            duration: eff.duration,
            value: eff.mult,
            sourceId: p.id,
            school: ability.school,
          });
        }
        break;
      }
      case 'aoeAllyDamage': {
        for (const m of friendliesInRadius(ctx, p, eff.radius)) {
          ctx.applyAura(m, {
            id: `${ability.id}_dmg`,
            name: ability.name,
            kind: 'buff_dmg_done',
            remaining: eff.duration,
            duration: eff.duration,
            value: eff.pct,
            sourceId: p.id,
            school: ability.school,
          });
        }
        break;
      }
      case 'aoeAllySureCrit': {
        for (const m of friendliesInRadius(ctx, p, eff.radius)) {
          ctx.applyAura(m, {
            id: `${ability.id}_crit`,
            name: ability.name,
            kind: 'sure_crit',
            remaining: eff.duration,
            duration: eff.duration,
            value: 0,
            charges: eff.charges,
            sourceId: p.id,
            school: ability.school,
          });
        }
        break;
      }
      case 'aoeSlow': {
        ctx.emit({
          type: 'spellfx',
          sourceId: p.id,
          targetId: p.id,
          school: ability.school,
          fx: 'nova',
        });
        for (const m of ctx.hostilesInRadius(p, p.pos, eff.radius)) {
          if (!ctx.hasLineOfSight(p, m)) continue;
          ctx.applyAura(m, {
            id: `${ability.id}_slow`,
            name: ability.name,
            kind: 'slow',
            remaining: eff.duration,
            duration: eff.duration,
            value: eff.mult,
            sourceId: p.id,
            school: ability.school,
          });
          ctx.enterCombat(p, m);
        }
        break;
      }
      case 'aoeRoot': {
        const center = p.castAim ?? p.pos;
        if (p.castAim) {
          ctx.emit({
            type: 'spellfxAt',
            x: center.x,
            z: center.z,
            school: ability.school,
            fx: 'nova',
            radius: eff.radius,
          });
        } else {
          ctx.emit({
            type: 'spellfx',
            sourceId: p.id,
            targetId: p.id,
            school: ability.school,
            fx: 'nova',
          });
        }
        const aoeRootSp = directHitBonus(
          abilityScalingPower(p, ability),
          ability,
          res.castTime,
          true,
        );
        for (const m of ctx.hostilesInRadius(p, center, eff.radius)) {
          if (!ctx.hasLineOfSight(p, m)) continue;
          const dmg = ctx.rng.range(eff.min, eff.max) + aoeRootSp;
          ctx.dealDamage(p, m, Math.round(dmg), false, ability.school, ability.name, 'hit');
          if (!m.dead && ctx.isHostileTo(p, m)) {
            if (eff.stun) {
              const remaining = ctx.diminishedCrowdControlDuration(
                p,
                m,
                'controlledStun',
                eff.duration,
              );
              if (remaining !== null) {
                ctx.applyAura(m, {
                  id: `${ability.id}_freeze`,
                  name: ability.name,
                  kind: 'stun',
                  remaining,
                  duration: remaining,
                  value: 0,
                  sourceId: p.id,
                  school: ability.school,
                });
              }
            } else {
              ctx.applyRootAura(
                p,
                m,
                ability.name,
                `${ability.id}_root`,
                eff.duration,
                ability.school,
              );
            }
          }
        }
        break;
      }
      case 'consumeAura': {
        if (!target || target.dead) {
          ctx.error(p.id, 'Nothing to consume.');
          break;
        }
        const auraIdx = consumeMatchingAura(ctx, p, target, eff);
        if (auraIdx < 0) {
          ctx.error(p.id, 'Nothing to consume.');
          break;
        }
        const consumed = target.auras[auraIdx];
        target.auras.splice(auraIdx, 1);
        ctx.emit({ type: 'aura', targetId: target.id, name: consumed.name, gained: false });
        if (eff.deal) {
          let dmg =
            ctx.rng.range(eff.deal.min, eff.deal.max) +
            directHitBonus(abilityScalingPower(p, ability), ability, res.castTime);
          if (isSpell) dmg *= spellDamageMultFromAuras(p);
          const rolledCrit = ctx.rng.chance(consumeNextAttackCrit(ctx, p) ? 1 : ctx.spellCrit(p));
          const crit = forceCrit || rolledCrit;
          if (forceCrit) spentSureCrit = true;
          if (crit) dmg *= (isSpell ? 1.5 : 2) + p.critDmgBonus;
          if (!isSpell) dmg *= 1 - armorReduction(ctx.effectiveArmor(target), p.level);
          if (isSpell) noteSpellHit(ctx, p, crit);
          ctx.dealDamage(
            p,
            target,
            Math.round(dmg),
            crit,
            ability.school,
            ability.name,
            'hit',
            false,
            threatOpts,
            true,
            ability.id,
          );
        }
        if (eff.heal) {
          const healAmount =
            ctx.rng.range(eff.heal.min, eff.heal.max) + directHealBonus(p.spellPower, res.castTime);
          ctx.applyHeal(p, target, healAmount, ability.name, ability.id);
        }
        break;
      }
      case 'selfBuff': {
        // forms, stances and stealth are toggles: casting again cancels
        const isFormKind =
          eff.kind === 'form_bear' ||
          eff.kind === 'form_cat' ||
          eff.kind === 'form_travel' ||
          eff.kind === 'form_moonkin' ||
          eff.kind === 'form_shadow';
        const isToggle =
          isFormKind ||
          eff.kind === 'defensive_stance' ||
          eff.kind === 'stealth' ||
          ability.id === 'ghost_wolf';
        if (isToggle) {
          const existing = p.auras.findIndex((a) => a.id === ability.id);
          if (existing >= 0) {
            p.auras.splice(existing, 1);
            if (eff.kind === 'stealth') p.stealthed = false; // toggled back out of stealth
            ctx.emit({ type: 'aura', targetId: p.id, name: ability.name, gained: false });
            recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta));
            break;
          }
        }
        if (eff.kind === 'stasis') {
          if (p.castingAbility) ctx.cancelCast(p);
          p.autoAttack = false;
        }
        // shapeshifting out of one form into another (bear/cat/travel are exclusive)
        if (isFormKind) {
          for (let i = p.auras.length - 1; i >= 0; i--) {
            const a = p.auras[i];
            if (
              (a.kind === 'form_bear' ||
                a.kind === 'form_cat' ||
                a.kind === 'form_travel' ||
                a.kind === 'form_moonkin' ||
                a.kind === 'form_shadow') &&
              a.kind !== eff.kind
            ) {
              p.auras.splice(i, 1);
              ctx.emit({ type: 'aura', targetId: p.id, name: a.name, gained: false });
            }
          }
        }
        // Mutually exclusive self-buff group (hunter aspects): casting one cancels
        // any active sibling so only one in the group is ever up at a time.
        for (const i of exclusiveAuraConflicts(
          ability.exclusiveGroup,
          ability.id,
          p.auras,
          (id) => ABILITIES[id]?.exclusiveGroup,
        )) {
          const a = p.auras[i];
          p.auras.splice(i, 1);
          ctx.emit({ type: 'aura', targetId: p.id, name: a.name, gained: false });
        }
        // An ability can grant SEVERAL self-buffs at once (Arcane Power: spell damage AND
        // haste; Metamorphosis: damage AND haste). applyAura dedups by (id, sourceId), so
        // every companion buff needs a distinct id or the last would evict the rest. The
        // PRIMARY self-buff (the first kind on the DEF) keeps the bare ability id (so its
        // icon/name resolve and the form/aspect toggle-off still finds it by id); companions
        // get a kind-suffixed id. Compare by KIND, not object identity: applyTalentMods may
        // have replaced the resolved effect objects, so a reference check would misfire.
        const firstSelfBuffKind = ability.effects.find((e) => e.type === 'selfBuff')?.kind;
        const isPrimarySelfBuff = eff.kind === firstSelfBuffKind;
        ctx.applyAura(p, {
          id: isPrimarySelfBuff ? ability.id : `${ability.id}_${eff.kind}`,
          name: ability.name,
          kind: eff.kind,
          remaining: eff.duration,
          duration: eff.duration,
          value: eff.value,
          sourceId: p.id,
          school: ability.school,
          // charge-limited thorns (Lightning Shield): cap reflects and gate them
          // behind an internal cooldown. Absent on a plain always-on thorns coat.
          charges: eff.charges,
          icdMax: eff.internalCooldown,
        });
        recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta));
        break;
      }
      case 'petBuff': {
        const pet = ctx.petOf(p.id);
        if (!pet) break;
        // Same multi-buff rule as selfBuff: Metamorphosis buffs the demon's damage AND its
        // cast speed, so the companion pet-buff needs its own id to survive apply. Match by
        // kind (applyTalentMods may have replaced the resolved effect objects).
        const firstPetBuffKind = ability.effects.find((e) => e.type === 'petBuff')?.kind;
        const isPrimaryPetBuff = eff.kind === firstPetBuffKind;
        ctx.applyAura(pet, {
          id: isPrimaryPetBuff ? `${ability.id}_pet` : `${ability.id}_pet_${eff.kind}`,
          name: ability.name,
          kind: eff.kind,
          remaining: eff.duration,
          duration: eff.duration,
          value: eff.value,
          sourceId: p.id,
          school: ability.school,
        });
        break;
      }
      case 'applyDebuff': {
        if (!target || target.dead) break;
        ctx.applyAura(target, {
          id: `${ability.id}_${eff.kind}`,
          name: ability.name,
          kind: eff.kind,
          remaining: eff.duration,
          duration: eff.duration,
          value: eff.value,
          sourceId: p.id,
          school: ability.school,
        });
        ctx.enterCombat(p, target);
        break;
      }
      case 'gainResource': {
        const rageMult =
          p.resourceType === 'rage'
            ? 1 +
              p.auras.reduce(
                (sum, aura) => sum + (aura.kind === 'buff_rage_gen' ? aura.value : 0),
                0,
              )
            : 1;
        p.resource = Math.min(p.maxResource, p.resource + Math.round(eff.amount * rageMult));
        break;
      }
      case 'selfDamagePctMax': {
        const dmg = Math.round(p.maxHp * eff.pct);
        p.hp = Math.max(1, p.hp - dmg);
        ctx.emit({
          type: 'damage',
          sourceId: p.id,
          targetId: p.id,
          amount: dmg,
          crit: false,
          school: 'physical',
          ability: ability.name,
          kind: 'hit',
        });
        break;
      }
      case 'selfHealPctMax': {
        const healed = Math.min(Math.round(p.maxHp * eff.pct), p.maxHp - p.hp);
        if (healed > 0) {
          p.hp += healed;
          ctx.emit({
            type: 'heal2',
            sourceId: p.id,
            targetId: p.id,
            amount: healed,
            crit: false,
            ability: ability.name,
          });
          ctx.healingThreat(p, p, healed);
        }
        break;
      }
      case 'charge': {
        if (!target) break;
        // the stun effect in the same ability lands this tick; the player
        // then runs the route at charge speed instead of teleporting
        p.chargeTargetId = target.id;
        p.chargeTimeLeft = CHARGE_MAX_DURATION;
        p.chargePath = ctx.findChargePath(p, target);
        if (p.resourceType === 'rage') {
          const rageMult =
            1 +
            p.auras.reduce(
              (sum, aura) => sum + (aura.kind === 'buff_rage_gen' ? aura.value : 0),
              0,
            );
          p.resource = Math.min(p.maxResource, p.resource + Math.round(9 * rageMult));
        }
        ctx.enterCombat(p, target);
        break;
      }
      // The Vale Cup sport moves (docs/prd/vale-cup.md). All three route to the
      // vale_cup module through the seam and silently no-op unless the caster
      // is seated in the live Sowfield match's play phase.
      case 'ballKick': {
        ctx.vcupBallKick(p, eff.power, eff.loft, ability.range);
        break;
      }
      case 'ballPass': {
        ctx.vcupBallPass(p, eff.power, eff.loft, ability.range);
        break;
      }
      case 'ballShoot': {
        ctx.vcupShoot(p, eff.power, eff.loft, ability.range);
        break;
      }
      case 'sportDash': {
        ctx.vcupSportDash(p, eff.distance, eff.catchBall === true);
        break;
      }
      case 'sportShove': {
        if (!target || target.dead) break;
        ctx.vcupSportShove(p, target, eff.distance);
        break;
      }
      case 'sunder': {
        if (!target || target.dead) break;
        // a sunder can miss like any melee attack — a miss causes no threat
        if (ctx.rng.chance(meleeMissChance(p.level, target.level))) {
          ctx.emit({
            type: 'damage',
            sourceId: p.id,
            targetId: target.id,
            amount: 0,
            crit: false,
            school: 'physical',
            ability: ability.name,
            kind: 'miss',
          });
          ctx.enterCombat(p, target);
          break;
        }
        // Expose Armor (`full`) lands all stacks at once; warrior Sunder adds one.
        const existing = target.auras.find((a) => a.kind === 'sunder');
        if (existing) {
          existing.stacks = eff.full
            ? eff.maxStacks
            : Math.min(eff.maxStacks, (existing.stacks ?? 1) + 1);
          existing.value = eff.armor;
          existing.remaining = existing.duration;
          ctx.emit({ type: 'aura', targetId: target.id, name: ability.name, gained: true });
        } else {
          ctx.applyAura(target, {
            id: ability.id,
            name: ability.name,
            kind: 'sunder',
            remaining: 30,
            duration: 30,
            value: eff.armor,
            stacks: eff.full ? eff.maxStacks : 1,
            sourceId: p.id,
            school: 'physical',
          });
        }
        // sunder deals no damage: its threat is the flat value, stance-scaled
        addThreat(target, p.id, res.threatFlat * ctx.threatMod(p, 'physical'));
        ctx.enterCombat(p, target);
        break;
      }
      case 'taunt': {
        if (target?.kind !== 'mob' || target.dead) break;
        ctx.applyTaunt(p, target);
        break;
      }
      case 'tamePet': {
        if (target) ctx.completeTame(p, target);
        break;
      }
      case 'summonPet': {
        ctx.summonPet(p, eff.templateId);
        break;
      }
      case 'dismissPet': {
        const pet = ctx.petOf(p.id);
        if (!pet) {
          ctx.error(
            p.id,
            isDelvePos(p.pos.x) ? 'Pets are not allowed inside the delves.' : 'You have no pet.',
          );
          break;
        }
        ctx.error(p.id, 'Permanent pets can only be abandoned from the pet frame.');
        break;
      }
      case 'summonDemon': {
        ctx.summonPet(p, eff.mobId);
        break;
      }
    }
    if (target?.dead) target = null;
  }

  if (spentSureCrit) consumeSureCritCharge(ctx, p);
  if (spentAreaEcho) consumeAreaEchoCharge(ctx, p);

  if (ability.spendsCombo && spentCombo > 0) {
    p.comboPoints = 0;
    ctx.emit({ type: 'comboPoint', points: 0, pid: p.id });
  }
}
