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

  it('holds every room grade under the interior ambient ceilings across the 30% lift', () => {
    // A tuned PAIR with the matte raid rigs (the roster pin in
    // tests/varkhul_visual_manifest.test.ts): the env ceiling is the
    // anti-sheen bound, and it is scene-wide (players and pets in the room
    // are NOT matte), so it stays strictly under the 0.2-to-0.34 band the
    // module header documents as frosting rigs blue-white; the sun and
    // hemisphere ceilings keep the rooms a readable forge interior, never
    // daylight.
    for (const profile of Object.values(IGNIVAR_RAID_ENVIRONMENT)) {
      expect(profile.sunIntensity).toBeLessThanOrEqual(1.4);
      expect(profile.hemiIntensity).toBeLessThanOrEqual(0.9);
      expect(profile.envIntensity).toBeLessThanOrEqual(0.18);
    }
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
        rimColor: { value: { setHex: vi.fn() } },
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
      expect(target.rimColor.value.setHex).toHaveBeenCalledWith(expected.rimColor);
    }
  });
});
