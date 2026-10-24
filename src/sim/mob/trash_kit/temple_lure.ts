// The Moonlit Siren's Call of the Shallows (MobTemplate.trashKit.temple.lure),
// the trash pass's second wave on the engine's line-of-sight rule (G6): a
// kickable 3 s song at one player past the tank. While it runs the victim is
// drawn toward her (a slow on their own legs and a drag at `pull` yards a
// second, `heroicPull` on heroic), and if the song lands (the bar runs out,
// or the victim is drawn all the way to her) they are Song-Struck: stunned
// `stun` seconds (`heroicStun` on heroic). Three answers, any group has one:
// kick the song, stun the siren (a stun breaks every kit bar), or the victim
// breaks her line of sight behind a column, which breaks the song outright.
//
// Run through the Temple extension (temple_extension.ts): its bar rides the
// driver's cast machinery; this module only holds the drag, the sight break
// and the landing. Zero rng: the victim is a hashed pick past the tank
// (wildheart_hunt.ts pickPastTank), and nothing here rolls.

import { pullToward } from '../../pull_toward';
import type { SimContext } from '../../sim_context';
import { DT, dist2d, type Entity, type TrashKitDef, type TrashKitState } from '../../types';
import {
  TEMPLE_CALL_OF_THE_SHALLOWS,
  TEMPLE_SHALLOWS_BROKEN,
  TEMPLE_SHALLOWS_DRAW,
  TEMPLE_SONG_STRUCK,
} from './temple_cast_ids';
import { pickPastTank } from './wildheart_hunt';

/** The slow the song lays on its victim's own legs, refreshed every tick
 *  while it runs so it lapses a beat after the song ends, kicked or not. */
const DRAW_HOLD = 0.25;
/** How much of their own run speed the drawn victim keeps. */
export const SHALLOWS_DRAW_SLOW = 0.5;

/** The song's victim: a hashed pick past the tank within its range. */
export function lureTarget(
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): Entity | null {
  const def = kit.temple?.lure;
  if (!def) return null;
  return pickPastTank(players, mob, def.range, st.casts);
}

/** The song broke (a kick, a stun): its victim keeps no draw. */
export function dropDraw(ctx: SimContext, mob: Entity, victimId: number | null): void {
  const victim = victimId !== null ? ctx.entities.get(victimId) : undefined;
  if (!victim) return;
  victim.auras = victim.auras.filter(
    (a) => !(a.id === TEMPLE_SHALLOWS_DRAW && a.sourceId === mob.id),
  );
}

function breakSong(ctx: SimContext, mob: Entity, victim: Entity): void {
  mob.castingAbility = null;
  mob.castRemaining = 0;
  mob.castTotal = 0;
  mob.castTargetId = null;
  mob.channeling = false;
  victim.auras = victim.auras.filter((a) => a.id !== TEMPLE_SHALLOWS_DRAW);
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: victim.id,
    school: 'arcane',
    fx: 'ccImpact',
    ability: TEMPLE_SHALLOWS_BROKEN,
  });
}

/**
 * One tick of a song in flight (called by the extension's upkeep before the
 * driver steps the bar): the victim out of her sight breaks it; else they
 * are drawn in, and one drawn all the way to her ends the bar now (the
 * driver lands it this tick). Returns 'broken', 'arrived' or 'drawing'
 * ('idle' when no song runs).
 */
export function stepLure(
  ctx: SimContext,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  heroic: boolean,
): 'idle' | 'broken' | 'arrived' | 'drawing' {
  const def = kit.temple?.lure;
  const cast = st.cast;
  if (!def || !cast || cast.key !== 'lure' || mob.castingAbility !== cast.castId) return 'idle';
  const victim = cast.targetId !== null ? ctx.entities.get(cast.targetId) : undefined;
  if (!victim || victim.dead || victim.hp <= 0) return 'idle';
  if (!ctx.hasLineOfSight(mob, victim)) {
    breakSong(ctx, mob, victim);
    return 'broken';
  }
  // Laid once, then only its clock is wound: no aura event every tick.
  const draw = victim.auras.find((a) => a.id === TEMPLE_SHALLOWS_DRAW && a.sourceId === mob.id);
  if (draw) draw.remaining = DRAW_HOLD;
  else
    ctx.applyAura(victim, {
      id: TEMPLE_SHALLOWS_DRAW,
      name: def.name,
      kind: 'slow',
      remaining: DRAW_HOLD,
      duration: DRAW_HOLD,
      value: SHALLOWS_DRAW_SLOW,
      sourceId: mob.id,
      school: def.school,
    });
  const pull = heroic ? def.heroicPull : def.pull;
  pullToward(ctx, victim, mob.pos.x, mob.pos.z, pull * DT, def.reach);
  if (dist2d(victim.pos, mob.pos) <= def.reach + 0.05) {
    mob.castRemaining = 0;
    return 'arrived';
  }
  return 'drawing';
}

/** The song landed: its victim, still in her sight, is Song-Struck. Returns
 *  true when the stun was laid. */
export function landLure(
  ctx: SimContext,
  mob: Entity,
  kit: TrashKitDef,
  targetId: number | null,
  heroic: boolean,
): boolean {
  const def = kit.temple?.lure;
  const victim = targetId !== null ? ctx.entities.get(targetId) : undefined;
  if (!def || !victim || victim.dead || victim.hp <= 0) return false;
  victim.auras = victim.auras.filter((a) => a.id !== TEMPLE_SHALLOWS_DRAW);
  if (!ctx.hasLineOfSight(mob, victim)) {
    breakSong(ctx, mob, victim);
    return false;
  }
  const seconds = heroic ? def.heroicStun : def.stun;
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: victim.id,
    school: def.school,
    fx: 'heavyBolt',
    ability: TEMPLE_CALL_OF_THE_SHALLOWS,
  });
  ctx.applyAura(victim, {
    id: TEMPLE_SONG_STRUCK,
    name: def.stunName,
    kind: 'stun',
    remaining: seconds,
    duration: seconds,
    value: 0,
    sourceId: mob.id,
    school: def.school,
  });
  return true;
}
