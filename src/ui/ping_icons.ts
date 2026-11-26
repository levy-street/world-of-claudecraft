// The party ping icons. Each kind ships one painted icon,
// public/ui/pings/<name>.webp (ChatGPT image generation in the house painted
// style, one saturated slightly neon colour per kind, no circle or badge, keyed
// and encoded by scripts/convert_chrome_icons_webp.mjs --dir public/ui/pings;
// provenance in that folder's mapping.json). The wheel, the chat line and the
// minimap show the file itself (pingIconUrl); the world icon draws it onto a
// canvas with a glow in the kind's colour (render/party_pings_core.ts
// PARTY_PING_COLORS) so it pops over a bright sky and a dark floor alike.
//
// The art loads on first use. Until it arrives (or if it never does) a canvas
// carries the procedural glyph: our own eye, sword, warning triangle, arrow and
// flag, white with a dark outline and no badge behind it. When a kind's art
// loads, every cached canvas of that kind is repainted in place and
// onPingIconArt listeners hear it, so a texture built from one can re-upload.
//
// One canvas per kind and size, built on first use and cached for the session.

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

/** The painted icon files, by kind (public/ui/pings/<name>.webp). */
const ART_NAMES: Readonly<Record<number, string>> = Object.freeze({
  [PING_LOOK]: 'look',
  [PING_ATTACK]: 'attack',
  [PING_WARNING]: 'warning',
  [PING_ON_MY_WAY]: 'on_my_way',
  [PING_ASSIST]: 'assist',
});
const ART_DIR = '/ui/pings';
/** The share of the canvas the painted icon fills; the rest is glow room. */
const ART_FILL = 0.84;

const art = new Map<number, HTMLImageElement>();
const artLoading = new Set<number>();
const artListeners = new Set<(kind: number) => void>();

/** Static URL of a kind's painted icon. */
export function pingIconArtUrl(kind: number): string {
  return `${ART_DIR}/${ART_NAMES[kind] ?? ART_NAMES[PING_LOOK]}.webp`;
}

/** Hear when a kind's painted art has loaded and its cached canvases were
 *  repainted (a texture built from one should re-upload). Returns the
 *  unsubscribe. */
export function onPingIconArt(listener: (kind: number) => void): () => void {
  artListeners.add(listener);
  return () => artListeners.delete(listener);
}

function loadArt(kind: number): void {
  if (art.has(kind) || artLoading.has(kind) || typeof Image === 'undefined') return;
  artLoading.add(kind);
  const img = new Image();
  img.decoding = 'async';
  img.onload = () => {
    artLoading.delete(kind);
    art.set(kind, img);
    for (const [key, canvas] of canvases) {
      const [k, px] = key.split(':').map(Number);
      if (k === kind) repaint(canvas, kind, px);
    }
    for (const listener of artListeners) listener(kind);
  };
  // A missing file keeps the procedural glyph.
  img.onerror = () => artLoading.delete(kind);
  img.src = pingIconArtUrl(kind);
}

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

/** The painted icon, fitted with room left for a glow in the kind's colour.
 *  The context is in the 100-unit icon space centred on 0, 0; shadow blur is
 *  in device pixels, so it scales with `px`. */
function paintArt(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  kind: number,
  px: number,
): void {
  const size = 100 * ART_FILL;
  ctx.save();
  ctx.shadowColor = partyPingColorCss(kind);
  ctx.shadowBlur = px * 0.1;
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.shadowBlur = px * 0.035;
  ctx.drawImage(img, -size / 2, -size / 2, size, size);
  ctx.restore();
}

/** The procedural glyph alone (no badge): the fallback before the art loads. */
function paintGlyph(ctx: CanvasRenderingContext2D, kind: number): void {
  const color = partyPingColorCss(kind);
  if (kind === PING_ATTACK) drawSword(ctx);
  else if (kind === PING_WARNING) drawWarning(ctx, color);
  else if (kind === PING_ON_MY_WAY) drawArrow(ctx);
  else if (kind === PING_ASSIST) drawFlag(ctx);
  else if (kind === PING_LOOK) drawEye(ctx, color);
}

function repaint(canvas: HTMLCanvasElement, kind: number, px: number): void {
  const ctx = require2dContext(canvas);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.scale(px / 100, px / 100);
  ctx.translate(50, 50);
  const img = art.get(kind);
  if (img) paintArt(ctx, img, kind, px);
  else paintGlyph(ctx, kind);
}

/** The ping icon for `kind` at `px` square pixels (cached per kind and size):
 *  the painted art with its glow once loaded, the glyph until then. */
export function pingIconCanvas(kind: number, px = 128): HTMLCanvasElement {
  const key = `${kind}:${px}`;
  const cached = canvases.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = px;
  canvas.height = px;
  canvases.set(key, canvas);
  repaint(canvas, kind, px);
  loadArt(kind);
  return canvas;
}

/** The painted icon's URL, an <img> source for the wheel, the chat line and
 *  the minimap (their CSS adds the glow). */
export function pingIconUrl(kind: number): string {
  loadArt(kind);
  return pingIconArtUrl(kind);
}
