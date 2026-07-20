// Render pure core for the Phase 9 crafting-station scenery: every STATIONS
// record gets a prop cluster, every cluster's anchor sits EXACTLY on the
// station pos (the spot the proximity gate measures from is the spot the
// player sees), every prop kind resolves to a real preloadable asset, and
// the flatten is deterministic. The on-disk/manifest sweep for the asset
// URLs lives in tests/render_glb_replacement_assets.test.ts.
import { describe, expect, it } from 'vitest';
import { stationsPreloadInternalsForTest } from '../src/render/stations';
import { STATION_PROP_CLUSTERS, stationPropPlacements } from '../src/render/stations_core';
import { STATIONS } from '../src/sim/data';

describe('stationPropPlacements (the pure placement core)', () => {
  it('covers every STATIONS record', () => {
    const placedIds = new Set(stationPropPlacements().map((p) => p.stationId));
    for (const station of STATIONS) {
      expect(placedIds.has(station.id), station.id).toBe(true);
    }
    expect(placedIds.size).toBe(STATIONS.length);
  });

  it('each cluster carries exactly one anchor and it lands on the station pos', () => {
    for (const station of STATIONS) {
      const cluster = STATION_PROP_CLUSTERS[station.type];
      const anchors = cluster.filter((prop) => prop.dx === 0 && prop.dz === 0);
      expect(anchors, `${station.type} cluster anchor count`).toHaveLength(1);
      const placements = stationPropPlacements().filter((p) => p.stationId === station.id);
      const anchorPlacement = placements.find(
        (p) => p.x === station.pos.x && p.z === station.pos.z,
      );
      expect(anchorPlacement, `${station.id} anchor placement on pos`).toBeDefined();
      expect(anchorPlacement?.kind).toBe(anchors[0].kind);
    }
  });

  it('every placement kind resolves to a preloadable asset and a target height', () => {
    const { assetUrl, targetHeight } = stationsPreloadInternalsForTest;
    for (const placement of stationPropPlacements()) {
      expect(assetUrl[placement.kind], placement.kind).toBeDefined();
      expect(targetHeight[placement.kind], placement.kind).toBeGreaterThan(0);
    }
  });

  it('every cluster type is a real station type present in STATIONS (no orphans)', () => {
    const stationTypes = new Set(STATIONS.map((s) => s.type));
    for (const type of Object.keys(STATION_PROP_CLUSTERS)) {
      expect(stationTypes.has(type as never), type).toBe(true);
    }
    for (const type of stationTypes) {
      expect(STATION_PROP_CLUSTERS[type], type).toBeDefined();
    }
  });

  it('is deterministic: two flattens are deep-equal', () => {
    expect(stationPropPlacements()).toEqual(stationPropPlacements());
  });
});
