import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

// Compile/composition fixtures start from the canonical world, just like the
// exporter. The real activated migration is covered by world_layout_candidate.
vi.mock('../src/sim/world_layout/active', () => ({
  WORLD_LAYOUT: {
    version: 1,
    buildings: {},
    npcs: {},
    camps: [],
    groundObjects: {},
    objectMoves: {},
  },
}));

import { compileWorldLayout, type WorldLayoutReview } from '../src/editor/world_layout_export';
import { stationPropPlacements } from '../src/render/stations_core';
import { AUTHORED_TOWNS } from '../src/sim/authored_town_registry';
import { BUILTIN_WORLD } from '../src/sim/data';
import type { MapDoc } from '../src/sim/map_doc';
import { isAtStation } from '../src/sim/professions/stations';
import { composeWorldLayout } from '../src/sim/world_layout';
import { placeLayoutServices, placeLayoutStations } from '../src/sim/world_layout/services';

const map = JSON.parse(
  readFileSync('data/maps/eastbrook_and_mirefen_changes.map.json', 'utf8'),
) as MapDoc;
const review = JSON.parse(
  readFileSync('data/world_layout/eastbrook_and_mirefen.review.json', 'utf8'),
) as WorldLayoutReview;
const buildings = AUTHORED_TOWNS.flatMap((town) => town.buildings);

