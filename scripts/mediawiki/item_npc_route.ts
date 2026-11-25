import { GOURDLIGHT_KEEPER_NPC_ID } from '../../src/sim/content/gourdlight_eve';
import { HIGHWATCH_GUILD_ENTITY_IDS } from '../../src/sim/content/highwatch_guild';
import {
  CRUCIBLE_VENDOR_ENTRANCE_POS,
  CRUCIBLE_VENDOR_NPC_ID,
} from '../../src/sim/content/ignivar_loot';
import { TAVERN_KEEPER_NPC_ID } from '../../src/sim/content/mirefen_tavern';
import { HUB_SPARRING_MASTER_ID } from '../../src/sim/content/practice_dummies';
import { DUNGEON_LIST, getActiveWorldContent, NPCS } from '../../src/sim/data';
import { resolvedKeeperPosts } from '../../src/sim/seasonal_keeper_posts';
import { WORLD_SEED } from '../../src/sim/world_seed';
import type { RoutePoint } from './quest_map';
import { entranceRoute } from './rotating_routes';

/** Authored world services and room-local NPCs have different coordinate frames. */
export function itemNpcPoints(
  step: 'Start' | number | 'Reward',
  id: string,
  label?: string,
): RoutePoint[] {
  const world = getActiveWorldContent();
  const npc = world.npcs[id] ?? NPCS[id];
  if (!npc) return [];
  const text = npc.name + (label ? ' · ' + label : '');
  const point = (pos: { x: number; z: number }, frame = 'Overworld', note = text): RoutePoint => ({
    step,
    x: pos.x,
    z: pos.z,
    frame,
    label: note,
  });
  if (id === GOURDLIGHT_KEEPER_NPC_ID)
    return resolvedKeeperPosts(WORLD_SEED).map((p) =>
      point(p.pos, 'Overworld', text + ' (Gourdlight Eve only)'),
    );
  if (id === CRUCIBLE_VENDOR_NPC_ID) return [point(CRUCIBLE_VENDOR_ENTRANCE_POS)];
  const points: RoutePoint[] = [];
  if (
    world.npcs[id] &&
    (!npc.dynamic ||
      npc.fixedPost ||
      npc.weeklyEmissary ||
      npc.warfareVendor ||
      id === TAVERN_KEEPER_NPC_ID ||
      id === HUB_SPARRING_MASTER_ID ||
      Object.hasOwn(HIGHWATCH_GUILD_ENTITY_IDS, id))
  )
    points.push(point(npc.pos));
  for (const dungeon of DUNGEON_LIST) {
    const locations = (dungeon.npcs ?? []).filter((p) => p.npcId === id);
    if (id === 'brother_aldric_raid') {
      const boss = dungeon.spawns.find((s) => s.mobId === 'nythraxis_scourge_of_thornpeak');
      if (boss) locations.push({ npcId: id, x: boss.x, z: boss.z - 50 });
    }
    if (!locations.length) continue;
    if (step === 'Start') {
      const chain = entranceRoute(dungeon);
      points.push(
        point(chain[0].doorPos, 'Overworld', 'Enter ' + chain[0].name + ' to reach ' + npc.name),
      );
      for (let i = 1; i < chain.length; i++) {
        const parent = chain[i - 1];
        const gate = parent.objects!.find((o) => o.dungeonId === chain[i].id)!;
        points.push(point(gate, parent.name, 'Take ' + gate.name + ' to ' + chain[i].name));
      }
    }
    for (const at of locations) points.push(point(at, dungeon.name));
  }
  return points;
}
