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

import { ABILITIES, isDelvePos } from '../data';
import { recalcPlayerStats } from '../entity';
import type { GroundAoE } from '../entity_roster';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE, PLAYER_SWIM_DEPTH } from '../pathfind';
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
import {
  type AbilityDef,
  angleTo,
  armorReduction,
  DT,
  dist2d,
  ENRAGE_DMG_DONE,
  type Entity,
  FISHING_CAST_ID,
  MELEE_ARC,
  MELEE_CLASSES,
  meleeMissChance,
  normAngle,
  rageGenAuraMult,
} from '../types';
import { groundHeight, WATER_LEVEL } from '../world';
import {
  abilityQualifiesForAreaEcho,
  consumeAreaEchoCharge,
  echoAreaDamage,
  hasSweepingStrikes,
  sweepStrikeDamage,
} from './area_echo';
import { isRooted } from './cc';
import { consumeAuraKind, consumeNextAttackCrit } from './empower_next';
import { runWeaponProcs } from './equip_procs';
import { exclusiveAuraConflicts } from './exclusive_aura';
import { isFormAuraKind } from './forms';
import { consumeSureCritCharge, hasSureCritAura } from './sure_crit';

const CHARGE_MAX_DURATION = 3; // seconds before a blocked charge gives up
// repositionToAim sweep tuning (harvested from PR #1348): the leap walks the
// straight line in small steps, stopping at the last legal point before a
// collider, an unclimbable rise, or deep water, so it can never tunnel
// through a wall or land somewhere movement could not reach.
const TELEPORT_SWEEP_STEP = 0.5;
const TELEPORT_MAX_CLIMB_SLOPE = PLAYER_MAX_CLIMB_SLOPE;
const TELEPORT_MIN_GROUND = WATER_LEVEL - PLAYER_SWIM_DEPTH;
// Heroic Leap flight (owner 2026-07-09): the caster ARCS to the landing over this
// long instead of teleporting, cresting LEAP_APEX yards up at the midpoint, so it
// reads as a real jump. updateLeapMovement (sim.ts) drives it and fires the AoE on
// touchdown.
const LEAP_DURATION = 0.6;
const LEAP_APEX = 3.2;

function isStealthToggle(ability: AbilityDef): boolean {
  return ability.effects.some((e) => e.type === 'selfBuff' && e.kind === 'stealth');
}

function preservesStealth(ability: AbilityDef): boolean {
  return isStealthToggle(ability) || ability.id === 'sprint';
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

function removeRootAuras(ctx: SimContext, p: Entity): void {
  for (let i = p.auras.length - 1; i >= 0; i--) {
    const aura = p.auras[i];
    if (aura.kind !== 'root') continue;
    p.auras.splice(i, 1);
    ctx.emit({ type: 'aura', targetId: p.id, name: aura.name, gained: false });
  }
}

// Swept relocation (Heroic Leap): step toward the destination, resolving each
// step against the colliders and bailing at cliffs/deep water, then land at
// the last safe point. Adapted from PR #1348's sweptReposition onto our
// point-resolution seam (resolveMovePoint).
function computeSweptLanding(
  ctx: SimContext,
  p: Entity,
  destX: number,
  destZ: number,
): { x: number; z: number } {
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
      const resolved = ctx.resolveMovePoint(nextX, nextZ, PLAYER_BODY_RADIUS, p);
      const moved = Math.hypot(resolved.x - safeX, resolved.z - safeZ);
      const blocked =
        Math.hypot(resolved.x - nextX, resolved.z - nextZ) > PLAYER_BODY_RADIUS * 0.25;
      if (blocked || moved < step * 0.5) break;
      safeX = resolved.x;
      safeZ = resolved.z;
      prevGround = groundHeight(safeX, safeZ, ctx.cfg.seed);
    }
  }
  return { x: safeX, z: safeZ };
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

