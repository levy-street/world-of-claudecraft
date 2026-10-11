// The trash engine's hazard pools (KitHazardDef): a patch of something bad on
// the floor that a trash mechanic leaves behind, an encounter object of the
// def's `objectTemplate` the client mirrors (scale = radius), standing for
// `seconds`. Every `tick` seconds each body of its `hits` side inside the
// radius takes a roll: the players (the Scaleguard's heroic Boiling Meltwater)
// or the claim's own mobs (the Soul Brazier toppled onto its pack, a pool the
// group turned on them). The first roll lands one `tick` after it spills, so
// a fresh pool can always be stepped out of.
//
// Zero rng in every pick (players in entity-id order, mobs in roster order);
// the only draws are the damage rolls, in that order (a `pctMaxHp` pool draws
// none).

import { MOBS } from '../../data';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, dist2d, type Entity, type KitHazardDef } from '../../types';
import { dropKitObject, spawnKitObject } from './kit_objects';
import { livingInReach } from './targets';

/** Spill a hazard at (x, z) for `source` (the mob or the player it is
 *  credited to). `mult` scales its rolls (the source's mechanic damage
 *  multiplier on a mob's pool; 1 for a pool a player spilled). */
export function spawnKitHazard(
  ctx: SimContext,
  inst: InstanceSlot,
  source: Entity,
  def: KitHazardDef,
  x: number,
  z: number,
): Entity {
  return spawnKitObject(ctx, inst, def.objectTemplate, def.name, x, z, def.radius, 0, {
    kind: 'hazard',
    def,
    remaining: def.seconds,
    tickTimer: def.tick,
    sourceId: source.id,
  });
}

/** The claim's living trash inside `radius` of (x, z), in roster order:
 *  never a boss, never a control-immune great body. */
function mobsInReach(ctx: SimContext, inst: InstanceSlot, x: number, z: number, radius: number) {
  const out: Entity[] = [];
  const at = { x, y: 0, z };
  for (const id of inst.mobIds) {
    const e = ctx.entities.get(id);
    if (!e || e.dead || e.hp <= 0 || e.kind !== 'mob') continue;
    const t = MOBS[e.templateId];
    if (t?.boss || t?.ccImmune) continue;
    if (dist2d(e.pos, at) > radius) continue;
    out.push(e);
  }
  return out;
}

/**
 * One tick of a hazard pool: count it down, burn what stands in it on its
 * beat, and lift it when its time is up. Returns how many it burned this tick.
 */
export function stepKitHazard(
  ctx: SimContext,
  inst: InstanceSlot,
  obj: Entity,
  players: readonly Entity[],
): number {
  const st = obj.kitObject;
  if (st?.kind !== 'hazard') return 0;
  st.remaining -= DT;
  st.tickTimer -= DT;
  let n = 0;
  if (st.tickTimer <= 1e-9) {
    st.tickTimer += st.def.tick;
    const def = st.def;
    const source = ctx.entities.get(st.sourceId);
    // A pool keeps its own scaling: a mob's pool rides the mob's mechanic
    // multiplier (the heroic transform), a player's spill rides none.
    const mult = source && source.kind === 'mob' ? (source.mechanicDamageMult ?? 1) : 1;
    const victims =
      def.hits === 'players'
        ? livingInReach(players, obj.pos, def.radius)
        : mobsInReach(ctx, inst, obj.pos.x, obj.pos.z, def.radius);
    for (const v of victims) {
      const amount =
        def.pctMaxHp !== undefined
          ? Math.max(1, Math.round(v.maxHp * def.pctMaxHp))
          : Math.max(1, Math.round(ctx.rng.range(def.min, def.max) * mult));
      // A pool whose source has left the world still burns, as itself.
      ctx.dealDamage(source ?? obj, v, amount, false, def.school, def.name, 'hit', true);
      n++;
    }
  }
  if (st.remaining <= 1e-9) dropKitObject(ctx, inst, obj.id);
  return n;
}
