import { describe, expect, it, vi } from 'vitest';
import {
  applyIgnivarRaidFog,
  applyIgnivarRaidLighting,
  IGNIVAR_RAID_ENVIRONMENT,
  ignivarRaidFogStateForInterior,
} from '../src/render/ignivar_raid_environment';

describe('Ignivar raid room environment', () => {
  it('maps the three interior variants to distinct forge grades', () => {
    expect(ignivarRaidFogStateForInterior('ignivar_approach')).toBe('ignivarApproach');
    expect(ignivarRaidFogStateForInterior('ignivar')).toBe('ignivar');
    expect(ignivarRaidFogStateForInterior('ignivar_depths')).toBe('varkhul');
    expect(ignivarRaidFogStateForInterior('crypt')).toBeNull();
    expect(
      new Set(Object.values(IGNIVAR_RAID_ENVIRONMENT).map((profile) => profile.fogColor)).size,
    ).toBe(3);
  });

  it('applies the complete fog and light profile for each room', () => {
    for (const state of ['ignivarApproach', 'ignivar', 'varkhul'] as const) {
      const fog = { color: { setHex: vi.fn() }, near: 0, far: 0 };
      const target = {
        sun: { color: { setHex: vi.fn() }, intensity: 0 },
        hemi: {
          color: { setHex: vi.fn() },
          groundColor: { setHex: vi.fn() },
          intensity: 0,
        },
        scene: { environmentIntensity: 0 },
        rim: { value: 0 },
      };
      const expected = IGNIVAR_RAID_ENVIRONMENT[state];

      applyIgnivarRaidFog(state, fog);
      applyIgnivarRaidLighting(state, target);

      expect(fog.color.setHex).toHaveBeenCalledWith(expected.fogColor);
      expect(fog.near).toBe(expected.fogNear);
      expect(fog.far).toBe(expected.fogFar);
      expect(target.sun.color.setHex).toHaveBeenCalledWith(expected.sunColor);
      expect(target.sun.intensity).toBe(expected.sunIntensity);
      expect(target.hemi.color.setHex).toHaveBeenCalledWith(expected.hemiSkyColor);
      expect(target.hemi.groundColor.setHex).toHaveBeenCalledWith(expected.hemiGroundColor);
      expect(target.hemi.intensity).toBe(expected.hemiIntensity);
      expect(target.scene.environmentIntensity).toBe(expected.envIntensity);
      expect(target.rim.value).toBe(expected.rimIntensity);
    }
  });
});
