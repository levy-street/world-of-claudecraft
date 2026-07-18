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
// swingMissChance, CHARGE_MAX_DURATION) are imported/inlined directly.
//
// `src/sim`-pure: no DOM/Three, no Math.random/Date.now; all randomness is the
// shared `ctx.rng` stream, drawn in the exact pre-move order.

import { isDebuffAura, isDispellableAura } from '../aura_classify';
import { ABILITIES, isDelvePos } from '../data';
import { logCascadeCast, recordCascadeInitial } from '../dev/cascade_playtest';
import { recalcPlayerStats } from '../entity';
import type { GroundAoE } from '../entity_roster';
import { SCRIPTED_INTERRUPTIBLE_CHANNELS } from '../mob/healer_channel';
import { scheduleProjectile } from '../projectile_travel';
import type { PlayerMeta, ResolvedAbility } from '../sim';
import type { SimContext } from '../sim_context';
import {
  abilityScalingPower,
  absorbBonus,
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
  normAngle,
  rageGenAuraMult,
  swingMissChance,
} from '../types';
import {
  abilityQualifiesForAreaEcho,
  consumeAreaEchoCharge,
  echoAreaDamage,
  hasAreaEchoAura,
  hasSweepingStrikes,
  sweepStrikeDamage,
} from './area_echo';
import {
  damageBreakThreshold,
  hasUnbreakableMovementLock,
  isRootedOrChilled,
  isUnbreakableControlAura,
} from './cc';
import {
  ARCANE_SURGE_ID,
  aetherSurgeAddStack,
  aetherSurgeDamageMult,
  applyPerfectMoment,
  placeGroupEcho,
  placeTemporalEcho,
  selectCascadeTargets,
} from './chronomancy';
import { extendOwnedDot } from './dot_mutation';
import { consumeAuraKind, consumeNextAttackCrit } from './empower_next';
import { runWeaponProcs } from './equip_procs';
import { exclusiveAuraConflicts } from './exclusive_aura';
import { fireGuaranteedCrit, personalBarrierIdForSpec } from './fire_mage';
import { isFormAuraKind, isTravelFormAuraKind } from './forms';
import {
  frostMageAfterCast,
  frostMageChannelStart,
  resolveFrozenCast,
  SHATTER_CRIT_BONUS,
} from './frost_mage';
import { spawnFrozenOrb } from './frozen_orb';
import { glacialFrontContains } from './glacial_front';
import { livingGroupRaidInRadius } from './group_targeting';
import { applyGroupHaste } from './haste_burst';
import { armHeroicLeap, relocateSwept } from './heroic_leap';
import { spawnHunterTrap } from './hunter_trap';
import { resurrectDeadGroupMembers } from './mass_resurrection';
import { offerResurrection } from './resurrection_offer';
import { applyRewind } from './rewind';
import { spawnRingOfFrost } from './ring_of_frost';
import { hasCastShield, noteSpellHit, spellDamageMultFromAuras } from './spell_combat';
import { consumeSureCritCharge, hasSureCritAura } from './sure_crit';
import { applyTemporalHourglass } from './temporal_hourglass';

export { SWEEP_MULT } from './area_echo';

const CHARGE_MAX_DURATION = 3; // seconds before a blocked charge gives up

// Fear-family break scaling (G5): a single hit for this fraction of the
// target's max health always breaks the fear; smaller hits break it with
// proportional probability (combat/damage.ts). Applies to the fear family
// only (aoeFear and fearDr incapacitates): plain incapacitates keep the
// classic break-on-any-damage rule.
export const FEAR_BREAK_CHANCE_SCALE = 0.1;

function isStealthToggle(ability: AbilityDef): boolean {
  return ability.effects.some((e) => e.type === 'selfBuff' && e.kind === 'stealth');
}

function preservesStealth(ability: AbilityDef): boolean {
  // Sap is the classic no-reveal opener: it incapacitates from range without a
  // melee swing, so unlike Cheap Shot/Ambush/Garrote it must not blow the
  // caster's own stealth (issue #1890). Shadeslip repositions without acting
  // on the target, so it keeps Duskveil too (balance pass, maintainer sheet).
  return (
    isStealthToggle(ability) ||
    ability.id === 'sprint' ||
    ability.id === 'sap' ||
    ability.id === 'shadowstep'
  );
}

// Resolve the exclusiveGroup for an AURA id: either a plain ability id (a
// selfBuff aura) or the `<abilityId>_ap` id the aoeAllyAttackPower case stamps
// (Iron Bellow's group shout), so a group buff and a self buff sharing one
// exclusiveGroup cancel each other (battle_shout vs commanding_shout). Ids
// whose base ability has no group (trueshot_aura_ap) resolve to undefined,
// exactly as before.
function exclusiveGroupOfAura(id: string): string | undefined {
  const direct = ABILITIES[id]?.exclusiveGroup;
  if (direct) return direct;
  return id.endsWith('_ap') ? ABILITIES[id.slice(0, -3)]?.exclusiveGroup : undefined;
}

