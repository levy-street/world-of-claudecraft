import { describe, expect, it } from 'vitest';
import { VOICE_FULL_DIST, VOICE_SILENT_DIST, voiceDistanceGain } from '../src/game/voice';

describe('voiceDistanceGain', () => {
  it('plays at full volume at or within the full distance', () => {
    expect(voiceDistanceGain(0)).toBe(1);
    expect(voiceDistanceGain(VOICE_FULL_DIST - 1)).toBe(1);
    expect(voiceDistanceGain(VOICE_FULL_DIST)).toBe(1);
  });

  it('is silent at or beyond the silent distance', () => {
    expect(voiceDistanceGain(VOICE_SILENT_DIST)).toBe(0);
    expect(voiceDistanceGain(VOICE_SILENT_DIST + 5)).toBe(0);
  });

  it('ramps down monotonically between full and silent, reaching ~0.5 at the midpoint', () => {
    const mid = (VOICE_FULL_DIST + VOICE_SILENT_DIST) / 2;
    expect(voiceDistanceGain(mid)).toBeCloseTo(0.5, 5);
    let prev = 1;
    for (let d = VOICE_FULL_DIST; d <= VOICE_SILENT_DIST; d++) {
      const g = voiceDistanceGain(d);
      expect(g).toBeLessThanOrEqual(prev);
      expect(g).toBeGreaterThanOrEqual(0);
      prev = g;
    }
  });

  it('never dips a line the moment a dialog opens (opened within INTERACT_RANGE 5)', () => {
    expect(voiceDistanceGain(5)).toBe(1);
  });

  it('treats NaN or negative distance as full, never a negative volume', () => {
    expect(voiceDistanceGain(Number.NaN)).toBe(1);
    expect(voiceDistanceGain(-3)).toBe(1);
  });

  it('honors custom full/silent bounds', () => {
    expect(voiceDistanceGain(10, 10, 20)).toBe(1);
    expect(voiceDistanceGain(20, 10, 20)).toBe(0);
    expect(voiceDistanceGain(15, 10, 20)).toBeCloseTo(0.5, 5);
  });
});
