import type { AbilityVfxFullSpec } from '../ability_vfx_core';
import { SIGNATURE_ABILITIES, substanceOf } from './signature_core';

/** Catalogue-wide material language; tiny repeated hits never inherit a hero's
 * smoke stack. Preserves authored area boundaries and class-owned motifs. */
export function materialResponsePlan(id: string, spec: AbilityVfxFullSpec, tier: number) {
  const substance = substanceOf(spec);
  const gentle = spec.archetype === 'heal' || spec.archetype === 'buff' || spec.archetype === 'cc';
  const repeated = !!spec.filler || spec.archetype === 'dot' || spec.archetype === 'beam';
  const disabled = tier > 0 || !!SIGNATURE_ABILITIES[id];
  const size = Math.min(1.5, Math.max(0.55, spec.power ?? 1));
  return {
    substance,
    gentle,
    repeated,
    size,
    detail: !disabled,
    fragments: disabled || gentle ? 0 : repeated ? 2 : spec.finisher ? 7 : 4,
    volume: !disabled && !gentle && !repeated && (substance === 'fire' || substance === 'shadow'),
    crest: !disabled && !repeated && substance !== 'earth' && (gentle || spec.finisher === true),
    residue: !disabled && !gentle && !repeated && !!spec.finisher,
  };
}

/** Fill missing impact defaults without flattening authored spell hierarchy.
 * Runtime quality and crowd budgets own shedding, not registry decoration. */
export function refineCatalogueSpec(base: AbilityVfxFullSpec): AbilityVfxFullSpec {
  return {
    ...base,
    impact: {
      ...base.impact,
      light: base.impact?.light ?? 1,
      sparks: base.impact?.sparks ?? 12,
    },
  };
}
