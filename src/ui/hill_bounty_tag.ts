// Single source for the King of the Hill bounty tag (src/sim/pvp/hill_bounty.ts,
// the `hbn` wire bit): the overhead nameplate and the HUD target frame both
// resolve it through here, the cheater_tag.ts reason: two surfaces that render
// one tag must never drift apart. DOM-free and Three-free.
import { formatNumber, type TranslationKey, t } from './i18n';

/** The one catalog key for the tag. A literal so tsc verifies it exists. */
export const HILL_BOUNTY_TAG_KEY: TranslationKey = 'hudChrome.nameplate.hillBountyTag';

/** The narrow entity readout the tag needs. */
export interface HillBountyTagSubject {
  kind: string;
  hillBounty?: number;
}

/** The localized `<Bounty 23>` tag for a PLAYER with a running bounty, ''
 *  for everyone else (a bounty is a player's; a stray bit on a mob brands
 *  nothing). */
export function hillBountyTagLabel(e: HillBountyTagSubject): string {
  if (e.kind !== 'player' || !e.hillBounty || e.hillBounty <= 0) return '';
  const honor = formatNumber(e.hillBounty, { maximumFractionDigits: 0 });
  return `<${t(HILL_BOUNTY_TAG_KEY, { honor })}>`;
}
