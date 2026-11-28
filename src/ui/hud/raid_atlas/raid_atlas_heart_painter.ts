// The raid atlas's Heart, inked: the Anvil of the World's floor plan from the
// drawing plan (raid_atlas_detail_core.ts RaidAtlasHeartDetail): each quarter
// washed in its own colour, the paving courses, the grooves from each altar
// down to the ring and curling through the well, the four ridges, the central
// ring round the well of the heart's light, and the altars. Painted into the
// plate or a settled view only, never per frame; the palette comes in.

import { type RaidAtlasHeartDetail, raidAtlasDrawsTier } from './raid_atlas_detail_core';
import { fillStroke, local, pen, polyline, shadowOffset, shadowPath } from './raid_atlas_ink';
import type { RaidAtlasPageTransform } from './raid_atlas_page_painter';
import { atlasHash01, type RaidAtlasColors } from './raid_atlas_palette_core';

type Ctx = CanvasRenderingContext2D;

function paintQuarters(ctx: Ctx, h: RaidAtlasHeartDetail, k: number, c: RaidAtlasColors): void {
  for (const q of h.quarters) {
    const tone = c[q.tone];
    // The wash: a flat tint, deeper toward the rim where its altar stands,
    // as a brush loaded at the wall runs out toward the ring.
    ctx.beginPath();
    polyline(ctx, q.outline, true);
    ctx.save();
    ctx.clip();
    // Clean paper under the wash, so each quarter reads its own hue and not
    // the Heart's gold.
    ctx.globalAlpha = 0.82;
    ctx.fillStyle = c.parchmentLight;
    ctx.fill();
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = tone;
    ctx.fill();
    const rimWash = ctx.createRadialGradient(h.x, h.z, h.ringR, h.x, h.z, h.rimR * 1.02);
    rimWash.addColorStop(0, c.parchmentLight);
    rimWash.addColorStop(1, tone);
    ctx.globalAlpha = 0.3;
    ctx.fillStyle = rimWash;
    ctx.fill();
    // Granulation: the pigment settled in the paper's tooth.
    ctx.fillStyle = tone;
    ctx.globalAlpha = 0.22;
    ctx.beginPath();
    const n = 420;
    for (let i = 0; i < n; i++) {
      const a = atlasHash01(i, 71 + q.outline.length) * Math.PI * 2;
      const r = h.ringR + Math.sqrt(atlasHash01(i, 83)) * (h.rimR - h.ringR);
      const x = h.x + Math.sin(a) * r;
      const z = h.z + Math.cos(a) * r;
      const s = (0.6 + atlasHash01(i, 97) * 1.1) / k;
      ctx.moveTo(x + s, z);
      ctx.arc(x, z, s, 0, Math.PI * 2);
    }
    ctx.fill();
    // The wash's dried edge: pigment pooled where the brush stopped.
    ctx.beginPath();
    polyline(ctx, q.outline, true);
    ctx.globalAlpha = 0.42;
    ctx.strokeStyle = tone;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.2;
    ctx.stroke();
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

function paintCourses(
  ctx: Ctx,
  h: RaidAtlasHeartDetail,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  if (!raidAtlasDrawsTier('fine', t.k)) return;
  ctx.strokeStyle = c.inkSoft;
  ctx.lineWidth = pen(t, 0.8);
  ctx.globalAlpha = 0.2;
  ctx.beginPath();
  for (const r of h.courses) {
    ctx.moveTo(h.x + r, h.z);
    ctx.arc(h.x, h.z, r, 0, Math.PI * 2);
  }
  // Staggered joints between each course and the next.
  const rings = [h.ringR, ...h.courses, h.rimR];
  for (let i = 0; i + 1 < rings.length; i++) {
    const r0 = rings[i];
    const r1 = rings[i + 1];
    const n = Math.max(8, Math.round((Math.PI * 2 * (r0 + r1)) / 2 / 5.2));
    const off = (i % 2) * 0.5;
    for (let j = 0; j < n; j++) {
      const a = ((j + off) / n) * Math.PI * 2;
      ctx.moveTo(h.x + Math.sin(a) * r0, h.z + Math.cos(a) * r0);
      ctx.lineTo(h.x + Math.sin(a) * r1, h.z + Math.cos(a) * r1);
    }
  }
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function paintGrooves(
  ctx: Ctx,
  h: RaidAtlasHeartDetail,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const w = h.grooveHalfWidth * 2;
  for (const g of h.grooves) {
    const tone = c[h.quarters.find((q) => q.vein === g.vein)?.tone ?? 'gold'];
    // Down the walk: the cut's walls inked, its bed the quarter's light.
    ctx.beginPath();
    polyline(ctx, g.walk, false);
    ctx.strokeStyle = c.ink;
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = w + pen(t, 2.2);
    ctx.stroke();
    ctx.strokeStyle = tone;
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = w;
    ctx.stroke();
    ctx.strokeStyle = c.goldWhite;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = w * 0.3;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** The grooves' curl on across the ring's rim and through the well to the
 *  boss's feet: a cut over the rim, a thread of light in the well. */
function paintGrooveCurls(
  ctx: Ctx,
  h: RaidAtlasHeartDetail,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const w = h.grooveHalfWidth * 2;
  for (const g of h.grooves) {
    const tone = c[h.quarters.find((q) => q.vein === g.vein)?.tone ?? 'gold'];
    ctx.lineCap = 'butt';
    ctx.beginPath();
    polyline(ctx, g.rim, false);
    ctx.strokeStyle = c.ink;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = w * 0.8 + pen(t, 2);
    ctx.stroke();
    ctx.strokeStyle = tone;
    ctx.globalAlpha = 1;
    ctx.lineWidth = w * 0.8;
    ctx.stroke();
    ctx.lineCap = 'round';
    ctx.beginPath();
    polyline(ctx, g.well, false);
    ctx.strokeStyle = tone;
    ctx.globalAlpha = 0.55;
    ctx.lineWidth = w * 0.9;
    ctx.stroke();
    ctx.strokeStyle = c.goldWhite;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = Math.max(w * 0.22, pen(t, 1));
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function paintRidges(
  ctx: Ctx,
  h: RaidAtlasHeartDetail,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const w = h.ridgeHalfWidth * 2;
  for (const ridge of h.ridges) {
    // The cast shadow down its lee, then the spine: inked, stone-filled, a
    // fine crest line along its top.
    const [ox, oz] = shadowOffset(h.ridgeHalfWidth * 1.4);
    ctx.save();
    ctx.translate(ox, oz);
    ctx.beginPath();
    polyline(ctx, ridge, false);
    ctx.strokeStyle = c.abyss;
    ctx.globalAlpha = 0.3;
    ctx.lineWidth = w;
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    polyline(ctx, ridge, false);
    ctx.strokeStyle = c.ink;
    ctx.globalAlpha = 0.95;
    ctx.lineWidth = w + pen(t, 2.4);
    ctx.stroke();
    ctx.strokeStyle = c.rock;
    ctx.globalAlpha = 1;
    ctx.lineWidth = w;
    ctx.stroke();
    ctx.strokeStyle = c.parchmentLight;
    ctx.globalAlpha = 0.5;
    ctx.lineWidth = w * 0.28;
    ctx.save();
    ctx.translate(0.25 * h.ridgeHalfWidth, 0.25 * h.ridgeHalfWidth);
    ctx.stroke();
    ctx.restore();
    // The crest's hatching: short strokes across the spine.
    if (raidAtlasDrawsTier('fine', t.k)) {
      ctx.strokeStyle = c.ink;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = pen(t, 0.9);
      ctx.beginPath();
      for (let i = 1; i < ridge.length; i++) {
        const [ax, az] = ridge[i - 1];
        const [bx, bz] = ridge[i];
        const dx = bx - ax;
        const dz = bz - az;
        const l = Math.hypot(dx, dz) || 1;
        const nx = -dz / l;
        const nz = dx / l;
        const mx = (ax + bx) / 2;
        const mz = (az + bz) / 2;
        ctx.moveTo(mx + nx * h.ridgeHalfWidth * 0.85, mz + nz * h.ridgeHalfWidth * 0.85);
        ctx.lineTo(mx + nx * h.ridgeHalfWidth * 0.2, mz + nz * h.ridgeHalfWidth * 0.2);
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;
}

function paintRingAndWell(
  ctx: Ctx,
  h: RaidAtlasHeartDetail,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  // The central ring: the raised dark-rock rim round the well.
  ctx.beginPath();
  ctx.arc(h.x, h.z, h.ringR, 0, Math.PI * 2);
  ctx.arc(h.x, h.z, h.wellR, 0, Math.PI * 2, true);
  ctx.globalAlpha = 1;
  ctx.fillStyle = c.rock;
  ctx.fill();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = c.abyss;
  ctx.fill();
  // Runes cut round the rim, in gold.
  ctx.strokeStyle = c.goldLight;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = pen(t, 1.1);
  ctx.beginPath();
  const mid = (h.ringR + h.wellR) / 2;
  const half = (h.ringR - h.wellR) * 0.28;
  for (let i = 0; i < 24; i++) {
    const a = (i / 24) * Math.PI * 2;
    const sa = Math.sin(a);
    const ca = Math.cos(a);
    if (i % 2 === 0) {
      ctx.moveTo(h.x + sa * (mid - half), h.z + ca * (mid - half));
      ctx.lineTo(h.x + sa * (mid + half), h.z + ca * (mid + half));
    } else {
      ctx.moveTo(h.x + sa * mid + half * 0.6, h.z + ca * mid);
      ctx.arc(h.x + sa * mid, h.z + ca * mid, half * 0.6, 0, Math.PI * 2);
    }
  }
  ctx.stroke();
  // The ring's edges: a firm outer line (the quarters end at it) and the lip.
  ctx.strokeStyle = c.ink;
  ctx.globalAlpha = 0.95;
  ctx.lineWidth = pen(t, 2.6);
  ctx.beginPath();
  ctx.arc(h.x, h.z, h.ringR, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = c.gold;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = pen(t, 1.3);
  ctx.beginPath();
  ctx.arc(h.x, h.z, h.ringR - pen(t, 2.6), 0, Math.PI * 2);
  ctx.stroke();
  // The well: the heart's light welling up out of the deep.
  const g = ctx.createRadialGradient(h.x, h.z, 0, h.x, h.z, h.wellR);
  g.addColorStop(0, c.goldWhite);
  g.addColorStop(0.45, c.glow);
  g.addColorStop(0.8, c.heartGlow);
  g.addColorStop(1, c.veinHeat);
  ctx.beginPath();
  ctx.arc(h.x, h.z, h.wellR, 0, Math.PI * 2);
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = g;
  ctx.fill();
  ctx.strokeStyle = c.ink;
  ctx.globalAlpha = 0.85;
  ctx.lineWidth = pen(t, 1.8);
  ctx.stroke();
  // Its depth: rings of light falling away, dashed.
  ctx.strokeStyle = c.veinHeat;
  ctx.globalAlpha = 0.45;
  ctx.lineWidth = pen(t, 1);
  ctx.setLineDash([pen(t, 4), pen(t, 3)]);
  for (const f of [0.72, 0.46]) {
    ctx.beginPath();
    ctx.arc(h.x, h.z, h.wellR * f, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function paintAltars(
  ctx: Ctx,
  h: RaidAtlasHeartDetail,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  for (const a of h.altars) {
    const q = h.quarters.find((x) => x.vein === a.vein);
    const light = c[q?.tone ?? 'gold'];
    const g = { x: a.x, z: a.z, rot: a.rot };
    const s = a.r;
    // The altar's glow on the floor round it, in its quarter's colour.
    const halo = ctx.createRadialGradient(a.x, a.z, s * 0.6, a.x, a.z, s * 2.6);
    halo.addColorStop(0, light);
    halo.addColorStop(1, c.parchmentLight);
    ctx.beginPath();
    ctx.arc(a.x, a.z, s * 2.6, 0, Math.PI * 2);
    ctx.globalAlpha = 0.45;
    ctx.fillStyle = halo;
    ctx.fill();
    const square = () => {
      const p = [local(g, -s, -s), local(g, s, -s), local(g, s, s), local(g, -s, s)];
      polyline(ctx, p, true);
    };
    shadowPath(ctx, c, s * 1.4, square);
    ctx.beginPath();
    square();
    fillStroke(ctx, c.rock, 1, c.ink, pen(t, 1.8));
    // The stepped top, and the vein's stone burning in it.
    ctx.beginPath();
    const p2 = [
      local(g, -s * 0.62, -s * 0.62),
      local(g, s * 0.62, -s * 0.62),
      local(g, s * 0.62, s * 0.62),
      local(g, -s * 0.62, s * 0.62),
    ];
    polyline(ctx, p2, true);
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = pen(t, 1);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(a.x, a.z, s * 0.42, 0, Math.PI * 2);
    ctx.globalAlpha = 1;
    ctx.fillStyle = light;
    ctx.fill();
    ctx.strokeStyle = c.goldDeep;
    ctx.lineWidth = pen(t, 1.2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(a.x + s * 0.1, a.z + s * 0.1, s * 0.15, 0, Math.PI * 2);
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = c.goldWhite;
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** The Heart's floor plan, over its platform's floor. */
export function paintHeartDetail(
  ctx: Ctx,
  h: RaidAtlasHeartDetail,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  ctx.save();
  paintQuarters(ctx, h, t.k, c);
  paintCourses(ctx, h, t, c);
  paintGrooves(ctx, h, t, c);
  paintRidges(ctx, h, t, c);
  paintRingAndWell(ctx, h, t, c);
  paintGrooveCurls(ctx, h, t, c);
  paintAltars(ctx, h, t, c);
  ctx.restore();
}
