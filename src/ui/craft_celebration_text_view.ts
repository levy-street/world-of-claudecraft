// Localized text for crafting's celebration moments: the masterwork toast and
// tier-up toast lines (extracted from Hud.handleCraftCelebrations), the
// masterworkZone chat line (extracted from the hud event arm), and the two
// Masterwrought phase 13 legendary lines (the personal forging line and its
// zone broadcast). The pure-core half of the pure-core + thin-consumer split:
// the hud switch cases and the celebration plan consumer stay one-call thin,
// and every line is unit-testable in Node
// (tests/craft_celebration_text_view.test.ts). Registered in the
// UI_PURE_CORES allowlist (tests/architecture.test.ts).
//
// The chat-line builders return the full log-call bundle (text, color, icon)
// so a hud case cannot recolor one surface's copy of a shared moment: the
// masterwork lines keep epic purple, the legendary lines legendary orange,
// and all ride the masterwork seal glyph until phase 16 ships the orange art.
//
// Player-authored text doctrine (phase 13): the chosen legendary name and the
// owner/crafter names are interpolated VALUES, never keys (the
// feast/makers-mark precedent); the hud log path renders chat text as a text
// node, so no esc() is owed here.
import { ITEMS } from '../sim/data';
import type { CraftCelebrationBanner, CraftTierUp } from './craft_celebration_view';
import { craftNameText } from './craft_name_view';
import { itemDisplayName } from './entity_i18n';
import { formatNumber, t } from './i18n';
import { QUALITY_COLOR } from './icons';
import { MASTERWORK_SEAL_IMAGE_URL } from './profession_art';

/** One chat-line bundle: the Hud.log(text, color, icon) arguments plus the
 *  audio decision. `playCue` is whether THIS line's recipient hears the one
 *  achievement cue: true only for the personal legendary forging line; every
 *  zone broadcast is silent for everyone (the masterworkZone rule), and the
 *  hud switch consumes the flag rather than re-deciding it inline. */
export interface CraftLogLine {
  text: string;
  color: string;
  icon: string;
  playCue: boolean;
}

/** The def's localized display name, or the raw id for one this client cannot
 *  resolve (the masterworkZone arm's historical fallback). */
function itemNameText(itemId: string): string {
  const item = ITEMS[itemId];
  return item ? itemDisplayName(item) : itemId;
}

/** The personal masterwork toast/banner/chat text ("Masterwork! {name}"). */
export function masterworkToastText(itemId: string): string {
  return t('hudChrome.crafting.masterworkToast', { name: itemNameText(itemId) });
}

/** The craft tier-up toast/banner/chat text. */
export function tierUpToastText(up: CraftTierUp): string {
  return t('hudChrome.crafting.tierUpToast', {
    craft: craftNameText(up.craftId),
    tier: formatNumber(up.toTier, { maximumFractionDigits: 0 }),
  });
}

/** The chat-log color of the masterwork and tier-up toast lines (the classic
 *  gold the hud arm carried as a bare literal before the phase 13 QA). */
export const CRAFT_TOAST_LOG_COLOR = '#ffd100';

/** The plan's chat-log lines, in log order: the masterwork toast when the
 *  plan carries one, then every tier-up. The bundle decides the color, so the
 *  hud case cannot recolor one surface's copy of a shared moment (the
 *  CraftLogLine rule, carried onto the two toast lines). */
export function craftToastLogLines(plan: {
  masterworkLogItemId: string | null;
  tierUpLogs: readonly CraftTierUp[];
}): { text: string; color: string }[] {
  const lines: { text: string; color: string }[] = [];
  if (plan.masterworkLogItemId !== null) {
    lines.push({
      text: masterworkToastText(plan.masterworkLogItemId),
      color: CRAFT_TOAST_LOG_COLOR,
    });
  }
  for (const up of plan.tierUpLogs) {
    lines.push({ text: tierUpToastText(up), color: CRAFT_TOAST_LOG_COLOR });
  }
  return lines;
}

/** The one banner slot's text: masterwork outranks tier-up upstream
 *  (buildCraftCelebrationPlan); this only spells the winner. */
export function craftBannerText(banner: CraftCelebrationBanner): string {
  return banner.kind === 'masterwork'
    ? masterworkToastText(banner.itemId)
    : tierUpToastText(banner);
}

/** The banner's decorative icon: the seal for a masterwork, none for a
 *  tier-up (the pre-extraction hud behavior, byte for byte). */
export function craftBannerIcon(banner: CraftCelebrationBanner): string | undefined {
  return banner.kind === 'masterwork' ? MASTERWORK_SEAL_IMAGE_URL : undefined;
}

/** The masterworkZone soft zone-broadcast chat line (no cue for anyone; the
 *  crafter's own cue rides the personal masterwork celebration plan). */
export function masterworkZoneLine(crafterName: string, itemId: string): CraftLogLine {
  return {
    text: t('hudChrome.crafting.masterworkZoneLine', {
      crafter: crafterName,
      name: itemNameText(itemId),
    }),
    color: QUALITY_COLOR.epic,
    icon: MASTERWORK_SEAL_IMAGE_URL,
    playCue: false,
  };
}

/** The personal legendary forging line (Masterwrought phase 13): the base
 *  item reborn under the player-chosen name, and the ONE line whose recipient
 *  hears the achievement cue. */
export function legendaryForgedLine(itemId: string, chosenName: string): CraftLogLine {
  return {
    text: t('hudChrome.crafting.legendaryLine', {
      item: itemNameText(itemId),
      name: chosenName,
    }),
    color: QUALITY_COLOR.legendary,
    icon: MASTERWORK_SEAL_IMAGE_URL,
    playCue: true,
  };
}

/** The legendaryForgedZone soft zone-broadcast chat line (the masterworkZone
 *  idiom): {player} is the owner's character name, {name} the chosen
 *  legendary name off the EVENT (never a def lookup), {item} the base def. */
export function legendaryZoneLine(
  ownerName: string,
  itemId: string,
  chosenName: string,
): CraftLogLine {
  return {
    text: t('hudChrome.crafting.legendaryZoneLine', {
      player: ownerName,
      name: chosenName,
      item: itemNameText(itemId),
    }),
    color: QUALITY_COLOR.legendary,
    icon: MASTERWORK_SEAL_IMAGE_URL,
    playCue: false,
  };
}