export function runEffects(
  ctx: SimContext,
  p: Entity,
  meta: PlayerMeta,
  target: Entity | null,
  res: ResolvedAbility,
  // Bladed Echo (combat/area_echo.ts): applyAbility resolved this cast as
  // echo-eligible ONCE at the ability level, so a multi-strike cast (Red
  // Harvest) echoes every strike and consumes a single charge below.
  opts?: { areaEcho?: boolean },
): void {
  const ability = res.def;
  const isSpell = ability.school !== 'physical';
  const spentCombo = ability.spendsCombo ? p.comboPoints : 0;
  let comboAwarded = false;
  // Set by the weaponStrike/directDamage cases when an echo-eligible cast
  // actually dealt single-target hostile damage; gates the charge consumption
  // after the loop (a fully whiffed cast keeps its charge).
  let areaEchoDealt = false;
  // Sweeping Strikes (Arms): a worn window makes each single-target strike clip
  // one nearby enemy for 75%. Aura-driven (no charge), resolved once per cast
  // like the echo. SWEEP_MULT is the reduced fraction.
  const SWEEP_MULT = 0.75;
  const sweeping = hasSweepingStrikes(p) && abilityQualifiesForAreaEcho(ability.effects);
  // Emboldened (combat/sure_crit.ts): resolved ONCE per cast, so a
  // multi-strike cast (Red Harvest) crits every strike and spends a single
  // charge below. Each crit-roll site still draws its rng exactly as before
  // (the stream position never moves); the flag only overrides the outcome.
  // `sureCritRolled` is set where a crit roll actually happened, so a fully
  // whiffed cast or a cast with no crit roll (pure buffs, plain AoE) never
  // spends a charge.
  const sureCrit = hasSureCritAura(p);
  let sureCritRolled = false;
  // acting breaks stealth (the opener itself still lands first inside the swing).
  // Stealth toggles and Rogue Sprint are allowed while remaining hidden.
  if (!preservesStealth(ability)) ctx.breakStealth(p);
  const threatOpts = { flat: res.threatFlat, mult: res.threatMult };

  // Cleaving Blows (Fury passive): casting Red Harvest refunds one charge of
  // Twinstrike (raging_gale). Gated on the passive being known; a no-op when no
  // charge is spent. Draws no rng, so the shared stream position is unchanged.
  if (
    ability.id === 'red_harvest' &&
    meta.known.some((k) => k.def.passive && k.def.id === 'cleaving_blows')
  ) {
    const cs = p.charges?.get('raging_gale');
    if (cs && cs.spent > 0) {
      cs.spent -= 1;
      if (cs.spent <= 0) p.cooldowns.delete('raging_gale');
    }
  }

  // Battle Rhythm (warrior choice row): every third ability is empowered. The
  // counter advances once per cast; on the third, two one-tick micro-auras ride
  // this cast's effects through the EXISTING generic reads (buff_dmg_done's amp
  // in dealDamage, buff_rage_gen in rageGenAuraMult), then expire on the next
  // aura tick, so nothing here special-cases individual effect types. The brief
  // buff-bar blink doubles as the "third hit ready" feedback. No rng drawn.
  if (ctx.playerMods(meta).global.battleRhythm > 0) {
    meta.abilityRhythm = (meta.abilityRhythm + 1) % 3;
    if (meta.abilityRhythm === 0) {
      // remaining = exactly one tick (DT): the cast's own effects run
      // synchronously below, then the next decay pass removes the blink, so it
      // cannot bleed onto a followup off-GCD cast or auto swing (review note).
      const blink = { remaining: DT, duration: DT, sourceId: p.id, school: ability.school };
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

  // A kill-window ability (Victory Rush) consumes its enabling aura on cast;
  // castAbility already gated on it being worn.
  if (ability.requiresAuraKind) consumeAuraKind(ctx, p, ability.requiresAuraKind);

  for (const eff of res.effects) {
    switch (eff.type) {
      case 'weaponStrike': {
        if (!target) break;
        const strikeTarget = target;
        // Redhand empowers the next Maiming Strike: consume the charge and
        // amplify this strike (Arms restructure 2026-07-08).
        let strikeMult = eff.weaponMult ?? 1;
        let strikeBonus = eff.bonus;
        if (ability.id === 'mortal_strike') {
          const idx = p.auras.findIndex((a) => a.kind === 'overpower_charge');
          if (idx >= 0) {
            const charge = p.auras[idx];
            strikeMult *= 1 + charge.value * (charge.stacks ?? 1);
            p.auras.splice(idx, 1);
            ctx.emit({ type: 'aura', targetId: p.id, name: charge.name, gained: false });
          }
        }
        // Diabolical Twinstrike (Fury passive): Twinstrike hits 15% harder while you
        // are Enraged. Gated on the passive being known (owner 2026-07-09).
        if (ability.id === 'raging_gale' && p.auras.some((a) => a.kind === 'enrage')) {
          const dm = ctx.players.get(p.id);
          if (dm?.known.some((k) => k.def.passive && k.def.id === 'diabolical_twinstrike')) {
            // +15% to the WHOLE strike (weapon portion AND the flat bonus), so the
            // ability's total damage rises 15%, not just its weapon-scaled part.
            strikeMult *= 1.15;
            strikeBonus = Math.round(strikeBonus * 1.15);
          }
        }
        const hit = ctx.meleeSwing(p, strikeTarget, strikeBonus, ability.name, {
          cannotBeDodged: eff.cannotBeDodged,
          weaponMult: strikeMult,
          threatFlat: res.threatFlat,
          threatMult: res.threatMult,
          // Emboldened: override the swing's crit outcome (its rng is still
          // drawn inside meleeSwing exactly as before).
          forceCrit: sureCrit,
          // Bladed Echo (charge) and Sweeping Strikes (window) both replay this
          // swing's RESOLVED damage (post crit/armor) onto nearby enemies with
          // no re-roll: the echo hits all for 65%, the sweep one for 75%.
          onDealt:
            opts?.areaEcho || sweeping
              ? (amount) => {
                  if (opts?.areaEcho) {
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
                  if (sweeping) {
                    sweepStrikeDamage(
                      ctx,
                      p,
                      strikeTarget,
                      amount,
                      SWEEP_MULT,
                      ability.school,
                      ability.name,
                      threatOpts,
                    );
                  }
                }
              : undefined,
        });
        // A connected swing rolled (and had overridden) its crit; a miss or
        // dodge never reached the crit roll, so it spends nothing.
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
        const rooted = isRooted(target);
        const critChance =
          isSpell && rooted
            ? ctx.spellCrit(p) + ctx.playerMods(meta).global.critVsRooted
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
        // Emboldened: the roll is still drawn; only the outcome is overridden.
        const crit = ctx.rng.chance(consumeNextAttackCrit(ctx, p) ? 1 : critChance) || sureCrit;
        if (sureCrit) sureCritRolled = true;
        if (crit) dmg *= isSpell ? 1.5 : 2;
        if (!isSpell) dmg *= 1 - armorReduction(ctx.effectiveArmor(target), p.level);
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
        );
        // Bladed Echo: replay the SAME resolved amount (already rolled, post
        // crit/armor; no new rng draw) onto enemies near the primary target.
        if (opts?.areaEcho) {
          areaEchoDealt = true;
          echoAreaDamage(ctx, p, target, Math.round(dmg), ability.school, ability.name, threatOpts);
        }
        if (sweeping) {
          sweepStrikeDamage(
            ctx,
            p,
            target,
            Math.round(dmg),
            SWEEP_MULT,
            ability.school,
            ability.name,
            threatOpts,
          );
        }
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
        // Emboldened: the roll is still drawn; only the outcome is overridden.
        const crit = ctx.rng.chance(consumeNextAttackCrit(ctx, p) ? 1 : p.critChance) || sureCrit;
        if (sureCrit) sureCritRolled = true;
        if (crit) dmg *= 2;
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
      case 'enrageChance': {
        // Fury Enrage: Bloodletting has a 30% chance, Desenfreno / Rampage always.
        // Draw only when it is NOT guaranteed, so the always-case adds no rng draw
        // (keeps the shared stream's order stable for the deterministic path).
        if (eff.chance < 1 && !ctx.rng.chance(eff.chance)) break;
        ctx.applyAura(p, {
          // NOT 'enrage': that id is the druid Enrage ability (Avivar), and the
          // buff bar resolves an aura whose id is a known ability to that ability's
          // name/icon. A distinct id keeps this the Fury self-buff 'Enraged'.
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
        // Heals scale with Spell Power at the direct cast-time coefficient, the
        // healing mirror of the direct-nuke rider (applyHeal fires the crit).
        const healAmount =
          ctx.rng.range(eff.min, eff.max) + directHealBonus(p.spellPower, res.castTime);
        ctx.applyHeal(p, healTarget, healAmount, ability.name);
        break;
      }
      case 'chainHeal': {
        // Chain Heal: heal the target, then arc hop by hop to nearby allies. The
        // hop choice is DETERMINISTIC (most injured by hp fraction, then nearest,
        // then lowest id), so the only rng draws are the one base roll plus each
        // applyHeal's crit, and the same world state always builds the same chain.
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
          ctx.grid.forEachInRadius(from.pos.x, from.pos.z, eff.jumpRange, (e, d2) => {
            if (e.dead || chain.includes(e)) return;
            // Allies only: players and player-owned pets (what a friendly-target
            // heal may hit), never a hostile or an NPC bystander.
            if (!ctx.isFriendlyTo(p, e)) return;
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
          ctx.applyHeal(p, chain[i], hopAmount, ability.name);
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
        ctx.applyAura(shieldTarget, {
          id: ability.id,
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
        let dmg =
          ctx.rng.range(seal.value2 ?? 10, seal.value3 ?? 15) +
          directHitBonus(p.spellPower, ability, res.castTime);
        // Emboldened: the roll is still drawn; only the outcome is overridden.
        const crit =
          ctx.rng.chance(consumeNextAttackCrit(ctx, p) ? 1 : ctx.spellCrit(p)) || sureCrit;
        if (sureCrit) sureCritRolled = true;
        if (crit) dmg *= 1.5;
        ctx.dealDamage(p, target, Math.round(dmg), crit, 'holy', ability.name, 'hit');
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
        // Pummel (owner design): stopping a cast PAYS rage instead of costing
        // it, scaled like every ability-granted rage (Anger Management +
        // Recklessness / Battle Rhythm). Minted only when a cast was actually
        // cut (this branch), never on a whiffed press.
        if (eff.rageOnInterrupt && p.resourceType === 'rage') {
          const interruptGain =
            eff.rageOnInterrupt *
            (1 + ctx.playerMods(meta).global.abilityRagePct) *
            rageGenAuraMult(p);
          p.resource = Math.min(p.maxResource, p.resource + interruptGain);
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
        // Source-scoped debuff (Breachmaker): the aura MUST carry the caster's
        // id in sourceId so the vuln_source fold in combat/damage.ts amplifies
        // only THIS caster's damage against the target. Distinct auraId/auraName.
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
          (e) => e.type === 'directDamage' || e.type === 'aoeDamage' || e.type === 'aoeRoot',
        );
        const dotBase = Math.max(1, Math.round(eff.total / (eff.duration / eff.interval)));
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
          school: ability.school,
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
        const remaining =
          ability.id === 'fear'
            ? ctx.diminishedCrowdControlDuration(p, target, 'fear', eff.duration)
            : eff.duration;
        if (remaining === null) break;
        ctx.applyAura(target, {
          id: `${ability.id}_incap`,
          name: ability.name,
          kind: 'incapacitate',
          remaining,
          duration: remaining,
          value: ability.id === 'fear' ? ctx.rng.range(-Math.PI, Math.PI) : 0,
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
        for (const m of aoeTargets) {
          let dmg = ctx.rng.range(eff.min, eff.max) + aoeSpBonus;
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
            false,
            ability.school,
            ability.name,
            'hit',
            false,
            threatOpts,
          );
          // Paired stun rider (Faultline): each enemy actually struck is also
          // stunned, mirroring the single-target 'stun' case (shared PvP DR,
          // no rng drawn; diminishedCrowdControlDuration is deterministic).
          if (eff.stunSec !== undefined && !m.dead) {
            const stunRemaining = ctx.diminishedCrowdControlDuration(
              p,
              m,
              stunDrCategory(ability.id),
              eff.stunSec,
            );
            if (stunRemaining !== null) {
              ctx.applyAura(m, {
                id: `${ability.id}_stun`,
                name: ability.name,
                kind: 'stun',
                remaining: stunRemaining,
                duration: stunRemaining,
                value: 0,
                sourceId: p.id,
                school: ability.school,
              });
            }
          }
        }
        // Rage-generating AoE (Bladed Gyre): grant the caster rage scaled by how
        // many enemies were actually struck (reusing the soft-cap target list),
        // capped by capTargets. Scaled like gainResource by the choice-row talent
        // multiplier and the aura-driven bonus. Deterministic: no extra rng.
        if (eff.rageOnHit && p.resourceType === 'rage') {
          const hits = aoeTargets.length;
          const rageBase =
            eff.rageOnHit.base + eff.rageOnHit.perTarget * Math.min(hits, eff.rageOnHit.capTargets);
          const rageGain =
            rageBase * (1 + ctx.playerMods(meta).global.abilityRagePct) * rageGenAuraMult(p);
          p.resource = Math.min(p.maxResource, p.resource + rageGain);
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
        const aoeHealBonus = directHealBonus(p.spellPower, res.castTime, true);
        for (const m of ctx.friendliesInRadius(p, p.pos, eff.radius)) {
          if (!ctx.hasLineOfSight(p, m)) continue;
          const healAmount = ctx.rng.range(eff.min, eff.max) + aoeHealBonus;
          ctx.applyHeal(p, m, healAmount, ability.name);
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
        for (const m of ctx.hostilesInRadius(p, p.pos, eff.radius)) {
          if (m.dead) continue;
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
      case 'aoeFear': {
        // Intimidating Shout: fear up to maxTargets hostiles around the caster.
        // Applies the SAME fear_incap aura + flee movement the warlock Fear
        // uses (updateFearMovement keys on that id), with the shared fear DR.
        // Lingering Dread arms a break threshold: the fear soaks a fraction of
        // the victim's max health in damage before the breaksOnDamage pass
        // snaps it (see the threshold arm in combat/damage.ts).
        const fearBreakPct = ctx.playerMods(meta).global.fearBreakPct;
        let feared = 0;
        for (const m of ctx.hostilesInRadius(p, p.pos, eff.radius)) {
          if (m.dead || feared >= eff.maxTargets) continue;
          const remaining = ctx.diminishedCrowdControlDuration(p, m, 'fear', eff.duration);
          if (remaining === null) continue;
          feared++;
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
            ...(fearBreakPct > 0
              ? { breakThreshold: Math.max(1, Math.round(m.maxHp * fearBreakPct)) }
              : {}),
          });
          ctx.enterCombat(p, m);
          if (m.kind === 'mob' && m.hostile)
            addThreat(m, p.id, 10 * ctx.threatMod(p, ability.school));
        }
        break;
      }
      case 'repositionToAim': {
        // Heroic Leap: resolve the (server-clamped) aimed point through the swept
        // resolver, then ARM the arc. updateLeapMovement (sim.ts) flies the caster
        // there over LEAP_DURATION and fires the landing AoE on touchdown, so it
        // reads as a real jump instead of an instant teleport.
        if (eff.breakRoots) removeRootAuras(ctx, p);
        const aim = p.castAim ?? p.pos;
        const landing = computeSweptLanding(ctx, p, aim.x, aim.z);
        p.chargeTargetId = null;
        p.chargePath = [];
        p.leap = {
          from: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
          to: { x: landing.x, y: groundHeight(landing.x, landing.z, ctx.cfg.seed), z: landing.z },
          elapsed: 0,
          dur: LEAP_DURATION,
          apex: LEAP_APEX,
          aoe: eff.landingAoe ?? null,
          ability: ability.name,
        };
        break;
      }
      case 'aoeAllyAttackPower': {
        // The friendly mirror of aoeAttackPower: an AP BUFF on the caster and
        // nearby allies (Trueshot Aura, Iron Bellow), riding the PR3a
        // friendlies seam. No party requirement: friendliesInRadius includes
        // the caster and every friendly entity within radius.
        //
        // An exclusiveGroup ability here (battle_shout, group 'warrior_shout')
        // first cancels the caster's sibling buffs, mirroring the selfBuff
        // case; a re-cast's own `<id>_ap` aura is skipped (applyAura refreshes
        // it in place). Trueshot Aura has no group, so this is a no-op for it.
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
        for (const mE of ctx.friendliesInRadius(p, p.pos, eff.radius)) {
          ctx.applyAura(mE, {
            id: `${ability.id}_ap`,
            name: ability.name,
            kind: 'buff_ap',
            remaining: eff.duration,
            duration: eff.duration,
            value: eff.amount,
            sourceId: p.id,
            school: ability.school,
          });
        }
        break;
      }
      case 'aoeAllySureCrit': {
        // Emboldening Roar: the friendly fan-out shape of aoeAllyAttackPower
        // (no party requirement: friendliesInRadius includes the caster and
        // every friendly entity within radius). Each carrier's next
        // `eff.charges` damaging ability casts are guaranteed critical
        // strikes; the override + per-cast charge spend live in
        // combat/sure_crit.ts.
        for (const mE of ctx.friendliesInRadius(p, p.pos, eff.radius)) {
          ctx.applyAura(mE, {
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
      case 'selfHotPctMax': {
        // Furious Mending's healing half: a plain self 'hot' aura (the same
        // kind Renew applies, ticked by combat/auras.ts) whose total is a
        // fraction of the caster's MAXIMUM health. No spell-power rider: the
        // pct already scales with the caster.
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
      case 'aoeAllyMaxHp': {
        // Rallying Cry (owner rework): a temporary maximum-health fraction on
        // the caster and party members within radius. buff_maxhp_pct folds in
        // recalcPlayerStats, whose hp-fraction restore raises current health
        // with the buff and drops it back (never overflowing) on expiry.
        const rallyParty = ctx.partyOf(p.id);
        const rallyIds = rallyParty ? rallyParty.members : [p.id];
        // Protection reinforces the horn (owner 2026-07-08): on top of the temp
        // max-health, a committed Protection warrior's Rallying Cry also grants
        // every affected ally a 5% damage-taken reduction (buff_dr) for the same
        // duration. Arms / Fury / no-spec give the health buff only.
        const rallyProt = ctx.playerMods(meta).spec === 'prot';
        for (const pid of rallyIds) {
          const mE = ctx.entities.get(pid);
          if (!mE || mE.dead) continue;
          if (pid !== p.id && dist2d(mE.pos, p.pos) > eff.radius) continue;
          ctx.applyAura(mE, {
            id: `${ability.id}_hp`,
            name: ability.name,
            kind: 'buff_maxhp_pct',
            remaining: eff.duration,
            duration: eff.duration,
            value: eff.pct,
            sourceId: p.id,
            school: ability.school,
          });
          if (rallyProt) {
            ctx.applyAura(mE, {
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
        }
        break;
      }
      case 'breakControl': {
        // Avatar: strip every control aura off the caster (the shared predicate
        // covers stun/root/incapacitate/polymorph; silence/disarm/slow join it
        // per the "breaks ALL control" design). Emits the aura-lost events so
        // client buff bars clear (the cleanseFriendlyNpcAuras precedent).
        for (let i = p.auras.length - 1; i >= 0; i--) {
          const a = p.auras[i];
          if (
            ctx.isControlAura(a.kind) ||
            a.kind === 'silence' ||
            a.kind === 'disarm' ||
            a.kind === 'slow'
          ) {
            p.auras.splice(i, 1);
            ctx.emit({ type: 'aura', targetId: p.id, name: a.name, gained: false });
          }
        }
        break;
      }
      case 'partyMeleeBuff': {
        // Sanguine Aura: the caster plus every MELEE party member (class-level
        // filter, MELEE_CLASSES) gains an attack-speed multiplier and a
        // damage-done amp. Solo casters just buff themselves; members are
        // buffed regardless of distance (a war-leader shout, not an aura zone).
        const party = ctx.partyOf(p.id);
        const memberIds = party ? party.members : [p.id];
        for (const pid of memberIds) {
          const mMeta = ctx.players.get(pid);
          const mE = ctx.entities.get(pid);
          if (!mMeta || !mE || mE.dead) continue;
          if (!MELEE_CLASSES.has(mMeta.cls)) continue;
          // ONE composite aura (kind 'sanguine') instead of a haste+damage
          // pair: the buff frame shows a single icon whose tooltip lists both
          // halves (two same-named icons read as a missing effect in playtest).
          ctx.applyAura(mE, {
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
      case 'aoeRoot': {
        ctx.emit({
          type: 'spellfx',
          sourceId: p.id,
          targetId: p.id,
          school: ability.school,
          fx: 'nova',
        });
        const aoeRootSp = directHitBonus(
          abilityScalingPower(p, ability),
          ability,
          res.castTime,
          true,
        );
        for (const m of ctx.hostilesInRadius(p, p.pos, eff.radius)) {
          if (!ctx.hasLineOfSight(p, m)) continue;
          const dmg = ctx.rng.range(eff.min, eff.max) + aoeRootSp;
          ctx.dealDamage(p, m, Math.round(dmg), false, ability.school, ability.name, 'hit');
          if (!m.dead && ctx.isHostileTo(p, m)) {
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
          // Emboldened: the roll is still drawn; only the outcome is overridden.
          const crit =
            ctx.rng.chance(consumeNextAttackCrit(ctx, p) ? 1 : ctx.spellCrit(p)) || sureCrit;
          if (sureCrit) sureCritRolled = true;
          if (crit) dmg *= isSpell ? 1.5 : 2;
          if (!isSpell) dmg *= 1 - armorReduction(ctx.effectiveArmor(target), p.level);
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
          );
        }
        if (eff.heal) {
          const healAmount =
            ctx.rng.range(eff.heal.min, eff.heal.max) + directHealBonus(p.spellPower, res.castTime);
          ctx.applyHeal(p, target, healAmount, ability.name);
        }
        break;
      }
      case 'selfBuff': {
        // forms and stealth are toggles: casting again cancels. Warrior stances
        // are NOT toggles: they belong to the exclusiveGroup 'warrior_stance', so
        // casting one SWAPS the sibling (a warrior is never stanceless); re-casting
        // the active stance just refreshes it below.
        const isFormKind = isFormAuraKind(eff.kind);
        const isToggle = isFormKind || eff.kind === 'stealth' || ability.id === 'ghost_wolf';
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
          exclusiveGroupOfAura,
        )) {
          const a = p.auras[i];
          p.auras.splice(i, 1);
          ctx.emit({ type: 'aura', targetId: p.id, name: a.name, gained: false });
        }
        // Overpower charge (Arms): Redhand STACKS its empower up to 2 rather than
        // refreshing to a single stack, so a second Redhand grows the buff.
        if (eff.kind === 'overpower_charge') {
          const existing = p.auras.find((a) => a.kind === 'overpower_charge');
          if (existing) {
            existing.stacks = Math.min(2, (existing.stacks ?? 1) + 1);
            existing.remaining = eff.duration;
            existing.duration = eff.duration;
            break;
          }
        }
        ctx.applyAura(p, {
          // A selfBuff may carry its own buff identity (aoe_echo: Bladed Gyre
          // arms 'Bladed Echo' under id 'bladed_echo', so the HUD names the
          // rider apart from the granting ability); default is the ability's.
          id: eff.auraId ?? ability.id,
          name: eff.auraName ?? ability.name,
          kind: eff.kind,
          remaining: eff.duration,
          duration: eff.duration,
          value: eff.value,
          // Overpower charge opens at one stack; a second Redhand grows it above.
          stacks: eff.kind === 'overpower_charge' ? 1 : undefined,
          sourceId: p.id,
          school: ability.school,
          // charge-limited thorns (Lightning Shield): cap reflects and gate them
          // behind an internal cooldown. Absent on a plain always-on thorns coat.
          // aoe_echo counts its remaining casts through the same charges field.
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
      case 'gainResource': {
        // Ability-granted rage is scaled by the choice-row talent multiplier
        // (Anger Management's abilityRagePct) and the aura-driven bonus
        // (Recklessness / Battle Rhythm). Non-rage resources (energy from
        // Adrenaline Rush, etc.) are deliberately untouched.
        const gainAmt =
          p.resourceType === 'rage'
            ? eff.amount * (1 + ctx.playerMods(meta).global.abilityRagePct) * rageGenAuraMult(p)
            : eff.amount;
        p.resource = Math.min(p.maxResource, p.resource + gainAmt);
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
        // A flat fraction of max health through the shared heal path (threat/
        // heal-absorb/crit handled there). Furious Mending (aura id
        // 'furious_mending') supercharges Bloodletting's self-heal to 20% while
        // it holds; Math.max keeps Victory Rush's own 0.20 unchanged and only
        // lifts Bloodletting's 0.03 under the buff. No rng.
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
        // Charge's rage burst, scaled like gainResource by abilityRagePct and
        // the aura-driven bonus (Recklessness / Battle Rhythm).
        if (p.resourceType === 'rage') {
          const chargeRage =
            9 * (1 + ctx.playerMods(meta).global.abilityRagePct) * rageGenAuraMult(p);
          p.resource = Math.min(p.maxResource, p.resource + chargeRage);
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
        // Sunder deals no damage: its only threat is the flat value,
        // stance-scaled. Armor Shear's high tank threat spikes ONLY for a
        // committed Protection warrior; for Arms (and no spec) the flat bonus
        // is 0 (the armor shred and any normal action threat still apply, just
        // not the tank spike). Spec decision: docs/prd/warrior-talents.md.
        const sunderFlat = ctx.playerMods(meta).spec === 'prot' ? res.threatFlat : 0;
        addThreat(target, p.id, sunderFlat * ctx.threatMod(p, 'physical'));
        ctx.enterCombat(p, target);
        break;
      }
      case 'absorbSpentResource': {
        // Iron Resolve: a damage-absorb shield (the priest-style 'absorb' aura
        // kind dealDamage drains and the HUD absorb bar reads) sized from the
        // resource ACTUALLY spent. applyAbility snapshotted the spend-all bill
        // into res.cost (spendsAllResource), so the effect reads the true
        // spend, the way finisherDamage reads its spentCombo.
        const shield = Math.round(res.cost * eff.mult);
        if (shield <= 0) break;
        ctx.applyAura(p, {
          id: ability.id,
          name: ability.name,
          kind: 'absorb',
          remaining: eff.duration,
          duration: eff.duration,
          value: shield,
          sourceId: p.id,
          school: ability.school,
        });
        break;
      }
      case 'aoeTaunt': {
        // Defiant Bellow: every hostile mob within radius is taunted through
        // the SHARED applyTaunt entry point (threat lifted to the top of the
        // table + forced attack), exactly the single-target 'taunt' case
        // fanned out. Draws no rng; players cannot be taunted.
        for (const m of ctx.hostilesInRadius(p, p.pos, eff.radius)) {
          if (m.kind !== 'mob' || m.dead) continue;
          ctx.applyTaunt(p, m);
        }
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

  // Bladed Echo: one charge per CAST (not per strike), spent only after the
  // cast actually dealt single-target hostile damage this resolution.
  if (opts?.areaEcho && areaEchoDealt) consumeAreaEchoCharge(ctx, p);

  // Emboldened: one charge per CAST (not per strike/effect), spent only after
  // this cast actually rolled (and overrode) at least one crit.
  if (sureCritRolled) consumeSureCritCharge(ctx, p);

  if (ability.spendsCombo && spentCombo > 0) {
    p.comboPoints = 0;
    ctx.emit({ type: 'comboPoint', points: 0, pid: p.id });
  }
}
