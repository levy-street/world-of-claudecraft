import { describe, expect, it } from 'vitest';

import {
  activeVarkhulForgePortalTelegraphs,
  VARKHUL_CRUCIBLE_QUAKE_DAMAGE_HEROIC,
  VARKHUL_CRUCIBLE_QUAKE_DAMAGE_NORMAL,
  VARKHUL_FORGE_ADD_WAVE_DELAY_HEROIC_SECONDS,
  VARKHUL_FORGE_ADD_WAVE_DELAY_NORMAL_SECONDS,
  VARKHUL_FORGE_FINAL_BEAM_SECONDS,
  VARKHUL_FORGE_FINAL_GAP_SECONDS,
  VARKHUL_FORGE_FINAL_HP_THRESHOLD,
  VARKHUL_FORGE_INTERMISSION_BEAM_SECONDS_HEROIC,
  VARKHUL_FORGE_INTERMISSION_BEAM_SECONDS_NORMAL,
  VARKHUL_FORGE_INTERMISSION_HP_THRESHOLD,
  VARKHUL_FORGE_INTERMISSION_SECONDS_HEROIC,
  VARKHUL_FORGE_INTERMISSION_SECONDS_NORMAL,
  VARKHUL_FORGE_INTERMISSION_WARNING_SECONDS,
  VARKHUL_FORGE_LOCAL_POS,
  VARKHUL_FORGE_PORTAL_ABILITY_ID,
  VARKHUL_FORGE_PORTAL_LOCAL_POSITIONS,
  VARKHUL_FORGE_PORTAL_TELEGRAPH_SECONDS,
  VARKHUL_FORGE_PRESSURE_BEAM_SECONDS,
  VARKHUL_FORGE_PRESSURE_HP_THRESHOLD,
  VARKHUL_FORGE_TEACHING_BEAM_SECONDS,
  VARKHUL_FORGE_TEACHING_GAP_SECONDS,
  VARKHUL_FORGE_TEACHING_HP_THRESHOLD,
  VARKHUL_WORK_FACING,
  VARKHUL_WORK_LOCAL_POS,
  varkhulCrucibleQuakeDamageRange,
  varkhulForgeBeamIsActive,
  varkhulForgeBeamWarningMask,
  varkhulForgeBeamWindowMask,
  varkhulForgeIntermissionBeamSeconds,
  varkhulForgeIntermissionNextWindow,
  varkhulForgeIntermissionSeconds,
  varkhulForgeIntermissionWave,
  varkhulForgeIntermissionWaveCount,
  varkhulForgeIntermissionWaveDelay,
  varkhulForgePressureWindow,
} from '../src/sim/varkhul_forge_intermission';

