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
import {
  EMPTY_MAP_MARKER_ART,
  gatherMarkerArtId,
  MAP_MARKER_SIZES,
  type MapMarkerArt,
  mapMarkerSizeForSemantic,
  questMarkerArtId,
  semanticMapMarkerArt,
  stationMarkerArtId,
} from './map_marker_icon_art';
import type { MapMarkerProfile } from './map_marker_profile_core';
import {
  createMinimapMarkers,
  MINIMAP_CLIP_INSET,
  type MinimapMarker,
  type MinimapObjectSemantic,
} from './minimap_markers';
import type { PainterHostWriters } from './painter_host';

// The fixed circular minimap surface (the #minimap canvas is 162x162). Exported so Hud
// uses one source of truth for both the overworld paint and the delve delegation.
export const MINIMAP_SIZE = 162;
// Historical base world scale (px per yard at zoom 1); the zoom multiplier shrinks the
// world radius shown so markers spread out as you zoom in.
const MINIMAP_BASE_SCALE = 1.7;
// The circular clip radius is (size / 2 - CLIP_INSET).

// Marker draw dimensions. The tiny procedural family uses silhouette plus color:
// it remains readable in grayscale and against noisy terrain at actual minimap size.
const ALLY_DOT_RADIUS = 3;
const ALLY_GUILD_DIAMOND_RADIUS = 3.5;
const PORTAL_DOT_RADIUS = 3.5;
const PORTAL_CORE_RADIUS = 1.25;
const PORTAL_EXIT_TIP = 4;
const PORTAL_EXIT_WING = 3.5;
const PORTAL_EXIT_STEM_HALF = 1.5;
const PORTAL_EXIT_STEM_LENGTH = 3.5;
const MARKER_OUTLINE_WIDTH = 1.5; // ally / party disc / party arrow outline
const DYNAMIC_MARKER_OUTLINE_WIDTH = 1.25;
const OBJECT_LOOT_SPARK_RADIUS = 4;
const OBJECT_LOOT_SPARK_SHOULDER = 1;
const MOB_DOT_RADIUS = 2.25;
const MOB_AGGRO_DIAMOND_RADIUS = 3.5;
const MOB_LOOT_SIZE = 5;
const MOB_LOOT_CORE_SIZE = 1.5;
const PIP_RADIUS_RATIO = 0.35; // inner pip radius = max(PIP_MIN, disc radius * ratio)
const PIP_MIN_RADIUS = 1;
const PARTY_DEAD_CROSS_RATIO = 0.55;
const PARTY_DEAD_ARROW_CROSS_HALF = 2.5;
const PARTY_DEAD_CROSS_WIDTH = 1.25;
// The player facing arrow at the centre. The inline site did not set a line width
// before this stroke (it inherited whatever a prior marker last left, almost always the
// canvas default 1, since a nearby friend/guild disc is the only unsaved setter and is
// rare), so this names the default explicitly: deterministic and pixel-identical in the
// common case where no online ally is adjacent.
const PLAYER_ARROW_OUTLINE_WIDTH = 1;
// Gathering fallbacks preserve the painted state grammar during first-frame
// loading or a decode failure. The normal path is one exact-size cached blit.
const GATHER_FALLBACK_READY_RADIUS_RATIO = 0.28;
const GATHER_FALLBACK_COOLDOWN_RADIUS_RATIO = 0.22;
const GATHER_FALLBACK_ARC_EDGE_INSET = 3;
const GATHER_FALLBACK_ARC_DARK_WIDTH = 3;
const GATHER_FALLBACK_ARC_LIGHT_WIDTH = 1.5;
const GATHER_FALLBACK_ARC_START = (Math.PI * 5) / 12;
const GATHER_FALLBACK_ARC_END = GATHER_FALLBACK_ARC_START + (Math.PI * 5) / 3;
const GATHER_FALLBACK_LOCK_WIDTH_RATIO = 0.34;
const GATHER_FALLBACK_LOCK_MIN_WIDTH = 6;
const GATHER_FALLBACK_LOCK_HEIGHT_RATIO = 0.58;
const GATHER_FALLBACK_LOCK_MIN_HEIGHT = 4;
const GATHER_FALLBACK_LOCK_EDGE_INSET = 2;
const GATHER_FALLBACK_LOCK_SHACKLE_RATIO = 0.28;
const GATHER_FALLBACK_LOCK_SHACKLE_DARK_WIDTH = 3;
const GATHER_FALLBACK_LOCK_SHACKLE_TOP_WIDTH = 1.4;
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

// Generated quest paintings own actionable identity. These primitives are the
// allocation-free first-frame/error fallback: neutral is a quiet hollow ring;
// offer/turn-in/repeat/cooldown retain distinct punctuation and silhouettes
// without touching the expensive canvas text API.
const QUEST_NEUTRAL_RADIUS = 3;
const QUEST_FALLBACK_OUTLINE_WIDTH = 3;
const QUEST_FALLBACK_INK_WIDTH = 1.25;
const QUEST_FALLBACK_HALF = 4;
const QUEST_FALLBACK_DOT_RADIUS = 1.1;
// Semantic world-object fallbacks use this one profile-scaled base radius.
// Silhouette is identity; an interior mark carries state independently of hue.
const SEMANTIC_OBJECT_RADIUS_RATIO = 1.8;
const SEMANTIC_OBJECT_CORE_RATIO = 0.34;
const SEMANTIC_OBJECT_BADGE_RATIO = 0.24;
const SEMANTIC_OBJECT_PIP_SIZE_RATIO = 0.22;
const SEMANTIC_OBJECT_PIP_GAP_RATIO = 0.12;

const STANDARD_MARKER_PROFILE = (): MapMarkerProfile => 'standard';

// Corpse marker (ghost run): a compact procedural skull, drawn from canvas
// primitives (cranium + jaw in the corpse color, eye sockets and a nasal notch
// punched in the outline color) so it reads as a skull at minimap scale without
// shipping a text/emoji glyph. Centered on the marker point.
const CORPSE_SKULL_CRANIUM_R = 4;
const CORPSE_SKULL_JAW_HALF = 2.5;
const CORPSE_SKULL_EYE_R = 1.1;

