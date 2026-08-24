// Unit tests for src/ui/entity_i18n.ts helpers not already covered by a more
// specific suite (the R34 stale-client guards live in entity_i18n_guards.test.ts).
import { describe, expect, it } from 'vitest';
import { ZONES } from '../src/sim/data';
import { poiMarkLabel, zonePoiLabel } from '../src/ui/entity_i18n';

describe('poiMarkLabel', () => {
  it('resolves a real deed poi mark to the same label the world map renders', () => {
    const zone = ZONES.find((z) => z.id === 'thornpeak_heights')!;
    const poiIndex = zone.pois.findIndex((p) => p.id === 'highwatch');
    expect(poiIndex).toBeGreaterThanOrEqual(0);
    expect(poiMarkLabel('poi:thornpeak_heights:highwatch')).toBe(
      zonePoiLabel('thornpeak_heights', poiIndex),
    );
  });

  it('is stable across a zone reorder: it always resolves by id, never by position', () => {
    const zone = ZONES.find((z) => z.id === 'mirefen_marsh')!;
    for (const poi of zone.pois) {
      if (poi.id === undefined) continue;
      const expectedIndex = zone.pois.indexOf(poi);
      expect(poiMarkLabel(`poi:mirefen_marsh:${poi.id}`)).toBe(
        zonePoiLabel('mirefen_marsh', expectedIndex),
      );
    }
  });

  it('returns null for an unknown zone, an unknown poi id, and a malformed mark', () => {
    expect(poiMarkLabel('poi:no_such_zone:highwatch')).toBeNull();
    expect(poiMarkLabel('poi:thornpeak_heights:no_such_poi')).toBeNull();
    expect(poiMarkLabel('poi:thornpeak_heights')).toBeNull(); // too few segments
    expect(poiMarkLabel('poi:a:b:c')).toBeNull(); // too many segments
    expect(poiMarkLabel('gather:thornpeak_heights:ore')).toBeNull(); // wrong namespace
  });
});
