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

import { WORLD_MAX_X, WORLD_MAX_Z, WORLD_MIN_X } from '../sim/data';
import type { IWorld } from '../world_api';
import { createMinimapMarkers, type MinimapMarker } from './minimap_markers';
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

// Party / player arrow triangle geometry (canvas-local, drawn under a rotation).
const PARTY_ARROW_TIP_X = 6;
const PARTY_ARROW_BACK_X = -4;
const PARTY_ARROW_HALF_Y = 4.5;
const PLAYER_ARROW_TIP_Y = -7;
const PLAYER_ARROW_HALF_X = 4.5;
const PLAYER_ARROW_BASE_Y = 5.5;

// NPC quest glyph typography (byte-faithful to `'bold 11px Georgia'` + the inline
// fillText offset mx - 2, my + 3, drawn with the default textAlign/textBaseline).
const NPC_GLYPH_FONT = 'bold 11px Georgia';
const NPC_GLYPH_OFFSET_X = 2;
const NPC_GLYPH_OFFSET_Y = 3;

// Corpse marker (ghost run): a compact procedural skull, drawn from canvas
// primitives (cranium + jaw in the corpse color, eye sockets and a nasal notch
// punched in the outline color) so it reads as a skull at minimap scale without
// shipping a text/emoji glyph. Centered on the marker point.
const CORPSE_SKULL_CRANIUM_R = 4;
const CORPSE_SKULL_JAW_HALF = 2.5;
const CORPSE_SKULL_EYE_R = 1.1;

const FULL_CIRCLE = Math.PI * 2;

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
// verbatim.
const MINIMAP_COLOR_TOKENS = {
  allyFriend: '--color-minimap-ally-friend',
  allyGuild: '--color-minimap-ally-guild',
  npcQuest: '--color-minimap-npc-quest',
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
} as const;

/** The resolved minimap marker colors for one redraw. */
export type MinimapColors = Record<keyof typeof MINIMAP_COLOR_TOKENS, string>;

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

  constructor(
    private readonly writers: PainterHostWriters,
    private readonly classColor: (cls: string) => string,
    private readonly localizeZone: (zoneId: string) => string,
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
  ): void {
    const S = MINIMAP_SIZE;
    const pxPerYard = MINIMAP_BASE_SCALE * zoom;
    const model = this.markers.build(world, S, pxPerYard);
    // The one DOM write this Canvas painter routes through the write-elision facet.
    this.writers.setText(zoneLabelEl, this.localizeZone(model.zoneId));
    const colors = this.resolveColors();
    const p = world.player;

    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - CLIP_INSET, 0, FULL_CIRCLE);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;

    // Blit the matching sub-rect of the cached terrain background (Hud-owned, +X-left).
    const bgPxPerYard = bg.width / (WORLD_MAX_X - WORLD_MIN_X);
    const sw = S / (pxPerYard / bgPxPerYard);
    const sx = (WORLD_MAX_X - p.pos.x) * bgPxPerYard - sw / 2;
    const sy = (WORLD_MAX_Z - p.pos.z) * bgPxPerYard - sw / 2;
    ctx.drawImage(bg, sx, sy, sw, sw, 0, 0, S, S);

    this.drawMarkers(ctx, model.markers, colors);
    ctx.restore();
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
        case 'npc':
          ctx.fillStyle = colors.npcQuest;
          ctx.font = NPC_GLYPH_FONT;
          ctx.fillText(m.glyph, m.mx - NPC_GLYPH_OFFSET_X, m.my + NPC_GLYPH_OFFSET_Y);
          break;
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
      }
    }
  }
}
