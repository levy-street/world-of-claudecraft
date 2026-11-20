// The raid atlas's illustrated page: the hand-drawn parchment map of one
// floor, rasterised from the field's own painted plan (raid_atlas_plan_core.ts
// picks the page's surfaces; field_map_view.ts derives them from the record the
// sim walks). Pure vector art in instance-local yards under one transform, so
// the same routine draws the whole-page plate once and, when the player zooms
// in past the plate's resolution, a sharp detail render of just the view.
//
// Layers, back to front: the parchment (its warm wash, its stains, its grain);
// the rock the veins are cut into (a soft umber halo round every floor); the
// cartographer's hachures down every cliff into the chasm; the floors in their
// area's wash with a ground texture, an inner bevel and an ink outline; stair
// treads; pillars and props; the gates; the veins' light-rivers; on the Heart's
// page the glow of the Smith's heart in the chasm and the four altars.
//
// Text-free (labels are the overlay's, at screen size). No literal colour: the
// caller passes the resolved palette. Deterministic: every jitter is hashed.

import {
  HEART_ALTARS,
  HEART_ROOM,
  HEART_ROOM_CHASM_R,
  SEAL_DAIS,
} from '../../../sim/content/smith_heart_layout';
import type { FieldMapSurface } from '../../field_map_view';
import {
  areaColorRole,
  atlasHash01,
  type RaidAtlasColors,
  veinColorRole,
} from './raid_atlas_palette_core';
import {
  type RaidAtlasFloor,
  type RaidAtlasPlan,
  raidAtlasAreaAt,
  raidAtlasFloorAt,
} from './raid_atlas_plan_core';

/** Where a render lands: `k` device px per yard and the page point (u, v) at
 *  the canvas's top-left corner. */
export interface RaidAtlasPageTransform {
  k: number;
  offU: number;
  offV: number;
}

const GRAIN_TILE = 192;
const STAIN_COUNT = 46;
const FIBRE_COUNT = 520;

let grainTile: HTMLCanvasElement | null = null;

/** A paper-grain tile (value noise, alpha only), minted once. */
function grain(): HTMLCanvasElement {
  if (grainTile) return grainTile;
  const c = document.createElement('canvas');
  c.width = GRAIN_TILE;
  c.height = GRAIN_TILE;
  const g = c.getContext('2d');
  if (g) {
    const img = g.createImageData(GRAIN_TILE, GRAIN_TILE);
    for (let y = 0; y < GRAIN_TILE; y++) {
      for (let x = 0; x < GRAIN_TILE; x++) {
        const fine = atlasHash01(x, y);
        const coarse = atlasHash01(x >> 2, (y >> 2) + 977);
        const v = fine * 0.55 + coarse * 0.45;
        const i = (y * GRAIN_TILE + x) * 4;
        img.data[i] = 0;
        img.data[i + 1] = 0;
        img.data[i + 2] = 0;
        img.data[i + 3] = Math.round(Math.max(0, v - 0.35) * 120);
      }
    }
    g.putImageData(img, 0, 0);
  }
  grainTile = c;
  return c;
}

