// Which abilities ignore classic-era damage pushback by DEFINITION, before any
// talent or runtime aura: Ghost Wolf's shift, and every cast authored
// uninterruptible. Pure and import-light so the combat pushback check
// (damage.ts) and the tooltip detail block read the one rule.

import type { AbilityDef } from '../types';

export function baselinePushbackImmune(def: Pick<AbilityDef, 'id' | 'uninterruptible'>): boolean {
  return def.id === 'ghost_wolf' || def.uninterruptible === true;
}