describe('world layout crafting service anchors', () => {
  it('moves crafting access with all six masters and preserves the civic boards and mailboxes', () => {
    const result = compileWorldLayout(map, BUILTIN_WORLD, buildings, review);
    const world = composeWorldLayout(BUILTIN_WORLD, result.layout);
    for (const before of BUILTIN_WORLD.services!.stations!) {
      const after = world.services!.stations!.find((s) => s.id === before.id)!;
      const oldMaster = BUILTIN_WORLD.npcs[before.masterNpcId];
      const newMaster = world.npcs[before.masterNpcId];
      expect(isAtStation(world.services!.stations!, newMaster.pos, before.type), before.id).toBe(
        true,
      );
      expect(after.pos.x - newMaster.pos.x).toBeCloseTo(before.pos.x - oldMaster.pos.x, 10);
      expect(after.pos.z - newMaster.pos.z).toBeCloseTo(before.pos.z - oldMaster.pos.z, 10);
      expect(after.masterNpcId).toBe(before.masterNpcId);
      expect(after.type).toBe(before.type);
    }
    expect(world.services!.stations!.find((s) => s.type === 'loom')!.zoneId).toBe('mirefen_marsh');
    expect(world.services!.stations!.find((s) => s.type === 'toolworks')!.zoneId).toBe(
      'thornpeak_heights',
    );
    expect(
      isAtStation(world.services!.stations!, BUILTIN_WORLD.npcs.weaver_ottilie.pos, 'loom'),
    ).toBe(false);
    expect(
      isAtStation(world.services!.stations!, BUILTIN_WORLD.npcs.tinker_gizzel.pos, 'toolworks'),
    ).toBe(false);
    for (const key of ['mailboxes', 'noticeboards', 'musterBoards'] as const)
      expect(world.services![key]).toBe(BUILTIN_WORLD.services![key]);
    const loom = world.services!.stations!.find((s) => s.type === 'loom')!;
    expect(
      stationPropPlacements(world.services!.stations!).find((p) => p.kind === 'loom'),
    ).toMatchObject({
      stationId: loom.id,
      x: loom.pos.x + 0.2,
      z: loom.pos.z - 1.8,
    });
  });

  it('moves ten reviewed graveyards without dropping newer resurrection sites or changing zone content', () => {
    const result = compileWorldLayout(map, BUILTIN_WORLD, buildings, review);
    expect(Object.keys(result.layout.graveyards!)).toHaveLength(10);
    expect(
      result.issues.filter((i) => i.id.startsWith('graveyard:') || i.id === 'content.zones'),
    ).toEqual([]);
    const world = composeWorldLayout(BUILTIN_WORLD, result.layout);
    const sites = world.services!.graveyards!;
    expect(sites.map((g) => [g.id, g.name])).toEqual(
      BUILTIN_WORLD.services!.graveyards!.map((g) => [g.id, g.name]),
    );
    expect(sites.find((g) => g.id === 'gy_thornpeak')).toMatchObject({ x: 12.8, z: 738.8 });
    expect(sites.find((g) => g.id === 'gy_eastbrook')).toMatchObject({ x: 33, z: -96.5 });
    for (const id of [
      'gy_last_keep',
      'gy_thornpeak_east',
      'gy_thornpeak_south',
      'gy_thornpeak_west',
      'gy_vale_north',
    ])
      expect(sites.find((g) => g.id === id)).toBe(
        BUILTIN_WORLD.services!.graveyards!.find((g) => g.id === id),
      );
    for (const zone of world.zones) {
      const { graveyard: _before, ...before } = BUILTIN_WORLD.zones.find((z) => z.id === zone.id)!;
      const { graveyard: _after, ...after } = zone;
      expect(after).toEqual(before);
    }
  });

  it('requires exact graveyard identities and rejects cross-zone or malformed moves', () => {
    const invalidBindings: Record<string, string>[] = [
      { thornpeak_heights: 'missing' },
      { thornpeak_heights: 'gy_thornpeak', eastbrook_vale: 'gy_thornpeak' },
    ];
    for (const bindings of invalidBindings) {
      const result = compileWorldLayout(map, BUILTIN_WORLD, buildings, {
        ...review,
        graveyardBindings: bindings,
      });
      expect(result.issues.some((i) => i.id.startsWith('graveyard:'))).toBe(true);
    }
    for (const point of [
      { x: NaN, z: 645 },
      { x: 0, z: -100 },
    ]) {
      const doc = structuredClone(map);
      doc.content.zones.find((z) => z.id === 'thornpeak_heights')!.graveyard = point;
      const result = compileWorldLayout(doc, BUILTIN_WORLD, buildings, review);
      expect(result.issues.some((i) => i.id === 'graveyard:thornpeak_heights')).toBe(true);
    }
  });

  it('blocks a moved master whose station has not been reconciled', () => {
    const result = compileWorldLayout(map, BUILTIN_WORLD, buildings, {
      ...review,
      stationBindings: undefined,
    });
    expect(result.issues.filter((i) => i.id.startsWith('station:'))).toHaveLength(6);
    expect(result.layout.stations).toBeUndefined();
  });

  it.each([
    ['wrong master', { masterNpcId: 'fury', zoneId: 'mirefen_marsh' }],
    ['unknown zone', { masterNpcId: 'weaver_ottilie', zoneId: 'missing' }],
    ['old zone', { masterNpcId: 'weaver_ottilie', zoneId: 'eastbrook_vale' }],
  ])('rejects %s bindings instead of silently leaving a stale station', (_name, binding) => {
    const result = compileWorldLayout(map, BUILTIN_WORLD, buildings, {
      ...review,
      stationBindings: { ...review.stationBindings, station_eastbrook_loom: binding },
    });
    expect(result.issues.some((i) => i.id === 'station:station_eastbrook_loom')).toBe(true);
    expect(result.layout.stations?.station_eastbrook_loom).toBeUndefined();
  });

  it('preserves newly added stations and rejects stale or ambiguous runtime identities', () => {
    const base = BUILTIN_WORLD.services!.stations!;
    const extra = { ...base[0], id: 'later-forge' };
    const edits = { [base[0].id]: { pos: { x: 1, z: 2 }, zoneId: 'eastbrook_vale' } };
    expect(placeLayoutStations([...base, extra], edits).at(-1)).toBe(extra);
    expect(placeLayoutStations(base, undefined)).toBe(base);
    expect(placeLayoutServices(BUILTIN_WORLD.services, {})).toBe(BUILTIN_WORLD.services);
    expect(() => placeLayoutStations([], edits)).toThrow('Missing or ambiguous');
    expect(() => placeLayoutStations([...base, base[0]], edits)).toThrow('Missing or ambiguous');
    expect(() =>
      placeLayoutStations(base, {
        [base[0].id]: { pos: { x: NaN, z: 0 }, zoneId: 'eastbrook_vale' },
      }),
    ).toThrow('Invalid station');
  });
});
