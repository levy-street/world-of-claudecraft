// The trash engine's brand (TrashKitDef.brand) and the dungeon's quench zones
// (DungeonDef.quenchZones): an interruptible bar at one player in reach,
// never the one the caster fights while anyone else stands there, who must
// stay in its line of sight through the bar; when it lands the victim burns
// for its `seconds`, and the moment they stand in one of the dungeon's quench
// zones (meltwater, snow, a fountain) the brand hisses out. The game has
// almost no dispels, so this is the victim's own answer: run to the water.
// The other answers are the group's: kick it, or hide from it (a wall, a
// pillar, a combat wall: a brand whose victim is out of sight when the bar
// ends fizzles).
//
// First consumer: the Broodsworn Goadsmith's Branding Iron in the Gravewyrm
// Sanctum. Zero rng (the victim is the kit's hash over the players in reach
// and in sight); the brand's ticks are an ordinary dot aura.

import { DUNGEONS, instanceOrigin } from '../../data';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { type Aura, dist2d, type Entity, type TrashKitDef, type TrashKitState } from '../../types';
import { kitOf } from './kit_of';
import { kitHash, livingInReach } from './targets';

/** The spellfx ability id of a brand put out in a quench zone (steam). */
export const BRAND_QUENCHED = 'trash_brand_quenched';
/** The spellfx ability id of a brand whose victim was out of sight (fizzle). */
export const BRAND_FIZZLED = 'trash_brand_fizzled';

/** The brand's victim: a hashed pick among the living players in reach the
 *  caster can see, leaving out the one it fights unless nobody else is there. */
export function pickBrandTarget(
  ctx: SimContext,
  players: readonly Entity[],
  mob: Entity,
  range: number,
  salt: number,
): Entity | null {
  const seen = livingInReach(players, mob.pos, range).filter((p) => ctx.hasLineOfSight(mob, p));
  if (seen.length === 0) return null;
  const others = seen.filter((p) => p.id !== mob.aggroTargetId);
  const pool = others.length > 0 ? others : seen;
  return pool[kitHash(mob.id, salt) % pool.length];
}

/** Can the brand start now? Returns its victim. */
export function brandReady(
  ctx: SimContext,
  mob: Entity,
  kit: TrashKitDef,
  st: TrashKitState,
  players: readonly Entity[],
): { ok: boolean; target: Entity | null } {
  const def = kit.brand;
  if (!def || livingInReach(players, mob.pos, def.range).length === 0)
    return { ok: false, target: null };
  const target = pickBrandTarget(ctx, players, mob, def.range, st.casts);
  if (target) return { ok: true, target };
  // Everyone in reach is hiding: look again in a moment, not every tick (the
  // sight test is the expensive half).
  st.timers.brand = BRAND_SIGHT_RETRY;
  return { ok: false, target: null };
}

/** Seconds a brand waits to look again when everyone in reach is hidden. */
export const BRAND_SIGHT_RETRY = 0.5;

/** The bar ran out: the brand lands if its victim is still in reach and in
 *  sight; out of sight it fizzles. Returns true when it landed. */
export function landBrand(
  ctx: SimContext,
  mob: Entity,
  kit: TrashKitDef,
  targetId: number | null,
): boolean {
  const def = kit.brand;
  const target = targetId !== null ? ctx.entities.get(targetId) : undefined;
  if (!def || !target || target.dead) return false;
  if (dist2d(target.pos, mob.pos) > def.range + 5 || !ctx.hasLineOfSight(mob, target)) {
    ctx.emit({
      type: 'spellfx',
      sourceId: mob.id,
      targetId: target.id,
      school: def.school,
      fx: 'nova',
      ability: BRAND_FIZZLED,
    });
    return false;
  }
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: target.id,
    school: def.school,
    fx: 'heavyBolt',
    ability: def.castId,
  });
  ctx.applyAura(target, {
    id: def.auraId,
    name: def.auraName,
    kind: 'dot',
    remaining: def.seconds,
    duration: def.seconds,
    value: Math.max(1, Math.round(def.perTick * (mob.mechanicDamageMult ?? 1))),
    tickInterval: def.interval,
    tickTimer: def.interval,
    sourceId: mob.id,
    school: def.school,
  });
  // Remember the victim, so the quench walks only live brands (stepQuench).
  if (!mob.kitBranded) mob.kitBranded = [];
  if (!mob.kitBranded.includes(target.id)) mob.kitBranded.push(target.id);
  return true;
}

/** Is (x, z) (world) inside one of the claim's quench zones? */
export function inQuenchZone(inst: InstanceSlot, x: number, z: number): boolean {
  const def = DUNGEONS[inst.dungeonId];
  const zones = def?.quenchZones;
  if (!zones || zones.length === 0) return false;
  const o = instanceOrigin(def.index, inst.slot);
  for (const q of zones) if (Math.hypot(x - o.x - q.x, z - o.z - q.z) <= q.r) return true;
  return false;
}

/**
 * Put out the brands `caster` left that burn on a player standing in one of
 * the claim's quench zones, and forget the victims whose brand is gone.
 * Driven from the caster's own kit tick (its Entity.kitBranded list, written
 * by landBrand), so a claim with no live brand pays nothing. Returns how many
 * it put out.
 */
export function stepQuench(ctx: SimContext, inst: InstanceSlot, caster: Entity): number {
  const victims = caster.kitBranded;
  if (!victims) return 0;
  const auraId = kitOf(caster)?.brand?.auraId;
  let n = 0;
  for (let i = victims.length - 1; i >= 0; i--) {
    const p = ctx.entities.get(victims[i]);
    const brand =
      p && !p.dead ? p.auras.find((a) => a.id === auraId && a.sourceId === caster.id) : undefined;
    if (!p || !brand) {
      victims.splice(i, 1);
      continue;
    }
    if (!inQuenchZone(inst, p.pos.x, p.pos.z)) continue;
    p.auras.splice(p.auras.indexOf(brand), 1);
    victims.splice(i, 1);
    ctx.emit({ type: 'aura', targetId: p.id, name: brand.name, gained: false });
    ctx.emit({
      type: 'spellfx',
      sourceId: p.id,
      targetId: p.id,
      school: 'frost',
      fx: 'nova',
      ability: BRAND_QUENCHED,
    });
    n++;
  }
  if (victims.length === 0) caster.kitBranded = undefined;
  return n;
}
