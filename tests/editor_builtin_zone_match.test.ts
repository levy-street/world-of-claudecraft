// Which Studio maps count as full-world maps of the built-in world
// (src/editor/builtin_zone_match_core.ts), and that a map saved before a
// built-in zone existed still takes the open-time upgrades, without that
// zone's props.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  carriesBuiltinZones,
  insideAnyZone,
  LATE_BUILTIN_ZONE_IDS,
  missingLateZones,
} from '../src/editor/builtin_zone_match_core';
import { upgradeLoadedMap } from '../src/editor/map_load_upgrades';
import { parseMap } from '../src/editor/persist';
import { BUILTIN_WORLD } from '../src/sim/data';

const builtin = BUILTIN_WORLD.zones;
const early = builtin.filter((zone) => !LATE_BUILTIN_ZONE_IDS.includes(zone.id));

describe('full-world map detection', () => {
  it('names the Quartered Isle as the one late zone, and the built-in world carries it', () => {
    expect(LATE_BUILTIN_ZONE_IDS).toEqual(['quartered_isle']);
    expect(early.length).toBe(builtin.length - 1);
  });

  it('accepts the built-in zones in order, with or without the late zones', () => {
    expect(carriesBuiltinZones(builtin, builtin)).toBe(true);
    expect(carriesBuiltinZones(early, builtin)).toBe(true);
  });

  it('rejects a reordered, shortened or foreign zone list', () => {
    expect(carriesBuiltinZones([...early].reverse(), builtin)).toBe(false);
    expect(carriesBuiltinZones(early.slice(0, -1), builtin)).toBe(false);
    expect(carriesBuiltinZones(builtin.slice(0, 1), builtin)).toBe(false);
    expect(carriesBuiltinZones([...early, { id: 'my_zone' }], builtin)).toBe(false);
    expect(carriesBuiltinZones([], builtin)).toBe(false);
  });

  it('reports the late zones a map does not carry, by rectangle', () => {
    expect(missingLateZones(builtin, builtin)).toEqual([]);
    const absent = missingLateZones(early, builtin);
    expect(absent.map((zone) => zone.id)).toEqual(['quartered_isle']);
    expect(insideAnyZone(absent, 0, 2248)).toBe(true); // Rivalmoot
    expect(insideAnyZone(absent, 0, 100)).toBe(false); // Eastbrook
    expect(insideAnyZone([], 0, 2248)).toBe(false);
  });
});

describe('open-time upgrades on a map saved before the Quartered Isle', () => {
  const text = readFileSync('data/maps/eastbrook_rebuild.map.json', 'utf8');

  it('still upgrades the map, and adds nothing on the isle it does not carry', () => {
    const raw = parseMap(text);
    const opened = parseMap(text);
    if (!raw || !opened) throw new Error('unreadable fixture');
    expect(opened.content.zones.some((zone) => zone.id === 'quartered_isle')).toBe(false);
    upgradeLoadedMap(opened);
    const rawUids = new Set(raw.placements.map((p) => p.uid));
    const added = opened.placements.filter((p) => !rawUids.has(p.uid));
    // the upgrades run (they add Eastbrook's promoted dressing)...
    expect(added.length).toBeGreaterThan(0);
    // ...and none of it stands on the isle's ground
    const absent = missingLateZones(opened.content.zones, builtin);
    expect(added.filter((p) => insideAnyZone(absent, p.x, p.z))).toEqual([]);
  });
});
