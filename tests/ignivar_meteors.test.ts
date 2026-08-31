import { describe, expect, it } from 'vitest';
import { IGNIVAR_LAYOUT } from '../src/sim/dungeon_layout';
import { polygonContainsPoint } from '../src/sim/geometry2d';
import {
  activeIgnivarMeteorWarnings,
  IGNIVAR_METEOR_COUNT_HEROIC,
  IGNIVAR_METEOR_COUNT_NORMAL,
  IGNIVAR_METEOR_MAX_RANGE,
  IGNIVAR_METEOR_MAX_RANGE_HEROIC,
  IGNIVAR_METEOR_MIN_RANGE,
  IGNIVAR_METEOR_MIN_SEPARATION,
  IGNIVAR_METEOR_MIN_SEPARATION_HEROIC,
  IGNIVAR_METEOR_RADIUS,
  IGNIVAR_METEOR_REVEAL_DELAY_SECONDS,
  IGNIVAR_METEOR_TELEGRAPH_SECONDS,
  ignivarMeteorPattern,
  ignivarMeteorTargetOrder,
  pointInIgnivarMeteor,
} from '../src/sim/ignivar_meteors';

describe('Ignivar falling meteors', () => {
  it('pins five Normal warnings and seven more widely spread Heroic warnings', () => {
    expect(IGNIVAR_METEOR_COUNT_NORMAL).toBe(5);
    expect(IGNIVAR_METEOR_COUNT_HEROIC).toBe(7);
    expect(IGNIVAR_METEOR_RADIUS).toBe(2.4);
    expect(IGNIVAR_METEOR_MIN_RANGE).toBe(9);
    expect(IGNIVAR_METEOR_MAX_RANGE).toBe(25);
    expect(IGNIVAR_METEOR_MIN_SEPARATION).toBe(6);
    expect(IGNIVAR_METEOR_MAX_RANGE_HEROIC).toBe(27);
    expect(IGNIVAR_METEOR_MIN_SEPARATION_HEROIC).toBe(8);
    expect(IGNIVAR_METEOR_MIN_SEPARATION).toBeGreaterThanOrEqual(IGNIVAR_METEOR_RADIUS * 2);
    expect(IGNIVAR_METEOR_MIN_SEPARATION_HEROIC).toBeGreaterThan(IGNIVAR_METEOR_MIN_SEPARATION);
  });

  it.each([
    [
      'normal',
      IGNIVAR_METEOR_COUNT_NORMAL,
      IGNIVAR_METEOR_MAX_RANGE,
      IGNIVAR_METEOR_MIN_SEPARATION,
    ],
    [
      'heroic',
      IGNIVAR_METEOR_COUNT_HEROIC,
      IGNIVAR_METEOR_MAX_RANGE_HEROIC,
      IGNIVAR_METEOR_MIN_SEPARATION_HEROIC,
    ],
  ] as const)(
    'creates a deterministic, arena-safe %s pattern',
    (difficulty, count, maxRange, separation) => {
      const origin = { x: 120, z: -80 };
      const first = ignivarMeteorPattern(91, origin, difficulty);
      expect(first).toEqual(ignivarMeteorPattern(91, origin, difficulty));
      expect(first).not.toEqual(ignivarMeteorPattern(92, origin, difficulty));
      expect(first).toHaveLength(count);

      const polygon = IGNIVAR_LAYOUT.shellPolygon;
      if (!polygon) throw new Error('Ignivar arena polygon is missing');
      for (let castKey = 1; castKey <= 128; castKey++) {
        const pattern = ignivarMeteorPattern(castKey, origin, difficulty);
        for (let meteorIndex = 0; meteorIndex < pattern.length; meteorIndex++) {
          const meteor = pattern[meteorIndex];
          const distance = Math.hypot(meteor.x - origin.x, meteor.z - origin.z);
          expect(distance).toBeGreaterThanOrEqual(IGNIVAR_METEOR_MIN_RANGE);
          expect(distance).toBeLessThanOrEqual(maxRange);
          for (let edge = 0; edge < 16; edge++) {
            const angle = (edge * Math.PI * 2) / 16;
            expect(
              polygonContainsPoint(
                polygon,
                meteor.x - origin.x + Math.sin(angle) * IGNIVAR_METEOR_RADIUS,
                meteor.z - origin.z + Math.cos(angle) * IGNIVAR_METEOR_RADIUS,
              ),
            ).toBe(true);
          }
          for (let previous = 0; previous < meteorIndex; previous++) {
            expect(
              Math.hypot(meteor.x - pattern[previous].x, meteor.z - pattern[previous].z),
            ).toBeGreaterThanOrEqual(separation);
          }
        }
      }
    },
  );

  it('targets distinct players deterministically and leaves the current tank until last', () => {
    const targets = Array.from({ length: 10 }, (_, index) => ({
      id: 100 + index,
      x: index * 9,
      z: index % 2 === 0 ? 12 : -12,
    }));

    const first = ignivarMeteorTargetOrder(917, targets, targets[0].id, 7);

    expect(first).toEqual(ignivarMeteorTargetOrder(917, targets, targets[0].id, 7));
    expect(first).toHaveLength(7);
    expect(new Set(first.map((target) => target.id)).size).toBe(7);
    expect(first.some((target) => target.id === targets[0].id)).toBe(false);
    expect(ignivarMeteorTargetOrder(917, targets.slice(0, 3), targets[0].id, 7).at(-1)?.id).toBe(
      targets[0].id,
    );
  });

  it('freezes warnings on spread player positions and fans stacked targets apart', () => {
    const origin = { x: 120, z: -80 };
    const spreadTargets = Array.from({ length: IGNIVAR_METEOR_COUNT_HEROIC }, (_, index) => {
      const angle = (index * Math.PI * 2) / IGNIVAR_METEOR_COUNT_HEROIC;
      return {
        id: 200 + index,
        x: origin.x + Math.sin(angle) * 18,
        z: origin.z + Math.cos(angle) * 18,
      };
    });
    const targeted = ignivarMeteorPattern(441, origin, 'heroic', spreadTargets);
    expect(targeted).toEqual(spreadTargets.map(({ x, z }) => ({ x, z })));

    const stackedTargets = spreadTargets.map((target) => ({ ...target, x: origin.x, z: origin.z }));
    const fanned = ignivarMeteorPattern(441, origin, 'heroic', stackedTargets);
    expect(fanned).toHaveLength(IGNIVAR_METEOR_COUNT_HEROIC);
    for (let index = 0; index < fanned.length; index++) {
      for (let previous = 0; previous < index; previous++) {
        expect(
          Math.hypot(fanned[index].x - fanned[previous].x, fanned[index].z - fanned[previous].z),
        ).toBeGreaterThanOrEqual(IGNIVAR_METEOR_MIN_SEPARATION_HEROIC);
      }
    }
  });

  it('fans stacked Normal targets apart with the Normal spacing budget', () => {
    const origin = { x: 120, z: -80 };
    const stacked = Array.from({ length: IGNIVAR_METEOR_COUNT_NORMAL }, (_, index) => ({
      id: 300 + index,
      x: origin.x,
      z: origin.z,
    }));
    const points = ignivarMeteorPattern(442, origin, 'normal', stacked);
    expect(points).toHaveLength(IGNIVAR_METEOR_COUNT_NORMAL);
    for (let index = 0; index < points.length; index++) {
      for (let previous = 0; previous < index; previous++) {
        expect(
          Math.hypot(points[index].x - points[previous].x, points[index].z - points[previous].z),
        ).toBeGreaterThanOrEqual(IGNIVAR_METEOR_MIN_SEPARATION);
      }
    }
  });

  it('keeps short-handed player anchors and deterministically fills the remaining warnings', () => {
    const origin = { x: 25, z: -10 };
    const targets = [
      { id: 401, x: origin.x - 15, z: origin.z },
      { id: 402, x: origin.x + 15, z: origin.z },
    ];
    const points = ignivarMeteorPattern(443, origin, 'normal', targets);
    expect(points).toHaveLength(IGNIVAR_METEOR_COUNT_NORMAL);
    expect(points.slice(0, 2)).toEqual(targets.map(({ x, z }) => ({ x, z })));
    expect(points).toEqual(ignivarMeteorPattern(443, origin, 'normal', targets));
    expect(new Set(points.map((point) => `${point.x}:${point.z}`)).size).toBe(points.length);
    for (let index = 0; index < points.length; index++) {
      expect(
        Math.hypot(points[index].x - origin.x, points[index].z - origin.z),
      ).toBeLessThanOrEqual(IGNIVAR_METEOR_MAX_RANGE);
      for (let previous = 0; previous < index; previous++) {
        expect(
          Math.hypot(points[index].x - points[previous].x, points[index].z - points[previous].z),
        ).toBeGreaterThanOrEqual(IGNIVAR_METEOR_MIN_SEPARATION);
      }
    }
  });

  it('clamps a targeted warning at the arena edge instead of losing player targeting', () => {
    const origin = { x: 12, z: 19 };
    const point = ignivarMeteorPattern(444, origin, 'normal', [
      { id: 501, x: origin.x + 80, z: origin.z },
    ])[0];
    expect(point.x).toBeCloseTo(origin.x + IGNIVAR_METEOR_MAX_RANGE, 8);
    expect(point.z).toBeCloseTo(origin.z, 8);
  });

  it('fills a short-handed Heroic raid within its wider bounds and clamps edge targets', () => {
    const origin = { x: -30, z: 42 };
    const targets = [
      { id: 601, x: origin.x - 18, z: origin.z },
      { id: 602, x: origin.x + 18, z: origin.z },
    ];
    const points = ignivarMeteorPattern(445, origin, 'heroic', targets);
    expect(points).toHaveLength(IGNIVAR_METEOR_COUNT_HEROIC);
    expect(points.slice(0, 2)).toEqual(targets.map(({ x, z }) => ({ x, z })));
    for (let index = 0; index < points.length; index++) {
      expect(
        Math.hypot(points[index].x - origin.x, points[index].z - origin.z),
      ).toBeLessThanOrEqual(IGNIVAR_METEOR_MAX_RANGE_HEROIC);
      for (let previous = 0; previous < index; previous++) {
        expect(
          Math.hypot(points[index].x - points[previous].x, points[index].z - points[previous].z),
        ).toBeGreaterThanOrEqual(IGNIVAR_METEOR_MIN_SEPARATION_HEROIC);
      }
    }

    const edge = ignivarMeteorPattern(446, origin, 'heroic', [
      { id: 603, x: origin.x, z: origin.z - 80 },
    ])[0];
    expect(edge.x).toBeCloseTo(origin.x, 8);
    expect(edge.z).toBeCloseTo(origin.z - IGNIVAR_METEOR_MAX_RANGE_HEROIC, 8);
  });

  it('uses the same circular footprint for warning and impact resolution', () => {
    const meteor = { x: 4, z: 7 };
    expect(pointInIgnivarMeteor(meteor, { x: 4 + IGNIVAR_METEOR_RADIUS, z: 7 })).toBe(true);
    expect(pointInIgnivarMeteor(meteor, { x: 4 + IGNIVAR_METEOR_RADIUS + 0.01, z: 7 })).toBe(false);
  });

  it('projects an active cast into reconnect-safe warnings with stable ids and timing', () => {
    const points = [
      { x: 4, z: 7 },
      { x: -8, z: 12 },
    ];

    expect(
      activeIgnivarMeteorWarnings(77, {
        meteorCastKey: 912,
        meteorImpactRemaining: 1.4,
        meteorPoints: points,
      }),
    ).toEqual([
      {
        id: '77:912:0',
        x: 4,
        z: 7,
        radius: IGNIVAR_METEOR_RADIUS,
        duration: IGNIVAR_METEOR_TELEGRAPH_SECONDS,
        remaining: 1.4,
        warningLead: IGNIVAR_METEOR_REVEAL_DELAY_SECONDS,
      },
      {
        id: '77:912:1',
        x: -8,
        z: 12,
        radius: IGNIVAR_METEOR_RADIUS,
        duration: IGNIVAR_METEOR_TELEGRAPH_SECONDS,
        remaining: 1.4,
        warningLead: IGNIVAR_METEOR_REVEAL_DELAY_SECONDS,
      },
    ]);
    expect(
      activeIgnivarMeteorWarnings(77, {
        meteorCastKey: 912,
        meteorImpactRemaining: 0,
        meteorPoints: points,
      }),
    ).toEqual([]);
  });
});
