// Weapon procs ("chance on action" effects), a self-contained combat system
// behind the SimContext seam. When the wielder lands a melee swing, a
// damaging spell, or a heal, each matching proc rolls once and, on success,
// fires its effects: a Thunderfury-style chain arc, an attack-speed slow, a
// damage-over-time, a heal-over-time, or the self-targeted pair (a wielder
// buff, a wielder heal). Procs come from TWO sources sharing one WeaponProc
// shape: the legendary weaponProcs authored on the weapon DEF, and a proc
// ENCHANT resolved from the striking hand's worn instance payload
// (ItemInstancePayload.enchant naming a content/enchants.ts def carrying
// `proc`; the raid formulas, docs/prd/ignivar-raid-professions.md).
//
// Determinism / parity: the proc's rng roll only happens when the wielder
// actually carries a proc weapon (or a proc enchant) with a proc for THIS
// trigger. Ordinary gear draws no rng here, so the shared draw order, and
// every parity golden that equips neither, is unchanged. The enchant roll is
// placed AFTER the def loop so existing legendary draw positions never move.
// The `proc.trigger !== trigger` skip, the `target.dead` guard, and the
// duel-end grace check on a persistent hostile effect (see
// duelJustEndedBetween below) all short-circuit BEFORE the rng draw.
//
// src/sim-pure: reaches Sim only through SimContext (rng/emit/applyAura/
// applyHeal/dealDamage/hostilesInRadius/resolve); no DOM/Three/Math.random.

import { ENCHANTS } from '../content/enchants';
import { ITEMS } from '../data';
import { meetsLevelRequirement } from '../item_level_req';
import type { SimContext } from '../sim_context';
import { duelJustEndedBetween } from '../social/duel';
import type { Entity, WeaponProc, WeaponProcEffect, WeaponProcTrigger } from '../types';

// Roll every proc on the wielder's striking hand that matches `trigger`, and
// apply the effects of each that fires. `target` is the primary target of the
// action (the struck enemy, the nuked enemy, or the healed ally). `hand`
// names which equipment slot's INSTANCE payload carries the strike's enchant
// (the melee off-hand swing passes 'offhand'; every other trigger strikes
// with the mainhand and may omit it).
export function runWeaponProcs(
  ctx: SimContext,
  wielder: Entity,
  target: Entity,
  trigger: WeaponProcTrigger,
  weaponItemId?: string | null,
  hand: 'mainhand' | 'offhand' = 'mainhand',
): void {
  if (target.dead) return;
  // Which hand's weapon rolled procs. `undefined` = not specified: fall back to
  // the mainhand (back-compat for the spell/heal/ranged call sites and every
  // existing golden). An explicit id rolls THAT hand's weapon; an explicit
  // `null` means that hand is empty, so nothing procs (an off-hand auto with no
  // off-hand weapon must NOT roll the mainhand's proc, the old dual-wield bug).
  //
  // Entity.mainhandItemId stays populated for a worn OVER-LEVEL weapon (so the
  // model keeps rendering) while recalcPlayerStats treats that weapon as inert.
  // Mirror the level gate here so an inert weapon's procs (and its enchant's)
  // are inert too (the equip gate makes this unreachable today, but a restored
  // save could carry one). All these guards short-circuit BEFORE any rng draw.
  const id = weaponItemId === undefined ? wielder.mainhandItemId : weaponItemId;
  if (!id) return;
  const item = ITEMS[id];
  if (item?.kind !== 'weapon') return;
  if (!meetsLevelRequirement(wielder.level, item)) return;
  for (const proc of item.weaponProcs ?? []) {
    rollProc(ctx, wielder, target, trigger, proc);
  }
  // The proc enchant on this hand's worn copy (raid formulas). ctx.resolve is
  // null for mobs and pets, whose swings therefore skip the read outright; a
  // player hand whose instance carries no enchant, or an enchant with no
  // proc, reaches no rng either.
  const enchantId = ctx.resolve(wielder.id)?.meta.equipmentInstance[hand]?.enchant;
  const enchantProc = enchantId ? ENCHANTS[enchantId]?.proc : undefined;
  if (enchantProc) rollProc(ctx, wielder, target, trigger, enchantProc);
}

/** Gate and roll ONE proc: trigger match, then the duel-end grace on a
 *  persistent hostile effect, then the single rng draw, then the effects.
 *  A hostile persistent-aura proc (dot/attackSlow) landing on the killing
 *  blow's own opponent must not outlive the duel it just ended: see
 *  duelJustEndedBetween (social/duel.ts). Scoped to persistent effects only,
 *  so a heal/hot proc on an ally (or the self-targeted pair) is unaffected.
 *  A chainArc-ONLY proc is unaffected too: its damage already goes through
 *  dealDamage's own duel-aware clamp, which is where that race is closed. A
 *  proc that bundles chainArc WITH a persistent hostile effect (e.g.
 *  Thronebane's arc + slow) is skipped whole when gated, which costs only
 *  that one already-safe tick of arc damage. */
