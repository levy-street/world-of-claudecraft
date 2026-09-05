// The one place that decides what text a Realm Builder honour shows as.
//
// A real honouree's name is world data and splices verbatim, like a player
// name. The shipped placeholder is not a name: it is chrome standing in for
// one, so it localizes like the rest of the card. Both the honour-roll card
// (src/ui/realm_builder_popup.ts) and the statue's projected plate
// (src/render/realm_builder_monument_fx.ts) read through here, so the two can
// never disagree about what the unclaimed plate says.

import { isPlaceholderRealmBuilder, type RealmBuilderHonour } from '../sim/content/realm_builders';
import { t } from './i18n';

/** The text to show for `honour`: its name, or the localized placeholder. */
export function displayRealmBuilderName(honour: RealmBuilderHonour): string {
  return isPlaceholderRealmBuilder(honour)
    ? t('hudChrome.realmBuilder.placeholderName')
    : honour.name;
}
