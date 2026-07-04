// Localized display strings for the playable races: the race name and its
// passive racial trait (name + description). The English source lives in the
// i18n catalog (`races.*`, src/ui/i18n.catalog/index.ts) and the effect values
// baked into each description mirror RacialEffects in src/sim/content/races.ts.
// Shared by the character window, the inspect window, and the creation picker.

import type { PlayerRace } from '../sim/types';
import { type TranslationKey, t } from './i18n';

export function raceDisplayName(race: PlayerRace): string {
  return t(`races.${race}` as TranslationKey);
}

export function racialTraitName(race: PlayerRace): string {
  return t(`races.racialName_${race}` as TranslationKey);
}

export function racialTraitDesc(race: PlayerRace): string {
  return t(`races.racialDesc_${race}` as TranslationKey);
}
