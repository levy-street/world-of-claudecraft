import { describe, expect, it } from 'vitest';
import {
  DRAKELANDS_KIT_PREFETCH_MARGIN_YD,
  drakelandsKitBootPreloaded,
  drakelandsKitBootThunk,
  drakelandsKitHoldsZone,
  drakelandsKitPrefetchDue,
  zoneFeaturesNeedDrakelandsKit,
} from '../src/render/drakelands_kit_lane_core';
import { zonesWithinStreamingHorizon } from '../src/render/zone_streaming';
import {
  EASTBROOK_FERRY_TIMINGS,
  WICKHARBOR_DRAKELANDS_FERRY,
} from '../src/sim/content/transport_ships';
import { ZONES } from '../src/sim/data';
import { RUN_SPEED, type ZoneDef } from '../src/sim/types';

// The iOS prepare horizon: LOW_FOG far, the constant the iOS profile's Lambert
// tier streams against (the vista is off on constrained profiles).
const IOS_HORIZON = 340;
const drakelands = ZONES.find((zone) => zone.id === 'drakelands');
if (!drakelands) throw new Error('expected the Drakelands in the built-in zones');

describe('which hosts preload the Drakelands kit at boot', () => {
  it('keeps the boot preload everywhere but the iOS memory profile', () => {
    expect(drakelandsKitBootPreloaded({ iosMemoryProfile: false })).toBe(true);
    expect(drakelandsKitBootPreloaded({ iosMemoryProfile: true })).toBe(false);
  });

  it('runs the load on desktop and Android and resolves without loading on iOS', async () => {
    let loads = 0;
    const load = (): Promise<string> => {
      loads++;
      return Promise.resolve('loaded');
    };
    const profile = { iosMemoryProfile: false };
    const thunk = drakelandsKitBootThunk(load, () => profile);
    // Registering the thunk starts nothing: it is the deferred lane's to call.
    expect(loads).toBe(0);
    await expect(thunk()).resolves.toBe('loaded');
    expect(loads).toBe(1);
    profile.iosMemoryProfile = true;
    await expect(thunk()).resolves.toBeUndefined();
    expect(loads).toBe(1);
  });

  it('reads the profile when the lane opens, not when the module registers', async () => {
    let ios = true;
    let loads = 0;
    const thunk = drakelandsKitBootThunk(
      () => {
        loads++;
        return Promise.resolve();
      },
      () => ({ iosMemoryProfile: ios }),
    );
    ios = false;
    await thunk();
    expect(loads).toBe(1);
  });
});

describe('which zone features need the kit', () => {
  it('is the ember biome (the Drakelands dressing, Wyrmwatch and the fortress) and nothing else', () => {
    expect(zoneFeaturesNeedDrakelandsKit('ember')).toBe(true);
    for (const zone of ZONES) {
      expect(zoneFeaturesNeedDrakelandsKit(zone.biome), zone.id).toBe(zone.biome === 'ember');
    }
    expect(ZONES.filter((zone) => zone.biome === 'ember').map((zone) => zone.id)).toEqual([
      'drakelands',
    ]);
  });
});

describe('the visible-zone hold', () => {
  it('holds only a zone that needs the kit, and only while the kit is not resident', () => {
    for (const zone of ZONES) {
      expect(drakelandsKitHoldsZone(zone.biome, false), zone.id).toBe(zone.biome === 'ember');
      expect(drakelandsKitHoldsZone(zone.biome, true), zone.id).toBe(false);
    }
  });
});

describe('the prefetch trigger', () => {
  const zMin = drakelands.zMin;

  it('fires once the Drakelands rectangle is within the prepare horizon plus the margin', () => {
    const reach = IOS_HORIZON + DRAKELANDS_KIT_PREFETCH_MARGIN_YD;
    expect(drakelandsKitPrefetchDue(ZONES, 404, zMin - reach, IOS_HORIZON)).toBe(true);
    expect(drakelandsKitPrefetchDue(ZONES, 404, zMin - reach - 1, IOS_HORIZON)).toBe(false);
    // Inside the zone (Wyrmwatch) and on the isle.
    expect(drakelandsKitPrefetchDue(ZONES, 404, 1900, IOS_HORIZON)).toBe(true);
    expect(drakelandsKitPrefetchDue(ZONES, 503, 2249, IOS_HORIZON)).toBe(true);
    // Eastbrook is nowhere near.
    expect(drakelandsKitPrefetchDue(ZONES, 0, 0, IOS_HORIZON)).toBe(false);
  });

  it('scales with the horizon the prepare lane is fed', () => {
    expect(drakelandsKitPrefetchDue(ZONES, 404, zMin - 1100, IOS_HORIZON)).toBe(false);
    expect(drakelandsKitPrefetchDue(ZONES, 404, zMin - 1100, 850)).toBe(true);
    // A negative horizon clamps to zero rather than shrinking the margin.
    expect(
      drakelandsKitPrefetchDue(ZONES, 404, zMin - DRAKELANDS_KIT_PREFETCH_MARGIN_YD, -50),
    ).toBe(true);
  });

  it('ignores zones that do not need the kit', () => {
    const notEmber: ZoneDef[] = ZONES.filter((zone) => zone.biome !== 'ember');
    expect(drakelandsKitPrefetchDue(notEmber, 404, 1900, IOS_HORIZON)).toBe(false);
  });

  it('always fires before the prepare lane can ask for the Drakelands (the load leads the prepare)', () => {
    // Every camera from which zonesWithinStreamingHorizon would queue the
    // Drakelands must already have prefetched: the prepare awaits the kit, and
    // the margin is what lets the fetch finish before the prepare needs it.
    let checked = 0;
    for (let x = -600; x <= 1300; x += 50) {
      for (let z = 1000; z <= 3200; z += 50) {
        const queued = zonesWithinStreamingHorizon(ZONES, x, z, IOS_HORIZON).some(
          (zone) => zone.id === 'drakelands',
        );
        if (!queued) continue;
        checked++;
        expect(drakelandsKitPrefetchDue(ZONES, x, z, IOS_HORIZON), `${x},${z}`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('leads the prepare by the margin: 40 s on foot, 15 s on the Wickharbor ferry', () => {
    // The ferry is the fastest way in without a curtain: it sails the coast
    // inside the Drakelands' x range at cruise speed.
    expect(DRAKELANDS_KIT_PREFETCH_MARGIN_YD / RUN_SPEED).toBeGreaterThan(40);
    expect(DRAKELANDS_KIT_PREFETCH_MARGIN_YD / EASTBROOK_FERRY_TIMINGS.cruise).toBeGreaterThan(15);
    expect(WICKHARBOR_DRAKELANDS_FERRY.timings).toBe(EASTBROOK_FERRY_TIMINGS);
  });
});