interface MinimapPaintGeometry {
  readonly allyDotRadius: number;
  readonly allyGuildDiamondRadius: number;
  readonly portalDotRadius: number;
  readonly portalCoreRadius: number;
  readonly portalExitTip: number;
  readonly portalExitWing: number;
  readonly portalExitStemHalf: number;
  readonly portalExitStemLength: number;
  readonly markerOutlineWidth: number;
  readonly dynamicOutlineWidth: number;
  readonly objectLootSparkRadius: number;
  readonly objectLootSparkShoulder: number;
  readonly mobDotRadius: number;
  readonly mobAggroDiamondRadius: number;
  readonly mobLootSize: number;
  readonly mobLootCoreSize: number;
  readonly pipMinRadius: number;
  readonly partyDiscScale: number;
  readonly partyDeadCrossWidth: number;
  readonly partyDeadArrowCrossHalf: number;
  readonly partyArrowTipX: number;
  readonly partyArrowBackX: number;
  readonly partyArrowHalfY: number;
  readonly playerArrowTipY: number;
  readonly playerArrowHalfX: number;
  readonly playerArrowBaseY: number;
  readonly playerArrowOutlineWidth: number;
  readonly stationDiamondRadius: number;
  readonly neutralNpcRadius: number;
  readonly neutralNpcOutlineWidth: number;
  readonly neutralNpcInkWidth: number;
  readonly corpseCraniumRadius: number;
  readonly corpseJawHalf: number;
  readonly corpseEyeRadius: number;
  readonly gatherFallbackScale: number;
}

/** Frozen backing-space geometry selected once before each marker loop. Compact
 * touch HUDs later scale the whole canvas down, so these larger primitives
 * preserve physical legibility without runtime canvas scaling or allocation. */
const MINIMAP_PAINT_GEOMETRY = Object.freeze({
  standard: Object.freeze({
    allyDotRadius: ALLY_DOT_RADIUS,
    allyGuildDiamondRadius: ALLY_GUILD_DIAMOND_RADIUS,
    portalDotRadius: PORTAL_DOT_RADIUS,
    portalCoreRadius: PORTAL_CORE_RADIUS,
    portalExitTip: PORTAL_EXIT_TIP,
    portalExitWing: PORTAL_EXIT_WING,
    portalExitStemHalf: PORTAL_EXIT_STEM_HALF,
    portalExitStemLength: PORTAL_EXIT_STEM_LENGTH,
    markerOutlineWidth: MARKER_OUTLINE_WIDTH,
    dynamicOutlineWidth: DYNAMIC_MARKER_OUTLINE_WIDTH,
    objectLootSparkRadius: OBJECT_LOOT_SPARK_RADIUS,
    objectLootSparkShoulder: OBJECT_LOOT_SPARK_SHOULDER,
    mobDotRadius: MOB_DOT_RADIUS,
    mobAggroDiamondRadius: MOB_AGGRO_DIAMOND_RADIUS,
    mobLootSize: MOB_LOOT_SIZE,
    mobLootCoreSize: MOB_LOOT_CORE_SIZE,
    pipMinRadius: PIP_MIN_RADIUS,
    partyDiscScale: 1,
    partyDeadCrossWidth: PARTY_DEAD_CROSS_WIDTH,
    partyDeadArrowCrossHalf: PARTY_DEAD_ARROW_CROSS_HALF,
    partyArrowTipX: PARTY_ARROW_TIP_X,
    partyArrowBackX: PARTY_ARROW_BACK_X,
    partyArrowHalfY: PARTY_ARROW_HALF_Y,
    playerArrowTipY: PLAYER_ARROW_TIP_Y,
    playerArrowHalfX: PLAYER_ARROW_HALF_X,
    playerArrowBaseY: PLAYER_ARROW_BASE_Y,
    playerArrowOutlineWidth: PLAYER_ARROW_OUTLINE_WIDTH,
    stationDiamondRadius: STATION_DIAMOND_RADIUS,
    neutralNpcRadius: QUEST_NEUTRAL_RADIUS,
    neutralNpcOutlineWidth: QUEST_FALLBACK_OUTLINE_WIDTH,
    neutralNpcInkWidth: QUEST_FALLBACK_INK_WIDTH,
    corpseCraniumRadius: CORPSE_SKULL_CRANIUM_R,
    corpseJawHalf: CORPSE_SKULL_JAW_HALF,
    corpseEyeRadius: CORPSE_SKULL_EYE_R,
    gatherFallbackScale: 1,
  }),
  compact: Object.freeze({
    allyDotRadius: ALLY_DOT_RADIUS * 1.5,
    allyGuildDiamondRadius: ALLY_GUILD_DIAMOND_RADIUS * 1.5,
    portalDotRadius: PORTAL_DOT_RADIUS * 1.5,
    portalCoreRadius: PORTAL_CORE_RADIUS * 1.5,
    portalExitTip: PORTAL_EXIT_TIP * 1.5,
    portalExitWing: PORTAL_EXIT_WING * 1.5,
    portalExitStemHalf: PORTAL_EXIT_STEM_HALF * 1.5,
    portalExitStemLength: PORTAL_EXIT_STEM_LENGTH * 1.5,
    markerOutlineWidth: 2,
    dynamicOutlineWidth: 1.75,
    objectLootSparkRadius: OBJECT_LOOT_SPARK_RADIUS * 1.5,
    objectLootSparkShoulder: OBJECT_LOOT_SPARK_SHOULDER * 1.5,
    mobDotRadius: MOB_DOT_RADIUS * 1.5,
    mobAggroDiamondRadius: MOB_AGGRO_DIAMOND_RADIUS * 1.5,
    mobLootSize: MOB_LOOT_SIZE * 1.5,
    mobLootCoreSize: MOB_LOOT_CORE_SIZE * 1.5,
    pipMinRadius: PIP_MIN_RADIUS * 1.5,
    partyDiscScale: 1.45,
    partyDeadCrossWidth: 1.75,
    partyDeadArrowCrossHalf: PARTY_DEAD_ARROW_CROSS_HALF * 1.5,
    partyArrowTipX: PARTY_ARROW_TIP_X * 1.5,
    partyArrowBackX: PARTY_ARROW_BACK_X * 1.5,
    partyArrowHalfY: PARTY_ARROW_HALF_Y * 1.5,
    playerArrowTipY: PLAYER_ARROW_TIP_Y * 1.5,
    playerArrowHalfX: PLAYER_ARROW_HALF_X * 1.5,
    playerArrowBaseY: PLAYER_ARROW_BASE_Y * 1.5,
    playerArrowOutlineWidth: 1.5,
    stationDiamondRadius: STATION_DIAMOND_RADIUS * 1.5,
    neutralNpcRadius: QUEST_NEUTRAL_RADIUS * 1.5,
    neutralNpcOutlineWidth: 4,
    neutralNpcInkWidth: 1.75,
    corpseCraniumRadius: CORPSE_SKULL_CRANIUM_R * 1.5,
    corpseJawHalf: CORPSE_SKULL_JAW_HALF * 1.5,
    corpseEyeRadius: CORPSE_SKULL_EYE_R * 1.5,
    gatherFallbackScale: 1.4,
  }),
} as const satisfies Readonly<Record<MapMarkerProfile, Readonly<MinimapPaintGeometry>>>);