function tracePolygon(ctx: CanvasRenderingContext2D, pts: readonly [number, number][]): void {
  const first = pts[0];
  if (!first) return;
  ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

function centroidOf(pts: readonly [number, number][]): { x: number; z: number } {
  let x = 0;
  let z = 0;
  for (const p of pts) {
    x += p[0];
    z += p[1];
  }
  return { x: x / Math.max(1, pts.length), z: z / Math.max(1, pts.length) };
}

/** Set the page transform: instance-local yards in, device px out (mirrored
 *  like the minimap: +x left, +z up). */
function pageSpace(
  ctx: CanvasRenderingContext2D,
  floor: RaidAtlasFloor,
  t: RaidAtlasPageTransform,
): void {
  const b = floor.bounds;
  ctx.setTransform(-t.k, 0, 0, -t.k, t.k * (b.maxX - t.offU), t.k * (b.maxZ - t.offV));
}

function paintParchment(
  ctx: CanvasRenderingContext2D,
  floor: RaidAtlasFloor,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
  w: number,
  h: number,
): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = c.parchment;
  ctx.fillRect(0, 0, w, h);
  // Page-anchored washes and stains (so a detail render matches the plate).
  pageSpace(ctx, floor, t);
  const b = floor.bounds;
  const span = b.maxX - b.minX;
  const cx = (b.minX + b.maxX) / 2;
  const cz = (b.minZ + b.maxZ) / 2;
  const light = ctx.createRadialGradient(cx, cz, span * 0.05, cx, cz, span * 0.62);
  light.addColorStop(0, c.parchmentLight);
  light.addColorStop(1, c.parchment);
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = light;
  ctx.fillRect(b.minX, b.minZ, span, span);
  for (let i = 0; i < STAIN_COUNT; i++) {
    const x = b.minX + atlasHash01(i, 11) * span;
    const z = b.minZ + atlasHash01(i, 23) * span;
    const r = span * (0.03 + atlasHash01(i, 37) * 0.11);
    const g = ctx.createRadialGradient(x, z, 0, x, z, r);
    g.addColorStop(0, i % 3 === 0 ? c.parchmentDark : c.stain);
    g.addColorStop(1, c.parchment);
    ctx.globalAlpha = 0.035 + atlasHash01(i, 41) * 0.06;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, z, r, 0, Math.PI * 2);
    ctx.fill();
  }
  // Paper fibres: hair-fine strokes laid every which way.
  ctx.strokeStyle = c.stain;
  ctx.lineWidth = Math.max(0.6, 0.9) / t.k;
  ctx.globalAlpha = 0.09;
  ctx.beginPath();
  for (let i = 0; i < FIBRE_COUNT; i++) {
    const x = b.minX + atlasHash01(i, 101) * span;
    const z = b.minZ + atlasHash01(i, 113) * span;
    const a = atlasHash01(i, 127) * Math.PI;
    const len = span * (0.004 + atlasHash01(i, 131) * 0.012);
    ctx.moveTo(x, z);
    ctx.quadraticCurveTo(
      x + Math.cos(a) * len * 0.5 + len * 0.2,
      z + Math.sin(a) * len * 0.5,
      x + Math.cos(a) * len,
      z + Math.sin(a) * len,
    );
  }
  ctx.stroke();
  // Grain in screen space (paper tooth stays fine at every zoom).
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const pat = ctx.createPattern(grain(), 'repeat');
  if (pat) {
    ctx.globalAlpha = 0.55;
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = pat;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
  ctx.globalAlpha = 1;
}

function surfacesOf(plan: RaidAtlasPlan, floor: RaidAtlasFloor): FieldMapSurface[] {
  return floor.surfaces.map((i) => plan.field.surfaces[i]);
}

/** The rock the veins are cut from: an umber mass round every floor,
 *  darkest at the floor's edge and fading out into the parchment, as the
 *  mountain round a carved hall is shaded on an old survey. */
function paintRock(
  ctx: CanvasRenderingContext2D,
  surfaces: readonly FieldMapSurface[],
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  const path = new Path2D();
  for (const s of surfaces) {
    const pts = s.points;
    if (!pts[0]) continue;
    path.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) path.lineTo(pts[i][0], pts[i][1]);
    path.closePath();
  }
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const passes: { w: number; role: 'rock' | 'abyss'; alpha: number; blur: number }[] = [
    { w: 52, role: 'rock', alpha: 0.2, blur: 22 },
    { w: 32, role: 'rock', alpha: 0.32, blur: 12 },
    { w: 16, role: 'abyss', alpha: 0.38, blur: 7 },
    { w: 6, role: 'abyss', alpha: 0.55, blur: 3 },
  ];
  for (const pass of passes) {
    ctx.globalAlpha = pass.alpha;
    ctx.strokeStyle = c[pass.role];
    ctx.fillStyle = c[pass.role];
    ctx.shadowColor = c[pass.role];
    // shadowBlur is in device px and ignores the transform.
    ctx.shadowBlur = Math.max(2, pass.blur * t.k);
    ctx.lineWidth = pass.w;
    ctx.stroke(path);
    ctx.fill(path);
  }
  ctx.restore();
}

