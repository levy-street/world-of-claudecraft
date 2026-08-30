// Pure sequencing and layout for Varkhul's forge pillars and add intermission.
// Encounter mutation, spawning, threat and damage stay in encounters/varkhul.ts.

import { IGNIVAR_CRUCIBLE_WARDEN_ID, IGNIVAR_EMBER_SENTINEL_ID } from './ignivar_raid_ids';
import type { SimEvent } from './types';
import {
  VARKHUL_ASSEMBLY_FORGE_LOCAL_POS,
  type VarkhulAssemblyDifficulty,
  type VarkhulAssemblyPhase,
} from './varkhul_assembly';
import type { VarkhulForgeBeamIndex } from './varkhul_forge_beams';

export type VarkhulForgeBeamWindow =
  | 'idle'
  | 'teaching_left'
  | 'teaching_gap'
  | 'teaching_right'
  | 'pressure_left'
  | 'pressure_right'
  | 'intermission'
  | 'intermission_left'
  | 'intermission_right'
  | 'final_left'
  | 'final_gap_left'
  | 'final_right'
  | 'final_gap_right'
  | 'meltdown';

export interface VarkhulForgeAddSpawn {
  templateId: typeof IGNIVAR_CRUCIBLE_WARDEN_ID | typeof IGNIVAR_EMBER_SENTINEL_ID;
  portalIndex: number;
}

export const VARKHUL_FORGE_TEACHING_HP_THRESHOLD = 0.8;
export const VARKHUL_FORGE_INTERMISSION_HP_THRESHOLD = 0.5;
export const VARKHUL_FORGE_PRESSURE_HP_THRESHOLD = 0.35;
export const VARKHUL_FORGE_FINAL_HP_THRESHOLD = 0.2;
export const VARKHUL_FORGE_TEACHING_BEAM_SECONDS = 8;
export const VARKHUL_FORGE_TEACHING_GAP_SECONDS = 2;
export const VARKHUL_FORGE_PRESSURE_BEAM_SECONDS = 6;
export const VARKHUL_FORGE_INTERMISSION_BEAM_SECONDS_NORMAL = 8;
export const VARKHUL_FORGE_INTERMISSION_BEAM_SECONDS_HEROIC = 6;
export const VARKHUL_FORGE_INTERMISSION_WARNING_SECONDS = 2;
export const VARKHUL_FORGE_FINAL_BEAM_SECONDS = 8;
export const VARKHUL_FORGE_FINAL_GAP_SECONDS = 4;
export const VARKHUL_FORGE_PORTAL_TELEGRAPH_SECONDS = 2;
export const VARKHUL_FORGE_PORTAL_ABILITY_ID = 'Forge Legion Portal';
export const VARKHUL_FORGE_ADD_WAVE_DELAY_NORMAL_SECONDS = 3;
export const VARKHUL_FORGE_ADD_WAVE_DELAY_HEROIC_SECONDS = 14;
export const VARKHUL_FORGE_INTERMISSION_SECONDS_NORMAL = 60;
export const VARKHUL_FORGE_INTERMISSION_SECONDS_HEROIC = 70;
export const VARKHUL_CRUCIBLE_QUAKE_DAMAGE_NORMAL = { min: 180, max: 230 } as const;
export const VARKHUL_CRUCIBLE_QUAKE_DAMAGE_HEROIC = { min: 260, max: 330 } as const;

export const VARKHUL_FORGE_LOCAL_POS = VARKHUL_ASSEMBLY_FORGE_LOCAL_POS;
export const VARKHUL_WORK_LOCAL_POS = { x: 0, z: 16 } as const;
export const VARKHUL_WORK_FACING = 0;

export const VARKHUL_FORGE_PORTAL_LOCAL_POSITIONS = [
  { x: -27, z: -22 },
  { x: 27, z: -22 },
  { x: -30, z: 12 },
  { x: 30, z: 12 },
] as const;

export function varkhulForgePressureWindow(bossId: number): 'pressure_left' | 'pressure_right' {
  return bossId % 2 === 0 ? 'pressure_left' : 'pressure_right';
}

export type VarkhulForgePortalTelegraph = Extract<SimEvent, { type: 'spellfxAt' }>;

export interface VarkhulForgePortalProjectionState {
  assemblyPhase: VarkhulAssemblyPhase;
  assemblyRuneDifficulty: VarkhulAssemblyDifficulty;
  assemblyForgeMeltdownRemaining: number;
  assemblyPortalSpawns: readonly { wave: number; spawnIndex: number; remaining: number }[];
  assemblyArtificerPortalSpawns: readonly { portalIndex: number; remaining: number }[];
}