const FULL_CIRCLE = Math.PI * 2;

/** Begin a closed diamond without allocating a Path2D or point array. */
function beginDiamond(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x + radius, y);
  ctx.lineTo(x, y + radius);
  ctx.lineTo(x - radius, y);
  ctx.closePath();
}

/** Begin a four-ray loot sparkle with broad shoulders that survive downsampling. */
function beginLootSpark(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  shoulder: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x, y - radius);
  ctx.lineTo(x + shoulder, y - shoulder);
  ctx.lineTo(x + radius, y);
  ctx.lineTo(x + shoulder, y + shoulder);
  ctx.lineTo(x, y + radius);
  ctx.lineTo(x - shoulder, y + shoulder);
  ctx.lineTo(x - radius, y);
  ctx.lineTo(x - shoulder, y - shoulder);
  ctx.closePath();
}

/** Draw the non-color dead-state cue over a party marker. */
function drawDeadCross(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  half: number,
  outline: string,
  lineWidth: number,
): void {
  ctx.strokeStyle = outline;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(x - half, y - half);
  ctx.lineTo(x + half, y + half);
  ctx.moveTo(x + half, y - half);
  ctx.lineTo(x - half, y + half);
  ctx.stroke();
}

function drawSemanticCross(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  half: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x - half, y - half);
  ctx.lineTo(x + half, y + half);
  ctx.moveTo(x + half, y - half);
  ctx.lineTo(x - half, y + half);
  ctx.stroke();
}

function drawSemanticCheck(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x - radius * 0.5, y);
  ctx.lineTo(x - radius * 0.12, y + radius * 0.4);
  ctx.lineTo(x + radius * 0.55, y - radius * 0.45);
  ctx.stroke();
}

function drawSemanticLock(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  outline: string,
): void {
  const half = radius * SEMANTIC_OBJECT_CORE_RATIO;
  ctx.strokeStyle = outline;
  ctx.beginPath();
  ctx.arc(x, y - half * 0.45, half, Math.PI, FULL_CIRCLE);
  ctx.stroke();
  ctx.fillStyle = outline;
  ctx.fillRect(x - half, y - half * 0.05, half * 2, half * 1.45);
}

function semanticRankPips(rank: 'C' | 'B' | 'A' | 'S' | null): number {
  switch (rank) {
    case 'C':
      return 1;
    case 'B':
      return 2;
    case 'A':
      return 3;
    case 'S':
      return 4;
    case null:
      return 0;
  }
}

function drawSemanticRankPips(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  rank: 'C' | 'B' | 'A' | 'S' | null,
  ink: string,
): void {
  const count = semanticRankPips(rank);
  if (count === 0) return;
  const size = Math.max(1, radius * SEMANTIC_OBJECT_PIP_SIZE_RATIO);
  const gap = radius * SEMANTIC_OBJECT_PIP_GAP_RATIO;
  const width = count * size + (count - 1) * gap;
  let px = x - width / 2;
  ctx.fillStyle = ink;
  for (let i = 0; i < count; i++) {
    ctx.fillRect(px, y + radius * 0.58, size, size);
    px += size + gap;
  }
}

/** Generated-art loading/error fallback for entity-free overworld routes. */
function drawStableNavigationFallback(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  navigation: Extract<MinimapMarker, { kind: 'stable-navigation' }>['navigation'],
  colors: MinimapColors,
  geometry: MinimapPaintGeometry,
): void {
  const radius = geometry.stationDiamondRadius * SEMANTIC_OBJECT_RADIUS_RATIO;
  const core = radius * SEMANTIC_OBJECT_CORE_RATIO;
  ctx.fillStyle = colors.portal;
  ctx.strokeStyle = colors.outline;
  ctx.lineWidth = geometry.markerOutlineWidth;
  ctx.beginPath();
  if (navigation === 'delve-entrance') {
    ctx.arc(x, y, radius, Math.PI, FULL_CIRCLE);
    ctx.lineTo(x + radius, y + radius);
    ctx.lineTo(x - radius, y + radius);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = colors.outline;
    ctx.fillRect(x - core, y, core * 2, radius);
    return;
  }
  ctx.moveTo(x - radius, y - radius);
  ctx.lineTo(x, y);
  ctx.lineTo(x - radius, y + radius);
  ctx.closePath();
  ctx.moveTo(x + radius, y - radius);
  ctx.lineTo(x, y);
  ctx.lineTo(x + radius, y + radius);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
}

/** Draw a truthful allocation-free fallback for every semantic world object.
 * No state relies on hue alone and no canvas text/filter/shadow enters the loop. */