/** Hachures: short ink strokes down every cliff, longer where it falls
 *  further (the classic cartographer's relief). */
function paintHachures(
  ctx: CanvasRenderingContext2D,
  plan: RaidAtlasPlan,
  floor: RaidAtlasFloor,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  ctx.strokeStyle = c.ink;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(0.7, 1.05) / t.k;
  ctx.globalAlpha = 0.5;
  ctx.beginPath();
  let n = 0;
  for (const cl of plan.field.cliffs) {
    const mx = (cl.ax + cl.bx) / 2;
    const mz = (cl.az + cl.bz) / 2;
    if (raidAtlasFloorAt(mx, mz) !== floor.id) continue;
    n++;
    if (cl.drop < 1.2) continue;
    const segLen = Math.hypot(cl.bx - cl.ax, cl.bz - cl.az);
    const ticks = Math.max(1, Math.round(segLen / 1.15));
    for (let k = 0; k < ticks; k++) {
      const f = (k + 0.5) / ticks;
      const x = cl.ax + (cl.bx - cl.ax) * f;
      const z = cl.az + (cl.bz - cl.az) * f;
      const j = atlasHash01(n * 7 + k, 503);
      const reach = Math.min(cl.intoVoid ? 9 : 5, 1.4 + Math.sqrt(cl.drop) * 0.9) * (0.6 + j * 0.6);
      // Alternate long and short strokes, as an engraver would.
      const len = k % 2 === 0 ? reach : reach * 0.55;
      ctx.moveTo(x + cl.nx * 0.4, z + cl.nz * 0.4);
      ctx.lineTo(x + cl.nx * len, z + cl.nz * len);
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function groundTexture(
  ctx: CanvasRenderingContext2D,
  s: FieldMapSurface,
  si: number,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  for (const [x, z] of s.points) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const hair = Math.max(0.55, 0.8) / t.k;
  ctx.lineWidth = hair;
  ctx.strokeStyle = c.inkSoft;
  ctx.fillStyle = c.inkSoft;
  ctx.beginPath();
  switch (s.ground) {
    case 'paving':
    case 'slate': {
      // Flagstones: offset courses of hand-ruled joints.
      const step = s.ground === 'paving' ? 3.2 : 4.4;
      ctx.globalAlpha = s.ground === 'paving' ? 0.2 : 0.14;
      let row = 0;
      for (let z = Math.floor(minZ / step) * step; z <= maxZ; z += step, row++) {
        ctx.moveTo(minX, z);
        ctx.lineTo(maxX, z);
        const off = (row % 2) * step * 0.5;
        for (let x = Math.floor(minX / step) * step + off; x <= maxX; x += step * 1.4) {
          ctx.moveTo(x, z);
          ctx.lineTo(x, z + step);
        }
      }
      ctx.stroke();
      break;
    }
    case 'quarry': {
      // Broken rubble: stippled chips.
      ctx.globalAlpha = 0.32;
      const area = (maxX - minX) * (maxZ - minZ);
      const dots = Math.min(1600, Math.round(area / 9));
      for (let i = 0; i < dots; i++) {
        const x = minX + atlasHash01(i, si * 31 + 1) * (maxX - minX);
        const z = minZ + atlasHash01(i, si * 31 + 2) * (maxZ - minZ);
        const r = 0.18 + atlasHash01(i, si * 31 + 3) * 0.35;
        ctx.moveTo(x + r, z);
        ctx.arc(x, z, r, 0, Math.PI * 2);
      }
      ctx.fill();
      break;
    }
    case 'scoured': {
      // Wind-scoured rock: long sweeping strokes.
      ctx.globalAlpha = 0.2;
      for (let z = minZ; z <= maxZ; z += 3.1) {
        const j = atlasHash01(Math.round(z * 10), si);
        ctx.moveTo(minX, z + j);
        ctx.bezierCurveTo(
          minX + (maxX - minX) * 0.33,
          z - 1.6 + j,
          minX + (maxX - minX) * 0.66,
          z + 1.6 + j,
          maxX,
          z + j,
        );
      }
      ctx.stroke();
      break;
    }
    case 'rime':
    case 'lake_ice': {
      // Crazed ice: branching cracks.
      ctx.globalAlpha = s.ground === 'lake_ice' ? 0.3 : 0.22;
      const area = (maxX - minX) * (maxZ - minZ);
      const cracks = Math.min(140, Math.round(area / 60));
      for (let i = 0; i < cracks; i++) {
        let x = minX + atlasHash01(i, si * 17 + 5) * (maxX - minX);
        let z = minZ + atlasHash01(i, si * 17 + 6) * (maxZ - minZ);
        let a = atlasHash01(i, si * 17 + 7) * Math.PI * 2;
        ctx.moveTo(x, z);
        for (let k = 0; k < 4; k++) {
          const len = 2 + atlasHash01(i * 5 + k, si) * 4;
          a += (atlasHash01(i * 9 + k, si + 3) - 0.5) * 1.6;
          x += Math.cos(a) * len;
          z += Math.sin(a) * len;
          ctx.lineTo(x, z);
        }
      }
      ctx.stroke();
      break;
    }
    case 'hearth': {
      // Scorched ground: ember flecks.
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = c.veinHeat;
      const area = (maxX - minX) * (maxZ - minZ);
      const dots = Math.min(900, Math.round(area / 14));
      for (let i = 0; i < dots; i++) {
        const x = minX + atlasHash01(i, si * 13 + 8) * (maxX - minX);
        const z = minZ + atlasHash01(i, si * 13 + 9) * (maxZ - minZ);
        const r = 0.15 + atlasHash01(i, si * 13 + 10) * 0.3;
        ctx.moveTo(x + r, z);
        ctx.arc(x, z, r, 0, Math.PI * 2);
      }
      ctx.fill();
      break;
    }
    case 'ritual': {
      // Rune circles round the floor's heart.
      const ctr = centroidOf(s.points);
      ctx.globalAlpha = 0.28;
      ctx.strokeStyle = c.goldDeep;
      const reach = Math.max(maxX - minX, maxZ - minZ) / 2;
      for (let r = reach * 0.25; r < reach; r += reach * 0.18) {
        ctx.moveTo(ctr.x + r, ctr.z);
        ctx.arc(ctr.x, ctr.z, r, 0, Math.PI * 2);
      }
      for (let i = 0; i < 16; i++) {
        const a = (i / 16) * Math.PI * 2;
        ctx.moveTo(ctr.x + Math.cos(a) * reach * 0.25, ctr.z + Math.sin(a) * reach * 0.25);
        ctx.lineTo(ctr.x + Math.cos(a) * reach * 0.9, ctr.z + Math.sin(a) * reach * 0.9);
      }
      ctx.stroke();
      break;
    }
    default:
      break;
  }
  ctx.globalAlpha = 1;
}

function paintFloors(
  ctx: CanvasRenderingContext2D,
  plan: RaidAtlasPlan,
  floor: RaidAtlasFloor,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  const field = plan.field;
  const span = Math.max(1, field.heightMax - field.heightMin);
  for (const si of floor.surfaces) {
    const s = field.surfaces[si];
    const ctr = centroidOf(s.points);
    const area = raidAtlasAreaAt(ctr.x, ctr.z);
    // The wash: the area's colour, lifted toward the light by height.
    ctx.beginPath();
    tracePolygon(ctx, s.points);
    ctx.globalAlpha = 1;
    ctx.fillStyle = c[areaColorRole(area)];
    ctx.fill();
    const lift = (s.h - field.heightMin) / span;
    ctx.globalAlpha = 0.1 + lift * 0.32;
    ctx.fillStyle = c.parchmentLight;
    ctx.fill();
    ctx.save();
    ctx.clip();
    groundTexture(ctx, s, si, t, c);
    // Inner bevel: the floor's edge darkens into its rim.
    ctx.beginPath();
    tracePolygon(ctx, s.points);
    ctx.strokeStyle = c.ink;
    ctx.globalAlpha = 0.16;
    ctx.lineWidth = 3.4;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.restore();
    // The ink line: a firm outline with a fainter second pass, slightly
    // offset, as a pen goes round twice.
    ctx.beginPath();
    tracePolygon(ctx, s.points);
    ctx.lineJoin = 'round';
    ctx.strokeStyle = c.ink;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = Math.max(1.3, 1.7) / t.k;
    ctx.stroke();
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = Math.max(0.8, 1) / t.k;
    ctx.save();
    ctx.translate(0.35, -0.25);
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function paintTreads(
  ctx: CanvasRenderingContext2D,
  plan: RaidAtlasPlan,
  floor: RaidAtlasFloor,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  ctx.strokeStyle = c.ink;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = Math.max(0.8, 1) / t.k;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  for (const tr of plan.field.treads) {
    if (raidAtlasFloorAt((tr.ax + tr.bx) / 2, (tr.az + tr.bz) / 2) !== floor.id) continue;
    ctx.moveTo(tr.ax, tr.az);
    ctx.lineTo(tr.bx, tr.bz);
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function paintProps(
  ctx: CanvasRenderingContext2D,
  plan: RaidAtlasPlan,
  floor: RaidAtlasFloor,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  const line = Math.max(0.9, 1.2) / t.k;
  for (const p of plan.field.props) {
    if (raidAtlasFloorAt(p.x, p.z) !== floor.id) continue;
    ctx.beginPath();
    if (p.r !== null) {
      // A pillar: a shaded drum with a lit crown.
      ctx.arc(p.x, p.z, Math.max(0.6, p.r), 0, Math.PI * 2);
    } else if (p.corners) {
      tracePolygon(ctx, p.corners);
    } else continue;
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = c.rock;
    ctx.fill();
    ctx.globalAlpha = 0.9;
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = line;
    ctx.stroke();
    if (p.r !== null) {
      ctx.beginPath();
      ctx.arc(p.x + p.r * 0.25, p.z + p.r * 0.25, Math.max(0.3, p.r * 0.45), 0, Math.PI * 2);
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = c.parchmentLight;
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function paintGates(
  ctx: CanvasRenderingContext2D,
  plan: RaidAtlasPlan,
  floor: RaidAtlasFloor,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  ctx.lineCap = 'round';
  for (const g of plan.field.gates) {
    if (raidAtlasFloorAt((g.ax + g.bx) / 2, (g.az + g.bz) / 2) !== floor.id) continue;
    ctx.beginPath();
    ctx.moveTo(g.ax, g.az);
    ctx.lineTo(g.bx, g.bz);
    ctx.strokeStyle = c.ink;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = Math.max(3, 4) / t.k + 0.9;
    ctx.stroke();
    ctx.strokeStyle = c.gold;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = Math.max(1.2, 1.5) / t.k + 0.25;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function paintRivers(
  ctx: CanvasRenderingContext2D,
  floor: RaidAtlasFloor,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const r of floor.rivers) {
    const color = c[veinColorRole(r.vein)];
    ctx.beginPath();
    r.points.forEach((p, i) => {
      if (i === 0) ctx.moveTo(p.x, p.z);
      else ctx.lineTo(p.x, p.z);
    });
    // A soft halo, then a dotted line of light, the path to the guardian.
    ctx.strokeStyle = color;
    ctx.setLineDash([]);
    ctx.globalAlpha = 0.28;
    ctx.lineWidth = 4.2;
    ctx.stroke();
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = Math.max(1.6, 2.4) / t.k + 0.45;
    ctx.setLineDash([2.4, 2.2]);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

/** The Heart's page: the Smith's heart glowing in the chasm under the Anvil. */
function paintHeartGlow(ctx: CanvasRenderingContext2D, c: RaidAtlasColors): void {
  const g = ctx.createRadialGradient(
    HEART_ROOM.x,
    HEART_ROOM.z,
    HEART_ROOM.r * 0.4,
    HEART_ROOM.x,
    HEART_ROOM.z,
    HEART_ROOM_CHASM_R * 1.05,
  );
  g.addColorStop(0, c.goldWhite);
  g.addColorStop(0.5, c.heartGlow);
  g.addColorStop(0.78, c.veinHeat);
  g.addColorStop(1, c.parchment);
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(HEART_ROOM.x, HEART_ROOM.z, HEART_ROOM_CHASM_R * 1.05, 0, Math.PI * 2);
  ctx.fill();
  // The chasm's rim, inked.
  ctx.globalAlpha = 0.35;
  ctx.strokeStyle = c.abyss;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([3, 2]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function paintAltars(
  ctx: CanvasRenderingContext2D,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  for (const a of HEART_ALTARS) {
    ctx.beginPath();
    ctx.arc(a.x, a.z, 3.4, 0, Math.PI * 2);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = c[veinColorRole(a.vein)];
    ctx.fill();
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = Math.max(1.2, 1.5) / t.k;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(a.x, a.z, 5.2, 0, Math.PI * 2);
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = c.goldDeep;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** The seal on its dais: four rings of runes in gold. */
function paintSeal(
  ctx: CanvasRenderingContext2D,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  ctx.strokeStyle = c.goldDeep;
  ctx.lineWidth = Math.max(1, 1.3) / t.k;
  ctx.globalAlpha = 0.75;
  for (const r of [SEAL_DAIS.r * 0.28, SEAL_DAIS.r * 0.5, SEAL_DAIS.r * 0.78]) {
    ctx.beginPath();
    ctx.arc(SEAL_DAIS.x, SEAL_DAIS.z, r, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.moveTo(
      SEAL_DAIS.x + Math.cos(a) * SEAL_DAIS.r * 0.28,
      SEAL_DAIS.z + Math.sin(a) * SEAL_DAIS.r * 0.28,
    );
    ctx.lineTo(
      SEAL_DAIS.x + Math.cos(a) * SEAL_DAIS.r * 0.78,
      SEAL_DAIS.z + Math.sin(a) * SEAL_DAIS.r * 0.78,
    );
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

/**
 * Paint one page into `ctx` (a `w` by `h` device-px canvas) under `t`.
 * Draws everything the page shows except the live layer and the labels.
 */
export function paintRaidAtlasPage(
  ctx: CanvasRenderingContext2D,
  plan: RaidAtlasPlan,
  floor: RaidAtlasFloor,
  colors: RaidAtlasColors,
  t: RaidAtlasPageTransform,
  w: number,
  h: number,
): void {
  ctx.save();
  paintParchment(ctx, floor, t, colors, w, h);
  pageSpace(ctx, floor, t);
  const surfaces = surfacesOf(plan, floor);
  paintRock(ctx, surfaces, t, colors);
  // The heart's glow rises out of the chasm OVER the mountain's shade.
  if (floor.id === 'heart') paintHeartGlow(ctx, colors);
  paintHachures(ctx, plan, floor, t, colors);
  paintFloors(ctx, plan, floor, t, colors);
  paintTreads(ctx, plan, floor, t, colors);
  paintProps(ctx, plan, floor, t, colors);
  paintGates(ctx, plan, floor, t, colors);
  if (floor.id === 'veins') paintSeal(ctx, t, colors);
  paintRivers(ctx, floor, t, colors);
  if (floor.id === 'heart') paintAltars(ctx, t, colors);
  ctx.restore();
}
