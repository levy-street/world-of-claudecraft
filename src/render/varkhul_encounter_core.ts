import {
  VARKHUL_ANVILS_DECREE_CAST_ID,
  VARKHUL_ANVILS_DECREE_STRIKE_SECONDS,
  VARKHUL_ANVILS_DECREE_STRIKES,
  VARKHUL_BOSS_ID,
  VARKHUL_LIVING_BLUEPRINT_AURA_ID,
  VARKHUL_MAKERS_BRAND_AURA_ID,
  VARKHUL_MAKERS_BRAND_MAX_STACKS,
} from '../sim/encounters/varkhul';

export type VarkhulVisualEntity = {
  kind: string;
  templateId: string;
  castingAbility: string | null;
  castRemaining?: number;
  castTotal?: number;
  facing?: number;
  scale?: number;
  auras: readonly {
    id: string;
    stacks?: number;
    remaining?: number;
    duration?: number;
  }[];
};

export interface VarkhulEncounterVisualPlan {
  makersBrandStacks: number;
  blueprintVisible: boolean;
  blueprintProgress: number;
  blueprintWorldRotation: number;
  anvilVisible: boolean;
  anvilProgress: number;
  anvilWorldRotation: number;
  inverseEntityScale: number;
}

function auraProgress(aura: { remaining?: number; duration?: number } | undefined): number {
  if (!aura) return 0;
  return Math.min(
    1,
    Math.max(0, 1 - (aura.remaining ?? 0) / Math.max(0.01, aura.duration ?? 0.01)),
  );
}

function anvilStrikeProgress(remaining: number, total: number): number {
  const strikeSeconds = VARKHUL_ANVILS_DECREE_STRIKE_SECONDS;
  const elapsed = Math.max(0, total - Math.max(0, remaining));
  const strikeIndex = Math.min(
    VARKHUL_ANVILS_DECREE_STRIKES - 1,
    Math.floor(elapsed / strikeSeconds),
  );
  return Math.min(1, Math.max(0, (elapsed - strikeIndex * strikeSeconds) / strikeSeconds));
}

/** Keeps long radial warnings alive even when their owning body is outside the frustum. */
export function varkhulEncounterBypassesCharacterCulling(entity: VarkhulVisualEntity): boolean {
  if (entity.kind === 'player') {
    return entity.auras.some((aura) => aura.id === VARKHUL_LIVING_BLUEPRINT_AURA_ID);
  }
  return (
    entity.templateId === VARKHUL_BOSS_ID && entity.castingAbility === VARKHUL_ANVILS_DECREE_CAST_ID
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
  const blueprint =
    entity.kind === 'player'
      ? entity.auras.find((aura) => aura.id === VARKHUL_LIVING_BLUEPRINT_AURA_ID)
      : undefined;
  const anvilVisible =
    entity.templateId === VARKHUL_BOSS_ID &&
    entity.castingAbility === VARKHUL_ANVILS_DECREE_CAST_ID;
  const anvilTotal =
    entity.castTotal ?? VARKHUL_ANVILS_DECREE_STRIKES * VARKHUL_ANVILS_DECREE_STRIKE_SECONDS;
  return {
    makersBrandStacks: brand
      ? Math.max(1, Math.min(VARKHUL_MAKERS_BRAND_MAX_STACKS, brand.stacks ?? 1))
      : 0,
    blueprintVisible: blueprint !== undefined,
    blueprintProgress: auraProgress(blueprint),
    // The sim resolves Blueprint on fixed diagonal world axes.
    blueprintWorldRotation: Math.PI / 4,
    anvilVisible,
    anvilProgress: anvilVisible
      ? anvilStrikeProgress(entity.castRemaining ?? anvilTotal, anvilTotal)
      : 0,
    anvilWorldRotation: entity.facing ?? 0,
    inverseEntityScale: 1 / Math.max(0.01, entity.scale ?? 1),
  };
}
