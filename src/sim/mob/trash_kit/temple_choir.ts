// The Drowned Temple's choir keys (MobTemplate.trashKit.temple): the faithful
// protect their singers. A sibling of temple_kit.ts, run through the Temple
// extension (temple_extension.ts).
//
//   vigil        Shrine Vigil: while two or more Drowned Pilgrims of the fight
//                kneel near a singer, she wears a ward that turns most damage
//                (a shield_wall aura kept up tick by tick). Each praying
//                pilgrim wears a marker the renderer threads to her. Kill the
//                pilgrims first; the ward falls the tick the count drops.
//   guard        Heroic only, Moonset Oath: while a singer of the guard's pack
//                stands within reach and is CASTING, the guard takes a share
//                of every hit she takes (the oath is an aura on her whose
//                source is the guard; combat/damage.ts calls oathShare). A
//                stun, a sleep, a sheep, or pulling the guard away breaks it.
//   lullabyEcho  Heroic only, Lullaby Echo: an unkicked Lullaby echoes off its
//                sleeper; after a beat, then every second while they sleep,
//                everyone awake beside them falls asleep too (once each). The
//                sleeper wears the echo ring the renderer draws.
//
// Zero rng: pilgrims and guards in roster order, players in entity-id order.

import { MOBS } from '../../data';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, dist2d, type Entity, type TrashKitDef, type TrashKitState } from '../../types';
import { livingInReach } from './targets';
import {
  TEMPLE_LULLABY_ECHO,
  TEMPLE_LULLABY_SLEEP,
  TEMPLE_MOONSET_OATH,
  TEMPLE_OATH_KEEPER,
  TEMPLE_OATH_SHARE,
  TEMPLE_SHRINE_VIGIL,
  TEMPLE_VIGIL_PRAYER,
} from './temple_cast_ids';

/** A kept-up aura lives this long past its last refresh, so it falls within
 *  a tick or two of its cause ending (and never needs a teardown pass). */
const KEPT_UP = 0.15;

function aura(e: Entity, id: string) {
  return e.auras.find((a) => a.id === id);
}

function dropAura(ctx: SimContext, e: Entity, id: string): void {
  const a = aura(e, id);
  if (!a) return;
  e.auras = e.auras.filter((x) => x !== a);
  ctx.emit({ type: 'aura', targetId: e.id, name: a.name, gained: false });
}

/** Keep a marker-style aura up on `e` for another beat (applied once, then
 *  only its clock is wound, so no aura event fires each tick). */
function keepUp(
  ctx: SimContext,
  e: Entity,
  id: string,
  name: string,
  kind: 'shield_wall' | 'internal_cd',
  value: number,
  sourceId: number,
): void {
  const a = aura(e, id);
  if (a && a.sourceId === sourceId) {
    a.remaining = KEPT_UP;
    a.value = value;
    return;
  }
  if (a) e.auras = e.auras.filter((x) => x !== a);
  ctx.applyAura(e, {
    id,
    name,
    kind,
    remaining: KEPT_UP,
    duration: KEPT_UP,
    value,
    sourceId,
    school: 'arcane',
    undispellable: true,
  });
}

/** Living mobs of the claim of template `templateId`, in the fight, within
 *  `range` of `from`, in roster order. */
function packOf(
  ctx: SimContext,
  inst: InstanceSlot,
  from: Entity,
  templateId: string,
  range: number,
): Entity[] {
  const out: Entity[] = [];
  for (const id of inst.mobIds) {
    if (id === from.id) continue;
    const e = ctx.entities.get(id);
    if (!e || e.dead || e.hp <= 0 || e.kind !== 'mob' || !e.inCombat) continue;
    if (e.templateId !== templateId || dist2d(e.pos, from.pos) > range) continue;
    out.push(e);
  }
  return out;
}

/** Drop marker `id` from every mob of the claim that wears it from `sourceId`
 *  and is not in `keep` (a pilgrim that stopped praying, a singer no longer
 *  sheltered). */
function sweepMarkers(
  ctx: SimContext,
  inst: InstanceSlot,
  id: string,
  sourceId: number,
  keep: readonly Entity[],
): void {
  for (const mid of inst.mobIds) {
    const e = ctx.entities.get(mid);
    if (!e || keep.includes(e)) continue;
    const a = aura(e, id);
    if (a && a.sourceId === sourceId) dropAura(ctx, e, id);
  }
}

