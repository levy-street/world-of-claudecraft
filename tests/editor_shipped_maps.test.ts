import { describe, expect, it } from 'vitest';
import { createShippedMap, SHIPPED_MAPS, type ShippedMapId } from '../src/editor/shipped_maps';
import { MAX_PLACEMENTS, sanitizeMapDoc } from '../src/sim/map_doc';

const EXPECTED_IDS: ShippedMapId[] = [
  'overworld',
  'thornhollow',
  'hollow_crypt',
  'sunken_bastion',
  'gravewyrm_sanctum',
  'drowned_temple',
  'abandoned_crypt',
  'nythraxis_raid_arena',
  'ashen_coliseum',
  'protect_yumi_maze',
  'reliquary_sunken_ossuary',
  'reliquary_bell_niche',
  'reliquary_saintless_hall',
  'reliquary_finale',
  'litany_sluice',
  'litany_ledger',
  'litany_ring',
  'litany_baptistry',
  'litany_choir_loft',
  'litany_causeway',
  'litany_apse',
];

describe('shipped map editor catalog', () => {
  it('keeps every stable shipped map in one explicit inventory', () => {
    expect(SHIPPED_MAPS.map((entry) => entry.id)).toEqual(EXPECTED_IDS);
    expect(new Set(EXPECTED_IDS).size).toBe(EXPECTED_IDS.length);
  });

  it.each(EXPECTED_IDS)(
    'converts %s into a valid independently editable document',
    async (mapId) => {
      const map = await createShippedMap(mapId, `copy-${mapId}`, 1234);
      const parsed = sanitizeMapDoc(JSON.parse(JSON.stringify(map)));

      expect(parsed).not.toBeNull();
      expect(parsed?.meta.id).toBe(`copy-${mapId}`);
      expect(parsed?.meta.createdAt).toBe(1234);
      expect(parsed?.meta.updatedAt).toBe(1234);
      if (mapId === 'overworld') {
        expect(parsed?.content.zones.length).toBeGreaterThan(0);
        expect(Object.keys(parsed?.content.npcs ?? {})).not.toHaveLength(0);
      } else {
        expect(parsed?.placements.length).toBeGreaterThan(0);
      }
      expect(parsed?.placements.length).toBeLessThanOrEqual(MAX_PLACEMENTS);
    },
  );

  it('returns fresh documents instead of sharing editable arrays', async () => {
    const first = await createShippedMap('hollow_crypt', 'first', 1);
    const second = await createShippedMap('hollow_crypt', 'second', 2);
    first.placements[0].x += 99;
    first.content.zones[0].name = 'Changed';

    expect(second.placements[0].x).not.toBe(first.placements[0].x);
    expect(second.content.zones[0].name).not.toBe('Changed');
  });

  it('materializes collision and visible geometry for fixed-layout spaces', async () => {
    for (const entry of SHIPPED_MAPS.filter((candidate) => candidate.id !== 'overworld')) {
      const map = await createShippedMap(entry.id, entry.id, 1);
      expect(map.placements.some((placement) => placement.assetId.startsWith('collider/'))).toBe(
        true,
      );
      // Collision volumes are hidden chrome. A REGION map also uses collider
      // volumes for its game-mode anchors (respawn points, rune pads), and
      // those are the opposite: visible, draggable, and never blocking.
      expect(
        map.placements
          .filter((placement) => placement.assetId.startsWith('collider/') && placement.collide)
          .every((placement) => placement.hidden === true),
      ).toBe(true);
      expect(
        map.placements
          .filter((placement) => placement.regionRole !== undefined)
          .every((placement) => placement.hidden !== true && placement.collide === false),
      ).toBe(true);
      if (entry.id === 'protect_yumi_maze') {
        expect(map.placements.every((placement) => placement.assetId.startsWith('collider/'))).toBe(
          true,
        );
      } else {
        expect(map.placements.some((placement) => !placement.assetId.startsWith('collider/'))).toBe(
          true,
        );
      }
      const zone = map.content.zones[0];
      const halfW = map.worldHalfX ?? Infinity;
      for (const placement of map.placements) {
        expect(Math.abs(placement.x), `${entry.id}: ${placement.assetId} x`).toBeLessThanOrEqual(
          halfW,
        );
        expect(placement.z, `${entry.id}: ${placement.assetId} zMin`).toBeGreaterThanOrEqual(
          zone.zMin,
        );
        expect(placement.z, `${entry.id}: ${placement.assetId} zMax`).toBeLessThanOrEqual(
          zone.zMax,
        );
        if (placement.assetId.startsWith('collider/')) {
          expect(placement.sizeX ?? 0).toBeLessThanOrEqual(200);
          expect(placement.sizeZ ?? 0).toBeLessThanOrEqual(200);
        }
      }
    }
  });

  it('uses the authored Litany render plan instead of a generic tiled rectangle', async () => {
    const map = await createShippedMap('litany_sluice', 'sluice', 1);
    const visible = map.placements.filter(
      (placement) => !placement.assetId.startsWith('collider/'),
    );
    const floorKinds = new Set(
      visible
        .map((placement) => placement.assetId)
        .filter((assetId) => assetId.startsWith('dungeon/floor_')),
    );

    expect(floorKinds.size).toBeGreaterThan(2);
    expect(visible.some((placement) => placement.assetId === 'dungeon/wall_cracked')).toBe(true);
    expect(visible.some((placement) => placement.name === 'Blackwater')).toBe(true);
    expect(visible.some((placement) => placement.name === 'Dry island')).toBe(true);
  });

  it('preserves the shipped interior environment instead of presenting it outdoors', async () => {
    const dungeon = await createShippedMap('hollow_crypt', 'dungeon', 1);
    const temple = await createShippedMap('drowned_temple', 'temple', 1);
    const raid = await createShippedMap('nythraxis_raid_arena', 'raid', 1);
    const arena = await createShippedMap('ashen_coliseum', 'arena', 1);
    const delve = await createShippedMap('litany_sluice', 'delve', 1);
    const yumi = await createShippedMap('protect_yumi_maze', 'yumi', 1);

    expect(sanitizeMapDoc(dungeon)?.presentationMode).toBe('dungeon');
    expect(sanitizeMapDoc(temple)?.presentationMode).toBe('temple');
    expect(sanitizeMapDoc(raid)?.presentationMode).toBe('nythraxis');
    expect(sanitizeMapDoc(arena)?.presentationMode).toBe('dungeon');
    expect(sanitizeMapDoc(delve)?.presentationMode).toBe('delve');
    expect(sanitizeMapDoc(yumi)?.presentationMode).toBe('yumiMaze');
    expect(delve.lights?.length).toBeGreaterThan(0);
    expect(delve.lights?.every((light) => light.color === 0x6aff8c)).toBe(true);
  });
});
