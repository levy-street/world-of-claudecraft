// The combined Eastbrook and Mirefen map (data/maps/eastbrook_and_mirefen_changes.map.json,
// published as src/sim/maps/eastbrook_and_mirefen_changes.generated.ts). Its maker moved
// headstone clusters, houses and farm plots in the browser editor; this suite pins the
// map-data fixes that keep it playable: every zone graveyard is a working respawn on open,
// dry, walkable ground just outside its own headstones, a released spirit appears there
// beside a Spirit Healer, /unstuck lands at that same graveyard, the farm plots are level
// and grass-free, the camp tents are Balgath's muster tents, and Balgath's camp still stands.

import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { zoneGraveyards } from '../src/editor/custom_map';
import { isBlocked } from '../src/sim/colliders';
import { FARM_PATCHES } from '../src/sim/content/farm_patches';
import { SPIRIT_HEALER_NPC_ID, setActiveWorldContent } from '../src/sim/data';
import { grassClearedAt } from '../src/sim/grass_clear';
import type { MapPlacement } from '../src/sim/map_doc';
import {
  loadPublishedMap,
  MAP_SEED,
} from '../src/sim/maps/eastbrook_and_mirefen_changes.generated';
import { farmPatchesFor } from '../src/sim/moved_objects';
import { PLAYER_BODY_RADIUS, PLAYER_MAX_CLIMB_SLOPE } from '../src/sim/pathfind';
import { Sim } from '../src/sim/sim';
import { nearestOverworldGraveyard } from '../src/sim/spirit';
import type { Entity, SimEvent, ZoneDef } from '../src/sim/types';
import { UNSTUCK_COOLDOWN_ID, UNSTUCK_COUNTDOWN_SECONDS } from '../src/sim/unstuck';
import { terrainHeight, terrainSteepnessAt, waterLevelAt } from '../src/sim/world';

const DOC = JSON.parse(
  readFileSync('data/maps/eastbrook_and_mirefen_changes.map.json', 'utf8'),
) as { content: { zones: ZoneDef[] }; placements: MapPlacement[] };
const WORLD = loadPublishedMap();

