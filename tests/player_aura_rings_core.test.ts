import { describe, expect, it } from 'vitest';
import {
  planPlayerAuraRings,
  playerAuraOrnamentSpec,
  playerAuraRingQualityProfile,
} from '../src/render/player_aura_rings_core';
import { CHOICE_ROWS } from '../src/sim/content/choice_rows';

describe('planPlayerAuraRings', () => {
  it('scales the complete ring block while preserving proportional spacing', () => {
    const plan = planPlayerAuraRings([
      { id: 'revenge', visible: true, scale: 1.6 },
      { id: 'guard', visible: false, scale: 1.6 },
      { id: 'resolve', visible: true, scale: 1.6 },
    ]);

    expect(plan.map((ring) => ring.id)).toEqual(['revenge', 'guard', 'resolve']);
    expect(plan[0].outerRadius - plan[0].innerRadius).toBeCloseTo(0.12 * 1.6);
    expect(plan[1].outerRadius - plan[1].innerRadius).toBeCloseTo(0.12 * 1.6);
    expect(plan[2].outerRadius - plan[2].innerRadius).toBeCloseTo(0.12 * 1.6);
    expect((plan[1].innerRadius + plan[1].outerRadius) / 2).toBeCloseTo(1.31 * 1.6);
    expect((plan[2].innerRadius + plan[2].outerRadius) / 2).toBeCloseTo(1.61 * 1.6);
    expect(plan[0].outerRadius).toBeLessThan(plan[1].innerRadius);
    expect(plan[1].outerRadius).toBeLessThan(plan[2].innerRadius);
    expect(plan[2].visible).toBe(true);
  });

  it('keeps later radii fixed when an earlier proc changes visibility', () => {
    const inputs = [
      { id: 'first', visible: true, scale: 1 },
      { id: 'second', visible: true, scale: 1 },
    ];
    const active = planPlayerAuraRings(inputs);
    const expired = planPlayerAuraRings([{ ...inputs[0], visible: false }, inputs[1]]);

    expect(expired[1]).toMatchObject({
      innerRadius: active[1].innerRadius,
      outerRadius: active[1].outerRadius,
    });
  });

  it('clamps malformed and out-of-range scales', () => {
    const plan = planPlayerAuraRings([
      { id: 'small', visible: true, scale: -10 },
      { id: 'fallback', visible: true, scale: Number.NaN },
      { id: 'large', visible: true, scale: 99 },
    ]);

    expect((plan[0].innerRadius + plan[0].outerRadius) / 2).toBeCloseTo(1.01 * 0.65);
    expect((plan[1].innerRadius + plan[1].outerRadius) / 2).toBeCloseTo(1.31);
    expect((plan[2].innerRadius + plan[2].outerRadius) / 2).toBeCloseTo(1.61 * 1.6);
    expect(plan[0].outerRadius - plan[0].innerRadius).toBeCloseTo(0.12 * 0.65);
    expect(plan[1].outerRadius - plan[1].innerRadius).toBeCloseTo(0.12);
    expect(plan[2].outerRadius - plan[2].innerRadius).toBeCloseTo(0.12 * 1.6);
  });
});

