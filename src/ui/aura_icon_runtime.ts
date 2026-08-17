import { auraIconCssBackground, createAuraIconResolver } from './aura_icon_view';
import { crestIconUrl } from './crest_icon_art';
import {
  auraImageUrl,
  cachedProceduralIconDataUrl,
  hasAbilityIconIdentity,
  hasAuraImageIdentity,
  hasAuraRecipe,
  proceduralIconDataUrl,
} from './icons';

/** Shared cached identity resolver for every HUD aura surface. */
export const resolveHudAuraIconId = createAuraIconResolver(
  hasAbilityIconIdentity,
  hasAuraRecipe,
  hasAuraImageIdentity,
);

const HUD_AURA_STATIC_FALLBACK_URL = crestIconUrl('status_combat');
if (!HUD_AURA_STATIC_FALLBACK_URL) throw new Error('Missing painted combat-status crest');

/** Paint an exact static aura above a warmed procedural safety layer. */
export const resolveHudAuraIconUrl = (iconId: string): string =>
  auraIconCssBackground(
    iconId,
    auraImageUrl,
    (id) => cachedProceduralIconDataUrl('aura', id),
    HUD_AURA_STATIC_FALLBACK_URL,
    (id) => proceduralIconDataUrl('aura', id),
  );
