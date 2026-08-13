export const DOCTRINE_AURA_ID = 'priest_doctrine';
export const SERAPHIC_VIGIL_ID = 'seraphic_vigil';
export const EFFIGY_AURA_ID = 'priest_effigy';
export const GLOOMTITHE_AURA_ID = 'priest_gloomtithe';
export const GLOOMTITHE_MAX_STACKS = 5;

export interface PriestMarkerAura {
  id?: string;
  kind: string;
  stacks?: number;
}

export interface PriestMarkerState {
  doctrine: boolean;
  vigil: boolean;
  dirge: boolean;
  effigy: boolean;
  gloomtitheStacks: number;
  summonReady: boolean;
}

export function emptyPriestMarkerState(): PriestMarkerState {
  return {
    doctrine: false,
    vigil: false,
    dirge: false,
    effigy: false,
    gloomtitheStacks: 0,
    summonReady: false,
  };
}

/** Shared offline/online presentation projection for Priest relationship auras. */
export function priestMarkerStateForAuras(
  auras: readonly PriestMarkerAura[],
  out: PriestMarkerState = emptyPriestMarkerState(),
): PriestMarkerState {
  out.doctrine = false;
  out.vigil = false;
  out.dirge = false;
  out.effigy = false;
  out.gloomtitheStacks = 0;
  for (const aura of auras) {
    if (aura.id === DOCTRINE_AURA_ID) out.doctrine = true;
    else if (aura.id === SERAPHIC_VIGIL_ID) out.vigil = true;
    else if (aura.id === 'shadow_word_pain' && aura.kind === 'dot') out.dirge = true;
    else if (aura.id === EFFIGY_AURA_ID) out.effigy = true;
    else if (aura.id === GLOOMTITHE_AURA_ID || aura.kind === 'gloomtithe') {
      out.gloomtitheStacks = Math.max(
        out.gloomtitheStacks,
        Math.min(GLOOMTITHE_MAX_STACKS, Math.max(0, aura.stacks ?? 1)),
      );
    }
  }
  out.summonReady = out.gloomtitheStacks >= GLOOMTITHE_MAX_STACKS;
  return out;
}

/** Persistent action-bar cue required when the Vespers bank reaches five stacks. */
export function priestActionGlowActive(
  auras: readonly PriestMarkerAura[],
  abilityId: string,
): boolean {
  if (abilityId !== 'summon_tithefiend') return false;
  for (const aura of auras) {
    if (
      (aura.id === GLOOMTITHE_AURA_ID || aura.kind === 'gloomtithe') &&
      (aura.stacks ?? 1) >= GLOOMTITHE_MAX_STACKS
    )
      return true;
  }
  return false;
}
