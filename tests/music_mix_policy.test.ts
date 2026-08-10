import { describe, expect, it } from 'vitest';
import {
  isMusicMixAudible,
  type MusicMixState,
  musicMixMasterTarget,
} from '../src/game/music_mix_policy';

const baseState: MusicMixState = {
  enabled: true,
  menuPaused: false,
  bossActive: false,
  sowfieldActive: false,
  vol: 0.5,
};

describe('musicMixMasterTarget', () => {
  it('returns 0 when disabled', () => {
    expect(musicMixMasterTarget({ ...baseState, enabled: false }, 0.5)).toBe(0);
  });

  it('returns 0 while the menu is paused', () => {
    expect(musicMixMasterTarget({ ...baseState, menuPaused: true }, 0.5)).toBe(0);
  });

  it('returns 0 while a boss track owns the mix', () => {
    expect(musicMixMasterTarget({ ...baseState, bossActive: true }, 0.5)).toBe(0);
  });

  it('returns 0 while a Sowfield track owns the mix', () => {
    expect(musicMixMasterTarget({ ...baseState, sowfieldActive: true }, 0.5)).toBe(0);
  });

  it('returns streamLevel * vol otherwise', () => {
    expect(musicMixMasterTarget(baseState, 0.5)).toBeCloseTo(0.25);
  });
});

describe('isMusicMixAudible', () => {
  it('mirrors the four duck conditions', () => {
    expect(isMusicMixAudible({ ...baseState, enabled: false })).toBe(false);
    expect(isMusicMixAudible({ ...baseState, menuPaused: true })).toBe(false);
    expect(isMusicMixAudible({ ...baseState, bossActive: true })).toBe(false);
    expect(isMusicMixAudible({ ...baseState, sowfieldActive: true })).toBe(false);
  });

  it('is false at vol 0', () => {
    expect(isMusicMixAudible({ ...baseState, vol: 0 })).toBe(false);
  });

  it('is true only when no duck flag is set and vol > 0', () => {
    expect(isMusicMixAudible(baseState)).toBe(true);
  });
});
