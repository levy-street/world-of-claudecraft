// Bounded browser adapter for the stable map-marker paintings. One Hud-owned
// instance decodes each 64px WebP once and pre-rasterizes only the exact sizes
// requested by the painters. Every raster gets a crisp light exterior keyline
// over the master's dark contour. Gathering state is also baked here: cooldown
// uses a smaller grayscale subject inside a broken neutral ring, and locked
// variants retain a bronze padlock whether the node is ready or cooling down.
// Rift/delve navigation and reward state is baked by the same bounded cache:
// rank notches, sealed locks, active rings, opened checks, jammed crosses, and
// bountiful corner points never run in either painter's redraw loop.
// Treatment runs at decode. Theme and forced-colors signals re-sample the
// palette once, then rebuild decoded sprites only when a token value changed,
// never in a redraw. A missing/loading asset returns null so procedural
// fallbacks remain available.

import {
  MAP_MARKER_ART_IDS,
  MAP_MARKER_SIZES,
  type MapMarkerArt,
  type MapMarkerArtId,
  type MapMarkerSize,
  mapMarkerIconUrl,
  mapMarkerSizesFor,
} from './map_marker_icon_art';

type IconLoadState = HTMLImageElement | 'loading' | 'missing';
type ImageFactory = () => HTMLImageElement | null;

export const MAP_MARKER_RASTER_COLOR_TOKENS = {
  keyline: '--color-map-marker-keyline',
  cooldownArcDark: '--color-map-marker-cooldown-arc-dark',
  cooldownArcLight: '--color-map-marker-cooldown-arc-light',
  lockDark: '--color-map-marker-lock-dark',
  lockBronze: '--color-map-marker-lock-bronze',
  lockHighlight: '--color-map-marker-lock-highlight',
  semanticDark: '--color-map-marker-semantic-dark',
  semanticBronze: '--color-map-marker-semantic-bronze',
  semanticSilver: '--color-map-marker-semantic-silver',
  semanticGold: '--color-map-marker-semantic-gold',
  semanticCyan: '--color-map-marker-semantic-cyan',
  semanticJammed: '--color-map-marker-semantic-jammed',
  semanticOpened: '--color-map-marker-semantic-opened',
  neutralFallback: '--color-map-marker-neutral-fallback',
} as const;

export type MapMarkerRasterColors = Readonly<{
  [Key in keyof typeof MAP_MARKER_RASTER_COLOR_TOKENS]: string;
}>;

export interface MapMarkerArtCache extends MapMarkerArt {
  refreshPalette(): void;
}

export function resolveMapMarkerRasterColors(
  style: Pick<CSSStyleDeclaration, 'getPropertyValue'>,
): MapMarkerRasterColors {
  const color = (key: keyof typeof MAP_MARKER_RASTER_COLOR_TOKENS): string =>
    style.getPropertyValue(MAP_MARKER_RASTER_COLOR_TOKENS[key]).trim();
  return {
    keyline: color('keyline'),
    cooldownArcDark: color('cooldownArcDark'),
    cooldownArcLight: color('cooldownArcLight'),
    lockDark: color('lockDark'),
    lockBronze: color('lockBronze'),
    lockHighlight: color('lockHighlight'),
    semanticDark: color('semanticDark'),
    semanticBronze: color('semanticBronze'),
    semanticSilver: color('semanticSilver'),
    semanticGold: color('semanticGold'),
    semanticCyan: color('semanticCyan'),
    semanticJammed: color('semanticJammed'),
    semanticOpened: color('semanticOpened'),
    neutralFallback: color('neutralFallback'),
  };
}

