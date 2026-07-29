// Canvas-2D painter for the OVERWORLD minimap (the ~10Hz circular minimap at #minimap).
//
// The imperative half of the pure-core + painter split: the pure marker model lives in
// minimap_markers.ts (createMinimapMarkers, unit-tested there); this module turns that
// discriminated Marker union into actual canvas draws. The IN-DELVE branch is owned by
// delve_map_painter.ts; Hud picks the branch with minimapMode and routes only the
// overworld branch here, so the two painters never duplicate each other's drawing.
//
// CADENCE (preserved from the inline site): Hud calls paintOverworld from update()'s
// `fastHud` band (>= 100ms, ~10Hz), blitting the Hud-owned cached terrain background
// each redraw. This painter does not change that call site or cadence; it only owns the
// draw. (graphics tiering may lower the 10Hz cadence; kept here.)
//
// WRITE-ELISION BOUNDARY: the minimap is Canvas-2D and a 2D context
// cannot be elided, so the canvas draws are NOT routed through the write-elision facet.
// The ONLY DOM write the painter makes is the '#zone-label' text, which IS routed
// through the facet's setText.
//
// NO-MAGIC-VALUES (canvas sub-rule): a 2D context cannot read CSS vars, so
// the painter resolves the `--color-minimap-*` tokens via getComputedStyle and caches
// them on the instance (never per-marker, and now never per-redraw: the tokens are static
// `:root` design tokens, src/styles/tokens.css, with no runtime mutation, so one resolve
// serves every redraw). Every other literal (canvas size, base scale, clip inset, marker
// radii, rect size, outline width, the NPC glyph font + offsets, the arrow geometry) is a
// named constant.

import { BG_HALF_X, BG_HALF_Z, bgFieldPlanWalls } from '../sim/battleground_layout';
import {
  bgOriginAt,
  isBgPos,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_X,
  yumiMazeOriginAt,
} from '../sim/data';
import { yumiMazeLayout } from '../sim/yumi_maze_layout';
import type { IWorld } from '../world_api';
import { paintBgFieldAtlas } from './bg_field_relief_core';
import { drawBgAtlasMarks } from './hud/battleground';
import { createMinimapMarkers, type MinimapMarker, type NpcGlyph } from './minimap_markers';
import type { PainterHostWriters } from './painter_host';

// The fixed circular minimap surface (the #minimap canvas is 162x162). Exported so Hud
// uses one source of truth for both the overworld paint and the delve delegation.
export const MINIMAP_SIZE = 162;
// Historical base world scale (px per yard at zoom 1); the zoom multiplier shrinks the
// world radius shown so markers spread out as you zoom in.
const MINIMAP_BASE_SCALE = 1.7;
// The circular clip radius is (size / 2 - CLIP_INSET).
const CLIP_INSET = 2;

// Marker draw dimensions (byte-faithful to the inline overworld branch).
const ALLY_DOT_RADIUS = 3;
const PORTAL_DOT_RADIUS = 3.5;
const MARKER_RECT_SIZE = 3; // loot / mob square side
const MARKER_RECT_HALF = MARKER_RECT_SIZE / 2;
const MARKER_OUTLINE_WIDTH = 1.5; // ally / party disc / party arrow outline
const PIP_RADIUS_RATIO = 0.35; // inner pip radius = max(PIP_MIN, disc radius * ratio)
const PIP_MIN_RADIUS = 1;
// The player facing arrow at the centre. The inline site did not set a line width
// before this stroke (it inherited whatever a prior marker last left, almost always the
// canvas default 1, since a nearby friend/guild disc is the only unsaved setter and is
// rare), so this names the default explicitly: deterministic and pixel-identical in the
// common case where no online ally is adjacent.
const PLAYER_ARROW_OUTLINE_WIDTH = 1;
// Gather node dot (issue 1124): ready draws slightly larger + outlined so it reads as
// "actionable" against the dimmer, outline-less cooldown dot.
const GATHER_NODE_READY_RADIUS = 3;
const GATHER_NODE_COOLDOWN_RADIUS = 2;
// How far the lock strike's diagonal overshoots the node disc on each side,
// so the line reads as a strike THROUGH the dot rather than a chord inside
// it, at both disc radii.
const LOCK_STRIKE_OVERREACH = 1.5;
// Crafting station: an outlined diamond (rotated-square silhouette) so it reads
// apart from the round gather dots and the axis-aligned loot/mob squares at
// minimap scale. Half-diagonal in px.
const STATION_DIAMOND_RADIUS = 3;

// Party / player arrow triangle geometry (canvas-local, drawn under a rotation).
const PARTY_ARROW_TIP_X = 6;
const PARTY_ARROW_BACK_X = -4;
const PARTY_ARROW_HALF_Y = 4.5;
const PLAYER_ARROW_TIP_Y = -7;
const PLAYER_ARROW_HALF_X = 4.5;
const PLAYER_ARROW_BASE_Y = 5.5;

