// The Last Bell world fixtures through the real Sim: the two ferry landings,
// the Tidemill scenario door, and the Breach maw spawn as ground objects with
// their pinned templateIds and positions; the breach is pure scenery (interact
// must ignore it) while the ferries stay interactable. Also pins the mainland
// jetty added to ZONE1_PROPS: its deck runs toward falling shore ground on the
// pinned client world seed, and its planks are raised walkable ground.
import { describe, expect, it } from 'vitest';
import { ZONE1_PROPS } from '../src/sim/content/zone1';
import { dockSectionWorldCenter } from '../src/sim/dock_layout';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { FARSHORE_BREACH, terrainHeight, WATER_LEVEL } from '../src/sim/world';

// The persistent client world seed (WORLD_SEED in src/main.ts).
const CLIENT_SEED = 20061;

function makeSim(): Sim {
  const sim = new Sim({ seed: 4242, playerClass: 'warrior', playerName: 'Ash', devCommands: true });
  sim.player.level = 6;
  return sim;
}

function teleport(sim: Sim, x: number, z: number): void {
  const pos = sim.groundPos(x, z);
  sim.player.pos = { ...pos };
  sim.player.prevPos = { ...pos };
  sim.rebucket(sim.player);
}

function fixtures(sim: Sim, templateId: string): Entity[] {
  return [...sim.entities.values()].filter((e) => e.templateId === templateId);
}

describe('Last Bell campaign fixtures', () => {
  it('spawns the ferries, the Tidemill door, and the Breach at their pinned spots', () => {
    const sim = makeSim();

    const ferries = fixtures(sim, 'lb_ferry');
    expect(ferries.map((f) => ({ x: f.pos.x, z: f.pos.z }))).toEqual(
      expect.arrayContaining([
        { x: 152, z: -48 },
        { x: 806, z: 122 },
      ]),
    );
    expect(ferries).toHaveLength(2);
    for (const ferry of ferries) {
      expect(ferry.name).toBe('The Farshore Ferry');
      expect(ferry.lootable).toBe(true); // interactable
    }

    const doors = fixtures(sim, 'lb_scenario_door');
    expect(doors).toHaveLength(1);
    expect(doors[0].name).toBe('The Tidemill');
    expect({ x: doors[0].pos.x, z: doors[0].pos.z }).toEqual({ x: 930, z: 12 });
    expect(doors[0].lootable).toBe(true);

    const breaches = fixtures(sim, 'lb_breach_maw');
    expect(breaches).toHaveLength(1);
    expect(breaches[0].name).toBe('The Breach');
    expect({ x: breaches[0].pos.x, z: breaches[0].pos.z }).toEqual({
      x: FARSHORE_BREACH.x,
      z: FARSHORE_BREACH.z,
    });
    // Pin the anchor itself so the fixture cannot silently drift off the crater.
    expect(FARSHORE_BREACH).toEqual({ x: 1012, z: -172 });
  });

  it('ignores interact on the Breach: it is scenery, not a device', () => {
    const sim = makeSim();
    const breach = fixtures(sim, 'lb_breach_maw')[0];
    expect(breach.lootable).toBe(false);

    teleport(sim, breach.pos.x + 1.5, breach.pos.z + 1.5);
    const before = { ...sim.player.pos };

    // Targeted interact: the lootable=false gate must reject it before any
    // lb_ dispatch (and tryLastBellInteract has no lb_breach_maw arm anyway).
    sim.player.targetId = breach.id;
    sim.interact();
    // Untargeted interact right next to it: the proximity scan must skip it too.
    sim.player.targetId = null;
    sim.interact();
    for (let i = 0; i < 5; i++) sim.tick();

    // Nothing happened: no travel, no quest, no scenario, and the breach is
    // untouched (not picked up, not flagged for respawn).
    expect(sim.player.pos).toEqual(before);
    expect(sim.questLog.has('q_lb_q0_ashore')).toBe(false);
    expect(sim.ctx.scenarioRuns.size).toBe(0);
    expect(sim.entities.get(breach.id)).toBe(breach);
    expect(breach.lootable).toBe(false);
    expect(breach.dead).toBe(false);
  });

  it('keeps the ferries interactable: boarding still crosses the strait', () => {
    const sim = makeSim();
    const mainlandFerry = fixtures(sim, 'lb_ferry').find((f) => f.pos.x === 152);
    expect(mainlandFerry).toBeTruthy();
    if (!mainlandFerry) return;

    teleport(sim, 152, -48);
    sim.player.targetId = mainlandFerry.id;
    sim.interact();
    expect(Math.hypot(sim.player.pos.x - 806, sim.player.pos.z - 122)).toBeLessThan(3);

    const pierFerry = fixtures(sim, 'lb_ferry').find((f) => f.pos.x === 806);
    expect(pierFerry).toBeTruthy();
    if (!pierFerry) return;
    sim.player.targetId = pierFerry.id;
    sim.interact();
    expect(Math.hypot(sim.player.pos.x - 152, sim.player.pos.z + 48)).toBeLessThan(3);
  });

  it('stands a walkable mainland jetty whose deck runs toward the falling shore', () => {
    const dock = ZONE1_PROPS.docks.find((d) => d.x === 155 && d.z === -51);
    expect(dock).toBeTruthy();
    if (!dock) return;
    // No hut on an open jetty (zero half-extents keep colliders.ts quiet).
    expect(dock.hutLocal.hw).toBe(0);
    expect(dock.hutLocal.hd).toBe(0);

    // The deck extends toward (-sin rot, -cos rot); on the pinned client seed
    // the shore must FALL along it toward the strait, and the anchor itself
    // must stand on dry land above the sea.
    const anchorH = terrainHeight(dock.x, dock.z, CLIENT_SEED);
    expect(anchorH).toBeGreaterThan(WATER_LEVEL);
    const endX = dock.x - Math.sin(dock.rot) * 5.31; // far deck section center
    const endZ = dock.z - Math.cos(dock.rot) * 5.31;
    const endH = terrainHeight(endX, endZ, CLIENT_SEED);
    expect(endH).toBeLessThan(anchorH);
    // It reaches toward the strait east of the vale, where the ferry moors.
    expect(endX).toBeGreaterThan(dock.x);

    // The planks are real raised walkable ground for the sim (any seed): the
    // ground height on a deck section sits above the bare terrain under it.
    const sim = makeSim();
    const c = dockSectionWorldCenter(dock, 1);
    expect(sim.groundPos(c.x, c.z).y).toBeGreaterThan(terrainHeight(c.x, c.z, 4242));
  });
});
