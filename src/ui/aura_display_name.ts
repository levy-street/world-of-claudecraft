import { graveyardShiftAuraName } from './graveyard_shift_text_core';
import { localizeSimAuraName } from './sim_i18n';
import { localizeTalentTitle } from './talent_i18n';

// Localize an aura/buff name that surfaces by its raw English name (buff frame tooltip,
// combat-log gain/fade, proc self-notes). Most auras are granted by an ability or talent
// and have a localized title already; a few are pure flavor and live in sim_i18n.
export function auraDisplayNameFromSource(name: string): string {
  const viaTitle = localizeTalentTitle(name);
  if (viaTitle !== name) return viaTitle;
  // Graveyard Shift's identity and kit auras last: a name the shared localizer
  // already knows keeps its own key, the kit only fills the gap.
  return localizeSimAuraName(name) ?? graveyardShiftAuraName(name) ?? name;
}

export function auraDisplayNameForHud(name: string, localizedAbilityName: string | null): string {
  return localizeSimAuraName(name) ?? localizedAbilityName ?? auraDisplayNameFromSource(name);
}
