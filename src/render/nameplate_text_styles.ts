// The nameplate canvas's text pens: the font stack and the TextSpriteStyle per
// plate line (name, level, guild, title, marker, cast, emote, the AI and Cheater
// chips) plus the guild colour tiers. Moved out of nameplate_canvas.ts, which
// copies each style into its own mutable instance and draws with it.

import type { TextSpriteStyle } from '../ui/text_sprite_cache';

export const TITLE_FONT = 'Cinzel, Georgia, serif';
export const NAME_STYLE: TextSpriteStyle = {
  font: `700 12px ${TITLE_FONT}`,
  fill: '#fff',
  stroke: '#000',
  lineWidth: 3,
};
export const TARGET_NAME_STYLE: TextSpriteStyle = {
  font: `700 14px ${TITLE_FONT}`,
  fill: '#fff',
  stroke: '#000',
  lineWidth: 3,
};
export const LEVEL_STYLE: TextSpriteStyle = {
  font: `700 19px ${TITLE_FONT}`,
  fill: '#fff',
  stroke: '#000',
  lineWidth: 3,
};
export const AI_STYLE: TextSpriteStyle = {
  font: `700 11px ${TITLE_FONT}`,
  fill: '#7de9c3',
  stroke: '#000',
  lineWidth: 2,
};
// The operator-applied Cheater tag. Same weight and size as the AI chip it sits
// beside so the row's metrics do not change shape, but a hot red rather than the
// AI mint: the two are both operator-set flair and must never read as the same
// thing. Deliberately NOT the hostile-name red (#ff5555), which the same row
// already spends on "this unit will attack you"; the sanction is louder.
export const CHEATER_STYLE: TextSpriteStyle = {
  font: `700 11px ${TITLE_FONT}`,
  fill: '#ff6b6b',
  stroke: '#000',
  lineWidth: 2,
};
export const TITLE_STYLE: TextSpriteStyle = {
  font: `italic 10px ${TITLE_FONT}`,
  fill: '#ffe9a0',
  stroke: '#000',
  lineWidth: 2,
};
export const GUILD_STYLE: TextSpriteStyle = {
  font: `700 11px ${TITLE_FONT}`,
  fill: '#c9dcfb',
  stroke: '#000',
  lineWidth: 2,
};
/** Guild colour tiers (sim/guild_tier.ts): the guild line's fill by the
 *  guild's collective lifetime XP. Index IS the tier; 0 keeps the classic
 *  fill every fresh guild has always had. Cosmetic only. */
export const GUILD_TIER_FILLS: readonly string[] = [
  '#c9dcfb', // 0: the classic guild blue
  '#9fe8a8', // 1: spring green, a few actives
  '#5fd3e8', // 2: cyan, an established roster
  '#e8b45f', // 3: amber, a serious guild
  '#ffcf40', // 4: gold, the realm's elite
];
export const TARGET_GUILD_STYLE: TextSpriteStyle = {
  font: `700 13px ${TITLE_FONT}`,
  fill: '#c9dcfb',
  stroke: '#000',
  lineWidth: 2,
};
export const MARKER_STYLE: TextSpriteStyle = {
  font: `700 24px ${TITLE_FONT}`,
  fill: '#f2c84b',
  stroke: '#000',
  lineWidth: 2,
};
export const CAST_STYLE: TextSpriteStyle = {
  font: '700 9px Arial, sans-serif',
  fill: '#fff',
  stroke: '#000',
  lineWidth: 1,
};
export const EMOTE_STYLE: TextSpriteStyle = {
  font: `800 11px ${TITLE_FONT}`,
  fill: '#ffe9a3',
  stroke: '#000',
  lineWidth: 1,
};
