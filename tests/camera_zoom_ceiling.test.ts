// The camera's boss-aware zoom ceiling (src/game/camera_zoom_ceiling.ts): the
// everyday 22 yd ceiling grows with a big boss's drawn height inside a
// dungeon, up to 40, never below 22 and never outside a dungeon; it rises at
// once and eases back down, and the camera is pulled in under it.

import { describe, expect, it } from 'vitest';
import {
  BASE_ZOOM_MAX,
  BOSS_ZOOM_MAX,
  clampCamDist,
  easeZoomCeiling,
  ZOOM_CEILING_EASE_DOWN,
  zoomCeilingFor,
} from '../src/game/camera_zoom_ceiling';

describe('the boss zoom ceiling', () => {
  it('keeps today’s 22 yd everywhere but a dungeon boss context', () => {
    expect(BASE_ZOOM_MAX).toBe(22);
    expect(zoomCeilingFor({ inDungeon: false, bossHeights: [24] })).toBe(22);
    expect(zoomCeilingFor({ inDungeon: true, bossHeights: [] })).toBe(22);
    // A trash-sized body raises nothing.
    expect(zoomCeilingFor({ inDungeon: true, bossHeights: [3, 5] })).toBe(22);
  });

  it('grows with the tallest boss, up to 40 for the biggest', () => {
    const tock = zoomCeilingFor({ inDungeon: true, bossHeights: [8.2] });
    const wyrm = zoomCeilingFor({ inDungeon: true, bossHeights: [18.8] });
    const ysolei = zoomCeilingFor({ inDungeon: true, bossHeights: [23.97] });
    expect(tock).toBeGreaterThan(22);
    expect(wyrm).toBeGreaterThan(tock);
    expect(ysolei).toBeGreaterThan(wyrm);
    expect(ysolei).toBeLessThanOrEqual(BOSS_ZOOM_MAX);
    expect(zoomCeilingFor({ inDungeon: true, bossHeights: [80] })).toBe(BOSS_ZOOM_MAX);
    expect(zoomCeilingFor({ inDungeon: true, bossHeights: [3, 18.8] })).toBe(wyrm);
  });

  it('rises at once and eases back down, never below the target', () => {
    expect(easeZoomCeiling(22, 38, 0.016)).toBe(38);
    const step = easeZoomCeiling(38, 22, 0.5);
    expect(step).toBeCloseTo(38 - ZOOM_CEILING_EASE_DOWN * 0.5, 6);
    let c = 38;
    for (let i = 0; i < 400; i++) c = easeZoomCeiling(c, 22, 0.05);
    expect(c).toBe(22);
  });

  it('pulls the camera in under the ceiling, never pushes it out', () => {
    expect(clampCamDist(35, 30)).toBe(30);
    expect(clampCamDist(12, 30)).toBe(12);
  });
});