describe('playerAuraOrnamentSpec', () => {
  it('gives every Warrior proc its own procedural ornament arrangement', () => {
    const ids = [
      'revenge_free',
      'battle_trance',
      'raised_guard',
      'iron_resolve',
      'overpower_charge',
      'sudden_death',
      'victory_rush',
      'enrage',
    ];
    const specs = ids.map(playerAuraOrnamentSpec);

    expect(specs.find((spec) => spec.kind === 'shield')).toBeDefined();
    expect(specs.find((spec) => spec.kind === 'diamond')).toBeDefined();
    expect(specs.find((spec) => spec.kind === 'chevron')).toBeDefined();
    expect(new Set(specs.map((spec) => JSON.stringify(spec))).size).toBe(ids.length);
  });

  it('gives Mage proc families distinct elemental ornament arrangements', () => {
    const fire = playerAuraOrnamentSpec('hot_streak');
    const frost = playerAuraOrnamentSpec('fingers_of_frost');
    const arcane = playerAuraOrnamentSpec('arcane_charge');

    expect(fire).not.toEqual(frost);
    expect(frost).not.toEqual(arcane);
    expect(arcane).not.toEqual(fire);
  });

  it('derives stable, distinct ornaments for proc ids outside the hand-tuned sets', () => {
    const ids = [
      'hun_deathless_will',
      'sha_storm_recall',
      'dru_survival_of_the_fittest',
      'rog_master_assassin',
      'pri_inner_fire',
      'wlk_curse_mastery',
      'pal_divine_wisdom',
    ];
    const first = ids.map(playerAuraOrnamentSpec);
    const second = ids.map(playerAuraOrnamentSpec);

    expect(second).toEqual(first);
    expect(first).toEqual([
      { kind: 'diamond', count: 9, size: 0.16, angularSpeed: -0.26 },
      { kind: 'diamond', count: 11, size: 0.13, angularSpeed: -0.17 },
      { kind: 'triangle', count: 9, size: 0.13, angularSpeed: -0.24 },
      { kind: 'triangle', count: 9, size: 0.1, angularSpeed: 0.33 },
      { kind: 'chevron', count: 6, size: 0.11, angularSpeed: 0.2 },
      { kind: 'diamond', count: 9, size: 0.12, angularSpeed: 0.16 },
      { kind: 'chevron', count: 9, size: 0.13, angularSpeed: 0.4 },
    ]);
    expect(new Set(first.map((spec) => JSON.stringify(spec))).size).toBe(ids.length);
    for (const spec of first) {
      expect(['shield', 'triangle', 'diamond', 'chevron']).toContain(spec.kind);
      expect(spec.count).toBeGreaterThanOrEqual(4);
      expect(spec.count).toBeLessThanOrEqual(12);
      expect(spec.size).toBeGreaterThanOrEqual(0.1);
      expect(spec.size).toBeLessThanOrEqual(0.16);
      expect(Math.abs(spec.angularSpeed)).toBeGreaterThanOrEqual(0.16);
      expect(Math.abs(spec.angularSpeed)).toBeLessThanOrEqual(0.5);
    }
  });

  it('keeps every current aura-producing talent on its own ornament arrangement', () => {
    const ids = Object.values(CHOICE_ROWS).flatMap((tree) =>
      tree.rows.flatMap((row) =>
        row.options.flatMap((option) => {
          const proc = option.effect.proc;
          return proc?.responses.some((response) =>
            ['empowerNext', 'aura', 'absorb', 'echo'].includes(response.kind),
          )
            ? [proc.id]
            : [];
        }),
      ),
    );
    const signatures = ids.map((id) => JSON.stringify(playerAuraOrnamentSpec(id)));

    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(signatures).size).toBe(signatures.length);
  });
});

describe('playerAuraRingQualityProfile', () => {
  it('keeps the core signal while reducing only cosmetic richness on low', () => {
    expect(playerAuraRingQualityProfile('high', 9, true)).toEqual({
      radialSegments: 64,
      ornamentCount: 9,
      glowBaseOpacity: 0.16,
      glowPulseOpacity: 0.08,
      ornamentBaseOpacity: 0.68,
      ornamentPulseOpacity: 0.22,
      coreColorGain: 1.8,
      glowColorGain: 1.35,
      ornamentColorGain: 2,
    });
    expect(playerAuraRingQualityProfile('low', 9, false)).toEqual({
      radialSegments: 32,
      ornamentCount: 5,
      glowBaseOpacity: 0.06,
      glowPulseOpacity: 0.03,
      ornamentBaseOpacity: 0.58,
      ornamentPulseOpacity: 0.16,
      coreColorGain: 1,
      glowColorGain: 1,
      ornamentColorGain: 1,
    });
  });

  it('keeps at least three animated spell ornaments on low', () => {
    expect(playerAuraRingQualityProfile('low', 4, false).ornamentCount).toBe(3);
  });

  it('uses an intermediate medium profile and enables HDR only with bloom', () => {
    expect(playerAuraRingQualityProfile('medium', 9, false)).toEqual({
      radialSegments: 48,
      ornamentCount: 7,
      glowBaseOpacity: 0.1,
      glowPulseOpacity: 0.05,
      ornamentBaseOpacity: 0.62,
      ornamentPulseOpacity: 0.18,
      coreColorGain: 1,
      glowColorGain: 1,
      ornamentColorGain: 1,
    });
    expect(playerAuraRingQualityProfile('high', 9, false)).toMatchObject({
      radialSegments: 64,
      ornamentCount: 9,
      coreColorGain: 1,
      glowColorGain: 1,
      ornamentColorGain: 1,
    });
    expect(playerAuraRingQualityProfile('ultra', 9, true)).toMatchObject({
      radialSegments: 64,
      ornamentCount: 9,
      coreColorGain: 1.8,
      glowColorGain: 1.35,
      ornamentColorGain: 2,
    });
  });
});