function drawSemanticObjectFallback(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  semantic: MinimapObjectSemantic,
  colors: MinimapColors,
  geometry: MinimapPaintGeometry,
): void {
  const radius = geometry.stationDiamondRadius * SEMANTIC_OBJECT_RADIUS_RATIO;
  const core = radius * SEMANTIC_OBJECT_CORE_RATIO;
  ctx.strokeStyle = colors.outline;
  ctx.lineWidth = geometry.markerOutlineWidth;

  switch (semantic.kind) {
    case 'rift-entrance': {
      ctx.fillStyle = colors.portal;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, FULL_CIRCLE);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = colors.outline;
      ctx.beginPath();
      ctx.arc(x, y, core, 0, FULL_CIRCLE);
      ctx.fill();
      drawSemanticRankPips(ctx, x, y, radius, semantic.rank, colors.player);
      return;
    }
    case 'rift-descent': {
      ctx.fillStyle = colors.portal;
      ctx.beginPath();
      ctx.moveTo(x, y + radius);
      ctx.lineTo(x + radius * 0.72, y - radius * 0.15);
      ctx.lineTo(x + core, y - radius * 0.15);
      ctx.lineTo(x + core, y - radius);
      ctx.lineTo(x - core, y - radius);
      ctx.lineTo(x - core, y - radius * 0.15);
      ctx.lineTo(x - radius * 0.72, y - radius * 0.15);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      return;
    }
    case 'rift-return': {
      ctx.fillStyle = colors.portal;
      if (semantic.route === 'beacon') {
        beginDiamond(ctx, x, y, radius);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = colors.outline;
        ctx.beginPath();
        ctx.arc(x, y, core, 0, FULL_CIRCLE);
        ctx.fill();
      } else {
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, FULL_CIRCLE);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = colors.outline;
        ctx.beginPath();
        ctx.moveTo(x, y - radius * 0.68);
        ctx.lineTo(x + radius * 0.42, y + radius * 0.1);
        ctx.lineTo(x + core, y + radius * 0.1);
        ctx.lineTo(x + core, y + radius * 0.62);
        ctx.lineTo(x - core, y + radius * 0.62);
        ctx.lineTo(x - core, y + radius * 0.1);
        ctx.lineTo(x - radius * 0.42, y + radius * 0.1);
        ctx.closePath();
        ctx.fill();
        drawSemanticRankPips(ctx, x, y, radius, semantic.rank, colors.player);
      }
      return;
    }
    case 'rift-reward': {
      const inactive = semantic.state === 'opened' || semantic.state === 'jammed';
      ctx.fillStyle = inactive ? colors.gatherCooldown : colors.objectLoot;
      if (semantic.reward === 'treasure') {
        beginDiamond(ctx, x, y, radius);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(x - radius, y - radius * 0.72, radius * 2, radius * 1.44);
        ctx.strokeRect(x - radius, y - radius * 0.72, radius * 2, radius * 1.44);
      }
      if (semantic.state === 'locked') drawSemanticLock(ctx, x, y, radius, colors.outline);
      else if (semantic.state === 'opened') drawSemanticCheck(ctx, x, y, radius);
      else if (semantic.state === 'jammed') drawSemanticCross(ctx, x, y, core);
      else {
        ctx.fillStyle = colors.outline;
        ctx.beginPath();
        ctx.arc(x, y, core * 0.62, 0, FULL_CIRCLE);
        ctx.fill();
      }
      return;
    }
    case 'delve-passage': {
      ctx.fillStyle = semantic.state === 'sealed' ? colors.gatherCooldown : colors.portal;
      ctx.beginPath();
      ctx.arc(x, y, radius, Math.PI, FULL_CIRCLE);
      ctx.lineTo(x + radius, y + radius);
      ctx.lineTo(x - radius, y + radius);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      if (semantic.state === 'sealed') drawSemanticCross(ctx, x, y + core * 0.5, core);
      else {
        ctx.fillStyle = colors.outline;
        ctx.beginPath();
        ctx.moveTo(x, y - core);
        ctx.lineTo(x + core, y + core);
        ctx.lineTo(x - core, y + core);
        ctx.closePath();
        ctx.fill();
      }
      return;
    }
    case 'delve-surface': {
      ctx.strokeStyle = colors.portal;
      ctx.beginPath();
      ctx.moveTo(x - radius, y + radius * 0.7);
      ctx.lineTo(x + radius, y + radius * 0.7);
      ctx.moveTo(x - radius * 0.7, y + radius * 0.25);
      ctx.lineTo(x + radius * 0.7, y + radius * 0.25);
      ctx.moveTo(x - radius * 0.4, y - radius * 0.2);
      ctx.lineTo(x + radius * 0.4, y - radius * 0.2);
      ctx.moveTo(x, y - radius);
      ctx.lineTo(x, y - radius * 0.2);
      ctx.moveTo(x, y - radius);
      ctx.lineTo(x - core, y - radius * 0.55);
      ctx.moveTo(x, y - radius);
      ctx.lineTo(x + core, y - radius * 0.55);
      ctx.stroke();
      return;
    }
    case 'delve-reward': {
      const inactive = semantic.state === 'opened';
      ctx.fillStyle = inactive ? colors.gatherCooldown : colors.objectLoot;
      if (semantic.reward === 'reliquary') {
        beginDiamond(ctx, x, y, radius);
        ctx.fill();
        ctx.stroke();
      } else {
        ctx.fillRect(x - radius, y - radius * 0.72, radius * 2, radius * 1.44);
        ctx.strokeRect(x - radius, y - radius * 0.72, radius * 2, radius * 1.44);
      }
      if (semantic.bountiful) {
        ctx.beginPath();
        ctx.arc(x, y, radius + geometry.markerOutlineWidth * 2, 0, FULL_CIRCLE);
        ctx.stroke();
      }
      if (semantic.state === 'locked') drawSemanticLock(ctx, x, y, radius, colors.outline);
      else if (semantic.state === 'opened') drawSemanticCheck(ctx, x, y, radius);
      else if (semantic.state === 'ready') {
        ctx.beginPath();
        ctx.moveTo(x, y - core);
        ctx.lineTo(x, y + core);
        ctx.moveTo(x - core, y);
        ctx.lineTo(x + core, y);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.moveTo(x - core, y - core);
        ctx.lineTo(x + core, y);
        ctx.lineTo(x - core, y + core);
        ctx.stroke();
      }
      return;
    }
    case 'rift-mechanic': {
      const active =
        semantic.state === 'lit' ||
        semantic.state === 'placed' ||
        semantic.state === 'open' ||
        semantic.state === 'on' ||
        semantic.state === 'active';
      ctx.fillStyle =
        semantic.state === 'hazard'
          ? colors.mobAggro
          : active
            ? colors.gatherReady
            : colors.gatherCooldown;
      switch (semantic.mechanic) {
        case 'pylon':
          ctx.beginPath();
          ctx.moveTo(x, y - radius);
          ctx.lineTo(x + radius * 0.62, y + radius);
          ctx.lineTo(x - radius * 0.62, y + radius);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          break;
        case 'sequence-rune':
          beginDiamond(ctx, x, y, radius);
          ctx.fill();
          ctx.stroke();
          break;
        case 'ice-goal':
        case 'boulder-pad':
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, FULL_CIRCLE);
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(x, y, core, 0, FULL_CIRCLE);
          ctx.fill();
          break;
        case 'boulder':
        case 'orb':
          ctx.beginPath();
          ctx.arc(x, y, radius, 0, FULL_CIRCLE);
          ctx.fill();
          ctx.stroke();
          break;
        case 'gate':
          ctx.beginPath();
          ctx.arc(x, y, radius, Math.PI, FULL_CIRCLE);
          ctx.lineTo(x + radius, y + radius);
          ctx.lineTo(x - radius, y + radius);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          break;
        case 'switch':
          ctx.fillRect(x - radius * 0.72, y - radius * 0.72, radius * 1.44, radius * 1.44);
          ctx.strokeRect(x - radius * 0.72, y - radius * 0.72, radius * 1.44, radius * 1.44);
          break;
        case 'roller':
          ctx.beginPath();
          ctx.moveTo(x, y - radius);
          ctx.lineTo(x + radius, y + radius);
          ctx.lineTo(x - radius, y + radius);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          break;
      }
      ctx.strokeStyle = colors.outline;
      if (semantic.state === 'lit' || semantic.state === 'active') {
        ctx.beginPath();
        ctx.moveTo(x - core, y);
        ctx.lineTo(x + core, y);
        ctx.moveTo(x, y - core);
        ctx.lineTo(x, y + core);
        ctx.stroke();
      } else if (semantic.state === 'placed' || semantic.state === 'on') {
        drawSemanticCheck(ctx, x, y, radius);
      } else if (semantic.state === 'sealed') {
        drawSemanticCross(ctx, x, y, core);
      } else if (semantic.state === 'open') {
        ctx.beginPath();
        ctx.moveTo(x, y - core);
        ctx.lineTo(x + core, y + core);
        ctx.lineTo(x - core, y + core);
        ctx.closePath();
        ctx.stroke();
      } else if (semantic.state === 'ready' || semantic.state === 'movable') {
        ctx.beginPath();
        ctx.moveTo(x - core, y + core);
        ctx.lineTo(x + core, y - core);
        ctx.stroke();
      } else if (semantic.state === 'dormant' || semantic.state === 'unlit') {
        ctx.beginPath();
        ctx.moveTo(x - core, y);
        ctx.lineTo(x + core, y);
        ctx.stroke();
      } else if (semantic.state === 'hazard') {
        ctx.beginPath();
        ctx.moveTo(x, y - core);
        ctx.lineTo(x, y + core * 0.35);
        ctx.stroke();
        ctx.fillStyle = colors.outline;
        ctx.beginPath();
        ctx.arc(x, y + core, Math.max(1, core * SEMANTIC_OBJECT_BADGE_RATIO), 0, FULL_CIRCLE);
        ctx.fill();
      }
      return;
    }
  }
}

