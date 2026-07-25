// Painted art for the HUD's PRIMARY DESTINATIONS: the side-rail launchers, the mobile
// bottom bar, and the mobile "More" tray. One 128px WebP per icon under
// public/ui/chrome/<name>.webp, normalized by scripts/convert_chrome_icons_webp.mjs
// (`npm run assets:chrome`).
//
// Why a second source for icons that already have a glyph in ui_icons.ts: DESIGN.md
// section 6 splits the icon system by ROLE, not by file. Painted art with a recognizable
// silhouette is the standard for primary destinations (launcher tiles, the store chest,
// window headers); the monochrome `currentColor` glyphs are "the only sanctioned thin-line
// icons" and "serve secondary controls (close, collapse, zoom, filters, settings), never
// primary destinations". So every name here keeps its ui_icons.ts glyph, which stays the
// source for the small inline uses (a `svgIcon('arena')` beside dialog text tints with the
// surrounding color, where painted art would not), and gains art for the launchers.
//
// Deliberately NOT in this set:
//   - secondary controls: close, prev, next, more, menu, music, swap, nameplates, vibrate,
//     lock, mail, trash, meters, whisper, check, skull, jump, autorun;
//   - the mobile action ring (attack, interact, target): gameplay controls, not destinations;
//   - every brand mark (discord, twitch, x, kick, youtube): reproduced for identification,
//     so they are never repainted;
//   - `market`, which reads as a destination but has no launcher: its only surface is the
//     `svgIcon('market')` row inside the quest dialog, where the glyph tints with the row.
// Art for a name with no `[data-icon]` placeholder would never render, so the guard test
// requires every id here to be reachable from index.html / play.html.
//
// The list is a plain literal Set with no DOM or fs at runtime, mirroring
// deed_image_ids.ts. tests/chrome_icons.test.ts gates it against the committed .webp files
// in both directions and against the UiIconName union, so a dropped file, an unwired id, or
// a typo reds the suite.

import type { UiIconName } from './ui_icons';

const CHROME_ICON_DIR = '/ui/chrome';

export const CHROME_ART_IDS: ReadonlySet<UiIconName> = new Set<UiIconName>([
  'arena',
  'bags',
  'ball',
  'book',
  'cards',
  'character',
  'chest',
  'crafting',
  'dfinder',
  'donate',
  'emote',
  'leaderboard',
  'map',
  'professions',
  'questlog',
  'social',
  'spellbook',
  'talents',
]);

/** True when `name` ships painted launcher art (and so is a primary destination). */
export function hasChromeIconArt(name: string): name is UiIconName {
  return CHROME_ART_IDS.has(name as UiIconName);
}

/** Static URL of a chrome icon's painted art, or null when the name ships no art. */
export function chromeIconUrl(name: string): string | null {
  return hasChromeIconArt(name) ? `${CHROME_ICON_DIR}/${name}.webp` : null;
}
