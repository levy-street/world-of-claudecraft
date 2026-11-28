// The raid atlas's pen: the small canvas helpers the fine-detail painters
// share (raid_atlas_heart_painter.ts, raid_atlas_detail_painter.ts,
// raid_atlas_landmark_painter.ts). Everything draws in the page's own space:
// instance-local yards under the page transform, so a pen width is given in
// device px and turned into yards by the render's `k`.

import type { RaidAtlasPageTransform } from './raid_atlas_page_painter';
import type { RaidAtlasColors } from './raid_atlas_palette_core';

export type Ctx = CanvasRenderingContext2D;
export type Pt = readonly [number, number];

/** A pen `px` device px wide, in yards under the page transform. */
export function pen(t: RaidAtlasPageTransform, px: number): number {
  return px / t.k;
}

export function polyline(ctx: Ctx, pts: readonly Pt[], closed: boolean): void {
  const first = pts[0];
  if (!first) return;
  ctx.moveTo(first[0], first[1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  if (closed) ctx.closePath();
}

/** Sim yaw to the forward (sin, cos) and right (cos, -sin) unit vectors, the
 *  field's own box convention (field_map_view.ts boxCorners). */
export function axes(rot: number): { fx: number; fz: number; rx: number; rz: number } {
  return { fx: Math.sin(rot), fz: Math.cos(rot), rx: Math.cos(rot), rz: -Math.sin(rot) };
}

/** A point `side` yards right and `ahead` yards forward of (x, z). */
export function local(g: { x: number; z: number; rot: number }, side: number, ahead: number): Pt {
  const a = axes(g.rot);
  return [g.x + a.rx * side + a.fx * ahead, g.z + a.rz * side + a.fz * ahead];
}

/** The cast shadow's offset (the page is lit from its top-left; the page
 *  mirrors x, so screen right-and-down is -x, -z). */
export function shadowOffset(r: number): Pt {
  return [-0.32 * r, -0.32 * r];
}

export function fillStroke(
  ctx: Ctx,
  fill: string,
  fillAlpha: number,
  ink: string,
  width: number,
): void {
  ctx.globalAlpha = fillAlpha;
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = ink;
  ctx.lineWidth = width;
  ctx.stroke();
}

export function shadowPath(ctx: Ctx, c: RaidAtlasColors, r: number, draw: () => void): void {
  const [ox, oz] = shadowOffset(r);
  ctx.save();
  ctx.translate(ox, oz);
  ctx.beginPath();
  draw();
  ctx.globalAlpha = 0.28;
  ctx.fillStyle = c.abyss;
  ctx.fill();
  ctx.restore();
}
export function circle(ctx: Ctx, x: number, z: number, r: number): void {
  ctx.moveTo(x + r, z);
  ctx.arc(x, z, r, 0, Math.PI * 2);
}

export function boxPath(
  ctx: Ctx,
  g: { x: number; z: number; rot: number },
  hw: number,
  hd: number,
): void {
  polyline(ctx, [local(g, -hw, -hd), local(g, hw, -hd), local(g, hw, hd), local(g, -hw, hd)], true);
}
