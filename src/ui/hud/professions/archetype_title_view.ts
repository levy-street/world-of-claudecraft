// Shared profession title labels. Importing a label must not initialize the
// character window and its portrait renderer/asset loaders.

import { type TranslationKey, t } from '../../i18n';

// The ten pair-archetype title keys (issue 1130, pair-named under Professions
// 2.0), one per canonical pair id (see src/sim/professions/archetype.ts
// ARCHETYPE_PAIR_TARGETS and getArchetypeTitle: the title identifier IS the
// pair id). Every player-visible string is a t() key, so this is a literal
// id-to-key table, never a built string.
const ARCHETYPE_PAIR_TITLE_KEYS: Record<string, TranslationKey> = {
  'engineering+alchemy': 'hudChrome.archetypePair.engineering+alchemy',
  'alchemy+cooking': 'hudChrome.archetypePair.alchemy+cooking',
  'cooking+leatherworking': 'hudChrome.archetypePair.cooking+leatherworking',
  'leatherworking+tailoring': 'hudChrome.archetypePair.leatherworking+tailoring',
  'tailoring+inscription': 'hudChrome.archetypePair.tailoring+inscription',
  'inscription+enchanting': 'hudChrome.archetypePair.inscription+enchanting',
  'enchanting+jewelcrafting': 'hudChrome.archetypePair.enchanting+jewelcrafting',
  'jewelcrafting+weaponcrafting': 'hudChrome.archetypePair.jewelcrafting+weaponcrafting',
  'weaponcrafting+armorcrafting': 'hudChrome.archetypePair.weaponcrafting+armorcrafting',
  'armorcrafting+engineering': 'hudChrome.archetypePair.armorcrafting+engineering',
};

/** Localized text for the granted pair-archetype title (the input is the
 *  canonical pair id from IWorld `archetypeTitle`), or the "no title yet" copy
 *  when the player has not completed the zone-1 acceptance quest (or the id is
 *  somehow unrecognized). Exported for the view-model test. */
export function archetypeTitleText(pairId: string | null): string {
  const key = pairId !== null ? ARCHETYPE_PAIR_TITLE_KEYS[pairId] : undefined;
  return t(key ?? 'hudChrome.archetypeTitle.none');
}
