import { describe, expect, it } from 'vitest';
import type { ZoneDef } from '../src/sim/types';
import { resolveMapZone } from '../src/ui/hud/map/map_zone_focus_core';

const zone = (id: string): ZoneDef => ({ id }) as unknown as ZoneDef;
const zones = [zone('eastbrook_vale'), zone('mirefen_marsh'), zone('frostveil')];
const lookup = (dungeonDoor: { x: number; z: number } | null = null) => ({
  zones,
  zoneAt: (x: number, _z: number) => (x < 0 ? zones[0] : zones[1]),
  dungeonAt: () => (dungeonDoor ? { doorPos: dungeonDoor } : null),
});

describe('resolveMapZone', () => {
  it('outdoors follows the committed zone, never the raw position', () => {
    expect(resolveMapZone(null, 'frostveil', { x: -5, z: 0 }, lookup()).id).toBe('frostveil');
  });

  it('falls back to the zone under the player when the committed id is unknown', () => {
    expect(resolveMapZone(null, 'retired_zone', { x: 10, z: 0 }, lookup()).id).toBe(
      'mirefen_marsh',
    );
  });

  it('inside a dungeon frames the zone its door stands in', () => {
    const at = resolveMapZone(null, 'frostveil', { x: 9_000, z: 0 }, lookup({ x: -1, z: 0 }));
    expect(at.id).toBe('eastbrook_vale');
  });

  it('an override wins over the dungeon and the committed zone, and degrades to the position if stale', () => {
    const forced = resolveMapZone(
      'mirefen_marsh',
      'frostveil',
      { x: 9_000, z: 0 },
      lookup({ x: -1, z: 0 }),
    );
    expect(forced.id).toBe('mirefen_marsh');
    expect(resolveMapZone('gone', 'frostveil', { x: -1, z: 0 }, lookup()).id).toBe(
      'eastbrook_vale',
    );
  });
});
