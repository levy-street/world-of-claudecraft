// Pure vertical-extent core for the overhead nameplates: which rows a plate
// renders and how TALL that makes it, in screen px.
//
// The stacking pass (nameplate_declutter.ts) needs this because plates are
// bottom-anchored (`translate(-50%, -100%)`, see nameplate_projection.ts): a
// plate occupies `[sy - height, sy]`, so the gap two stacked plates need is set
// by the LOWER plate's height, not by one global row constant. A player plate
// carrying a guild tag, a deed title, and a cast bar is roughly twice the height
// of a bare mob plate, and a single fixed offset left the tall ones overlapping.
//
// The numbers below mirror the .np-* rules in src/styles/hud.css, plus the one
// nameplate box declared elsewhere (.np-discord, in index.extra.css), each row's
// border box plus its margins. They are an ESTIMATE on purpose: the alternative
// is reading offsetHeight per plate per frame, which forces a layout flush in the
// hot path. Every constant therefore rounds UP where the CSS varies (the hp bar
// uses the thick boss border, the name line uses the tall level glyph): erring
// high only spaces the stack slightly more generously, while erring low
// re-introduces the overlap this whole pass exists to remove.
// `tests/nameplate_extent_core.test.ts` re-derives each one from both sheets so a
// CSS edit cannot silently invalidate the model.
//
// Three/DOM/i18n-free (RENDER_PURE_CORES) and allocation-free: the painter calls
// this for every visible plate every frame, so rows arrive as a bit mask rather
// than an options object that would be per-plate garbage.

import type { Entity } from '../sim/types';

/** Optional rows, as bits for `nameplateHeightPx`. The name and marker rows are
 *  always counted (see NAMEPLATE_BASE_HEIGHT_PX) and have no bit. */
export const NP_ROW_HP_BAR = 1 << 0;
export const NP_ROW_GUILD = 1 << 1;
export const NP_ROW_TITLE = 1 << 2;
export const NP_ROW_CAST_BAR = 1 << 3;
export const NP_ROW_COMBO = 1 << 4;
export const NP_ROW_EMOTE = 1 << 5;
export const NP_ROW_RAID_MARK = 1 << 6;
export const NP_ROW_MARKER = 1 << 7;

/**
 * .np-name / .np-level: the name line. Sized by the TALLEST thing that shares
 * that inline row, which is not the text: the linked-Discord PFP (.np-discord,
 * 24px plus 1.5px borders) lives in src/styles/index.extra.css, next to the
 * inline holder/dev badges and the 19px level glyph.
 */
export const NAMEPLATE_NAME_ROW_PX = 28;
/**
 * .np-marker: the quest-bang / lootable-coin / elite-diamond slot.
 *
 * This row is the one place the model deliberately measures INK instead of the
 * box. The renderer appends the div unconditionally and the painter only ever
 * writes its text and class, never `display:none`, so the 26px is reserved on
 * EVERY plate, glyph or not. Counting it everywhere spaces a whole crowd apart
 * by an empty band (six plates no longer fit a 390px mobile-landscape viewport),
 * while counting it only when something is actually drawn in or above it
 * (`nameplateRowMask`) keeps plates from ever overlapping visible ink, which is
 * what the stacking pass is for.
 */
export const NAMEPLATE_MARKER_ROW_PX = 26;
/** .np-hpbar: 4px content box, content-box sizing, plus the 2px boss border and 1px top margin. */
export const NAMEPLATE_HP_BAR_ROW_PX = 9;
/** .np-guild: an 11px line under the name. */
export const NAMEPLATE_GUILD_ROW_PX = 13;
/** .np-title: the 10px italic deed-title line. */
export const NAMEPLATE_TITLE_ROW_PX = 12;
/** .np-castbar: 8px content box + 1px borders + 1px top margin. */
export const NAMEPLATE_CAST_BAR_ROW_PX = 11;
/** .np-combo: a 7px pip row + 2px bottom margin. */
export const NAMEPLATE_COMBO_ROW_PX = 9;
/** .np-emote: the 42px overhead emote bubble + 2px borders + 5px bottom margin. */
export const NAMEPLATE_EMOTE_ROW_PX = 51;
/** .np-raidmark: the 30px party marker icon + 1px bottom margin. */
export const NAMEPLATE_RAID_MARK_ROW_PX = 31;

/** The one row every plate pays for: the name line. */
export const NAMEPLATE_BASE_HEIGHT_PX = NAMEPLATE_NAME_ROW_PX;

