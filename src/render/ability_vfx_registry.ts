import { refineCatalogueSpec } from './ability_vfx/material_response_core';
import { refineSignatureSpec } from './ability_vfx/signature_core';
import { ABILITY_VFX_ART_PROFILES } from './ability_vfx_art_profiles';
import type { AbilityVfxFullSpec, AbilityVfxSpec } from './ability_vfx_core';
import {
  type AbilityVfxDraft,
  draftAbilityVfx,
  validAbilityVfxDraft,
} from './ability_vfx_draft_core';
import { ABILITY_VFX_SPECS } from './ability_vfx_specs';
import { withClassVfxLanguage } from './class_vfx_language';
import {
  BURNING_PACT_VFX_FULL_SPEC,
  BURNING_PACT_VFX_SPEC,
  CONFLAGRATE_VFX_FULL_SPEC,
  CONFLAGRATE_VFX_SPEC,
  DUSKFIRE_VFX_FULL_SPEC,
  DUSKFIRE_VFX_SPEC,
  GLOOM_BOLT_VFX_FULL_SPEC,
  GLOOM_BOLT_VFX_SPEC,
  PYRE_COLOSSUS_VFX_FULL_SPEC,
  PYRE_COLOSSUS_VFX_SPEC,
  RAIN_OF_FIRE_VFX_FULL_SPEC,
  RAIN_OF_FIRE_VFX_SPEC,
  RUINBOLT_VFX_FULL_SPEC,
  RUINBOLT_VFX_SPEC,
  RUINOUS_BRAND_VFX_FULL_SPEC,
  RUINOUS_BRAND_VFX_SPEC,
} from './destruction_vfx_specs';
import { DRUID_VFX_FULL_SPECS } from './druid_vfx_specs';
import { HUNTER_VFX_FULL_SPECS, HUNTER_VFX_SPECS } from './hunter_vfx_specs';
import {
  ARMY_OF_THE_DEAD_VFX_FULL_SPEC,
  ARMY_OF_THE_DEAD_VFX_SPEC,
  BONE_MAGE_SHADOW_BOLT_VFX_FULL_SPEC,
  BONE_MAGE_SHADOW_BOLT_VFX_SPEC,
  CORPSE_EXPLOSION_VFX_FULL_SPEC,
  CORPSE_EXPLOSION_VFX_SPEC,
  DEATH_ECHO_VFX_FULL_SPEC,
  DEATH_ECHO_VFX_SPEC,
  ESSENCE_REAP_VFX_FULL_SPEC,
  ESSENCE_REAP_VFX_SPEC,
  OSSUARY_MARK_DETONATE_VFX_FULL_SPEC,
  OSSUARY_MARK_DETONATE_VFX_SPEC,
  OSSUARY_MARK_VFX_FULL_SPEC,
  OSSUARY_MARK_VFX_SPEC,
  REAPING_COMMAND_VFX_FULL_SPEC,
  REAPING_COMMAND_VFX_SPEC,
  SOUL_LANCE_VFX_FULL_SPEC,
  SOUL_LANCE_VFX_SPEC,
} from './necromancy_vfx_specs';
import { PHYSICAL_KIT_FULL_SPECS, PHYSICAL_KIT_SPECS } from './physical_kit_vfx_specs';
import { PRIEST_VFX_FULL_SPECS } from './priest_vfx_specs';
import { RITUAL_KIT_FULL_SPECS, RITUAL_KIT_SPECS } from './ritual_kit_vfx_specs';
import { SHAMAN_VFX_FULL_SPECS, SHAMAN_VFX_SPECS } from './shaman_vfx_specs';
import {
  EMBERKIN_FELBOLT_VFX_FULL_SPEC,
  EMBERKIN_FELBOLT_VFX_SPEC,
  GLOOMSHADE_ABYSSAL_CHAIN_VFX_FULL_SPEC,
  GLOOMSHADE_ABYSSAL_CHAIN_VFX_SPEC,
} from './warlock_pet_vfx_specs';
import { ABYSSAL_RIFT_VFX_FULL_SPEC, ABYSSAL_RIFT_VFX_SPEC } from './warlock_vfx_specs';
import { WARRIOR_VFX_FULL_SPECS, WARRIOR_VFX_SPECS } from './warrior_vfx_specs';

