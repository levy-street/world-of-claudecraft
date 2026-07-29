// Localized ability names, shared by every surface that shows one.
//
// Extracted from hud.ts so the combat meters can label a breakdown row without
// importing Hud (hud.ts imports meters.ts, so the reverse edge would be a
// cycle). Behavior is unchanged: the resolver order is the ability catalog
// first, then the sim's aura/mechanic localizer for boss mechanics that are not
// in ABILITIES, then the raw English as a last resort.

import { ABILITIES } from '../sim/data';
import type { AbilityDef } from '../sim/types';
import { tEntity } from './entity_i18n';
import { localizeSimAuraName } from './sim_i18n';

export function abilityDisplayName(def: AbilityDef): string {
  return tEntity({ kind: 'ability', id: def.id, field: 'name' });
}

/** Localize an ability by the English NAME a combat event carries, not its id. */
export function abilityDisplayNameFromSource(name: string): string {
  const ability = Object.values(ABILITIES).find((candidate) => candidate.name === name);
  if (ability) return abilityDisplayName(ability);
  // Boss/mob mechanic names (War Stomp, etc.) surface as a damage-log ability label but
  // are not in ABILITIES; route them through the shared sim aura/mechanic localizer.
  return localizeSimAuraName(name) ?? name;
}