/** A headstone cluster: the placements the editor named "Graveyard N headstone K". */
interface Cluster {
  name: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
function headstoneClusters(): Cluster[] {
  const byName = new Map<string, MapPlacement[]>();
  for (const p of DOC.placements) {
    const match = /^(Graveyard \d+) headstone/.exec(p.name ?? '');
    if (!match) continue;
    byName.set(match[1], [...(byName.get(match[1]) ?? []), p]);
  }
  return [...byName].map(([name, stones]) => ({
    name,
    minX: Math.min(...stones.map((s) => s.x)),
    maxX: Math.max(...stones.map((s) => s.x)),
    minZ: Math.min(...stones.map((s) => s.z)),
    maxZ: Math.max(...stones.map((s) => s.z)),
  }));
}
const CLUSTERS = headstoneClusters();
/** Yards from a point to the nearest edge of a cluster's box (0 inside it). */
const outsideBy = (c: Cluster, x: number, z: number) =>
  Math.hypot(Math.max(c.minX - x, 0, x - c.maxX), Math.max(c.minZ - z, 0, z - c.maxZ));

let sim: Sim;
beforeAll(() => {
  setActiveWorldContent(WORLD);
  // worldBossAtBoot raises Balgath (and with him the muster) on the first tick.
  sim = new Sim({
    seed: MAP_SEED,
    playerClass: 'warrior',
    autoEquip: true,
    world: WORLD,
    worldBossAtBoot: true,
  });
  sim.tick();
});
afterAll(() => setActiveWorldContent(null));

describe('combined map: respawn graveyards', () => {
  it('publishes one respawn graveyard per zone, at the zone graveyard point', () => {
    expect(WORLD.services?.graveyards).toEqual(zoneGraveyards(DOC.content.zones));
    expect(WORLD.services?.graveyards).toHaveLength(DOC.content.zones.length);
  });

  it('stands every graveyard on open, dry, walkable ground', () => {
    for (const zone of WORLD.zones) {
      const { x, z } = zone.graveyard;
      expect(isBlocked(MAP_SEED, x, z, PLAYER_BODY_RADIUS + 0.5), zone.id).toBe(false);
      expect(terrainHeight(x, z, MAP_SEED), zone.id).toBeGreaterThan(
        waterLevelAt(x, z, MAP_SEED) + 1,
      );
      for (const [dx, dz] of [
        [0, 0],
        [1.5, 0],
        [-1.5, 0],
        [0, 1.5],
        [0, -1.5],
      ]) {
        expect(terrainSteepnessAt(x + dx, z + dz, MAP_SEED), zone.id).toBeLessThanOrEqual(
          PLAYER_MAX_CLIMB_SLOPE,
        );
      }
    }
  });

  it('keeps each graveyard beside its headstones, never on top of them', () => {
    let beside = 0;
    for (const zone of WORLD.zones) {
      const { x, z } = zone.graveyard;
      const near = CLUSTERS.filter((c) => outsideBy(c, x, z) < 8);
      for (const cluster of near) {
        expect(outsideBy(cluster, x, z), `${zone.id} vs ${cluster.name}`).toBeGreaterThanOrEqual(
          1.5,
        );
        beside++;
      }
    }
    // Eastbrook, Mirefen, Thornpeak, the Veiled Hollow, Evergarden, Galecrest, Farshore
    // and the Proving Shore all respawn beside a headstone cluster.
    expect(beside).toBeGreaterThanOrEqual(8);
  });

  it("follows Thornpeak's headstones to where they were moved", () => {
    const thornpeak = WORLD.zones.find((zone) => zone.id === 'thornpeak_heights');
    const moved = CLUSTERS.find((c) => c.name === 'Graveyard 5');
    expect(thornpeak && moved).toBeTruthy();
    if (!thornpeak || !moved) return;
    expect(moved.minZ).toBeGreaterThan(735); // the cluster now stands near z 745
    expect(outsideBy(moved, thornpeak.graveyard.x, thornpeak.graveyard.z)).toBeLessThan(6);
  });

  it('seats the moved Thornpeak headstones on the ground', () => {
    const stones = DOC.placements.filter((p) => /^Graveyard 5 headstone/.test(p.name ?? ''));
    expect(stones).toHaveLength(6);
    for (const stone of stones) expect(stone.detached, stone.name).toBeUndefined();
  });

  it('spawns a Spirit Healer at every graveyard', () => {
    const healers = [...sim.entities.values()].filter(
      (e: Entity) => e.kind === 'npc' && e.templateId === SPIRIT_HEALER_NPC_ID,
    );
    expect(healers).toHaveLength(WORLD.zones.length);
    for (const zone of WORLD.zones) {
      const near = healers.some(
        (h) => Math.hypot(h.pos.x - zone.graveyard.x, h.pos.z - zone.graveyard.z) < 1,
      );
      expect(near, zone.id).toBe(true);
    }
  });

  it('releases a dead player at the nearest zone graveyard, beside its healer', () => {
    const p = sim.player;
    for (const zone of WORLD.zones) {
      const gy = zone.graveyard;
      // die a short walk from this zone's graveyard
      p.dead = false;
      p.ghost = false;
      p.hp = p.maxHp;
      p.pos = sim.groundPos(gy.x + 9, gy.z + 9);
      p.prevPos = { ...p.pos };
      p.hp = 0;
      p.dead = true;
      sim.releaseSpirit();
      expect(p.ghost, zone.id).toBe(true);
      expect(Math.hypot(p.pos.x - gy.x, p.pos.z - gy.z), zone.id).toBeLessThan(0.01);
      const healer = [...sim.entities.values()].some(
        (e: Entity) =>
          e.kind === 'npc' &&
          e.templateId === SPIRIT_HEALER_NPC_ID &&
          Math.hypot(e.pos.x - p.pos.x, e.pos.z - p.pos.z) < 2,
      );
      expect(healer, zone.id).toBe(true);
    }
  });
});

describe('combined map: /unstuck', () => {
  // A fresh, monster-free copy of the map keeps the ten-second countdown out of
  // combat; its graveyards and player start are still the published map's own.
  const quiet = { ...WORLD, camps: [] };
  let unstuckSim: Sim;
  let pid: number;
  beforeAll(() => {
    setActiveWorldContent(quiet);
    unstuckSim = new Sim({ seed: MAP_SEED, playerClass: 'warrior', noPlayer: true, world: quiet });
    pid = unstuckSim.addPlayer('warrior', 'Wayfinder');
  });
  afterAll(() => setActiveWorldContent(WORLD));

  /** Run a whole /unstuck from a short walk off `gy`; returns the player and the completion. */
  function unstuckNear(gy: { x: number; z: number }, dead: boolean) {
    const p = unstuckSim.entities.get(pid) as Entity;
    p.dead = dead;
    p.ghost = false;
    p.hp = dead ? 0 : p.maxHp;
    p.pos = unstuckSim.groundPos(gy.x + 9, gy.z + 9);
    p.prevPos = { ...p.pos };
    p.vx = 0;
    p.vy = 0;
    p.vz = 0;
    p.onGround = true;
    p.jumping = false;
    p.inCombat = false;
    p.combatTimer = 999;
    p.cooldowns.delete(UNSTUCK_COOLDOWN_ID);
    unstuckSim.grid.update(p);
    unstuckSim.playerGrid.update(p);
    unstuckSim.drainEvents();
    expect(unstuckSim.unstuck(pid)).toBe(true);
    const events: SimEvent[] = [];
    for (let i = 0; i < UNSTUCK_COUNTDOWN_SECONDS * 20 + 2; i++) events.push(...unstuckSim.tick());
    const done = events.find(
      (e): e is Extract<SimEvent, { type: 'unstuck'; phase: 'completed' }> =>
        e.type === 'unstuck' && e.phase === 'completed',
    );
    expect(done).toBeDefined();
    return { p, done };
  }

  it('is decisive: some zone graveyard is far from every built-in graveyard', () => {
    const far = WORLD.zones.filter((zone) => {
      const builtin = nearestOverworldGraveyard(zone.graveyard.x + 9, zone.graveyard.z + 9);
      return Math.hypot(builtin.x - zone.graveyard.x, builtin.z - zone.graveyard.z) > 5;
    });
    expect(far.length).toBeGreaterThan(0);
  });

  it('moves a living player to the nearest zone graveyard, not a built-in one', () => {
    for (const zone of WORLD.zones) {
      const gy = zone.graveyard;
      const { p, done } = unstuckNear(gy, false);
      expect(done?.reason, zone.id).toBe('moved_to_graveyard');
      expect(p.dead, zone.id).toBe(false);
      expect(Math.hypot(p.pos.x - gy.x, p.pos.z - gy.z), zone.id).toBeLessThan(0.01);
    }
  });

  it('raises a dead player at the nearest zone graveyard, where release puts the spirit', () => {
    for (const zone of WORLD.zones) {
      const gy = zone.graveyard;
      const { p, done } = unstuckNear(gy, true);
      expect(done?.reason, zone.id).toBe('revived_at_graveyard');
      expect(p.dead, zone.id).toBe(false);
      expect(Math.hypot(p.pos.x - gy.x, p.pos.z - gy.z), zone.id).toBeLessThan(0.01);
    }
  });
});

describe('combined map: farm plots', () => {
  const beds = farmPatchesFor(WORLD.objectMoves, FARM_PATCHES).flatMap((patch) => patch.beds);

  it('keeps every bed level across its footprint', () => {
    expect(beds.length).toBeGreaterThan(20);
    for (const bed of beds) {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i <= 6; i++) {
        for (let j = 0; j <= 6; j++) {
          // a bed is 3 by 2 yards
          const h = terrainHeight(bed.x - 1.5 + i * 0.5, bed.z - 1 + (j * 2) / 6, MAP_SEED);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
      }
      // Evergarden's first bed sits on the edge of the garden's terrain pad, which
      // the terrain applies after the map's stamps: 0.1 yd is all that remains there.
      expect(hi - lo, bed.id).toBeLessThan(0.12);
    }
  });

  it('clears the grass from every bed', () => {
    for (const bed of beds) {
      for (const [dx, dz] of [
        [0, 0],
        [1.5, 1],
        [-1.5, 1],
        [1.5, -1],
        [-1.5, -1],
      ]) {
        expect(grassClearedAt(WORLD.grassClear, bed.x + dx, bed.z + dz), bed.id).toBe(true);
      }
    }
  });
});

describe("combined map: tents and Balgath's camp", () => {
  it("draws every camp tent from Balgath's muster set", () => {
    const stock = DOC.placements.filter((p) => /^props\/tent_(open|small)$/.test(p.assetId));
    expect(stock).toHaveLength(0);
    const camp = DOC.placements.filter((p) => /^Camp tent \d+$/.test(p.name ?? ''));
    expect(camp).toHaveLength(33);
    for (const tent of camp) expect(tent.assetId, tent.name).toMatch(/^props\/muster_tent_/);
  });

  it('stands the painted mudfin huts and their burnable hut objects', () => {
    const huts = DOC.placements.filter((p) => /^props\/mudfin_hut_[ab]$/.test(p.assetId));
    expect(huts).toHaveLength(5);
    const objects = [...sim.entities.values()].filter((e) => e.name === 'Mudfin Hut');
    expect(objects).toHaveLength(5);
  });

  it("raises Balgath in the Starfall Crater with the muster's battlements around him", () => {
    const balgath = [...sim.entities.values()].find(
      (e: Entity) => e.templateId === 'balgath_cyclops',
    );
    expect(balgath).toBeDefined();
    const soldiers = [...sim.entities.values()].filter((e: Entity) =>
      /^muster_(footman|chaplain|sergeant|drillmaster)$/.test(e.templateId ?? ''),
    );
    expect(soldiers.length).toBeGreaterThanOrEqual(30);
    // the five muster camps' own walls, gate and watchtower
    const walls = DOC.placements.filter((p) =>
      /^props\/muster_(palisade|barricade)$/.test(p.assetId),
    );
    expect(walls.length).toBeGreaterThanOrEqual(25);
    for (const piece of ['props/muster_gate', 'props/muster_watchtower']) {
      expect(
        DOC.placements.some((p) => p.assetId === piece),
        piece,
      ).toBe(true);
    }
  });
});