function drawGatherCooldownFallbackArc(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  neutral: string,
  outline: string,
  scale: number,
): void {
  const radius = size / 2 - GATHER_FALLBACK_ARC_EDGE_INSET * scale;
  const previousLineCap = ctx.lineCap;
  ctx.lineCap = 'round';
  ctx.strokeStyle = outline;
  ctx.lineWidth = GATHER_FALLBACK_ARC_DARK_WIDTH * scale;
  ctx.beginPath();
  ctx.arc(x, y, radius, GATHER_FALLBACK_ARC_START, GATHER_FALLBACK_ARC_END);
  ctx.stroke();
  ctx.strokeStyle = neutral;
  ctx.lineWidth = GATHER_FALLBACK_ARC_LIGHT_WIDTH * scale;
  ctx.beginPath();
  ctx.arc(x, y, radius, GATHER_FALLBACK_ARC_START, GATHER_FALLBACK_ARC_END);
  ctx.stroke();
  ctx.lineCap = previousLineCap;
}

function drawGatherLockFallback(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  bronze: string,
  highlight: string,
  outline: string,
  scale: number,
): void {
  const width = Math.max(
    GATHER_FALLBACK_LOCK_MIN_WIDTH * scale,
    Math.round(size * GATHER_FALLBACK_LOCK_WIDTH_RATIO),
  );
  const bodyHeight = Math.max(
    GATHER_FALLBACK_LOCK_MIN_HEIGHT * scale,
    Math.round(width * GATHER_FALLBACK_LOCK_HEIGHT_RATIO),
  );
  const left = x + size / 2 - width - GATHER_FALLBACK_LOCK_EDGE_INSET * scale;
  const top = y + size / 2 - bodyHeight - GATHER_FALLBACK_LOCK_EDGE_INSET * scale;
  const shackleX = left + width / 2;
  const shackleRadius = width * GATHER_FALLBACK_LOCK_SHACKLE_RATIO;
  const border = Math.ceil(scale);

  const previousLineCap = ctx.lineCap;
  ctx.lineCap = 'round';
  ctx.strokeStyle = outline;
  ctx.lineWidth = GATHER_FALLBACK_LOCK_SHACKLE_DARK_WIDTH * scale;
  ctx.beginPath();
  ctx.arc(shackleX, top + 0.5 * scale, shackleRadius, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = bronze;
  ctx.lineWidth = GATHER_FALLBACK_LOCK_SHACKLE_TOP_WIDTH * scale;
  ctx.beginPath();
  ctx.arc(shackleX, top + 0.5 * scale, shackleRadius, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = outline;
  ctx.fillRect(left - border, top - border, width + border * 2, bodyHeight + border * 2);
  ctx.fillStyle = bronze;
  ctx.fillRect(left, top, width, bodyHeight);
  ctx.fillStyle = highlight;
  ctx.fillRect(left + border, top + border, Math.max(1, width - border * 2), border);
  ctx.fillStyle = outline;
  ctx.fillRect(
    Math.round(shackleX) - border,
    top + border * 2,
    border * 2,
    Math.max(1, bodyHeight - border * 2),
  );
  ctx.lineCap = previousLineCap;
}

type ActionableQuestMarker = 'available' | 'ready' | 'repeat' | 'cooldown';

/** Build one quest fallback path without arrays, Path2D, or text. */
function pathQuestFallback(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: ActionableQuestMarker,
  scale: number,
): void {
  const half = QUEST_FALLBACK_HALF * scale;
  ctx.beginPath();
  switch (kind) {
    case 'available':
      ctx.moveTo(x, y - half);
      ctx.lineTo(x, y + scale);
      return;
    case 'ready':
      ctx.arc(x - scale * 0.35, y - scale * 1.5, scale * 2.5, Math.PI, Math.PI * 2.1);
      ctx.lineTo(x + scale * 0.35, y + scale);
      return;
    case 'repeat':
      // A central offer mark inside a broad return-arrow shoulder.
      ctx.moveTo(x, y - half * 0.55);
      ctx.lineTo(x, y + scale);
      ctx.moveTo(x + half, y + scale * 0.25);
      ctx.lineTo(x + half, y - half);
      ctx.lineTo(x - half * 0.55, y - half);
      ctx.moveTo(x - half * 0.55, y - half);
      ctx.lineTo(x + scale * 0.45, y - half - scale * 1.35);
      ctx.moveTo(x - half * 0.55, y - half);
      ctx.lineTo(x + scale * 0.45, y - half + scale * 1.35);
      return;
    case 'cooldown':
      // A hollow hourglass reads as waiting even without the gray asset.
      ctx.moveTo(x - half, y - half);
      ctx.lineTo(x + half, y - half);
      ctx.lineTo(x - half, y + half);
      ctx.lineTo(x + half, y + half);
      return;
  }
}

/** Draw a two-tone quest fallback at full caller alpha. */
function drawQuestFallback(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  kind: ActionableQuestMarker,
  ink: string,
  outline: string,
  scale: number,
): void {
  ctx.strokeStyle = outline;
  ctx.lineWidth = QUEST_FALLBACK_OUTLINE_WIDTH * scale;
  pathQuestFallback(ctx, x, y, kind, scale);
  ctx.stroke();
  ctx.strokeStyle = ink;
  ctx.lineWidth = QUEST_FALLBACK_INK_WIDTH * scale;
  pathQuestFallback(ctx, x, y, kind, scale);
  ctx.stroke();
  if (kind === 'cooldown') return;
  const dotY = y + QUEST_FALLBACK_HALF * scale;
  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.arc(x, dotY, QUEST_FALLBACK_DOT_RADIUS * scale * 1.75, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(x, dotY, QUEST_FALLBACK_DOT_RADIUS * scale, 0, FULL_CIRCLE);
  ctx.fill();
}

/** Quiet non-actionable NPC cue: a hollow ring, never a false quest offer. */
function drawNeutralNpcRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ink: string,
  outline: string,
  geometry: Readonly<MinimapPaintGeometry>,
): void {
  ctx.strokeStyle = outline;
  ctx.lineWidth = geometry.neutralNpcOutlineWidth;
  ctx.beginPath();
  ctx.arc(x, y, geometry.neutralNpcRadius, 0, FULL_CIRCLE);
  ctx.stroke();
  ctx.strokeStyle = ink;
  ctx.lineWidth = geometry.neutralNpcInkWidth;
  ctx.beginPath();
  ctx.arc(x, y, geometry.neutralNpcRadius, 0, FULL_CIRCLE);
  ctx.stroke();
}

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
  geometry: Readonly<MinimapPaintGeometry>,
): void {
  const scale = geometry.corpseCraniumRadius / CORPSE_SKULL_CRANIUM_R;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y - scale, geometry.corpseCraniumRadius, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.fillRect(x - geometry.corpseJawHalf, y + 1.5 * scale, geometry.corpseJawHalf * 2, 3 * scale);
  ctx.fillStyle = socket;
  ctx.beginPath();
  ctx.arc(x - 1.7 * scale, y - scale, geometry.corpseEyeRadius, 0, FULL_CIRCLE);
  ctx.arc(x + 1.7 * scale, y - scale, geometry.corpseEyeRadius, 0, FULL_CIRCLE);
  ctx.fill();
  // nasal notch + a tooth gap so the jaw does not read as a solid block
  ctx.fillRect(x - 0.4 * scale, y + 1.5 * scale, 0.8 * scale, 3 * scale);
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
  constructor(
    private readonly writers: PainterHostWriters,
    private readonly classColor: (cls: string) => string,
    private readonly localizeZone: (zoneId: string) => string,
    private readonly localizeRift: (name: string, rank: string | null) => string,
    /** The battleground's own name. The band sits far off the overworld plane,
     *  so localizeZone would resolve it to whatever zone its coordinates happen
     *  to land nearest, which reads as the last town the player stood in. */
    private readonly battlegroundName: () => string,
    private readonly markerArt: MapMarkerArt = EMPTY_MAP_MARKER_ART,
    private readonly markerProfile: () => MapMarkerProfile = STANDARD_MARKER_PROFILE,
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
    const profile = this.markerProfile();
    const model = this.markers.build(world, S, pxPerYard, profile);
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
    ctx.arc(S / 2, S / 2, S / 2 - MINIMAP_CLIP_INSET, 0, FULL_CIRCLE);
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

    this.drawMarkers(ctx, model.markers, colors, profile);
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
    const profile = this.markerProfile();
    const model = this.markers.build(world, S, pxPerYard, profile);
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
    ctx.arc(S / 2, S / 2, S / 2 - MINIMAP_CLIP_INSET, 0, FULL_CIRCLE);
    ctx.clip();
    ctx.imageSmoothingEnabled = false;
    // Sub-rect blit centered on the player's maze-local position (+X map-left,
    // matching the marker projection).
    const sw = S / (pxPerYard / MAZE_BG_PX_PER_YARD);
    const sx = (pad - (p.pos.x - o.x)) * MAZE_BG_PX_PER_YARD - sw / 2;
    const sy = (p.pos.z - o.z + pad) * MAZE_BG_PX_PER_YARD - sw / 2;
    ctx.drawImage(bg, sx, sy, sw, sw, 0, 0, S, S);
    this.drawMarkers(ctx, model.markers, colors, profile);
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
    const profile = this.markerProfile();
    const model = this.markers.build(world, S, pxPerYard, profile);
    this.writers.setText(zoneLabelEl, this.battlegroundName());
    const p = world.player;
    const o = bgOriginAt(p.pos.z);
    const bg = this.ensureBattlegroundBg(colors);

    ctx.clearRect(0, 0, S, S);
    ctx.save();
    ctx.beginPath();
    ctx.arc(S / 2, S / 2, S / 2 - MINIMAP_CLIP_INSET, 0, FULL_CIRCLE);
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
    this.drawMarkers(ctx, model.markers, colors, profile);
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

  private drawMarkers(
    ctx: CanvasRenderingContext2D,
    markers: readonly MinimapMarker[],
    colors: MinimapColors,
    profile: MapMarkerProfile = 'standard',
  ): void {
    const geometry = MINIMAP_PAINT_GEOMETRY[profile];
    for (const m of markers) {
      switch (m.kind) {
        case 'ally':
          ctx.fillStyle = m.ally === 'friend' ? colors.allyFriend : colors.allyGuild;
          ctx.strokeStyle = colors.outline;
          ctx.lineWidth = geometry.markerOutlineWidth;
          if (m.ally === 'friend') {
            ctx.beginPath();
            ctx.arc(m.mx, m.my, geometry.allyDotRadius, 0, FULL_CIRCLE);
          } else {
            beginDiamond(ctx, m.mx, m.my, geometry.allyGuildDiamondRadius);
          }
          ctx.fill();
          ctx.stroke();
          break;
        case 'npc': {
          if (m.marker === 'none') {
            drawNeutralNpcRing(ctx, m.mx, m.my, colors.gatherCooldown, colors.outline, geometry);
            break;
          }
          const cooldown = m.marker === 'cooldown';
          const sizeId = cooldown
            ? profile === 'compact'
              ? 'minimapQuestCooldownCompact'
              : 'minimapQuestCooldown'
            : profile === 'compact'
              ? 'minimapQuestCompact'
              : 'minimapQuest';
          const size = MAP_MARKER_SIZES[sizeId];
          const sprite = this.markerArt.sprite(questMarkerArtId(m.marker), sizeId);
          if (sprite) {
            // Whole-pixel placement prevents a second browser resample after
            // the loader has already prepared this exact-size raster.
            ctx.drawImage(sprite, Math.round(m.mx - size / 2), Math.round(m.my - size / 2));
          } else {
            const ink = cooldown
              ? colors.gatherCooldown
              : m.marker === 'repeat'
                ? colors.npcQuestRepeat
                : colors.npcQuest;
            drawQuestFallback(
              ctx,
              m.mx,
              m.my,
              m.marker,
              ink,
              colors.outline,
              size / MAP_MARKER_SIZES.minimapQuest,
            );
          }
          break;
        }
        case 'portal': {
          const sizeId = profile === 'compact' ? 'minimapDungeonCompact' : 'minimapDungeon';
          const size = MAP_MARKER_SIZES[sizeId];
          const sprite = this.markerArt.sprite(m.portal, sizeId);
          if (sprite) {
            ctx.drawImage(sprite, Math.round(m.mx - size / 2), Math.round(m.my - size / 2));
          } else {
            ctx.fillStyle = colors.portal;
            ctx.strokeStyle = colors.outline;
            ctx.lineWidth = geometry.markerOutlineWidth;
            if (m.portal === 'dungeon-entrance') {
              // A round portal ring reads as "enter" even before its painted
              // sprite decodes. The dark core keeps it ring-like, not an ally dot.
              ctx.beginPath();
              ctx.arc(m.mx, m.my, geometry.portalDotRadius, 0, FULL_CIRCLE);
              ctx.fill();
              ctx.stroke();
              ctx.fillStyle = colors.outline;
              ctx.beginPath();
              ctx.arc(m.mx, m.my, geometry.portalCoreRadius, 0, FULL_CIRCLE);
              ctx.fill();
            } else {
              // Exit is an upward arrow, a different silhouette from both the
              // entrance ring and the centre-anchored player triangle.
              ctx.beginPath();
              ctx.moveTo(m.mx, m.my - geometry.portalExitTip);
              ctx.lineTo(m.mx + geometry.portalExitWing, m.my);
              ctx.lineTo(m.mx + geometry.portalExitStemHalf, m.my);
              ctx.lineTo(m.mx + geometry.portalExitStemHalf, m.my + geometry.portalExitStemLength);
              ctx.lineTo(m.mx - geometry.portalExitStemHalf, m.my + geometry.portalExitStemLength);
              ctx.lineTo(m.mx - geometry.portalExitStemHalf, m.my);
              ctx.lineTo(m.mx - geometry.portalExitWing, m.my);
              ctx.closePath();
              ctx.fill();
              ctx.stroke();
            }
          }
          break;
        }
        case 'stable-navigation': {
          const sizeId = profile === 'compact' ? 'minimapNavigationCompact' : 'minimapNavigation';
          const size = MAP_MARKER_SIZES[sizeId];
          const sprite = this.markerArt.sprite(m.navigation, sizeId);
          if (sprite) {
            ctx.drawImage(sprite, Math.round(m.mx - size / 2), Math.round(m.my - size / 2));
          } else {
            drawStableNavigationFallback(ctx, m.mx, m.my, m.navigation, colors, geometry);
          }
          break;
        }
        case 'semantic-object': {
          const semanticArt = semanticMapMarkerArt(m.semantic);
          const sizeId = semanticArt
            ? mapMarkerSizeForSemantic('minimap', profile === 'compact', semanticArt)
            : null;
          const sprite =
            semanticArt && sizeId ? this.markerArt.sprite(semanticArt.id, sizeId) : null;
          if (sprite && sizeId) {
            const size = MAP_MARKER_SIZES[sizeId];
            ctx.drawImage(sprite, Math.round(m.mx - size / 2), Math.round(m.my - size / 2));
          } else {
            drawSemanticObjectFallback(ctx, m.mx, m.my, m.semantic, colors, geometry);
          }
          break;
        }
        case 'service': {
          const sizeId = profile === 'compact' ? 'minimapServiceCompact' : 'minimapService';
          const sprite = this.markerArt.sprite(`service-${m.service}`, sizeId);
          if (sprite) {
            const size = MAP_MARKER_SIZES[sizeId];
            ctx.drawImage(sprite, Math.round(m.mx - size / 2), Math.round(m.my - size / 2));
          } else {
            // A service remains distinguishable from loose-loot squares while
            // its image is loading or unavailable. Mail uses a compact diamond;
            // the noticeboard uses a wider sign silhouette, so identity is not
            // lost during the asynchronous first frame.
            ctx.fillStyle = colors.station;
            ctx.strokeStyle = colors.outline;
            ctx.lineWidth = geometry.markerOutlineWidth;
            ctx.beginPath();
            if (m.service === 'mailbox') {
              ctx.moveTo(m.mx, m.my - geometry.stationDiamondRadius);
              ctx.lineTo(m.mx + geometry.stationDiamondRadius, m.my);
              ctx.lineTo(m.mx, m.my + geometry.stationDiamondRadius);
              ctx.lineTo(m.mx - geometry.stationDiamondRadius, m.my);
            } else {
              const halfHeight = geometry.stationDiamondRadius * (2 / 3);
              ctx.moveTo(m.mx - geometry.stationDiamondRadius, m.my - halfHeight);
              ctx.lineTo(m.mx + geometry.stationDiamondRadius, m.my - halfHeight);
              ctx.lineTo(m.mx + geometry.stationDiamondRadius, m.my + halfHeight);
              ctx.lineTo(m.mx - geometry.stationDiamondRadius, m.my + halfHeight);
            }
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
          break;
        }
        case 'object-loot':
          ctx.fillStyle = colors.objectLoot;
          ctx.strokeStyle = colors.outline;
          ctx.lineWidth = geometry.dynamicOutlineWidth;
          beginLootSpark(
            ctx,
            m.mx,
            m.my,
            geometry.objectLootSparkRadius,
            geometry.objectLootSparkShoulder,
          );
          ctx.fill();
          ctx.stroke();
          break;
        case 'mob':
          ctx.fillStyle = m.aggro ? colors.mobAggro : colors.mob;
          ctx.strokeStyle = colors.outline;
          ctx.lineWidth = geometry.dynamicOutlineWidth;
          if (m.aggro) {
            beginDiamond(ctx, m.mx, m.my, geometry.mobAggroDiamondRadius);
          } else {
            ctx.beginPath();
            ctx.arc(m.mx, m.my, geometry.mobDotRadius, 0, FULL_CIRCLE);
          }
          ctx.fill();
          ctx.stroke();
          break;
        case 'mob-loot':
          ctx.fillStyle = colors.mobLoot;
          ctx.strokeStyle = colors.outline;
          ctx.lineWidth = geometry.dynamicOutlineWidth;
          ctx.fillRect(
            m.mx - geometry.mobLootSize / 2,
            m.my - geometry.mobLootSize / 2,
            geometry.mobLootSize,
            geometry.mobLootSize,
          );
          ctx.strokeRect(
            m.mx - geometry.mobLootSize / 2,
            m.my - geometry.mobLootSize / 2,
            geometry.mobLootSize,
            geometry.mobLootSize,
          );
          // Punched dark centre makes the corpse/loot cache hollow at a glance.
          ctx.fillStyle = colors.outline;
          ctx.fillRect(
            m.mx - geometry.mobLootCoreSize / 2,
            m.my - geometry.mobLootCoreSize / 2,
            geometry.mobLootCoreSize,
            geometry.mobLootCoreSize,
          );
          break;
        case 'corpse':
          // The local player's body during a ghost run: a procedural skull.
          drawCorpseSkull(ctx, m.mx, m.my, colors.corpse, colors.outline, geometry);
          break;
        case 'party-disc': {
          const radius = m.radius * geometry.partyDiscScale;
          ctx.fillStyle = m.dead ? colors.partyDead : this.classColor(m.cls);
          ctx.strokeStyle = colors.outline;
          ctx.lineWidth = geometry.markerOutlineWidth;
          ctx.beginPath();
          ctx.arc(m.mx, m.my, radius, 0, FULL_CIRCLE);
          ctx.fill();
          ctx.stroke();
          if (m.pip) {
            // bright inner pip so members pop against terrain.
            ctx.fillStyle = colors.partyPip;
            ctx.beginPath();
            ctx.arc(
              m.mx,
              m.my,
              Math.max(geometry.pipMinRadius, radius * PIP_RADIUS_RATIO),
              0,
              FULL_CIRCLE,
            );
            ctx.fill();
          }
          if (m.dead) {
            drawDeadCross(
              ctx,
              m.mx,
              m.my,
              radius * PARTY_DEAD_CROSS_RATIO,
              colors.outline,
              geometry.partyDeadCrossWidth,
            );
          }
          break;
        }
        case 'party-arrow':
          ctx.save();
          ctx.translate(m.mx, m.my);
          ctx.rotate(m.angle);
          ctx.fillStyle = m.dead ? colors.partyDead : this.classColor(m.cls);
          ctx.strokeStyle = colors.outline;
          ctx.lineWidth = geometry.markerOutlineWidth;
          ctx.beginPath();
          ctx.moveTo(geometry.partyArrowTipX, 0);
          ctx.lineTo(geometry.partyArrowBackX, geometry.partyArrowHalfY);
          ctx.lineTo(geometry.partyArrowBackX, -geometry.partyArrowHalfY);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          if (m.dead) {
            drawDeadCross(
              ctx,
              0,
              0,
              geometry.partyDeadArrowCrossHalf,
              colors.outline,
              geometry.partyDeadCrossWidth,
            );
          }
          ctx.restore();
          break;
        case 'player':
          ctx.save();
          ctx.translate(m.mx, m.my);
          ctx.rotate(m.angle); // canvas rotates clockwise; facing increases turning left
          ctx.fillStyle = colors.player;
          ctx.strokeStyle = colors.outline;
          ctx.lineWidth = geometry.playerArrowOutlineWidth;
          ctx.beginPath();
          ctx.moveTo(0, geometry.playerArrowTipY);
          ctx.lineTo(geometry.playerArrowHalfX, geometry.playerArrowBaseY);
          ctx.lineTo(-geometry.playerArrowHalfX, geometry.playerArrowBaseY);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
          ctx.restore();
          break;
        case 'station': {
          // Tier-identical (fairness invariant): no preset or governor gating.
          const sizeId = profile === 'compact' ? 'minimapStationCompact' : 'minimapStation';
          const sprite = this.markerArt.sprite(stationMarkerArtId(m.type), sizeId);
          if (sprite) {
            const size = MAP_MARKER_SIZES[sizeId];
            ctx.drawImage(sprite, Math.round(m.mx - size / 2), Math.round(m.my - size / 2));
          } else {
            ctx.fillStyle = colors.station;
            ctx.strokeStyle = colors.outline;
            ctx.lineWidth = geometry.markerOutlineWidth;
            ctx.beginPath();
            ctx.moveTo(m.mx, m.my - geometry.stationDiamondRadius);
            ctx.lineTo(m.mx + geometry.stationDiamondRadius, m.my);
            ctx.lineTo(m.mx, m.my + geometry.stationDiamondRadius);
            ctx.lineTo(m.mx - geometry.stationDiamondRadius, m.my);
            ctx.closePath();
            ctx.fill();
            ctx.stroke();
          }
          break;
        }
        case 'gather-node': {
          // Four independent cached variants make both facts visible: ready is
          // full color, cooldown is grayscale inside a broken neutral ring,
          // and tool lock adds a bronze padlock in either availability state.
          // The profile is resolved once outside this loop. The normal path is
          // exactly one sprite lookup and one whole-pixel blit, with no filter,
          // opacity, or vector state treatment in the redraw.
          const sizeId = m.ready
            ? m.locked
              ? profile === 'compact'
                ? 'minimapGatherReadyLockedCompact'
                : 'minimapGatherReadyLocked'
              : profile === 'compact'
                ? 'minimapGatherReadyCompact'
                : 'minimapGatherReady'
            : m.locked
              ? profile === 'compact'
                ? 'minimapGatherCooldownLockedCompact'
                : 'minimapGatherCooldownLocked'
              : profile === 'compact'
                ? 'minimapGatherCooldownCompact'
                : 'minimapGatherCooldown';
          const sprite = this.markerArt.sprite(gatherMarkerArtId(m.type), sizeId);
          const size = MAP_MARKER_SIZES[sizeId];
          if (sprite) {
            ctx.drawImage(sprite, Math.round(m.mx - size / 2), Math.round(m.my - size / 2));
          } else {
            const radius =
              size *
              (m.ready
                ? GATHER_FALLBACK_READY_RADIUS_RATIO
                : GATHER_FALLBACK_COOLDOWN_RADIUS_RATIO);
            ctx.fillStyle = m.ready ? colors.gatherReady : colors.gatherCooldown;
            ctx.strokeStyle = colors.outline;
            ctx.lineWidth = geometry.markerOutlineWidth;
            ctx.beginPath();
            ctx.arc(m.mx, m.my, radius, 0, FULL_CIRCLE);
            ctx.fill();
            ctx.stroke();
            if (!m.ready) {
              drawGatherCooldownFallbackArc(
                ctx,
                m.mx,
                m.my,
                size,
                colors.gatherCooldown,
                colors.outline,
                geometry.gatherFallbackScale,
              );
            }
            if (m.locked) {
              drawGatherLockFallback(
                ctx,
                m.mx,
                m.my,
                size,
                colors.gatherLocked,
                colors.gatherReady,
                colors.outline,
                geometry.gatherFallbackScale,
              );
            }
          }
          break;
        }
      }
    }
  }
}
