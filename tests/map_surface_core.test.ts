// Pins for src/ui/map_surface_core.ts: the world-map window's surface resolver.
//
// Player report: inside a rift, raid, dungeon, delve, or battleground the map
// window only ever showed the instance schematic (the level toggle was hidden),
// so there was no way back to the zone or world map; and from outside there was
// no way to look into the dungeon a party was running. These arms pin the cycle
// in both directions and the from-outside anchor derived from the party roster.

import { describe, expect, it } from 'vitest';
import { DUNGEONS, instanceOrigin } from '../src/sim/data';
import {
  defaultMapLevel,
  drawableInstanceAt,
  isInstanceMode,
  mapLevelToggleKey,
  nextMapLevel,
  remoteInstanceAnchor,
  resolveMapSurface,
} from '../src/ui/map_surface_core';
import type { MapWindowMode } from '../src/ui/map_window_view';
import type { IWorld } from '../src/world_api';

const INSTANCE_MODES: MapWindowMode[] = ['rift', 'delve', 'battleground', 'dungeon', 'castle'];

function worldWithParty(members: { pid: number; x: number; z: number }[], selfPid = 1): IWorld {
  return {
    player: { id: selfPid, pos: { x: 0, z: 0 } },
    partyInfo: {
      leader: selfPid,
      raid: false,
      master: { enabled: false, looter: 0, threshold: 'uncommon' },
      members: members.map((m) => ({ ...m, name: `p${m.pid}`, cls: 'mage', dead: 0 })),
    },
  } as unknown as IWorld;
}

describe('map surface: mode classification and default level', () => {
  it('opens on the instance plan inside any instance band and on the zone map outside', () => {
    for (const mode of INSTANCE_MODES) {
      expect(isInstanceMode(mode)).toBe(true);
      expect(defaultMapLevel(mode)).toBe('instance');
    }
    expect(isInstanceMode('overworld')).toBe(false);
    expect(defaultMapLevel('overworld')).toBe('zone');
  });
});

describe('map surface: the toggle cycle inside an instance', () => {
  it('cycles instance -> zone -> continent -> instance so the world map is always reachable', () => {
    for (const mode of INSTANCE_MODES) {
      expect(nextMapLevel(mode, 'instance', false)).toBe('zone');
      expect(nextMapLevel(mode, 'zone', false)).toBe('continent');
      expect(nextMapLevel(mode, 'continent', false)).toBe('instance');
    }
  });

  it('paints exactly the requested level inside an instance', () => {
    for (const mode of INSTANCE_MODES) {
      expect(resolveMapSurface(mode, 'instance', false)).toBe('instance');
      expect(resolveMapSurface(mode, 'zone', false)).toBe('zone');
      expect(resolveMapSurface(mode, 'continent', false)).toBe('continent');
    }
  });

  it('labels the toggle with the surface a press switches TO', () => {
    expect(mapLevelToggleKey('rift', 'instance', false)).toBe('hudChrome.continentMap.toZone');
    expect(mapLevelToggleKey('rift', 'zone', false)).toBe('hudChrome.continentMap.toWorld');
    expect(mapLevelToggleKey('rift', 'continent', false)).toBe('hudChrome.continentMap.toInstance');
  });
});

describe('map surface: the toggle cycle outside', () => {
  it('keeps the classic zone <-> world pair when no party member is in a drawable instance', () => {
    expect(nextMapLevel('overworld', 'zone', false)).toBe('continent');
    expect(nextMapLevel('overworld', 'continent', false)).toBe('zone');
    expect(mapLevelToggleKey('overworld', 'zone', false)).toBe('hudChrome.continentMap.toWorld');
    expect(mapLevelToggleKey('overworld', 'continent', false)).toBe(
      'hudChrome.continentMap.toZone',
    );
  });

  it('adds the party instance map to the cycle when a member stands in one', () => {
    expect(nextMapLevel('overworld', 'zone', true)).toBe('continent');
    expect(nextMapLevel('overworld', 'continent', true)).toBe('instance');
    expect(nextMapLevel('overworld', 'instance', true)).toBe('zone');
    expect(mapLevelToggleKey('overworld', 'continent', true)).toBe(
      'hudChrome.continentMap.toInstance',
    );
    expect(resolveMapSurface('overworld', 'instance', true)).toBe('instance');
  });

  it('falls back to the zone map when the requested instance is no longer drawable', () => {
    // The friend left the dungeon (or the party dissolved) while the level was
    // set to instance: the resolver must never paint a null model.
    expect(resolveMapSurface('overworld', 'instance', false)).toBe('zone');
    expect(nextMapLevel('overworld', 'instance', false)).toBe('continent');
    expect(mapLevelToggleKey('overworld', 'instance', false)).toBe(
      'hudChrome.continentMap.toWorld',
    );
  });
});

describe('map surface: from-outside anchor from the party roster', () => {
  const crypt = instanceOrigin(DUNGEONS.hollow_crypt.index, 1);
  const keep = instanceOrigin(DUNGEONS.the_last_keep.index, 0);

  it('recognises dungeon and castle interiors as drawable, the overworld and rift bands as not', () => {
    expect(drawableInstanceAt(crypt.x, crypt.z)).toBe(true);
    expect(drawableInstanceAt(keep.x + 4, keep.z - 5)).toBe(true);
    expect(drawableInstanceAt(0, 0)).toBe(false);
  });

  it('returns the first OTHER member inside a drawable instance, never the local player', () => {
    const world = worldWithParty([
      { pid: 1, x: crypt.x, z: crypt.z }, // self, ignored even though inside
      { pid: 5, x: 20, z: 30 }, // outside
      { pid: 6, x: crypt.x + 3, z: crypt.z - 2 },
      { pid: 7, x: keep.x, z: keep.z },
    ]);
    expect(remoteInstanceAnchor(world)).toEqual({ pid: 6, x: crypt.x + 3, z: crypt.z - 2 });
  });

  it('is null without a party or when nobody is inside', () => {
    expect(remoteInstanceAnchor({ player: { id: 1 }, partyInfo: null } as unknown as IWorld)).toBe(
      null,
    );
    expect(remoteInstanceAnchor(worldWithParty([{ pid: 5, x: 20, z: 30 }]))).toBe(null);
  });
});
