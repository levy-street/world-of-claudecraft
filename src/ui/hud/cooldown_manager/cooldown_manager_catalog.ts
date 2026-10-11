// Every castable spell a class can ever have, whatever its specialization,
// talent choices or level: the pool the Cooldown Manager lets a player sort into
// groups, so a spell from another spec can be placed ahead of time and simply
// appears once the character's current build knows it.
//
// DERIVED from the sim's own content, never listed: the class's authored kit
// (spec-gated and higher-level spells included), each specialization's
// signature, every grant a talent row option or spec effect carries. A new
// spell, spec or talent grant joins with no edit here, and
// tests/cooldown_manager_catalog.test.ts sweeps every class and spec to prove the
// live known list never holds a castable spell this catalog misses.
//
// Pure: sim content reads only, no DOM, storage or i18n.

import { ABILITIES, CLASSES } from '../../../sim/content/classes';
import { specBaselineFor } from '../../../sim/content/spec_baselines';
import { rowTreeFor } from '../../../sim/content/talent_rows';
import type { TalentEffect } from '../../../sim/content/talents';
import { talentsFor } from '../../../sim/content/talents';
import type { PlayerClass } from '../../../sim/types';

/** Whether an ability is a spell a player can press: known to the content, not
 *  passive (nothing to press) and not retired from the player's spellbook. */
export function cooldownTrackable(abilityId: string): boolean {
  const def = ABILITIES[abilityId];
  return def !== undefined && !def.passive && !def.hiddenFromPlayer;
}

const allCache = new Map<PlayerClass, readonly string[]>();
const cache = new Map<PlayerClass, readonly string[]>();

/**
 * Every ability id a class can ever hold, passives included: the authored kit,
 * each spec's signature, and every grant a talent row option or spec effect
 * carries. The aura catalog reads this (a passive such as Hot Streak is what
 * arms its proc); the spell picker reads the trackable subset below.
 */
export function cooldownClassAbilityIds(cls: PlayerClass): readonly string[] {
  const cached = allCache.get(cls);
  if (cached) return cached;
  const out: string[] = [];
  const add = (id: string | undefined): void => {
    if (id && ABILITIES[id] && !out.includes(id)) out.push(id);
  };
  const addEffect = (effect: TalentEffect | undefined): void => add(effect?.grant?.ability);
  for (const id of CLASSES[cls]?.abilities ?? []) add(id);
  for (const spec of talentsFor(cls)?.specs ?? []) {
    add(spec.signature);
    addEffect(spec.mastery.effect);
    addEffect(specBaselineFor(cls, spec.id));
  }
  for (const row of rowTreeFor(cls) ?? []) {
    for (const option of row.options) addEffect(option.effect);
  }
  allCache.set(cls, out);
  return out;
}

/**
 * Every trackable spell of a class, in a stable order: the authored kit first
 * (spellbook order), then spec signatures, then talent and spec grants. Memoized
 * per class; content is static for the session.
 */
export function cooldownClassCatalog(cls: PlayerClass): readonly string[] {
  const cached = cache.get(cls);
  if (cached) return cached;
  const out = cooldownClassAbilityIds(cls).filter(cooldownTrackable);
  cache.set(cls, out);
  return out;
}
