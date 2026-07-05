// Canvas painter for the map editor. Thin: it reads the camera, entities, and
// roads and draws them; it owns no editing state. All hit-testing and math live in
// view.ts, so this stays a pure render pass over the current model.

import type { BiomePaint, BlockerDef, HeightStamp } from '../sim/types';
import type { AssetPlacement } from './custom_map';
import type { EditorEntity, EntityKind } from './model';
import type { Camera, Vec2, Viewport } from './view';

// 2D overlay colours per biome id, matching world.ts BIOME_BY_ID order
// (0=vale, 1=marsh, 2=peaks, 3=beach, 4=desert, 5=volcano, 6=cave).
const BIOME_PAINT_COLOR = [
  'rgba(90,170,80,0.35)',
  'rgba(120,95,55,0.4)',
  'rgba(150,155,165,0.4)',
  'rgba(216,194,122,0.4)',
  'rgba(207,144,64,0.4)',
  'rgba(176,64,48,0.4)',
  'rgba(74,74,85,0.45)',
];

type Roads = readonly (readonly Vec2[])[];

export interface BrushCursor {
  x: number;
  z: number;
  radius: number;
  raise: boolean;
}

const KIND_COLOR: Record<EntityKind, string> = {
  hub: '#ffd100',
  graveyard: '#9aa7b4',
  lake: '#2f6f9f',
  poi: '#e8c170',
  camp: '#d9534f',
  npc: '#5fb35f',
  object: '#b07cc6',
};

export interface DrawState {
  entities: readonly EditorEntity[];
  roads: Roads;
  selectedKey: string | null;
  hoverKey: string | null;
  terrainEdits: readonly HeightStamp[];
  placements: readonly AssetPlacement[];
  biomePaint: BiomePaint | null;
  blockers: readonly BlockerDef[];
  blockerPreview: BlockerDef | null;
  region: { minX: number; minZ: number; maxX: number; maxZ: number } | null;
  brush: BrushCursor | null;
  spawn: Vec2 | null;
}

export function draw(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  state: DrawState,
): void {
  ctx.save();
  ctx.clearRect(0, 0, vp.width, vp.height);
  ctx.fillStyle = '#0c0f14';
  ctx.fillRect(0, 0, vp.width, vp.height);

  drawGrid(ctx, cam, vp);
  if (state.biomePaint) drawBiomePaint(ctx, cam, vp, state.biomePaint);
  drawTerrainEdits(ctx, cam, vp, state.terrainEdits);
  drawRoads(ctx, cam, vp, state.roads);

  // Filled areas (lakes, hub) first so point markers sit on top of them.
  for (const e of state.entities) {
    if (e.kind === 'lake' || e.kind === 'hub') drawArea(ctx, cam, vp, e);
  }
  for (const e of state.entities) {
    if (e.kind === 'lake' || e.kind === 'hub') continue;
    drawMarker(ctx, cam, vp, e, e.key === state.selectedKey, e.key === state.hoverKey);
  }
  // Selected area markers get their outline re-stroked on top for visibility.
  for (const e of state.entities) {
    if ((e.kind === 'lake' || e.kind === 'hub') && e.key === state.selectedKey) {
      drawAreaSelection(ctx, cam, vp, e);
    }
  }
  drawBlockers(ctx, cam, vp, state.blockers, state.blockerPreview);
  drawPlacements(ctx, cam, vp, state.placements);
  if (state.region) {
    const a = cam.worldToScreen({ x: state.region.minX, z: state.region.minZ }, vp);
    const b = cam.worldToScreen({ x: state.region.maxX, z: state.region.maxZ }, vp);
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#ffd100';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(a.sx, a.sy, b.sx - a.sx, b.sy - a.sy);
    ctx.fillStyle = 'rgba(255,209,0,0.08)';
    ctx.fillRect(a.sx, a.sy, b.sx - a.sx, b.sy - a.sy);
    ctx.restore();
  }
  if (state.spawn) drawSpawn(ctx, cam, vp, state.spawn);
  if (state.brush) drawBrush(ctx, cam, vp, state.brush);
  ctx.restore();
}

// The playtest spawn point: a cyan ring + dot so it reads apart from markers.
function drawSpawn(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, spawn: Vec2): void {
  const c = cam.worldToScreen(spawn, vp);
  ctx.save();
  ctx.beginPath();
  ctx.arc(c.sx, c.sy, Math.max(5, 1.6 * cam.pxPerYard), 0, Math.PI * 2);
  ctx.strokeStyle = '#3fd0ff';
  ctx.lineWidth = 2;
  ctx.stroke();
  drawDot(ctx, c, 3, '#3fd0ff');
  ctx.restore();
}

