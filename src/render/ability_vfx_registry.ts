import type { AbilityVfxFullSpec, AbilityVfxSpec } from './ability_vfx_core';
import { ABILITY_VFX_FULL_SPECS } from './ability_vfx_full_specs';
import { ABILITY_VFX_SPECS } from './ability_vfx_specs';
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
import {
  EMBERKIN_FELBOLT_VFX_FULL_SPEC,
  EMBERKIN_FELBOLT_VFX_SPEC,
  GLOOMSHADE_ABYSSAL_CHAIN_VFX_FULL_SPEC,
  GLOOMSHADE_ABYSSAL_CHAIN_VFX_SPEC,
} from './warlock_pet_vfx_specs';
import { ABYSSAL_RIFT_VFX_FULL_SPEC, ABYSSAL_RIFT_VFX_SPEC } from './warlock_vfx_specs';

// Generated gallery projections remain untouched. Class-owned bespoke
// identities resolve through this narrow runtime seam instead.
export function abilityVfxSpec(abilityId: string): AbilityVfxSpec | undefined {
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
  return ABILITY_VFX_SPECS[abilityId];
}

export function abilityVfxFullSpec(abilityId: string): AbilityVfxFullSpec | undefined {
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
  return ABILITY_VFX_FULL_SPECS[abilityId];
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