const MARKER_KEYLINE_OFFSETS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const;
const MARKER_SOURCE_INSET = 1;
// Keep the cooled-down identity large enough that ore, wood, and herb remain
// distinguishable beneath the timer ring and optional lock at the 16px
// standard minimap size. The state still reads through grayscale, smaller
// outer footprint, the broken ring, and absence of the ready glow.
const GATHER_COOLDOWN_SOURCE_INSET = 2;
const GATHER_COOLDOWN_ARC_DARK_WIDTH = 3;
const GATHER_COOLDOWN_ARC_LIGHT_WIDTH = 1.5;
const GATHER_COOLDOWN_ARC_EDGE_INSET = 3;
const GATHER_COOLDOWN_ARC_START = (Math.PI * 5) / 12;
const GATHER_COOLDOWN_ARC_END = GATHER_COOLDOWN_ARC_START + (Math.PI * 5) / 3;
const GATHER_LOCK_BADGE_WIDTH_RATIO = 0.34;
const GATHER_LOCK_BADGE_MIN_WIDTH = 6;
const GATHER_LOCK_BODY_HEIGHT_RATIO = 0.58;
const GATHER_LOCK_BODY_MIN_HEIGHT = 4;
const GATHER_LOCK_BADGE_EDGE_INSET = 2;
const GATHER_LOCK_SHACKLE_RADIUS_RATIO = 0.28;
const GATHER_LOCK_SHACKLE_CENTER_LIFT = 0.5;
const GATHER_LOCK_SHACKLE_DARK_WIDTH = 3;
const GATHER_LOCK_SHACKLE_BRONZE_WIDTH = 1.4;
const GRAYSCALE_LUMA_RED = 0.2126;
const GRAYSCALE_LUMA_GREEN = 0.7152;
const GRAYSCALE_LUMA_BLUE = 0.0722;
const GRAYSCALE_CONTRAST = 0.75;
const GRAYSCALE_LIFT = 40;
function isGatherCooldown(size: MapMarkerSize): boolean {
  return size.includes('GatherCooldown');
}

function isGatherLocked(size: MapMarkerSize): boolean {
  return size.includes('Gather') && size.includes('Locked');
}

function isSemanticOpened(size: MapMarkerSize): boolean {
  return size.includes('RewardOpened');
}

function isSemanticJammed(size: MapMarkerSize): boolean {
  return size.includes('RewardJammed');
}

function isSemanticLocked(size: MapMarkerSize): boolean {
  return size.includes('NavigationLocked') || size.includes('RewardLocked');
}

function isSemanticActive(size: MapMarkerSize): boolean {
  return size.includes('RewardActive');
}

function isSemanticBountiful(size: MapMarkerSize): boolean {
  return size.includes('Reward') && size.includes('Bountiful');
}

function semanticRank(size: MapMarkerSize): 'C' | 'B' | 'A' | 'S' | null {
  if (size.includes('NavigationRankC')) return 'C';
  if (size.includes('NavigationRankB')) return 'B';
  if (size.includes('NavigationRankA')) return 'A';
  if (size.includes('NavigationRankS')) return 'S';
  return null;
}

/** The clockwise arc leaves a sixty-degree gap at the lower right. That gap
 * reads as an incomplete timer at micro scale and reserves clear space for
 * the independent padlock on a combined cooldown + locked node. */
function drawGatherCooldownArc(
  ctx: CanvasRenderingContext2D,
  pixels: number,
  colors: MapMarkerRasterColors,
): void {
  const center = pixels / 2;
  const radius = center - GATHER_COOLDOWN_ARC_EDGE_INSET;
  ctx.lineCap = 'round';
  ctx.strokeStyle = colors.cooldownArcDark;
  ctx.lineWidth = GATHER_COOLDOWN_ARC_DARK_WIDTH;
  ctx.beginPath();
  ctx.arc(center, center, radius, GATHER_COOLDOWN_ARC_START, GATHER_COOLDOWN_ARC_END);
  ctx.stroke();
  ctx.strokeStyle = colors.cooldownArcLight;
  ctx.lineWidth = GATHER_COOLDOWN_ARC_LIGHT_WIDTH;
  ctx.beginPath();
  ctx.arc(center, center, radius, GATHER_COOLDOWN_ARC_START, GATHER_COOLDOWN_ARC_END);
  ctx.stroke();
}

/** A simplified two-value padlock survives the smallest standard raster. The
 * dark under-shape separates it from both bright ore and pale cooldown art;
 * the bronze body and one-pixel highlight keep it in the forged UI family. */