// Biome paint: a translucent coloured square per painted cell.
function drawBiomePaint(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  bp: BiomePaint,
): void {
  const sizePx = bp.cell * cam.pxPerYard;
  if (sizePx < 0.5) return;
  ctx.save();
  for (let row = 0; row < bp.rows; row++) {
    for (let col = 0; col < bp.cols; col++) {
      const id = bp.ids[row * bp.cols + col];
      if (id < 0 || id >= BIOME_PAINT_COLOR.length) continue;
      const wx = bp.originX + col * bp.cell;
      const wz = bp.originZ + row * bp.cell;
      const s = cam.worldToScreen({ x: wx, z: wz }, vp);
      if (s.sx + sizePx < 0 || s.sx > vp.width || s.sy + sizePx < 0 || s.sy > vp.height) continue;
      ctx.fillStyle = BIOME_PAINT_COLOR[id];
      ctx.fillRect(s.sx, s.sy, sizePx + 1, sizePx + 1);
    }
  }
  ctx.restore();
}

// Invisible blocker walls: a red segment per wall (dashed while previewing a
// drag), following the roads stroke pattern above.
function drawBlockers(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  blockers: readonly BlockerDef[],
  preview: BlockerDef | null,
): void {
  if (blockers.length === 0 && !preview) return;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(224,80,60,0.9)';
  for (const b of blockers) {
    const a = cam.worldToScreen({ x: b.x1, z: b.z1 }, vp);
    const c = cam.worldToScreen({ x: b.x2, z: b.z2 }, vp);
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(c.sx, c.sy);
    ctx.stroke();
  }
  if (preview) {
    ctx.setLineDash([6, 4]);
    const a = cam.worldToScreen({ x: preview.x1, z: preview.z1 }, vp);
    const c = cam.worldToScreen({ x: preview.x2, z: preview.z2 }, vp);
    ctx.beginPath();
    ctx.moveTo(a.sx, a.sy);
    ctx.lineTo(c.sx, c.sy);
    ctx.stroke();
  }
  ctx.restore();
}

// Placed GLB assets: a magenta diamond per placement, labelled at high zoom.
function drawPlacements(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  placements: readonly AssetPlacement[],
): void {
  ctx.save();
  for (const p of placements) {
    const c = cam.worldToScreen(p, vp);
    if (c.sx < -20 || c.sx > vp.width + 20 || c.sy < -20 || c.sy > vp.height + 20) continue;
    const r = 5;
    ctx.beginPath();
    ctx.moveTo(c.sx, c.sy - r);
    ctx.lineTo(c.sx + r, c.sy);
    ctx.lineTo(c.sx, c.sy + r);
    ctx.lineTo(c.sx - r, c.sy);
    ctx.closePath();
    ctx.fillStyle = '#e070d0';
    ctx.fill();
    ctx.strokeStyle = '#0c0f14';
    ctx.lineWidth = 1;
    ctx.stroke();
    if (cam.pxPerYard >= 4) {
      const label = p.assetId.split('/').pop() ?? p.assetId;
      drawLabel(ctx, c, label);
    }
  }
  ctx.restore();
}

// Additive height edits: a translucent disc per stamp, warm for raise, cool for
// lower, so overlapping stamps read as accumulated elevation by opacity.
// The radial gradient is pre-rendered ONCE into two small offscreen sprites
// (raise/lower) and blitted scaled: building a fresh createRadialGradient per
// stamp per repaint burned the whole redraw budget on gradient churn.
const EDIT_SPRITE_SIZE = 96;
let editSprites: { raise: HTMLCanvasElement; lower: HTMLCanvasElement } | null = null;

function makeEditSprite(col: string): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = EDIT_SPRITE_SIZE;
  c.height = EDIT_SPRITE_SIZE;
  const sctx = c.getContext('2d');
  if (!sctx) return c;
  const half = EDIT_SPRITE_SIZE / 2;
  const grad = sctx.createRadialGradient(half, half, 0, half, half, half);
  grad.addColorStop(0, `rgba(${col},0.22)`);
  grad.addColorStop(1, `rgba(${col},0)`);
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, EDIT_SPRITE_SIZE, EDIT_SPRITE_SIZE);
  return c;
}

function drawTerrainEdits(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  edits: readonly HeightStamp[],
): void {
  if (!editSprites) {
    editSprites = { raise: makeEditSprite('255,150,60'), lower: makeEditSprite('70,150,230') };
  }
  ctx.save();
  for (const e of edits) {
    const c = cam.worldToScreen(e, vp);
    const r = e.radius * cam.pxPerYard;
    if (c.sx + r < 0 || c.sx - r > vp.width || c.sy + r < 0 || c.sy - r > vp.height) continue;
    const sprite = e.delta >= 0 ? editSprites.raise : editSprites.lower;
    const rr = Math.max(1, r);
    ctx.drawImage(sprite, c.sx - rr, c.sy - rr, rr * 2, rr * 2);
  }
  ctx.restore();
}

function drawBrush(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  brush: BrushCursor,
): void {
  const c = cam.worldToScreen(brush, vp);
  const r = brush.radius * cam.pxPerYard;
  ctx.save();
  ctx.beginPath();
  ctx.arc(c.sx, c.sy, r, 0, Math.PI * 2);
  ctx.strokeStyle = brush.raise ? 'rgba(255,170,90,0.9)' : 'rgba(110,180,255,0.9)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(c.sx - 6, c.sy);
  ctx.lineTo(c.sx + 6, c.sy);
  if (brush.raise) {
    ctx.moveTo(c.sx, c.sy - 6);
    ctx.lineTo(c.sx, c.sy + 6);
  }
  ctx.stroke();
  ctx.restore();
}

