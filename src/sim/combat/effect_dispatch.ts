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
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../mob/healer_channel';
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
import {
  angleTo,
  armorReduction,
  DT,
  ENRAGE_DMG_DONE,
  FISHING_CAST_ID,
  MELEE_ARC,
  MELEE_CLASSES,
  meleeMissChance,
  normAngle,
  rageGenAuraMult,
} from '../types';
import {
  abilityQualifiesForAreaEcho,
  consumeAreaEchoCharge,
  echoAreaDamage,
  hasAreaEchoAura,
  hasSweepingStrikes,
  sweepStrikeDamage,
} from './area_echo';
import { isFrozenForIcefall, isRootedOrChilled } from './cc';
import { extendOwnedDot, refreshOwnedDot, spreadOwnedDot } from './dot_mutation';
import { consumeAuraKind, consumeNextAttackCrit } from './empower_next';
import { runWeaponProcs } from './equip_procs';
import { exclusiveAuraConflicts } from './exclusive_aura';
import { maybeFulminationOverload } from './fulmination';
import { armHeroicLeap, relocateSwept } from './heroic_leap';
import { hasCastShield, noteSpellHit, spellDamageMultFromAuras } from './spell_combat';
import { consumeSureCritCharge, hasSureCritAura } from './sure_crit';

export { SWEEP_MULT } from './area_echo';

const CHARGE_MAX_DURATION = 3; // seconds before a blocked charge gives up

function isStealthToggle(ability: AbilityDef): boolean {
  return ability.effects.some((e) => e.type === 'selfBuff' && e.kind === 'stealth');
}

function preservesStealth(ability: AbilityDef): boolean {
  // Sap is the classic no-reveal opener: it incapacitates from range without a
  // melee swing, so unlike Cheap Shot/Ambush/Garrote it must not blow the
  // caster's own stealth (issue #1890).
  return isStealthToggle(ability) || ability.id === 'sprint' || ability.id === 'sap';
}

