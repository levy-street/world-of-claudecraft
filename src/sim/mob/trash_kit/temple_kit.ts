// The trash kit's Drowned Temple mechanics (MobTemplate.trashKit lullaby,
// carapace, detonate): the Pale Choir Acolyte's Lullaby, the Pearlguard
// Sentinel's Pearl Carapace and the Tidewisp's burst. A sibling of driver.ts,
// which routes these keys here.
//
//   lullaby   an interruptible song at one player in reach (never the one the
//             singer is fighting while anyone else is in reach): a sleep that
//             breaks on damage. Kick it, or wake the sleeper with a hit.
//   carapace  once per pull under a health share, the pearl shell closes: a
//             self absorb shield worth a share of its maximum health.
//   detonate  a seeker that bursts on reaching its victim: a splash round it
//             (and a chill, when it has one), and it is gone. Kill it before
//             it arrives. A wisp swollen by heroic merges (temple_tide.ts)
//             bursts wider and harder.
//
// The Temple's own key block (trashKit.temple: the vigil, the oath, the
// lullaby's echo, the gaze, the whirlpool, the spark, the merge) runs through
// the driver's extension seam (temple_extension.ts).
//
// Zero rng in every pick (the lullaby's victim is the kit's hash over the
// players in reach, the tank last); the only draws are the burst's damage
// rolls, in roster order.

import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { dist2d, type Entity, type TrashKitDef, type TrashKitState } from '../../types';
import { kitHash, livingInReach } from './targets';
import {
  TEMPLE_LULLABY_SLEEP,
  TEMPLE_PEARL_CARAPACE,
  TEMPLE_TIDEWISP_BURST,
  TEMPLE_TIDEWISP_CHILL,
} from './temple_cast_ids';
import { startLullabyEcho } from './temple_choir';
import { swellOf } from './temple_tide';

/** The absorb aura the Pearl Carapace closes over its wearer. */
export const TEMPLE_CARAPACE_AURA = 'temple_pearl_carapace_ward';

/** The Lullaby's victim: a hashed pick among the living players in reach,
 *  leaving out the one the singer is fighting unless nobody else is there. */
export function pickLullabyTarget(
  players: readonly Entity[],
  singer: Entity,
  range: number,
  salt: number,
): Entity | null {
  const inReach = livingInReach(players, singer.pos, range);
  if (inReach.length === 0) return null;
  const others = inReach.filter((p) => p.id !== singer.aggroTargetId);
  const pool = others.length > 0 ? others : inReach;
  return pool[kitHash(singer.id, salt) % pool.length];
}

/** Can the Lullaby start now? Returns its victim. */
export function lullabyReady(
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): { ok: boolean; target: Entity | null } {
  const def = kit.lullaby;
  const target = def ? pickLullabyTarget(players, mob, def.range, st.casts) : null;
  return target ? { ok: true, target } : { ok: false, target: null };
}

/** The Lullaby's bar ran out: its victim falls asleep (a hit wakes them).
 *  On heroic a kit with a `temple.lullabyEcho` starts the echo off them. */
export function landLullaby(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  targetId: number | null,
  st: TrashKitState,
): void {
  const def = kit.lullaby;
  const target = targetId !== null ? ctx.entities.get(targetId) : undefined;
  if (!def || !target || target.dead) return;
  if (dist2d(target.pos, mob.pos) > def.range + 5) return;
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: target.id,
    school: def.school,
    fx: 'heavyBolt',
    ability: def.castId,
  });
  ctx.applyAura(target, {
    id: TEMPLE_LULLABY_SLEEP,
    name: def.name,
    kind: 'incapacitate',
    remaining: def.seconds,
    duration: def.seconds,
    value: 0,
    sourceId: mob.id,
    school: def.school,
    // A sleep: any hit wakes the sleeper.
    breaksOnDamage: true,
  });
  startLullabyEcho(ctx, inst, mob, kit, st, target);
}

/** Once per pull under its health share the pearl shell closes over the mob.
 *  Returns true on the tick it closes. */
export function stepCarapace(
  ctx: SimContext,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
): boolean {
  const def = kit.carapace;
  if (!def || st.carapaced || mob.maxHp <= 0) return false;
  if (mob.hp / mob.maxHp >= def.belowHpPct) return false;
  st.carapaced = true;
  ctx.applyAura(mob, {
    id: TEMPLE_CARAPACE_AURA,
    name: def.name,
    kind: 'absorb',
    remaining: def.seconds,
    duration: def.seconds,
    value: Math.max(1, Math.round(mob.maxHp * def.shieldPct)),
    sourceId: mob.id,
    school: 'physical',
  });
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: mob.id,
    school: 'arcane',
    fx: 'wardBloom',
    ability: TEMPLE_PEARL_CARAPACE,
  });
  return true;
}

/** A seeker within reach of its victim bursts: a splash round it, then it is
 *  gone from the world (no corpse, no second burst). Returns true when it burst. */
export function stepDetonate(
  ctx: SimContext,
  mob: Entity,
  kit: TrashKitDef,
  players: readonly Entity[],
  owners: readonly Entity[],
): boolean {
  const def = kit.detonate;
  if (!def || mob.aggroTargetId === null) return false;
  const victim = ctx.entities.get(mob.aggroTargetId);
  if (!victim || victim.dead || dist2d(victim.pos, mob.pos) > def.reach) return false;
  // A wisp swollen by heroic merges bursts wider and harder (temple_tide.ts).
  const swell = swellOf(mob);
  const merge = kit.temple?.merge;
  const radius = def.radius + (merge ? merge.radiusPer * swell : 0);
  const mult = 1 + (merge ? merge.damagePer * swell : 0);
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: mob.id,
    school: def.school,
    fx: 'nova',
    ability: TEMPLE_TIDEWISP_BURST,
  });
  for (const p of livingInReach(players, mob.pos, radius)) {
    const amount = Math.max(
      1,
      Math.round(ctx.rng.range(def.min, def.max) * (mob.mechanicDamageMult ?? 1) * mult),
    );
    ctx.dealDamage(mob, p, amount, false, def.school, def.name, 'hit', true);
    // The moon-water's chill: whoever it caught wades slow a moment.
    if (def.slow && !p.dead) {
      ctx.applyAura(p, {
        id: TEMPLE_TIDEWISP_CHILL,
        name: def.name,
        kind: 'slow',
        remaining: def.slow.seconds,
        duration: def.slow.seconds,
        value: def.slow.mult,
        sourceId: mob.id,
        school: def.school,
      });
    }
  }
  for (const owner of owners) owner.summonedIds = owner.summonedIds.filter((id) => id !== mob.id);
  for (const meta of ctx.players.values()) {
    const e = ctx.entities.get(meta.entityId);
    if (e?.targetId === mob.id) e.targetId = null;
  }
  mob.trashKit = undefined;
  ctx.dropEntity(mob.id);
  return true;
}
