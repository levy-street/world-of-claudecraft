// Single source for the operator-applied Cheater tag's player-visible label
// (the sanction in src/sim/moderation/). The overhead nameplate and the HUD
// target frame both resolve it through here, the same reason discord_role_tag.ts
// exists: two surfaces that render the same tag must never drift apart, and a
// tag that appears on one of them but not the other reads as a client bug rather
// than as a sanction. Completeness across both surfaces is pinned by
// tests/cheater_tag.test.ts.
//
// DOM-free and Three-free: it takes a plain readout of the entity and returns a
// localized string, so a Vitest can exercise every arm without a canvas, a HUD,
// or a world.
import { type TranslationKey, t } from './i18n';

/** The one catalog key for the tag. A literal so tsc verifies it exists. */
export const CHEATER_TAG_KEY: TranslationKey = 'hudChrome.nameplate.cheaterTag';

/** The narrow entity readout the tag decision needs. */
export interface CheaterTagSubject {
  kind: string;
  cheaterMark?: boolean;
}

/**
 * The localized `< Cheater >` tag for a marked PLAYER, '' for everyone else.
 *
 * Player-gated on purpose. The mark is an ACCOUNT sanction, so only a player
 * entity can wear one; gating here means a regressed or hostile server that set
 * `chm` on a wolf brands nothing, rather than putting a moderation verdict over
 * a mob's head where no operator could ever lift it.
 */
export function cheaterTagLabel(subject: CheaterTagSubject | null | undefined): string {
  if (subject?.kind !== 'player' || subject.cheaterMark !== true) return '';
  return t(CHEATER_TAG_KEY);
}
