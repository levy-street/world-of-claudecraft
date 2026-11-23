// G6, the trash engine's line-of-sight nova (TrashKitDef.nova): a bar, then a
// blast round the caster on every player within its radius who can SEE it.
// Two answers, and a group may use either: kick it (its cast id registered in
// the dungeon's kit cast table, mob/healer_channel.ts), or break line of sight
// behind a wall, a pillar or a combat wall (combat_walls.ts) before it lands.
// Every `unstoppableEvery`-th cast runs under `unstoppableCastId`, an id no
// cast table registers, so that one can only be hidden from; the renderer
// draws it with no kick glyph. An optional silence lands on everyone it hits.
//
// Zero rng in every pick (players in entity-id order); the only draws are the
// damage rolls, in that order.

import type { SimContext } from '../../sim_context';
import type { Entity, TrashKitDef } from '../../types';
import { anyLivingInReach, livingInReach } from './targets';

/** The silence aura id a nova leaves (its look keys on the nova's cast id). */
export const KIT_NOVA_SILENCE = 'trash_kit_nova_silence';

/** The cast id this pull's next nova runs under: the unstoppable one every
 *  `unstoppableEvery`-th cast (1-based), else the kickable one. */
export function novaCastIdFor(def: NonNullable<TrashKitDef['nova']>, novasCast: number): string {
  const every = def.unstoppableEvery ?? 0;
  if (every > 0 && def.unstoppableCastId && (novasCast + 1) % every === 0)
    return def.unstoppableCastId;
  return def.castId;
}

/** Can the nova start now? Only when a living player stands in its radius. */
export function novaReady(mob: Entity, kit: TrashKitDef, players: readonly Entity[]): boolean {
  const def = kit.nova;
  return !!def && anyLivingInReach(players, mob.pos, def.radius);
}

/** The players a landing nova strikes: in its radius and in the caster's
 *  line of sight, entity-id order. */
export function novaVictims(
  ctx: SimContext,
  mob: Entity,
  radius: number,
  players: readonly Entity[],
): Entity[] {
  return livingInReach(players, mob.pos, radius).filter((p) => ctx.hasLineOfSight(mob, p));
}

/** The bar ran out: blast every player who can see the caster. Returns how
 *  many it struck. */
export function landNova(
  ctx: SimContext,
  mob: Entity,
  kit: TrashKitDef,
  castId: string,
  players: readonly Entity[],
): number {
  const def = kit.nova;
  if (!def) return 0;
  ctx.emit({
    type: 'spellfx',
    sourceId: mob.id,
    targetId: mob.id,
    school: def.school,
    fx: 'nova',
    ability: castId,
  });
  const victims = novaVictims(ctx, mob, def.radius, players);
  for (const p of victims) {
    const amount = Math.max(
      1,
      Math.round(ctx.rng.range(def.min, def.max) * (mob.mechanicDamageMult ?? 1)),
    );
    ctx.dealDamage(mob, p, amount, false, def.school, def.name, 'hit', true);
    if (def.silence && !p.dead) {
      ctx.applyAura(p, {
        id: KIT_NOVA_SILENCE,
        name: def.name,
        kind: 'silence',
        remaining: def.silence,
        duration: def.silence,
        value: 0,
        sourceId: mob.id,
        school: def.school,
      });
    }
  }
  return victims.length;
}