function rollProc(
  ctx: SimContext,
  wielder: Entity,
  target: Entity,
  trigger: WeaponProcTrigger,
  proc: WeaponProc,
): void {
  if (proc.trigger !== trigger) return;
  const isHostilePersistent = proc.effects.some(
    (eff) => eff.kind === 'dot' || eff.kind === 'attackSlow',
  );
  if (isHostilePersistent && duelJustEndedBetween(ctx, target, wielder)) return;
  if (!ctx.rng.chance(proc.chance)) return;
  for (const eff of proc.effects) fireEffect(ctx, wielder, target, proc, eff);
}

function fireEffect(
  ctx: SimContext,
  wielder: Entity,
  target: Entity,
  proc: WeaponProc,
  eff: WeaponProcEffect,
): void {
  switch (eff.kind) {
    case 'chainArc': {
      // Strike the primary target, then arc to nearby enemies for decaying damage.
      // Incidental damage (direct = false), so it never walks a mob's leash anchor.
      ctx.emit({
        type: 'spellfx',
        sourceId: wielder.id,
        targetId: target.id,
        school: eff.school,
        fx: 'projectile',
      });
      ctx.dealDamage(
        wielder,
        target,
        Math.max(1, Math.round(eff.damage)),
        false,
        eff.school,
        proc.name,
        'hit',
        true,
        undefined,
        false,
      );
      let dmg = eff.damage;
      let from = target;
      let hops = 0;
      // hostilesInRadius returns a materialized, deterministically ordered array, so
      // walking it while dealDamage may kill an entry is safe (no live re-bucketing).
      for (const m of ctx.hostilesInRadius(wielder, target.pos, eff.radius)) {
        if (hops >= eff.jumps) break;
        if (m.id === target.id || m.dead) continue;
        dmg *= eff.falloff;
        ctx.emit({
          type: 'spellfx',
          sourceId: from.id,
          targetId: m.id,
          school: eff.school,
          fx: 'projectile',
        });
        ctx.dealDamage(
          wielder,
          m,
          Math.max(1, Math.round(dmg)),
          false,
          eff.school,
          proc.name,
          'hit',
          true,
          undefined,
          false,
        );
        from = m;
        hops++;
      }
      break;
    }
    case 'attackSlow':
      ctx.applyAura(target, {
        id: `${proc.id}_slow`,
        name: eff.name,
        kind: 'attackspeed',
        remaining: eff.duration,
        duration: eff.duration,
        value: eff.mult, // > 1 lengthens the swing interval (slower attacks)
        sourceId: wielder.id,
        school: 'nature',
      });
      break;
    case 'dot':
      ctx.applyAura(target, {
        id: proc.id,
        name: eff.name,
        kind: 'dot',
        remaining: eff.duration,
        duration: eff.duration,
        value: Math.max(1, Math.round(eff.perTick)),
        tickInterval: eff.interval,
        tickTimer: eff.interval,
        sourceId: wielder.id,
        school: eff.school,
      });
      break;
    case 'hot':
      ctx.applyAura(target, {
        id: proc.id,
        name: eff.name,
        kind: 'hot',
        remaining: eff.duration,
        duration: eff.duration,
        value: Math.max(1, Math.round(eff.perTick)),
        tickInterval: eff.interval,
        tickTimer: eff.interval,
        sourceId: wielder.id,
        school: 'nature',
      });
      break;
    case 'selfBuff':
      // The crusader shape: the proc empowers the WIELDER. Keyed on the
      // proc's own aura id, so a re-proc refreshes the running buff rather
      // than stacking a second copy.
      ctx.applyAura(wielder, {
        id: `${proc.id}_buff`,
        name: eff.name,
        kind: eff.buff,
        remaining: eff.duration,
        duration: eff.duration,
        value: eff.value,
        sourceId: wielder.id,
        school: eff.school,
      });
      break;
    case 'selfHeal':
      // Crit-free (canCrit false: draws no rng) and proc-free
      // (canTriggerWeaponProcs false: a heal-trigger proc must never
      // re-enter runWeaponProcs through its own heal).
      ctx.applyHeal(
        wielder,
        wielder,
        Math.max(1, Math.round(eff.amount)),
        proc.name,
        null,
        false,
        false,
      );
      break;
  }
}
