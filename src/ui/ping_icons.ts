// The party ping icons, procedural canvas art in the house style (the raid
// marker recipe in icons.ts is the sibling): a round enamelled badge in the
// ping's colour (render/party_pings_core.ts PARTY_PING_COLORS) with a dark
// keyline and a lit rim, carrying one white glyph with a dark outline so it
// reads over a bright sky and a dark floor alike. Our own glyphs: an eye
// (Look Here), a sword (Attack), a warning triangle (Warning), a down arrow
// on a ground bar (On My Way) and a flag (Assist).
//
// One canvas per kind and size, built on first use and cached for the
// session; the world icon, the wheel and the minimap all draw the same art.

import { partyPingColorCss } from '../render/party_pings_core';
import {
  PING_ASSIST,
  PING_ATTACK,
  PING_LOOK,
  PING_ON_MY_WAY,
  PING_WARNING,
} from '../sim/social/party_pings';
import { require2dContext } from './canvas_context';

const canvases = new Map<string, HTMLCanvasElement>();
const urls = new Map<string, string>();

const INK = 'rgba(12, 9, 6, 0.92)';
const GLYPH = '#fffaf0';

function shade(hex: string, amount: number): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = (shift: number) => {
    const v = (n >> shift) & 0xff;
    const out = amount >= 0 ? v + (255 - v) * amount : v * (1 + amount);
    return Math.round(Math.max(0, Math.min(255, out)));
  };
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
}

/** Fill the current path white with a dark outline (the glyph treatment). */
function inkAndFill(ctx: CanvasRenderingContext2D, width = 5): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.fillStyle = GLYPH;
  ctx.fill();
}

function drawBadge(ctx: CanvasRenderingContext2D, color: string): void {
  // Drop shadow under the badge.
  ctx.save();
  ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
  ctx.shadowBlur = 6;
  ctx.shadowOffsetY = 2;
  ctx.beginPath();
  ctx.arc(0, 0, 40, 0, Math.PI * 2);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.restore();
  // The enamel: lit from the top left.
  const g = ctx.createRadialGradient(-12, -16, 4, 0, 0, 40);
  g.addColorStop(0, shade(color, 0.45));
  g.addColorStop(0.55, color);
  g.addColorStop(1, shade(color, -0.45));
  ctx.beginPath();
  ctx.arc(0, 0, 36, 0, Math.PI * 2);
  ctx.fillStyle = g;
  ctx.fill();
  // The lit rim and an inner keyline.
  ctx.lineWidth = 3;
  ctx.strokeStyle = shade(color, 0.6);
  ctx.beginPath();
  ctx.arc(0, 0, 36.5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(0, 0, 0, 0.35)';
  ctx.beginPath();
  ctx.arc(0, 0, 31, 0, Math.PI * 2);
  ctx.stroke();
  // A glaze highlight across the top.
  const hi = ctx.createLinearGradient(0, -34, 0, 2);
  hi.addColorStop(0, 'rgba(255, 255, 255, 0.42)');
  hi.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.beginPath();
  ctx.ellipse(0, -14, 26, 17, 0, 0, Math.PI * 2);
  ctx.fillStyle = hi;
  ctx.fill();
}

function drawEye(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.beginPath();
  ctx.moveTo(-25, 0);
  ctx.quadraticCurveTo(0, -24, 25, 0);
  ctx.quadraticCurveTo(0, 24, -25, 0);
  ctx.closePath();
  inkAndFill(ctx);
  ctx.beginPath();
  ctx.arc(0, 0, 9.5, 0, Math.PI * 2);
  ctx.fillStyle = shade(color, -0.55);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
  ctx.fillStyle = INK;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(-3, -3.5, 2.4, 0, Math.PI * 2);
  ctx.fillStyle = GLYPH;
  ctx.fill();
}

function drawSword(ctx: CanvasRenderingContext2D): void {
  ctx.save();
  ctx.rotate(Math.PI / 4);
  // Blade.
  ctx.beginPath();
  ctx.moveTo(0, -29);
  ctx.lineTo(5.5, -21);
  ctx.lineTo(5.5, 8);
  ctx.lineTo(-5.5, 8);
  ctx.lineTo(-5.5, -21);
  ctx.closePath();
  inkAndFill(ctx);
  // The fuller down the blade.
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.lineTo(0, 5);
  ctx.strokeStyle = 'rgba(40, 30, 20, 0.45)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Crossguard, grip and pommel.
  ctx.beginPath();
  ctx.roundRect(-15, 8, 30, 6, 3);
  inkAndFill(ctx, 4);
  ctx.beginPath();
  ctx.roundRect(-3.2, 14, 6.4, 11, 2);
  inkAndFill(ctx, 4);
  ctx.beginPath();
  ctx.arc(0, 28.5, 4.5, 0, Math.PI * 2);
  inkAndFill(ctx, 4);
  ctx.restore();
}

function drawWarning(ctx: CanvasRenderingContext2D, color: string): void {
  ctx.beginPath();
  ctx.moveTo(0, -25);
  ctx.lineTo(25, 19);
  ctx.lineTo(-25, 19);
  ctx.closePath();
  ctx.lineWidth = 7;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = GLYPH;
  ctx.stroke();
  ctx.fillStyle = GLYPH;
  ctx.fill();
  // The exclamation mark in the badge's own dark tone.
  ctx.fillStyle = shade(color, -0.7);
  ctx.beginPath();
  ctx.roundRect(-3.5, -12, 7, 19, 3);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, 13, 3.8, 0, Math.PI * 2);
  ctx.fill();
}