function drawGrid(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport): void {
  // Grid spacing in yards, chosen so lines stay roughly 60-120px apart at any zoom.
  const targetPx = 80;
  const rawStep = targetPx / cam.pxPerYard;
  const step = niceStep(rawStep);
  const tl = cam.screenToWorld({ sx: 0, sy: 0 }, vp);
  const br = cam.screenToWorld({ sx: vp.width, sy: vp.height }, vp);
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#161b22';
  ctx.fillStyle = '#3a424d';
  ctx.font = '10px monospace';
  ctx.beginPath();
  for (let x = Math.ceil(tl.x / step) * step; x <= br.x; x += step) {
    const s = cam.worldToScreen({ x, z: 0 }, vp);
    ctx.moveTo(s.sx, 0);
    ctx.lineTo(s.sx, vp.height);
  }
  for (let z = Math.ceil(tl.z / step) * step; z <= br.z; z += step) {
    const s = cam.worldToScreen({ x: 0, z }, vp);
    ctx.moveTo(0, s.sy);
    ctx.lineTo(vp.width, s.sy);
  }
  ctx.stroke();
  // Origin axes, brighter.
  const o = cam.worldToScreen({ x: 0, z: 0 }, vp);
  ctx.strokeStyle = '#2b3a4a';
  ctx.beginPath();
  ctx.moveTo(o.sx, 0);
  ctx.lineTo(o.sx, vp.height);
  ctx.moveTo(0, o.sy);
  ctx.lineTo(vp.width, o.sy);
  ctx.stroke();
}

function drawRoads(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, roads: Roads): void {
  ctx.strokeStyle = '#4a3f2e';
  ctx.lineWidth = Math.max(1, 3 * cam.pxPerYard * 0.5);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const road of roads) {
    if (road.length < 2) continue;
    ctx.beginPath();
    road.forEach((p, i) => {
      const s = cam.worldToScreen(p, vp);
      if (i === 0) ctx.moveTo(s.sx, s.sy);
      else ctx.lineTo(s.sx, s.sy);
    });
    ctx.stroke();
  }
}

function drawArea(ctx: CanvasRenderingContext2D, cam: Camera, vp: Viewport, e: EditorEntity): void {
  const c = cam.worldToScreen(e.point, vp);
  const r = e.radius * cam.pxPerYard;
  ctx.beginPath();
  ctx.arc(c.sx, c.sy, r, 0, Math.PI * 2);
  ctx.fillStyle = e.kind === 'lake' ? 'rgba(47,111,159,0.35)' : 'rgba(255,209,0,0.12)';
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = KIND_COLOR[e.kind];
  ctx.stroke();
}

function drawAreaSelection(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  e: EditorEntity,
): void {
  const c = cam.worldToScreen(e.point, vp);
  ctx.beginPath();
  ctx.arc(c.sx, c.sy, e.radius * cam.pxPerYard, 0, Math.PI * 2);
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  drawDot(ctx, c, 4, '#ffffff');
  drawLabel(ctx, c, e.label);
}

function drawMarker(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  vp: Viewport,
  e: EditorEntity,
  selected: boolean,
  hover: boolean,
): void {
  const c = cam.worldToScreen(e.point, vp);
  if (e.kind === 'camp') {
    // Show the camp's spawn radius as a faint ring around the spawn centre.
    ctx.beginPath();
    ctx.arc(c.sx, c.sy, e.radius * cam.pxPerYard, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(217,83,79,0.4)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  const baseR = selected ? 6 : hover ? 5 : 4;
  drawDot(ctx, c, baseR + 1.5, '#0c0f14'); // dark halo for contrast on roads/lakes
  drawDot(ctx, c, baseR, KIND_COLOR[e.kind]);
  if (selected) {
    ctx.beginPath();
    ctx.arc(c.sx, c.sy, baseR + 3, 0, Math.PI * 2);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  // Labels are dense; show them only when zoomed in, on hover, or when selected.
  if (selected || hover || cam.pxPerYard >= 3) drawLabel(ctx, c, e.label);
}

function drawDot(
  ctx: CanvasRenderingContext2D,
  c: { sx: number; sy: number },
  r: number,
  fill: string,
): void {
  ctx.beginPath();
  ctx.arc(c.sx, c.sy, r, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  c: { sx: number; sy: number },
  text: string,
): void {
  ctx.font = '11px monospace';
  const w = ctx.measureText(text).width;
  const x = c.sx + 8;
  const y = c.sy - 8;
  ctx.fillStyle = 'rgba(8,10,14,0.78)';
  ctx.fillRect(x - 2, y - 10, w + 4, 14);
  ctx.fillStyle = '#e8eef4';
  ctx.fillText(text, x, y);
}

// Round a raw spacing up to the nearest 1/2/5 x 10^n so grid lines land on
// readable yard values.
function niceStep(raw: number): number {
  const pow = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / pow;
  const step = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return step * pow;
}

export { KIND_COLOR };