/** Rebuilds the still-actionable portal warning for reconnect recovery. */
export function activeVarkhulForgePortalTelegraphs(
  bossId: number,
  state: VarkhulForgePortalProjectionState,
  origin: { x: number; z: number },
): VarkhulForgePortalTelegraph[] {
  if (state.assemblyPhase !== 'adds' || state.assemblyForgeMeltdownRemaining > 0) return [];
  const durationByPortal = VARKHUL_FORGE_PORTAL_LOCAL_POSITIONS.map(() => 0);
  for (const scheduled of state.assemblyPortalSpawns) {
    const planned = varkhulForgeIntermissionWave(state.assemblyRuneDifficulty, scheduled.wave)[
      scheduled.spawnIndex
    ];
    if (!planned) continue;
    durationByPortal[planned.portalIndex] = Math.max(
      durationByPortal[planned.portalIndex] ?? 0,
      scheduled.remaining,
    );
  }
  for (const scheduled of state.assemblyArtificerPortalSpawns) {
    if (!VARKHUL_FORGE_PORTAL_LOCAL_POSITIONS[scheduled.portalIndex]) continue;
    durationByPortal[scheduled.portalIndex] = Math.max(
      durationByPortal[scheduled.portalIndex] ?? 0,
      scheduled.remaining,
    );
  }
  const telegraphs: VarkhulForgePortalTelegraph[] = [];
  for (let portalIndex = 0; portalIndex < durationByPortal.length; portalIndex++) {
    const duration = durationByPortal[portalIndex] ?? 0;
    const portal = VARKHUL_FORGE_PORTAL_LOCAL_POSITIONS[portalIndex];
    if (!portal || duration <= 0) continue;
    telegraphs.push({
      type: 'spellfxAt',
      x: origin.x + portal.x,
      z: origin.z + portal.z,
      school: 'fire',
      fx: 'burst',
      sourceId: bossId,
      radius: 4,
      duration,
      ability: VARKHUL_FORGE_PORTAL_ABILITY_ID,
    });
  }
  return telegraphs;
}

export function varkhulForgeBeamWindowMask(window: VarkhulForgeBeamWindow): number {
  switch (window) {
    case 'teaching_left':
    case 'pressure_left':
    case 'intermission':
    case 'intermission_left':
    case 'final_left':
      return 1;
    case 'teaching_right':
    case 'pressure_right':
    case 'intermission_right':
    case 'final_right':
      return 2;
    default:
      return 0;
  }
}

export function varkhulForgeIntermissionBeamSeconds(difficulty: VarkhulAssemblyDifficulty): number {
  return difficulty === 'heroic'
    ? VARKHUL_FORGE_INTERMISSION_BEAM_SECONDS_HEROIC
    : VARKHUL_FORGE_INTERMISSION_BEAM_SECONDS_NORMAL;
}

export function varkhulForgeIntermissionNextWindow(
  window: 'intermission_left' | 'intermission_right',
): 'intermission_left' | 'intermission_right' {
  return window === 'intermission_left' ? 'intermission_right' : 'intermission_left';
}

export function varkhulForgeBeamWarningMask(
  window: VarkhulForgeBeamWindow,
  remaining: number,
): number {
  if (remaining > VARKHUL_FORGE_INTERMISSION_WARNING_SECONDS) return 0;
  if (window === 'intermission_left') return 2;
  if (window === 'intermission_right') return 1;
  return 0;
}

export function varkhulForgeBeamIsActive(mask: number, index: VarkhulForgeBeamIndex): boolean {
  return (Math.floor(mask) & (1 << index)) !== 0;
}

export function varkhulForgeIntermissionSeconds(difficulty: VarkhulAssemblyDifficulty): number {
  return difficulty === 'heroic'
    ? VARKHUL_FORGE_INTERMISSION_SECONDS_HEROIC
    : VARKHUL_FORGE_INTERMISSION_SECONDS_NORMAL;
}

export function varkhulCrucibleQuakeDamageRange(difficulty: VarkhulAssemblyDifficulty): {
  min: number;
  max: number;
} {
  return difficulty === 'heroic'
    ? VARKHUL_CRUCIBLE_QUAKE_DAMAGE_HEROIC
    : VARKHUL_CRUCIBLE_QUAKE_DAMAGE_NORMAL;
}

export function varkhulForgeIntermissionWaveCount(difficulty: VarkhulAssemblyDifficulty): number {
  return difficulty === 'heroic' ? 4 : 3;
}

export function varkhulForgeIntermissionWaveDelay(difficulty: VarkhulAssemblyDifficulty): number {
  return difficulty === 'heroic'
    ? VARKHUL_FORGE_ADD_WAVE_DELAY_HEROIC_SECONDS
    : VARKHUL_FORGE_ADD_WAVE_DELAY_NORMAL_SECONDS;
}

/** One Warden and three/four Sentinels, distributed deterministically over all portals. */
export function varkhulForgeIntermissionWave(
  difficulty: VarkhulAssemblyDifficulty,
  waveIndex: number,
): VarkhulForgeAddSpawn[] {
  const safeWave = Math.max(0, Math.floor(waveIndex));
  const wardenPortal = safeWave % VARKHUL_FORGE_PORTAL_LOCAL_POSITIONS.length;
  const result: VarkhulForgeAddSpawn[] = [
    { templateId: IGNIVAR_CRUCIBLE_WARDEN_ID, portalIndex: wardenPortal },
  ];
  for (let offset = 1; offset < VARKHUL_FORGE_PORTAL_LOCAL_POSITIONS.length; offset++) {
    result.push({
      templateId: IGNIVAR_EMBER_SENTINEL_ID,
      portalIndex: (wardenPortal + offset) % VARKHUL_FORGE_PORTAL_LOCAL_POSITIONS.length,
    });
  }
  if (difficulty === 'heroic') {
    result.push({
      templateId: IGNIVAR_EMBER_SENTINEL_ID,
      portalIndex: (wardenPortal + 2) % VARKHUL_FORGE_PORTAL_LOCAL_POSITIONS.length,
    });
  }
  return result;
}