// NPC quest glyph typography (the glyph set drawn at `'bold 11px Georgia'` on the
// inline site's mx - 2, my + 3 anchor, with the default textAlign/textBaseline).
//
// The glyphs draw from a tiny per-(glyph, color) sprite cache, never a per-marker
// fillText. Measured in Chrome at 17 iterations per redraw against a dirty style tree
// (the crowded-town case: ~80 nameplate transform writes land in the same frame):
// bare `ctx.font` assignments 0.033ms, fillText with the font already set 0.037ms,
// measureText alone 0.0368ms, drawImage 0.0062ms. On a quiet page all four are equal.
// EVERY canvas text entry point (the font setter, fillText, measureText) re-resolves
// font state against the document, so the cost tracks how dirty the style tree is,
// NOT the font string and NOT the marker count: hoisting `ctx.font` above the loop
// measures no better than leaving it inside it (0.0385 vs 0.036), and only leaving
// the text API altogether is a fix. drawImage is flat.
//
// Corollary worth keeping in view when reading a profile: NPC glyph markers come only
// from `e.kind === 'npc'` (minimap_markers.ts), so a player crowd adds circles and
// arrows but never glyphs. The town's quest givers are on the minimap at zero players;
// the crowd is the multiplier via the nameplate DOM, not the source of the glyphs.
//
// The sprite draws the glyph ONCE at the same font, then each redraw is a plain blit.
// The sprite records where its internal fillText origin sits, and the blit subtracts
// that origin so the glyph lands on the same anchor the inline
// `fillText(glyph, mx - 2, my + 3)` used, rounded to a whole pixel (the drawMarkers
// 'npc' case has the why: the rounding is load-bearing, not cosmetic).
const NPC_GLYPH_FONT = 'bold 11px Georgia';
const NPC_GLYPH_OFFSET_X = 2;
const NPC_GLYPH_OFFSET_Y = 3;
// Sprite geometry: the fillText origin inside the sprite canvas. 11px Georgia bold
// ascends at most ~11px above the alphabetic baseline and the glyph set ('?', '!',
// '•') has no descenders, so a 16x16 canvas with the baseline at y=12 and the left
// edge at x=2 contains every glyph with margin (verified in Georgia and under the
// serif/sans fallbacks Android and most Linux resolve instead).
// COUPLED TO NPC_GLYPH_FONT: the box is sized from that font's ascent, and a sprite
// too small CLIPS rather than fails. Re-measure these three if the font size changes;
// the test pins the exact font string so a change has to come through here.
const NPC_GLYPH_SPRITE_SIZE = 16;
const NPC_GLYPH_SPRITE_ORIGIN_X = 2;
const NPC_GLYPH_SPRITE_BASELINE_Y = 12;
// The cooldown variant's dim: the repeat-blue '!' blitted at this globalAlpha
// (a work order inside its cadence window, marked where the NPC previously
// showed nothing). Applied at drawImage time so the sprite cache stays at one
// raster per (glyph, color); matches .np-marker.cooldown's opacity so the
// nameplate and minimap dim identically.
const NPC_GLYPH_COOLDOWN_ALPHA = 0.55;

// Corpse marker (ghost run): a compact procedural skull, drawn from canvas
// primitives (cranium + jaw in the corpse color, eye sockets and a nasal notch
// punched in the outline color) so it reads as a skull at minimap scale without
// shipping a text/emoji glyph. Centered on the marker point.
const CORPSE_SKULL_CRANIUM_R = 4;
const CORPSE_SKULL_JAW_HALF = 2.5;
const CORPSE_SKULL_EYE_R = 1.1;

const FULL_CIRCLE = Math.PI * 2;

// Protect Yumi maze background: the fixed competitive layout rasterized ONCE
// to an offscreen canvas (the delve-map bg-cache technique) and sub-rect
// blitted under the ordinary overworld marker set. Walls draw in the resolved
// --color-minimap-outline token at a fixed alpha; the margin pads the shell so
// the blit window never samples outside the cache.
const MAZE_BG_PX_PER_YARD = 3;
const MAZE_BG_MARGIN_YD = 24;
const MAZE_BG_WALL_ALPHA = 0.75;

