import {
  VARKHUL_BOSS_ID,
  VARKHUL_CINDER_ORBS_AURA_ID,
  VARKHUL_MAKERS_BRAND_AURA_ID,
  VARKHUL_MAKERS_BRAND_MAX_STACKS,
} from '../sim/encounters/varkhul';
import { VARKHUL_FRONTAL_CAST_ID } from '../sim/varkhul_frontal';
import {
  VARKHUL_SHARED_PYRE_AURA_ID,
  VARKHUL_SHARED_PYRE_REQUIRED_NORMAL,
} from '../sim/varkhul_shared_pyre';

export type VarkhulVisualEntity = {
  id?: number;
  kind: string;
  templateId: string;
  scale?: number;
  dead?: boolean;
  pos?: { x: number; z: number };
  castingAbility?: string | null;
  castRemaining?: number;
  castTotal?: number;
  auras: readonly {
    id: string;
    stacks?: number;
    remaining?: number;
    duration?: number;
    value?: number;
    charges?: number;
  }[];
};

export interface VarkhulEncounterVisualPlan {
  makersBrandStacks: number;
  cinderOrbsVisible: boolean;
  cinderOrbsProgress: number;
  frontalVisible: boolean;
  frontalProgress: number;
  sharedPyreVisible: boolean;
  sharedPyreProgress: number;
  sharedPyreRequiredPlayers: number;
  inverseEntityScale: number;
}

function auraProgress(aura: { remaining?: number; duration?: number } | undefined): number {
  if (!aura) return 0;
  return Math.min(
    1,
    Math.max(0, 1 - (aura.remaining ?? 0) / Math.max(0.01, aura.duration ?? 0.01)),
  );
}

/** Keeps actionable player marks alive even when their owning body is outside the frustum. */
export function varkhulEncounterBypassesCharacterCulling(entity: VarkhulVisualEntity): boolean {
  return (
    (entity.templateId === VARKHUL_BOSS_ID && entity.castingAbility === VARKHUL_FRONTAL_CAST_ID) ||
    (entity.kind === 'player' &&
      entity.auras.some((aura) => aura.id === VARKHUL_CINDER_ORBS_AURA_ID)) ||
    (entity.kind === 'player' &&
      entity.auras.some((aura) => aura.id === VARKHUL_SHARED_PYRE_AURA_ID))
  );
}

/** Keeps the raid boss anchor available while its generated rig finishes compiling. */
export function varkhulEncounterViewVisibleDuringCompile(
  entity: VarkhulVisualEntity,
  compilePending: boolean,
): boolean {
  return (
    !compilePending ||
    entity.templateId === VARKHUL_BOSS_ID ||
    varkhulEncounterBypassesCharacterCulling(entity)
  );
}

export function varkhulEncounterVisualPlan(
  entity: VarkhulVisualEntity,
): VarkhulEncounterVisualPlan {
  const brand =
    entity.kind === 'player'
      ? entity.auras.find((aura) => aura.id === VARKHUL_MAKERS_BRAND_AURA_ID)
      : undefined;
  const cinderOrbs =
    entity.kind === 'player'
      ? entity.auras.find((aura) => aura.id === VARKHUL_CINDER_ORBS_AURA_ID)
      : undefined;
  const frontalVisible =
    entity.templateId === VARKHUL_BOSS_ID && entity.castingAbility === VARKHUL_FRONTAL_CAST_ID;
  const sharedPyre =
    entity.kind === 'player'
      ? entity.auras.find((aura) => aura.id === VARKHUL_SHARED_PYRE_AURA_ID)
      : undefined;
  return {
    makersBrandStacks: brand
      ? Math.max(1, Math.min(VARKHUL_MAKERS_BRAND_MAX_STACKS, brand.stacks ?? 1))
      : 0,
    cinderOrbsVisible: cinderOrbs !== undefined,
    cinderOrbsProgress: auraProgress(cinderOrbs),
    frontalVisible,
    frontalProgress: frontalVisible
      ? Math.min(
          1,
          Math.max(0, 1 - (entity.castRemaining ?? 0) / Math.max(0.01, entity.castTotal ?? 0.01)),
        )
      : 0,
    sharedPyreVisible: sharedPyre !== undefined,
    sharedPyreProgress: auraProgress(sharedPyre),
    sharedPyreRequiredPlayers: Math.max(
      1,
      Math.floor(sharedPyre?.stacks ?? VARKHUL_SHARED_PYRE_REQUIRED_NORMAL),
    ),
    inverseEntityScale: 1 / Math.max(0.01, entity.scale ?? 1),
  };
}
