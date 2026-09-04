// The desktop side-menu buttons: which micro button opens which keybind action
// and which i18n key names it, plus the one repaint that syncs their keycaps
// and aria labels to the current bindings. Extracted from hud.ts's
// refreshKeybindLabels so the table is data the menu domain owns and the HUD
// stays a thin caller. Cold path: runs on init, rebind, and language switch,
// never per frame (the action-bar keycaps have their own per-frame painter).

import { keyCapLabel } from '../../../game/keybinds';
import { type TranslationKey, t } from '../../i18n';

export const SIDE_BUTTONS: readonly [selector: string, action: string, labelKey: TranslationKey][] =
  [
    ['#mm-char', 'char', 'hud.keybinds.actions.char'],
    ['#mm-spell', 'spellbook', 'abilityUi.spellbook.title'],
    ['#mm-talents', 'talents', 'game.talents.title'],
    ['#mm-quest', 'questlog', 'questUi.log.title'],
    ['#mm-deeds', 'deeds', 'hudChrome.deeds.title'],
    ['#mm-reliquary', 'reliquary', 'hudChrome.reliquary.title'],
    ['#mm-cosmetics', 'cosmetics', 'hudChrome.cosmetics.title'],
    ['#mm-professions', 'professions', 'hudChrome.professions.title'],
    ['#mm-map', 'map', 'hud.core.mobileMap'],
    ['#mm-bag', 'bags', 'itemUi.bags.title'],
    ['#mm-crafting', 'crafting', 'hudChrome.crafting.title'],
    ['#mm-arena', 'arena', 'hudChrome.pvp.launcherTitle'],
    ['#mm-dfinder', 'dungeonFinder', 'hudChrome.finder.title'],
    ['#mm-leaderboard', 'leaderboard', 'game.leaderboard.title'],
    ['#mm-emote', 'emoteWheel', 'hudChrome.emoteWheel.label'],
    ['#mm-social', 'social', 'hud.social.friendsTab'],
    ['#mm-discord', 'discord', 'hudChrome.discord.title'],
  ];

/** Repaint every side-menu button's keycap + aria label from the live bindings. */
export function refreshSideButtonLabels(
  doc: { querySelector<T extends Element>(selector: string): T | null },
  primaryLabel: (action: string) => string,
): void {
  for (const [selector, action, labelKey] of SIDE_BUTTONS) {
    const btn = doc.querySelector<HTMLElement>(selector);
    if (!btn) continue;
    const key = primaryLabel(action);
    const label = t(labelKey);
    const keyEl = btn.querySelector<HTMLElement>('.keybind');
    if (keyEl) keyEl.textContent = keyCapLabel(key);
    btn.setAttribute('aria-label', key ? `${label} (${key})` : label);
  }
}
