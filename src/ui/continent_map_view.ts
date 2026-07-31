// Pure, host-agnostic draw model for the world map's CONTINENT overview level:
// the WoW-style "zoom out to the whole world" surface reached by right-clicking
// the per-zone map (or the level-toggle button). It maps the static world layout
// (every ZoneDef rect + the world bounds) plus the player's position to a flat
// geometry model in canvas-pixel space: the contain-fit rect where the painted
// continent art blits, one clickable/hoverable rect per zone (already projected),
// the "you are here" marker, and which zone the player currently stands in.
//
// The pure-core half of the pure-core + canvas-painter split (root CLAUDE.md
// Conventions; reference map_window_view.ts / map_window_painter.ts). No DOM, no
// Three, no 2D context, no i18n, no color: the painter (continent_map_painter.ts)
// owns the context, resolves the --color-map-* tokens, and localizes the zone
// labels. Regions carry the zone id (never the resolved name) so the painter
// resolves localized text and the hover/click hit-tests key on identity.
//
// DOM-free / i18n-free / deterministic so tests/continent_map_view.test.ts can
// drive it directly with both a Sim-shaped and a ClientWorld-mirror-shaped stub.

import {
  STRIP_MAX_X,
  STRIP_MIN_X,
  WORLD_MAX_X,
  WORLD_MAX_Z,
  WORLD_MIN_X,
  WORLD_MIN_Z,
  ZONES,
  type ZoneDef,
  zoneAt,
} from '../sim/data';
import type { IWorld } from '../world_api';

/** An axis-aligned rectangle in canvas-pixel space. */
export interface ContinentRect {
  mx: number;
  my: number;
  w: number;
  h: number;
}

/** One zone's clickable/hoverable area on the continent overview. */
export interface ContinentZoneRegion {
  zoneId: string;
  /** The zone's rect in canvas pixels (the hit-test + highlight area). */
  rect: ContinentRect;
  /** Label anchor: the rect center (the painter localizes + strokes the name). */
  labelX: number;
  labelY: number;
  /** The zone the player currently stands in (drawn emphasized). */
  isCurrent: boolean;
  /** Matches the hovered zone id passed in (drawn highlighted). */
  isHovered: boolean;
  /** Inclusive suggested level band, for the painter's hover tooltip. */
  levelMin: number;
  levelMax: number;
}

/** Everything the painter draws for one continent-overview frame, all in
 *  canvas-pixel space and derived purely from the world layout + the player. */
export interface ContinentMapModel {
  /** Contain-fit dest rect where the continent art blits (world bounds mapped
   *  into the square canvas, aspect preserved, ocean letterbox on the short axis). */
  image: ContinentRect;
  regions: ContinentZoneRegion[];
  /** The player's projected position ("you are here"), or null if off the world. */
  player: { mx: number; my: number } | null;
  /** The zone id the player currently stands in (the on-canvas subtitle). */
  currentZoneId: string;
}

export interface ContinentMapInput {
  world: IWorld;
  /** The square map-canvas side in px. */
  canvasSize: number;
  /** The displayed continent plate's aspect (width / height). The dest rect
   *  contain-fits this into the square canvas and the world bounds are mapped to
   *  FILL it (independent X and Z scale), so the zone regions overlay the painted
   *  land instead of the world's true (very tall) aspect. The painter passes the
   *  loaded art's natural aspect, or CONTINENT_FALLBACK_ASPECT when it is absent. */
  contentAspect: number;
  /** The zone id under the cursor (hover), or null. */
  hoveredZoneId: string | null;
}

/** Aspect (width / height) used to lay out the regions when no art has decoded
 *  yet (matches the shipped world_overview.webp so the layout does not jump when
 *  the plate arrives; pinned to the file's real pixel size by
 *  tests/continent_map_view.test.ts, so re-cropping the plate must update this). */
export const CONTINENT_FALLBACK_ASPECT = 543 / 1100;