function removeRootAuras(ctx: SimContext, entity: Entity): void {
  for (let index = entity.auras.length - 1; index >= 0; index--) {
    const aura = entity.auras[index];
    if (aura.kind !== 'root' || isUnbreakableControlAura(aura)) continue;
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
  // Frost mage (combat/frost_mage.ts): resolved ONCE per cast, so a multi-hit
  // cast shares one frozen resolution and spends at most one Fingers of Frost
  // stack / Winter's Chill charge. Inert (and free) for everyone who is not a
  // committed-frost mage. Deterministic, no rng.
  const frozen = resolveFrozenCast(ctx, p, meta, ability, target);
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

  // Cleaving Blows (Fury passive): Red Harvest refunds one stored Twinstrike
  // use on the abilityCharges recharge model. A partial refund leaves the
  // running recharge ticking for the next charge but re-opens the pool, so the
  // empty-pool cooldown mirror goes either way (see updateTimers).
  if (
    ability.id === 'red_harvest' &&
    meta.known.some((known) => known.def.passive && known.def.id === 'cleaving_blows')
  ) {
    const chargeState = p.abilityCharges?.raging_gale;
    if (chargeState && chargeState.charges < chargeState.maxCharges) {
      chargeState.charges += 1;
      // The refunded charge hands back its own per-charge timer (the newest =
      // the longest; recharges[] is kept sorted ascending). Leaving it behind
      // orphans a frozen timer on a full pool (the tick skips full pools),
      // which the next spend would stack beside and recharge early off.
      if (chargeState.recharges) {
        chargeState.recharges.pop();
        chargeState.recharge = chargeState.recharges[0] ?? 0;
      } else if (chargeState.charges >= chargeState.maxCharges) {
        // Legacy sequential save not yet converted to per-charge timers (the
        // first recharge tick does that): a full pool clears the lone timer,
        // a partial refund keeps it running, exactly the old model.
        chargeState.recharge = 0;
      }
      p.cooldowns.delete('raging_gale');
    }
  }

  if (ctx.playerMods(meta).global.battleRhythm > 0) {
    meta.abilityRhythm = (meta.abilityRhythm + 1) % 3;
    if (meta.abilityRhythm === 0) {
      ctx.applyAura(p, {
        id: 'battle_rhythm_rage',
        name: 'Battle Rhythm',
        kind: 'buff_rage_gen',
        value: 0.2,
        remaining: DT,
        duration: DT,
        sourceId: p.id,
        school: ability.school,
      });
    }
  }

  if (ability.requiresAuraKind) consumeAuraKind(ctx, p, ability.requiresAuraKind);

  for (const eff of res.effects) {
    switch (eff.type) {
      case 'temporalHourglass': {
        applyTemporalHourglass(ctx, p, p.castAim ?? p.pos, eff, ability.name);
        break;
      }
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
          // Ability-scoped crit talents (ResolvedAbilityMod.critPct, e.g. the
          // Redhanded Craven Thrust mastery) ride the shared hit table.
          critBonus: mods.abilities[ability.id]?.critPct ?? 0,
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
        const rooted = isRootedOrChilled(target);
        const abilityMod = mods.abilities[ability.id];
        const critChance =
          (isSpell && rooted
            ? ctx.spellCrit(p) + mods.global.critVsRooted
            : isSpell
              ? ctx.spellCrit(p)
              : p.critChance) +
          // Ability-scoped crit talents (ResolvedAbilityMod.critPct).
          (abilityMod?.critPct ?? 0) +
          // Shatter (combat/frost_mage.ts): bonus spell crit chance against a
          // target this cast treats as frozen. 0 for everyone else.
          (isSpell && frozen.treatAsFrozen ? SHATTER_CRIT_BONUS : 0);
        let dmg = ctx.rng.range(eff.min, eff.max);
        // The flat rider scales with the school's rating: Spell Power for spells,
        // Ranged AP for hunter shots, melee Attack Power for physical specials.
        // abilityScalingPower picks the rating; powerScale (inside directHitBonus)
        // applies the AP scale-down. A non-scaling effect just contributes 0.
        dmg += directHitBonus(abilityScalingPower(p, ability), ability, res.castTime);
        if (eff.vsRootedMult !== undefined && rooted) dmg *= eff.vsRootedMult;
        // Ice Lance against a frozen-counting target (combat/frost_mage.ts):
        // the per-cast resolution carries its 3x; 1 for every other cast.
        if (isSpell && frozen.treatAsFrozen) dmg *= frozen.damageMult;
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
          ctx.rng.chance(consumeNextAttackCrit(ctx, p) ? 1 : critChance) ||
          sureCrit ||
          // Fire spec (combat/fire_mage.ts): Combustion / Fire Blast / Scorch
          // execute override the OUTCOME; the roll above is still drawn.
          fireGuaranteedCrit(ctx, p, ability.id, ability.school, target);
        if (sureCrit) sureCritRolled = true;
        if (crit) dmg *= (isSpell ? 1.5 : 2) + (isSpell ? p.critDmgSpellBonus : p.critDmgPhysBonus);
        if (isSpell) dmg *= spellDamageMultFromAuras(p);
        if (!isSpell) dmg *= 1 - armorReduction(ctx.effectiveArmor(target), p.level);
        // Aether Surge (Chronomancy Phase 3): each held Arcane Charge scales the
        // FULL post-spell-power, post-crit damage. The extra damage is what feeds
        // more Temporal Echo healing (no hidden heal bonus). Deterministic; reads
        // the caster's charge aura (combat/chronomancy.ts).
        if (ability.id === ARCANE_SURGE_ID) dmg *= aetherSurgeDamageMult(p);
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
          attackAnimationStarted,
          false,
          ability.id,
        );
        if (areaEcho) {
          areaEchoDealt = true;
          echoAreaDamage(ctx, p, target, finalDamage, ability.school, ability.name, threatOpts);
        }
        if (sweeping)
          sweepStrikeDamage(ctx, p, target, finalDamage, ability.school, ability.name, threatOpts);
        // Power Echo (mage choice row): the armed echo repeats the SAME
        // resolved amount at its fraction on the same target (already rolled,
        // post crit; no new rng draw), consumed BEFORE the repeat so a copy
        // can never re-echo. Mirrors the Bladed Echo copy rule above.
        if (isSpell) {
          const echoIdx = p.auras.findIndex((a) => a.kind === 'power_echo');
          if (echoIdx >= 0) {
            const echoAura = p.auras[echoIdx];
            p.auras.splice(echoIdx, 1);
            ctx.emit({ type: 'aura', targetId: p.id, name: echoAura.name, gained: false });
            if (!target.dead) {
              // The echo is a REAL second projectile (owner playtest: the
              // instant copy looked superimposed): it visibly leaves the
              // caster when the first hit lands and deals the copied amount
              // on arrival, fizzling if the target dies in flight.
              const echoAmt = Math.max(1, Math.round(finalDamage * echoAura.value));
              ctx.emit({
                type: 'spellfx',
                sourceId: p.id,
                targetId: target.id,
                school: ability.school,
                fx: 'projectile',
              });
              scheduleProjectile(ctx, p, target, (src, tgt) => {
                ctx.dealDamage(
                  src,
                  tgt,
                  echoAmt,
                  crit,
                  ability.school,
                  ability.name,
                  'hit',
                  false,
                  threatOpts,
                );
              });
            }
          }
        }
        if (isSpell) noteSpellHit(ctx, p, crit, ability.id);
        // Aether Surge (Chronomancy Phase 3): this cast used the pre-cast charges
        // for cost and damage above; now bank one more Arcane Charge (cap 4) and
        // refresh the window, so the NEXT cast reads the higher count.
        // projectile:false guarantees this runs after the damage and before any
        // recast can read the count (combat/chronomancy.ts).
        if (ability.id === ARCANE_SURGE_ID) aetherSurgeAddStack(ctx, p);
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
      case 'finisherDamage': {
        if (!target || spentCombo <= 0) break;
        let dmg =
          eff.base +
          eff.perCombo * spentCombo +
          ctx.rng.range(0, eff.variance) +
          ctx.effectiveAttackPower(p) / 14;
        const crit =
          ctx.rng.chance(consumeNextAttackCrit(ctx, p) ? 1 : p.critChance) ||
          sureCrit ||
          fireGuaranteedCrit(ctx, p, ability.id, ability.school, target ?? null);
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
      case 'temporalEcho': {
        // Chronomancy Temporal Echo: place (or MOVE) the caster's per-caster mark
        // on a friendly target or self. The small initial heal is the sibling
        // 'heal' effect on this ability, handled by the 'heal' case; this case
        // owns only the mark + its glyph. The Arcane-damage conversion lives in
        // combat/chronomancy.ts. (docs/prd/mage-chronomancy.md section 13)
        const echoTarget = target ?? p;
        if (echoTarget !== p && ctx.isHostileTo(p, echoTarget)) break;
        placeTemporalEcho(ctx, p, echoTarget, eff.duration);
        break;
      }
      case 'massTemporalEcho': {
        // Cascada temporal: the group version of Temporal Echo. The friendly target
        // is the CENTER and must be the caster or a living group/raid member.
        // selectCascadeTargets resolves and ORDERS the whole list (primary first,
        // then the members nearest the primary within radius, capped at maxTargets)
        // BEFORE any heal or aura is applied. Each target then takes a small initial
        // heal (Spell-Power-scaled, can crit) and a 13% group echo; the overlap rule
        // in placeGroupEcho keeps a pre-existing individual mark at 35%. The Arcane
        // conversion lives in combat/chronomancy.ts. (mage-chronomancy.md Phase 4)
        const primary = target ?? p;
        if (primary !== p && ctx.isHostileTo(p, primary)) break;
        const targets = selectCascadeTargets(ctx, p, primary, eff.radius, eff.maxTargets);
        // DEV playtest readout only (Entity.cascadeDevStats, set by /dev cascade):
        // capture the landed initial heal per target so logCascadeCast can print it.
        // Absent in production, so the capture and log are fully skipped.
        const devPlaytest = p.cascadeDevStats !== undefined;
        const initialApplied: number[] = [];
        for (const ally of targets) {
          const before = devPlaytest ? ally.hp : 0;
          const healAmount =
            ctx.rng.range(eff.heal.min, eff.heal.max) + directHealBonus(p.spellPower, res.castTime);
          ctx.applyHeal(p, ally, healAmount, ability.name);
          if (devPlaytest) {
            const applied = ally.hp - before;
            initialApplied.push(applied);
            recordCascadeInitial(p, applied);
          }
          placeGroupEcho(ctx, p, ally, eff.duration);
        }
        if (devPlaytest) logCascadeCast(ctx, p, targets, initialApplied);
        break;
      }
      case 'resurrectAlly': {
        // Temporal Reversal: rewind a dead group/raid member to life at their corpse
        // (resolved upstream as a dead party/raid member), no resurrection sickness.
        const ally = target;
        if (!ally?.dead) break;
        offerResurrection(ctx, p, ally, eff.hpFrac);
        ctx.emit({
          type: 'spellfx',
          sourceId: p.id,
          targetId: ally.id,
          school: 'arcane',
          fx: 'temporalGlyph',
        });
        break;
      }
      case 'massResurrectGroup': {
        resurrectDeadGroupMembers(ctx, p, eff.hpFrac);
        break;
      }
      case 'perfectMoment': {
        // Perfect Moment (combat/chronomancy.ts): slam the caster to full Arcane
        // Charges and open the window in which Aether Darts stops consuming them.
        applyPerfectMoment(ctx, p);
        break;
      }
      case 'rewind': {
        // Chronomancy Rewind (combat/rewind.ts): instant, no target, centered on the
        // caster. Restores a fraction of the recent REAL damage every living group/
        // raid member in range took, capped per target. No crit / no rng / no Echo /
        // no Arcane conversion; normal heal threat via the shared applyHeal route.
        applyRewind(
          ctx,
          p,
          {
            fraction: eff.fraction,
            maxHpFraction: eff.maxHpFraction,
            windowSec: eff.windowSec,
            radius: eff.radius,
          },
          ability.name,
        );
        break;
      }
      case 'heal': {
        const healTarget = target ?? p;
        if (healTarget !== p && ctx.isHostileTo(p, healTarget)) break;
        // Heals scale with Spell Power at the direct cast-time coefficient, the
        // healing mirror of the direct-nuke rider (applyHeal fires the crit).
        const healAmount =
          ctx.rng.range(eff.min, eff.max) + directHealBonus(p.spellPower, res.castTime);
        const healed = ctx.applyHeal(p, healTarget, healAmount, ability.name, ability.id);
        // Power Echo (mage choice row): the armed echo also repeats a direct HEAL
        // (Temporal Mend, Temporal Echo) at its fraction of the RESOLVED heal on
        // the same target, consumed BEFORE the repeat so a copy can never re-echo.
        // The direct-nuke path above does the same for damage. The echo itself
        // cannot crit (canCrit false): it draws no new rng, mirroring the damage
        // echo reusing its already-rolled amount.
        if (isSpell) {
          const echoIdx = p.auras.findIndex((a) => a.kind === 'power_echo');
          if (echoIdx >= 0) {
            const echoAura = p.auras[echoIdx];
            p.auras.splice(echoIdx, 1);
            ctx.emit({ type: 'aura', targetId: p.id, name: echoAura.name, gained: false });
            if (!healTarget.dead && healed > 0) {
              const echoHeal = Math.max(1, Math.round(healed * echoAura.value));
              ctx.applyHeal(p, healTarget, echoHeal, ability.name, ability.id, false, false);
            }
          }
        }
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
          value: eff.amount + absorbBonus(p.spellPower, eff.spellPowerCoeff ?? 0),
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
        noteSpellHit(ctx, p, crit, ability.id);
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
          if (!isDispellableAura(aura, offensive)) continue;
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
        // Voidfeast: the devour heal pays out only when something was eaten.
        if (dispelled > 0 && eff.selfHealPctMaxOnDispel) {
          ctx.applyHeal(p, p, Math.round(p.maxHp * eff.selfHealPctMaxOnDispel), ability.name);
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
            breakChanceScale: FEAR_BREAK_CHANCE_SCALE,
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
          // A charge-limited ability resets to a full pool (Preparation).
          const chargeState = p.abilityCharges?.[abilityId];
          if (chargeState) {
            chargeState.charges = chargeState.maxCharges;
            chargeState.recharge = 0;
          }
        }
        break;
      }
      case 'cleanseSelf': {
        // Ice Block strips every player-removable debuff off the caster (control,
        // DoTs, stat saps, ...), broader than breakRoots and breakControl.
        // Encounter-authored unbreakable control stays until its owning script
        // releases it.
        for (let i = p.auras.length - 1; i >= 0; i--) {
          const aura = p.auras[i];
          if (isDebuffAura(aura.kind, aura.value) && !isUnbreakableControlAura(aura)) {
            p.auras.splice(i, 1);
            ctx.emit({ type: 'aura', targetId: p.id, name: aura.name, gained: false });
          }
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
          school: ability.school,
          ability: ability.name,
          kind: 'hit',
        });
        // Improved Life Tap (a talent buffPct on the ability): more mana per
        // tap, same health price, the classic shape.
        const tapMana = Math.round(eff.mana * (1 + (mods.abilities[ability.id]?.buffPct ?? 0)));
        p.resource = Math.min(p.maxResource, p.resource + tapMana);
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
          // Fear-family members (fearDr: Harrow, Morrowlash) get the graded
          // break; plain incapacitates (Eye Jab, Wyvern Sting) insta-break.
          breakChanceScale: ability.fearDr ? FEAR_BREAK_CHANCE_SCALE : undefined,
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
        // Collect the eligible targets FIRST (LoS + frontal gate) so a soft
        // target cap can know the count before any hit lands. The skips draw no
        // rng (they happen before the damage roll), so the stream position is
        // identical to the uncapped path for every filtered enemy.
        const aoeTargets: Entity[] = [];
        for (const m of ctx.hostilesInRadius(p, aoeCenter, eff.radius)) {
          if (!ctx.hasLineOfSight(p, m)) continue;
          // Frontal-arc variant (Faultline / Revenge): only enemies within the
          // melee facing arc are hit, the same MELEE_ARC check castAbility's
          // facing gate uses.
          if (eff.frontal) {
            const facingDiff = Math.abs(normAngle(angleTo(p.pos, m.pos) - p.facing));
            if (facingDiff > MELEE_ARC) continue;
          }
          aoeTargets.push(m);
        }
        // Classic AoE soft cap (Revenge): above `softCap` targets, hold the TOTAL
        // to softCap x per-target by scaling every rolled hit. Scales the already-
        // rolled amount, so it draws no extra rng.
        const capScale =
          eff.softCap && aoeTargets.length > eff.softCap ? eff.softCap / aoeTargets.length : 1;
        // canCrit (Flamestrike): ONE crit decision for the whole cast, rolled
        // only when something was struck (a whiff draws nothing and feeds the
        // streak counter nothing), outcome overridable by Combustion. Every
        // struck enemy crits together, mirroring the owner rule that a single
        // Flamestrike is a single crit toward Hot Streak however many it hits.
        const aoeCrit =
          (eff.canCrit ?? false) &&
          aoeTargets.length > 0 &&
          (ctx.rng.chance(ctx.spellCrit(p)) ||
            fireGuaranteedCrit(ctx, p, ability.id, ability.school, null));
        for (const m of aoeTargets) {
          let dmg = ctx.rng.range(eff.min, eff.max) + aoeSpBonus;
          if (isSpell) dmg *= spellDamageMultFromAuras(p);
          if (aoeCrit)
            dmg *= (isSpell ? 1.5 : 2) + (isSpell ? p.critDmgSpellBonus : p.critDmgPhysBonus);
          // Armor only mitigates physical damage, mirroring the single-target
          // path above — spell-school AoE (Arcane Explosion, Consecration) is
          // not reduced by the target's armor.
          if (!isSpell) dmg *= 1 - armorReduction(ctx.effectiveArmor(m), p.level);
          // Soft-cap scale (Revenge above 5 targets): applied after the roll and
          // armor so the total, not any single hit, is what the cap bounds.
          dmg *= capScale;
          ctx.dealDamage(
            p,
            m,
            Math.round(dmg),
            aoeCrit,
            ability.school,
            ability.name,
            'hit',
            false,
            threatOpts,
            true,
            attackAnimationStarted,
            false,
            ability.id,
            // aoe: area Arcane damage (Aetherburst) converts to Temporal Echo
            // healing at the reduced 15% rate. Non-arcane AoE is unaffected.
            true,
          );
          // Paired stun rider (Faultline): each enemy actually struck is also
          // stunned, mirroring the single-target 'stun' case (shared PvP DR,
          // no rng drawn; diminishedCrowdControlDuration is deterministic).
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
          const hitCount = Math.min(aoeTargets.length, eff.rageOnHit.capTargets);
          const amount =
            (eff.rageOnHit.base + eff.rageOnHit.perTarget * hitCount) *
            warriorAbilityRageMult(ctx, p, meta);
          p.resource = Math.min(p.maxResource, p.resource + amount);
        }
        // The Hot Streak feed, ONCE per cast (owner rule): a canCrit blast that
        // struck anything counts as exactly one hit, crit or not, however many
        // enemies it caught. A whiff feeds nothing (no draw happened either).
        if ((eff.canCrit ?? false) && aoeTargets.length > 0 && isSpell)
          noteSpellHit(ctx, p, aoeCrit, ability.id);
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
        // AoE heals take the same per-target coefficient penalty as AoE damage.
        const aoeHealBonus = directHealBonus(p.spellPower, res.castTime, true);
        for (const m of friendliesInRadius(ctx, p, eff.radius)) {
          if (!ctx.hasLineOfSight(p, m)) continue;
          const healAmount = ctx.rng.range(eff.min, eff.max) + aoeHealBonus;
          ctx.applyHeal(p, m, healAmount, ability.name, ability.id);
        }
        break;
      }
      case 'frozenOrb': {
        // Frozen Orb (combat/frozen_orb.ts): release the drifting orb from the
        // caster, snapshotting the per-pulse spell-power rider like a groundAoE.
        spawnFrozenOrb(
          ctx,
          p,
          eff,
          ability.name,
          directHitBonus(abilityScalingPower(p, ability), ability, res.castTime, true),
        );
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
          allyBuffPct: eff.allyBuffPct,
          igniteFrac: eff.igniteFrac,
          slowMult: eff.slowMult,
          slowDuration: eff.slowDuration,
          orbCdr: eff.orbCdr,
        };
        // A fresh Blizzard zone gets a fresh Frozen Orb refund budget (the
        // same per-cast budget the old channel reset at channel start).
        if (eff.orbCdr) frostMageChannelStart(p, ability.id);
        // Visual riders (owner playtest): a delayed FIRE zone is a falling
        // meteor (the ball drops over the fall delay); a friendly zone is an
        // inscribed rune circle for its whole life. Cosmetic only.
        if (eff.delayed && ability.school === 'fire') {
          ctx.emit({
            type: 'spellfxAt',
            x: zoneCenter.x,
            z: zoneCenter.z,
            school: ability.school,
            fx: 'meteorFall',
            radius: eff.radius,
            duration: eff.interval,
          });
        }
        if (eff.allyBuffPct) {
          ctx.emit({
            type: 'spellfxAt',
            x: zoneCenter.x,
            z: zoneCenter.z,
            school: ability.school,
            fx: 'runeCircle',
            radius: eff.radius,
            duration: eff.duration,
          });
        }
        // A snaring frost zone (Blizzard) snows over its area for its life.
        if (eff.slowMult && ability.school === 'frost') {
          ctx.emit({
            type: 'spellfxAt',
            x: zoneCenter.x,
            z: zoneCenter.z,
            school: ability.school,
            fx: 'snowZone',
            radius: eff.radius,
            duration: eff.duration,
          });
        }
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
        // A delayed zone (Meteor's fall) skips the on-cast pulse: its first
        // hit lands one interval later, exactly the fall time.
        if (!eff.delayed) ctx.pulseGroundAoE(groundEffect, threatOpts, true);
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
          // pct form (Direhowl rework): a NEGATIVE buff_dmg_done aura cuts a
          // fraction of ALL damage the victim deals (the dealDamage amp fold
          // handles the negative side); the legacy amount form stays the flat
          // debuff_ap drain (demoralizing roar).
          if (eff.pct !== undefined) {
            ctx.applyAura(m, {
              id: `${ability.id}_ap`,
              name: ability.name,
              kind: 'buff_dmg_done',
              remaining: eff.duration,
              duration: eff.duration,
              value: -eff.pct,
              sourceId: p.id,
              school: ability.school,
            });
          } else {
            ctx.applyAura(m, {
              id: `${ability.id}_ap`,
              name: ability.name,
              kind: 'debuff_ap',
              remaining: eff.duration,
              duration: eff.duration,
              value: eff.amount ?? 0,
              sourceId: p.id,
              school: ability.school,
            });
          }
          ctx.enterCombat(p, m);
          if (m.kind === 'mob' && m.hostile)
            addThreat(m, p.id, 10 * ctx.threatMod(p, ability.school));
        }
        break;
      }
      case 'aoeSlow': {
        // Piercing Howl: the aoeAttackPower loop shape with a `slow` aura (the
        // same kind hamstring applies, so movement math needs no new read).
        // Emits a nova and gates each victim on line of sight (PTR).
        ctx.emit({
          type: 'spellfx',
          sourceId: p.id,
          targetId: p.id,
          school: ability.school,
          fx: 'nova',
        });
        for (const m of ctx.hostilesInRadius(p, p.pos, eff.radius)) {
          if (m.dead) continue;
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
          if (m.kind === 'mob' && m.hostile)
            addThreat(m, p.id, 10 * ctx.threatMod(p, ability.school));
        }
        break;
      }
      case 'empoweredCone': {
        const level = Math.max(1, Math.min(eff.stages.length, res.empowerLevel ?? 1));
        const stage = eff.stages[level - 1];
        const angle = stage.angle ?? eff.angle;
        const fx = eff.fx ?? 'frostCone';
        let hotStreakHit = false;
        let hotStreakCrit = false;
        ctx.emit({
          type: 'spellfx',
          sourceId: p.id,
          targetId: p.id,
          school: ability.school,
          fx,
          range: stage.range,
          angle,
          level,
        });
        const spellPower = directHitBonus(
          abilityScalingPower(p, ability),
          ability,
          res.castTime * (level / eff.stages.length),
          true,
        );
        for (const m of ctx.hostilesInRadius(p, p.pos, stage.range)) {
          if (m.dead || !ctx.hasLineOfSight(p, m)) continue;
          if (!glacialFrontContains(p.pos, p.facing, m.pos, stage.range, angle)) continue;
          const critRoll = ctx.rng.chance(ctx.spellCrit(p));
          const crit =
            critRoll ||
            fireGuaranteedCrit(ctx, p, ability.id, ability.school, m) ||
            (eff.guaranteedCritLevel !== undefined && level === eff.guaranteedCritLevel);
          let damage = ctx.rng.range(stage.min, stage.max) + spellPower;
          damage *= spellDamageMultFromAuras(p);
          if (crit) damage *= 1.5 + p.critDmgSpellBonus;
          ctx.dealDamage(p, m, Math.round(damage), crit, ability.school, ability.name, 'hit');
          if (eff.hotStreakOnce) {
            hotStreakHit = true;
            hotStreakCrit ||= crit;
          } else noteSpellHit(ctx, p, crit, ability.id);
          if (m.dead) continue;
          if (eff.slowMult !== undefined && eff.slowDuration !== undefined) {
            ctx.applyAura(m, {
              id: `${ability.id}_slow`,
              name: ability.name,
              kind: 'slow',
              remaining: eff.slowDuration,
              duration: eff.slowDuration,
              value: eff.slowMult,
              sourceId: p.id,
              school: ability.school,
            });
          }
          if (stage.incapacitateDuration) {
            const duration = ctx.diminishedCrowdControlDuration(
              p,
              m,
              'fear',
              stage.incapacitateDuration,
            );
            if (duration === null) continue;
            ctx.applyAura(m, {
              id: `${ability.id}_incap`,
              name: ability.name,
              kind: 'incapacitate',
              remaining: duration,
              duration,
              value: 0,
              sourceId: p.id,
              school: ability.school,
              breaksOnDamage: true,
            });
          }
          if (stage.rootDuration) {
            ctx.applyRootAura(
              p,
              m,
              ability.name,
              `${ability.id}_root`,
              stage.rootDuration,
              ability.school,
            );
          }
          ctx.enterCombat(p, m);
        }
        if (eff.hotStreakOnce && hotStreakHit) noteSpellHit(ctx, p, hotStreakCrit, ability.id);
        break;
      }
      case 'aoeAllyAttackPower': {
        // The friendly mirror of aoeAttackPower: an AP BUFF on the caster and
        // nearby allies (Trueshot Aura, Iron Bellow), riding the friendlies seam.
        // No party requirement: friendliesInRadius includes the caster and every
        // friendly entity within radius. A flat amount stamps buff_ap; a percent
        // (apPct) stamps buff_ap_pct.
        //
        // An exclusiveGroup ability here (battle_shout, group 'warrior_shout')
        // first cancels the caster's sibling buffs, mirroring the selfBuff case;
        // a re-cast's own `<id>_ap` aura is skipped (applyAura refreshes it in
        // place). Trueshot Aura has no group, so this is a no-op for it.
        for (const i of exclusiveAuraConflicts(
          ability.exclusiveGroup,
          `${ability.id}_ap`,
          p.auras,
          exclusiveGroupOfAura,
        )) {
          const a = p.auras[i];
          p.auras.splice(i, 1);
          ctx.emit({ type: 'aura', targetId: p.id, name: a.name, gained: false });
        }
        const kind = eff.apPct !== undefined ? 'buff_ap_pct' : 'buff_ap';
        const value = eff.apPct ?? eff.amount ?? 0;
        for (const mE of ctx.friendliesInRadius(p, p.pos, eff.radius)) {
          ctx.applyAura(mE, {
            id: `${ability.id}_ap`,
            name: ability.name,
            kind,
            remaining: eff.duration,
            duration: eff.duration,
            value,
            sourceId: p.id,
            school: ability.school,
          });
          // A percent AP buff folds through recalcPlayerStats, so re-derive the
          // affected player's stats (the flat buff_ap form is read live).
          if (mE.kind === 'player') {
            const targetMeta = ctx.players.get(mE.id);
            if (targetMeta)
              recalcPlayerStats(
                mE,
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
        // Base form (Red Banner): attack-speed haste to friendlies in radius. Bloodlust
        // and Temporal Acceleration opt into full haste (spell), the shared exhaustion
        // (exhaust), and group/raid scoping (groupOnly) via combat/haste_burst.ts.
        applyGroupHaste(
          ctx,
          p,
          {
            mult: eff.mult,
            duration: eff.duration,
            radius: eff.radius,
            spell: eff.spell,
            exhaust: eff.exhaust,
            groupOnly: eff.groupOnly,
          },
          ability.id,
          ability.name,
          ability.school,
        );
        break;
      }
      case 'aoeAllyAbsorb': {
        // Mass Barrier: an absorb shield on the caster and friendlies in radius.
        // When eff.maxTargets is set (owner 2026-07-13: 5), only the NEAREST that
        // many are shielded (the caster is distance 0, so always covered). Draws no rng.
        let recipients = livingGroupRaidInRadius(ctx, p, eff.radius);
        if (eff.maxTargets && recipients.length > eff.maxTargets) {
          recipients = [...recipients]
            .sort((a, b) => {
              if (a.id === p.id) return -1;
              if (b.id === p.id) return 1;
              const da = (a.pos.x - p.pos.x) ** 2 + (a.pos.z - p.pos.z) ** 2;
              const db = (b.pos.x - p.pos.x) ** 2 + (b.pos.z - p.pos.z) ** 2;
              return da - db || a.id - b.id;
            })
            .slice(0, eff.maxTargets);
        }
        const resolved = ctx.resolve(p.id);
        const spec = resolved ? ctx.playerMods(resolved.meta).spec : null;
        if (ability.id === 'mass_barrier') {
          const personalBarrierId = personalBarrierIdForSpec(spec);
          const personalBarrier = personalBarrierId
            ? ctx.resolvedAbility(personalBarrierId, p.id)
            : null;
          if (personalBarrierId && personalBarrier && personalBarrier.cooldown > 0) {
            p.cooldowns.set(
              personalBarrierId,
              Math.max(p.cooldowns.get(personalBarrierId) ?? 0, personalBarrier.cooldown),
            );
          }
        }
        const barrierSchool =
          ability.id === 'mass_barrier' && spec === 'arcane'
            ? 'arcane'
            : ability.id === 'mass_barrier' && spec === 'fire'
              ? 'fire'
              : ability.school;
        for (const mE of recipients) {
          ctx.applyAura(mE, {
            id: ability.id,
            name: ability.name,
            kind: 'absorb',
            remaining: eff.duration,
            duration: eff.duration,
            value: eff.amount,
            sourceId: p.id,
            school: barrierSchool,
          });
        }
        break;
      }
      case 'greaterInvisibility': {
        // One dispatch applies the whole package so the two self-auras carry
        // distinct ids (the selfBuff case keys auras by the ability id alone):
        // strip up to N DoTs (newest first), vanish via the stealth machinery
        // (applyAura sets stealthed), and a buff_dr cut that outlives the
        // vanish by `linger` so it survives an early break. Draws no rng.
        let removed = 0;
        for (let i = p.auras.length - 1; i >= 0 && removed < eff.removeDotCount; i--) {
          if (p.auras[i].kind !== 'dot') continue;
          const gone = p.auras[i];
          p.auras.splice(i, 1);
          removed++;
          ctx.emit({ type: 'aura', targetId: p.id, name: gone.name, gained: false });
        }
        // The stealth kind doubles as a MOVEMENT factor in moveSpeedMult
        // (rogue stealth walks slower); an invisible mage keeps full speed,
        // so the aura value must be 1, never 0 (0 pins the caster in place).
        ctx.applyAura(p, {
          id: ability.id,
          name: ability.name,
          kind: 'stealth',
          remaining: eff.duration,
          duration: eff.duration,
          value: 1,
          sourceId: p.id,
          school: ability.school,
        });
        ctx.applyAura(p, {
          id: `${ability.id}_dr`,
          name: ability.name,
          kind: 'buff_dr',
          remaining: eff.duration + eff.linger,
          duration: eff.duration + eff.linger,
          value: eff.drValue,
          sourceId: p.id,
          school: ability.school,
        });
        break;
      }
      case 'aoeAllyDamage': {
        for (const mE of ctx.friendliesInRadius(p, p.pos, eff.radius)) {
          ctx.applyAura(mE, {
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
        // A ground-targeted cast (Ring of Frost) roots where it was AIMED; the
        // self-centered novas (Frost Nova, Gripping Earth) keep the caster center.
        const center = p.castAim ?? p.pos;
        // Optional persistent annular trap (Ring of Frost): hand the whole cast to
        // the ring module, which owns placement, arming, and the catch pulses.
        if (eff.ring) {
          spawnRingOfFrost(ctx, p, center, { ...eff, ring: eff.ring }, ability.name, ability.id);
          break;
        }
        // Optional armed trap at the caster's feet (Rime Snare): the trap
        // module owns placement, arming, and the single-target spring.
        if (eff.trap) {
          spawnHunterTrap(ctx, p, { ...eff, trap: eff.trap }, ability.name, ability.id);
          break;
        }
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
                eff.breakOnDamage ? damageBreakThreshold(m.maxHp, eff.breakOnDamage) : undefined,
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
          if (isSpell) noteSpellHit(ctx, p, crit, ability.id);
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
      case 'breakRoots': {
        removeRootAuras(ctx, p);
        break;
      }
      case 'breakControl': {
        for (let i = p.auras.length - 1; i >= 0; i--) {
          const aura = p.auras[i];
          if (
            !isUnbreakableControlAura(aura) &&
            (ctx.isControlAura(aura.kind) ||
              aura.kind === 'silence' ||
              aura.kind === 'blind' ||
              aura.kind === 'disarm' ||
              aura.kind === 'slow')
          ) {
            p.auras.splice(i, 1);
            ctx.emit({ type: 'aura', targetId: p.id, name: aura.name, gained: false });
          }
        }
        break;
      }
      case 'repositionToAim': {
        if (!eff.landingAoe || hasUnbreakableMovementLock(p)) break;
        armHeroicLeap(ctx, p, p.castAim ?? p.pos, eff.landingAoe, ability);
        break;
      }
      case 'blinkForward': {
        if (hasUnbreakableMovementLock(p)) break;
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
        // The step is INSTANT: the renderer snaps the mover on this cue
        // (without it, the self-reposition heuristic reads the jump as a
        // leap and plays an arc, owner playtest 2026-07-11).
        ctx.emit({
          type: 'spellfx',
          sourceId: p.id,
          targetId: p.id,
          school: ability.school,
          fx: 'blinkStep',
        });
        break;
      }
      case 'selfBuff': {
        // forms, stances and stealth are toggles: casting again cancels
        const isFormKind = isFormAuraKind(eff.kind);
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
        if (eff.kind === 'stasis' || isTravelFormAuraKind(eff.kind)) {
          if (p.castingAbility) ctx.cancelCast(p);
          p.autoAttack = false;
        }
        // shapeshifting out of one form into another (bear/cat/travel are exclusive)
        if (isFormKind) {
          for (let i = p.auras.length - 1; i >= 0; i--) {
            const a = p.auras[i];
            if (isFormAuraKind(a.kind) && a.kind !== eff.kind) {
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
      case 'selfHotPctMax': {
        // A plain self 'hot' aura (the same kind Renew applies, ticked by
        // combat/auras.ts) whose total is a fraction of the caster's MAXIMUM
        // health. No spell-power rider: the pct already scales with the caster.
        const ticks = Math.max(1, Math.round(eff.duration / eff.interval));
        ctx.applyAura(p, {
          id: ability.id,
          name: ability.name,
          kind: 'hot',
          remaining: eff.duration,
          duration: eff.duration,
          value: Math.max(1, Math.round((p.maxHp * eff.pct) / ticks)),
          tickInterval: eff.interval,
          tickTimer: eff.interval,
          sourceId: p.id,
          school: ability.school,
        });
        break;
      }
      case 'charge': {
        if (!target || hasUnbreakableMovementLock(p)) break;
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
        // a sunder can miss like any melee attack (and Hit rating reduces it, via
        // swingMissChance); a miss causes no threat
        if (ctx.rng.chance(swingMissChance(p, target))) {
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

  // Frost mage post-impact rider (combat/frost_mage.ts): frostbolt rolls its
  // two procs (committed frost only, so no existing golden moves); Flurry
  // plants Winter's Chill on its surviving target. Inert for everyone else.
  frostMageAfterCast(ctx, p, meta, ability, target);

  if (ability.spendsCombo && spentCombo > 0) {
    p.comboPoints = 0;
    ctx.emit({ type: 'comboPoint', points: 0, pid: p.id });
  }
  if (sureCritRolled) consumeSureCritCharge(ctx, p);
  if (areaEcho && areaEchoDealt) consumeAreaEchoCharge(ctx, p);
}
