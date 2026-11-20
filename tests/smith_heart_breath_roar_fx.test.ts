// The Summit Roar's look (src/render/smith_heart_fx/breath_roar_fx_core.ts):
// the wave's front rides out at the sim's own pace (breath_roar.ts), so the
// ring on the floor reaches each body as the sim strikes it; it runs to the
// guardian's reach and fades; its wall is tall leaving and low at the rim;
// the trailing rings ride behind the front; a struck body's trail outlasts
// its slide; the screen's wind only blows while it draws breath.

import { describe, expect, it } from 'vitest';
import {
  breathGuardianKit,
  GUST_WAVE_SECONDS,
  gustBlastLook,
} from '../src/render/smith_heart_fx/breath_fx_core';
import {
  inhaleScreenWind,
  ROAR_SPEED,
  ROAR_THROW,
  ROAR_TRAIL_SECONDS,
  roarCarry,
  roarLanding,
  roarReach,
  roarWaveLook,
} from '../src/render/smith_heart_fx/breath_roar_fx_core';
import { inBreathArena } from '../src/sim/encounters/smith_heart/breath_geometry';
import {
  BREATH_DIFFICULTY,
  BREATH_TUNING as T,
} from '../src/sim/encounters/smith_heart/breath_ids';
import { roarArrival } from '../src/sim/encounters/smith_heart/breath_roar';

describe('the Summit Roar: its look', () => {
  it("rides out at the sim's own pace: the ring reaches a body as it is struck", () => {
    expect(ROAR_SPEED).toBe(T.roarSpeed);
    for (const d of [5, 18, 40]) expect(roarWaveLook(roarArrival(d)).front).toBeCloseTo(d, 6);
    // The guardian's own blast wall rides with it too.
    const k = breathGuardianKit();
    expect(gustBlastLook(roarArrival(20), k.gustRadius, k.gustShove).front).toBeCloseTo(20, 6);
    expect(GUST_WAVE_SECONDS).toBeCloseTo(roarReach() / T.roarSpeed, 6);
  });

  it('runs to the reach and fades; tall leaving, low at the rim; ripples trailing it', () => {
    const reach = roarReach();
    const end = roarWaveLook(reach / ROAR_SPEED);
    expect(end.front).toBeCloseTo(reach, 6);
    expect(roarWaveLook(reach / ROAR_SPEED + 1).alpha).toBe(0);
    expect(roarWaveLook(0.1).height).toBeGreaterThan(end.height + 5);
    const mid = roarWaveLook(1);
    expect(mid.trail1).toBeLessThan(mid.front);
    expect(mid.trail2).toBeLessThan(mid.trail1);
    expect(mid.alpha).toBeGreaterThan(0.6);
  });

  it("trails a struck body past its slide; the screen's wind only while it draws breath", () => {
    expect(ROAR_TRAIL_SECONDS).toBeGreaterThan(T.roarSlide);
    expect(inhaleScreenWind(1, false)).toBe(0);
    expect(inhaleScreenWind(0, true)).toBeGreaterThan(0);
    expect(inhaleScreenWind(1, true)).toBeGreaterThan(inhaleScreenWind(0.3, true));
    // Never so strong that the floor and the landing marker wash out.
    expect(inhaleScreenWind(1, true)).toBeLessThanOrEqual(0.4);
  });
});

describe('the Summit Roar: where it flings you', () => {
  it('marks where the blast carries a body that stands, straight away from the guardian', () => {
    // The owner's call of 2026-11-17: no throw on any tier; the blast carries.
    expect(ROAR_THROW).toBe(0);
    const at = roarLanding(0, 192, 0, 198);
    expect(at.x).toBeCloseTo(0, 6);
    expect(at.z).toBeCloseTo(192 - roarCarry(6), 6);
    // The hardest tier's carry: a stander by the maw goes some forty yards
    // or more, and less the farther out it already stands (the blast eases).
    expect(roarCarry(6)).toBeGreaterThan(40);
    expect(roarCarry(20)).toBeLessThan(roarCarry(6));
  });

  it('lands a stander by the rim, or over the void when the rim lies behind it', () => {
    // By the maw, east (the Cornice's longest reach): carried to its rim.
    const near = roarLanding(6, 198, 0, 198);
    expect(near.x).toBeGreaterThan(40);
    const far = roarLanding(30, 198, 0, 198);
    expect(inBreathArena(far.x, far.z)).toBe(false);
    expect(far.overVoid).toBe(true);
  });
});
