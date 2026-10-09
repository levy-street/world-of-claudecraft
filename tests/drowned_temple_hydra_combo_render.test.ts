// The Combined Breath's render plan (src/render/drowned_temple/
// temple_hydra_combo_core.ts): the elements each head brings, the charge, the
// frozen lane, the Ice Wall's rise and its lee side, the current arrows and
// the Toxic Rime countdown, read off the sim's own constants.

import { describe, expect, it } from 'vitest';
import {
  advancePhase,
  burstShake,
  comboChargeEnvelope,
  comboFill,
  comboHeadElements,
  comboPourElement,
  currentArrowInto,
  currentArrowLeft,
  elementOwner,
  frostlockLaneInto,
  ICE_WALL_LENGTH,
  iceWallLeeSign,
  iceWallMelt,
  iceWallRise,
  inMirroredWallLee,
  RIME_PULSE_CALM,
  RIME_PULSE_MAX,
  rimeLookInto,
  waterHead,
} from '../src/render/drowned_temple/temple_hydra_combo_core';
import {
  HYDRA_COMBO_TUNING,
  HYDRA_TUNING,
  hydraElementOwners,
  iceWallFrom,
  iceWallMiddle,
  inIceWallLee,
  tsunamiHeading,
  venomCurrentHeading,
} from '../src/sim/encounters/drowned_temple/ids';

const ALIVE = [false, false, false];

describe('the Combined Breath: which head brings what', () => {
  it('a pair brings one element each', () => {
    expect(comboHeadElements('frostlock', 0, ALIVE)).toEqual(['frost']);
    expect(comboHeadElements('frostlock', 2, ALIVE)).toEqual(['tide']);
    expect(comboHeadElements('frostlock', 1, ALIVE)).toEqual([]);
    expect(comboHeadElements('current', 1, ALIVE)).toEqual(['venom']);
    expect(comboHeadElements('rime', 2, ALIVE)).toEqual([]);
  });

  it('a lone survivor carries both and pours the water', () => {
    const dead = [true, true, false];
    expect(comboHeadElements('frostlock', 2, dead)).toEqual(['frost', 'tide']);
    expect(comboPourElement('temple_frostlocked_torrent', 2, dead)).toBe('tide');
    expect(comboPourElement('temple_toxic_rime', 2, dead)).toBe('frost');
    expect(comboPourElement('temple_tide_breath', 0, ALIVE)).toBeNull();
    expect(waterHead(ALIVE)).toBe(2);
    expect(waterHead([false, false, true])).toBe(0);
  });

  it('charges through the bar and flares at its end', () => {
    expect(comboChargeEnvelope(2, 2)).toBeCloseTo(0.15, 6);
    expect(comboChargeEnvelope(0, 2)).toBeCloseTo(1, 6);
    expect(comboChargeEnvelope(1, 2)).toBeGreaterThan(comboChargeEnvelope(1.5, 2));
    expect(comboFill(0.5, 2)).toBeCloseTo(0.75, 6);
  });
});

describe('the Frostlocked Torrent and its Ice Wall', () => {
  it('draws the sim lane: the torrent length and half width from the water head', () => {
    const lane = frostlockLaneInto(3, 4, 1, { x: 0, z: 0, yaw: 0, length: 0, halfWidth: 0 });
    expect(lane).toEqual({
      x: 3,
      z: 4,
      yaw: 1,
      length: HYDRA_TUNING.torrentLength,
      halfWidth: HYDRA_TUNING.torrentHalfWidth,
    });
    expect(ICE_WALL_LENGTH).toBe(iceWallFrom(0, 0, 0).length);
  });

  it('rises fast with a settle, and melts away', () => {
    expect(iceWallRise(0)).toBe(0);
    expect(iceWallRise(10)).toBeCloseTo(1, 6);
    let peak = 0;
    for (let t = 0; t < 0.4; t += 0.01) peak = Math.max(peak, iceWallRise(t));
    expect(peak).toBeGreaterThan(1);
    expect(iceWallMelt(0)).toBe(1);
    expect(iceWallMelt(1)).toBe(0);
  });

  it('paints its shelter on the side the sim calls its lee', () => {
    const w = iceWallFrom(0, 0, 0);
    const mid = iceWallMiddle(w);
    for (const side of ['east', 'west'] as const) {
      const sign = iceWallLeeSign(w.yaw, tsunamiHeading(side));
      // Two yards off the wall's middle on the painted side.
      const x = mid.x + Math.cos(w.yaw) * 2 * sign;
      const z = mid.z - Math.sin(w.yaw) * 2 * sign;
      expect(inIceWallLee(w, side, x, z)).toBe(true);
      expect(inMirroredWallLee(mid.x, mid.z, w.yaw, w.length, side, x, z)).toBe(true);
    }
  });
});

describe('the Venom Current and the Toxic Rime', () => {
  it('points each arrow straight out from the pool, as far as the slide', () => {
    const a = currentArrowInto(5, 80, { x: 0, z: 0, yaw: 0, length: 0 });
    expect(a.yaw).toBeCloseTo(venomCurrentHeading(5, 80), 9);
    expect(a.length).toBe(HYDRA_COMBO_TUNING.currentSlide);
    expect(currentArrowLeft(0)).toBe(1);
    expect(currentArrowLeft(HYDRA_COMBO_TUNING.currentSlide)).toBe(0);
  });

  it('counts the crystals down: the glow climbs and the pulse quickens', () => {
    const look = { grow: 0, glow: 0, pulse: 0 };
    const early = { ...rimeLookInto(0.25, look) };
    const late = { ...rimeLookInto(HYDRA_COMBO_TUNING.rimeSeconds - 0.1, look) };
    expect(early.grow).toBeLessThan(1);
    expect(late.grow).toBe(1);
    expect(late.glow).toBeGreaterThan(early.glow);
    expect(late.pulse).toBeGreaterThan(early.pulse);
  });

  it('kicks the camera harder up close', () => {
    expect(burstShake(5, 15, 0.18, 0, 0)).toBe(0.18);
    expect(burstShake(40, 20, 0.35, 45, 0.15)).toBe(0.15);
    expect(burstShake(60, 20, 0.35, 45, 0.15)).toBe(0);
  });
});

describe('the per-frame helpers stay exact and calm', () => {
  it('the allocation-free owner lookup is the sim rule', () => {
    for (let mask = 0; mask < 8; mask++) {
      const dead = [!!(mask & 1), !!(mask & 2), !!(mask & 4)];
      expect([0, 1, 2].map((el) => elementOwner(el, dead))).toEqual(hydraElementOwners(dead));
    }
  });

  it('caps the crystal pulse, lower when calm, and wraps a phase without a jump', () => {
    const look = { grow: 0, glow: 0, pulse: 0 };
    expect(rimeLookInto(99, look).pulse).toBeLessThanOrEqual(RIME_PULSE_MAX);
    expect(rimeLookInto(99, look, true).pulse).toBeLessThanOrEqual(RIME_PULSE_CALM);
    let p = 0;
    for (let i = 0; i < 1000; i++) {
      const next = advancePhase(p, 3, 0.05);
      const step = (next - p + Math.PI * 2) % (Math.PI * 2);
      expect(step).toBeCloseTo(3 * 0.05 * Math.PI * 2, 9);
      p = next;
    }
    expect(p).toBeLessThan(Math.PI * 2);
  });
});
