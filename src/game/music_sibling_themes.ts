// The themes composed in sibling modules (music.ts is a monolith ratchet target, so a
// new composition never lands in it): one registry buildMusicThemes() spreads in, with
// each theme's measured loudness trim beside it for THEME_TRIM. A new sibling theme is
// one row in each table here, never a new line in music.ts.

import type { Theme } from './music_notes';
import { composeTownGourdlight } from './music_theme_gourdlight';
import { composeDungeonGravewyrmSanctum } from './music_theme_gravewyrm_sanctum';

/** Every sibling-composed theme, by its MusicZone id. */
export function buildSiblingMusicThemes(): Record<string, Theme> {
  return {
    dungeon_gravewyrm_sanctum: composeDungeonGravewyrmSanctum(),
    town_gourdlight: composeTownGourdlight(),
  };
}

/** Their per-theme loudness trims (the THEME_TRIM measurement: rendered at trim 1,
 *  gated RMS against the Eastbrook town reference, scripts/music_gated_rms.mjs). */
export const SIBLING_THEME_TRIM: Readonly<Record<string, number>> = {
  dungeon_gravewyrm_sanctum: 1.8,
  town_gourdlight: 3.67,
};
