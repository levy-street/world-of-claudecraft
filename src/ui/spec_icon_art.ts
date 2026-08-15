// Dedicated painted specialization emblems. Keys are class-qualified because
// ids such as `holy` and `restoration` occur under more than one class.

import type { SpecDef } from '../sim/content/talents';

const SPEC_ICON_DIR = '/ui/specs';

export const SPEC_ART_IDS: ReadonlySet<string> = new Set([
  'warrior/arms',
  'warrior/fury',
  'warrior/prot',
  'paladin/holy',
  'paladin/protection',
  'paladin/retribution',
  'hunter/beast_mastery',
  'hunter/marksmanship',
  'hunter/survival',
  'rogue/assassination',
  'rogue/combat',
  'rogue/subtlety',
  'priest/discipline',
  'priest/holy',
  'priest/shadow',
  'shaman/elemental',
  'shaman/enhancement',
  'shaman/restoration',
  'mage/arcane',
  'mage/fire',
  'mage/frost',
  'warlock/affliction',
  'warlock/demonology',
  'warlock/destruction',
  'druid/balance',
  'druid/feral',
  'druid/restoration',
]);

export function specArtId(spec: Pick<SpecDef, 'class' | 'id'>): string {
  return `${spec.class}/${spec.id}`;
}

/** Static painted art URL for a registered specialization, or null. */
export function specIconUrl(spec: Pick<SpecDef, 'class' | 'id'>): string | null {
  const id = specArtId(spec);
  return SPEC_ART_IDS.has(id) ? `${SPEC_ICON_DIR}/${id}.webp` : null;
}
