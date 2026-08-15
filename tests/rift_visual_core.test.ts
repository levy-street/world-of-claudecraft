import { describe, expect, it } from 'vitest';
import {
  DEMON_TOWER_CORE_RENDER_HEIGHT,
  resolveRiftLightingGrade,
  riftHazardPalette,
  riftHazardStyleForProfile,
  riftPuzzlePropRenderHeight,
} from '../src/render/rift_visual_core';

describe('rift visual core', () => {
  it('maps each Demon Tower profile to its authored hazard language', () => {
    expect(riftHazardStyleForProfile('bloodforge')).toBe('tower_lava');
    expect(riftHazardStyleForProfile('ossuary')).toBe('soul');
    expect(riftHazardStyleForProfile('void_crown')).toBe('void');
    expect(riftHazardStyleForProfile(undefined)).toBe('lava');
  });

  it('pins the restrained Bloodforge hazard palette without weakening the warning rim', () => {
    expect(riftHazardPalette('tower_lava')).toEqual({
      pool: 0x1b1917,
      poolOpacity: 0.7,
      rim: 0x8f6a46,
      rimOpacity: 0.28,
      glow: 0x5f3425,
      poolY: 0.012,
      rimY: 0.014,
      glowY: 0.016,
    });
    expect(riftHazardPalette('lava')).toEqual({
      pool: 0xd83410,
      poolOpacity: 0.9,
      rim: 0xffca4a,
      rimOpacity: 0.5,
      glow: 0xff5a1e,
      poolY: 0.12,
      rimY: 0.14,
      glowY: 0.55,
    });
  });

  it('uses a floor grade before the authored and procedural defaults', () => {
    const floorGrade = { sun: 1, hemi: 2, env: 3, rim: 4 };
    expect(resolveRiftLightingGrade(true, floorGrade)).toBe(floorGrade);
    expect(resolveRiftLightingGrade(true, null)).toEqual({
      sun: 0.54,
      hemi: 0.32,
      env: 0.1,
      rim: 2.15,
    });
    expect(resolveRiftLightingGrade(false, null)).toEqual({
      sun: 0.34,
      hemi: 0.22,
      env: 0.05,
      rim: 2.4,
    });
  });

  it('pins every rift puzzle prop height, including the Demon Core', () => {
    expect(DEMON_TOWER_CORE_RENDER_HEIGHT).toBe(6);
    expect(riftPuzzlePropRenderHeight('rift_tower_core')).toBe(6);
    expect(riftPuzzlePropRenderHeight('rift_pylon')).toBe(4);
    expect(riftPuzzlePropRenderHeight('rift_pylon_lit')).toBe(4);
    expect(riftPuzzlePropRenderHeight('rift_gate')).toBe(5.6);
    expect(riftPuzzlePropRenderHeight('rift_gate_open')).toBe(5.6);
    expect(riftPuzzlePropRenderHeight('rift_roller')).toBe(3);
    expect(riftPuzzlePropRenderHeight('rift_infernal_orb')).toBe(2.2);
    expect(riftPuzzlePropRenderHeight('rift_infernal_orb_active')).toBe(2.2);
    expect(riftPuzzlePropRenderHeight('rift_switch')).toBe(2.4);
  });
});