describe('Varkhul forge intermission contract', () => {
  it('pins the teaching, final and portal cadence', () => {
    expect(VARKHUL_FORGE_TEACHING_HP_THRESHOLD).toBe(0.8);
    expect(VARKHUL_FORGE_INTERMISSION_HP_THRESHOLD).toBe(0.5);
    expect(VARKHUL_FORGE_PRESSURE_HP_THRESHOLD).toBe(0.35);
    expect(VARKHUL_FORGE_FINAL_HP_THRESHOLD).toBe(0.2);
    expect(VARKHUL_FORGE_TEACHING_BEAM_SECONDS).toBe(8);
    expect(VARKHUL_FORGE_TEACHING_GAP_SECONDS).toBe(2);
    expect(VARKHUL_FORGE_PRESSURE_BEAM_SECONDS).toBe(6);
    expect(VARKHUL_FORGE_FINAL_BEAM_SECONDS).toBe(8);
    expect(VARKHUL_FORGE_FINAL_GAP_SECONDS).toBe(4);
    expect(VARKHUL_FORGE_PORTAL_TELEGRAPH_SECONDS).toBe(2);
    expect(VARKHUL_FORGE_PORTAL_ABILITY_ID).toBe('Forge Legion Portal');
    expect(VARKHUL_FORGE_ADD_WAVE_DELAY_NORMAL_SECONDS).toBe(3);
    expect(VARKHUL_FORGE_ADD_WAVE_DELAY_HEROIC_SECONDS).toBe(14);
    expect(VARKHUL_CRUCIBLE_QUAKE_DAMAGE_NORMAL).toEqual({ min: 180, max: 230 });
    expect(VARKHUL_CRUCIBLE_QUAKE_DAMAGE_HEROIC).toEqual({ min: 260, max: 330 });
    expect(varkhulCrucibleQuakeDamageRange('normal')).toEqual({ min: 180, max: 230 });
    expect(varkhulCrucibleQuakeDamageRange('heroic')).toEqual({ min: 260, max: 330 });
    expect(varkhulForgeIntermissionWaveDelay('normal')).toBe(3);
    expect(varkhulForgeIntermissionWaveDelay('heroic')).toBe(14);
  });

  it('activates the intended pillar in every window', () => {
    expect(varkhulForgeBeamWindowMask('idle')).toBe(0);
    expect(varkhulForgeBeamWindowMask('teaching_left')).toBe(1);
    expect(varkhulForgeBeamWindowMask('teaching_gap')).toBe(0);
    expect(varkhulForgeBeamWindowMask('teaching_right')).toBe(2);
    expect(varkhulForgeBeamWindowMask('pressure_left')).toBe(1);
    expect(varkhulForgeBeamWindowMask('pressure_right')).toBe(2);
    expect(varkhulForgeBeamWindowMask('intermission')).toBe(1);
    expect(varkhulForgeBeamWindowMask('intermission_left')).toBe(1);
    expect(varkhulForgeBeamWindowMask('intermission_right')).toBe(2);
    expect(varkhulForgeBeamWindowMask('final_left')).toBe(1);
    expect(varkhulForgeBeamWindowMask('final_gap_left')).toBe(0);
    expect(varkhulForgeBeamWindowMask('final_right')).toBe(2);
    expect(varkhulForgeBeamWindowMask('final_gap_right')).toBe(0);
    expect(varkhulForgeBeamWindowMask('meltdown')).toBe(0);
    expect(varkhulForgeBeamIsActive(1, 0)).toBe(true);
    expect(varkhulForgeBeamIsActive(1, 1)).toBe(false);
    expect(varkhulForgeBeamIsActive(2, 0)).toBe(false);
    expect(varkhulForgeBeamIsActive(2, 1)).toBe(true);
    expect(varkhulForgeBeamIsActive(3, 0)).toBe(true);
    expect(varkhulForgeBeamIsActive(3, 1)).toBe(true);
    expect(varkhulForgePressureWindow(2)).toBe('pressure_left');
    expect(varkhulForgePressureWindow(3)).toBe('pressure_right');
  });

  it('alternates the intermission pillars without ever activating both together', () => {
    expect(VARKHUL_FORGE_INTERMISSION_BEAM_SECONDS_NORMAL).toBe(8);
    expect(VARKHUL_FORGE_INTERMISSION_BEAM_SECONDS_HEROIC).toBe(6);
    expect(VARKHUL_FORGE_INTERMISSION_WARNING_SECONDS).toBe(2);
    expect(varkhulForgeIntermissionBeamSeconds('normal')).toBe(8);
    expect(varkhulForgeIntermissionBeamSeconds('heroic')).toBe(6);
    expect(varkhulForgeIntermissionNextWindow('intermission_left')).toBe('intermission_right');
    expect(varkhulForgeIntermissionNextWindow('intermission_right')).toBe('intermission_left');
    expect(varkhulForgeBeamWarningMask('intermission_left', 2.01)).toBe(0);
    expect(varkhulForgeBeamWarningMask('intermission_left', 2)).toBe(2);
    expect(varkhulForgeBeamWarningMask('intermission_right', 2)).toBe(1);
    for (const window of [
      'intermission',
      'intermission_left',
      'intermission_right',
      'meltdown',
    ] as const) {
      expect(varkhulForgeBeamWindowMask(window)).not.toBe(3);
    }
  });

  it('keeps the independent Artificer out of the ordinary three/four-wave plans', () => {
    expect(VARKHUL_FORGE_INTERMISSION_SECONDS_NORMAL).toBe(60);
    expect(VARKHUL_FORGE_INTERMISSION_SECONDS_HEROIC).toBe(70);
    expect(varkhulForgeIntermissionSeconds('normal')).toBe(60);
    expect(varkhulForgeIntermissionSeconds('heroic')).toBe(70);
    expect(varkhulForgeIntermissionWaveCount('normal')).toBe(3);
    expect(varkhulForgeIntermissionWaveCount('heroic')).toBe(4);

    const normal = Array.from({ length: 3 }, (_, wave) =>
      varkhulForgeIntermissionWave('normal', wave),
    ).flat();
    const heroic = Array.from({ length: 4 }, (_, wave) =>
      varkhulForgeIntermissionWave('heroic', wave),
    ).flat();
    expect(normal).toHaveLength(12);
    expect(heroic).toHaveLength(20);
    expect(normal.filter((spawn) => spawn.templateId === 'ignivar_crucible_warden')).toHaveLength(
      3,
    );
    expect(heroic.filter((spawn) => spawn.templateId === 'ignivar_crucible_warden')).toHaveLength(
      4,
    );
    expect([...normal, ...heroic].some((spawn) => spawn.templateId.includes('artificer'))).toBe(
      false,
    );
  });

  it('reconstructs an independent Artificer portal for reconnect without inventing a wave add', () => {
    expect(
      activeVarkhulForgePortalTelegraphs(
        41,
        {
          assemblyPhase: 'adds',
          assemblyRuneDifficulty: 'heroic',
          assemblyForgeMeltdownRemaining: 0,
          assemblyPortalSpawns: [],
          assemblyArtificerPortalSpawns: [{ portalIndex: 2, remaining: 1.35 }],
        },
        { x: 100, z: -50 },
      ),
    ).toEqual([
      {
        type: 'spellfxAt',
        x: 70,
        z: -38,
        school: 'fire',
        fx: 'burst',
        sourceId: 41,
        radius: 4,
        duration: 1.35,
        ability: 'Forge Legion Portal',
      },
    ]);
  });

  it('uses all four separated room portals and rotates the Warden source', () => {
    expect(VARKHUL_FORGE_PORTAL_LOCAL_POSITIONS).toEqual([
      { x: -27, z: -22 },
      { x: 27, z: -22 },
      { x: -30, z: 12 },
      { x: 30, z: 12 },
    ]);
    expect(
      new Set(VARKHUL_FORGE_PORTAL_LOCAL_POSITIONS.map((portal) => `${portal.x}:${portal.z}`)).size,
    ).toBe(4);
    expect(
      Array.from(
        { length: 4 },
        (_, wave) =>
          varkhulForgeIntermissionWave('heroic', wave).find(
            (spawn) => spawn.templateId === 'ignivar_crucible_warden',
          )?.portalIndex,
      ),
    ).toEqual([0, 1, 2, 3]);
  });

  it('places Varkhul south of the anvil facing north with his back to the raid', () => {
    expect(VARKHUL_FORGE_LOCAL_POS).toEqual({ x: 0, z: 22 });
    expect(VARKHUL_WORK_LOCAL_POS).toEqual({ x: 0, z: 16 });
    expect(VARKHUL_WORK_LOCAL_POS.z).toBeLessThan(VARKHUL_FORGE_LOCAL_POS.z);
    expect(VARKHUL_WORK_FACING).toBe(0);
  });
});
