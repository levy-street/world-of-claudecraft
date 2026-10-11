// Every ability id the painter holds a spec for: the union of the generated
// gallery tables, the Warrior tables, the class-owned bespoke ids the
// registry routes by name, and the encounter overlay. The bespoke ids are
// read off the registry's own source, filtered to the ones that resolve, so
// a new bespoke id joins without a list to keep in step.

import { readFileSync } from 'node:fs';
import { abilityVfxSpecFor, ENCOUNTER_VFX_IDS } from '../../src/render/ability_vfx/encounter_specs';
import { ABILITY_VFX_FULL_SPECS } from '../../src/render/ability_vfx_full_specs';
import { ABILITY_VFX_SPECS } from '../../src/render/ability_vfx_specs';
import { WARRIOR_VFX_FULL_SPECS, WARRIOR_VFX_SPECS } from '../../src/render/warrior_vfx_specs';

export function abilityVfxSpecIds(): string[] {
  const registry = readFileSync(
    new URL('../../src/render/ability_vfx_registry.ts', import.meta.url),
    'utf8',
  );
  const bespoke = [...registry.matchAll(/abilityId === '([a-z0-9_]+)'/g)].map((m) => m[1]);
  const ids = new Set([
    ...Object.keys(ABILITY_VFX_FULL_SPECS),
    ...Object.keys(ABILITY_VFX_SPECS),
    ...Object.keys(WARRIOR_VFX_FULL_SPECS),
    ...Object.keys(WARRIOR_VFX_SPECS),
    ...bespoke,
    ...ENCOUNTER_VFX_IDS,
  ]);
  return [...ids].filter((id) => abilityVfxSpecFor(id) !== undefined).sort();
}
