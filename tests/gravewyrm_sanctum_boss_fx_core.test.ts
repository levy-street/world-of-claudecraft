// The Gravewyrm Sanctum bosses' effect plan (render/gravewyrm_sanctum_bosses/
// boss_fx_core.ts): every boss bar lays its telegraph in the threat palette at
// the sim's own size, the plates read their state, the breath flashes only the
// plates it will burn, the chains pull taut as he strains.

import { describe, expect, it } from 'vitest';
import { TELEGRAPH_THREAT_COLORS } from '../src/render/floor_telegraph';
import {
  breathPlates,
  chainPoint,
  chainWhipReach,
  emergeCuesBetween,
  emergeShadow,
  infernoLevel,
  type PlateSpot,
  plateLook,
  plateShock,
  plateUnder,
  refreezeShown,
  SANCTUM_CAST_SPECS,
  shackleGlow,
  shadowGrowth,
  specColor,
  specYaw,
  unquenchedLeft,
} from '../src/render/gravewyrm_sanctum_bosses/boss_fx_core';
import {
  KORGATH_CHAIN_FLAIL,
  KORGATH_MAUL_ARC,
  KORGATH_STOMP,
  KORGATH_THRESHOLD_CHARGE,
  KORGATH_TUNING,
  KORZUL_GRAVE_BREATH,
  KORZUL_GRAVE_INFERNO,
  KORZUL_TAIL_SWEEP,
  KORZUL_TUNING,
  plateTemplate,
} from '../src/sim/encounters/gravewyrm_sanctum/boss_ids';

describe('Sanctum boss telegraphs', () => {
  it('lays each bar at the sim tuning size, in the threat palette', () => {
    expect(SANCTUM_CAST_SPECS[KORGATH_STOMP].range).toBe(KORGATH_TUNING.stompRadius);
    expect(SANCTUM_CAST_SPECS[KORGATH_STOMP].arcDeg).toBe(360);
    expect(SANCTUM_CAST_SPECS[KORGATH_MAUL_ARC].arcDeg).toBe(KORGATH_TUNING.maulArcDeg);
    expect(SANCTUM_CAST_SPECS[KORGATH_CHAIN_FLAIL].range).toBe(KORGATH_TUNING.flailLength);
    expect(SANCTUM_CAST_SPECS[KORGATH_CHAIN_FLAIL].half).toBe(KORGATH_TUNING.flailHalfWidth);
    expect(SANCTUM_CAST_SPECS[KORGATH_THRESHOLD_CHARGE].range).toBe(KORGATH_TUNING.chargeLength);
    expect(SANCTUM_CAST_SPECS[KORZUL_GRAVE_BREATH].arcDeg).toBe(KORZUL_TUNING.breathArcDeg);
    expect(SANCTUM_CAST_SPECS[KORZUL_GRAVE_BREATH].range).toBe(KORZUL_TUNING.breathRange);
    expect(SANCTUM_CAST_SPECS[KORZUL_GRAVE_INFERNO].range).toBe(KORZUL_TUNING.infernoRadius);
    const palette = new Set(Object.values(TELEGRAPH_THREAT_COLORS));
    for (const spec of Object.values(SANCTUM_CAST_SPECS))
      expect(palette.has(specColor(spec))).toBe(true);
  });

  it('lays the tail sweep behind him and every other shape ahead', () => {
    expect(specYaw(SANCTUM_CAST_SPECS[KORZUL_TAIL_SWEEP], 0)).toBeCloseTo(Math.PI, 6);
    expect(specYaw(SANCTUM_CAST_SPECS[KORZUL_GRAVE_BREATH], 1)).toBe(1);
  });

  it('floods the Inferno pulse by pulse', () => {
    expect(infernoLevel(0.1)).toBe(0);
    expect(infernoLevel(0.26)).toBe(0.25);
    expect(infernoLevel(0.5)).toBe(0.5);
    expect(infernoLevel(1)).toBe(1);
  });
});

describe('Korgath chains', () => {
  it('sags slack and pulls taut as he strains', () => {
    const slack = { x: 0, y: 0, z: 0 };
    const taut = { x: 0, y: 0, z: 0 };
    chainPoint(0, 5, 0, 20, 1, 0, 0.5, 0, 0, slack);
    chainPoint(0, 5, 0, 20, 1, 0, 0.5, 0.79, 0, taut);
    expect(slack.y).toBeLessThan(taut.y);
    const end = { x: 0, y: 0, z: 0 };
    chainPoint(0, 5, 0, 20, 1, 0, 1, 0.5, 0, end);
    expect(end.x).toBeCloseTo(20, 6);
    expect(end.y).toBeCloseTo(1, 6);
  });

  it('whips back toward the harness after a break', () => {
    expect(chainWhipReach(0)).toBe(1);
    expect(chainWhipReach(1)).toBeCloseTo(0.22, 6);
    expect(chainWhipReach(0.5)).toBeLessThan(chainWhipReach(0.1));
  });

  it('glows the Smith blue when whole and goad red when broken down', () => {
    const whole = shackleGlow(1);
    const low = shackleGlow(0.05);
    expect(whole.b).toBeGreaterThan(whole.r);
    expect(low.r).toBeGreaterThan(low.b);
    expect(low.flicker).toBeGreaterThan(whole.flicker);
  });
});