/** A zone's east-west extent: its own column, or the original full-width strip. */
function zoneXBounds(zone: ZoneDef): [number, number] {
  return [zone.xMin ?? STRIP_MIN_X, zone.xMax ?? STRIP_MAX_X];
}

/**
 * Build the continent-overview draw model. Reads only the static world layout
 * (ZONES rects + WORLD_* bounds) and the player's position off IWorld, so the
 * offline Sim and the online ClientWorld mirror produce identical output. The
 * projection matches the per-zone map's toMap convention: +X is map-left
 * (east = -X), +Z is map-up (north at the top).
 */
export function buildContinentMapModel(input: ContinentMapInput): ContinentMapModel {
  const { world, canvasSize: S, contentAspect, hoveredZoneId } = input;
  const worldSpanX = WORLD_MAX_X - WORLD_MIN_X;
  const worldSpanZ = WORLD_MAX_Z - WORLD_MIN_Z;
  // Contain-fit the art plate's aspect into the square canvas (ocean letterbox on
  // its short axis), then map the world bounds to FILL that rect: X and Z scale
  // independently so every zone rect lands over the painted continent rather than
  // being squeezed into the world's true 1:2.4 aspect. Guard a non-finite aspect.
  const aspect = contentAspect > 0 && Number.isFinite(contentAspect) ? contentAspect : 1;
  const imageW = aspect >= 1 ? S : S * aspect;
  const imageH = aspect >= 1 ? S / aspect : S;
  const imageX = (S - imageW) / 2;
  const imageY = (S - imageH) / 2;
  const toMap = (x: number, z: number): { mx: number; my: number } => ({
    mx: imageX + ((WORLD_MAX_X - x) / worldSpanX) * imageW,
    my: imageY + ((WORLD_MAX_Z - z) / worldSpanZ) * imageH,
  });

  const p = world.player;
  const currentZoneId = zoneAt(p.pos.x, p.pos.z).id;

  const regions: ContinentZoneRegion[] = ZONES.map((zone) => {
    const [xMin, xMax] = zoneXBounds(zone);
    // +X maps left and +Z maps up, so the rect's top-left corner sits at
    // (xMax, zMax) and its bottom-right at (xMin, zMin); both spans are positive.
    const topLeft = toMap(xMax, zone.zMax);
    const bottomRight = toMap(xMin, zone.zMin);
    const rect: ContinentRect = {
      mx: topLeft.mx,
      my: topLeft.my,
      w: bottomRight.mx - topLeft.mx,
      h: bottomRight.my - topLeft.my,
    };
    return {
      zoneId: zone.id,
      rect,
      labelX: rect.mx + rect.w / 2,
      labelY: rect.my + rect.h / 2,
      isCurrent: zone.id === currentZoneId,
      isHovered: zone.id === hoveredZoneId,
      levelMin: zone.levelRange[0],
      levelMax: zone.levelRange[1],
    };
  });

  const withinWorld =
    p.pos.x >= WORLD_MIN_X &&
    p.pos.x <= WORLD_MAX_X &&
    p.pos.z >= WORLD_MIN_Z &&
    p.pos.z <= WORLD_MAX_Z;
  const player = withinWorld ? toMap(p.pos.x, p.pos.z) : null;

  return {
    image: { mx: imageX, my: imageY, w: imageW, h: imageH },
    regions,
    player,
    currentZoneId,
  };
}

/** The zone id whose region rect contains the canvas point, or null (the zones
 *  are disjoint rects, so at most one contains any point; first match wins). */
export function continentZoneAt(
  regions: readonly ContinentZoneRegion[],
  mx: number,
  my: number,
): string | null {
  for (const region of regions) {
    const { rect } = region;
    if (mx >= rect.mx && mx <= rect.mx + rect.w && my >= rect.my && my <= rect.my + rect.h) {
      return region.zoneId;
    }
  }
  return null;
}
