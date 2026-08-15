// Craft display names: the ten per-craft hudChrome.craftName.* keys, one per
// craft id on the ring (src/sim/content/professions.ts CRAFT_RING). The single
// shared table behind every surface that names a CRAFT rather than a title:
// char_window's craftNameText (skill rows, hobby line, combo labels, and its
// re-export consumers) and the material_profession_hint_view Used-by tooltip
// line. tests/craft_name_view.test.ts pins the table against CRAFT_RING so a
// new craft cannot leak a raw snake_case id into player-visible text.
//
// DOM/Three-free (registered in tests/architecture.test.ts UI_PURE_CORES).

import { type TranslationKey, t } from './i18n';

/** Craft id -> its display-name key. Every CRAFT_RING id has an entry. */
export const CRAFT_NAME_KEYS: Readonly<Record<string, TranslationKey>> = {
  armorcrafting: 'hudChrome.craftName.armorcrafting',
  weaponcrafting: 'hudChrome.craftName.weaponcrafting',
  jewelcrafting: 'hudChrome.craftName.jewelcrafting',
  alchemy: 'hudChrome.craftName.alchemy',
  engineering: 'hudChrome.craftName.engineering',
  cooking: 'hudChrome.craftName.cooking',
  inscription: 'hudChrome.craftName.inscription',
  enchanting: 'hudChrome.craftName.enchanting',
  tailoring: 'hudChrome.craftName.tailoring',
  leatherworking: 'hudChrome.craftName.leatherworking',
};

/** The display-name key for one craft id, or undefined off the ring. */
export function craftNameKey(craftId: string): TranslationKey | undefined {
  return CRAFT_NAME_KEYS[craftId];
}

/** Localized display name for one craft on the ring, or the shared "none"
 *  copy for null/unrecognized ids. Exported for the crafting window, identity
 *  card, and quest dialog (every surface that names a CRAFT rather than a
 *  title); char_window re-exports it for its historical import sites. */
export function craftNameText(craftId: string | null): string {
  const key = craftId !== null ? CRAFT_NAME_KEYS[craftId] : undefined;
  return t(key ?? 'hudChrome.archetypeTitle.none');
}