const drafts = new Map<string, ReturnType<typeof draftAbilityVfx>>();
const refined = new Map<string, AbilityVfxFullSpec>();
function resolvedBaseFull(id: string): AbilityVfxFullSpec | undefined {
  const cached = refined.get(id);
  if (cached) return cached;
  const base = baseAbilityVfxFullSpec(id);
  if (!base) return;
  let result =
    base.physical || base.ritual || base.presentation
      ? base
      : refineSignatureSpec(id, refineCatalogueSpec(base));
  if (id === 'scorch' || id === 'arcane_surge') result = { ...result, damageCue: true };
  result = withClassVfxLanguage(id, result);
  refined.set(id, result);
  return result;
}

/** In-memory authoring only. Both game and studio consume the same resolution
 * seam; shipping definitions are never mutated. No executable draft content. */
export function setAbilityVfxDraft(id: string, draft: AbilityVfxDraft | null): boolean {
  if (draft === null) return drafts.delete(id);
  const compact = baseAbilityVfxSpec(id);
  const full = resolvedBaseFull(id);
  if (!compact || !full || !validAbilityVfxDraft(draft)) return false;
  drafts.set(id, draftAbilityVfx(compact, full, draft));
  return true;
}

export function abilityVfxSpec(id: string): AbilityVfxSpec | undefined {
  return drafts.get(id)?.compact ?? baseAbilityVfxSpec(id);
}
export function abilityVfxFullSpec(id: string): AbilityVfxFullSpec | undefined {
  return drafts.get(id)?.full ?? resolvedBaseFull(id);
}

// Generated gallery projections remain untouched. Class-owned bespoke
// identities resolve through this narrow runtime seam instead.
function baseAbilityVfxSpec(abilityId: string): AbilityVfxSpec | undefined {
  if (Object.hasOwn(HUNTER_VFX_SPECS, abilityId)) return HUNTER_VFX_SPECS[abilityId];
  if (Object.hasOwn(WARRIOR_VFX_SPECS, abilityId)) return WARRIOR_VFX_SPECS[abilityId];
  if (Object.hasOwn(PHYSICAL_KIT_SPECS, abilityId)) return PHYSICAL_KIT_SPECS[abilityId];
  if (Object.hasOwn(RITUAL_KIT_SPECS, abilityId)) return RITUAL_KIT_SPECS[abilityId];
  if (Object.hasOwn(SHAMAN_VFX_SPECS, abilityId)) return SHAMAN_VFX_SPECS[abilityId];
  if (abilityId === 'emberkin_felbolt') return EMBERKIN_FELBOLT_VFX_SPEC;
  if (abilityId === 'gloomshade_abyssal_chain') return GLOOMSHADE_ABYSSAL_CHAIN_VFX_SPEC;
  if (abilityId === 'bone_mage_shadow_bolt') return BONE_MAGE_SHADOW_BOLT_VFX_SPEC;
  if (abilityId === 'shadow_bolt') return GLOOM_BOLT_VFX_SPEC;
  if (abilityId === 'chaos_bolt') return RUINBOLT_VFX_SPEC;
  if (abilityId === 'immolate') return BURNING_PACT_VFX_SPEC;
  if (abilityId === 'conflagrate') return CONFLAGRATE_VFX_SPEC;
  if (abilityId === 'shadowburn') return DUSKFIRE_VFX_SPEC;
  if (abilityId === 'ruinous_brand') return RUINOUS_BRAND_VFX_SPEC;
  if (abilityId === 'rain_of_fire') return RAIN_OF_FIRE_VFX_SPEC;
  if (abilityId === 'summon_infernal') return PYRE_COLOSSUS_VFX_SPEC;
  if (abilityId === 'soul_harvest') return ESSENCE_REAP_VFX_SPEC;
  if (abilityId === 'soul_lance') return SOUL_LANCE_VFX_SPEC;
  if (abilityId === 'ossuary_mark') return OSSUARY_MARK_VFX_SPEC;
  if (abilityId === 'ossuary_mark_detonate') return OSSUARY_MARK_DETONATE_VFX_SPEC;
  if (abilityId === 'death_echo') return DEATH_ECHO_VFX_SPEC;
  if (abilityId === 'corpse_explosion') return CORPSE_EXPLOSION_VFX_SPEC;
  if (abilityId === 'reaping_command') return REAPING_COMMAND_VFX_SPEC;
  if (abilityId === 'army_of_the_dead') return ARMY_OF_THE_DEAD_VFX_SPEC;
  if (abilityId === 'abyssal_rift') return ABYSSAL_RIFT_VFX_SPEC;
  return Object.hasOwn(ABILITY_VFX_SPECS, abilityId) ? ABILITY_VFX_SPECS[abilityId] : undefined;
}

