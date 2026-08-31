// Ignivar's perimeter moat is static room geometry, so its authoritative burn
// rides the instance system's existing one-second pulse instead of encounter
// state. It remains active before pull and after the boss dies.

import { DUNGEONS, instanceOrigin } from '../data';
import {
  IGNIVAR_LAVA_MOAT_ABILITY_ID,
  IGNIVAR_LAVA_MOAT_ABILITY_NAME,
  IGNIVAR_LAVA_MOAT_DAMAGE_FRACTION,
  ignivarArenaPointInLava,
} from '../ignivar_arena';
import { IGNIVAR_RAID_ARENA_ID } from '../ignivar_raid_ids';
import type { SimContext } from '../sim_context';

export function tickIgnivarLavaHazard(ctx: SimContext): void {
  const dungeon = DUNGEONS[IGNIVAR_RAID_ARENA_ID];
  for (const instance of ctx.instances) {
    if (instance.partyKey === null || instance.dungeonId !== IGNIVAR_RAID_ARENA_ID) continue;
    const origin = instanceOrigin(dungeon.index, instance.slot);
    const damageFraction = IGNIVAR_LAVA_MOAT_DAMAGE_FRACTION[instance.difficulty];
    for (const meta of ctx.players.values()) {
      const player = ctx.entities.get(meta.entityId);
      if (!player || player.dead || player.jumping || !player.onGround) continue;
      if (!instance.enteredBy.has(player.id)) continue;
      const localX = player.pos.x - origin.x;
      const localZ = player.pos.z - origin.z;
      if (!ignivarArenaPointInLava(localX, localZ)) continue;
      const damage = Math.max(1, Math.round(player.maxHp * damageFraction));
      ctx.dealDamage(
        null,
        player,
        damage,
        false,
        'fire',
        IGNIVAR_LAVA_MOAT_ABILITY_NAME,
        'hit',
        true,
        undefined,
        true,
        false,
        false,
        IGNIVAR_LAVA_MOAT_ABILITY_ID,
      );
      ctx.emit({
        type: 'spellfxAt',
        x: player.pos.x,
        z: player.pos.z,
        school: 'fire',
        fx: 'burst',
        sourceId: player.id,
        radius: 1.8,
        duration: 0.9,
        ability: IGNIVAR_LAVA_MOAT_ABILITY_NAME,
      });
    }
  }
}
