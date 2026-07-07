// Legendary weapon procs ("chance on action" effects), a self-contained combat
// system behind the SimContext seam. When the wielder lands a melee swing, a
// damaging spell, or a heal, each matching proc on the equipped mainhand rolls once
// and, on success, fires its effects: a Thunderfury-style chain arc, an attack-speed
// slow, a damage-over-time, or a heal-over-time.
//
// Determinism / parity: the proc's rng roll only happens when the wielder actually
// carries a proc weapon with a proc for THIS trigger. Ordinary gear (everything but
// the two legendaries) draws no rng here, so the shared draw order, and every parity
// golden that equips no legendary, is unchanged. The `proc.trigger !== trigger` skip
// and the `target.dead` guard both short-circuit BEFORE the rng draw.
//
// src/sim-pure: reaches Sim only through SimContext (rng/emit/applyAura/dealDamage/
// hostilesInRadius); no DOM/Three/Math.random.

import { ITEMS } from '../data';
import { meetsLevelRequirement } from '../item_level_req';
import type { SimContext } from '../sim_context';
import type { Entity, WeaponProc, WeaponProcEffect, WeaponProcTrigger } from '../types';

// Roll every proc on the wielder's equipped mainhand that matches `trigger`, and
// apply the effects of each that fires. `target` is the primary target of the
// action (the struck enemy, the nuked enemy, or the healed ally).
export function runWeaponProcs(
  ctx: SimContext,
  wielder: Entity,
  target: Entity,
  trigger: WeaponProcTrigger,
): void {
  if (target.dead) return;
  // Entity.mainhandItemId stays populated for a worn OVER-LEVEL weapon (so the
  // model keeps rendering) while recalcPlayerStats treats that weapon as inert.
  // Mirror the level gate here so an inert weapon's procs are inert too (the
  // equip gate makes this unreachable today, but a restored save could carry
  // one). All these guards short-circuit BEFORE any rng draw.
  const id = wielder.mainhandItemId;
  if (!id) return;
  const item = ITEMS[id];
  if (item?.kind !== 'weapon' || !item.weaponProcs) return;
  if (!meetsLevelRequirement(wielder.level, item)) return;
  const procs = item.weaponProcs;
  for (const proc of procs) {
    if (proc.trigger !== trigger) continue;
    if (!ctx.rng.chance(proc.chance)) continue;
    for (const eff of proc.effects) fireEffect(ctx, wielder, target, proc, eff);
  }
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
