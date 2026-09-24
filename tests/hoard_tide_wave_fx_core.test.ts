import { describe, expect, it } from 'vitest';
import {
  type HoardTideVisualPlan,
  hoardTideSprayLateral,
  hoardTideThemeTint,
  hoardTideVisualPlanInto,
} from '../src/render/hoard_tide_wave_fx_core';
import {
  HOARD_TIDE_WAVE_HALF_DEPTH,
  HOARD_TIDE_WAVE_HALF_GAP,
  hoardTideWaveCenter,
} from '../src/sim/rift/hoard_boss_kits';

function plan(): HoardTideVisualPlan {
  return {
    center: 0,
    leftStart: 0,
    leftWidth: 0,
    rightStart: 0,
    rightWidth: 0,
    gap: 0,
    solid: false,
    depth: 0,
    height: 0,
    leadProgress: 0,
    travelProgress: 0,
    tail: 0,
    moving: false,
  };
}

describe('tide crest rendering contract', () => {
  it('tints water for the dig biome while preserving the same geometry plan', () => {
    expect(hoardTideThemeTint('willowfen')).not.toBe(hoardTideThemeTint('frostveil'));
    expect(hoardTideThemeTint(null)).toBe(0xffffff);
  });
  it('uses the authoritative moving center, depth and shifted gap for every point in time', () => {
    const out = plan();
    for (let remaining = 7; remaining >= 0; remaining -= 0.05) {
      hoardTideVisualPlanInto(out, {
        radius: 28,
        total: 7,
        remaining,
        waveLead: 2.2,
        waveSpan: 12,
        waveGap: -3,
      });
      expect(out.center).toBe(hoardTideWaveCenter(28, remaining, 7, 2.2));
      expect(out.depth).toBe(HOARD_TIDE_WAVE_HALF_DEPTH * 2);
      expect(out.leftStart).toBe(-12);
      expect(out.leftStart + out.leftWidth).toBe(-3 - HOARD_TIDE_WAVE_HALF_GAP);
      expect(out.rightStart).toBe(-3 + HOARD_TIDE_WAVE_HALF_GAP);
      expect(out.rightStart + out.rightWidth).toBe(12);
    }
  });

  it('raises the crest during the full lead and gives only a bounded cosmetic ending', () => {
    const out = plan();
    hoardTideVisualPlanInto(out, { radius: 28, total: 7, remaining: 7, waveLead: 2 });
    expect(out.height).toBeCloseTo(0.18);
    expect(out.moving).toBe(false);
    hoardTideVisualPlanInto(out, { radius: 28, total: 7, remaining: 5, waveLead: 2 });
    expect(out.height).toBe(1);
    expect(out.moving).toBe(true);
    hoardTideVisualPlanInto(out, { radius: 28, total: 7, remaining: -0.5, waveLead: 2 });
    expect(out.moving).toBe(false);
    expect(out.height).toBe(0.25);
    expect(out.tail).toBe(0.5);
    hoardTideVisualPlanInto(out, { radius: 28, total: 7, remaining: -1.01, waveLead: 2 });
    expect(out.tail).toBe(0);
  });

  it('keeps every pooled spray column outside the safe corridor, including off-center gaps', () => {
    const out = plan();
    for (const gap of [-7, 0, 7]) {
      hoardTideVisualPlanInto(out, {
        radius: 28,
        total: 7,
        remaining: 3,
        waveGap: gap,
        waveSpan: 12,
      });
      for (let i = 0; i < 96; i++) {
        const x = hoardTideSprayLateral(i, out);
        expect(Math.abs(x - gap)).toBeGreaterThan(HOARD_TIDE_WAVE_HALF_GAP);
        expect(Math.abs(x)).toBeLessThan(12);
      }
    }
  });
});
