// The Quartered Isle's landmark-asset lane policy
// (src/render/quartered_landmark_lane_core.ts). Node-only (RENDER_PURE_CORES).
import { describe, expect, it } from 'vitest';
import { DRAKELANDS_KIT_PREFETCH_MARGIN_YD } from '../src/render/drakelands_kit_lane_core';
import {
  QUARTERED_LANDMARK_PREFETCH_MARGIN_YD,
  quarteredLandmarkHoldsZone,
  quarteredLandmarkPrefetchDue,
  zoneFeaturesNeedQuarteredLandmarks,
} from '../src/render/quartered_landmark_lane_core';
import { ZONES } from '../src/sim/data';

const isle = ZONES.find((zone) => zone.id === 'quartered_isle');
if (!isle) throw new Error('quartered_isle missing');
const HORIZON = 340;

describe('the Quartered Isle landmark lane policy', () => {
  it('names the quartered biome, and only it', () => {
    expect(zoneFeaturesNeedQuarteredLandmarks('quartered')).toBe(true);
    for (const biome of ['ember', 'frost', 'amber', 'vale'] as const) {
      expect(zoneFeaturesNeedQuarteredLandmarks(biome), biome).toBe(false);
    }
  });

  it('holds the isle out of the one-at-a-time lane only while its assets are missing', () => {
    expect(quarteredLandmarkHoldsZone('quartered', false)).toBe(true);
    expect(quarteredLandmarkHoldsZone('quartered', true)).toBe(false);
    // another biome is never held by these assets, resident or not
    expect(quarteredLandmarkHoldsZone('ember', false)).toBe(false);
    expect(quarteredLandmarkHoldsZone('frost', false)).toBe(false);
  });

  it('takes the same approach lead the Drakelands kit does', () => {
    expect(QUARTERED_LANDMARK_PREFETCH_MARGIN_YD).toBe(300);
    expect(QUARTERED_LANDMARK_PREFETCH_MARGIN_YD).toBe(DRAKELANDS_KIT_PREFETCH_MARGIN_YD);
  });

  it('starts the fetch a margin before the isle comes within the prepare horizon', () => {
    const reach = HORIZON + QUARTERED_LANDMARK_PREFETCH_MARGIN_YD;
    // walking north up the strip toward the isle's south edge (zMin)
    const due = (z: number) => quarteredLandmarkPrefetchDue(ZONES, 0, z, HORIZON);
    expect(due(isle.zMin - reach - 1)).toBe(false);
    expect(due(isle.zMin - reach + 1)).toBe(true);
    // ...which is before the prepare lane itself can queue the zone
    expect(isle.zMin - reach + 1).toBeLessThan(isle.zMin - HORIZON);
    expect(due(isle.zMin + 10)).toBe(true); // standing on it
    // far down the strip, and with no quartered zone in the world at all
    expect(due(0)).toBe(false);
    expect(
      quarteredLandmarkPrefetchDue(
        ZONES.filter((zone) => zone !== isle),
        0,
        isle.zMin,
        HORIZON,
      ),
    ).toBe(false);
  });

  it('treats a negative horizon as zero', () => {
    const z = isle.zMin - QUARTERED_LANDMARK_PREFETCH_MARGIN_YD + 1;
    expect(quarteredLandmarkPrefetchDue(ZONES, 0, z, -50)).toBe(true);
    expect(quarteredLandmarkPrefetchDue(ZONES, 0, z - 2, -50)).toBe(false);
  });
});