function drawGatherLockBadge(
  ctx: CanvasRenderingContext2D,
  pixels: number,
  colors: MapMarkerRasterColors,
): void {
  const width = Math.max(
    GATHER_LOCK_BADGE_MIN_WIDTH,
    Math.round(pixels * GATHER_LOCK_BADGE_WIDTH_RATIO),
  );
  const bodyHeight = Math.max(
    GATHER_LOCK_BODY_MIN_HEIGHT,
    Math.round(width * GATHER_LOCK_BODY_HEIGHT_RATIO),
  );
  const x = pixels - width - GATHER_LOCK_BADGE_EDGE_INSET;
  const y = pixels - bodyHeight - GATHER_LOCK_BADGE_EDGE_INSET;
  const shackleX = x + width / 2;
  const shackleY = y + GATHER_LOCK_SHACKLE_CENTER_LIFT;
  const shackleRadius = width * GATHER_LOCK_SHACKLE_RADIUS_RATIO;

  ctx.lineCap = 'round';
  ctx.strokeStyle = colors.lockDark;
  ctx.lineWidth = GATHER_LOCK_SHACKLE_DARK_WIDTH;
  ctx.beginPath();
  ctx.arc(shackleX, shackleY, shackleRadius, Math.PI, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = colors.lockBronze;
  ctx.lineWidth = GATHER_LOCK_SHACKLE_BRONZE_WIDTH;
  ctx.beginPath();
  ctx.arc(shackleX, shackleY, shackleRadius, Math.PI, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = colors.lockDark;
  ctx.fillRect(x - 1, y - 1, width + 2, bodyHeight + 2);
  ctx.fillStyle = colors.lockBronze;
  ctx.fillRect(x, y, width, bodyHeight);
  ctx.fillStyle = colors.lockHighlight;
  ctx.fillRect(x + 1, y + 1, Math.max(1, width - 2), 1);
  ctx.fillStyle = colors.lockDark;
  ctx.fillRect(Math.round(shackleX) - 1, y + 2, 2, Math.max(1, bodyHeight - 2));
}

function drawSemanticLockBadge(
  ctx: CanvasRenderingContext2D,
  pixels: number,
  colors: MapMarkerRasterColors,
): void {
  drawGatherLockBadge(ctx, pixels, colors);
}

function drawSemanticRank(
  ctx: CanvasRenderingContext2D,
  pixels: number,
  rank: 'C' | 'B' | 'A' | 'S',
  colors: MapMarkerRasterColors,
): void {
  const center = pixels / 2;
  const radius = center - 2.5;
  const count = rank === 'C' ? 1 : rank === 'B' ? 2 : rank === 'A' ? 3 : 4;
  ctx.lineCap = 'round';
  ctx.strokeStyle = colors.semanticDark;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle =
    rank === 'C'
      ? colors.semanticBronze
      : rank === 'B'
        ? colors.semanticSilver
        : colors.semanticGold;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.stroke();
  const notchWidth = Math.max(2, Math.round(pixels * 0.1));
  const startX = Math.round(center - ((count - 1) * (notchWidth + 1)) / 2);
  ctx.fillStyle = colors.semanticDark;
  for (let index = 0; index < count; index++) {
    ctx.fillRect(startX + index * (notchWidth + 1) - 1, 0, notchWidth + 2, 4);
  }
  ctx.fillStyle =
    rank === 'C'
      ? colors.semanticBronze
      : rank === 'B'
        ? colors.semanticSilver
        : colors.semanticGold;
  for (let index = 0; index < count; index++) {
    ctx.fillRect(startX + index * (notchWidth + 1), 0, notchWidth, 3);
  }
  if (rank === 'S') {
    // S keeps the four-notch progression but also owns a bottom diamond. This
    // survives compact downsampling and makes A/S distinct by silhouette, not
    // merely by one crowded top notch or the shared gold ring.
    const diamondY = pixels - 4;
    ctx.fillStyle = colors.semanticDark;
    ctx.fillRect(Math.round(center) - 2, diamondY - 1, 5, 5);
    ctx.fillStyle = colors.semanticGold;
    ctx.fillRect(Math.round(center) - 1, diamondY, 3, 3);
  }
}

function drawSemanticActive(
  ctx: CanvasRenderingContext2D,
  pixels: number,
  colors: MapMarkerRasterColors,
): void {
  const center = pixels / 2;
  const radius = center - 2.5;
  ctx.lineCap = 'round';
  ctx.strokeStyle = colors.semanticDark;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(center, center, radius, Math.PI / 4, Math.PI * 1.75);
  ctx.stroke();
  ctx.strokeStyle = colors.semanticCyan;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(center, center, radius, Math.PI / 4, Math.PI * 1.75);
  ctx.stroke();
}

function drawSemanticOpened(
  ctx: CanvasRenderingContext2D,
  pixels: number,
  colors: MapMarkerRasterColors,
): void {
  const badge = Math.max(6, Math.round(pixels * 0.34));
  const x = pixels - badge - 1;
  const y = 1;
  ctx.fillStyle = colors.semanticDark;
  ctx.fillRect(x, y, badge, badge);
  ctx.strokeStyle = colors.semanticOpened;
  ctx.lineCap = 'round';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + 1.5, y + badge * 0.52);
  ctx.lineTo(x + badge * 0.42, y + badge - 1.5);
  ctx.lineTo(x + badge - 1, y + 1.5);
  ctx.stroke();
}

function drawSemanticJammed(
  ctx: CanvasRenderingContext2D,
  pixels: number,
  colors: MapMarkerRasterColors,
): void {
  const inset = Math.max(3, Math.round(pixels * 0.18));
  ctx.lineCap = 'round';
  ctx.strokeStyle = colors.semanticDark;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(inset, inset);
  ctx.lineTo(pixels - inset, pixels - inset);
  ctx.moveTo(pixels - inset, inset);
  ctx.lineTo(inset, pixels - inset);
  ctx.stroke();
  ctx.strokeStyle = colors.semanticJammed;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(inset, inset);
  ctx.lineTo(pixels - inset, pixels - inset);
  ctx.moveTo(pixels - inset, inset);
  ctx.lineTo(inset, pixels - inset);
  ctx.stroke();
}

function drawSemanticBountiful(
  ctx: CanvasRenderingContext2D,
  pixels: number,
  colors: MapMarkerRasterColors,
): void {
  const center = Math.round(pixels / 2);
  const length = Math.max(3, Math.round(pixels * 0.16));
  ctx.fillStyle = colors.semanticDark;
  ctx.fillRect(center - 2, 0, 4, length + 1);
  ctx.fillRect(center - 2, pixels - length - 1, 4, length + 1);
  ctx.fillRect(0, center - 2, length + 1, 4);
  ctx.fillRect(pixels - length - 1, center - 2, length + 1, 4);
  ctx.fillStyle = colors.semanticGold;
  ctx.fillRect(center - 1, 0, 2, length);
  ctx.fillRect(center - 1, pixels - length, 2, length);
  ctx.fillRect(0, center - 1, length, 2);
  ctx.fillRect(pixels - length, center - 1, length, 2);
}

/** Neutralize a cooldown sprite without flattening its painted facets. The
 * contrast lift keeps the master's near-black contour distinct from the pale
 * outer keyline after a 16px to 32px downsample. Alpha is never changed. */
export function grayscaleMapMarkerPixels(data: Uint8ClampedArray): void {
  for (let offset = 0; offset < data.length; offset += 4) {
    const luma =
      data[offset] * GRAYSCALE_LUMA_RED +
      data[offset + 1] * GRAYSCALE_LUMA_GREEN +
      data[offset + 2] * GRAYSCALE_LUMA_BLUE;
    const gray = Math.min(255, Math.round(luma * GRAYSCALE_CONTRAST + GRAYSCALE_LIFT));
    data[offset] = gray;
    data[offset + 1] = gray;
    data[offset + 2] = gray;
  }
}

function browserImage(): HTMLImageElement | null {
  return typeof Image === 'undefined' ? null : new Image();
}

export function createMapMarkerArt(
  hostDocument: Pick<Document, 'createElement'>,
  createImage: ImageFactory = browserImage,
  fixedColors?: MapMarkerRasterColors,
): MapMarkerArtCache {
  const images = new Map<MapMarkerArtId, IconLoadState>();
  const sprites = new Map<MapMarkerArtId, Map<MapMarkerSize, HTMLCanvasElement>>();
  const resolveColors = (): MapMarkerRasterColors =>
    fixedColors ??
    resolveMapMarkerRasterColors(getComputedStyle((hostDocument as Document).documentElement));
  let colors = resolveColors();
  let scratch: HTMLCanvasElement | null = null;

  const rasterize = (id: MapMarkerArtId, image: HTMLImageElement): void => {
    if (sprites.has(id)) return;
    const bySize = new Map<MapMarkerSize, HTMLCanvasElement>();
    for (const sizeId of mapMarkerSizesFor(id)) {
      const pixels = MAP_MARKER_SIZES[sizeId];
      scratch ??= hostDocument.createElement('canvas');
      scratch.width = pixels;
      scratch.height = pixels;
      const scratchCtx = scratch.getContext('2d');
      if (!scratchCtx) {
        images.set(id, 'missing');
        return;
      }
      scratchCtx.clearRect(0, 0, pixels, pixels);
      scratchCtx.imageSmoothingEnabled = true;
      scratchCtx.imageSmoothingQuality = 'high';
      const sourceInset = isGatherCooldown(sizeId)
        ? GATHER_COOLDOWN_SOURCE_INSET
        : MARKER_SOURCE_INSET;
      const contentPixels = pixels - sourceInset * 2;
      scratchCtx.drawImage(image, sourceInset, sourceInset, contentPixels, contentPixels);
      if (isGatherCooldown(sizeId) || isSemanticOpened(sizeId) || isSemanticJammed(sizeId)) {
        try {
          const imageData = scratchCtx.getImageData(0, 0, pixels, pixels);
          grayscaleMapMarkerPixels(imageData.data);
          scratchCtx.putImageData(imageData, 0, 0);
        } catch {
          // Same-origin project art should always allow pixel access. Retain a
          // truthful neutral silhouette if a host nevertheless denies it.
          scratchCtx.globalCompositeOperation = 'source-in';
          scratchCtx.fillStyle = colors.neutralFallback;
          scratchCtx.fillRect(0, 0, pixels, pixels);
          scratchCtx.globalCompositeOperation = 'source-over';
        }
      }
      const canvas = hostDocument.createElement('canvas');
      canvas.width = pixels;
      canvas.height = pixels;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        images.set(id, 'missing');
        return;
      }
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      for (const [dx, dy] of MARKER_KEYLINE_OFFSETS) ctx.drawImage(scratch, dx, dy);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = colors.keyline;
      ctx.fillRect(0, 0, pixels, pixels);
      ctx.globalCompositeOperation = 'source-over';
      ctx.drawImage(scratch, 0, 0);
      if (isGatherCooldown(sizeId)) drawGatherCooldownArc(ctx, pixels, colors);
      if (isGatherLocked(sizeId)) drawGatherLockBadge(ctx, pixels, colors);
      if (isSemanticLocked(sizeId)) drawSemanticLockBadge(ctx, pixels, colors);
      const rank = semanticRank(sizeId);
      if (rank) drawSemanticRank(ctx, pixels, rank, colors);
      if (isSemanticActive(sizeId)) drawSemanticActive(ctx, pixels, colors);
      if (isSemanticOpened(sizeId)) drawSemanticOpened(ctx, pixels, colors);
      if (isSemanticJammed(sizeId)) drawSemanticJammed(ctx, pixels, colors);
      if (isSemanticBountiful(sizeId)) drawSemanticBountiful(ctx, pixels, colors);
      bySize.set(sizeId, canvas);
    }
    sprites.set(id, bySize);
    images.set(id, image);
  };

  const ensure = (id: MapMarkerArtId): void => {
    if (images.has(id)) return;
    const image = createImage();
    if (!image) {
      images.set(id, 'missing');
      return;
    }
    image.decoding = 'async';
    images.set(id, 'loading');
    image.onload = () => rasterize(id, image);
    image.onerror = () => images.set(id, 'missing');
    image.src = mapMarkerIconUrl(id);
    if (image.complete && image.naturalWidth > 0) rasterize(id, image);
  };

  const paletteMatches = (next: MapMarkerRasterColors): boolean => {
    for (const key of Object.keys(MAP_MARKER_RASTER_COLOR_TOKENS) as Array<
      keyof MapMarkerRasterColors
    >) {
      if (colors[key] !== next[key]) return false;
    }
    return true;
  };

  return {
    sprite(id, size): CanvasImageSource | null {
      ensure(id);
      return sprites.get(id)?.get(size) ?? null;
    },
    preload(): void {
      for (const id of MAP_MARKER_ART_IDS) ensure(id);
    },
    refreshPalette(): void {
      const next = resolveColors();
      if (paletteMatches(next)) return;
      colors = next;
      sprites.clear();
      for (const [id, state] of images) {
        if (state !== 'loading' && state !== 'missing') rasterize(id, state);
      }
    },
  };
}