// ---- Shrine Vigil ----------------------------------------------------------

/** Keep a singer's Shrine Vigil up while enough pilgrims pray beside her.
 *  Returns how many pilgrims feed it (0: the ward is down). */
export function stepVigil(
  ctx: SimContext,
  inst: InstanceSlot,
  singer: Entity,
  kit: TrashKitDef,
): number {
  const def = kit.temple?.vigil;
  if (!def) return 0;
  const praying = packOf(ctx, inst, singer, def.guardian, def.range);
  if (praying.length < def.min) {
    dropAura(ctx, singer, TEMPLE_SHRINE_VIGIL);
    sweepMarkers(ctx, inst, TEMPLE_VIGIL_PRAYER, singer.id, []);
    return 0;
  }
  sweepMarkers(ctx, inst, TEMPLE_VIGIL_PRAYER, singer.id, praying);
  const reduction = inst.difficulty === 'heroic' ? def.heroicReduction : def.reduction;
  keepUp(ctx, singer, TEMPLE_SHRINE_VIGIL, def.name, 'shield_wall', reduction, singer.id);
  // A bare marker (internal_cd: no slow, no chill, nothing strips it).
  for (const p of praying)
    keepUp(ctx, p, TEMPLE_VIGIL_PRAYER, def.name, 'internal_cd', 1, singer.id);
  return praying.length;
}

// ---- Moonset Oath ----------------------------------------------------------

/** Can this guard keep an oath this tick (not stunned, asleep or sheeped)? */
function guardFree(ctx: SimContext, guard: Entity): boolean {
  if (ctx.isStunned(guard)) return false;
  return !guard.auras.some((a) => a.kind === 'incapacitate' || a.kind === 'polymorph');
}

/** The heroic oath: shelter one casting singer within reach. Returns the
 *  singer's id, or null when the guard shelters nobody this tick. */
export function stepOath(
  ctx: SimContext,
  inst: InstanceSlot,
  guard: Entity,
  kit: TrashKitDef,
): number | null {
  const def = kit.temple?.guard;
  if (!def || inst.difficulty !== 'heroic') return null;
  const singer = guardFree(ctx, guard) ? pickSinger(ctx, inst, guard, def) : null;
  // Whoever this guard sheltered last tick and no longer does is let go.
  sweepMarkers(ctx, inst, TEMPLE_MOONSET_OATH, guard.id, singer ? [singer] : []);
  if (!singer) {
    dropAura(ctx, guard, TEMPLE_OATH_KEEPER);
    return null;
  }
  // Bare markers (internal_cd): the share is the guard's template's.
  keepUp(ctx, singer, TEMPLE_MOONSET_OATH, def.name, 'internal_cd', 1, guard.id);
  keepUp(ctx, guard, TEMPLE_OATH_KEEPER, def.name, 'internal_cd', 1, singer.id);
  return singer.id;
}

/** The casting singer within reach this guard shelters, or null. */
function pickSinger(
  ctx: SimContext,
  inst: InstanceSlot,
  guard: Entity,
  def: NonNullable<NonNullable<TrashKitDef['temple']>['guard']>,
): Entity | null {
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (!e || e.dead || e.hp <= 0 || e.kind !== 'mob' || !e.inCombat) continue;
    if (!def.singers.includes(e.templateId) || e.castingAbility === null) continue;
    if (dist2d(e.pos, guard.pos) > def.range) continue;
    // One guard per singer: another living guard already holds her oath.
    const held = aura(e, TEMPLE_MOONSET_OATH);
    if (held && held.sourceId !== guard.id) {
      const other = ctx.entities.get(held.sourceId);
      if (other && !other.dead && held.remaining > 0) continue;
    }
    return e;
  }
  return null;
}

/** A guard's pull ended: let its singer and its marker go. */
export function endOath(ctx: SimContext, inst: InstanceSlot, guard: Entity): void {
  sweepMarkers(ctx, inst, TEMPLE_MOONSET_OATH, guard.id, []);
  dropAura(ctx, guard, TEMPLE_OATH_KEEPER);
}

/** A singer's pull ended: her ward and her pilgrims' markers go. */
export function endVigil(ctx: SimContext, inst: InstanceSlot, singer: Entity): void {
  dropAura(ctx, singer, TEMPLE_SHRINE_VIGIL);
  sweepMarkers(ctx, inst, TEMPLE_VIGIL_PRAYER, singer.id, []);
}

