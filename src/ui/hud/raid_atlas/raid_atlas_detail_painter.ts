// The raid atlas's fine detail, inked: the rooms' line features of the
// drawing plan raid_atlas_detail_core.ts derives from the raid's content (the
// Pour Channel's molten run, the Frozen Lake's shorelines, the Cornice's wind,
// the Wind Bridge's arch, the Islands of the Wind, the Ring's processional).
// The Heart's floor plan is raid_atlas_heart_painter.ts and the landmarks
// raid_atlas_landmark_painter.ts. Everything draws in the page's own space, so
// the plate, a sharp zoomed render and the minimap's detail tile share it;
// `t.k` (device px per yard) decides which tier shows. Painted once per plate
// or settled view, never per frame. No literal colour: the palette comes in.

import {
  type RaidAtlasFloorDetail,
  type RaidAtlasStroke,
  raidAtlasDrawsTier,
} from './raid_atlas_detail_core';
import { pen, polyline } from './raid_atlas_ink';
import type { RaidAtlasPageTransform } from './raid_atlas_page_painter';
import { atlasHash01, type RaidAtlasColors } from './raid_atlas_palette_core';

type Ctx = CanvasRenderingContext2D;

function paintMolten(
  ctx: Ctx,
  s: RaidAtlasStroke,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  ctx.lineCap = 'round';
  ctx.beginPath();
  polyline(ctx, s.points, s.closed);
  ctx.strokeStyle = c.ink;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = s.width + pen(t, 2.4);
  ctx.stroke();
  ctx.strokeStyle = c[s.tone];
  ctx.globalAlpha = 1;
  ctx.lineWidth = s.width;
  ctx.stroke();
  ctx.strokeStyle = c.heartGlow;
  ctx.lineWidth = s.width * 0.55;
  ctx.stroke();
  ctx.strokeStyle = c.goldWhite;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = s.width * 0.18;
  ctx.stroke();
  // The crust: dark flakes riding the flow.
  if (raidAtlasDrawsTier('fine', t.k)) {
    const [a, b] = [s.points[0], s.points[s.points.length - 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.round(len / 2.2);
    ctx.fillStyle = c.abyss;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const f = (i + atlasHash01(i, 211)) / n;
      const side = (atlasHash01(i, 223) - 0.5) * s.width * 0.6;
      const x = a[0] + (b[0] - a[0]) * f + side;
      const z = a[1] + (b[1] - a[1]) * f;
      const r = 0.25 + atlasHash01(i, 227) * 0.3;
      ctx.moveTo(x + r, z);
      ctx.arc(x, z, r, 0, Math.PI * 2);
    }
    ctx.fill();
  }
}

function paintShoreline(
  ctx: Ctx,
  s: RaidAtlasStroke,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
  i: number,
): void {
  ctx.beginPath();
  polyline(ctx, s.points, s.closed);
  ctx.strokeStyle = c[s.tone];
  ctx.globalAlpha = Math.max(0.22, 0.7 - i * 0.14);
  ctx.lineWidth = pen(t, i === 0 ? 1.6 : 1.1);
  if (i >= 2) ctx.setLineDash([pen(t, 6), pen(t, 4)]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function paintWindChannel(
  ctx: Ctx,
  s: RaidAtlasStroke,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  // The notch itself is the Cornice's own outline; the wind is drawn here.
  // The updraft: three gust strokes blowing in from the notch's point over
  // the plateau, each ending in a curl (the old charts' wind).
  const tip = s.points[1];
  const l = s.points[0];
  const r = s.points[2];
  if (!tip || !l || !r) return;
  const mx = (l[0] + r[0]) / 2;
  const mz = (l[1] + r[1]) / 2;
  const dx = tip[0] - mx;
  const dz = tip[1] - mz;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const nx = -uz;
  const nz = ux;
  const reach = Math.min(10, len * 0.75);
  const gap = reach * 0.22;
  ctx.beginPath();
  for (const k of [-1, 0, 1]) {
    const run = reach * (k === 0 ? 1 : 0.72);
    const sx = tip[0] + nx * gap * k + ux * 1.5;
    const sz = tip[1] + nz * gap * k + uz * 1.5;
    const ex = sx + ux * run;
    const ez = sz + uz * run;
    const wob = gap * 0.45;
    ctx.moveTo(sx, sz);
    ctx.bezierCurveTo(
      sx + ux * run * 0.33 + nx * wob,
      sz + uz * run * 0.33 + nz * wob,
      sx + ux * run * 0.66 - nx * wob,
      sz + uz * run * 0.66 - nz * wob,
      ex,
      ez,
    );
    if (k === 0) {
      // The curl at the lead stroke's end.
      const cr = gap * 0.55;
      const cx = ex + nx * cr;
      const cz = ez + nz * cr;
      const a0 = Math.atan2(ez - cz, ex - cx);
      ctx.arc(cx, cz, cr, a0, a0 + Math.PI * 1.5, nx * uz - nz * ux > 0);
    }
  }
  ctx.strokeStyle = c[s.tone];
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = pen(t, 1.5);
  ctx.lineCap = 'round';
  ctx.stroke();
}

function paintArch(
  ctx: Ctx,
  s: RaidAtlasStroke,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  const a = s.points[0];
  const b = s.points[s.points.length - 1];
  if (!a || !b) return;
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  const nx = -uz;
  const nz = ux;
  const hw = s.width / 2;
  // The arch's two edges, and voussoir joints laid across each.
  ctx.strokeStyle = c.ink;
  ctx.lineCap = 'butt';
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = pen(t, 1.3);
  ctx.beginPath();
  const step = 1.7;
  for (let d = step * 0.5; d < len; d += step) {
    for (const side of [-1, 1]) {
      const ex = a[0] + ux * d + nx * hw * side;
      const ez = a[1] + uz * d + nz * hw * side;
      ctx.moveTo(ex, ez);
      ctx.lineTo(ex - nx * side * 1.3, ez - nz * side * 1.3);
    }
  }
  ctx.stroke();
}

function paintIsle(
  ctx: Ctx,
  s: RaidAtlasStroke,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  ctx.beginPath();
  polyline(ctx, s.points, true);
  ctx.globalAlpha = 0.22;
  ctx.fillStyle = c.rock;
  ctx.fill();
  ctx.strokeStyle = c[s.tone];
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = pen(t, 1.4);
  ctx.setLineDash([pen(t, 5), pen(t, 4)]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function paintInlay(
  ctx: Ctx,
  s: RaidAtlasStroke,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  // Two gilded edges with a dotted rune course between them.
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  polyline(ctx, s.points, s.closed);
  ctx.strokeStyle = c.goldDeep;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = s.width + pen(t, 1.2);
  ctx.stroke();
  ctx.strokeStyle = c.parchmentLight;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = s.width;
  ctx.stroke();
  ctx.strokeStyle = c[s.tone];
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = s.width * 0.45;
  ctx.setLineDash([s.width * 0.45, s.width * 1.3]);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** The rooms' line features, over their floors. */
export function paintDetailStrokes(
  ctx: Ctx,
  detail: RaidAtlasFloorDetail,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  ctx.save();
  let shore = 0;
  for (const s of detail.strokes) {
    if (!raidAtlasDrawsTier(s.tier, t.k)) continue;
    switch (s.kind) {
      case 'molten':
        paintMolten(ctx, s, t, c);
        break;
      case 'shoreline':
        paintShoreline(ctx, s, t, c, shore++);
        break;
      case 'windChannel':
        paintWindChannel(ctx, s, t, c);
        break;
      case 'arch':
        paintArch(ctx, s, t, c);
        break;
      case 'isle':
        paintIsle(ctx, s, t, c);
        break;
      case 'inlay':
        paintInlay(ctx, s, t, c);
        break;
    }
  }
  ctx.restore();
}
