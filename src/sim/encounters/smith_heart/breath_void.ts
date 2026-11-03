// The Storm Cornice's void and the guardian's tether (docs/design/raid/
// smith_heart.md section 7.2): what lies past the gaps, and the one body
// that never goes there.
//
//   Over the lip       a body that leaves the floor by a gap is said once
//                      (the raid warning, Thessaly's line, the cue).
//   The void           a body of this claim that has gone over and come
//                      down is dead, in the fight or out of it, whatever
//                      shields it: the void is not a hit to absorb. An
//                      immunity (/dev god, a bubble, an ice block) swallows
//                      the fall's damage, so the void finishes it with a
//                      death of its own (Jose's playtest: he walked out in
//                      god mode and stood alive on the void's floor). Its
//                      body is laid back on the Cornice's floor by the gap
//                      (voidCorpseSpot), so no resurrection lands in the
//                      void again. A real game master (gm, or the profiler's
//                      invulnerable stand-in) is never killed, as the shared
//                      wipe spares them (encounter_wipe.ts): set back on the
//                      floor instead.
//   The tether         the guardian is the Cornice's: a target off its floor
//                      and its climb (fallen, over a gap, in the void)
//                      leaves the threat table at once (the guardian turns to
//                      whoever is left; nobody left is a wipe), and a step the
//                      mob AI took off the floor is undone, so it never walks
//                      out through a gap after anyone.
//
// Zero rng; positions are claim-local yards.

import { BREATH, SMITH_HEART_HEIGHTS } from '../../content/smith_heart_layout';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import type { Entity } from '../../types';
import { thessalyOf } from './breath_gale';
import {
  fellFromCornice,
  inBreathArena,
  lipDistance,
  onCorniceApproach,
  voidCorpseSpot,
} from './breath_geometry';
import { BREATH_CUES } from './breath_ids';
import { type BreathScope, corniceListeners, voidCandidates } from './breath_scope';
import { breathSay } from './breath_voice';

/** How far under the Cornice's floor a body counts as off it (yards): the
 *  floor is flat, so anything lower has left it (a fall, the void). */
const OFF_FLOOR_DROP = 3;
/** The climb's foot (its lowest walk, the Breath's high landing). */
const HIGH_CLIMB = SMITH_HEART_HEIGHTS.breathHigh;

/** A body over an open lip is said once each (the fight's warning). */
export function stepOverLip(s: Pick<BreathScope, 'ctx' | 'inst' | 'st' | 'boss'>): void {
  const o = s.ctx.instanceOriginOf(s.inst);
  for (const p of corniceListeners(s.ctx, s.inst)) {
    if (p.dead || p.ghost) continue;
    const lx = p.pos.x - o.x;
    const lz = p.pos.z - o.z;
    const ly = p.pos.y;
    const off = !inBreathArena(lx, lz) && ly < BREATH.cornice.h - 0.6 && ly > BREATH.cornice.h - 40;
    if (!off || s.st.overLip.includes(p.id) || !gapNear(lx, lz)) continue;
    s.st.overLip.push(p.id);
    s.ctx.emit({
      type: 'spellfxAt',
      x: p.pos.x,
      z: p.pos.z,
      school: 'nature',
      fx: 'burst',
      radius: 2,
      ability: BREATH_CUES.fall,
    });
    breathSay(s, thessalyOf(s.ctx, s.inst), 'thessaly', 'fall');
  }
}

/** Every body of the claim that has come down in the void dies, fighting or
 *  not. The fall's own hit first (the death recap and the deeds read it);
 *  whatever survives it (an immunity) dies anyway; a game master is set back
 *  on the floor instead. The body is laid back by the gap it fell through. */
