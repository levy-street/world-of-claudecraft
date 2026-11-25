import { describe, expect, it } from 'vitest';
import { questMap } from '../scripts/mediawiki/quest_map';
import { ZONE1_ZONE } from '../src/sim/content/zone1';
import { mapZoneRegion } from '../src/ui/map_terrain';

describe('full-zone wiki maps', () => {
  it('uses the complete zone plate for a single point or a tightly clustered route', () => {
    const plate = mapZoneRegion(ZONE1_ZONE);
    const point = {
      step: 'Start' as const,
      frame: 'Overworld',
      label: 'Town stop',
      x: ZONE1_ZONE.hub.x,
      z: ZONE1_ZONE.hub.z,
    };
    const one = questMap({ points: [point] });
    const two = questMap({
      points: [point, { ...point, step: 1, x: point.x + 1, z: point.z + 1 }],
    });
    for (const map of [one, two]) {
      expect(map).toContain('background-size:100% 100%;background-position:0% 0%');
      expect(map).toContain(
        'aspect-ratio:' + (plate.maxX - plate.minX) + '/' + (plate.maxZ - plate.minZ),
      );
      const x = Number(((100 * (plate.maxX - point.x)) / (plate.maxX - plate.minX)).toFixed(3));
      const z = Number(((100 * (plate.maxZ - point.z)) / (plate.maxZ - plate.minZ)).toFixed(3));
      expect(map).toContain('left:' + x + '%;top:' + z + '%');
    }
  });
  it('keeps item source numbers separate from quest objective numbering', () => {
    const map = questMap(
      { points: [{ step: 2, frame: 'Overworld', label: 'Buy here', x: 0, z: 0 }] },
      'item',
    );
    expect(map).toContain('== Acquisition map ==');
    expect(map).toContain('A number on the map matches a numbered way to get it above');
    // Each location line reads as a sentence: number, coordinates, then what to do there.
    expect(map).toContain("* '''2''' (0, 0): Buy here.");
    expect(map).not.toMatch(/^\* 2 · /m);
  });
  it('gives each thing to do at a shared spot its own line with its own number', () => {
    const at = { frame: 'Overworld', x: 10, z: 20 };
    const map = questMap({
      points: [
        { ...at, step: 'Start' as const, label: 'Talk to the captain' },
        { ...at, step: 1, label: 'Search the crates · east dock', radius: 8 },
      ],
    });
    expect(map).toContain("* '''S''' (10, 20), search within 8 yards: Talk to the captain.");
    expect(map).toContain(
      "* '''1''' (10, 20), search within 8 yards: Search the crates, east dock.",
    );
  });
});