// Thornhollow Fields battleground background: the same cached-raster technique over
// bgFieldPlanWalls() (every REAL box collider of the authored Thornhollow
// field, so the minimap shows exactly what blocks movement) laid over the
// field's ATLAS GROUND. The ground is what makes the raster carry information
// away from the keeps: Thornhollow's walls are concentrated in the two
// fortresses, so a walls-only sheet leaves the whole flag run, the flank ridges
// and the Fightpit blank.
//
// It is the SAME atlas plate the M-key map draws (see
// hud/battleground/battleground_map_painter.ts), built from the same two shared
// modules so the two surfaces can never describe two different fields:
// bg_field_relief_core.paintBgFieldAtlas writes the ground (the authored paint
// as base color with the two graveyard plots as their own surface family,
// hypsometric tinting, fbm mottle, contour banding, inked surface edges,
// northwest hillshade), then battleground_atlas_marks_painter bakes the crowns,
// the boulder and rubble stipples and the graveyard headstones over it.
// Deliberately NOT baked: the plate's LANDMARK LABELS. At this scale a name is
// a few pixels tall, and the raster is blitted as a player-centered sub-rect, so
// baked text would smear across the window instead of sitting on its landmark.
// The M-map is where the field is read by name.
//
// The field is 240x452yd, so this raster does NOT reuse the maze's constants:
// one square pad off the long half-extent at 3px/yd would be 1500x1500 (2.25M
// px, over twice the old field's 984x984 sheet). A PER-AXIS pad at 2.5px/yd is
// 720x1250 (900k px), under the old sheet, and 1:1 or finer at the two lower
// zoom presets (1.7 and 2.55px/yd); the two closest presets magnify it, which
// is the trade taken for a sheet that stays under the old one on a field three
// times the size.
const BG_FIELD_PX_PER_YARD = 2.5;
const BG_FIELD_PAD_X_YD = BG_HALF_X + MAZE_BG_MARGIN_YD;
const BG_FIELD_PAD_Z_YD = BG_HALF_Z + MAZE_BG_MARGIN_YD;
// Walls sit on painted ground rather than on bare canvas, so they carry a touch
// more weight than the maze's stubs do. Raised from 0.85 with the atlas ground:
// the old hypsometric wash was a pale sand (luma about 180) and the atlas paints
// the same lanes as turf and worn dirt (luma about 130), so an unchanged alpha
// would have handed the one ACTIONABLE layer on this raster less separation than
// it had before. Walls are cover; the ground under them is decoration.
const BG_FIELD_WALL_ALPHA = 0.95;

// Draw the corpse skull centered at (x, y): `fill` paints the bone, `socket` the
// dark eye/nose hollows so the shape reads even over light terrain.
function drawCorpseSkull(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  fill: string,
  socket: string,
): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y - 1, CORPSE_SKULL_CRANIUM_R, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.fillRect(x - CORPSE_SKULL_JAW_HALF, y + 1.5, CORPSE_SKULL_JAW_HALF * 2, 3);
  ctx.fillStyle = socket;
  ctx.beginPath();
  ctx.arc(x - 1.7, y - 1, CORPSE_SKULL_EYE_R, 0, FULL_CIRCLE);
  ctx.arc(x + 1.7, y - 1, CORPSE_SKULL_EYE_R, 0, FULL_CIRCLE);
  ctx.fill();
  // nasal notch + a tooth gap so the jaw does not read as a solid block
  ctx.fillRect(x - 0.4, y + 1.5, 0.8, 3);
}

// The `--color-minimap-*` design tokens the painter resolves once and caches (they are
// static; see resolveColors). These mirror the colors the inline overworld minimap used
// verbatim. Exported so the suite pins EVERY entry against tokens.css: a token missing
// there freezes as '' for the whole session once resolveColors caches (the glyph then
// draws default black on every redraw), and a hand-copied test list cannot see a new
// entry it was never told about.
export const MINIMAP_COLOR_TOKENS = {
  allyFriend: '--color-minimap-ally-friend',
  allyGuild: '--color-minimap-ally-guild',
  npcQuest: '--color-minimap-npc-quest',
  npcQuestRepeat: '--color-minimap-npc-quest-repeat',
  portal: '--color-minimap-portal',
  objectLoot: '--color-minimap-object-loot',
  mobAggro: '--color-minimap-mob-aggro',
  mob: '--color-minimap-mob',
  mobLoot: '--color-minimap-mob-loot',
  corpse: '--color-minimap-corpse',
  partyDead: '--color-minimap-party-dead',
  partyPip: '--color-minimap-party-pip',
  player: '--color-minimap-player',
  outline: '--color-minimap-outline',
  gatherReady: '--color-minimap-gather-ready',
  gatherCooldown: '--color-minimap-gather-cooldown',
  gatherLocked: '--color-minimap-node-locked',
  station: '--color-minimap-station',
} as const;

/** The resolved minimap marker colors for one redraw. */
export type MinimapColors = Record<keyof typeof MINIMAP_COLOR_TOKENS, string>;

/**
 * The current zone's cached high-res map background (the 480px per-zone canvas
 * the world map already renders), plus the world rect it covers. Blitting this
 * sharp over the coarse whole-world fallback gives the minimap ~10x the source
 * resolution around the player instead of upscaling ~12 pixels of the 140px
 * world image. Null when the zone's bg has not been prewarmed yet.
 */
export type MinimapZoneBg = {
  canvas: HTMLCanvasElement;
  region: { minX: number; maxX: number; minZ: number; maxZ: number };
};

/**
 * Owns painting the overworld minimap onto the #minimap canvas. One instance is built
 * by Hud with the write-elision facet (for the '#zone-label' text), the class-color
 * resolver (for party discs/arrows), and the zone-name localizer.
 */
