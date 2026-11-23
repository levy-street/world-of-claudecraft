// The trash kit's death burst (MobTemplate.trashKit.deathBurst): the mob
// bursts where it fell, `delay` seconds after it dies, a splash round the
// corpse (the Gravewyrm Sanctum's Rime Whelp and Glacier Splinter). A delayed
// burst paints its ring on the floor while it builds (an encounter object the
// client mirrors, drawn by render/death_burst_fx.ts), so the melee has time to
// step out. A sibling of driver.ts, which routes the key here.
//
// Zero rng in every pick (players in entity-id order); the only draws are the
// burst's damage rolls, in roster order.

import { createGroundObject } from '../../entity';
import type { InstanceSlot } from '../../sim';
import type { SimContext } from '../../sim_context';
import { DT, type Entity, type TrashKitDef } from '../../types';
import { splitBurstScale } from './kit_split';
import { livingInReach } from './targets';

/** A death burst's ring building on the floor (scale = its radius). */
export const DEATH_BURST_RING = 'death_burst_ring';

function dropObject(ctx: SimContext, inst: InstanceSlot, id: number | null): void {
  if (id === null) return;
  const at = inst.objectIds.indexOf(id);
  if (at >= 0) inst.objectIds.splice(at, 1);
  if (ctx.entities.has(id)) ctx.dropEntity(id);
}

/** A delayed burst's ring on the floor where the mob fell. */
function spawnBurstRing(ctx: SimContext, inst: InstanceSlot, mob: Entity, radius: number): number {
  const obj = createGroundObject(ctx.nextId++, '', mob.name, ctx.groundPos(mob.pos.x, mob.pos.z));
  obj.templateId = DEATH_BURST_RING;
  obj.dungeonId = inst.dungeonId;
  obj.objectItemId = null;
  obj.lootable = false;
  obj.facing = 0;
  obj.prevFacing = 0;
  obj.scale = radius;
  ctx.addEntity(obj);
  inst.objectIds.push(obj.id);
  return obj.id;
}

/**
 * Drop any burst ring whose mob left the world before it went off (a summoned
 * add despawned with its owner): its burst can no longer fire, so its warning
 * must not linger on the floor. Zero rng; only walks the claim's own rosters.
 */
export function sweepOrphanBurstRings(ctx: SimContext, inst: InstanceSlot): number {
  let rings: number[] | null = null;
  for (const id of inst.objectIds) {
    if (ctx.entities.get(id)?.templateId !== DEATH_BURST_RING) continue;
    rings ??= [];
    rings.push(id);
  }
  if (!rings) return 0;
  const owned = new Set<number>();
  for (const id of inst.mobIds) {
    const ring = ctx.entities.get(id)?.deathBurst?.objectId;
    if (ring !== null && ring !== undefined) owned.add(ring);
  }
  let dropped = 0;
  for (const id of rings) {
    if (owned.has(id)) continue;
    dropObject(ctx, inst, id);
    dropped++;
  }
  return dropped;
}

/**
 * A dead kit mob with a death burst: arm it on the tick it is first seen dead,
 * count it down, and go off once. Returns true on the tick it bursts.
 */
export function stepDeathBurst(
  ctx: SimContext,
  inst: InstanceSlot,
  mob: Entity,
  kit: TrashKitDef,
  players: readonly Entity[],
): boolean {
  const def = kit.deathBurst;
  if (!def) return false;
  // A split body (kit_split.ts) bursts smaller: its ring and its rolls.
  const scale = splitBurstScale(mob);
  // A fed burst grows with its stacks (the Barnacle Crawler's Carrion Glut).
  const stacks = def.perStack ? (mob.trashLife?.gorge ?? 0) : 0;
  const radius = (def.radius + stacks * (def.perStack?.radius ?? 0)) * scale;
  const grow = (1 + stacks * (def.perStack?.damage ?? 0)) * scale;
  let st = mob.deathBurst;
  if (!st) {
    st = { remaining: def.delay, objectId: null, done: false };
    mob.deathBurst = st;
    if (def.delay > 0) {
      st.objectId = spawnBurstRing(ctx, inst, mob, radius);
      ctx.emit({
        type: 'spellfx',
        sourceId: mob.id,
        targetId: mob.id,
        school: def.school,
        fx: 'windup',
        ability: def.castId,
      });
    }
  }
  if (st.done) return false;
  st.remaining -= DT;
  if (st.remaining > 1e-9) return false;
  st.done = true;
  dropObject(ctx, inst, st.objectId);
  st.objectId = null;
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: mob.id,
    school: def.school,
    fx: 'nova',
    ability: def.castId,
  });
  for (const p of livingInReach(players, mob.pos, radius)) {
    const amount = Math.max(
      1,
      Math.round(ctx.rng.range(def.min, def.max) * (mob.mechanicDamageMult ?? 1) * grow),
    );
    ctx.dealDamage(mob, p, amount, false, def.school, def.name, 'hit', true);
    // A slowing burst (the Rime Whelp's Hoarfrost Pop) chills whoever it caught.
    if (def.slow && !p.dead) {
      ctx.applyAura(p, {
        id: `${def.castId}_slow`,
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
  return true;
}
