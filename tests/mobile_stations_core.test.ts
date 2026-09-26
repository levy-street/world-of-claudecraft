// The placed mobile-station prop plan (src/render/mobile_stations_core.ts):
// the town cluster of the craft's station type, with the capstone items'
// anchor overrides (the Grand Cauldron is grand; the hearth blazes).
import { describe, expect, it } from 'vitest';
import { mobileStationPropPlan } from '../src/render/mobile_stations_core';
import { ITEMS } from '../src/sim/data';
import { mobileStationTemplateId } from '../src/sim/professions/mobile_station_object';
import { craftsForStationType } from '../src/sim/professions/stations';
import { STATION_PROP_CLUSTERS } from '../src/sim/town_props';

const STATION_TYPES = Object.keys(STATION_PROP_CLUSTERS) as (keyof typeof STATION_PROP_CLUSTERS)[];

describe('mobileStationPropPlan', () => {
  it('gives every placeable station item a plan whose anchor is its town station anchor', () => {
    const placeables = Object.values(ITEMS).filter((d) => d.use?.type === 'placeMobileStation');
    expect(placeables.length).toBeGreaterThanOrEqual(3);
    for (const def of placeables) {
      const plan = mobileStationPropPlan(mobileStationTemplateId(def.id));
      expect(plan, def.id).not.toBeNull();
      expect(plan?.[0].kind, def.id).toBe(
        STATION_PROP_CLUSTERS[
          def.use?.type === 'placeMobileStation' && def.use.stationCraftId === 'alchemy'
            ? 'apothecary'
            : def.use?.type === 'placeMobileStation' && def.use.stationCraftId === 'cooking'
              ? 'kitchens'
              : 'forge'
        ][0].kind,
      );
    }
  });

  it('gives every station craft a specialization-placement plan matching its town cluster', () => {
    for (const type of STATION_TYPES) {
      for (const craft of craftsForStationType(type)) {
        const plan = mobileStationPropPlan(mobileStationTemplateId(craft));
        expect(plan?.map((p) => [p.kind, p.dx, p.dz, p.rot])).toEqual(
          STATION_PROP_CLUSTERS[type].map((p) => [p.kind, p.dx, p.dz, p.rot]),
        );
        // No override: town scale everywhere, fire only on a town campfire.
        expect(plan?.every((p) => p.scale === 1)).toBe(true);
        expect(plan?.every((p) => p.fire === (p.kind === 'campfire' ? 1 : 0))).toBe(true);
      }
    }
  });

  it('makes the Grand Cauldron grand: a taller anchor over a fire, clutter untouched', () => {
    const plan = mobileStationPropPlan(mobileStationTemplateId('grand_cauldron'));
    expect(plan?.[0].kind).toBe('cauldron');
    expect(plan?.[0].scale).toBeGreaterThan(1);
    expect(plan?.[0].fire).toBeGreaterThan(0);
    expect(plan?.slice(1).every((p) => p.scale === 1 && p.fire === 0)).toBe(true);
  });

  it('gives the Laden Hearth a larger blaze than the town campfire', () => {
    const plan = mobileStationPropPlan(mobileStationTemplateId('laden_hearth'));
    expect(plan?.[0].kind).toBe('campfire');
    expect(plan?.[0].fire).toBeGreaterThan(1);
  });

  it('answers null for anything that is not a mobile station', () => {
    expect(mobileStationPropPlan('farm_feast')).toBeNull();
    expect(mobileStationPropPlan(mobileStationTemplateId('enchanting'))).toBeNull();
    expect(mobileStationPropPlan(null)).toBeNull();
  });
});
