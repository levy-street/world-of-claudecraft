import {
  IGNIVAR_BRAND_AURA_ID,
  IGNIVAR_FORGE_WAVE_CAST_ID,
  IGNIVAR_FRONTAL_CAST_ID,
  IGNIVAR_JUDGMENT_CAST_ID,
  IGNIVAR_LAST_INFERNO_AURA_ID,
  IGNIVAR_ROTATING_RAYS_ACTIVE_SECONDS,
  IGNIVAR_ROTATING_RAYS_CAST_ID,
  IGNIVAR_ROTATING_RAYS_WINDUP_SECONDS,
  IGNIVAR_SKYFIRE_CAST_ID,
} from '../sim/encounters/ignivar';
import { IGNIVAR_FORGE_CHAINS_AURA_ID } from '../sim/ignivar_forge_chains';
import {
  IGNIVAR_JUDGMENT_ACTIVE_SECONDS,
  IGNIVAR_JUDGMENT_WARNING_SECONDS,
  type IgnivarJudgmentShelterIndex,
  ignivarForgeLayoutFromFacing,
} from '../sim/ignivar_forge_judgment';
import { ignivarForgeWaveRadius } from '../sim/ignivar_forge_wave';
import { IGNIVAR_BOSS_ID } from '../sim/types';

export type IgnivarVisualEntity = {
  id?: number;
  kind: string;
  templateId: string;
  castingAbility: string | null;
  castRemaining?: number;
  castTotal?: number;
  channeling?: boolean;
  dead?: boolean;
  facing?: number;
  auras: readonly {
    id: string;
    stacks?: number;
    value2?: number;
    remaining?: number;
    duration?: number;
  }[];
  scale?: number;
};

export interface IgnivarEncounterVisualPlan {
  frontalVisible: boolean;
  frontalProgress: number;
  skyfireVisible: boolean;
  rotatingRaysVisible: boolean;
  rotatingRaysPhase: 'hidden' | 'windup' | 'active';
  rotatingRaysWindupProgress: number;
  judgmentPhase: 'hidden' | 'warning' | 'active';
  judgmentRotation: number;
  judgmentSafeIndex: IgnivarJudgmentShelterIndex;
  judgmentCueIntensity: number;
  judgmentCueRevealed: boolean;
  finalPhase: boolean;
  forgeWavePhase: 'hidden' | 'windup' | 'active';
  forgeWaveProgress: number;
  forgeWaveRadius: number;
  branded: boolean;
  brandStacks: number;
  inverseEntityScale: number;
}

/** Keeps the boss anchor alive while only its cold-loaded cosmetic rig is gated. */
export function ignivarEncounterViewVisibleDuringCompile(
  templateId: string,
  compilePending: boolean,
): boolean {
  return templateId === IGNIVAR_BOSS_ID || !compilePending;
}

/** Ignivar's authored rig and flames stay readable without a generic body tint while casting. */
export function ignivarAllowsBodyGlow(
  templateId: string | undefined,
  castingAbility: string | null,
): boolean {
  return templateId !== IGNIVAR_BOSS_ID || castingAbility === null;
}

function cuePulse(progress: number, start: number, end: number): number {
  if (progress <= start || progress >= end) return 0;
  const phase = (progress - start) / (end - start);
  return Math.sin(phase * Math.PI);
}

/** Two early fire pulses reveal the false shelters, then leave a memory window. */
export function ignivarJudgmentCueIntensity(progress: number): number {
  const clamped = Math.max(0, Math.min(1, progress));
  return Math.max(cuePulse(clamped, 0.03, 0.25), cuePulse(clamped, 0.305, 0.525));
}

/**
 * The boss holds its exact sim facing while a facing-anchored telegraph cast
 * runs (moved verbatim from the renderer's facing interpolation): easing the
 * render yaw there would swing the frontal, wave, judgment, ray, and skyfire
 * anchors off the ground truth the sim resolves the hit against.
 */
export function ignivarBossFacingLocked(entity: {
  templateId: string;
  castingAbility: string | null;
}): boolean {
  return (
    entity.templateId === IGNIVAR_BOSS_ID &&
    (entity.castingAbility === IGNIVAR_FRONTAL_CAST_ID ||
      entity.castingAbility === IGNIVAR_FORGE_WAVE_CAST_ID ||
      entity.castingAbility === IGNIVAR_JUDGMENT_CAST_ID ||
      entity.castingAbility === IGNIVAR_ROTATING_RAYS_CAST_ID ||
      entity.castingAbility === IGNIVAR_SKYFIRE_CAST_ID)
  );
}

/** Keeps arena-wide actionable visuals alive when the boss body leaves the camera frustum. */
export function ignivarEncounterBypassesCharacterCulling(entity: IgnivarVisualEntity): boolean {
  if (entity.kind === 'player') {
    return entity.auras.some(
      (aura) => aura.id === IGNIVAR_FORGE_CHAINS_AURA_ID || aura.id === IGNIVAR_BRAND_AURA_ID,
    );
  }
  if (entity.templateId !== IGNIVAR_BOSS_ID) return false;
  return (
    entity.castingAbility === IGNIVAR_FRONTAL_CAST_ID ||
    entity.castingAbility === IGNIVAR_SKYFIRE_CAST_ID ||
    entity.castingAbility === IGNIVAR_ROTATING_RAYS_CAST_ID ||
    entity.castingAbility === IGNIVAR_FORGE_WAVE_CAST_ID ||
    entity.castingAbility === IGNIVAR_JUDGMENT_CAST_ID
  );
}

