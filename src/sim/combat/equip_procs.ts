// Weapon and melee enchant procs ("chance on action" effects), a self-contained combat
// system behind the SimContext seam. When the wielder lands a melee swing, a
// damaging spell, or a heal, each matching proc on the equipped mainhand rolls once
// and, on success, fires its effects: a Thunderfury-style chain arc, an attack-speed
// slow, a damage-over-time, or a heal-over-time.
//
// Determinism / parity: ordinary, unenchanted gear draws no rng here. Legendary
// procs retain their trigger, dead-target, and duel-end grace guards BEFORE their
// rng draws. The self-only melee enchant rolls separately on a landed melee hit,
// including a killing blow; no living primary target is required for that buff.
//
// src/sim-pure: reaches Sim only through SimContext (rng/emit/applyAura/dealDamage/
// hostilesInRadius); no DOM/Three/Math.random.

import { ENCHANTS } from '../content/enchants';
import { ITEMS } from '../data';
import { meetsLevelRequirement } from '../item_level_req';
import type { SimContext } from '../sim_context';
import { duelJustEndedBetween } from '../social/duel';
import type { Entity, WeaponProc, WeaponProcEffect, WeaponProcTrigger } from '../types';
import { baseSwingSpeed, isCatForm } from './form_swing';

// Roll every proc on the wielder's equipped mainhand that matches `trigger`, and
// apply the effects of each that fires. `target` is the primary target of the
// action (the struck enemy, the nuked enemy, or the healed ally).
export function runWeaponProcs(
  ctx: SimContext,
  wielder: Entity,
  target: Entity,
  trigger: WeaponProcTrigger,
  weaponItemId?: string | null,
  meleeHand?: 'mainhand' | 'offhand',
): void {
  // Which hand's weapon rolled procs. `undefined` = not specified: fall back to
  // the mainhand (back-compat for the spell/heal/ranged call sites and every
  // existing golden). An explicit id rolls THAT hand's weapon; an explicit
  // `null` means that hand is empty, so nothing procs (an off-hand auto with no
  // off-hand weapon must NOT roll the mainhand's proc, the old dual-wield bug).
  //
  // Entity.mainhandItemId stays populated for a worn OVER-LEVEL weapon (so the
  // model keeps rendering) while recalcPlayerStats treats that weapon as inert.
  // Mirror the level gate here so an inert weapon's procs are inert too (the
  // equip gate makes this unreachable today, but a restored save could carry
  // one). All these guards short-circuit BEFORE any rng draw.
  const id = weaponItemId === undefined ? wielder.mainhandItemId : weaponItemId;
  if (!id) return;
  const item = ITEMS[id];
  if (item?.kind !== 'weapon') return;
  if (!meetsLevelRequirement(wielder.level, item)) return;
  // Keep the historical dead-target skip for the weapon's own procs, including
  // their rng draws, without suppressing the self-only enchant on a killing hit.
  const procs = target.dead ? [] : (item.weaponProcs ?? []);
  for (const proc of procs) {
    if (proc.trigger !== trigger) continue;
    // A hostile persistent-aura proc (dot/attackSlow) landing on the killing
    // blow's own opponent must not outlive the duel it just ended: see
    // duelJustEndedBetween (social/duel.ts). Scoped to persistent effects
    // only, so a heal/hot proc on an ally (or a self-buff) is unaffected. A
    // chainArc-ONLY proc is unaffected too: its damage already goes through
    // dealDamage's own duel-aware clamp, which is where that race is closed.
    // A proc that bundles chainArc WITH a persistent hostile effect (e.g.
    // Thronebane's arc + slow) is skipped whole when gated, which costs only
    // that one already-safe tick of arc damage.
    const isHostilePersistent = proc.effects.some(
      (eff) => eff.kind === 'dot' || eff.kind === 'attackSlow',
    );
    if (isHostilePersistent && duelJustEndedBetween(ctx, target, wielder)) continue;
    if (!ctx.rng.chance(proc.chance)) continue;
    for (const eff of proc.effects) fireEffect(ctx, wielder, target, proc, eff);
  }
  // Explicit hand comes only from the melee hit path. The historical ranged
  // weaponHit call keeps legendary behavior but cannot trigger a melee enchant.
  if (trigger !== 'weaponHit' || !meleeHand || wielder.dead || wielder.kind !== 'player') return;
  const enchantId = ctx.players.get(wielder.id)?.equipmentInstance[meleeHand]?.enchant;
  const enchant = enchantId ? ENCHANTS[enchantId] : undefined;
  const enchantProc = enchant?.weaponProc;
  if (!enchant || !enchantProc) return;
  // Wolf Form has a fixed natural cadence; a slow carried stat stick must not
  // multiply its proc frequency. Bear and ordinary swings keep item base speed.
  const baseSpeed =
    meleeHand === 'mainhand' && isCatForm(wielder) ? baseSwingSpeed(wielder) : item.weapon.speed;
  const chance = Math.min(1, Math.max(0, (enchantProc.ppm * baseSpeed) / 60));
  if (!ctx.rng.chance(chance)) return;
  ctx.applyAura(wielder, {
    id: `${enchant.id}_${meleeHand}`,
    name: enchant.name,
    kind: 'buff_str',
    value: enchantProc.strength,
    remaining: enchantProc.duration,
    duration: enchantProc.duration,
    sourceId: wielder.id,
    school: 'holy',
  });
  ctx.applyHeal(wielder, wielder, enchantProc.heal, enchant.name, enchant.id, false, false);
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
  }
}