/** Called from combat/damage.ts for every hit about to land: a mob under a
 *  living guard's Moonset Oath passes the oath's share of `amount` onto that
 *  guard (dealt to the guard now, by the same source); returns what is left
 *  for the singer. A share never redirects twice. */
export function oathShare(
  ctx: SimContext,
  source: Entity | null,
  target: Entity,
  amount: number,
  school: string,
  ability: string | null,
  abilityId: string | null,
): number {
  if (amount <= 0 || target.kind !== 'mob' || abilityId === TEMPLE_OATH_SHARE) return amount;
  if (target.auras.length === 0) return amount;
  const oath = aura(target, TEMPLE_MOONSET_OATH);
  if (!oath || oath.remaining <= 0) return amount;
  const guard = ctx.entities.get(oath.sourceId);
  if (!guard || guard.dead || guard.hp <= 0 || guard.id === target.id) return amount;
  const def = MOBS[guard.templateId]?.trashKit?.temple?.guard;
  if (!def) return amount;
  const share = Math.min(amount, Math.round(amount * def.share));
  if (share <= 0) return amount;
  ctx.dealDamage(
    source,
    guard,
    share,
    false,
    school,
    ability,
    'hit',
    true,
    undefined,
    false,
    false,
    // Already fully modified by the source: never re-apply its outputs.
    true,
    TEMPLE_OATH_SHARE,
  );
  return amount - share;
}

// ---- Lullaby Echo -----------------------------------------------------------

/** A heroic Lullaby just landed on `sleeper`: arm the echo (and its ring). */
export function startLullabyEcho(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  sleeper: Entity,
): void {
  const def = kit.temple?.lullabyEcho;
  if (!def || inst.difficulty !== 'heroic') return;
  const sleep = aura(sleeper, TEMPLE_LULLABY_SLEEP);
  if (!sleep) return;
  endLullabyEcho(ctx, st);
  st.temple ??= {};
  st.temple.echo = { sleeperId: sleeper.id, next: def.delay, slept: [sleeper.id] };
  ctx.applyAura(sleeper, {
    id: TEMPLE_LULLABY_ECHO,
    name: def.name,
    // A bare marker (internal_cd): the ring the renderer draws.
    kind: 'internal_cd',
    remaining: sleep.remaining,
    duration: sleep.remaining,
    value: 1,
    sourceId: mob.id,
    school: 'arcane',
    undispellable: true,
  });
}

/** Lift a running echo's ring and forget it. */
export function endLullabyEcho(ctx: SimContext, st: TrashKitState): void {
  const echo = st.temple?.echo;
  if (!echo || !st.temple) return;
  st.temple.echo = undefined;
  const sleeper = ctx.entities.get(echo.sleeperId);
  if (sleeper) dropAura(ctx, sleeper, TEMPLE_LULLABY_ECHO);
}

/** Advance the echo: it ends with the sleeper's sleep, and on each beat puts
 *  everyone awake within reach of the sleeper to sleep. Returns how many it
 *  put to sleep this tick. */
export function stepLullabyEcho(
  ctx: SimContext,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): number {
  const def = kit.temple?.lullabyEcho;
  const echo = st.temple?.echo;
  if (!def || !echo) return 0;
  const sleeper = ctx.entities.get(echo.sleeperId);
  const sleep = sleeper ? aura(sleeper, TEMPLE_LULLABY_SLEEP) : undefined;
  if (!sleeper || sleeper.dead || !sleep) {
    endLullabyEcho(ctx, st);
    return 0;
  }
  echo.next -= DT;
  if (echo.next > 1e-9) return 0;
  echo.next = def.every;
  ctx.emit({
    type: 'spellfx',
    sourceId: sleeper.id,
    targetId: sleeper.id,
    school: 'arcane',
    fx: 'nova',
    ability: TEMPLE_LULLABY_ECHO,
  });
  let n = 0;
  for (const p of livingInReach(players, sleeper.pos, def.radius)) {
    if (echo.slept.includes(p.id) || aura(p, TEMPLE_LULLABY_SLEEP)) continue;
    echo.slept.push(p.id);
    ctx.applyAura(p, {
      id: TEMPLE_LULLABY_SLEEP,
      name: def.name,
      kind: 'incapacitate',
      remaining: def.seconds,
      duration: def.seconds,
      value: 0,
      sourceId: mob.id,
      school: 'arcane',
      breaksOnDamage: true,
    });
    n++;
  }
  return n;
}