/** Pure per-frame presentation policy for Ignivar's encounter telegraphs. */
export function ignivarEncounterVisualPlan(
  entity: IgnivarVisualEntity,
): IgnivarEncounterVisualPlan {
  const brand =
    entity.kind === 'player'
      ? entity.auras.find((aura) => aura.id === IGNIVAR_BRAND_AURA_ID)
      : undefined;
  const brandStacks = Math.max(1, Math.min(3, brand?.stacks ?? 1));
  const frontalVisible =
    entity.templateId === IGNIVAR_BOSS_ID && entity.castingAbility === IGNIVAR_FRONTAL_CAST_ID;
  const frontalProgress = frontalVisible
    ? Math.min(
        1,
        Math.max(0, 1 - (entity.castRemaining ?? 0) / Math.max(0.01, entity.castTotal ?? 0.01)),
      )
    : 0;
  const rotatingRaysVisible =
    entity.templateId === IGNIVAR_BOSS_ID &&
    entity.castingAbility === IGNIVAR_ROTATING_RAYS_CAST_ID;
  const rotatingRaysRemaining = Math.max(0, entity.castRemaining ?? 0);
  const rotatingRaysPhase = !rotatingRaysVisible
    ? 'hidden'
    : rotatingRaysRemaining > IGNIVAR_ROTATING_RAYS_ACTIVE_SECONDS
      ? 'windup'
      : 'active';
  const rotatingRaysWindupProgress =
    rotatingRaysPhase === 'windup'
      ? 1 -
        Math.min(
          IGNIVAR_ROTATING_RAYS_WINDUP_SECONDS,
          rotatingRaysRemaining - IGNIVAR_ROTATING_RAYS_ACTIVE_SECONDS,
        ) /
          IGNIVAR_ROTATING_RAYS_WINDUP_SECONDS
      : rotatingRaysPhase === 'active'
        ? 1
        : 0;
  const forgeWaveVisible =
    entity.templateId === IGNIVAR_BOSS_ID && entity.castingAbility === IGNIVAR_FORGE_WAVE_CAST_ID;
  const forgeWavePhase = !forgeWaveVisible ? 'hidden' : entity.channeling ? 'active' : 'windup';
  const forgeWaveProgress = forgeWaveVisible
    ? Math.min(
        1,
        Math.max(0, 1 - (entity.castRemaining ?? 0) / Math.max(0.01, entity.castTotal ?? 0.01)),
      )
    : 0;
  const judgmentVisible =
    entity.templateId === IGNIVAR_BOSS_ID && entity.castingAbility === IGNIVAR_JUDGMENT_CAST_ID;
  const judgmentPhase = !judgmentVisible ? 'hidden' : entity.channeling ? 'active' : 'warning';
  const judgmentLayout = ignivarForgeLayoutFromFacing(judgmentVisible ? (entity.facing ?? 0) : 0);
  const judgmentWarningRemaining =
    judgmentPhase === 'warning'
      ? Math.max(
          0,
          Math.min(
            IGNIVAR_JUDGMENT_WARNING_SECONDS,
            (entity.castRemaining ?? IGNIVAR_JUDGMENT_ACTIVE_SECONDS) -
              IGNIVAR_JUDGMENT_ACTIVE_SECONDS,
          ),
        )
      : 0;
  const judgmentWarningProgress =
    judgmentPhase === 'warning'
      ? 1 - judgmentWarningRemaining / IGNIVAR_JUDGMENT_WARNING_SECONDS
      : 0;
  return {
    frontalVisible,
    frontalProgress,
    skyfireVisible:
      entity.templateId === IGNIVAR_BOSS_ID && entity.castingAbility === IGNIVAR_SKYFIRE_CAST_ID,
    rotatingRaysVisible,
    rotatingRaysPhase,
    rotatingRaysWindupProgress,
    judgmentPhase,
    judgmentRotation: judgmentLayout.rotation,
    judgmentSafeIndex: judgmentLayout.safeIndex,
    judgmentCueIntensity: ignivarJudgmentCueIntensity(judgmentWarningProgress),
    judgmentCueRevealed: judgmentPhase === 'warning' && judgmentWarningProgress >= 0.03,
    finalPhase:
      entity.templateId === IGNIVAR_BOSS_ID &&
      entity.auras.some((aura) => aura.id === IGNIVAR_LAST_INFERNO_AURA_ID),
    forgeWavePhase,
    forgeWaveProgress,
    forgeWaveRadius:
      forgeWavePhase === 'active' ? ignivarForgeWaveRadius(entity.castRemaining ?? 0) : 0,
    branded: brand !== undefined,
    brandStacks,
    inverseEntityScale: 1 / Math.max(0.01, entity.scale ?? 1),
  };
}