function removeRootAuras(ctx: SimContext, entity: Entity): void {
  for (let index = entity.auras.length - 1; index >= 0; index--) {
    const aura = entity.auras[index];
    if (aura.kind !== 'root') continue;
    entity.auras.splice(index, 1);
    ctx.emit({ type: 'aura', targetId: entity.id, name: aura.name, gained: false });
  }
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

function warriorAbilityRageMult(ctx: SimContext, player: Entity, meta: PlayerMeta): number {
  if (meta.cls !== 'warrior' || player.resourceType !== 'rage') return 1;
  return (1 + ctx.playerMods(meta).global.abilityRagePct) * rageGenAuraMult(player);
}

export function runEffects(
  ctx: SimContext,
  p: Entity,
  meta: PlayerMeta,
  target: Entity | null,
  res: ResolvedAbility,
  attackAnimationStarted = false,
): void {
  const ability = res.def;
  const isSpell = ability.school !== 'physical';
  const mods = ctx.playerMods(meta);
  const spentCombo = ability.spendsCombo ? p.comboPoints : 0;
  let comboAwarded = false;
  const sureCrit = hasSureCritAura(p);
  let sureCritRolled = false;
  const echoEligible = abilityQualifiesForAreaEcho(res.effects);
  const areaEcho = echoEligible && hasAreaEchoAura(p);
  const sweeping = echoEligible && hasSweepingStrikes(p);
  let areaEchoDealt = false;
  // Dynamic DoT riders snapshot a fraction of the preceding resolved direct
  // hit, including its scaling and critical multiplier.
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
      recalcPlayerStats(p, meta.cls, meta.equipment, ctx.playerMods(meta), meta.equipmentInstance);
    }
  }
  const threatOpts = { flat: res.threatFlat, mult: res.threatMult };

  if (
    ability.id === 'red_harvest' &&
    meta.known.some((known) => known.def.passive && known.def.id === 'cleaving_blows')
  ) {
    const chargeState = p.charges?.get('raging_gale');
    if (chargeState && chargeState.spent > 0) {
      chargeState.spent -= 1;
      if (chargeState.spent === 0) p.cooldowns.delete('raging_gale');
    }
  }

  if (ctx.playerMods(meta).global.battleRhythm > 0) {
    meta.abilityRhythm = (meta.abilityRhythm + 1) % 3;
    if (meta.abilityRhythm === 0) {
      const blink = {
        remaining: DT,
        duration: DT,
        sourceId: p.id,
        school: ability.school,
      };
      ctx.applyAura(p, {
        id: 'battle_rhythm',
        name: 'Battle Rhythm',
        kind: 'buff_dmg_done',
        value: 0.05,
        ...blink,
      });
      ctx.applyAura(p, {
        id: 'battle_rhythm_rage',
        name: 'Battle Rhythm',
        kind: 'buff_rage_gen',
        value: 0.2,
        ...blink,
      });
    }
  }

  if (ability.requiresAuraKind) consumeAuraKind(ctx, p, ability.requiresAuraKind);

  for (const eff of res.effects) {
    switch (eff.type) {
      case 'weaponStrike': {
        if (!target) break;
        const strikeTarget = target;
        let weaponMult = eff.weaponMult ?? 1;
        let bonus = eff.bonus;
        if (ability.id === 'mortal_strike') {
          const chargeIndex = p.auras.findIndex((aura) => aura.kind === 'overpower_charge');
          if (chargeIndex >= 0) {
            const charge = p.auras[chargeIndex];
            weaponMult *= 1 + charge.value * (charge.stacks ?? 1);
            p.auras.splice(chargeIndex, 1);
            ctx.emit({ type: 'aura', targetId: p.id, name: charge.name, gained: false });
          }
        }
        if (
          ability.id === 'raging_gale' &&
          p.auras.some((aura) => aura.kind === 'enrage') &&
          meta.known.some((known) => known.def.passive && known.def.id === 'diabolical_twinstrike')
        ) {
          weaponMult *= 1.15;
          bonus = Math.round(bonus * 1.15);
        }
        const hit = ctx.meleeSwing(p, target, bonus, ability.name, {
          cannotBeDodged: eff.cannotBeDodged,
          weaponMult,
          threatFlat: res.threatFlat,
          threatMult: res.threatMult,
          forceCrit: sureCrit,
          onDealt:
            areaEcho || sweeping
              ? (amount) => {
                  if (areaEcho) {
                    areaEchoDealt = true;
                    echoAreaDamage(
                      ctx,
                      p,
                      strikeTarget,
                      amount,
                      ability.school,
                      ability.name,
                      threatOpts,
                    );
                  }
                  if (sweeping)
                    sweepStrikeDamage(
                      ctx,
                      p,
                      strikeTarget,
                      amount,
                      ability.school,
                      ability.name,
                      threatOpts,
                    );
                }
              : undefined,
        });
        if (hit && sureCrit) sureCritRolled = true;
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
        let stackMultiplier = 1;
        if (eff.consumeAuraStacks) {
          const auraIndex = p.auras.findIndex(
            (aura) =>
              aura.id === eff.consumeAuraStacks?.auraId &&
              aura.sourceId === p.id &&
              (aura.stacks ?? 0) > 0,
          );
          if (auraIndex < 0) break;
          const aura = p.auras[auraIndex];
          stackMultiplier = Math.min(eff.consumeAuraStacks.maxStacks, aura.stacks ?? 0);
          p.auras.splice(auraIndex, 1);
          ctx.emit({ type: 'aura', targetId: p.id, name: aura.name, gained: false });
        }
        const rooted = isRootedOrChilled(target);
        const frozenAuraIndex = eff.consumeAuraAsFrozen
          ? p.auras.findIndex(
              (aura) => aura.id === eff.consumeAuraAsFrozen && aura.sourceId === p.id,
            )
          : -1;
        const critChance =
          isSpell && rooted
            ? ctx.spellCrit(p) + ctx.playerMods(meta).global.critVsRooted
            : isSpell
              ? ctx.spellCrit(p)
              : p.critChance;
        let dmg = (eff.fixedNoCrit ? eff.min : ctx.rng.range(eff.min, eff.max)) * stackMultiplier;
        // The flat rider scales with the school's rating: Spell Power for spells,
        // Ranged AP for hunter shots, melee Attack Power for physical specials.
        // abilityScalingPower picks the rating; powerScale (inside directHitBonus)
        // applies the AP scale-down. A non-scaling effect just contributes 0.
        // fixedNoCrit means FIXED damage by design: just as it skips the
        // damage-roll and crit draws, it excludes the power rider, so the
        // tooltip's authored number is the real per-hit amount regardless of
        // gear (Icefall: exactly 8 per icicle, 20 shattered). directHitBonus is
        // a pure computation (no rng), so gating it changes no draw order.
        if (!eff.fixedNoCrit) {
          dmg += directHitBonus(abilityScalingPower(p, ability), ability, res.castTime);
        }
        if (eff.vsRootedMult !== undefined && rooted) dmg *= eff.vsRootedMult;
        if (
          eff.vsFrozenMult !== undefined &&
          (isFrozenForIcefall(target) || frozenAuraIndex >= 0)
        ) {
          dmg *= eff.vsFrozenMult;
        }
        if (frozenAuraIndex >= 0) {
          const [aura] = p.auras.splice(frozenAuraIndex, 1);
          ctx.emit({ type: 'aura', targetId: p.id, name: aura.name, gained: false });
        }
        const abilityMod = mods.abilities[ability.id];
        const vsDotted = abilityMod?.dmgPctVsDotted ?? 0;
        const requiredDot = abilityMod?.dmgPctVsDottedAbility;
        if (
          vsDotted > 0 &&
          target.auras.some(
            (aura) =>
              aura.kind === 'dot' &&
              aura.sourceId === p.id &&
              (requiredDot === undefined || aura.id === requiredDot),
          )
        ) {
          dmg *= 1 + vsDotted;
        }
        const crit =
          !eff.fixedNoCrit &&
          (ctx.rng.chance(consumeNextAttackCrit(ctx, p) ? 1 : critChance) || sureCrit);
        if (!eff.fixedNoCrit && sureCrit) sureCritRolled = true;
        if (crit) dmg *= (isSpell ? 1.5 : 2) + (isSpell ? p.critDmgSpellBonus : p.critDmgPhysBonus);
        if (isSpell) dmg *= spellDamageMultFromAuras(p);
        if (!isSpell) dmg *= 1 - armorReduction(ctx.effectiveArmor(target), p.level);
        const finalDamage = Math.round(dmg);
        lastDirectDamage = finalDamage;
        const targetHpBefore = target.hp;
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
          attackAnimationStarted,
          false,
          ability.id,
        );
        if (isSpell && target.hp < targetHpBefore) {
          maybeFulminationOverload(
            ctx,
            p,
            target,
            ability.id,
            ability.name,
            ability.school,
            finalDamage,
          );
        }
        if (areaEcho) {
          areaEchoDealt = true;
          echoAreaDamage(ctx, p, target, finalDamage, ability.school, ability.name, threatOpts);
        }
        if (sweeping)
          sweepStrikeDamage(ctx, p, target, finalDamage, ability.school, ability.name, threatOpts);
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
      case 'consumeAuraChargesDamage': {
        if (!target || !ctx.isHostileTo(p, target)) break;
        const auraIndex = p.auras.findIndex(
          (aura) => aura.id === eff.auraId && aura.sourceId === p.id && (aura.charges ?? 0) > 0,
        );
        if (auraIndex < 0) break;
        const aura = p.auras[auraIndex];
        const charges = aura.charges ?? 0;
        p.auras.splice(auraIndex, 1);
        ctx.emit({ type: 'aura', targetId: p.id, name: aura.name, gained: false });
        const dischargeTargets = [target];
        if (eff.radius !== undefined) {
          ctx.emit({
            type: 'spellfxAt',
            x: target.pos.x,
            z: target.pos.z,
            school: ability.school,
            fx: 'nova',
            radius: eff.radius,
          });
          for (const nearby of ctx.hostilesInRadius(p, target.pos, eff.radius)) {
            if (nearby.id === target.id || !ctx.hasLineOfSight(target, nearby)) continue;
            dischargeTargets.push(nearby);
          }
        }
        for (const dischargeTarget of dischargeTargets) {
          if (!ctx.isHostileTo(p, dischargeTarget)) continue;
          ctx.dealDamage(
            p,
            dischargeTarget,
            charges * eff.damagePerCharge,
            false,
            ability.school,
            ability.name,
            'hit',
            false,
            threatOpts,
            true,
            dischargeTarget.id === target.id && attackAnimationStarted,
            false,
            ability.id,
          );
        }
        break;
      }
      case 'finisherDamage': {
        if (!target || spentCombo <= 0) break;
        let dmg =
          eff.base +
          eff.perCombo * spentCombo +
          ctx.rng.range(0, eff.variance) +
          ctx.effectiveAttackPower(p) / 14;
        const crit = ctx.rng.chance(consumeNextAttackCrit(ctx, p) ? 1 : p.critChance) || sureCrit;
        if (sureCrit) sureCritRolled = true;
        if (crit) dmg *= 2 + p.critDmgPhysBonus;
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
          true,
          attackAnimationStarted,
          false,
          ability.id,
        );
        break;
      }
      case 'enrageChance': {
        // Guaranteed Enrage consumes no RNG; probabilistic Bloodletting draws
        // exactly once at the authored chance.
        if (eff.chance < 1 && !ctx.rng.chance(eff.chance)) break;
        ctx.applyAura(p, {
          id: 'fury_enrage',
          name: 'Enraged',
          kind: 'enrage',
          remaining: eff.duration,
          duration: eff.duration,
          value: ENRAGE_DMG_DONE,
          sourceId: p.id,
          school: 'physical',
        });
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
          (effect) => effect.type === 'selfBuff' && effect.kind === 'stasis',
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
        const crit =
          ctx.rng.chance(consumeNextAttackCrit(ctx, p) ? 1 : ctx.spellCrit(p)) || sureCrit;
        if (sureCrit) sureCritRolled = true;
        if (crit) dmg *= 1.5 + p.critDmgSpellBonus;
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
          attackAnimationStarted,
          false,
          ability.id,
        );
        noteSpellHit(ctx, p, crit);
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
        // A scripted mob channel (Malric's Mending) resolves to no ability def but
        // is still meant to be interruptible: a matching school-lockout breaks it in
        // updateBossMechanics. Everything else that resolves to nothing stays immune.
        const scriptedChannel = interruptedDef
          ? undefined
          : SCRIPTED_INTERRUPTIBLE_CHANNELS[target.castingAbility];
        if (
          (!interruptedDef && !scriptedChannel) ||
          interruptedDef?.school === 'physical' ||
          interruptedDef?.uninterruptible
        )
          break;
        const school = interruptedDef?.school ?? scriptedChannel!.school;
        const remaining = ctx.diminishedCrowdControlDuration(p, target, 'lockout', eff.lockout);
        ctx.cancelCast(target);
        if (eff.rageOnInterrupt && meta.cls === 'warrior' && p.resourceType === 'rage') {
          p.resource = Math.min(
            p.maxResource,
            p.resource + eff.rageOnInterrupt * warriorAbilityRageMult(ctx, p, meta),
          );
        }
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
        const offensive = ctx.isHostileTo(p, target);
        let dispelled = 0;
        for (let index = target.auras.length - 1; index >= 0 && dispelled < eff.count; index--) {
          const aura = target.auras[index];
          if (aura.school === 'physical') continue;
          const harmful = isDebuffAura(aura.kind, aura.value);
          if (offensive ? harmful : !harmful) continue;
          // Non-player stat auras are folded directly into the entity on apply;
          // removing one early must reverse that fold just as natural expiry does.
          ctx.applyNonPlayerStatAura(target, aura, -1);
          target.auras.splice(index, 1);
          ctx.emit({ type: 'aura', targetId: target.id, name: aura.name, gained: false });
          if (eff.steal && offensive) {
            ctx.applyAura(p, { ...aura, sourceId: p.id });
          }
          dispelled++;
        }
        if (dispelled > 0 && target.kind === 'player') {
          const targetMeta = ctx.players.get(target.id);
          if (targetMeta) {
            recalcPlayerStats(
              target,
              targetMeta.cls,
              targetMeta.equipment,
              ctx.playerMods(targetMeta),
              targetMeta.equipmentInstance,
            );
          }
        }
        break;
      }
      case 'silence': {
        if (!target || target.dead) break;
        const duration = ctx.diminishedCrowdControlDuration(p, target, 'lockout', eff.duration);
        if (duration === null) break;
        ctx.applyAura(target, {
          id: `${ability.id}_silence`,
          name: ability.name,
          kind: 'silence',
          remaining: duration,
          duration,
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
        const fearBreakPct = mods.global.fearBreakPct;
        let feared = 0;
        for (const hostile of ctx.hostilesInRadius(p, p.pos, eff.radius)) {
          if (hostile.dead) continue;
          if (eff.maxTargets !== undefined && feared >= eff.maxTargets) break;
          if (!ctx.hasLineOfSight(p, hostile)) continue;
          const duration = ctx.diminishedCrowdControlDuration(p, hostile, 'fear', eff.duration);
          if (duration === null) continue;
          feared++;
          ctx.applyAura(hostile, {
            id: 'fear_incap',
            name: ability.name,
            kind: 'incapacitate',
            remaining: duration,
            duration,
            value: ctx.rng.range(-Math.PI, Math.PI),
            sourceId: p.id,
            school: ability.school,
            breaksOnDamage: true,
            breakThreshold:
              fearBreakPct > 0 ? Math.max(1, Math.round(hostile.maxHp * fearBreakPct)) : undefined,
          });
          ctx.enterCombat(p, hostile);
          if (hostile.kind === 'mob' && hostile.hostile) {
            addThreat(hostile, p.id, 10 * ctx.threatMod(p, ability.school));
          }
        }
        break;
      }
      case 'clearCooldowns': {
        for (const abilityId of eff.abilities) {
          p.cooldowns.delete(abilityId);
          p.charges?.delete(abilityId);
        }
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
          school: 'shadow',
          ability: ability.name,
          kind: 'hit',
        });
        p.resource = Math.min(p.maxResource, p.resource + eff.mana);
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
      case 'debuffTargetSource': {
        if (!target || target.dead) break;
        ctx.applyAura(target, {
          id: eff.auraId,
          name: eff.auraName,
          kind: eff.kind,
          remaining: eff.duration,
          duration: eff.duration,
          value: eff.value,
          sourceId: p.id,
          school: ability.school,
        });
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
        const dotId = eff.auraId ?? ability.id;
        ctx.applyAura(target, {
          id: dotId,
          name: ABILITIES[dotId]?.name ?? ability.name,
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
      case 'extendDot': {
        if (!target) break;
        extendOwnedDot(target, p.id, eff.dot, eff.seconds, eff.maxBonus);
        break;
      }
      case 'refreshDot': {
        if (!target) break;
        refreshOwnedDot(target, p.id, eff.dot);
        break;
      }
      case 'spreadDot': {
        if (!target) break;
        spreadOwnedDot(ctx, p, target, eff.dot, eff.radius);
        break;
      }
      case 'consumeDot': {
        if (!target) break;
        const dotIndex = target.auras.findIndex(
          (aura) => aura.kind === 'dot' && aura.id === eff.dot && aura.sourceId === p.id,
        );
        if (dotIndex < 0) break;
        const dot = target.auras[dotIndex];
        const interval = dot.tickInterval ?? 1;
        const untilNextTick = dot.tickTimer ?? interval;
        const ticksLeft =
          untilNextTick <= dot.remaining
            ? 1 + Math.max(0, Math.floor((dot.remaining - untilNextTick) / interval))
            : 0;
        const remainingDamage = Math.round(dot.value * ticksLeft);
        target.auras.splice(dotIndex, 1);
        ctx.emit({ type: 'aura', targetId: target.id, name: dot.name, gained: false });
        ctx.emit({
          type: 'spellfx',
          sourceId: p.id,
          targetId: target.id,
          school: dot.school,
          fx: 'detonate',
        });
        if (remainingDamage > 0) {
          ctx.dealDamage(
            p,
            target,
            remainingDamage,
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
        const targets: Entity[] = [];
        for (const m of ctx.hostilesInRadius(p, aoeCenter, eff.radius)) {
          if (!ctx.hasLineOfSight(p, m)) continue;
          if (eff.frontal) {
            const facingDiff = Math.abs(normAngle(angleTo(p.pos, m.pos) - p.facing));
            if (facingDiff > MELEE_ARC) continue;
          }
          targets.push(m);
        }
        const capScale =
          eff.softCap && targets.length > eff.softCap ? eff.softCap / targets.length : 1;
        for (const m of targets) {
          let dmg = ctx.rng.range(eff.min, eff.max) + aoeSpBonus;
          if (isSpell) dmg *= spellDamageMultFromAuras(p);
          // Armor only mitigates physical damage, mirroring the single-target
          // path above — spell-school AoE (Arcane Explosion, Consecration) is
          // not reduced by the target's armor.
          if (!isSpell) dmg *= 1 - armorReduction(ctx.effectiveArmor(m), p.level);
          dmg *= capScale;
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
            true,
            attackAnimationStarted,
            false,
            ability.id,
          );
          if (eff.stunSec !== undefined && !m.dead) {
            const duration = ctx.diminishedCrowdControlDuration(
              p,
              m,
              stunDrCategory(ability.id),
              eff.stunSec,
            );
            if (duration !== null) {
              ctx.applyAura(m, {
                id: `${ability.id}_stun`,
                name: ability.name,
                kind: 'stun',
                remaining: duration,
                duration,
                value: 0,
                sourceId: p.id,
                school: ability.school,
              });
            }
          }
        }
        if (eff.rageOnHit && meta.cls === 'warrior' && p.resourceType === 'rage') {
          const hitCount = Math.min(targets.length, eff.rageOnHit.capTargets);
          const amount =
            (eff.rageOnHit.base + eff.rageOnHit.perTarget * hitCount) *
            warriorAbilityRageMult(ctx, p, meta);
          p.resource = Math.min(p.maxResource, p.resource + amount);
        }
        break;
      }
      case 'chainDamage': {
        // Evolved signature chains pair this with directDamage and begin at the first
        // bounce. Authored chains with hitsPrimary own hop zero themselves. Either way,
        // hop selection is deterministic (nearest squared distance, then lowest id) and
        // the chain uses one shared damage roll without additional RNG draws.
        const origin = target ?? p;
        const chainSpBonus = directHitBonus(
          abilityScalingPower(p, ability),
          ability,
          res.castTime,
          true,
        );
        const baseAmount = ctx.rng.range(eff.min, eff.max) + chainSpBonus;
        const hitsPrimary = eff.hitsPrimary === true && target !== null;
        const hitList: Entity[] = hitsPrimary && target ? [target] : [];
        const excluded = new Set<number>([p.id]);
        if (target) excluded.add(target.id);
        let from: Entity = origin;
        const totalHits = eff.jumps + (hitsPrimary ? 1 : 0);
        while (hitList.length < totalHits) {
          let best: Entity | null = null;
          let bestD2 = Number.POSITIVE_INFINITY;
          for (const m of ctx.hostilesInRadius(p, from.pos, eff.radius)) {
            // LoS is checked from the PREVIOUS hop, not the caster: the bolt arcs
            // enemy-to-enemy, so a wall between the caster and a bounce target must
            // not block a hop the arc itself has clear line to.
            if (excluded.has(m.id) || !ctx.hasLineOfSight(from, m)) continue;
            const dx = m.pos.x - from.pos.x;
            const dz = m.pos.z - from.pos.z;
            const d2 = dx * dx + dz * dz;
            if (best === null || d2 < bestD2 || (d2 === bestD2 && m.id < best.id)) {
              best = m;
              bestD2 = d2;
            }
          }
          if (best === null) break;
          excluded.add(best.id);
          hitList.push(best);
          from = best;
        }
        for (let i = 0; i < hitList.length; i++) {
          const m = hitList[i];
          ctx.emit({
            type: 'spellfx',
            sourceId: i === 0 ? (hitsPrimary ? p.id : origin.id) : hitList[i - 1].id,
            targetId: m.id,
            school: ability.school,
            fx: 'projectile',
          });
          let dmg = baseAmount * eff.falloff ** i;
          if (isSpell) dmg *= spellDamageMultFromAuras(p);
          else dmg *= 1 - armorReduction(ctx.effectiveArmor(m), p.level);
          ctx.dealDamage(
            p,
            m,
            Math.max(1, Math.round(dmg)),
            false,
            ability.school,
            ability.name,
            'hit',
            false,
            threatOpts,
            true,
            false,
            false,
            ability.id,
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
          ctx.applyAura(
            m,
            eff.pct === undefined
              ? {
                  id: `${ability.id}_ap`,
                  name: ability.name,
                  kind: 'debuff_ap',
                  remaining: eff.duration,
                  duration: eff.duration,
                  value: eff.amount,
                  sourceId: p.id,
                  school: ability.school,
                }
              : {
                  id: `${ability.id}_ap`,
                  name: ability.name,
                  kind: 'buff_dmg_done',
                  remaining: eff.duration,
                  duration: eff.duration,
                  value: -eff.pct,
                  sourceId: p.id,
                  school: ability.school,
                },
          );
          ctx.enterCombat(p, m);
          if (m.kind === 'mob' && m.hostile)
            addThreat(m, p.id, 10 * ctx.threatMod(p, ability.school));
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
        for (const hostile of ctx.hostilesInRadius(p, p.pos, eff.radius)) {
          if (hostile.dead || !ctx.hasLineOfSight(p, hostile)) continue;
          ctx.applyAura(hostile, {
            id: `${ability.id}_slow`,
            name: ability.name,
            kind: 'slow',
            remaining: eff.duration,
            duration: eff.duration,
            value: eff.mult,
            sourceId: p.id,
            school: ability.school,
          });
          ctx.enterCombat(p, hostile);
          if (hostile.kind === 'mob' && hostile.hostile)
            addThreat(hostile, p.id, 10 * ctx.threatMod(p, ability.school));
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
                targetMeta.equipmentInstance,
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
      case 'aoeAllySureCrit': {
        for (const friendly of friendliesInRadius(ctx, p, eff.radius)) {
          ctx.applyAura(friendly, {
            id: `${ability.id}_crit`,
            name: 'Emboldened',
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
      case 'aoeKnockback': {
        ctx.emit({
          type: 'spellfx',
          sourceId: p.id,
          targetId: p.id,
          school: ability.school,
          fx: 'nova',
        });
        // Materialize before movement so displacement cannot perturb iteration.
        for (const hostile of [...ctx.hostilesInRadius(p, p.pos, eff.radius)]) {
          if (!ctx.hasLineOfSight(p, hostile)) continue;
          ctx.applyKnockback(p, hostile, eff.distance);
          ctx.applyAura(hostile, {
            id: `${ability.id}_daze`,
            name: ability.name,
            kind: 'slow',
            remaining: eff.dazeDuration,
            duration: eff.dazeDuration,
            value: eff.dazeMult,
            sourceId: p.id,
            school: ability.school,
          });
          ctx.enterCombat(p, hostile);
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
        // Control-only roots (for example Frost Trap) must not turn spell power
        // into an implicit damage packet or consume a combat RNG draw. Authored
        // damaging roots such as Frost Nova retain their normal scaling path.
        const dealsDamage = eff.min !== 0 || eff.max !== 0;
        const aoeRootSp = dealsDamage
          ? directHitBonus(abilityScalingPower(p, ability), ability, res.castTime, true)
          : 0;
        for (const m of ctx.hostilesInRadius(p, center, eff.radius)) {
          if (!ctx.hasLineOfSight(p, m)) continue;
          if (dealsDamage) {
            const dmg = ctx.rng.range(eff.min, eff.max) + aoeRootSp;
            ctx.dealDamage(
              p,
              m,
              Math.round(dmg),
              false,
              ability.school,
              ability.name,
              'hit',
              false,
              undefined,
              true,
              attackAnimationStarted,
              false,
              ability.id,
            );
          }
          if (!m.dead && ctx.isHostileTo(p, m)) {
            if (eff.stun) {
              const duration = ctx.diminishedCrowdControlDuration(
                p,
                m,
                'controlledStun',
                eff.duration,
              );
              if (duration !== null) {
                ctx.applyAura(m, {
                  id: `${ability.id}_freeze`,
                  name: ability.name,
                  kind: 'stun',
                  remaining: duration,
                  duration,
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
          const crit =
            ctx.rng.chance(consumeNextAttackCrit(ctx, p) ? 1 : ctx.spellCrit(p)) || sureCrit;
          if (sureCrit) sureCritRolled = true;
          if (crit)
            dmg *= (isSpell ? 1.5 : 2) + (isSpell ? p.critDmgSpellBonus : p.critDmgPhysBonus);
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
            false,
            false,
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
      case 'breakControl': {
        for (let i = p.auras.length - 1; i >= 0; i--) {
          const aura = p.auras[i];
          if (
            ctx.isControlAura(aura.kind) ||
            aura.kind === 'silence' ||
            aura.kind === 'blind' ||
            aura.kind === 'disarm' ||
            aura.kind === 'slow'
          ) {
            p.auras.splice(i, 1);
            ctx.emit({ type: 'aura', targetId: p.id, name: aura.name, gained: false });
          }
        }
        break;
      }
      case 'repositionToAim': {
        if (!eff.landingAoe) break;
        armHeroicLeap(ctx, p, p.castAim ?? p.pos, eff.landingAoe, ability);
        break;
      }
      case 'blinkForward': {
        if (eff.breakRoots) removeRootAuras(ctx, p);
        let distance = eff.distance;
        let facing = p.facing;
        if (ability.id === 'shadowstep' && target && !target.dead) {
          const dx = target.pos.x - p.pos.x;
          const dz = target.pos.z - p.pos.z;
          const toTarget = Math.hypot(dx, dz);
          if (toTarget <= 1.5) break;
          facing = Math.atan2(dx, dz);
          p.facing = facing;
          distance = Math.min(toTarget - 1.5, eff.distance);
        }
        relocateSwept(ctx, p, {
          x: p.pos.x + Math.sin(facing) * distance,
          y: p.pos.y,
          z: p.pos.z + Math.cos(facing) * distance,
        });
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
            recalcPlayerStats(
              p,
              meta.cls,
              meta.equipment,
              ctx.playerMods(meta),
              meta.equipmentInstance,
            );
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
        if (eff.kind === 'overpower_charge') {
          const existing = p.auras.find((aura) => aura.kind === 'overpower_charge');
          if (existing) {
            existing.stacks = Math.min(2, (existing.stacks ?? 1) + 1);
            existing.remaining = eff.duration;
            existing.duration = eff.duration;
            break;
          }
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
          id: eff.auraId ?? (isPrimarySelfBuff ? ability.id : `${ability.id}_${eff.kind}`),
          name: eff.auraName ?? ability.name,
          kind: eff.kind,
          remaining: eff.duration,
          duration: eff.duration,
          value: eff.value,
          stacks: eff.kind === 'overpower_charge' ? 1 : undefined,
          sourceId: p.id,
          school: ability.school,
          // charge-limited thorns (Lightning Shield): cap reflects and gate them
          // behind an internal cooldown. Absent on a plain always-on thorns coat.
          charges: eff.charges,
          icdMax: eff.internalCooldown,
        });
        recalcPlayerStats(
          p,
          meta.cls,
          meta.equipment,
          ctx.playerMods(meta),
          meta.equipmentInstance,
        );
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
        const amount =
          meta.cls === 'warrior' && p.resourceType === 'rage'
            ? eff.amount * warriorAbilityRageMult(ctx, p, meta)
            : eff.amount;
        p.resource = Math.min(p.maxResource, p.resource + amount);
        break;
      }
      case 'aoeAllyMaxHp': {
        const party = ctx.partyOf(p.id);
        const memberIds = party?.members ?? [p.id];
        const protection = ctx.playerMods(meta).spec === 'prot';
        for (const memberId of memberIds) {
          const member = ctx.entities.get(memberId);
          if (!member || member.dead) continue;
          const dx = member.pos.x - p.pos.x;
          const dz = member.pos.z - p.pos.z;
          if (member.id !== p.id && dx * dx + dz * dz > eff.radius * eff.radius) continue;
          ctx.applyAura(member, {
            id: `${ability.id}_hp`,
            name: ability.name,
            kind: 'buff_maxhp_pct',
            remaining: eff.duration,
            duration: eff.duration,
            value: eff.pct,
            sourceId: p.id,
            school: ability.school,
          });
          if (protection) {
            ctx.applyAura(member, {
              id: `${ability.id}_dr`,
              name: ability.name,
              kind: 'buff_dr',
              remaining: eff.duration,
              duration: eff.duration,
              value: 0.05,
              sourceId: p.id,
              school: ability.school,
            });
          }
          if (member.kind === 'player') {
            const memberMeta = ctx.players.get(member.id);
            if (memberMeta)
              recalcPlayerStats(
                member,
                memberMeta.cls,
                memberMeta.equipment,
                ctx.playerMods(memberMeta),
                memberMeta.equipmentInstance,
              );
          }
        }
        break;
      }
      case 'partyMeleeBuff': {
        const party = ctx.partyOf(p.id);
        const memberIds = party ? party.members : [p.id];
        for (const memberId of memberIds) {
          const memberMeta = ctx.players.get(memberId);
          const member = ctx.entities.get(memberId);
          if (!memberMeta || !member || member.dead || !MELEE_CLASSES.has(memberMeta.cls)) continue;
          ctx.applyAura(member, {
            id: ability.id,
            name: ability.name,
            kind: 'sanguine',
            remaining: eff.duration,
            duration: eff.duration,
            value: eff.attackSpeedMult,
            value2: eff.dmgPct,
            sourceId: p.id,
            school: ability.school,
          });
        }
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
        const pct = p.auras.some((a) => a.id === 'furious_mending')
          ? Math.max(eff.pct, 0.2)
          : eff.pct;
        ctx.applyHeal(p, p, Math.round(p.maxHp * pct), ability.name);
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
          const amount = meta.cls === 'warrior' ? 9 * warriorAbilityRageMult(ctx, p, meta) : 9;
          p.resource = Math.min(p.maxResource, p.resource + amount);
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
      case 'absorbSpentResource': {
        const amount = Math.round(res.cost * eff.mult);
        if (amount <= 0) break;
        ctx.applyAura(p, {
          id: ability.id,
          name: ability.name,
          kind: 'absorb',
          remaining: eff.duration,
          duration: eff.duration,
          value: amount,
          sourceId: p.id,
          school: ability.school,
        });
        break;
      }
      case 'taunt': {
        if (target?.kind !== 'mob' || target.dead) break;
        ctx.applyTaunt(p, target);
        break;
      }
      case 'aoeTaunt': {
        for (const hostile of ctx.hostilesInRadius(p, p.pos, eff.radius)) {
          if (hostile.kind === 'mob' && !hostile.dead) ctx.applyTaunt(p, hostile);
        }
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

  if (ability.spendsCombo && spentCombo > 0) {
    p.comboPoints = 0;
    ctx.emit({ type: 'comboPoint', points: 0, pid: p.id });
  }
  if (sureCritRolled) consumeSureCritCharge(ctx, p);
  if (areaEcho && areaEchoDealt) consumeAreaEchoCharge(ctx, p);
}