export class MinimapPainter {
  private readonly markers = createMinimapMarkers();
  // The resolved `--color-minimap-*` tokens, cached after the first successful resolve.
  // They are static `:root` tokens (src/styles/tokens.css) with no runtime mutation (no
  // setProperty, no theme / forced-colors / media-query redefinition), so re-reading them
  // via getComputedStyle on every ~10Hz redraw was wasted work and risked a synchronous
  // style recalc (the minimap redraws after other HUD style writes in the same frame). If
  // a runtime theme / contrast toggle is ever added, invalidate this cache from that signal.
  private colors: MinimapColors | null = null;
  // The Protect Yumi maze wall cache (built on first in-maze redraw; the fixed
  // competitive layout never changes, so one raster serves the session).
  private mazeBg: HTMLCanvasElement | null = null;
  // The Thornhollow Fields cache, relief plus wall plan (same lifecycle as mazeBg:
  // the authored field never changes, so one raster serves the session).
  private battlegroundBg: HTMLCanvasElement | null = null;
  // NPC glyph sprites (see the NPC_GLYPH_* header), keyed color -> glyph. Nested rather
  // than one map on a `${glyph}|${color}` composite so the per-marker lookup in the draw
  // loop allocates NO key string. Bounded without eviction by construction: NpcGlyph is a
  // closed three-member union and resolveColors freezes TWO glyph colors for the session
  // (the gold npcQuest and the repeat blue), so the live map holds at most six sprites of
  // 16x16 each (the cooldown variant dims the repeat sprite at blit time, no extra raster).
  private readonly glyphSprites = new Map<string, Map<NpcGlyph, HTMLCanvasElement>>();

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly classColor: (cls: string) => string,
    private readonly localizeZone: (zoneId: string) => string,
    private readonly localizeRift: (name: string, rank: string | null) => string,
    /** The battleground's own name. The band sits far off the overworld plane,
     *  so localizeZone would resolve it to whatever zone its coordinates happen
     *  to land nearest, which reads as the last town the player stood in. */
    private readonly battlegroundName: () => string,
  ) {}

  /** Resolve the minimap color tokens in one getComputedStyle pass (a 2D
   *  context can only read a CSS var this way; never per-marker), then cache them: the
   *  tokens are static, so subsequent redraws reuse the cached values. */
  private resolveColors(): MinimapColors {
    if (this.colors) return this.colors;
    const cs = getComputedStyle(document.documentElement);
    const read = (token: string): string => cs.getPropertyValue(token).trim();
    const colors = {} as MinimapColors;
    for (const key of Object.keys(MINIMAP_COLOR_TOKENS) as (keyof typeof MINIMAP_COLOR_TOKENS)[]) {
      colors[key] = read(MINIMAP_COLOR_TOKENS[key]);
    }
    // Cache only once the tokens actually resolved: a redraw before the stylesheet is
    // applied would read '' and must not be frozen (it self-heals on the next redraw).
    if (colors.player) this.colors = colors;
    return colors;
  }

  /**
   * Overworld minimap render: blit the cached terrain background under the player, then
   * draw the marker union over it, with the '#zone-label' text routed through the
   * write-elision facet. Caller passes the minimap ctx, the world, the '#zone-label'
   * element, the Hud-owned cached terrain canvas, and the current minimap zoom.
   */
  paintOverworld(
    ctx: CanvasRenderingContext2D,
    world: IWorld,
    zoneLabelEl: HTMLElement,
    bg: HTMLCanvasElement,
    zoom: number,
    zoneBg: MinimapZoneBg | null = null,
  ): void {
    // One token resolve serves both branches below (cached; static tokens).
    const colors = this.resolveColors();
    // Thornhollow Fields battleground band: Hud routes the 'battleground' minimap mode
    // through this overworld entry (the mode falls through its delve/yumi
    // branches), so branch to the field raster here instead of blitting the
    // far-off overworld terrain cache the band sits outside of.
    if (isBgPos(world.player.pos.x)) {
      this.paintBattleground(ctx, world, zoneLabelEl, zoom, colors);
      return;
    }
    const S = MINIMAP_SIZE;
    const pxPerYard = MINIMAP_BASE_SCALE * zoom;
    const model = this.markers.build(world, S, pxPerYard);
    // The one DOM write this Canvas painter routes through the write-elision facet.
    // In a rift, show the generated floor name + rank instead of the overworld zone.
    if (model.rift) {
      this.writers.setText(zoneLabelEl, this.localizeRift(model.rift.name, model.rift.rank));
    } else {
      this.writers.setText(zoneLabelEl, this.localizeZone(model.zoneId));
    }
    const p = world.player;

    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - CLIP_INSET, 0, FULL_CIRCLE);
    ctx.clip();
    // Smooth sampling: the coarse fallback reads as a soft wash (not hard
    // blocks), and the sharp zone overlay upscales cleanly.
    ctx.imageSmoothingEnabled = true;

    // Coarse fallback: the sub-rect of the whole-world background under the
    // player (Hud-owned, +X-left). Covers the border case where the player's
    // view spills into a neighbouring zone the overlay does not.
    const bgPxPerYard = bg.width / (WORLD_MAX_X - WORLD_MIN_X);
    const sw = S / (pxPerYard / bgPxPerYard);
    const sx = (WORLD_MAX_X - p.pos.x) * bgPxPerYard - sw / 2;
    const sy = (WORLD_MAX_Z - p.pos.z) * bgPxPerYard - sw / 2;
    ctx.drawImage(bg, sx, sy, sw, sw, 0, 0, S, S);

    // Sharp overlay: the current zone's own high-res background, placed by its
    // world rect so the player sits at centre. +X is map-left, +Z is map-up
    // (R61: maxZ lands at the bitmap top).
    if (zoneBg) {
      const r = zoneBg.region;
      const half = S / 2;
      const destX = half - (r.maxX - p.pos.x) * pxPerYard;
      const destY = half - (r.maxZ - p.pos.z) * pxPerYard;
      const destW = (r.maxX - r.minX) * pxPerYard;
      const destH = (r.maxZ - r.minZ) * pxPerYard;
      ctx.drawImage(zoneBg.canvas, destX, destY, destW, destH);
    }

    this.drawMarkers(ctx, model.markers, colors);
    ctx.restore();
  }

  /**
   * Protect Yumi maze render: the ordinary overworld marker set (party discs,
   * the cats as mob dots; enemy players are deliberately NOT modeled) over a
   * cached raster of the fixed maze walls. `label` is the localized strip
   * title Hud passes (the maze band has no zone).
   */
  paintYumiMaze(
    ctx: CanvasRenderingContext2D,
    world: IWorld,
    zoneLabelEl: HTMLElement,
    zoom: number,
    label: string,
  ): void {
    const S = MINIMAP_SIZE;
    const pxPerYard = MINIMAP_BASE_SCALE * zoom;
    const model = this.markers.build(world, S, pxPerYard);
    this.writers.setText(zoneLabelEl, label);
    const colors = this.resolveColors();
    const p = world.player;
    const o = yumiMazeOriginAt(p.pos.z);
    const bg = this.ensureMazeBg(colors);
    const layout = yumiMazeLayout();
    const pad = layout.halfExtent + MAZE_BG_MARGIN_YD;

    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - CLIP_INSET, 0, FULL_CIRCLE);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    // Sub-rect blit centered on the player's maze-local position (+X map-left,
    // matching the marker projection).
    const sw = S / (pxPerYard / MAZE_BG_PX_PER_YARD);
    const sx = (pad - (p.pos.x - o.x)) * MAZE_BG_PX_PER_YARD - sw / 2;
    const sy = (p.pos.z - o.z + pad) * MAZE_BG_PX_PER_YARD - sw / 2;
    ctx.drawImage(bg, sx, sy, sw, sw, 0, 0, S, S);
    this.drawMarkers(ctx, model.markers, colors);
    ctx.restore();
  }

  // Rasterize the fixed maze layout once: every wall stub + shell slab as a
  // rect in the outline token (mirrored on x like the live projection).
  private ensureMazeBg(colors: MinimapColors): HTMLCanvasElement {
    if (this.mazeBg) return this.mazeBg;
    const layout = yumiMazeLayout();
    const pad = layout.halfExtent + MAZE_BG_MARGIN_YD;
    const s = MAZE_BG_PX_PER_YARD;
    const side = Math.ceil(pad * 2 * s);
    const canvas = document.createElement('canvas');
    canvas.width = side;
    canvas.height = side;
    const bctx = canvas.getContext('2d');
    if (!bctx) return canvas;
    bctx.globalAlpha = MAZE_BG_WALL_ALPHA;
    bctx.fillStyle = colors.outline;
    for (const wall of [...layout.shell, ...layout.walls]) {
      bctx.fillRect(
        (pad - wall.x - wall.hw) * s,
        (wall.z - wall.hd + pad) * s,
        wall.hw * 2 * s,
        wall.hd * 2 * s,
      );
    }
    this.mazeBg = canvas;
    return canvas;
  }

  /**
   * Thornhollow Fields battleground render: the ordinary overworld marker set (party
   * discs, players, mob dots) over a cached raster of the Thornhollow field's
   * relief and wall plan (the paintYumiMaze technique). The '#zone-label' keeps
   * the localized committed zone (the arena-band precedent; the band has no
   * dedicated zone entry).
   */
  paintBattleground(
    ctx: CanvasRenderingContext2D,
    world: IWorld,
    zoneLabelEl: HTMLElement,
    zoom: number,
    colors: MinimapColors,
  ): void {
    const S = MINIMAP_SIZE;
    const pxPerYard = MINIMAP_BASE_SCALE * zoom;
    const model = this.markers.build(world, S, pxPerYard);
    this.writers.setText(zoneLabelEl, this.battlegroundName());
    const p = world.player;
    const o = bgOriginAt(p.pos.z);
    const bg = this.ensureBattlegroundBg(colors);

    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - CLIP_INSET, 0, FULL_CIRCLE);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    // Sub-rect blit centered on the player's field-local position. BOTH axes
    // follow the marker projection (+X map-left, +Z map-UP), which is also what
    // the overworld terrain blit above does: the raster is built with the same
    // two negations, so a wall north of you draws above you.
    const s = BG_FIELD_PX_PER_YARD;
    const sw = S / (pxPerYard / s);
    const sx = (BG_FIELD_PAD_X_YD - (p.pos.x - o.x)) * s - sw / 2;
    const sy = (BG_FIELD_PAD_Z_YD - (p.pos.z - o.z)) * s - sw / 2;
    ctx.drawImage(bg, sx, sy, sw, sw, 0, 0, S, S);
    this.drawMarkers(ctx, model.markers, colors);
    ctx.restore();
  }

  // Rasterize the fixed Thornhollow field ONCE and hold it for the session, in
  // three layers, each drawn in the live projection's axes (+X map-left,
  // +Z map-up) so the sub-rect blit in paintBattleground stays a plain blit:
  //   1. the atlas ground, written straight into an ImageData by the shared pure
  //      core (authored ground paint, the two graveyard plots as their own
  //      surface family, hypsometric tint, mottle, contours, inked surface
  //      edges, northwest hillshade). It is sampled terrain, not chrome, which
  //      is why it is the one thing here that is not a token,
  //   2. the atlas marks (tree crowns, boulder and rubble stipples, graveyard
  //      headstones) through the shared mark painter the M-map plate uses,
  //   3. the field's real wall plan over both, in the outline token.
  // No landmark labels (see the header): illegible at 2.5px/yd and smeared by
  // the player-centered blit.
  //
  // The ground and the marks cost a one-time build of tens of ms on the first
  // battleground paint, an order of magnitude more than the flat wash they
  // replaced. That is paid ONCE per session for a raster the redraw only blits,
  // so it buys no per-frame cost at all; paintBattleground is still blit plus
  // markers.
  //
  // Tier-identical: walls are actionable cover, so no preset or governor gates
  // any of this (the graphics-settings fairness invariant). The ground and the
  // marks are cosmetic and are drawn for everyone for the same reason: a knob
  // that shed them would still have to leave the walls exactly as they are.
  private ensureBattlegroundBg(colors: MinimapColors): HTMLCanvasElement {
    if (this.battlegroundBg) return this.battlegroundBg;
    const s = BG_FIELD_PX_PER_YARD;
    const w = Math.ceil(BG_FIELD_PAD_X_YD * 2 * s);
    const h = Math.ceil(BG_FIELD_PAD_Z_YD * 2 * s);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const bctx = canvas.getContext('2d');
    if (!bctx) return canvas;
    const ground = bctx.createImageData(w, h);
    // axis +1: the minimap is drawn in WORLD orientation and never turned for a
    // team, so both teams are handed the identical raster, lit from the
    // screen's northwest (the M-map is the surface that owns the turned view).
    paintBgFieldAtlas(ground.data, w, h, s, BG_FIELD_PAD_X_YD, BG_FIELD_PAD_Z_YD, 1);
    bctx.putImageData(ground, 0, 0);
    drawBgAtlasMarks(bctx, {
      fx: (x: number) => (BG_FIELD_PAD_X_YD - x) * s,
      fy: (z: number) => (BG_FIELD_PAD_Z_YD - z) * s,
      s,
    });
    // Walls last, so cover always reads over the ground and the marks. They keep
    // the resolved outline token rather than the M-map's slate fill plus cast
    // shadow and ink: that treatment is drawn at several times this scale, where
    // a 1.6px cast and a 0.7px ink line are a fraction of a wall, while here a
    // curtain is about 2px of raster and the cast alone would be most of it. The
    // token also tracks the HUD's own contrast (theme, forced-colors), which a
    // fixed slate literal cannot.
    bctx.globalAlpha = BG_FIELD_WALL_ALPHA;
    bctx.fillStyle = colors.outline;
    // Thornhollow's walls are placed structures, not axis-aligned segments, so
    // each box is stroked under its own yaw. Canvas y grows downward while the
    // raster negates both field axes, which is a 180 degree rotation: it
    // preserves the rectangle but reverses the sense of the angle, hence -rot.
    for (const wall of bgFieldPlanWalls()) {
      bctx.save();
      bctx.translate((BG_FIELD_PAD_X_YD - wall.x) * s, (BG_FIELD_PAD_Z_YD - wall.z) * s);
      bctx.rotate(-wall.rot);
      bctx.fillRect(-wall.hw * s, -wall.hd * s, wall.hw * 2 * s, wall.hd * 2 * s);
      bctx.restore();
    }
    this.battlegroundBg = canvas;
    return canvas;
  }

  // Rasterize (once) and return the sprite for an NPC quest glyph in `color`; the
  // per-redraw draw is then a plain drawImage. Keyed on the resolved color as well as the
  // glyph so a future theme/contrast cache bust naturally re-rasterizes.
  private npcGlyphSprite(glyph: NpcGlyph, color: string): HTMLCanvasElement {
    let byGlyph = this.glyphSprites.get(color);
    const cached = byGlyph?.get(glyph);
    if (cached) return cached;
    const sprite = document.createElement('canvas');
    sprite.width = NPC_GLYPH_SPRITE_SIZE;
    sprite.height = NPC_GLYPH_SPRITE_SIZE;
    const sctx = sprite.getContext('2d');
    // A transient context failure must not be frozen: caching the blank canvas would hide
    // every NPC glyph for the rest of the session. Returning it uncached makes this
    // redraw's draw a no-op and self-heals on the next one.
    if (!sctx) return sprite;
    sctx.fillStyle = color;
    sctx.font = NPC_GLYPH_FONT;
    sctx.fillText(glyph, NPC_GLYPH_SPRITE_ORIGIN_X, NPC_GLYPH_SPRITE_BASELINE_Y);
    // Same rule as resolveColors, for the same reason: a redraw before the stylesheet
    // applies resolves '' for every token, and '' is an invalid fillStyle the canvas
    // ignores, so the glyph rasterizes in the default black. Draw it this redraw (exactly
    // what the inline fillText did on that frame) but never freeze it.
    if (color) {
      if (!byGlyph) {
        byGlyph = new Map();
        this.glyphSprites.set(color, byGlyph);
      }
      byGlyph.set(glyph, sprite);
    }
    return sprite;
  }

  private drawMarkers(
    ctx: CanvasRenderingContext2D,
    markers: readonly MinimapMarker[],
    colors: MinimapColors,
  ): void {
    for (const m of markers) {
      switch (m.kind) {
        case 'ally':
          ctx.fillStyle = m.ally === 'friend' ? colors.allyFriend : colors.allyGuild;
          ctx.strokeStyle = colors.outline;
          ctx.lineWidth = MARKER_OUTLINE_WIDTH;
          ctx.beginPath();
          ctx.arc(m.mx, m.my, ALLY_DOT_RADIUS, 0, FULL_CIRCLE);
          ctx.fill();
          ctx.stroke();
          break;
        case 'npc': {
          // Blit the cached glyph sprite so its internal fillText origin lands on the
          // inline site's (mx - 2, my + 3) anchor.
          //
          // ROUNDED, and that is load-bearing rather than cosmetic. mx/my are continuous
          // floats (minimap_markers.ts projects `half + dx`), so the destination is
          // fractional nearly always, and a fractional drawImage destination is RESAMPLED.
          // Measured in Chrome across sub-pixel phases 0.2 to 0.8, blitting this 16x16
          // sprite: fractional with imageSmoothingEnabled OFF stays crisp (35 ink pixels,
          // 5 fully-solid, at every phase) but fractional with smoothing ON collapses to
          // 53 ink and ZERO fully-solid, i.e. mush. So the unrounded blit was legible only
          // because of the `imageSmoothingEnabled = false` the two paint entry points set
          // for the terrain background blit, several lines away and for another reason
          // entirely, with nothing pinning that relationship. Rounded, both settings give
          // the identical 35/5 at every phase, so legibility stops depending on it. No
          // measurable cost.
          //
          // The tradeoff, deliberately taken: the glyph now snaps to whole pixels where
          // fillText advanced it in quarter-pixel steps. At the minimap's 1.7 px/yard base
          // scale that is a sub-pixel marker shift on a surface that redraws at 10Hz.
          //
          // Color by the folded marker state: gold for ready/available and the
          // neutral dot, the repeat token for a completed repeatable, and the
          // repeat token dimmed for a work order inside its cadence window.
          const repeatColored = m.marker === 'repeat' || m.marker === 'cooldown';
          // Restore the PRIOR alpha, not a literal 1: nothing else dims this
          // context today, but a literal would hardcode that caller state.
          const priorAlpha = ctx.globalAlpha;
          if (m.marker === 'cooldown') ctx.globalAlpha = NPC_GLYPH_COOLDOWN_ALPHA;
          ctx.drawImage(
            this.npcGlyphSprite(m.glyph, repeatColored ? colors.npcQuestRepeat : colors.npcQuest),
            Math.round(m.mx - NPC_GLYPH_OFFSET_X - NPC_GLYPH_SPRITE_ORIGIN_X),
            Math.round(m.my + NPC_GLYPH_OFFSET_Y - NPC_GLYPH_SPRITE_BASELINE_Y),
          );
          if (m.marker === 'cooldown') ctx.globalAlpha = priorAlpha;
          break;
        }
        case 'portal':
          ctx.fillStyle = colors.portal;
          ctx.beginPath();
          ctx.arc(m.mx, m.my, PORTAL_DOT_RADIUS, 0, FULL_CIRCLE);
          ctx.fill();
          break;
        case 'object-loot':
          ctx.fillStyle = colors.objectLoot;
          ctx.fillRect(
            m.mx - MARKER_RECT_HALF,
            m.my - MARKER_RECT_HALF,
            MARKER_RECT_SIZE,
            MARKER_RECT_SIZE,
          );
          break;
        case 'mob':
          ctx.fillStyle = m.aggro ? colors.mobAggro : colors.mob;
          ctx.fillRect(
            m.mx - MARKER_RECT_HALF,
            m.my - MARKER_RECT_HALF,
            MARKER_RECT_SIZE,
            MARKER_RECT_SIZE,
          );
          break;
        case 'mob-loot':
          ctx.fillStyle = colors.mobLoot;
          ctx.fillRect(
            m.mx - MARKER_RECT_HALF,
            m.my - MARKER_RECT_HALF,
            MARKER_RECT_SIZE,
            MARKER_RECT_SIZE,
          );
          break;
        case 'corpse':
          // The local player's body during a ghost run: a procedural skull.
          drawCorpseSkull(ctx, m.mx, m.my, colors.corpse, colors.outline);
          break;
        case 'party-disc': {
          ctx.fillStyle = m.dead ? colors.partyDead : this.classColor(m.cls);
          ctx.strokeStyle = colors.outline;
          ctx.lineWidth = MARKER_OUTLINE_WIDTH;
          ctx.beginPath();
          ctx.arc(m.mx, m.my, m.radius, 0, FULL_CIRCLE);
          ctx.fill();
          ctx.stroke();
          if (m.pip) {
            // bright inner pip so members pop against terrain.
            ctx.fillStyle = colors.partyPip;
            ctx.beginPath();
            ctx.arc(
              m.mx,
              m.my,
              Math.max(PIP_MIN_RADIUS, m.radius * PIP_RADIUS_RATIO),
              0,
              FULL_CIRCLE,
            );
            ctx.fill();
          }
          break;
        }
        case 'party-arrow':
          ctx.save();
          ctx.translate(m.mx, m.my);
          ctx.rotate(m.angle);
          ctx.fillStyle = m.dead ? colors.partyDead : this.classColor(m.cls);
          ctx.strokeStyle = colors.outline;
          ctx.lineWidth = MARKER_OUTLINE_WIDTH;
          ctx.beginPath();
          ctx.moveTo(PARTY_ARROW_TIP_X, 0);
          ctx.lineTo(PARTY_ARROW_BACK_X, PARTY_ARROW_HALF_Y);
          ctx.lineTo(PARTY_ARROW_BACK_X, -PARTY_ARROW_HALF_Y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          break;
        case 'player':
          ctx.save();
          ctx.translate(m.mx, m.my);
          ctx.rotate(m.angle); // canvas rotates clockwise; facing increases turning left
          ctx.fillStyle = colors.player;
          ctx.strokeStyle = colors.outline;
          ctx.lineWidth = PLAYER_ARROW_OUTLINE_WIDTH;
          ctx.beginPath();
          ctx.moveTo(0, PLAYER_ARROW_TIP_Y);
          ctx.lineTo(PLAYER_ARROW_HALF_X, PLAYER_ARROW_BASE_Y);
          ctx.lineTo(-PLAYER_ARROW_HALF_X, PLAYER_ARROW_BASE_Y);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          break;
        case 'station':
          // Tier-identical (fairness invariant): no preset or governor gating.
          ctx.fillStyle = colors.station;
          ctx.strokeStyle = colors.outline;
          ctx.lineWidth = MARKER_OUTLINE_WIDTH;
          ctx.beginPath();
          ctx.moveTo(m.mx, m.my - STATION_DIAMOND_RADIUS);
          ctx.lineTo(m.mx + STATION_DIAMOND_RADIUS, m.my);
          ctx.lineTo(m.mx, m.my + STATION_DIAMOND_RADIUS);
          ctx.lineTo(m.mx - STATION_DIAMOND_RADIUS, m.my);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          break;
        case 'gather-node': {
          // Tool-tier lock (Professions 2.0) composes with the
          // respawn state: a locked node keeps the ready/cooldown silhouette
          // (radius + outline) but the locked tint replaces the state color,
          // so both dimensions stay readable at once. Actionable info on
          // every graphics tier (fairness invariant: never preset-gated).
          const radius = m.ready ? GATHER_NODE_READY_RADIUS : GATHER_NODE_COOLDOWN_RADIUS;
          if (m.ready) {
            ctx.fillStyle = m.locked ? colors.gatherLocked : colors.gatherReady;
            ctx.strokeStyle = colors.outline;
            ctx.lineWidth = MARKER_OUTLINE_WIDTH;
            ctx.beginPath();
            ctx.arc(m.mx, m.my, radius, 0, FULL_CIRCLE);
            ctx.fill();
            ctx.stroke();
          } else {
            ctx.fillStyle = m.locked ? colors.gatherLocked : colors.gatherCooldown;
            ctx.beginPath();
            ctx.arc(m.mx, m.my, radius, 0, FULL_CIRCLE);
            ctx.fill();
          }
          // The non-hue lock cue (the UX pass, DESIGN.md color independence:
          // every state pairs color with a second signal): a locked node
          // carries a diagonal strike through its disc on BOTH respawn
          // silhouettes, so the lock never rides tint alone. Outline-colored,
          // so it reads on either fill at every marker size.
          if (m.locked) {
            const reach = radius + LOCK_STRIKE_OVERREACH;
            ctx.strokeStyle = colors.outline;
            ctx.lineWidth = MARKER_OUTLINE_WIDTH;
            ctx.beginPath();
            ctx.moveTo(m.mx - reach, m.my + reach);
            ctx.lineTo(m.mx + reach, m.my - reach);
            ctx.stroke();
          }
          break;
        }
      }
    }
  }
}
