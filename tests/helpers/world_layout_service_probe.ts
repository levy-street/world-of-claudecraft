import { ALL_RECIPES } from '../../src/sim/content/recipes';
import { BUILTIN_WORLD, DUNGEONS, OVERWORLD_GRAVEYARDS } from '../../src/sim/data';
import { resolveCraft } from '../../src/sim/professions/crafting';
import { Sim } from '../../src/sim/sim';
import { groundHeight } from '../../src/sim/world';
import { WORLD_SEED } from '../../src/sim/world_seed';
export function probeLayoutServices() {
  const sim = new Sim({ seed: WORLD_SEED, playerClass: 'warrior' });
  for (const e of sim.entities.values()) if (e.kind === 'mob') sim.entities.delete(e.id);
  const p = sim.player,
    meta = sim.players.get(p.id)!;
  const at = (x: number, z: number) => {
    Object.assign(p.pos, { x, z, y: groundHeight(x, z, WORLD_SEED) });
    Object.assign(p.prevPos, p.pos);
    sim.rebucket(p);
  };
  const crafts = sim.stationPlacements.map((station) => {
    const recipe = ALL_RECIPES.find((r) => r.stationType === station.type)!;
    at(station.pos.x, station.pos.z);
    meta.inventory.length = 0;
    meta.knownRecipes.add(recipe.id);
    for (const reagent of recipe.reagents) sim.addItem(reagent.itemId, reagent.count);
    const result = resolveCraft(sim.ctx, p.id, recipe.id);
    return {
      station: station.id,
      recipe: recipe.id,
      ok: result.ok,
      reason: result.ok ? undefined : result.reason,
    };
  });
  const graves = OVERWORLD_GRAVEYARDS.map((g) => {
    at(g.x, g.z);
    p.dead = true;
    p.ghost = false;
    p.hp = 0;
    sim.releaseSpirit();
    const distance = Math.hypot(p.pos.x - g.x, p.pos.z - g.z),
      ghost = p.ghost;
    const revived = sim.resurrectAtSpiritHealer();
    return { id: g.id, distance, ghost, revived };
  });
  const move = BUILTIN_WORLD.objectMoves!['dungeonDoor:dawnhold_castle'];
  at(move.x, move.z);
  for (let i = 0; i < 4; i++) sim.tick();
  const entered = p.pos.x > 5000;
  const left = sim.leaveDungeon();
  const drop = DUNGEONS.dawnhold_castle.leaveOffset ?? { x: 0, z: -4 };
  return {
    crafts,
    graves,
    dungeon: {
      entered,
      left,
      distanceFromExpectedExit: Math.hypot(p.pos.x - move.x - drop.x, p.pos.z - move.z - drop.z),
    },
  };
}
