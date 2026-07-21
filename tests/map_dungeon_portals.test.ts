import { describe, expect, it } from 'vitest';
import { DUNGEON_LIST } from '../src/sim/data';
import type { DungeonDef } from '../src/sim/types';
import { overworldDungeonPortals } from '../src/ui/map_dungeon_portals';

// A dungeon-shaped fixture; only the fields the portal filter reads matter.
const def = (over: Partial<DungeonDef>): DungeonDef => ({
  id: 'x',
  name: 'X',
  index: 0,
  doorPos: { x: 0, z: 0 },
  entry: { x: 0, z: 0 },
  exitOffset: { x: 0, z: 0 },
  spawns: [],
  interior: 'crypt',
  suggestedPlayers: 5,
  enterText: '',
  leaveText: '',
  ...over,
});

describe('overworldDungeonPortals', () => {
  it('includes a normal dungeon whose door is inside the zone band', () => {
    const dungeons = [def({ id: 'crypt', doorPos: { x: 10, z: 50 } })];
    const portals = overworldDungeonPortals(dungeons, 0, 100);
    expect(portals).toEqual([{ id: 'crypt', x: 10, z: 50 }]);
  });

  it('excludes dungeons reachable only through an internal door (overworldDoor === false)', () => {
    const dungeons = [
      def({ id: 'crypt', doorPos: { x: -152, z: 610 } }),
      def({ id: 'raid', doorPos: { x: -152, z: 610 }, overworldDoor: false }),
    ];
    const portals = overworldDungeonPortals(dungeons, 600, 700);
    expect(portals).toEqual([{ id: 'crypt', x: -152, z: 610 }]);
  });

  it('clips to the [zMin, zMax) band like the map loop does', () => {
    const dungeons = [
      def({ id: 'below', doorPos: { x: 0, z: 599 } }),
      def({ id: 'lo', doorPos: { x: 0, z: 600 } }),
      def({ id: 'hi', doorPos: { x: 0, z: 699 } }),
      def({ id: 'atMax', doorPos: { x: 0, z: 700 } }),
    ];
    expect(overworldDungeonPortals(dungeons, 600, 700).map((p) => p.id)).toEqual(['lo', 'hi']);
  });

  it('never returns two real dungeon portals at the same map position (no name collision)', () => {
    // Across the whole zone span, every visible portal must sit at a distinct
    // (x,z): two labels at one point are exactly the overlap bug.
    const portals = overworldDungeonPortals(DUNGEON_LIST, -100000, 100000);
    const seen = new Set<string>();
    for (const p of portals) {
      const key = `${p.x},${p.z}`;
      expect(seen.has(key), `duplicate portal at ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('drops the Nythraxis raid arena (shares the Abandoned Crypt door) from real content', () => {
    const ids = overworldDungeonPortals(DUNGEON_LIST, -100000, 100000).map((p) => p.id);
    expect(ids).toContain('nythraxis_crypt');
    expect(ids).not.toContain('nythraxis_boss_arena');
  });
});
