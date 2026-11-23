// A lightweight, self-contained top-down map for the EDITOR (the game's HUD
// minimap/map window need a live player + a cached terrain-bg pipeline; the
// editor just samples the same terrain/biome/water fields into a canvas). Used
// by the toolbar's minimap toggle and the Map window (zone + full-world views).

import type { BiomeId } from '../sim/types';
import { biomeAt, terrainHeight, waterLevel } from '../sim/world';

export interface MapRect {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface ZoneBox {
  id: string;
  label: string;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface MapSceneOverlay {
  roads: readonly (readonly { x: number; z: number }[])[];
  placements: readonly {
    x: number;
    z: number;
    scale: number;
    assetId: string;
    hidden?: boolean;
  }[];
}

interface MapTransform {
  scale: number;
  offX: number;
  offY: number;
}

export interface MapArtProjection {
  source: { x: number; y: number; width: number; height: number };
  destination: { x: number; y: number; width: number; height: number };
}

function mapTransform(rect: MapRect, S: number): MapTransform {
  const spanX = Math.max(1e-6, rect.maxX - rect.minX);
  const spanZ = Math.max(1e-6, rect.maxZ - rect.minZ);
  const scale = Math.min(S / spanX, S / spanZ);
  return { scale, offX: (S - spanX * scale) / 2, offY: (S - spanZ * scale) / 2 };
}

/**
 * Project a painted map through the same aspect-preserving world transform as
 * terrain, roads, assets, and the camera marker. Generated plates are commonly
 * square even when their source zone is tall, so use a centered cover crop
 * before drawing instead of stretching the geography.
 */
export function mapArtProjection(
  sourceWidth: number,
  sourceHeight: number,
  rect: MapRect,
  S: number,
): MapArtProjection {
  const sw0 = Math.max(1, sourceWidth);
  const sh0 = Math.max(1, sourceHeight);
  const spanX = Math.max(1e-6, rect.maxX - rect.minX);
  const spanZ = Math.max(1e-6, rect.maxZ - rect.minZ);
  const targetAspect = spanX / spanZ;
  const sourceAspect = sw0 / sh0;
  let sx = 0;
  let sy = 0;
  let sw = sw0;
  let sh = sh0;
  if (sourceAspect > targetAspect) {
    sw = sh0 * targetAspect;
    sx = (sw0 - sw) / 2;
  } else if (sourceAspect < targetAspect) {
    sh = sw0 / targetAspect;
    sy = (sh0 - sh) / 2;
  }
  const transform = mapTransform(rect, S);
  return {
    source: { x: sx, y: sy, width: sw, height: sh },
    destination: {
      x: transform.offX,
      y: transform.offY,
      width: spanX * transform.scale,
      height: spanZ * transform.scale,
    },
  };
}

export function drawMapArt(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  rect: MapRect,
  S: number,
): void {
  const p = mapArtProjection(
    image.naturalWidth || image.width,
    image.naturalHeight || image.height,
    rect,
    S,
  );
  ctx.drawImage(
    image,
    p.source.x,
    p.source.y,
    p.source.width,
    p.source.height,
    p.destination.x,
    p.destination.y,
    p.destination.width,
    p.destination.height,
  );
}

export function sameMapRect(a: MapRect, b: MapRect): boolean {
  return a.minX === b.minX && a.maxX === b.maxX && a.minZ === b.minZ && a.maxZ === b.maxZ;
}

// One representative color per biome for the flat top-down fill. Not the exact
// in-world palette (that lives in the render shaders), just legible map tints.
const BIOME_HEX: Record<BiomeId, [number, number, number]> = {
  vale: [90, 143, 78],
  marsh: [92, 107, 70],
  peaks: [138, 143, 154],
  beach: [216, 200, 143],
  desert: [201, 168, 106],
  volcano: [107, 63, 56],
  cave: [70, 63, 74],
  dusk: [90, 79, 107],
  ember: [122, 69, 54],
  frost: [200, 214, 224],
  amber: [176, 122, 60],
  fen: [79, 107, 82],
  night: [58, 53, 80],
  haunt: [74, 69, 80],
  jungle: [63, 112, 64],
  garden: [111, 168, 94],
  gale: [127, 154, 143],
};
const WATER_DEEP: [number, number, number] = [30, 58, 92];
const WATER_SHALLOW: [number, number, number] = [47, 95, 134];

/**
 * Paint a top-down slice of the world into `cv` (which must be square). +X maps
 * to canvas-right, +Z to canvas-down. `step` px are filled per sample so a big
 * region stays cheap (terrainHeight dominates). Returns nothing; call again to
 * repaint after the region changes.
 */
export function renderTopDownMap(
  cv: HTMLCanvasElement,
  rect: MapRect,
  seed: number,
  step = 2,
  scene?: MapSceneOverlay,
): void {
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  const S = cv.width;
  const wl = waterLevel();
  const spanX = rect.maxX - rect.minX || 1;
  const spanZ = rect.maxZ - rect.minZ || 1;
  const transform = mapTransform(rect, S);
  const drawW = spanX * transform.scale;
  const drawH = spanZ * transform.scale;
  const img = ctx.createImageData(S, S);
  const data = img.data;
  for (let py = 0; py < S; py += step) {
    for (let px = 0; px < S; px += step) {
      const inside =
        px + 0.5 >= transform.offX &&
        px + 0.5 <= transform.offX + drawW &&
        py + 0.5 >= transform.offY &&
        py + 0.5 <= transform.offY + drawH;
      let r = 24;
      let g = 21;
      let b = 18;
      if (inside) {
        const x = rect.minX + (px + 0.5 - transform.offX) / transform.scale;
        const z = rect.minZ + (py + 0.5 - transform.offY) / transform.scale;
        const h = terrainHeight(x, z, seed);
        let c: [number, number, number];
        let shade = 1;
        if (h < wl) {
          c = h < wl - 6 ? WATER_DEEP : WATER_SHALLOW;
          shade = Math.max(0.72, 1 - (wl - h) * 0.015);
        } else {
          c = BIOME_HEX[biomeAt(x, z)] ?? BIOME_HEX.vale;
          // Elevation + north-west hillshade: the technical atlas reflects
          // actual height, cliffs and painted biome texture regions.
          const eps = Math.max(1, 2 / transform.scale);
          const east = terrainHeight(x + eps, z, seed);
          const south = terrainHeight(x, z + eps, seed);
          const relief = (h - east) * 0.045 + (h - south) * 0.035;
          const contourPhase = Math.abs((((((h - wl) / 8) % 1) + 1) % 1) - 0.5);
          const contour = contourPhase > 0.47 ? -0.08 : 0;
          shade = Math.max(0.56, Math.min(1.28, 0.84 + (h - wl) * 0.01 + relief + contour));
        }
        r = Math.min(255, c[0] * shade);
        g = Math.min(255, c[1] * shade);
        b = Math.min(255, c[2] * shade);
      }
      for (let dy = 0; dy < step && py + dy < S; dy++) {
        for (let dx = 0; dx < step && px + dx < S; dx++) {
          const o = ((py + dy) * S + (px + dx)) * 4;
          data[o] = r;
          data[o + 1] = g;
          data[o + 2] = b;
          data[o + 3] = 255;
        }
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  if (scene) drawSceneOverlay(ctx, scene, rect, S);
}

/** World (x,z) -> canvas (px,py) for a rect drawn into a square `S`-px canvas. */
export function worldToCanvas(
  x: number,
  z: number,
  rect: MapRect,
  S: number,
): { px: number; py: number } {
  const transform = mapTransform(rect, S);
  return {
    px: transform.offX + (x - rect.minX) * transform.scale,
    py: transform.offY + (z - rect.minZ) * transform.scale,
  };
}

/** Canvas (px,py) -> world (x,z), rejecting letterbox space outside the map. */
export function canvasToWorld(
  px: number,
  py: number,
  rect: MapRect,
  S: number,
): { x: number; z: number } | null {
  const transform = mapTransform(rect, S);
  const drawW = (rect.maxX - rect.minX) * transform.scale;
  const drawH = (rect.maxZ - rect.minZ) * transform.scale;
  if (
    px < transform.offX ||
    px > transform.offX + drawW ||
    py < transform.offY ||
    py > transform.offY + drawH
  ) {
    return null;
  }
  return {
    x: rect.minX + (px - transform.offX) / transform.scale,
    z: rect.minZ + (py - transform.offY) / transform.scale,
  };
}

function drawSceneOverlay(
  ctx: CanvasRenderingContext2D,
  scene: MapSceneOverlay,
  rect: MapRect,
  S: number,
): void {
  const transform = mapTransform(rect, S);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Authored roads are geography, not UI markers: draw a dark under-stroke and
  // warm center so paths remain legible over every biome.
  for (const road of scene.roads) {
    if (road.length < 2) continue;
    ctx.beginPath();
    road.forEach((point, index) => {
      const p = worldToCanvas(point.x, point.z, rect, S);
      if (index === 0) ctx.moveTo(p.px, p.py);
      else ctx.lineTo(p.px, p.py);
    });
    ctx.strokeStyle = 'rgba(47,32,18,.72)';
    ctx.lineWidth = Math.max(2, transform.scale * 3.2);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(210,176,116,.82)';
    ctx.lineWidth = Math.max(1, transform.scale * 1.5);
    ctx.stroke();
  }
  for (const placement of scene.placements) {
    if (placement.hidden) continue;
    if (
      placement.x < rect.minX ||
      placement.x > rect.maxX ||
      placement.z < rect.minZ ||
      placement.z > rect.maxZ
    ) {
      continue;
    }
    const p = worldToCanvas(placement.x, placement.z, rect, S);
    const natural = /tree|bush|grass|rock|plant/i.test(placement.assetId);
    const structural = /wall|house|tower|bridge|model\/custom/i.test(placement.assetId);
    ctx.beginPath();
    ctx.arc(
      p.px,
      p.py,
      Math.max(0.8, Math.min(4, placement.scale * transform.scale * 0.45)),
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = natural
      ? 'rgba(28,63,31,.82)'
      : structural
        ? 'rgba(73,52,35,.88)'
        : 'rgba(226,190,112,.78)';
    ctx.fill();
  }
  ctx.restore();
}

/** Draw a facing arrow marker for the camera on top of an already-painted map. */
export function drawCameraMarker(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  yaw: number,
  scale = 1,
): void {
  ctx.save();
  ctx.translate(px, py);
  // EditorCamera yaw 0 looks toward +Z (canvas-down). The glyph starts pointed
  // canvas-up, hence pi-yaw rather than applying the orbit angle directly.
  ctx.rotate(Math.PI - yaw);
  ctx.beginPath();
  ctx.moveTo(0, -7 * scale);
  ctx.lineTo(5 * scale, 6 * scale);
  ctx.lineTo(0, 3 * scale);
  ctx.lineTo(-5 * scale, 6 * scale);
  ctx.closePath();
  ctx.fillStyle = '#ffd23f';
  ctx.strokeStyle = '#1a1a1a';
  ctx.lineWidth = 1.5 * scale;
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

/** Draw the exact destination selected in the editor map window. */
export function drawMapPin(ctx: CanvasRenderingContext2D, px: number, py: number, scale = 1): void {
  ctx.save();
  ctx.translate(px, py);
  ctx.beginPath();
  ctx.arc(0, 0, 7 * scale, 0, Math.PI * 2);
  ctx.fillStyle = '#d9b84c';
  ctx.strokeStyle = '#171717';
  ctx.lineWidth = 2 * scale;
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-10 * scale, 0);
  ctx.lineTo(10 * scale, 0);
  ctx.moveTo(0, -10 * scale);
  ctx.lineTo(0, 10 * scale);
  ctx.strokeStyle = '#f3f3f1';
  ctx.lineWidth = 1.5 * scale;
  ctx.stroke();
  ctx.restore();
}

/** Outline every zone rect (full-world view) with a subtle border + label. */
export function drawZoneBoxes(
  ctx: CanvasRenderingContext2D,
  zones: readonly ZoneBox[],
  rect: MapRect,
  S: number,
): void {
  ctx.save();
  ctx.strokeStyle = 'rgba(255,255,255,0.28)';
  ctx.lineWidth = 1;
  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.82)';
  ctx.textAlign = 'center';
  const transform = mapTransform(rect, S);
  const narrow = (rect.maxX - rect.minX) * transform.scale < S * 0.58;
  for (const zn of zones) {
    const a = worldToCanvas(zn.minX, zn.minZ, rect, S);
    const b = worldToCanvas(zn.maxX, zn.maxZ, rect, S);
    ctx.strokeRect(a.px, a.py, b.px - a.px, b.py - a.py);
  }

  // Paint leaders and labels after every boundary so a later zone outline can
  // never strike through an earlier name on the narrow full-world atlas.
  let centerSide = -1;
  for (const zn of zones) {
    if (!zn.label) continue;
    const a = worldToCanvas(zn.minX, zn.minZ, rect, S);
    const b = worldToCanvas(zn.maxX, zn.maxZ, rect, S);
    const cx = (a.px + b.px) / 2;
    const cy = (a.py + b.py) / 2;
    let tx = cx;
    let align: CanvasTextAlign = 'center';
    if (narrow) {
      const zoneCenterX = (zn.minX + zn.maxX) / 2;
      const rectCenterX = (rect.minX + rect.maxX) / 2;
      let side = Math.sign(zoneCenterX - rectCenterX);
      if (side === 0) {
        side = centerSide;
        centerSide *= -1;
      }
      tx = side < 0 ? a.px - 8 : b.px + 8;
      align = side < 0 ? 'right' : 'left';
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(side < 0 ? a.px - 4 : b.px + 4, cy);
      ctx.strokeStyle = 'rgba(235,211,164,.52)';
      ctx.stroke();
    }
    ctx.textAlign = align;
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(12,10,8,.86)';
    ctx.strokeText(zn.label, tx, cy);
    ctx.fillText(zn.label, tx, cy);
  }
  ctx.restore();
}