describe('Korzul plate floor', () => {
  it('reads each plate state from its template', () => {
    expect(plateLook(plateTemplate('sound'))).toEqual({ state: 0, refreeze: null });
    expect(plateLook(plateTemplate('cracked', 7))).toEqual({ state: 1, refreeze: 0.7 });
    expect(plateLook(plateTemplate('cracked', 'deep'))).toEqual({ state: 1, refreeze: null });
    expect(plateLook(plateTemplate('broken'))).toEqual({ state: 2, refreeze: null });
    expect(plateLook('sanctum_soulfire_patch')).toBeNull();
  });

  it('closes the refreeze ring smoothly between template steps, never past the next step', () => {
    expect(refreezeShown(0.7, 0)).toBeCloseTo(0.7, 6);
    expect(refreezeShown(0.7, 1.5)).toBeCloseTo(0.65, 6);
    expect(refreezeShown(0.7, 99)).toBeCloseTo(0.6, 6);
  });

  const plates: PlateSpot[] = [
    { id: 1, x: 0, z: 0, r: 8, state: 'sound' },
    { id: 2, x: 0, z: 16, r: 8, state: 'sound' },
    { id: 3, x: 0, z: 31, r: 8.5, state: 'cracked' },
    { id: 4, x: 16, z: 0, r: 8, state: 'sound' },
    { id: 5, x: 0, z: -16, r: 8, state: 'sound' },
    { id: 6, x: 0, z: 45, r: 8, state: 'broken' },
  ];

  it('flashes the plates the breath covers, the nearest first, at most three', () => {
    // From the centre plate, facing +z: the centre, the next and the far one.
    expect(breathPlates(0, 0, 0, plates)).toEqual([1, 2, 3]);
    // Facing -z only the centre and the plate behind.
    expect(breathPlates(0, 0, Math.PI, plates)).toEqual([1, 5]);
    // Open water is not burned again.
    expect(breathPlates(0, 30, 0, plates)).not.toContain(6);
  });

  it('finds the plate a player stands on, or none on the shelf', () => {
    expect(plateUnder(1, 15, plates)).toBe(2);
    expect(plateUnder(200, 200, plates)).toBe(-1);
  });

  it('grows the landing shadow and counts the Unquenched rise down', () => {
    expect(shadowGrowth(0)).toBeCloseTo(0.25, 6);
    expect(shadowGrowth(1)).toBe(1);
    expect(unquenchedLeft(0)).toBe(1);
    expect(unquenchedLeft(4)).toBe(0);
  });
});

describe('Korzul breaking free, drawn', () => {
  it('plays each beat once, in order, at the moments of the sim timeline', async () => {
    const plan = await import('../src/sim/encounters/gravewyrm_sanctum/korzul_emerge_plan');
    const burstAt = 1.45;
    const seen: [string, number][] = [];
    let last = 0;
    for (let t = 0.05; t <= plan.KORZUL_EMERGE_SECONDS + 1; t += 1 / 60) {
      for (const cue of emergeCuesBetween(last, t, burstAt)) seen.push([cue, t]);
      last = t;
    }
    expect(seen.map((c) => c[0])).toEqual(['burst', 'takeoff', 'land']);
    expect(seen[0][1]).toBeCloseTo(burstAt, 1);
    expect(seen[1][1]).toBeCloseTo(plan.KORZUL_EMERGE_RISE_AT, 1);
    expect(seen[2][1]).toBeCloseTo(plan.KORZUL_EMERGE_LAND_AT, 1);
    // A late frame that jumps past two beats plays both; a still frame none.
    expect(emergeCuesBetween(1, plan.KORZUL_EMERGE_RISE_AT + 0.1, burstAt)).toEqual([
      'burst',
      'takeoff',
    ]);
    expect(emergeCuesBetween(2, 2, burstAt)).toEqual([]);
  });

  it('his shadow tightens and darkens as he comes down; the plates crack white for a moment', async () => {
    const plan = await import('../src/sim/encounters/gravewyrm_sanctum/korzul_emerge_plan');
    const high = emergeShadow(plan.KORZUL_EMERGE_ALTITUDE + plan.KORZUL_EMERGE_LIFT);
    const low = emergeShadow(0);
    expect(low.alpha).toBeGreaterThan(high.alpha);
    expect(low.r).toBeLessThan(high.r);
    let prev = emergeShadow(20).alpha;
    for (let h = 19; h >= 0; h--) {
      const a = emergeShadow(h).alpha;
      expect(a).toBeGreaterThanOrEqual(prev);
      prev = a;
    }
    expect(plateShock(-1)).toBe(0);
    expect(plateShock(0)).toBe(1);
    expect(plateShock(0.9)).toBeGreaterThan(0);
    expect(plateShock(0.9)).toBeLessThan(1);
    expect(plateShock(2)).toBe(0);
  });
});