function baseAbilityVfxFullSpec(abilityId: string): AbilityVfxFullSpec | undefined {
  if (Object.hasOwn(DRUID_VFX_FULL_SPECS, abilityId)) return DRUID_VFX_FULL_SPECS[abilityId];
  if (Object.hasOwn(HUNTER_VFX_FULL_SPECS, abilityId)) return HUNTER_VFX_FULL_SPECS[abilityId];
  if (Object.hasOwn(PRIEST_VFX_FULL_SPECS, abilityId)) return PRIEST_VFX_FULL_SPECS[abilityId];
  if (Object.hasOwn(WARRIOR_VFX_FULL_SPECS, abilityId)) return WARRIOR_VFX_FULL_SPECS[abilityId];
  if (Object.hasOwn(PHYSICAL_KIT_FULL_SPECS, abilityId)) return PHYSICAL_KIT_FULL_SPECS[abilityId];
  if (Object.hasOwn(RITUAL_KIT_FULL_SPECS, abilityId)) return RITUAL_KIT_FULL_SPECS[abilityId];
  if (Object.hasOwn(SHAMAN_VFX_FULL_SPECS, abilityId)) return SHAMAN_VFX_FULL_SPECS[abilityId];
  if (abilityId === 'emberkin_felbolt') return EMBERKIN_FELBOLT_VFX_FULL_SPEC;
  if (abilityId === 'gloomshade_abyssal_chain') return GLOOMSHADE_ABYSSAL_CHAIN_VFX_FULL_SPEC;
  if (abilityId === 'bone_mage_shadow_bolt') return BONE_MAGE_SHADOW_BOLT_VFX_FULL_SPEC;
  if (abilityId === 'shadow_bolt') return GLOOM_BOLT_VFX_FULL_SPEC;
  if (abilityId === 'chaos_bolt') return RUINBOLT_VFX_FULL_SPEC;
  if (abilityId === 'immolate') return BURNING_PACT_VFX_FULL_SPEC;
  if (abilityId === 'conflagrate') return CONFLAGRATE_VFX_FULL_SPEC;
  if (abilityId === 'shadowburn') return DUSKFIRE_VFX_FULL_SPEC;
  if (abilityId === 'ruinous_brand') return RUINOUS_BRAND_VFX_FULL_SPEC;
  if (abilityId === 'rain_of_fire') return RAIN_OF_FIRE_VFX_FULL_SPEC;
  if (abilityId === 'summon_infernal') return PYRE_COLOSSUS_VFX_FULL_SPEC;
  if (abilityId === 'soul_harvest') return ESSENCE_REAP_VFX_FULL_SPEC;
  if (abilityId === 'soul_lance') return SOUL_LANCE_VFX_FULL_SPEC;
  if (abilityId === 'ossuary_mark') return OSSUARY_MARK_VFX_FULL_SPEC;
  if (abilityId === 'ossuary_mark_detonate') return OSSUARY_MARK_DETONATE_VFX_FULL_SPEC;
  if (abilityId === 'death_echo') return DEATH_ECHO_VFX_FULL_SPEC;
  if (abilityId === 'corpse_explosion') return CORPSE_EXPLOSION_VFX_FULL_SPEC;
  if (abilityId === 'reaping_command') return REAPING_COMMAND_VFX_FULL_SPEC;
  if (abilityId === 'army_of_the_dead') return ARMY_OF_THE_DEAD_VFX_FULL_SPEC;
  if (abilityId === 'abyssal_rift') return ABYSSAL_RIFT_VFX_FULL_SPEC;
  return Object.hasOwn(ABILITY_VFX_ART_PROFILES, abilityId)
    ? ABILITY_VFX_ART_PROFILES[abilityId]
    : undefined;
}

interface CastVfxSyncPort<T> {
  syncEntity(entity: T): void;
}

// Runtime routing kept beside the bespoke registry so the renderer and tests
// share one executable decision rather than duplicating string conditions.
export function syncAbilityVfxCast<T>(
  abilityId: string | null | undefined,
  painter: CastVfxSyncPort<T>,
  entity: T,
): boolean {
  if (
    abilityId !== 'chaos_bolt' &&
    abilityId !== 'soul_harvest' &&
    abilityId !== 'shadow_bolt' &&
    abilityId !== 'soul_lance'
  )
    return false;
  painter.syncEntity(entity);
  return true;
}

export function shouldDrawLegacyCastSparkle(
  casting: boolean,
  abilityId: string | null | undefined,
): boolean {
  return (
    casting &&
    abilityId !== 'soul_harvest' &&
    abilityId !== 'shadow_bolt' &&
    abilityId !== 'soul_lance'
  );
}