export function stepVoidDeaths(ctx: SimContext, inst: InstanceSlot): void {
  const o = ctx.instanceOriginOf(inst);
  for (const p of voidCandidates(ctx, inst)) {
    if (p.dead || p.ghost) continue;
    const lx = p.pos.x - o.x;
    const lz = p.pos.z - o.z;
    if (!fellFromCornice(lx, lz, p.pos.y, p.onGround)) continue;
    const back = voidCorpseSpot(lx, lz);
    if (p.gm || (p.profilerInvulnerable && ctx.devCommands)) {
      layOnFloor(ctx, p, o.x + back.x, o.z + back.z);
      continue;
    }
    ctx.dealDamage(null, p, p.hp + p.maxHp * 10, false, 'physical', 'Falling', 'hit', true);
    if (!p.dead) {
      ctx.emit({
        type: 'damage',
        sourceId: -1,
        targetId: p.id,
        amount: p.hp,
        crit: false,
        school: 'physical',
        ability: 'Falling',
        kind: 'hit',
      });
      ctx.handleDeath(p, null, 'Falling');
    }
    layOnFloor(ctx, p, o.x + back.x, o.z + back.z);
  }
}

/** Set a body (alive or dead) down on the floor at world (x, z), at rest. */
export function layOnFloor(ctx: SimContext, p: Entity, x: number, z: number): void {
  const at = ctx.groundPos(x, z);
  p.pos = at;
  p.prevPos = { ...at };
  p.vx = 0;
  p.vy = 0;
  p.vz = 0;
  p.onGround = true;
  p.jumping = false;
  p.fallStartY = at.y;
  ctx.rebucket(p);
}

/** Is (x, z, y) on the Cornice's fighting floor (not below it)? */
function onCornice(x: number, z: number, y: number): boolean {
  return y > BREATH.cornice.h - OFF_FLOOR_DROP && inBreathArena(x, z);
}

/** May the guardian keep a target at (x, z, y): on its floor or its climb
 *  (the way up: a pull from the climb is a pull), never fallen below them? */
function keepable(x: number, z: number, y: number): boolean {
  return y > HIGH_CLIMB - OFF_FLOOR_DROP && onCorniceApproach(x, z);
}

/**
 * Hold the guardian to its Cornice (after the mob AI moved it this tick):
 * every threat entry off the floor is dropped (and the guardian turned to
 * whoever is left), a step that left the floor is undone to the last spot
 * on it.
 */
export function tetherGuardian(s: Pick<BreathScope, 'ctx' | 'inst' | 'st' | 'boss'>): void {
  const { ctx, boss, st } = s;
  const o = ctx.instanceOriginOf(s.inst);
  let lost = false;
  const off = (id: number): boolean => {
    const e = ctx.entities.get(id);
    return !e || e.dead || !keepable(e.pos.x - o.x, e.pos.z - o.z, e.pos.y);
  };
  for (const id of [...boss.threat.keys()]) if (off(id)) boss.threat.delete(id);
  if (boss.aggroTargetId !== null && off(boss.aggroTargetId)) {
    boss.aggroTargetId = null;
    lost = true;
  }
  if (boss.forcedTargetId !== null && off(boss.forcedTargetId)) {
    boss.forcedTargetId = null;
    boss.forcedTargetTimer = 0;
    lost = true;
  }
  if (lost) ctx.retargetMob(boss);
  const lx = boss.pos.x - o.x;
  const lz = boss.pos.z - o.z;
  if (onCornice(lx, lz, boss.pos.y)) {
    if (st.floorSpot) {
      st.floorSpot.x = boss.pos.x;
      st.floorSpot.y = boss.pos.y;
      st.floorSpot.z = boss.pos.z;
    } else st.floorSpot = { x: boss.pos.x, y: boss.pos.y, z: boss.pos.z };
  } else if (st.floorSpot) {
    boss.pos.x = st.floorSpot.x;
    boss.pos.y = st.floorSpot.y;
    boss.pos.z = st.floorSpot.z;
    boss.prevPos = { ...boss.pos };
    ctx.rebucket(boss);
  }
}

/** Is (x, z) by an open lip (a body leaving the floor here went over it)?
 *  Since the open rim, anywhere along the Cornice's edge but the climb. */
function gapNear(x: number, z: number): boolean {
  return lipDistance(x, z) <= 4 && !onCorniceApproach(x, z);
}
