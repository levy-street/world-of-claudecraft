// Pure vertical-extent core for the overhead nameplates: how TALL a plate
// renders, in screen px, given which of its optional rows are showing.
//
// The stacking pass (nameplate_declutter.ts) needs this because plates are
// bottom-anchored (`translate(-50%, -100%)`, see nameplate_projection.ts): a
// plate occupies `[sy - height, sy]`, so the gap two stacked plates need is set
// by the LOWER plate's height, not by one global row constant. A player plate
// carrying a guild tag, a deed title, and a cast bar is roughly twice the height
// of a bare mob plate, and a single fixed offset left the tall ones overlapping.
//
// The numbers below mirror the .np-* rules in src/styles/hud.css (each row's
// content box plus its margins/borders). They are an ESTIMATE on purpose: the
// alternative is reading offsetHeight per plate per frame, which forces a layout
// flush in the hot path. Erring a pixel or two high only spaces the stack
// slightly more generously, it never re-introduces an overlap.
//
// Three/DOM/i18n-free (RENDER_PURE_CORES) and allocation-free: the painter calls
// it for every visible plate every frame, so the rows arrive as positional flags
// rather than an options object that would be per-plate garbage.

/** The always-present name line (name + inline level/badges), .np-name/.np-level. */
export const NAMEPLATE_NAME_ROW_PX = 20;
/** .np-hpbar: 4px bar + 1px top margin. */
export const NAMEPLATE_HP_BAR_ROW_PX = 5;
/** .np-guild: an 11px line under the name. */
export const NAMEPLATE_GUILD_ROW_PX = 13;
/** .np-title: the 10px italic deed-title line. */
export const NAMEPLATE_TITLE_ROW_PX = 12;
/** .np-castbar: 8px bar + 1px borders + 1px top margin. */
export const NAMEPLATE_CAST_BAR_ROW_PX = 11;
/** .np-combo: a 7px pip row + 2px bottom margin. */
export const NAMEPLATE_COMBO_ROW_PX = 9;
/** .np-emote: the 42px overhead emote bubble + 5px bottom margin + borders. */
export const NAMEPLATE_EMOTE_ROW_PX = 51;

/** A bare plate: just the name line. The floor every plate is at least as tall as. */
export const NAMEPLATE_MIN_HEIGHT_PX = NAMEPLATE_NAME_ROW_PX;

/**
 * Estimated rendered height (px) of one nameplate, from the rows it is showing.
 * The name line is always counted; every other row is opt-in.
 */
export function nameplateHeightPx(
  hpBar: boolean,
  guild: boolean,
  title: boolean,
  castBar: boolean,
  combo: boolean,
  emote: boolean,
): number {
  let height = NAMEPLATE_NAME_ROW_PX;
  if (hpBar) height += NAMEPLATE_HP_BAR_ROW_PX;
  if (guild) height += NAMEPLATE_GUILD_ROW_PX;
  if (title) height += NAMEPLATE_TITLE_ROW_PX;
  if (castBar) height += NAMEPLATE_CAST_BAR_ROW_PX;
  if (combo) height += NAMEPLATE_COMBO_ROW_PX;
  if (emote) height += NAMEPLATE_EMOTE_ROW_PX;
  return height;
}