function drawArrow(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(-7, -26);
  ctx.lineTo(7, -26);
  ctx.lineTo(7, -2);
  ctx.lineTo(18, -2);
  ctx.lineTo(0, 17);
  ctx.lineTo(-18, -2);
  ctx.lineTo(-7, -2);
  ctx.closePath();
  inkAndFill(ctx);
  // The ground bar it lands on.
  ctx.beginPath();
  ctx.roundRect(-19, 21, 38, 6, 3);
  inkAndFill(ctx, 4);
}

function drawFlag(ctx: CanvasRenderingContext2D): void {
  // Pole.
  ctx.beginPath();
  ctx.roundRect(-17, -27, 6, 54, 3);
  inkAndFill(ctx, 4);
  // The cloth, waving.
  ctx.beginPath();
  ctx.moveTo(-11, -24);
  ctx.bezierCurveTo(0, -31, 8, -17, 22, -22);
  ctx.lineTo(22, 2);
  ctx.bezierCurveTo(8, 7, 0, -7, -11, 0);
  ctx.closePath();
  inkAndFill(ctx);
  // A base for the pole.
  ctx.beginPath();
  ctx.ellipse(-14, 27, 10, 3.5, 0, 0, Math.PI * 2);
  inkAndFill(ctx, 3);
}

function paint(ctx: CanvasRenderingContext2D, kind: number): void {
  const color = partyPingColorCss(kind);
  drawBadge(ctx, color);
  if (kind === PING_ATTACK) drawSword(ctx);
  else if (kind === PING_WARNING) drawWarning(ctx, color);
  else if (kind === PING_ON_MY_WAY) drawArrow(ctx);
  else if (kind === PING_ASSIST) drawFlag(ctx);
  else if (kind === PING_LOOK) drawEye(ctx, color);
}

/** The ping icon for `kind` at `px` square pixels (cached per kind and size). */
export function pingIconCanvas(kind: number, px = 128): HTMLCanvasElement {
  const key = `${kind}:${px}`;
  const cached = canvases.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  const ctx = require2dContext(canvas);
  ctx.scale(px / 100, px / 100);
  ctx.translate(50, 50);
  paint(ctx, kind);
  canvases.set(key, canvas);
  return canvas;
}

/** The same icon as a PNG data URL (an <img> source for the wheel and the minimap). */
export function pingIconUrl(kind: number, px = 64): string {
  const key = `${kind}:${px}`;
  const cached = urls.get(key);
  if (cached) return cached;
  const url = pingIconCanvas(kind, px).toDataURL();
  urls.set(key, url);
  return url;
}
