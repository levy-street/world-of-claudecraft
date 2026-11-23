// Regression guard for "the locations are not coming up, it just says
// <zone> .pos1" (2026-09-21). An authored map declares its own zone, which
// is in no shipped list and in no locale catalog, and it names its places with
// `locations` rects rather than zone POI points. Both facts used to be
// invisible to the HUD: the banner read the raw zone id and a positional key
// tail, and the named places never bannered at all. The fixture is the
// published Goldcrest map, whose harbor city is exactly such an authored zone.
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { type CustomMap, customMapToWorldContent } from '../src/editor/custom_map';
import { activeNamedAreas, setActiveWorldContent, zoneAt } from '../src/sim/data';
import type { WorldContent } from '../src/sim/types';
import { zoneDisplayName, zonePoiLabel } from '../src/ui/entity_i18n';
import { currentSubzone } from '../src/ui/subzone';

let world: WorldContent;
let zone: WorldContent['zones'][number];

beforeAll(() => {
  const doc = JSON.parse(
    readFileSync('data/maps/world_of_claudecraft_with_goldcrest.map.json', 'utf8'),
  ) as CustomMap;
  world = customMapToWorldContent(doc);
  setActiveWorldContent(world);
  const found = world.zones.find((z) => z.id === 'goldcrest_harbor');
  if (!found) throw new Error('the Goldcrest fixture lost its authored zone');
  zone = found;
});

describe('an authored map names its own places', () => {
  it('the fixture still carries a zone and a body of named locations', () => {
    expect(world.zones.length).toBeGreaterThan(0);
    expect((world.locations ?? []).length).toBeGreaterThanOrEqual(10);
  });

  it('the zone label resolves to the zone name, never the raw id', () => {
    expect(zoneDisplayName(zone.id)).toBe(zone.name);
    expect(zoneDisplayName(zone.id)).not.toBe(zone.id);
  });

  it('zone POI labels resolve, never the "<zone>.pois.<n>" key tail', () => {
    expect(zone.pois.length).toBeGreaterThan(0);
    for (let i = 0; i < zone.pois.length; i++) {
      expect(zonePoiLabel(zone.id, i)).toBe(zone.pois[i].label);
    }
  });

  it('every named location banners something when the player stands in it', () => {
    const areas = activeNamedAreas();
    const silent = areas
      .filter((loc) => {
        const cx = (loc.minX + loc.maxX) / 2;
        const cz = (loc.minZ + loc.maxZ) / 2;
        return currentSubzone(cx, cz, zoneAt(cx, cz).pois, areas, null) === null;
      })
      .map((loc) => loc.name);
    expect(silent).toEqual([]);
  });

  it('a location with nothing nested inside it banners its own name', () => {
    const areas = activeNamedAreas();
    const nests = (loc: (typeof areas)[number]): boolean =>
      areas.some(
        (o) =>
          o !== loc &&
          (o.maxX - o.minX) * (o.maxZ - o.minZ) < (loc.maxX - loc.minX) * (loc.maxZ - loc.minZ) &&
          o.minX >= loc.minX &&
          o.maxX <= loc.maxX &&
          o.minZ >= loc.minZ &&
          o.maxZ <= loc.maxZ,
      );
    const leaves = areas.filter((loc) => !nests(loc));
    expect(leaves.length).toBeGreaterThan(5);
    const wrong = leaves
      .map((loc) => {
        const cx = (loc.minX + loc.maxX) / 2;
        const cz = (loc.minZ + loc.maxZ) / 2;
        const got = currentSubzone(cx, cz, zoneAt(cx, cz).pois, areas, null)?.label ?? null;
        return got === loc.name ? null : `${loc.name} -> ${got}`;
      })
      .filter((row): row is string => row !== null);
    expect(wrong).toEqual([]);
  });

  it('an authored area reports poiIndex -1 so the caller skips the locale key', () => {
    const areas = activeNamedAreas();
    const loc = areas[0];
    const cx = (loc.minX + loc.maxX) / 2;
    const cz = (loc.minZ + loc.maxZ) / 2;
    expect(currentSubzone(cx, cz, zoneAt(cx, cz).pois, areas, null)?.poiIndex).toBe(-1);
  });
});
