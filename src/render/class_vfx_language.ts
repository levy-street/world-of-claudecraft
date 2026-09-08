import { ABILITIES } from '../sim/data';
import type { AbilityVfxFullSpec, AbilityVfxWindupStyle } from './ability_vfx_core';

const CAST: Record<string, AbilityVfxWindupStyle> = {
  hunter: 'quiver',
  priest: 'scripture',
  shaman: 'conduction',
  druid: 'bough',
  paladin: 'solar',
  warlock: 'occult',
  rogue: 'weapon',
  warrior: 'stance',
  mage: 'runes',
};

/** Class identity is resolved from canonical content, never inferred from a
 * shared school colour. Mage alone owns the geometric casting circle. */
export function withClassVfxLanguage(id: string, spec: AbilityVfxFullSpec): AbilityVfxFullSpec {
  const cls = ABILITIES[id]?.class;
  if (!cls || !CAST[cls] || spec.presentation) return spec;
  const language =
    cls === 'shaman' && (spec.archetype === 'heal' || spec.healStyle === 'water')
      ? 'spring'
      : cls === 'priest' && ABILITIES[id]?.school === 'shadow'
        ? 'psionic'
        : cls === 'druid' && (spec.palette === 'moon' || ABILITIES[id]?.school === 'arcane')
          ? 'lunar'
          : CAST[cls];
  return {
    ...spec,
    castIdentity: language,
    areaTelegraph: cls === 'hunter' || cls === 'priest' ? true : spec.areaTelegraph,
    windupStyle: spec.windupStyle === 'none' || spec.physical ? 'none' : language,
    // Geometry replaces the old extra ring-per-stream at the release seam.
    impact:
      cls === 'hunter' || cls === 'priest'
        ? { ...spec.impact, ring: false, vRing: false, flipbook: false }
        : spec.impact,
  };
}