/** Every optional row at once: the tallest a plate can render. */
export const NAMEPLATE_MAX_HEIGHT_PX =
  NAMEPLATE_BASE_HEIGHT_PX +
  NAMEPLATE_HP_BAR_ROW_PX +
  NAMEPLATE_GUILD_ROW_PX +
  NAMEPLATE_TITLE_ROW_PX +
  NAMEPLATE_CAST_BAR_ROW_PX +
  NAMEPLATE_COMBO_ROW_PX +
  NAMEPLATE_EMOTE_ROW_PX +
  NAMEPLATE_RAID_MARK_ROW_PX +
  NAMEPLATE_MARKER_ROW_PX;

/** Estimated rendered height (px) of one nameplate from its row bit mask. */
export function nameplateHeightPx(rows: number): number {
  let height = NAMEPLATE_BASE_HEIGHT_PX;
  if (rows & NP_ROW_HP_BAR) height += NAMEPLATE_HP_BAR_ROW_PX;
  if (rows & NP_ROW_GUILD) height += NAMEPLATE_GUILD_ROW_PX;
  if (rows & NP_ROW_TITLE) height += NAMEPLATE_TITLE_ROW_PX;
  if (rows & NP_ROW_CAST_BAR) height += NAMEPLATE_CAST_BAR_ROW_PX;
  if (rows & NP_ROW_COMBO) height += NAMEPLATE_COMBO_ROW_PX;
  if (rows & NP_ROW_EMOTE) height += NAMEPLATE_EMOTE_ROW_PX;
  if (rows & NP_ROW_RAID_MARK) height += NAMEPLATE_RAID_MARK_ROW_PX;
  if (rows & NP_ROW_MARKER) height += NAMEPLATE_MARKER_ROW_PX;
  return height;
}

/**
 * Which of the painter's four content branches an entity takes. Extracted here
 * so the row model and the painter's branch chain cannot disagree about what a
 * plate renders: the painter switches on this, and the row mask below reads it.
 */
export type NameplatePlateKind = 'object' | 'player' | 'npc' | 'mob';

export function nameplatePlateKind(e: Entity): NameplatePlateKind {
  if (e.kind === 'object') return 'object';
  if (e.kind === 'player') return 'player';
  // a friendly quest-giving "mob" reads as an NPC plate (name only, no hp bar)
  if (e.kind === 'npc' || (!e.hostile && e.questIds.length > 0)) return 'npc';
  return 'mob';
}

/**
 * The rows `e`'s plate is showing, as a bit mask. `suppressSelf` is the hidden
 * own-plate case (name, hp, guild and title all collapse); the remaining inputs
 * are the painter's per-frame facts the entity does not carry (the plan's combo
 * pips and overhead emote, the party raid marker, the live cast bar) plus the
 * mob template's `elite` flag, which decides the marker glyph.
 */
export function nameplateRowMask(
  e: Entity,
  kind: NameplatePlateKind,
  suppressSelf: boolean,
  castBar: boolean,
  comboPips: number,
  emote: boolean,
  raidMark: boolean,
  elite: boolean,
): number {
  let rows = 0;
  // objects and NPC-style plates never carry an hp bar; dead entities lose theirs
  if (!e.dead && (kind === 'mob' || (kind === 'player' && !suppressSelf))) rows |= NP_ROW_HP_BAR;
  if (kind === 'player' && !suppressSelf) {
    if (e.guild) rows |= NP_ROW_GUILD;
    if (e.title) rows |= NP_ROW_TITLE;
  }
  if (castBar) rows |= NP_ROW_CAST_BAR;
  if (comboPips > 0) rows |= NP_ROW_COMBO;
  if (emote) rows |= NP_ROW_EMOTE;
  if (raidMark) rows |= NP_ROW_RAID_MARK;
  // The marker slot counts when it draws a glyph (an NPC's quest bang or
  // question mark, a lootable corpse's coin, a live elite's diamond) AND
  // whenever a row ABOVE it draws, since the ink then spans the slot anyway.
  const glyph = kind === 'npc' || (kind === 'mob' && (e.lootable || (elite && !e.dead)));
  if (glyph || (rows & (NP_ROW_RAID_MARK | NP_ROW_COMBO | NP_ROW_EMOTE)) !== 0) {
    rows |= NP_ROW_MARKER;
  }
  return rows;
}
