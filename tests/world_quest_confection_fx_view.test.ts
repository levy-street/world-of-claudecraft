import { describe, expect, it } from 'vitest';
import {
  worldQuestConfectionFxProfile,
  worldQuestConfectionSparkPath,
} from '../src/ui/world_quest_confection_fx_view';

describe('Confection magic intensity', () => {
  it('keeps the three-clear particle budget restrained', () => {
    expect(worldQuestConfectionFxProfile(3)).toEqual({
      tier: 'match',
      sparksPerCell: 5,
      sparkBudget: 48,
      sparkDuration: 620,
      sparkDistance: 38,
      sparkSize: 7,
      burstScale: 1.6,
      rings: 0,
      rays: 0,
    });
  });

  it.each([
    [3, 'match'],
    [4, 'bright'],
    [5, 'splendid'],
    [7, 'splendid'],
    [8, 'grand'],
    [72, 'grand'],
    [1080, 'grand'],
  ] as const)('selects %s cleared confections as %s', (cleared, tier) => {
    expect(worldQuestConfectionFxProfile(cleared).tier).toBe(tier);
  });

  it('increases sparkle count, reach, size and radiance as the actual clear total grows', () => {
    const profiles = [3, 4, 5, 8].map(worldQuestConfectionFxProfile);
    for (let index = 1; index < profiles.length; index++) {
      const previous = profiles[index - 1];
      const current = profiles[index];
      expect(current.sparkBudget).toBeGreaterThan(previous.sparkBudget);
      expect(current.sparksPerCell).toBeGreaterThan(previous.sparksPerCell);
      expect(current.sparkDistance).toBeGreaterThan(previous.sparkDistance);
      expect(current.sparkSize).toBeGreaterThan(previous.sparkSize);
      expect(current.sparkDuration).toBeGreaterThan(previous.sparkDuration);
      expect(current.burstScale).toBeGreaterThan(previous.burstScale);
      expect(current.rings).toBeGreaterThanOrEqual(previous.rings);
      expect(current.rays).toBeGreaterThanOrEqual(previous.rays);
    }
    expect(profiles[0].rings + profiles[0].rays).toBe(0);
    expect(profiles[2].rings + profiles[2].rays).toBeGreaterThan(0);
  });

  it('reuses a bounded profile for every cascade total in a tier', () => {
    expect(worldQuestConfectionFxProfile(5)).toBe(worldQuestConfectionFxProfile(7));
    expect(worldQuestConfectionFxProfile(8)).toBe(worldQuestConfectionFxProfile(1080));
    expect(worldQuestConfectionFxProfile(0)).toBe(worldQuestConfectionFxProfile(3));
  });
});

describe('Confection sparkle choreography', () => {
  it('sends a fountain through a clear apex before it drifts downward', () => {
    const path = worldQuestConfectionSparkPath(120, -200, 2, true);
    const apex = Math.min(...path.map((point) => point.y));
    expect(path[0].x).toBe(0);
    expect(path[0].y).toBe(0);
    expect(apex).toBeLessThan(-150);
    expect(path.at(-1)?.y).toBeGreaterThan(0);
    expect(path.at(-1)?.x).toBeCloseTo(120);
    expect(path.findIndex((point) => point.y === apex)).toBeGreaterThan(0);
    expect(path.findIndex((point) => point.y === apex)).toBeLessThan(path.length - 1);
  });

  it('curves matched sugar sparks in alternating directions and lets them settle', () => {
    const left = worldQuestConfectionSparkPath(60, 0, 0, false);
    const right = worldQuestConfectionSparkPath(60, 0, 1, false);
    expect(left[2].y).toBeGreaterThan(0);
    expect(right[2].y).toBeLessThan(0);
    expect(left.at(-1)?.x).toBeCloseTo(60);
    expect(right.at(-1)?.x).toBeCloseTo(60);
    expect(left.at(-1)?.y).toBeGreaterThan(0);
    expect(right.at(-1)?.y).toBeGreaterThan(0);
  });

  it.each([true, false])(
    'keeps the fountain=%s path finite, repeatable and softly fading',
    (fountain) => {
      const path = worldQuestConfectionSparkPath(-90, -160, 5, fountain);
      expect(path).toEqual(worldQuestConfectionSparkPath(-90, -160, 5, fountain));
      expect(path[0].offset).toBe(0);
      expect(path.at(-1)?.offset).toBe(1);
      expect(path[0].opacity).toBe(0);
      expect(path.at(-1)?.opacity).toBe(0);
      expect(path.every((point) => Object.values(point).every(Number.isFinite))).toBe(true);
      const peak = path.findIndex(
        (point) => point.opacity === Math.max(...path.map((entry) => entry.opacity)),
      );
      expect(peak).toBeGreaterThan(0);
      expect(peak).toBeLessThan(path.length - 1);
      expect(path[peak].opacity).toBeGreaterThan(0.5);
      expect(
        path
          .slice(peak + 1, -1)
          .some((point) => point.opacity > 0 && point.opacity < path[peak].opacity),
      ).toBe(true);
      for (let index = 1; index < path.length; index++) {
        expect(path[index].offset).toBeGreaterThan(path[index - 1].offset);
        expect(path[index].scale).toBeGreaterThan(0);
        expect(path[index].opacity).toBeGreaterThanOrEqual(0);
        expect(path[index].opacity).toBeLessThanOrEqual(1);
        if (index > peak) expect(path[index].opacity).toBeLessThanOrEqual(path[index - 1].opacity);
      }
    },
  );
});
