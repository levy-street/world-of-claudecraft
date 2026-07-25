import { describe, expect, it } from 'vitest';
import { waterElementalSamples } from '../src/game/water_elemental_audio';

describe('Water Elemental procedural audio', () => {
  it.each([
    ['aggro', 0.72],
    ['attack', 0.42],
    ['death', 1.05],
  ] as const)('builds a bounded non-silent %s cue', (kind, minimumSeconds) => {
    const sampleRate = 8_000;
    const samples = waterElementalSamples(kind, sampleRate);
    const peak = samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);

    expect(samples.length).toBeGreaterThanOrEqual(sampleRate * minimumSeconds);
    expect(samples.every(Number.isFinite)).toBe(true);
    expect(peak).toBeGreaterThan(0.08);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it('is deterministic and gives each cue a distinct waveform', () => {
    const first = waterElementalSamples('attack', 8_000);
    const second = waterElementalSamples('attack', 8_000);
    const death = waterElementalSamples('death', 8_000);

    expect(second).toEqual(first);
    expect(Array.from(death.slice(0, 128))).not.toEqual(Array.from(first.slice(0, 128)));
  });
});
