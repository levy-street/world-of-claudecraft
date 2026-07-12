// Procedural painted icons for abilities, items and auras.
//
// Every icon is composed on a small canvas from layered parts: a rounded
// bevelled frame, a radial background tinted by spell school / item category,
// 1-2 vector "primitives" (sword, flame, skull, ...) and optional fx
// (glow, sparkle, motion lines, ...). Known ids get hand-assigned recipes;
// unknown ids (content added later) fall back to a procedural recipe derived
// from the ability school / item kind + name keywords, so everything always
// has a proper icon. Results are cached as data URLs.

import { ABILITIES, ITEMS } from '../sim/data';
import { DEED_IMAGE_IDS } from './deed_image_ids';
import { ITEM_WEAPON_VARIANTS } from './weapon_variants';

export type IconKind = 'ability' | 'item' | 'aura' | 'crest';

type Ctx = CanvasRenderingContext2D;

export interface IconPalette {
  base: string;
  light: string;
  dark: string;
  glow: string;
  accent: string;
}

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// Colour tables
// ---------------------------------------------------------------------------

const PALETTES = {
  steel: { base: '#aebdc8', light: '#eef4f8', dark: '#4e5a66', glow: '#cfe4ff', accent: '#2b333c' },
  gold: { base: '#e8b33a', light: '#ffe9a8', dark: '#8a5f12', glow: '#ffd97a', accent: '#5c3e08' },
  blood: { base: '#c0392b', light: '#ff8a70', dark: '#5e120c', glow: '#ff5533', accent: '#2e0805' },
  bone: { base: '#e8e0cc', light: '#fffaf0', dark: '#8f8468', glow: '#fff8d8', accent: '#4a4334' },
  ember: { base: '#ff7a1a', light: '#ffd9a0', dark: '#8a2a08', glow: '#ffb45e', accent: '#401004' },
  ice: { base: '#9fd8ff', light: '#eafaff', dark: '#2a6ea8', glow: '#c8f0ff', accent: '#123c5e' },
  venom: { base: '#7ad94a', light: '#d8ffb0', dark: '#2a6e18', glow: '#a8ff70', accent: '#0d330a' },
  arcanePink: {
    base: '#c66ee8',
    light: '#f0c8ff',
    dark: '#5e2a78',
    glow: '#e0a0ff',
    accent: '#2a0e38',
  },
  shadowPurple: {
    base: '#8a5fb0',
    light: '#cdaae8',
    dark: '#38204e',
    glow: '#b48ad0',
    accent: '#150a20',
  },
  holyGold: {
    base: '#ffe080',
    light: '#fff7d0',
    dark: '#a8761a',
    glow: '#fff0b0',
    accent: '#5e3f08',
  },
  leafGreen: {
    base: '#5fb544',
    light: '#c4f0a0',
    dark: '#225e18',
    glow: '#9fe070',
    accent: '#0d2e0a',
  },
  sky: { base: '#6fb6ff', light: '#d4ecff', dark: '#1f5a9e', glow: '#a0d4ff', accent: '#0c2c50' },
  earthBrown: {
    base: '#a8703c',
    light: '#e0b070',
    dark: '#5a3414',
    glow: '#d89a50',
    accent: '#2a1608',
  },
  silverWhite: {
    base: '#e8eef2',
    light: '#ffffff',
    dark: '#8a98a4',
    glow: '#f0f8ff',
    accent: '#3c4650',
  },
  leather: {
    base: '#b98a52',
    light: '#e8c48e',
    dark: '#6a4520',
    glow: '#d8aa6a',
    accent: '#33200c',
  },
  cloth: { base: '#b0a4d8', light: '#e0d8f4', dark: '#5a4e84', glow: '#d0c4f0', accent: '#2a2444' },
  pink: { base: '#f0a8c0', light: '#ffe0ec', dark: '#a05878', glow: '#ffd0e0', accent: '#4e2030' },
} satisfies Record<string, IconPalette>;
type PaletteName = keyof typeof PALETTES;

// background radial gradient stops [c0, c1, c2]
const BACKGROUNDS = {
  fire: ['#ffb45e', '#b23410', '#38100a'],
  frost: ['#bfe8ff', '#1d5e9e', '#0a1d38'],
  arcane: ['#e8b8ff', '#6e34a0', '#1e0a33'],
  shadow: ['#9a70c0', '#41245c', '#100618'],
  holy: ['#fff3c0', '#c89018', '#43300a'],
  nature: ['#c0e890', '#357a2a', '#0c230d'],
  storm: ['#a8c8e8', '#3a5a80', '#101c2c'],
  steel: ['#c8d4dc', '#5a6878', '#181d24'],
  fury: ['#ff9468', '#a02818', '#2e0a06'],
  blood: ['#d86858', '#7e1810', '#260604'],
  earth: ['#d8a868', '#74481e', '#20120a'],
  leather: ['#d0a06a', '#6e4824', '#1e1208'],
  cloth: ['#c8b8e8', '#564878', '#181226'],
  wood: ['#c89858', '#6a4520', '#1c1006'],
  food: ['#f0c070', '#8a5424', '#281406'],
  drink: ['#a0d8f0', '#2a6890', '#0a2030'],
  junk: ['#a8a8a0', '#4e4e48', '#141412'],
  treasure: ['#ffd970', '#a07818', '#2e2206'],
  parchment: ['#f0e0b0', '#907040', '#2a200c'],
} satisfies Record<string, [string, string, string]>;
type BgName = keyof typeof BACKGROUNDS;

// ---------------------------------------------------------------------------
// Small drawing helpers
// ---------------------------------------------------------------------------

function lin(
  ctx: Ctx,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: [number, string][],
): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

function rad(ctx: Ctx, x: number, y: number, r: number, stops: [number, string][]): CanvasGradient {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

function rrPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function edge(ctx: Ctx, color: string, w: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.stroke();
}

function noShadow(ctx: Ctx): void {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

function withAlpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function flaredBar(ctx: Ctx, y0: number, y1: number): void {
  ctx.beginPath();
  ctx.moveTo(-6, y0);
  ctx.lineTo(6, y0);
  ctx.lineTo(3.2, y0 + 7);
  ctx.lineTo(3.2, y1 - 7);
  ctx.lineTo(6, y1);
  ctx.lineTo(-6, y1);
  ctx.lineTo(-3.2, y1 - 7);
  ctx.lineTo(-3.2, y0 + 7);
  ctx.closePath();
}

function heaterPath(ctx: Ctx): void {
  ctx.beginPath();
  ctx.moveTo(0, -26);
  ctx.quadraticCurveTo(13, -22, 20, -18);
  ctx.quadraticCurveTo(20, -2, 16, 10);
  ctx.quadraticCurveTo(9, 20, 0, 26);
  ctx.quadraticCurveTo(-9, 20, -16, 10);
  ctx.quadraticCurveTo(-20, -2, -20, -18);
  ctx.quadraticCurveTo(-13, -22, 0, -26);
  ctx.closePath();
}

function flamePath(ctx: Ctx): void {
  ctx.beginPath();
  ctx.moveTo(0, 26);
  ctx.bezierCurveTo(-15, 19, -13, 4, -7, -5);
  ctx.bezierCurveTo(-10, -13, -3, -19, 2, -26);
  ctx.bezierCurveTo(3, -16, 11, -13, 13, -2);
  ctx.bezierCurveTo(15, 11, 10, 21, 0, 26);
  ctx.closePath();
}

// ---------------------------------------------------------------------------
// Primitive painters — drawn centered at (0,0) in a 100x100 logical space,
// fitting r <= 36. Light source is top-left.
// ---------------------------------------------------------------------------

type Painter = (ctx: Ctx, pal: IconPalette) => void;

const PRIMITIVES = {
  sword(ctx, pal) {
    ctx.rotate(-Math.PI / 4);
    ctx.beginPath();
    ctx.moveTo(-3.2, 18);
    ctx.lineTo(-2, -28);
    ctx.lineTo(0, -34);
    ctx.lineTo(2, -28);
    ctx.lineTo(3.2, 18);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, -3, 0, 3, 0, [
      [0, pal.light],
      [0.55, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.accent, 1.3);
    ctx.strokeStyle = pal.light;
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    ctx.moveTo(0, -31);
    ctx.lineTo(0, 16);
    ctx.stroke();
    ctx.fillStyle = lin(ctx, 0, 16, 0, 21, [
      [0, '#f0cd72'],
      [1, '#7a5a18'],
    ]);
    rrPath(ctx, -10, 16, 20, 5, 2);
    ctx.fill();
    edge(ctx, '#3a2a08', 1);
    ctx.fillStyle = '#4a3018';
    rrPath(ctx, -2.6, 21, 5.2, 11, 2);
    ctx.fill();
    ctx.fillStyle = rad(ctx, -1.2, 31.8, 4.6, [
      [0, '#ffe9a8'],
      [1, '#8a5f12'],
    ]);
    ctx.beginPath();
    ctx.arc(0, 33, 4, 0, TAU);
    ctx.fill();
    edge(ctx, '#3a2a08', 1);
  },
  dagger(ctx, pal) {
    ctx.rotate(-Math.PI / 4);
    ctx.scale(0.8, 0.8);
    ctx.beginPath();
    ctx.moveTo(-5, 13);
    ctx.lineTo(-2.6, -24);
    ctx.lineTo(0, -31);
    ctx.lineTo(2.6, -24);
    ctx.lineTo(5, 13);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, -5, 0, 5, 0, [
      [0, pal.light],
      [0.5, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.accent, 1.4);
    ctx.strokeStyle = pal.light;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, -27);
    ctx.lineTo(0, 11);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(-12, 12);
    ctx.quadraticCurveTo(0, 22, 12, 12);
    ctx.quadraticCurveTo(0, 17, -12, 12);
    ctx.closePath();
    ctx.fillStyle = '#8a6a28';
    ctx.fill();
    edge(ctx, '#3a2a08', 1);
    ctx.fillStyle = '#42301a';
    rrPath(ctx, -2.4, 17, 4.8, 11, 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 30, 3.4, 0, TAU);
    ctx.fillStyle = '#caa84e';
    ctx.fill();
    edge(ctx, '#3a2a08', 1);
  },
  staff(ctx, pal) {
    ctx.rotate(0.5);
    ctx.fillStyle = lin(ctx, -3, 0, 3, 0, [
      [0, '#a87c44'],
      [0.5, '#7a5226'],
      [1, '#46290e'],
    ]);
    rrPath(ctx, -2.6, -24, 5.2, 57, 2.6);
    ctx.fill();
    edge(ctx, '#2a1806', 1);
    ctx.fillStyle = '#5a3c18';
    rrPath(ctx, -4, -20, 8, 4, 1.5);
    ctx.fill();
    ctx.fillStyle = rad(ctx, -2.5, -30.5, 9, [
      [0, pal.glow],
      [0.55, pal.base],
      [1, pal.dark],
    ]);
    ctx.beginPath();
    ctx.arc(0, -28, 8, 0, TAU);
    ctx.fill();
    edge(ctx, pal.dark, 1.4);
    noShadow(ctx);
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.beginPath();
    ctx.ellipse(-2.6, -30.6, 1.8, 1.2, -0.6, 0, TAU);
    ctx.fill();
  },
  mace(ctx, pal) {
    ctx.fillStyle = lin(ctx, -2.5, 0, 2.5, 0, [
      [0, '#8a6a3c'],
      [1, '#3c2810'],
    ]);
    rrPath(ctx, -2.5, -2, 5, 33, 2);
    ctx.fill();
    edge(ctx, '#241404', 1);
    ctx.beginPath();
    ctx.arc(0, -13, 13, 0, TAU);
    ctx.fillStyle = rad(ctx, -4.5, -17.5, 16, [
      [0, pal.light],
      [0.55, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.accent, 1.6);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + 0.3;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 8.6, -13 + Math.sin(a) * 8.6, 2.6, 0, TAU);
      ctx.fillStyle = pal.light;
      ctx.fill();
      edge(ctx, pal.dark, 0.8);
    }
  },
  axe(ctx, pal) {
    ctx.rotate(0.55);
    ctx.fillStyle = lin(ctx, -2, 0, 2, 0, [
      [0, '#a87c44'],
      [1, '#46290e'],
    ]);
    rrPath(ctx, -2, -28, 4, 56, 2);
    ctx.fill();
    edge(ctx, '#2a1806', 1);
    ctx.beginPath();
    ctx.moveTo(-1, -27);
    ctx.quadraticCurveTo(-24, -27, -25, -4);
    ctx.quadraticCurveTo(-14, -11, -1, -9);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, -24, -24, -4, -6, [
      [0, pal.light],
      [0.55, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.accent, 1.4);
    ctx.strokeStyle = pal.light;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(-3, -26.2);
    ctx.quadraticCurveTo(-23, -26, -24, -5.5);
    ctx.stroke();
  },
  bow(ctx, pal) {
    ctx.strokeStyle = lin(ctx, 0, -30, 0, 30, [
      [0, pal.dark],
      [0.5, pal.base],
      [1, pal.dark],
    ]);
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-6, -30);
    ctx.quadraticCurveTo(22, 0, -6, 30);
    ctx.stroke();
    ctx.strokeStyle = pal.light;
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-6, -30);
    ctx.lineTo(-6, 30);
    ctx.stroke();
    ctx.fillStyle = pal.accent;
    rrPath(ctx, 5.8, -5, 4.6, 10, 2);
    ctx.fill();
  },
  arrow(ctx, pal) {
    ctx.strokeStyle = '#8a6a3c';
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-20, 20);
    ctx.lineTo(14, -14);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(22, -22);
    ctx.lineTo(10, -13);
    ctx.lineTo(13, -10);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, 10, -22, 22, -10, [
      [0, pal.light],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.accent, 1);
    ctx.fillStyle = pal.light;
    ctx.beginPath();
    ctx.moveTo(-19, 19);
    ctx.lineTo(-26, 16);
    ctx.lineTo(-17, 13);
    ctx.closePath();
    ctx.fill();
    edge(ctx, pal.accent, 0.8);
    ctx.beginPath();
    ctx.moveTo(-19, 19);
    ctx.lineTo(-16, 26);
    ctx.lineTo(-13, 17);
    ctx.closePath();
    ctx.fill();
    edge(ctx, pal.accent, 0.8);
  },
  shield(ctx, pal) {
    heaterPath(ctx);
    ctx.fillStyle = lin(ctx, 0, -26, 0, 26, [
      [0, pal.light],
      [0.45, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.accent, 2.6);
    noShadow(ctx);
    ctx.save();
    ctx.scale(0.84, 0.84);
    heaterPath(ctx);
    ctx.strokeStyle = withAlpha(pal.light, 0.7);
    ctx.lineWidth = 1.2;
    ctx.stroke();
    ctx.restore();
    ctx.beginPath();
    ctx.arc(0, -2, 5, 0, TAU);
    ctx.fillStyle = rad(ctx, -1.5, -3.5, 5.5, [
      [0, pal.light],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.accent, 1);
  },
  bolt(ctx, pal) {
    ctx.beginPath();
    ctx.moveTo(14, -17);
    ctx.quadraticCurveTo(-10, -2, -27, 25);
    ctx.quadraticCurveTo(-4, 4, 15, -5);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, 12, -12, -26, 24, [
      [0, pal.base],
      [1, withAlpha(pal.base, 0)],
    ]);
    ctx.fill();
    noShadow(ctx);
    ctx.globalAlpha = 0.8;
    ctx.fillStyle = pal.light;
    ctx.beginPath();
    ctx.arc(-14, 16, 2.2, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-21, 22, 1.4, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = rad(ctx, 8, -12, 11, [
      [0, '#ffffff'],
      [0.35, pal.light],
      [0.8, pal.base],
      [1, withAlpha(pal.base, 0)],
    ]);
    ctx.beginPath();
    ctx.arc(10, -10, 10.5, 0, TAU);
    ctx.fill();
  },
  flame(ctx, pal) {
    flamePath(ctx);
    ctx.fillStyle = lin(ctx, 0, -26, 0, 26, [
      [0, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    noShadow(ctx);
    ctx.globalCompositeOperation = 'lighter';
    ctx.save();
    ctx.translate(0, 9);
    ctx.scale(0.62, 0.62);
    flamePath(ctx);
    ctx.fillStyle = withAlpha(pal.light, 0.9);
    ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.translate(0.5, 14);
    ctx.scale(0.32, 0.32);
    flamePath(ctx);
    ctx.fillStyle = pal.glow;
    ctx.fill();
    ctx.restore();
    ctx.globalCompositeOperation = 'source-over';
  },
  snowflake(ctx, pal) {
    ctx.strokeStyle = pal.light;
    ctx.lineCap = 'round';
    ctx.lineWidth = 3;
    ctx.shadowColor = pal.glow;
    ctx.shadowBlur = 4;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    for (let i = 0; i < 6; i++) {
      ctx.save();
      ctx.rotate((i / 6) * TAU);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, -26);
      ctx.moveTo(0, -14);
      ctx.lineTo(-5.5, -19.5);
      ctx.moveTo(0, -14);
      ctx.lineTo(5.5, -19.5);
      ctx.stroke();
      ctx.restore();
    }
    ctx.beginPath();
    ctx.moveTo(4, 0);
    for (let i = 1; i < 6; i++) {
      const a = (i / 6) * TAU;
      ctx.lineTo(Math.cos(a) * 4, Math.sin(a) * 4);
    }
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.fill();
  },
  skull(ctx, pal) {
    ctx.beginPath();
    ctx.arc(0, -5, 15.5, 0, TAU);
    ctx.fillStyle = rad(ctx, -5, -11, 20, [
      [0, pal.light],
      [0.6, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.accent, 1.4);
    ctx.fillStyle = lin(ctx, 0, 6, 0, 18, [
      [0, pal.base],
      [1, pal.dark],
    ]);
    rrPath(ctx, -8.5, 6, 17, 12, 4);
    ctx.fill();
    edge(ctx, pal.accent, 1.2);
    noShadow(ctx);
    ctx.fillStyle = pal.accent;
    ctx.beginPath();
    ctx.ellipse(-6.2, -6.5, 4.4, 4.8, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(6.2, -6.5, 4.4, 4.8, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -1);
    ctx.lineTo(-2.4, 4.4);
    ctx.lineTo(2.4, 4.4);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (const x of [-4, 0, 4]) {
      ctx.moveTo(x, 9);
      ctx.lineTo(x, 16.5);
    }
    ctx.stroke();
    ctx.fillStyle = withAlpha(pal.light, 0.45);
    ctx.beginPath();
    ctx.arc(-7.4, -8, 1.2, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(5, -8, 1.2, 0, TAU);
    ctx.fill();
  },
  fist(ctx, pal) {
    ctx.fillStyle = lin(ctx, -14, -12, 14, 14, [
      [0, pal.light],
      [0.55, pal.base],
      [1, pal.dark],
    ]);
    for (const x of [-10.5, -3.5, 3.5, 10.5]) {
      ctx.beginPath();
      ctx.arc(x, -10, 3.7, Math.PI, 0);
      ctx.closePath();
      ctx.fill();
    }
    rrPath(ctx, -15, -10, 30, 22, 7);
    ctx.fill();
    edge(ctx, pal.accent, 1.6);
    ctx.fillStyle = lin(ctx, 8, -4, 20, 8, [
      [0, pal.base],
      [1, pal.dark],
    ]);
    rrPath(ctx, 10, -3, 9, 13, 4.5);
    ctx.fill();
    edge(ctx, pal.accent, 1.2);
    noShadow(ctx);
    ctx.strokeStyle = withAlpha(pal.dark, 0.9);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const x of [-7, 0, 7]) {
      ctx.moveTo(x, -8);
      ctx.lineTo(x, 0);
    }
    ctx.stroke();
  },
  hand(ctx, pal) {
    ctx.fillStyle = lin(ctx, -10, -20, 10, 16, [
      [0, pal.light],
      [0.6, pal.base],
      [1, pal.dark],
    ]);
    const fingers: [number, number, number][] = [
      [-10.5, -24, 20],
      [-4, -28, 24],
      [2.5, -27, 23],
      [9, -22, 18],
    ];
    for (const [x, top, len] of fingers) {
      rrPath(ctx, x, top, 5.6, len, 2.8);
      ctx.fill();
      edge(ctx, pal.dark, 1);
    }
    rrPath(ctx, -12, -6, 24, 22, 7);
    ctx.fill();
    edge(ctx, pal.dark, 1.2);
    ctx.save();
    ctx.rotate(-0.5);
    rrPath(ctx, 9, 2, 14, 6, 3);
    ctx.fill();
    edge(ctx, pal.dark, 1);
    ctx.restore();
  },
  boot(ctx, pal) {
    ctx.beginPath();
    ctx.moveTo(-8, -22);
    ctx.lineTo(5, -22);
    ctx.lineTo(6.5, 2);
    ctx.quadraticCurveTo(13, 3, 17.5, 9);
    ctx.lineTo(18, 14);
    ctx.lineTo(-8, 14);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, -8, -20, 14, 14, [
      [0, pal.light],
      [0.5, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.accent, 1.6);
    ctx.fillStyle = pal.accent;
    rrPath(ctx, -9.5, 13, 29, 5.5, 2);
    ctx.fill();
    edge(ctx, '#000000', 0.8);
    noShadow(ctx);
    ctx.strokeStyle = withAlpha(pal.light, 0.8);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    for (const y of [-17, -11, -5]) {
      ctx.moveTo(-6, y);
      ctx.lineTo(3, y + 1.5);
    }
    ctx.stroke();
    ctx.fillStyle = withAlpha(pal.light, 0.4);
    rrPath(ctx, -9, -23.5, 15, 4, 2);
    ctx.fill();
  },
  chestplate(ctx, pal) {
    ctx.beginPath();
    ctx.moveTo(-20, -15);
    ctx.lineTo(-8, -20);
    ctx.lineTo(0, -12.5);
    ctx.lineTo(8, -20);
    ctx.lineTo(20, -15);
    ctx.lineTo(16.5, 2);
    ctx.quadraticCurveTo(15, 15, 11.5, 21);
    ctx.lineTo(-11.5, 21);
    ctx.quadraticCurveTo(-15, 15, -16.5, 2);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, -14, -20, 12, 21, [
      [0, pal.light],
      [0.5, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.accent, 2);
    noShadow(ctx);
    ctx.strokeStyle = withAlpha(pal.dark, 0.9);
    ctx.lineWidth = 1.3;
    ctx.beginPath();
    ctx.moveTo(0, -12);
    ctx.lineTo(0, 20.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(-7.5, 0, 6.5, -2.6, 0.3);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(7.5, 0, 6.5, Math.PI - 0.3, Math.PI + 2.6);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(pal.light, 0.7);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-17, -13.5);
    ctx.lineTo(-8, -17.5);
    ctx.stroke();
  },
  trousers(ctx, pal) {
    ctx.fillStyle = lin(ctx, -14, -20, 12, 26, [
      [0, pal.light],
      [0.5, pal.base],
      [1, pal.dark],
    ]);
    ctx.beginPath();
    ctx.moveTo(-16, -12);
    ctx.lineTo(16, -12);
    ctx.lineTo(13, 26);
    ctx.lineTo(3.5, 26);
    ctx.lineTo(0, -1);
    ctx.lineTo(-3.5, 26);
    ctx.lineTo(-13, 26);
    ctx.closePath();
    ctx.fill();
    edge(ctx, pal.accent, 1.8);
    ctx.fillStyle = lin(ctx, 0, -21, 0, -12, [
      [0, pal.light],
      [1, pal.dark],
    ]);
    rrPath(ctx, -16.5, -20, 33, 8, 2);
    ctx.fill();
    edge(ctx, pal.accent, 1.4);
    noShadow(ctx);
    ctx.strokeStyle = withAlpha(pal.light, 0.6);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-9, -10);
    ctx.lineTo(-10.5, 24);
    ctx.moveTo(9, -10);
    ctx.lineTo(10.5, 24);
    ctx.stroke();
  },
  helm(ctx, pal) {
    // domed great-helm: rounded crown, brow ridge, horizontal eye slit + breath slit
    ctx.beginPath();
    ctx.moveTo(-15, 6);
    ctx.lineTo(-15, -4);
    ctx.quadraticCurveTo(-15, -22, 0, -22);
    ctx.quadraticCurveTo(15, -22, 15, -4);
    ctx.lineTo(15, 6);
    ctx.quadraticCurveTo(15, 16, 0, 19);
    ctx.quadraticCurveTo(-15, 16, -15, 6);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, -12, -20, 10, 16, [
      [0, pal.light],
      [0.5, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.accent, 2);
    noShadow(ctx);
    ctx.strokeStyle = withAlpha(pal.dark, 0.9);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-13, -2);
    ctx.quadraticCurveTo(0, -7, 13, -2);
    ctx.stroke();
    ctx.fillStyle = withAlpha('#000000', 0.78);
    rrPath(ctx, -11, 1, 22, 4, 2);
    ctx.fill();
    rrPath(ctx, -1.4, 6, 2.8, 9, 1.4);
    ctx.fill();
    ctx.fillStyle = withAlpha(pal.light, 0.5);
    rrPath(ctx, -3, -21, 6, 5, 2);
    ctx.fill();
  },
  belt(ctx, pal) {
    // horizontal strap with a central buckle
    ctx.fillStyle = lin(ctx, 0, -8, 0, 8, [
      [0, pal.light],
      [0.5, pal.base],
      [1, pal.dark],
    ]);
    rrPath(ctx, -22, -7, 44, 14, 4);
    ctx.fill();
    edge(ctx, pal.accent, 1.8);
    noShadow(ctx);
    ctx.strokeStyle = withAlpha(pal.dark, 0.7);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(-20, -4.5);
    ctx.lineTo(20, -4.5);
    ctx.moveTo(-20, 4.5);
    ctx.lineTo(20, 4.5);
    ctx.stroke();
    ctx.fillStyle = lin(ctx, -9, -10, 9, 10, [
      [0, pal.light],
      [1, pal.dark],
    ]);
    rrPath(ctx, -10, -11, 20, 22, 4);
    ctx.fill();
    edge(ctx, pal.accent, 2);
    ctx.fillStyle = withAlpha('#000000', 0.72);
    rrPath(ctx, -5.5, -6.5, 11, 13, 3);
    ctx.fill();
    ctx.strokeStyle = pal.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, -6);
    ctx.lineTo(0, 6);
    ctx.stroke();
    ctx.fillStyle = withAlpha(pal.light, 0.5);
    rrPath(ctx, -9, -10, 4, 20, 2);
    ctx.fill();
  },
  pauldron(ctx, pal) {
    // rounded shoulder cap with layered lames and a top stud
    ctx.beginPath();
    ctx.moveTo(-20, 14);
    ctx.quadraticCurveTo(-22, -8, -6, -18);
    ctx.quadraticCurveTo(8, -24, 19, -12);
    ctx.quadraticCurveTo(22, -2, 20, 14);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, -14, -18, 12, 14, [
      [0, pal.light],
      [0.5, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.accent, 2);
    noShadow(ctx);
    ctx.strokeStyle = withAlpha(pal.dark, 0.85);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, 18, 20, Math.PI * 1.08, Math.PI * 1.92);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 22, 26, Math.PI * 1.12, Math.PI * 1.88);
    ctx.stroke();
    ctx.fillStyle = pal.accent;
    ctx.beginPath();
    ctx.moveTo(-4, -16);
    ctx.lineTo(0, -24);
    ctx.lineTo(4, -16);
    ctx.closePath();
    ctx.fill();
    edge(ctx, pal.dark, 0.8);
    ctx.fillStyle = withAlpha(pal.light, 0.45);
    ctx.beginPath();
    ctx.ellipse(-6, -6, 5, 8, -0.4, 0, Math.PI * 2);
    ctx.fill();
  },
  gauntlet(ctx, pal) {
    // armored fist: flared cuff, plated back-of-hand, knuckle studs, short fingers + thumb
    ctx.fillStyle = lin(ctx, 0, 6, 0, 20, [
      [0, pal.base],
      [1, pal.dark],
    ]);
    ctx.beginPath();
    ctx.moveTo(-13, 6);
    ctx.lineTo(13, 6);
    ctx.lineTo(16, 20);
    ctx.lineTo(-16, 20);
    ctx.closePath();
    ctx.fill();
    edge(ctx, pal.accent, 1.8);
    ctx.fillStyle = lin(ctx, -12, -10, 10, 8, [
      [0, pal.light],
      [0.5, pal.base],
      [1, pal.dark],
    ]);
    rrPath(ctx, -13, -10, 26, 18, 5);
    ctx.fill();
    edge(ctx, pal.accent, 1.8);
    noShadow(ctx);
    ctx.fillStyle = lin(ctx, 0, -18, 0, -8, [
      [0, pal.light],
      [1, pal.dark],
    ]);
    for (const x of [-9.5, -3.2, 3.2, 9.5]) {
      rrPath(ctx, x - 2.4, -18, 4.8, 11, 2);
      ctx.fill();
      edge(ctx, pal.dark, 0.9);
    }
    ctx.fillStyle = pal.accent;
    for (const x of [-9, -3, 3, 9]) {
      ctx.beginPath();
      ctx.arc(x, -8, 2.4, 0, Math.PI * 2);
      ctx.fill();
      edge(ctx, pal.dark, 0.7);
    }
    ctx.save();
    ctx.rotate(-0.5);
    ctx.fillStyle = lin(ctx, -19, -2, -10, 4, [
      [0, pal.light],
      [1, pal.dark],
    ]);
    rrPath(ctx, -20, -2, 9, 5, 2.5);
    ctx.fill();
    edge(ctx, pal.dark, 0.9);
    ctx.restore();
    ctx.fillStyle = withAlpha(pal.light, 0.4);
    rrPath(ctx, -11, -8, 6, 12, 3);
    ctx.fill();
  },
  pelt(ctx, pal) {
    ctx.beginPath();
    ctx.moveTo(-19, -15);
    ctx.lineTo(-11, -11);
    ctx.quadraticCurveTo(0, -16, 11, -11);
    ctx.lineTo(19, -15);
    ctx.lineTo(15, -4);
    ctx.lineTo(16, 10);
    ctx.lineTo(20, 16);
    ctx.lineTo(12, 14);
    ctx.lineTo(7, 18);
    ctx.lineTo(3, 13);
    ctx.lineTo(0, 18);
    ctx.lineTo(-3, 13);
    ctx.lineTo(-7, 18);
    ctx.lineTo(-12, 14);
    ctx.lineTo(-20, 16);
    ctx.lineTo(-16, 10);
    ctx.lineTo(-15, -4);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, -12, -14, 10, 16, [
      [0, pal.light],
      [0.5, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.accent, 1.6);
    noShadow(ctx);
    ctx.strokeStyle = withAlpha(pal.dark, 0.8);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const x of [-9, -4.5, 0, 4.5, 9]) {
      ctx.moveTo(x, -13.2);
      ctx.lineTo(x + 1.5, -8);
    }
    ctx.stroke();
  },
  potion(ctx, pal) {
    ctx.beginPath();
    ctx.arc(0, 7, 13.5, 0, TAU);
    ctx.fillStyle = withAlpha(pal.light, 0.18);
    ctx.fill();
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 7, 12.3, 0, TAU);
    ctx.clip();
    ctx.fillStyle = lin(ctx, 0, -1, 0, 20, [
      [0, pal.base],
      [1, pal.dark],
    ]);
    ctx.fillRect(-13, 0.5, 26, 20);
    noShadow(ctx);
    ctx.fillStyle = withAlpha(pal.light, 0.8);
    ctx.beginPath();
    ctx.ellipse(0, 0.8, 12, 2.4, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = withAlpha(pal.light, 0.25);
    rrPath(ctx, -4, -18, 8, 13, 2);
    ctx.fill();
    ctx.strokeStyle = pal.light;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 7, 13.5, 0, TAU);
    ctx.stroke();
    rrPath(ctx, -4, -18, 8, 12, 2);
    ctx.stroke();
    ctx.fillStyle = '#9a7440';
    rrPath(ctx, -3.4, -22.5, 6.8, 6, 2);
    ctx.fill();
    edge(ctx, '#4a3010', 1);
    noShadow(ctx);
    ctx.strokeStyle = 'rgba(255,255,255,0.75)';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 7, 9.4, Math.PI * 0.78, Math.PI * 1.18);
    ctx.stroke();
  },
  waterskin(ctx, pal) {
    ctx.beginPath();
    ctx.moveTo(-4, -20);
    ctx.quadraticCurveTo(-16, -10, -14, 6);
    ctx.quadraticCurveTo(-12, 20, 0, 21);
    ctx.quadraticCurveTo(13, 20, 14, 5);
    ctx.quadraticCurveTo(15, -8, 4, -16);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, -12, -14, 12, 20, [
      [0, '#cf9d5f'],
      [0.5, '#9c6c34'],
      [1, '#52300f'],
    ]);
    ctx.fill();
    edge(ctx, '#2e1a06', 1.6);
    ctx.save();
    ctx.rotate(0.5);
    ctx.fillStyle = '#7a5a2c';
    rrPath(ctx, -3, -25, 6, 7, 2);
    ctx.fill();
    edge(ctx, '#2e1a06', 1);
    ctx.restore();
    noShadow(ctx);
    ctx.strokeStyle = '#4a2c0e';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-12, -4);
    ctx.quadraticCurveTo(0, 2, 13, -2);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(pal.light, 0.45);
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(-9, -12);
    ctx.quadraticCurveTo(-12, -2, -10, 8);
    ctx.stroke();
  },
  // Drawstring bag/pouch: a plump sack body cinched at a gathered neck with a
  // knotted rope, stitched bottom seam and a soft ground shadow, for the bag
  // items (Linen Pouch ... Mistcaller's Duffel) and the backpack.
  sack(ctx, pal) {
    // the pouch is drawn in a compact ~44-unit box; scale it up to fill the
    // icon like the weapon/armor primitives do
    ctx.save();
    ctx.scale(1.32, 1.32);
    // ground shadow so the bag sits instead of floating
    noShadow(ctx);
    ctx.fillStyle = 'rgba(0,0,0,0.32)';
    ctx.beginPath();
    ctx.ellipse(0, 21, 16, 3.6, 0, 0, Math.PI * 2);
    ctx.fill();
    // plump body: wide hips, waist pulled in toward the cinch
    ctx.beginPath();
    ctx.moveTo(-6.5, -13);
    ctx.bezierCurveTo(-15, -12, -20, -3, -19.5, 6);
    ctx.bezierCurveTo(-19, 16, -10, 21, 0, 21);
    ctx.bezierCurveTo(10, 21, 19, 16, 19.5, 6);
    ctx.bezierCurveTo(20, -3, 15, -12, 6.5, -13);
    ctx.closePath();
    ctx.fillStyle = rad(ctx, -6, -2, 30, [
      [0, pal.light],
      [0.45, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.dark, 1.8);
    // gathered neck flaring above the tie, with pleat cuts
    ctx.beginPath();
    ctx.moveTo(-7, -12);
    ctx.quadraticCurveTo(-8.5, -19, -11, -23);
    ctx.quadraticCurveTo(-3.5, -20.5, 0, -21.5);
    ctx.quadraticCurveTo(3.5, -20.5, 11, -23);
    ctx.quadraticCurveTo(8.5, -19, 7, -12);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, -8, -23, 8, -12, [
      [0, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.dark, 1.4);
    noShadow(ctx);
    // pleats in the gathered neck
    ctx.strokeStyle = withAlpha(pal.dark, 0.4);
    ctx.lineWidth = 1;
    for (const x of [-4.5, 0, 4.5]) {
      ctx.beginPath();
      ctx.moveTo(x * 0.9, -20);
      ctx.lineTo(x, -13);
      ctx.stroke();
    }
    // knotted rope tie: dark strand + light strand + knot bead and hanging tail
    ctx.strokeStyle = pal.dark;
    ctx.lineWidth = 3.4;
    ctx.beginPath();
    ctx.moveTo(-8.5, -13.5);
    ctx.quadraticCurveTo(0, -9.5, 8.5, -13.5);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(pal.light, 0.75);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-8, -14);
    ctx.quadraticCurveTo(0, -10.2, 8, -14);
    ctx.stroke();
    ctx.fillStyle = pal.dark;
    ctx.beginPath();
    ctx.arc(8.2, -12.6, 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = pal.dark;
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(8.6, -11);
    ctx.quadraticCurveTo(10.5, -6, 9.2, -1.5);
    ctx.stroke();
    // two soft cloth folds falling from the cinch (kept faint so the bag does
    // not read as a striped vase at 40px)
    ctx.strokeStyle = withAlpha(pal.dark, 0.28);
    ctx.lineWidth = 1.6;
    for (const x of [-5.5, 4]) {
      ctx.beginPath();
      ctx.moveTo(x * 0.5, -9);
      ctx.quadraticCurveTo(x * 1.35, 5, x * 0.8, 16);
      ctx.stroke();
    }
    // stitched bottom seam: short dashes following the belly curve
    ctx.strokeStyle = withAlpha(pal.light, 0.55);
    ctx.lineWidth = 1.3;
    for (let i = -3; i <= 3; i++) {
      const a = Math.PI / 2 + i * 0.19;
      const cx = Math.cos(a) * 16.4;
      const cy = 3.2 + Math.sin(a) * 16.2;
      ctx.beginPath();
      ctx.moveTo(cx - 1.4, cy - 0.4);
      ctx.lineTo(cx + 1.4, cy + 0.4);
      ctx.stroke();
    }
    // top-left sheen following the body curve
    ctx.strokeStyle = withAlpha(pal.light, 0.6);
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(-12.5, -7);
    ctx.quadraticCurveTo(-16.5, 2, -12, 13);
    ctx.stroke();
    ctx.restore();
  },
  droplet(ctx, pal) {
    ctx.beginPath();
    ctx.moveTo(0, -20);
    ctx.bezierCurveTo(6.5, -9, 13, -1, 13, 8);
    ctx.bezierCurveTo(13, 16, 7, 21.5, 0, 21.5);
    ctx.bezierCurveTo(-7, 21.5, -13, 16, -13, 8);
    ctx.bezierCurveTo(-13, -1, -6.5, -9, 0, -20);
    ctx.closePath();
    ctx.fillStyle = rad(ctx, -4.5, 3, 20, [
      [0, pal.light],
      [0.5, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.dark, 1.4);
    noShadow(ctx);
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.ellipse(-4.5, 2, 2.6, 4.2, 0.35, 0, TAU);
    ctx.fill();
  },
  bread(ctx, _pal) {
    ctx.beginPath();
    ctx.ellipse(0, 4, 19.5, 11, 0, 0, TAU);
    ctx.fillStyle = lin(ctx, 0, -8, 0, 15, [
      [0, '#e8b86a'],
      [0.55, '#b07e36'],
      [1, '#6e4716'],
    ]);
    ctx.fill();
    edge(ctx, '#3c2406', 1.4);
    noShadow(ctx);
    ctx.fillStyle = 'rgba(255,240,200,0.35)';
    ctx.beginPath();
    ctx.ellipse(-4, -1, 12, 5, -0.15, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = '#6e4716';
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const x of [-9, -1, 7]) {
      ctx.moveTo(x, -4.5);
      ctx.lineTo(x + 5, 3.5);
    }
    ctx.stroke();
  },
  meat(ctx, pal) {
    ctx.strokeStyle = '#efe7d2';
    ctx.lineWidth = 5;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(4, -2);
    ctx.lineTo(15, -12);
    ctx.stroke();
    ctx.fillStyle = '#f7f1e0';
    ctx.beginPath();
    ctx.arc(18, -15.5, 3.6, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(13, -18, 3.4, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-5, 4, 14.5, 13, -0.45, 0, TAU);
    ctx.fillStyle = rad(ctx, -10, -2, 22, [
      [0, pal.light],
      [0.55, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.accent, 1.5);
    noShadow(ctx);
    ctx.fillStyle = withAlpha(pal.light, 0.5);
    ctx.beginPath();
    ctx.ellipse(-9, -2, 6, 3.4, -0.5, 0, TAU);
    ctx.fill();
  },
  scroll(ctx, _pal) {
    ctx.rotate(-0.1);
    ctx.fillStyle = lin(ctx, 0, -12, 0, 12, [
      [0, '#f4e6bc'],
      [0.6, '#dcc183'],
      [1, '#a8854a'],
    ]);
    rrPath(ctx, -15, -12, 30, 24, 2);
    ctx.fill();
    edge(ctx, '#5e451c', 1.3);
    ctx.fillStyle = lin(ctx, 0, -16, 0, -9, [
      [0, '#efe0b2'],
      [1, '#8a6a34'],
    ]);
    rrPath(ctx, -18, -16, 36, 7, 3.5);
    ctx.fill();
    edge(ctx, '#5e451c', 1.2);
    ctx.fillStyle = lin(ctx, 0, 9, 0, 16, [
      [0, '#efe0b2'],
      [1, '#8a6a34'],
    ]);
    rrPath(ctx, -18, 9, 36, 7, 3.5);
    ctx.fill();
    edge(ctx, '#5e451c', 1.2);
    noShadow(ctx);
    ctx.strokeStyle = '#6e5526';
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const y of [-6, -1, 4]) {
      ctx.moveTo(-10, y);
      ctx.lineTo(y === -1 ? 11 : 7, y);
    }
    ctx.stroke();
  },
  gem(ctx, pal) {
    const pts: [number, number][] = [];
    for (let i = 0; i < 6; i++) {
      const a = -Math.PI / 2 + (i / 6) * TAU;
      pts.push([Math.cos(a) * 16, Math.sin(a) * 16]);
    }
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x, y);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, -12, -14, 12, 16, [
      [0, pal.light],
      [0.5, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.dark, 1.6);
    noShadow(ctx);
    ctx.strokeStyle = withAlpha(pal.light, 0.75);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const [x, y] of pts) {
      ctx.moveTo(x * 0.45, y * 0.45 - 2);
      ctx.lineTo(x, y);
    }
    ctx.moveTo(pts[0][0] * 0.45, pts[0][1] * 0.45 - 2);
    for (const [x, y] of pts.slice(1)) ctx.lineTo(x * 0.45, y * 0.45 - 2);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.beginPath();
    ctx.arc(-5, -7, 1.6, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(3, 1, 1, 0, TAU);
    ctx.fill();
  },
  coin(ctx, pal) {
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, TAU);
    ctx.fillStyle = rad(ctx, -5.5, -6.5, 21, [
      [0, pal.light],
      [0.55, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.accent, 1.6);
    noShadow(ctx);
    ctx.strokeStyle = pal.dark;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, 11.5, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = withAlpha(pal.light, 0.85);
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.arc(0, 0, 13.8, Math.PI * 0.7, Math.PI * 1.45);
    ctx.stroke();
    ctx.strokeStyle = pal.dark;
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-4.5, 4);
    ctx.lineTo(-4.5, -2);
    ctx.lineTo(0, -5);
    ctx.lineTo(4.5, -2);
    ctx.lineTo(4.5, 4);
    ctx.closePath();
    ctx.stroke();
  },
  paw(ctx, pal) {
    ctx.fillStyle = rad(ctx, -3, 2, 22, [
      [0, pal.light],
      [0.5, pal.base],
      [1, pal.dark],
    ]);
    ctx.beginPath();
    ctx.moveTo(0, -2);
    ctx.quadraticCurveTo(-12, 0, -10, 11);
    ctx.quadraticCurveTo(-7, 18, 0, 18);
    ctx.quadraticCurveTo(7, 18, 10, 11);
    ctx.quadraticCurveTo(12, 0, 0, -2);
    ctx.closePath();
    ctx.fill();
    edge(ctx, pal.accent, 1.4);
    for (const [x, y, r] of [
      [-12, -7, 4.4],
      [-4.5, -12, 4.6],
      [4.5, -12, 4.6],
      [12, -7, 4.4],
    ] as const) {
      ctx.beginPath();
      ctx.ellipse(x, y, r, r + 1, 0, 0, TAU);
      ctx.fill();
      edge(ctx, pal.accent, 1.2);
    }
  },
  fang(ctx, pal) {
    ctx.beginPath();
    ctx.moveTo(-8, -17);
    ctx.quadraticCurveTo(7, -17, 9, -4);
    ctx.quadraticCurveTo(10.5, 7, 3, 19.5);
    ctx.quadraticCurveTo(3.5, 5, -2.5, -3);
    ctx.quadraticCurveTo(-8.5, -9, -8, -17);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, -6, -16, 6, 18, [
      [0, pal.light],
      [0.55, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.accent, 1.3);
    ctx.fillStyle = pal.dark;
    ctx.beginPath();
    ctx.ellipse(-0.5, -16.2, 8, 3, 0.12, 0, TAU);
    ctx.fill();
    edge(ctx, pal.accent, 1);
    noShadow(ctx);
    ctx.strokeStyle = withAlpha(pal.light, 0.8);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(4.5, -10);
    ctx.quadraticCurveTo(7, 2, 2.8, 15);
    ctx.stroke();
  },
  web(ctx, pal) {
    ctx.strokeStyle = withAlpha(pal.light, 0.9);
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU + Math.PI / 6;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * 30, Math.sin(a) * 30);
      ctx.stroke();
    }
    for (const r of [10, 19, 28]) {
      ctx.beginPath();
      for (let i = 0; i <= 6; i++) {
        const a0 = (i / 6) * TAU + Math.PI / 6;
        const x = Math.cos(a0) * r,
          y = Math.sin(a0) * r;
        if (i === 0) {
          ctx.moveTo(x, y);
          continue;
        }
        const am = a0 - Math.PI / 6;
        ctx.quadraticCurveTo(Math.cos(am) * r * 0.82, Math.sin(am) * r * 0.82, x, y);
      }
      ctx.stroke();
    }
  },
  bone(ctx, pal) {
    ctx.rotate(0.7);
    ctx.fillStyle = lin(ctx, 0, -6, 0, 8, [
      [0, pal.light],
      [0.6, pal.base],
      [1, pal.dark],
    ]);
    rrPath(ctx, -20, -3, 40, 6, 3);
    ctx.fill();
    edge(ctx, pal.accent, 1.2);
    for (const ex of [-20, 20]) {
      for (const ey of [-4, 4]) {
        ctx.beginPath();
        ctx.arc(ex, ey, 5.4, 0, TAU);
        ctx.fill();
        edge(ctx, pal.accent, 1.1);
      }
    }
  },
  candle(ctx, _pal) {
    ctx.fillStyle = lin(ctx, -6, 0, 6, 0, [
      [0, '#f6ecd2'],
      [0.5, '#e2cfa2'],
      [1, '#9a8054'],
    ]);
    rrPath(ctx, -6, -2, 12, 24, 2);
    ctx.fill();
    edge(ctx, '#5c4a26', 1.3);
    ctx.fillStyle = '#f6ecd2';
    ctx.beginPath();
    ctx.ellipse(-5, 1, 2.2, 4, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(4.5, 2.5, 1.8, 5, 0, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(0, -2, 6, 2.2, 0, 0, TAU);
    ctx.fill();
    edge(ctx, '#9a8054', 0.8);
    noShadow(ctx);
    ctx.strokeStyle = '#3a2c14';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.moveTo(0, -2.5);
    ctx.lineTo(0, -7);
    ctx.stroke();
    ctx.shadowColor = '#ffb45e';
    ctx.shadowBlur = 7;
    ctx.beginPath();
    ctx.moveTo(0, -19);
    ctx.quadraticCurveTo(4.6, -12, 3.2, -8.5);
    ctx.quadraticCurveTo(1.8, -5.5, 0, -5.5);
    ctx.quadraticCurveTo(-1.8, -5.5, -3.2, -8.5);
    ctx.quadraticCurveTo(-4.6, -12, 0, -19);
    ctx.closePath();
    ctx.fillStyle = rad(ctx, 0, -9, 8, [
      [0, '#fff3c0'],
      [0.5, '#ffb45e'],
      [1, '#c83e10'],
    ]);
    ctx.fill();
    noShadow(ctx);
  },
  crate(ctx, _pal) {
    ctx.beginPath();
    ctx.moveTo(-15, -9);
    ctx.lineTo(-7, -18);
    ctx.lineTo(23, -18);
    ctx.lineTo(15, -9);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, 0, -18, 0, -9, [
      [0, '#b88c50'],
      [1, '#7a5226'],
    ]);
    ctx.fill();
    edge(ctx, '#2e1c08', 1.2);
    ctx.beginPath();
    ctx.moveTo(15, -9);
    ctx.lineTo(23, -18);
    ctx.lineTo(23, 9);
    ctx.lineTo(15, 18);
    ctx.closePath();
    ctx.fillStyle = '#5e3c16';
    ctx.fill();
    edge(ctx, '#2e1c08', 1.2);
    ctx.fillStyle = lin(ctx, -15, -9, 15, 18, [
      [0, '#a87c44'],
      [0.5, '#8a6230'],
      [1, '#553414'],
    ]);
    rrPath(ctx, -15, -9, 30, 27, 1);
    ctx.fill();
    edge(ctx, '#2e1c08', 1.4);
    noShadow(ctx);
    ctx.strokeStyle = '#3e2810';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(-15, 0);
    ctx.lineTo(15, 0);
    ctx.moveTo(-15, 9);
    ctx.lineTo(15, 9);
    ctx.stroke();
    ctx.strokeStyle = '#6e4c22';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-13, -7);
    ctx.lineTo(13, 16);
    ctx.moveTo(13, -7);
    ctx.lineTo(-13, 16);
    ctx.stroke();
    ctx.fillStyle = '#d8b070';
    for (const [x, y] of [
      [-12.5, -6.5],
      [12.5, -6.5],
      [-12.5, 15],
      [12.5, 15],
    ] as const) {
      ctx.beginPath();
      ctx.arc(x, y, 1.2, 0, TAU);
      ctx.fill();
    }
  },
  sigil_rune(ctx, pal) {
    ctx.strokeStyle = pal.base;
    ctx.lineWidth = 3;
    ctx.shadowColor = pal.glow;
    ctx.shadowBlur = 6;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 0;
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = pal.glow;
    ctx.lineWidth = 3.5;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-8, 11);
    ctx.lineTo(-8, -11);
    ctx.lineTo(0, 1);
    ctx.lineTo(8, -11);
    ctx.lineTo(8, 11);
    ctx.stroke();
    noShadow(ctx);
  },
  heart(ctx, pal) {
    ctx.beginPath();
    ctx.moveTo(0, 17);
    ctx.bezierCurveTo(-15, 5, -16, -9, -8.5, -12.5);
    ctx.bezierCurveTo(-3.5, -14.8, -0.5, -10.5, 0, -7);
    ctx.bezierCurveTo(0.5, -10.5, 3.5, -14.8, 8.5, -12.5);
    ctx.bezierCurveTo(16, -9, 15, 5, 0, 17);
    ctx.closePath();
    ctx.fillStyle = rad(ctx, -5, -6, 22, [
      [0, pal.light],
      [0.5, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.accent, 1.5);
    noShadow(ctx);
    ctx.fillStyle = 'rgba(255,255,255,0.65)';
    ctx.beginPath();
    ctx.ellipse(-6, -7, 3, 1.9, -0.5, 0, TAU);
    ctx.fill();
  },
  sunburst(ctx, pal) {
    noShadow(ctx);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = withAlpha(pal.glow, 0.9);
    for (let i = 0; i < 8; i++) {
      ctx.save();
      ctx.rotate((i / 8) * TAU);
      const len = i % 2 === 0 ? 24 : 16;
      ctx.beginPath();
      ctx.moveTo(-2.6, -7);
      ctx.lineTo(0, -len);
      ctx.lineTo(2.6, -7);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.shadowColor = pal.glow;
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.arc(0, 0, 7, 0, TAU);
    ctx.fillStyle = rad(ctx, 0, 0, 7.5, [
      [0, '#ffffff'],
      [0.55, pal.light],
      [1, pal.base],
    ]);
    ctx.fill();
    noShadow(ctx);
  },
  moon(ctx, pal) {
    ctx.beginPath();
    ctx.moveTo(4, -16.6);
    ctx.bezierCurveTo(-19, -13, -19, 13, 4, 16.6);
    ctx.bezierCurveTo(-8, 10, -8, -10, 4, -16.6);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, -16, -10, 2, 14, [
      [0, pal.light],
      [0.6, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.dark, 1.2);
    noShadow(ctx);
    ctx.fillStyle = withAlpha(pal.dark, 0.5);
    ctx.beginPath();
    ctx.arc(-9, -3, 1.8, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-6, 6, 1.3, 0, TAU);
    ctx.fill();
  },
  bell(ctx, pal) {
    // hand-bell silhouette: dome + flared lip, crown loop above, clapper below
    ctx.beginPath();
    ctx.moveTo(-13, 12);
    ctx.bezierCurveTo(-13, 2, -11, -14, 0, -17);
    ctx.bezierCurveTo(11, -14, 13, 2, 13, 12);
    ctx.lineTo(17, 16);
    ctx.lineTo(-17, 16);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, -12, -16, 10, 14, [
      [0, pal.light],
      [0.55, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.dark, 1.2);
    ctx.beginPath();
    ctx.arc(0, -19, 3.2, 0, TAU);
    ctx.strokeStyle = pal.dark;
    ctx.lineWidth = 2.4;
    ctx.stroke();
    noShadow(ctx);
    ctx.beginPath();
    ctx.arc(0, 21, 3.6, 0, TAU);
    ctx.fillStyle = rad(ctx, -1, 20, 4.2, [
      [0, pal.light],
      [1, pal.dark],
    ]);
    ctx.fill();
  },
  lightning(ctx, pal) {
    ctx.shadowColor = pal.glow;
    ctx.shadowBlur = 8;
    ctx.shadowOffsetX = 0;
    ctx.shadowOffsetY = 1;
    ctx.beginPath();
    ctx.moveTo(7, -28);
    ctx.lineTo(-9, 3);
    ctx.lineTo(-1, 3);
    ctx.lineTo(-7, 28);
    ctx.lineTo(12, -4);
    ctx.lineTo(3, -4);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, 0, -28, 0, 28, [
      [0, '#ffffff'],
      [0.35, pal.light],
      [1, pal.base],
    ]);
    ctx.fill();
    edge(ctx, pal.dark, 1.2);
    noShadow(ctx);
  },
  leaf(ctx, pal) {
    ctx.rotate(-0.5);
    ctx.beginPath();
    ctx.moveTo(0, -22);
    ctx.quadraticCurveTo(13.5, -8, 8, 11);
    ctx.quadraticCurveTo(4.5, 19, 0, 22);
    ctx.quadraticCurveTo(-4.5, 19, -8, 11);
    ctx.quadraticCurveTo(-13.5, -8, 0, -22);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, -10, -16, 10, 18, [
      [0, pal.light],
      [0.5, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.accent, 1.4);
    noShadow(ctx);
    ctx.strokeStyle = withAlpha(pal.dark, 0.85);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(0, -19);
    ctx.quadraticCurveTo(1.5, 0, 0, 20);
    ctx.stroke();
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (const [y, dy] of [
      [-12, 6],
      [-4, 7],
      [4, 7],
    ] as const) {
      ctx.moveTo(0.5, y);
      ctx.lineTo(7, y + dy);
      ctx.moveTo(0.5, y);
      ctx.lineTo(-6.5, y + dy);
    }
    ctx.stroke();
  },
  claw_slash(ctx, pal) {
    ctx.rotate(-0.35);
    for (const dx of [-9.5, 0, 9.5]) {
      ctx.beginPath();
      ctx.moveTo(dx - 4.5, -20);
      ctx.quadraticCurveTo(dx + 8, -4, dx - 1, 20);
      ctx.quadraticCurveTo(dx + 2.5, -4, dx - 7.5, -16.5);
      ctx.closePath();
      ctx.fillStyle = lin(ctx, dx, -20, dx, 20, [
        [0, pal.light],
        [0.6, pal.base],
        [1, pal.light],
      ]);
      ctx.fill();
      edge(ctx, pal.dark, 0.9);
    }
  },
  eye(ctx, pal) {
    const almond = () => {
      ctx.beginPath();
      ctx.moveTo(-17, 0);
      ctx.quadraticCurveTo(0, -14, 17, 0);
      ctx.quadraticCurveTo(0, 14, -17, 0);
      ctx.closePath();
    };
    almond();
    ctx.fillStyle = lin(ctx, 0, -9, 0, 9, [
      [0, '#ffffff'],
      [0.6, pal.light],
      [1, withAlpha(pal.dark, 0.9)],
    ]);
    ctx.fill();
    edge(ctx, pal.dark, 1.6);
    ctx.save();
    almond();
    ctx.clip();
    noShadow(ctx);
    ctx.beginPath();
    ctx.arc(0, 0, 6.6, 0, TAU);
    ctx.fillStyle = rad(ctx, -1.6, -1.8, 7.5, [
      [0, pal.light],
      [0.5, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(0, 0, 2.9, 0, TAU);
    ctx.fillStyle = pal.accent;
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.95)';
    ctx.beginPath();
    ctx.arc(-2.2, -2.4, 1.3, 0, TAU);
    ctx.fill();
    ctx.restore();
  },
  cross(ctx, pal) {
    ctx.shadowColor = pal.glow;
    ctx.shadowBlur = 8;
    ctx.fillStyle = lin(ctx, -6, -20, 6, 16, [
      [0, '#ffffff'],
      [0.4, pal.light],
      [1, pal.base],
    ]);
    flaredBar(ctx, -23, 17);
    ctx.fill();
    edge(ctx, pal.dark, 1.2);
    ctx.save();
    ctx.translate(0, -5.5);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = lin(ctx, -6, -14, 6, 14, [
      [0, '#ffffff'],
      [0.4, pal.light],
      [1, pal.base],
    ]);
    flaredBar(ctx, -16, 16);
    ctx.fill();
    edge(ctx, pal.dark, 1.2);
    ctx.restore();
    noShadow(ctx);
  },
  wing(ctx, pal) {
    ctx.translate(10, 8);
    const feathers: [number, number][] = [
      [-2.7, 30],
      [-2.25, 26],
      [-1.8, 21],
      [-1.35, 16],
    ];
    for (const [a, len] of feathers) {
      ctx.save();
      ctx.rotate(a);
      ctx.fillStyle = lin(ctx, 0, 0, len, 0, [
        [0, pal.dark],
        [0.55, pal.base],
        [1, pal.light],
      ]);
      rrPath(ctx, 0, -3, len, 6, 3);
      ctx.fill();
      edge(ctx, pal.dark, 1);
      ctx.restore();
    }
    ctx.beginPath();
    ctx.arc(0, 0, 4.5, 0, TAU);
    ctx.fillStyle = pal.base;
    ctx.fill();
    edge(ctx, pal.dark, 1);
  },
  sheep_head(ctx, _pal) {
    ctx.fillStyle = rad(ctx, -4, -8, 24, [
      [0, '#ffffff'],
      [0.6, '#e8e4da'],
      [1, '#a8a094'],
    ]);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      ctx.beginPath();
      ctx.arc(Math.cos(a) * 11, Math.sin(a) * 11 - 2, 5.5, 0, TAU);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(0, -2, 11.5, 0, TAU);
    ctx.fill();
    for (const s of [-1, 1]) {
      ctx.save();
      ctx.translate(s * 13, 2);
      ctx.rotate(s * 0.6);
      ctx.fillStyle = '#cdb6a4';
      rrPath(ctx, -2.5, -3, 5, 9, 2.5);
      ctx.fill();
      edge(ctx, '#6e5544', 1);
      ctx.restore();
    }
    ctx.fillStyle = lin(ctx, 0, 0, 0, 16, [
      [0, '#bfa890'],
      [1, '#6e5544'],
    ]);
    ctx.beginPath();
    ctx.ellipse(0, 7, 7, 9.5, 0, 0, TAU);
    ctx.fill();
    edge(ctx, '#4e3a2c', 1.2);
    noShadow(ctx);
    ctx.fillStyle = '#241810';
    ctx.beginPath();
    ctx.arc(-3, 4.5, 1.4, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(3, 4.5, 1.4, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(-1.7, 11.5, 0.9, 1.4, 0.3, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(1.7, 11.5, 0.9, 1.4, -0.3, 0, TAU);
    ctx.fill();
  },
  tendrils(ctx, pal) {
    ctx.lineCap = 'round';
    const vines: [number, number][] = [
      [-13, -0.3],
      [0, 0.15],
      [13, 0.45],
    ];
    for (const [x, bend] of vines) {
      const tipX = x + bend * 10;
      ctx.strokeStyle = lin(ctx, 0, 28, 0, -20, [
        [0, pal.dark],
        [0.5, pal.base],
        [1, pal.light],
      ]);
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x, 28);
      ctx.bezierCurveTo(x - 6, 14, x + 7, 4, tipX, -8);
      ctx.quadraticCurveTo(tipX + 6, -16, tipX - 2, -19);
      ctx.stroke();
      ctx.strokeStyle = pal.light;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(tipX - 2, -16, 3, -1.2, 2.6);
      ctx.stroke();
      ctx.fillStyle = pal.light;
      ctx.beginPath();
      ctx.ellipse(x - 4, 12, 3.4, 1.7, -0.7, 0, TAU);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x + 4, 2, 3.4, 1.7, 0.7, 0, TAU);
      ctx.fill();
    }
  },
  imp_head(ctx, pal) {
    ctx.fillStyle = lin(ctx, 0, -30, 0, -8, [
      [0, pal.light],
      [1, pal.dark],
    ]);
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 8, -10);
      ctx.quadraticCurveTo(s * 21, -19, s * 15, -31);
      ctx.quadraticCurveTo(s * 12, -22, s * 3, -13);
      ctx.closePath();
      ctx.fill();
      edge(ctx, pal.dark, 1);
    }
    ctx.fillStyle = pal.base;
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(s * 11, -2);
      ctx.lineTo(s * 25, -5);
      ctx.lineTo(s * 12, 8);
      ctx.closePath();
      ctx.fill();
      edge(ctx, pal.dark, 1);
    }
    ctx.beginPath();
    ctx.arc(0, 2, 14, 0, TAU);
    ctx.fillStyle = rad(ctx, -4, -2, 18, [
      [0, pal.light],
      [0.6, pal.base],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.accent, 1.4);
    noShadow(ctx);
    ctx.fillStyle = '#ffe14a';
    ctx.beginPath();
    ctx.ellipse(-5, 0, 2.4, 3.4, 0.4, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(5, 0, 2.4, 3.4, -0.4, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = withAlpha(pal.dark, 0.9);
    ctx.lineWidth = 1.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-6, 8);
    ctx.quadraticCurveTo(0, 13, 6, 8);
    ctx.stroke();
  },
  void_brute(ctx, pal) {
    ctx.fillStyle = lin(ctx, 0, -22, 0, 24, [
      [0, pal.light],
      [0.5, pal.base],
      [1, pal.dark],
    ]);
    ctx.beginPath();
    ctx.moveTo(-20, -4);
    ctx.quadraticCurveTo(-23, -20, -10, -20);
    ctx.quadraticCurveTo(0, -27, 10, -20);
    ctx.quadraticCurveTo(23, -20, 20, -4);
    ctx.lineTo(15, 24);
    ctx.lineTo(-15, 24);
    ctx.closePath();
    ctx.fill();
    edge(ctx, pal.accent, 1.6);
    noShadow(ctx);
    ctx.beginPath();
    ctx.arc(0, -15, 7, 0, TAU);
    ctx.fillStyle = pal.dark;
    ctx.fill();
    ctx.shadowColor = pal.glow;
    ctx.shadowBlur = 8;
    ctx.fillStyle = '#c87bff';
    for (const s of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(s * 3, -16, 1.9, 0, TAU);
      ctx.fill();
    }
    noShadow(ctx);
  },
  meteor(ctx, pal) {
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = withAlpha(pal.glow, 0.6);
    ctx.lineCap = 'round';
    for (const [w, o] of [
      [8, 0],
      [3.5, -5],
    ] as const) {
      ctx.lineWidth = w;
      ctx.beginPath();
      ctx.moveTo(22 + o, -26 - o);
      ctx.lineTo(2, -2);
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.beginPath();
    ctx.moveTo(-2, -3);
    ctx.lineTo(8, -7);
    ctx.lineTo(15, 4);
    ctx.lineTo(8, 15);
    ctx.lineTo(-5, 12);
    ctx.lineTo(-9, 2);
    ctx.closePath();
    ctx.fillStyle = rad(ctx, 2, 0, 20, [
      [0, pal.light],
      [0.5, pal.base],
      [1, '#2a1206'],
    ]);
    ctx.fill();
    edge(ctx, pal.dark, 1.4);
    noShadow(ctx);
    ctx.strokeStyle = withAlpha(pal.glow, 0.9);
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-2, 0);
    ctx.lineTo(4, 4);
    ctx.lineTo(1, 9);
    ctx.stroke();
  },
  roar(ctx, pal) {
    ctx.beginPath();
    ctx.moveTo(-20, -6);
    ctx.quadraticCurveTo(0, -16, 20, -6);
    ctx.quadraticCurveTo(14, 20, 0, 22);
    ctx.quadraticCurveTo(-14, 20, -20, -6);
    ctx.closePath();
    ctx.fillStyle = rad(ctx, 0, 4, 22, [
      [0, '#400d0d'],
      [1, pal.dark],
    ]);
    ctx.fill();
    edge(ctx, pal.accent, 1.6);
    noShadow(ctx);
    ctx.fillStyle = '#f6efdc';
    for (const x of [-13, -5, 5, 13]) {
      ctx.beginPath();
      ctx.moveTo(x - 3, -8);
      ctx.lineTo(x + 3, -8);
      ctx.lineTo(x, 3);
      ctx.closePath();
      ctx.fill();
      edge(ctx, '#9a8c66', 0.6);
    }
    for (const x of [-9, 0, 9]) {
      ctx.beginPath();
      ctx.moveTo(x - 3, 16);
      ctx.lineTo(x + 3, 16);
      ctx.lineTo(x, 6);
      ctx.closePath();
      ctx.fill();
      edge(ctx, '#9a8c66', 0.6);
    }
  },
  crosshair(ctx, pal) {
    ctx.strokeStyle = pal.base;
    ctx.lineWidth = 2.4;
    ctx.shadowColor = pal.glow;
    ctx.shadowBlur = 6;
    ctx.beginPath();
    ctx.arc(0, 0, 18, 0, TAU);
    ctx.stroke();
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    ctx.arc(0, 0, 10, 0, TAU);
    ctx.stroke();
    noShadow(ctx);
    ctx.strokeStyle = pal.light;
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      ctx.moveTo(Math.cos(a) * 6, Math.sin(a) * 6);
      ctx.lineTo(Math.cos(a) * 24, Math.sin(a) * 24);
    }
    ctx.stroke();
    ctx.fillStyle = pal.accent;
    ctx.beginPath();
    ctx.arc(0, 0, 2.2, 0, TAU);
    ctx.fill();
  },
} satisfies Record<string, Painter>;
type PrimitiveName = keyof typeof PRIMITIVES;

// ---------------------------------------------------------------------------
// FX painters (glow draws under primitives, the rest draw over)
// ---------------------------------------------------------------------------

const FX = {
  glow(ctx: Ctx, pal: IconPalette): void {
    ctx.fillStyle = rad(ctx, 0, 0, 31, [
      [0, withAlpha(pal.glow, 0.55)],
      [1, withAlpha(pal.glow, 0)],
    ]);
    ctx.fillRect(-50, -50, 100, 100);
  },
  sparkle(ctx: Ctx, pal: IconPalette): void {
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = pal.light;
    for (const [x, y, s] of [
      [-18, -14, 5.5],
      [16, -20, 4.5],
      [20, 12, 3.5],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(x, y - s);
      ctx.quadraticCurveTo(x + s * 0.2, y - s * 0.2, x + s, y);
      ctx.quadraticCurveTo(x + s * 0.2, y + s * 0.2, x, y + s);
      ctx.quadraticCurveTo(x - s * 0.2, y + s * 0.2, x - s, y);
      ctx.quadraticCurveTo(x - s * 0.2, y - s * 0.2, x, y - s);
      ctx.closePath();
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  },
  crack(ctx: Ctx, pal: IconPalette): void {
    ctx.strokeStyle = withAlpha(pal.dark, 0.9);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(-1, 1);
    ctx.lineTo(-7, 9);
    ctx.lineTo(-5, 16);
    ctx.lineTo(-11, 25);
    ctx.moveTo(2, -2);
    ctx.lineTo(9, -10);
    ctx.lineTo(7, -17);
    ctx.lineTo(13, -26);
    ctx.stroke();
  },
  drips(ctx: Ctx, pal: IconPalette): void {
    for (const [x, y] of [
      [-10, 18],
      [0, 24],
      [10, 16],
    ] as const) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(0.24, 0.24);
      PRIMITIVES.droplet(ctx, pal);
      ctx.restore();
    }
  },
  motion(ctx: Ctx, pal: IconPalette): void {
    ctx.strokeStyle = withAlpha(pal.light, 0.4);
    ctx.lineWidth = 2.6;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const o of [-12, 0, 12]) {
      ctx.moveTo(-26 + o * 0.7, -26 - o * 0.7);
      ctx.lineTo(22 + o * 0.7, 22 - o * 0.7);
    }
    ctx.stroke();
  },
  arcs(ctx: Ctx, pal: IconPalette): void {
    ctx.lineCap = 'round';
    const alphas = [0.8, 0.55, 0.3];
    [18, 26, 34].forEach((r, i) => {
      ctx.strokeStyle = withAlpha(pal.light, alphas[i]);
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(0, 0, r, -1.4, -0.18);
      ctx.stroke();
    });
  },
};
type FxName = keyof typeof FX;

// ---------------------------------------------------------------------------
// Recipes
// ---------------------------------------------------------------------------

interface Placement {
  p: PrimitiveName;
  x?: number;
  y?: number;
  s?: number;
  rot?: number;
  pal?: PaletteName;
  alpha?: number;
}
interface IconRecipe {
  bg: BgName;
  pal: PaletteName;
  prims: Placement[];
  fx?: FxName[];
}

// corner-badge / backdrop placement shorthand
const TL = { x: -13, y: -13, s: 0.45 } as const;
const TR = { x: 13, y: -13, s: 0.45 } as const;
const BR = { x: 13, y: 13, s: 0.45 } as const;
const BIG = { s: 1.15, alpha: 0.35 } as const;

function r(
  bg: BgName,
  pal: PaletteName,
  prims: (PrimitiveName | Placement)[],
  fx?: FxName[],
): IconRecipe {
  return { bg, pal, prims: prims.map((p) => (typeof p === 'string' ? { p } : p)), fx };
}

const ABILITY_RECIPES: Record<string, IconRecipe> = {
  // Talents 2.0 ground-targeted spells (each aimed AoE gets a distinct recipe;
  // grouped here so the family reads together, order within the map is cosmetic).
  flamestrike: r('fire', 'ember', ['meteor', { p: 'sunburst', ...BIG }], ['glow']),
  rain_of_fire: r(
    'fire',
    'ember',
    [
      { p: 'flame', x: -11, y: -11, s: 0.6 },
      { p: 'flame', s: 0.72 },
      { p: 'flame', x: 11, y: 11, s: 0.84 },
    ],
    ['drips'],
  ),
  volley: r(
    'storm',
    'sky',
    [
      { p: 'arrow', x: -11, y: -11, s: 0.6 },
      { p: 'arrow', s: 0.72 },
      { p: 'arrow', x: 11, y: 11, s: 0.84 },
    ],
    ['motion'],
  ),
  hurricane: r(
    'nature',
    'leafGreen',
    [
      { p: 'leaf', x: -11, y: -10, s: 0.62 },
      { p: 'leaf', s: 0.74 },
      { p: 'leaf', x: 11, y: 10, s: 0.62 },
    ],
    ['arcs'],
  ),
  earthquake: r('earth', 'earthBrown', ['sunburst'], ['crack']),
  attack: r('steel', 'steel', ['sword'], ['motion']),
  // pet action bar (dedicated, never a class ability id: see pet_action_icons.ts).
  pet_attack: r('blood', 'blood', ['fang'], ['motion']),
  pet_growl: r('fury', 'gold', ['roar'], ['arcs']),
  pet_feed: r('food', 'ember', ['meat']), // roasted meat: hunters feed, not magic-heal
  pet_mend: r('shadow', 'shadowPurple', ['heart'], ['drips']),
  pet_passive: r('nature', 'earthBrown', ['paw']),
  pet_defensive: r('leather', 'earthBrown', ['shield']),
  pet_aggressive: r('fury', 'blood', ['claw_slash'], ['glow']),
  // warrior
  heroic_strike: r('fury', 'steel', ['sword'], ['glow']),
  battle_shout: r('fury', 'gold', ['fist'], ['arcs']),
  commanding_shout: r('fury', 'earthBrown', ['shield'], ['arcs']),
  demoralizing_shout: r('shadow', 'steel', ['fist'], ['arcs']),
  charge: r('fury', 'steel', ['boot', { p: 'sword', ...BR }], ['motion']),
  rend: r('blood', 'blood', ['sword'], ['drips']),
  thunder_clap: r('storm', 'sky', ['lightning'], ['arcs']),
  hamstring: r('blood', 'blood', ['boot', { p: 'claw_slash', ...TR }]),
  bloodrage: r('blood', 'blood', ['heart'], ['drips', 'glow']),
  overpower: r('fury', 'gold', ['sword', { p: 'sunburst', ...TL }]),
  // mage
  fireball: r('fire', 'ember', ['bolt', { p: 'flame', ...BR }], ['glow']),
  pyroblast: r(
    'fire',
    'ember',
    [
      { p: 'sunburst', ...BIG },
      { p: 'flame', s: 0.9 },
    ],
    ['glow'],
  ),
  frost_armor: r('frost', 'ice', ['chestplate', { p: 'snowflake', ...TR }]),
  arcane_intellect: r('arcane', 'arcanePink', ['eye'], ['sparkle']),
  frostbolt: r('frost', 'ice', ['bolt', { p: 'snowflake', ...BR }], ['motion']),
  conjure_water: r('arcane', 'sky', [{ p: 'potion', pal: 'sky' }], ['sparkle']),
  fire_blast: r('fire', 'ember', [{ p: 'sunburst', ...BIG }, 'flame'], ['glow']),
  arcane_missiles: r(
    'arcane',
    'arcanePink',
    [
      { p: 'bolt', x: -12, y: -12, s: 0.55 },
      { p: 'bolt', s: 0.65 },
      { p: 'bolt', x: 12, y: 12, s: 0.75 },
    ],
    ['glow'],
  ),
  polymorph: r('arcane', 'pink', ['sheep_head'], ['sparkle']),
  frost_nova: r('frost', 'ice', ['snowflake'], ['arcs', 'glow']),
  // rogue
  sinister_strike: r('steel', 'steel', ['dagger'], ['glow']),
  eviscerate: r('blood', 'blood', ['dagger'], ['drips']),
  backstab: r('shadow', 'steel', [{ p: 'dagger', rot: Math.PI * 0.85 }], ['motion']),
  gouge: r('fury', 'blood', ['eye', { p: 'claw_slash', ...BR }]),
  evasion: r('storm', 'sky', ['shield'], ['motion']),
  slice_and_dice: r(
    'blood',
    'steel',
    [
      { p: 'dagger', x: -7, s: 0.85, rot: -0.5 },
      { p: 'dagger', x: 7, s: 0.85, rot: 0.5 },
    ],
    ['motion'],
  ),
  sprint: r('earth', 'leather', ['boot'], ['motion']),
  garrote: r('shadow', 'steel', [{ p: 'dagger', rot: 1.2 }], ['motion', 'drips']),
  cheap_shot: r('shadow', 'steel', ['fist', { p: 'dagger', ...BR }], ['arcs']),
  sap: r('shadow', 'steel', ['fist'], ['motion']),
  crippling_poison: r('nature', 'venom', ['droplet', { p: 'claw_slash', ...BR }], ['drips']),
  expose_armor: r('fury', 'steel', ['chestplate', { p: 'claw_slash', ...BR }]),
  rupture: r('blood', 'blood', ['dagger', { p: 'claw_slash', ...BR }], ['drips']),
  vanish: r('shadow', 'shadowPurple', ['shield'], ['motion', 'glow']),
  instant_poison: r('nature', 'venom', ['droplet'], ['glow']),
  deadly_poison: r('nature', 'venom', ['fang'], ['drips']),
  blind: r('shadow', 'shadowPurple', ['eye'], ['arcs']),
  // paladin
  seal_of_righteousness: r('holy', 'holyGold', [{ p: 'sunburst', ...BIG }, 'sigil_rune'], ['glow']),
  holy_light: r('holy', 'holyGold', ['sunburst'], ['glow', 'sparkle']),
  devotion_aura: r('holy', 'holyGold', ['shield', { p: 'sunburst', ...TL }]),
  judgement: r('holy', 'gold', [{ p: 'sunburst', ...BIG }, 'mace'], ['glow']),
  blessing_of_might: r('holy', 'gold', ['fist', { p: 'sunburst', ...TL }]),
  divine_protection: r('holy', 'silverWhite', ['shield'], ['glow']),
  hammer_of_justice: r('holy', 'gold', ['mace'], ['arcs']),
  lay_on_hands: r('holy', 'holyGold', [{ p: 'sunburst', ...BIG }, 'hand'], ['sparkle', 'glow']),
  // hunter
  raptor_strike: r('earth', 'blood', ['claw_slash']),
  aspect_of_the_hawk: r('storm', 'sky', ['wing'], ['glow']),
  aspect_of_the_monkey: r('nature', 'leafGreen', ['paw'], ['motion']),
  serpent_sting: r('nature', 'venom', ['fang', { p: 'arrow', ...BR }], ['drips']),
  arcane_shot: r('arcane', 'arcanePink', ['arrow'], ['glow', 'sparkle']),
  concussive_shot: r('storm', 'sky', ['arrow'], ['arcs']),
  mongoose_bite: r('earth', 'steel', ['fang', { p: 'claw_slash', ...BR }], ['motion']),
  wing_clip: r('earth', 'blood', ['wing', { p: 'claw_slash', ...BR }]),
  // the Vale Cup sport kit (boarball): the 'coin' disc reads as the ball
  sport_kick: r('earth', 'leather', ['coin', { p: 'boot', ...BR }]),
  sport_shoot: r('fury', 'ember', ['coin', { p: 'boot', ...BR }], ['motion']),
  sport_pass: r('nature', 'gold', ['coin', { p: 'boot', ...TL }], ['motion']),
  sport_boot: r('fury', 'gold', ['coin', { p: 'boot', ...BR }], ['motion']),
  sport_hoof: r('fury', 'steel', ['boot', { p: 'coin', ...TR }], ['arcs']),
  sport_punt: r('nature', 'leafGreen', ['coin', { p: 'sunburst', ...TL }], ['motion']),
  sport_feint: r('shadow', 'steel', ['boot'], ['arcs']),
  sport_dive: r('earth', 'leather', ['gauntlet', { p: 'coin', ...TR }], ['motion']),
  sport_shoulder: r('fury', 'steel', ['pauldron', { p: 'claw_slash', ...BR }]),
  sport_second_wind: r('nature', 'leafGreen', ['boot', { p: 'leaf', ...TR }], ['glow']),
  // priest
  smite: r('holy', 'holyGold', ['bolt', { p: 'sunburst', ...TL }], ['glow']),
  lesser_heal: r('holy', 'silverWhite', ['cross'], ['glow']),
  power_word_fortitude: r('holy', 'gold', ['shield', { p: 'cross', ...TL }]),
  shadow_word_pain: r('shadow', 'shadowPurple', ['skull', { p: 'claw_slash', ...BR }]),
  power_word_shield: r('holy', 'silverWhite', ['shield'], ['sparkle', 'glow']),
  renew: r('holy', 'leafGreen', [{ p: 'heart', pal: 'leafGreen' }], ['sparkle']),
  mind_blast: r('shadow', 'shadowPurple', ['eye'], ['arcs', 'glow']),
  // shaman
  lightning_bolt: r('storm', 'sky', ['lightning'], ['glow']),
  rockbiter_weapon: r('earth', 'earthBrown', ['fist'], ['crack']),
  healing_wave: r('frost', 'sky', ['droplet'], ['arcs', 'sparkle']),
  earth_shock: r('earth', 'earthBrown', [{ p: 'lightning', pal: 'earthBrown' }], ['crack']),
  lightning_shield: r('storm', 'sky', ['shield', { p: 'lightning', s: 0.6 }], ['glow']),
  flame_shock: r('fire', 'ember', ['flame'], ['arcs']),
  flametongue_weapon: r('fire', 'ember', ['sword', { p: 'flame', s: 0.6 }], ['glow']),
  frostbrand_weapon: r('frost', 'ice', ['sword', { p: 'snowflake', s: 0.6 }], ['glow']),
  // warlock
  shadow_bolt: r('shadow', 'shadowPurple', ['bolt'], ['glow']),
  demon_skin: r('shadow', 'venom', [{ p: 'chestplate', pal: 'venom' }]),
  immolate: r('fire', 'ember', ['flame'], ['crack', 'glow']),
  corruption: r('shadow', 'shadowPurple', ['skull'], ['drips']),
  life_tap: r('blood', 'shadowPurple', ['heart', { p: 'droplet', ...BR, pal: 'shadowPurple' }]),
  curse_of_agony: r('shadow', 'shadowPurple', ['skull'], ['arcs']),
  drain_life: r('shadow', 'blood', [{ p: 'droplet', pal: 'blood' }], ['motion', 'drips']),
  // druid
  wrath: r('nature', 'leafGreen', ['bolt', { p: 'leaf', ...BR }], ['glow']),
  healing_touch: r('nature', 'leafGreen', ['hand', { p: 'leaf', ...TL }], ['sparkle']),
  mark_of_the_wild: r('nature', 'leafGreen', ['paw'], ['sparkle']),
  moonfire: r('arcane', 'silverWhite', [{ p: 'moon', pal: 'silverWhite' }], ['glow', 'sparkle']),
  rejuvenation: r('nature', 'leafGreen', ['leaf'], ['sparkle', 'glow']),
  thorns: r('nature', 'leafGreen', ['leaf', { p: 'claw_slash', ...BR }]),
  entangling_roots: r('nature', 'leafGreen', ['tendrils']),
  bear_form: r('earth', 'earthBrown', [
    { p: 'paw', pal: 'earthBrown' },
    { p: 'claw_slash', ...BR },
  ]),
  travel_form: r('nature', 'leafGreen', [{ p: 'paw', pal: 'leafGreen' }], ['motion']),
  enrage: r('fury', 'blood', [{ p: 'paw', pal: 'blood' }], ['glow']),
  bash: r('earth', 'earthBrown', ['paw', { p: 'claw_slash', ...BR }]),
  faerie_fire: r('nature', 'leafGreen', [{ p: 'gem', pal: 'leafGreen' }], ['sparkle', 'glow']),
  hibernate: r('arcane', 'silverWhite', [{ p: 'moon', pal: 'silverWhite' }], ['sparkle']),
  dash: r('nature', 'leafGreen', ['paw', { p: 'claw_slash', ...TR }], ['motion']),
  pounce: r('nature', 'leafGreen', ['fang', { p: 'claw_slash', ...BR }], ['motion']),
  insect_swarm: r('nature', 'leafGreen', ['tendrils'], ['sparkle']),
  tigers_fury: r('fire', 'ember', ['fang'], ['glow']),
  rip: r('blood', 'blood', ['claw_slash'], ['drips']),
  // --- formerly procedural-fallback abilities: unique hand-authored icons ---
  // warrior
  execute: r('blood', 'blood', ['axe'], ['glow']),
  slam: r('fury', 'steel', ['mace'], ['motion']),
  cleave: r('fury', 'steel', ['axe'], ['arcs']),
  defensive_stance: r('steel', 'steel', ['shield'], ['arcs']),
  sunder_armor: r('steel', 'steel', ['chestplate', { p: 'mace', ...BR }]),
  taunt: r('fury', 'blood', ['fist'], ['arcs']),
  mortal_strike: r('blood', 'blood', ['sword', { p: 'claw_slash', ...BR }]),
  bloodthirst: r('blood', 'blood', ['heart', { p: 'dagger', ...BR }], ['drips']),
  shield_slam: r('steel', 'steel', ['shield', { p: 'mace', ...BR }]),
  whirlwind: r('fury', 'steel', ['sword'], ['arcs']),
  berserker_rage: r('fury', 'blood', ['fist'], ['glow']),
  // mage
  conjure_food: r('arcane', 'arcanePink', ['bread'], ['sparkle']),
  arcane_explosion: r('arcane', 'arcanePink', ['sunburst'], ['arcs']),
  scorch: r('fire', 'ember', ['flame'], ['motion']),
  ice_barrier: r('frost', 'ice', ['shield'], ['glow']),
  // rogue
  kidney_shot: r('shadow', 'steel', ['dagger', { p: 'boot', ...BR }]),
  ambush: r('shadow', 'steel', ['dagger'], ['motion']),
  stealth: r('shadow', 'steel', ['eye'], ['glow']),
  adrenaline_rush: r('fury', 'blood', ['lightning'], ['glow']),
  // paladin
  flash_of_light: r('holy', 'holyGold', ['hand'], ['sparkle', 'glow']),
  exorcism: r('holy', 'holyGold', ['sunburst'], ['glow']),
  consecration: r('holy', 'holyGold', ['sigil_rune'], ['glow']),
  righteous_fury: r('holy', 'gold', ['shield'], ['glow']),
  retribution_aura: r('holy', 'gold', ['sunburst'], ['arcs']),
  // hunter
  tame_beast: r('nature', 'gold', ['paw'], ['sparkle']),
  dismiss_pet: r('shadow', 'steel', ['paw'], ['arcs']),
  revive_pet: r('nature', 'leafGreen', ['heart', { p: 'paw', ...BR }], ['sparkle', 'glow']),
  aspect_of_the_cheetah: r('nature', 'leafGreen', ['boot', { p: 'paw', ...BR }], ['motion']),
  aimed_shot: r('steel', 'steel', ['crosshair', { p: 'arrow', ...BR }]),
  rapid_fire: r('fury', 'steel', ['arrow'], ['motion']),
  // priest
  heal: r('holy', 'holyGold', ['cross'], ['sparkle']),
  flash_heal: r('holy', 'holyGold', ['cross'], ['motion']),
  mind_flay: r('shadow', 'shadowPurple', ['eye'], ['motion']),
  // shaman
  frost_shock: r('frost', 'ice', ['snowflake'], ['motion']),
  ghost_wolf: r('nature', 'leafGreen', ['paw'], ['glow']),
  stormstrike: r('storm', 'sky', ['sword', { p: 'lightning', ...BR }]),
  // warlock
  fear: r('shadow', 'shadowPurple', ['roar'], ['glow']),
  searing_pain: r('fire', 'ember', ['bolt'], ['glow']),
  shadowburn: r('shadow', 'shadowPurple', ['flame'], ['glow']),
  summon_imp: r('fire', 'ember', ['imp_head'], ['glow']),
  summon_voidwalker: r('shadow', 'shadowPurple', ['void_brute'], ['glow']),
  summon_succubus: r('shadow', 'pink', ['heart', { p: 'wing', ...BR }], ['glow']),
  summon_felhunter: r('shadow', 'venom', ['eye', { p: 'tendrils', ...BR }], ['glow']),
  summon_felguard: r('shadow', 'steel', ['axe', { p: 'helm', ...TL }], ['glow']),
  summon_infernal: r('fire', 'ember', ['meteor'], ['glow']),
  summon_doomguard: r('shadow', 'shadowPurple', ['wing', { p: 'skull', ...BR }], ['glow']),
  // druid
  bear_charge: r('earth', 'earthBrown', ['paw', { p: 'boot', ...BR }], ['motion']),
  maul: r('earth', 'earthBrown', ['paw', { p: 'claw_slash', ...TR }], ['glow']),
  growl: r('earth', 'earthBrown', ['roar'], ['arcs']),
  demoralizing_roar: r('shadow', 'earthBrown', ['roar'], ['arcs']),
  cat_form: r('nature', 'leafGreen', ['paw', { p: 'fang', ...BR }]),
  prowl: r('nature', 'leafGreen', ['paw'], ['arcs']),
  rake: r('nature', 'leafGreen', ['claw_slash'], ['drips']),
  claw: r('nature', 'leafGreen', ['claw_slash'], ['motion']),
  ferocious_bite: r('blood', 'blood', ['fang'], ['drips']),
  swipe: r('earth', 'earthBrown', ['claw_slash'], ['arcs']),
  regrowth: r('nature', 'leafGreen', ['heart', { p: 'leaf', ...BR }], ['sparkle']),
  barkskin: r('earth', 'earthBrown', ['shield', { p: 'leaf', ...BR }]),
  starfire: r('arcane', 'silverWhite', ['moon', { p: 'sunburst', ...BR }], ['sparkle', 'glow']),
};

const ITEM_RECIPES: Record<string, IconRecipe> = {
  // Bags (+ the implicit backpack the bag bar shows). Palettes step up with
  // the quality tier so the bag reads richer as it grows.
  backpack: r('leather', 'earthBrown', [{ p: 'sack', pal: 'earthBrown' }]),
  linen_pouch: r('cloth', 'cloth', [{ p: 'sack', pal: 'cloth' }]),
  travelers_knapsack: r('leather', 'leather', [{ p: 'sack', pal: 'leather' }]),
  wolfhide_satchel: r('leather', 'earthBrown', [
    { p: 'sack', pal: 'earthBrown' },
    { p: 'paw', ...BR },
  ]),
  gravewoven_bag: r('shadow', 'shadowPurple', [{ p: 'sack', pal: 'shadowPurple' }], ['glow']),
  mistcallers_duffel: r(
    'arcane',
    'sky',
    [
      { p: 'sack', pal: 'sky' },
      { p: 'gem', ...TR },
    ],
    ['sparkle'],
  ),
  worn_sword: r('steel', 'steel', ['sword']),
  gnarled_staff: r('wood', 'earthBrown', [{ p: 'staff', pal: 'earthBrown' }]),
  rusty_dagger: r('steel', 'earthBrown', [{ p: 'dagger', pal: 'earthBrown' }]),
  training_mace: r('wood', 'earthBrown', [{ p: 'mace', pal: 'earthBrown' }]),
  rusty_hatchet: r('steel', 'earthBrown', [{ p: 'axe', pal: 'earthBrown' }]),
  recruit_tunic: r('leather', 'leather', [{ p: 'chestplate', pal: 'leather' }]),
  apprentice_robe: r('cloth', 'cloth', [{ p: 'chestplate', pal: 'cloth' }]),
  footpad_jerkin: r('leather', 'earthBrown', [{ p: 'chestplate', pal: 'earthBrown' }]),
  redbrook_blade: r('steel', 'steel', ['sword', { p: 'sunburst', ...TL }], ['glow']),
  apprentice_staff: r('arcane', 'arcanePink', ['staff', { p: 'gem', ...BR }], ['sparkle']),
  keen_dirk: r('steel', 'steel', ['dagger'], ['motion']),
  militia_vest: r('steel', 'steel', [{ p: 'chestplate', pal: 'steel' }]),
  woven_robe: r('cloth', 'arcanePink', ['chestplate', { p: 'sigil_rune', ...BR }]),
  shadow_jerkin: r('shadow', 'shadowPurple', [{ p: 'chestplate', pal: 'shadowPurple' }]),
  oiled_boots: r('leather', 'leather', ['boot'], ['glow']),
  quilted_trousers: r('cloth', 'cloth', ['trousers']),
  greyjaw_pelt_cloak: r('leather', 'earthBrown', ['trousers', { p: 'paw', ...BR }]),
  // Quartermaster's Consignment
  roadwardens_helm: r('steel', 'steel', [{ p: 'helm', pal: 'steel' }]),
  wayfarers_hood: r('leather', 'leather', [{ p: 'helm', pal: 'leather' }]),
  acolytes_circlet: r('cloth', 'gold', [
    { p: 'helm', pal: 'gold' },
    { p: 'gem', ...TR },
  ]),
  reinforced_pauldrons: r('steel', 'steel', [{ p: 'pauldron', pal: 'steel' }]),
  embroidered_mantle: r('cloth', 'arcanePink', [
    { p: 'pauldron', pal: 'cloth' },
    { p: 'sigil_rune', ...BR },
  ]),
  sturdy_belt: r('leather', 'leather', [{ p: 'belt', pal: 'leather' }]),
  silk_sash: r('cloth', 'cloth', [{ p: 'belt', pal: 'cloth' }]),
  roughspun_gloves: r('leather', 'earthBrown', [{ p: 'gauntlet', pal: 'earthBrown' }]),
  bristlehide_spaulders: r('leather', 'earthBrown', [
    { p: 'pauldron', pal: 'earthBrown' },
    { p: 'fang', ...BR },
  ]),
  sableweb_cord: r('cloth', 'shadowPurple', [
    { p: 'belt', pal: 'shadowPurple' },
    { p: 'web', ...TR },
  ]),
  gorraks_cleaver: r('steel', 'steel', [{ p: 'axe', pal: 'steel' }], ['glow']),
  mossy_handwraps: r('cloth', 'leafGreen', [{ p: 'gauntlet', pal: 'leafGreen' }]),
  baked_bread: r('food', 'gold', ['bread']),
  spring_water: r('drink', 'sky', [{ p: 'potion', pal: 'sky' }]),
  simple_fishing_pole: r('wood', 'earthBrown', [
    { p: 'staff', pal: 'earthBrown', rot: 0.7 },
    { p: 'droplet', pal: 'sky', x: 14, y: 18, s: 0.45 },
  ]),
  raw_mirror_trout: r('drink', 'sky', [
    { p: 'droplet', pal: 'sky', x: -4, y: 0, s: 1.1, rot: 1.55 },
    { p: 'fang', pal: 'silverWhite', x: 18, y: -1, s: 0.45, rot: 1.55 },
  ]),
  the_codfather: r(
    'treasure',
    'gold',
    [
      { p: 'droplet', pal: 'sky', x: -5, y: 0, s: 1.2, rot: 1.55 },
      { p: 'fang', pal: 'gold', x: 18, y: -1, s: 0.5, rot: 1.55 },
    ],
    ['sparkle'],
  ),
  tangled_weed: r('junk', 'venom', [{ p: 'tendrils', pal: 'venom' }]),
  roasted_boar: r('food', 'ember', ['meat']),
  conjured_water: r('arcane', 'sky', [{ p: 'potion', pal: 'sky' }], ['sparkle']),
  gravecaller_blade: r('shadow', 'steel', ['sword', { p: 'skull', ...BR }], ['glow']),
  widowfang_dirk: r('frost', 'ice', ['dagger', { p: 'web', ...TL }]),
  gravecaller_staff: r('shadow', 'shadowPurple', ['staff', { p: 'skull', ...BR }], ['glow']),
  boar_hide: r('leather', 'earthBrown', ['pelt']),
  gravecaller_sigil: r('shadow', 'shadowPurple', ['sigil_rune'], ['glow']),
  weathered_ledger_page: r('parchment', 'leather', ['scroll']),
  morthen_grimoire: r(
    'shadow',
    'shadowPurple',
    ['scroll', { p: 'skull', x: 10, y: 8, s: 0.55 }],
    ['glow'],
  ),
  fen_muster_order: r('parchment', 'gold', ['scroll'], ['glow']),
  lost_caravan_goods: r('leather', 'earthBrown', ['pelt']),
  rusted_censer: r('shadow', 'bone', ['candle'], ['drips']),
  bastion_ward_stone: r(
    'arcane',
    'arcanePink',
    ['sigil_rune', { p: 'gem', x: 0, y: -6, s: 0.55 }],
    ['glow'],
  ),
  highwatch_summons: r('parchment', 'steel', ['scroll'], ['glow']),
  ogre_war_totem: r('earth', 'earthBrown', ['bone', { p: 'sigil_rune', x: 0, y: 10, s: 0.7 }]),
  gravewyrm_sigil: r(
    'shadow',
    'ice',
    ['sigil_rune', { p: 'gem', x: 0, y: -4, s: 0.5 }],
    ['glow', 'sparkle'],
  ),
  sanctum_key_shard: r('arcane', 'sky', ['gem'], ['sparkle', 'glow']),
  blessed_wax: r('holy', 'holyGold', [{ p: 'droplet', pal: 'holyGold' }], ['sparkle']),
  ghostly_essence: r('shadow', 'silverWhite', [{ p: 'flame', pal: 'silverWhite' }], ['sparkle']),
  webwood_silk: r('shadow', 'silverWhite', ['web']),
  supply_crate: r('wood', 'earthBrown', ['crate']),
  greyjaw_fang: r('earth', 'bone', [{ p: 'fang', pal: 'bone' }]),
  wolf_fang: r('junk', 'bone', [{ p: 'fang', pal: 'bone' }], ['crack']),
  bandit_bandana: r('junk', 'blood', [{ p: 'pelt', pal: 'blood' }]),
  tough_jerky: r('food', 'earthBrown', [{ p: 'meat', pal: 'earthBrown' }]),
  mudfin_scale: r('junk', 'venom', [{ p: 'droplet', pal: 'venom' }]),
  tallow_candle: r('junk', 'gold', ['candle']),
  spider_leg: r('junk', 'shadowPurple', [{ p: 'claw_slash', s: 0.9, pal: 'shadowPurple' }]),
  bone_fragments: r(
    'junk',
    'bone',
    [
      { p: 'bone', x: -6, y: -4, s: 0.8 },
      { p: 'bone', x: 8, y: 6, s: 0.7, rot: 1.2 },
    ],
    ['crack'],
  ),
  linen_scrap: r('junk', 'silverWhite', [{ p: 'pelt', pal: 'silverWhite' }]),
  // --- The Drowned Litany (Drowned Reliquary Rite loot) ---
  siltguard_helm: r('earth', 'earthBrown', [
    { p: 'helm', pal: 'earthBrown' },
    { p: 'droplet', ...BR, pal: 'venom' },
  ]),
  bulwark_rusted_pauldrons: r(
    'earth',
    'earthBrown',
    [{ p: 'pauldron', pal: 'earthBrown' }],
    ['crack'],
  ),
  nhalias_bell_maul: r(
    'shadow',
    'bone',
    ['mace', { p: 'sunburst', ...TR, pal: 'bone' }],
    ['glow', 'arcs'],
  ),
  reedstalker_jerkin: r('leather', 'leafGreen', [{ p: 'chestplate', pal: 'leafGreen' }]),
  mirejaw_fang_knife: r('earth', 'venom', ['dagger', { p: 'fang', ...BR, pal: 'bone' }]),
  widow_silk_hood: r(
    'shadow',
    'shadowPurple',
    [
      { p: 'helm', pal: 'shadowPurple' },
      { p: 'web', ...TR },
    ],
    ['glow'],
  ),
  cantors_drowned_sash: r('drink', 'sky', [{ p: 'belt', pal: 'sky' }]),
  corpse_candle_focus: r('shadow', 'bone', [{ p: 'candle', pal: 'bone' }], ['drips']),
  nhalias_litany_rod: r(
    'shadow',
    'bone',
    ['staff', { p: 'sunburst', ...TR, pal: 'bone' }],
    ['glow'],
  ),
  blackwater_vanguard_chest: r(
    'steel',
    'steel',
    [
      { p: 'chestplate', pal: 'steel' },
      { p: 'droplet', ...BR, pal: 'sky' },
    ],
    ['glow', 'sparkle'],
  ),
  siltstep_leggings: r('leather', 'earthBrown', ['trousers'], ['glow', 'sparkle']),
  sunken_reliquary_hood: r(
    'cloth',
    'arcanePink',
    [
      { p: 'helm', pal: 'arcanePink' },
      { p: 'gem', ...TR },
    ],
    ['glow', 'sparkle'],
  ),
  // Heroic-dungeon participation token (final-boss personal drop).
  heroic_mark: r('holy', 'holyGold', ['sigil_rune'], ['glow']),
  // Heroic Quartermaster jewelry (marks-vendor rings and pendants); a coin
  // base reads as the band, the overlay carries the stat identity.
  seal_of_the_nine_oaths: r('fury', 'blood', ['coin', 'gem'], ['glow']),
  nielas_coldlight_band: r('arcane', 'arcanePink', ['coin', 'gem'], ['glow']),
  sutils_gambit: r('nature', 'leafGreen', ['coin', 'gem'], ['sparkle']),
  oath_of_the_round_table: r('earth', 'earthBrown', ['coin', 'gem'], ['glow']),
  zyzzs_deathless_signet: r('holy', 'holyGold', ['coin', 'sigil_rune'], ['glow']),
  architects_cornerstone: r('arcane', 'sky', ['coin', 'scroll'], ['glow']),
  swiftfang_talisman: r('storm', 'silverWhite', ['wing', 'gem'], ['motion']),
  yumis_keepsake_locket: r('storm', 'sky', ['gem'], ['sparkle', 'glow']),
  zense_meridian: r('arcane', 'arcanePink', ['moon', 'gem'], ['glow']),
  medallion_of_endless_profit: r('treasure', 'gold', ['coin', 'sunburst'], ['sparkle']),
  // misc UI icons (not real items)
  coin_gold: r('treasure', 'gold', ['coin'], ['sparkle']),
  slot_empty: r('junk', 'silverWhite', []),
};

// generic per-aura-kind fallbacks for auras not applied by a known ability
const AURA_RECIPES: Record<string, IconRecipe> = {
  aura_dot: r('shadow', 'shadowPurple', ['skull'], ['drips']),
  aura_hot: r('nature', 'leafGreen', ['heart'], ['sparkle']),
  aura_slow: r('frost', 'ice', ['boot', { p: 'snowflake', ...TR }]),
  aura_stun: r('storm', 'gold', ['sunburst']),
  aura_root: r('nature', 'leafGreen', ['tendrils']),
  aura_incapacitate: r('storm', 'sky', ['eye']),
  aura_polymorph: r('arcane', 'pink', ['sheep_head']),
  aura_attackspeed: r('storm', 'ice', ['axe', { p: 'snowflake', ...BR }]),
  aura_tongues: r('shadow', 'shadowPurple', ['skull'], ['motion']),
  aura_buff_sta: r('blood', 'blood', ['heart']),
  aura_buff_ap: r('fury', 'gold', ['fist']),
  aura_buff_armor: r('steel', 'steel', ['shield']),
  aura_buff_int: r('arcane', 'arcanePink', ['eye']),
  aura_buff_dodge: r('storm', 'sky', ['shield'], ['motion']),
  aura_buff_speed: r('earth', 'leather', ['boot'], ['motion']),
  aura_buff_haste: r('storm', 'sky', ['lightning']),
  aura_absorb: r('holy', 'silverWhite', ['shield'], ['glow']),
  aura_imbue: r('holy', 'holyGold', ['sword', { p: 'sunburst', ...TL }]),
  aura_buff_allstats: r('arcane', 'arcanePink', ['gem']),
  aura_thorns: r('nature', 'leafGreen', ['leaf', { p: 'claw_slash', ...BR }]),
  aura_cost_tax: r('shadow', 'shadowPurple', ['gem', { p: 'droplet', ...BR }], ['drips']),
  aura_heal_absorb: r('shadow', 'shadowPurple', ['heart'], ['drips']),
  aura_form_bear: r('earth', 'earthBrown', ['paw']),
};

// Crests: class / mob-family / status glyphs, painted with the same primitive
// vocabulary so unit-frame portraits and party rows match the spellbook art
// (replaces the old emoji FAMILY_GLYPH/CLASS_GLYPH; see docs/design/icon-system.md §10).
const CREST_RECIPES: Record<string, IconRecipe> = {
  // player classes (motif + class-flavoured background)
  class_warrior: r('fury', 'steel', ['sword'], ['glow']),
  class_paladin: r('holy', 'holyGold', ['mace'], ['glow']),
  class_hunter: r('nature', 'leafGreen', ['arrow'], ['glow']),
  class_rogue: r(
    'shadow',
    'steel',
    [
      { p: 'dagger', x: -6, rot: -0.42 },
      { p: 'dagger', x: 6, rot: 0.42 },
    ],
    ['motion'],
  ),
  class_priest: r('holy', 'silverWhite', ['cross'], ['glow', 'sparkle']),
  class_shaman: r('storm', 'sky', ['lightning'], ['glow']),
  class_mage: r('arcane', 'arcanePink', ['sigil_rune'], ['sparkle', 'glow']),
  class_warlock: r('shadow', 'shadowPurple', ['skull'], ['glow']),
  class_druid: r('nature', 'leafGreen', ['paw'], ['sparkle']),
  // mob families
  family_beast: r('earth', 'earthBrown', ['paw']),
  family_humanoid: r('steel', 'steel', ['sword']),
  family_mudfin: r('drink', 'sky', ['droplet']),
  family_spider: r('shadow', 'silverWhite', ['web']),
  family_burrower: r('earth', 'gold', ['candle']),
  family_undead: r('shadow', 'bone', ['skull']),
  family_troll: r('junk', 'bone', ['bone']),
  family_ogre: r('fury', 'earthBrown', ['fist']),
  family_elemental: r('storm', 'sky', ['lightning'], ['glow']),
  family_dragonkin: r('fire', 'ember', ['claw_slash'], ['glow']),
  family_sheep: r('nature', 'silverWhite', ['sheep_head']),
  // status / interaction markers
  status_npc: r('parchment', 'gold', ['sigil_rune']),
  status_boss: r('shadow', 'bone', ['skull'], ['glow']),
  status_dead: r('junk', 'bone', ['skull']),
  status_combat: r('fury', 'blood', ['sword']),
  // talent-tree icons (used when a node has no linked ability — derived from its
  // stat/global effect; see talentEffectIcon in hud.ts)
  talent_armor: r('steel', 'steel', ['shield']),
  talent_crit: r('fury', 'gold', ['sword', { p: 'sunburst', ...TL }]),
  talent_dodge: r('storm', 'sky', ['shield'], ['motion']),
  talent_ap: r('fury', 'gold', ['fist']),
  talent_health: r('blood', 'blood', ['heart']),
  talent_haste: r('storm', 'sky', ['lightning']),
  talent_choice: r('arcane', 'arcanePink', ['gem'], ['sparkle']),
  talent_generic: r('steel', 'steel', ['sigil_rune']),
  // Book of Deeds display-category base crests (deed_cat_<category>), one per
  // sidebar bucket; hidden deeds share the Feats shelf crest. Resolution
  // (bespoke first, else the category base) is deedCrestId in deeds_view.ts.
  deed_cat_progression: r('treasure', 'gold', ['sunburst'], ['glow']),
  deed_cat_combat: r('fury', 'blood', [
    { p: 'sword', x: -6, rot: -0.42 },
    { p: 'sword', x: 6, rot: 0.42 },
  ]),
  deed_cat_dungeon: r('shadow', 'silverWhite', ['skull', { p: 'sword', ...BIG }]),
  deed_cat_delve: r('earth', 'gold', ['candle'], ['glow']),
  deed_cat_chronicle: r('parchment', 'gold', ['scroll']),
  deed_cat_collection: r('treasure', 'gold', ['gem'], ['sparkle']),
  deed_cat_pvp: r('fury', 'gold', ['fist'], ['motion']),
  deed_cat_social: r('holy', 'pink', ['heart']),
  deed_cat_exploration: r('nature', 'earthBrown', ['boot'], ['motion']),
  deed_cat_feat: r('parchment', 'silverWhite', ['wing'], ['glow']),
  // Bespoke marquee crests (deed_<id>): the ~20-deed highlight subset of the
  // launch catalog's Steam marquee list (title/border capstones and iconic
  // milestones); every other deed renders its category base above.
  deed_prog_veteran: r('steel', 'leather', ['shield', { p: 'sunburst', ...TL }]),
  deed_prog_eternal: r('arcane', 'holyGold', ['sunburst'], ['glow', 'arcs']),
  deed_prog_prestige: r('storm', 'gold', [{ p: 'wing', ...BIG }, 'sunburst'], ['glow']),
  deed_prog_level_cap: r('storm', 'silverWhite', ['staff', { p: 'sunburst', ...TR }]),
  deed_cmb_first_blood: r('blood', 'steel', [
    { p: 'sword', x: -5, rot: -0.42 },
    { p: 'sword', x: 5, rot: 0.42 },
    { p: 'droplet', ...TL, pal: 'blood' },
  ]),
  deed_cmb_thunzharr_unbroken: r('storm', 'sky', ['lightning'], ['crack', 'glow']),
  deed_dgn_nythraxis: r('fire', 'ember', [{ p: 'shield', ...BIG }, 'claw_slash'], ['glow']),
  deed_dgn_korzul_flawless: r('shadow', 'bone', [
    'skull',
    { p: 'sword', y: 4, rot: Math.PI, s: 0.8 },
  ]),
  deed_dgn_nythraxis_deathless: r('holy', 'silverWhite', ['skull'], ['arcs', 'glow']),
  deed_dgn_deepward: r('shadow', 'gold', ['shield', { p: 'gem', ...TL }], ['glow']),
  deed_dlv_nhalia_bells: r('shadow', 'silverWhite', ['bell'], ['glow']),
  deed_dlv_tumbler_premium: r('treasure', 'gold', ['crate', { p: 'gem', ...TL }], ['sparkle']),
  deed_chr_vale_chapter_iii: r('nature', 'leafGreen', ['scroll', { p: 'leaf', ...TL }]),
  deed_chr_marsh_chapter_iii: r('drink', 'venom', ['scroll', { p: 'droplet', ...TL }]),
  deed_chr_peaks_chapter_iii: r('frost', 'sky', ['scroll', { p: 'snowflake', ...TL }]),
  deed_col_discovery_250: r('treasure', 'gold', ['crate'], ['sparkle', 'glow']),
  deed_col_seven_regalia: r('treasure', 'arcanePink', ['helm', { p: 'gem', ...TL }], ['sparkle']),
  deed_pvp_arena_1v1_1900: r('fury', 'holyGold', [{ p: 'sunburst', ...BIG }, 'sword'], ['glow']),
  deed_pvp_vcup_wins_25: r('nature', 'gold', ['roar', { p: 'coin', ...BR }]),
  deed_soc_wyrms_hoard: r(
    'treasure',
    'gold',
    [
      { p: 'coin', x: -8, y: 8, s: 0.8 },
      { p: 'coin', x: 8, y: -6 },
    ],
    ['sparkle'],
  ),
  deed_exp_world_traveler: r('nature', 'sky', ['crosshair', { p: 'boot', ...BR }], ['glow']),
};

// ---------------------------------------------------------------------------
// Procedural fallbacks for ids without a hand-assigned recipe
// ---------------------------------------------------------------------------

const UNKNOWN_RECIPE: IconRecipe = r('junk', 'silverWhite', ['sigil_rune']);

const SCHOOL_STYLE: Record<string, { bg: BgName; pal: PaletteName }> = {
  physical: { bg: 'steel', pal: 'steel' },
  fire: { bg: 'fire', pal: 'ember' },
  frost: { bg: 'frost', pal: 'ice' },
  arcane: { bg: 'arcane', pal: 'arcanePink' },
  shadow: { bg: 'shadow', pal: 'shadowPurple' },
  holy: { bg: 'holy', pal: 'holyGold' },
  nature: { bg: 'nature', pal: 'leafGreen' },
};

function has(name: string, words: string[]): boolean {
  return words.some((w) => name.includes(w));
}

function abilityPrimitive(name: string, effectsJson: string): PrimitiveName {
  if (has(name, ['shield', 'armor', 'protection', 'barrier', 'skin', 'block'])) return 'shield';
  if (has(name, ['renew', 'rejuv', 'regrowth', 'heart'])) return 'heart';
  if (has(name, ['heal', 'mend', 'touch', 'prayer'])) return 'cross';
  if (has(name, ['bolt', 'missile'])) return 'bolt';
  if (has(name, ['shot', 'arrow', 'aim'])) return 'arrow';
  if (has(name, ['flame', 'fire', 'immolat', 'burn', 'scorch', 'pyro'])) return 'flame';
  if (has(name, ['frost', 'ice', 'chill', 'freez', 'blizzard'])) return 'snowflake';
  if (has(name, ['lightning', 'thunder', 'storm', 'shock', 'adrenaline', 'haste']))
    return 'lightning';
  if (
    has(name, [
      'curse',
      'pain',
      'corrupt',
      'death',
      'plague',
      'agony',
      'fear',
      'terror',
      'horror',
      'scream',
    ])
  )
    return 'skull';
  if (has(name, ['root', 'entangl', 'vine', 'grasp'])) return 'tendrils';
  if (has(name, ['sting', 'bite', 'fang', 'venom', 'serpent'])) return 'fang';
  if (has(name, ['claw', 'rend', 'rake', 'slash', 'swipe', 'lacerat', 'eviscerat']))
    return 'claw_slash';
  if (has(name, ['sprint', 'dash', 'charge', 'travel', 'stampede'])) return 'boot';
  if (has(name, ['stab', 'ambush', 'dagger', 'rupture', 'kidney'])) return 'dagger';
  if (has(name, ['hammer', 'mace', 'judg'])) return 'mace';
  if (has(name, ['strike', 'slam', 'blade', 'sword', 'cleave', 'execute', 'mortal', 'whirlwind']))
    return 'sword';
  if (has(name, ['shout', 'roar', 'rally', 'might'])) return 'fist';
  if (has(name, ['moon', 'star'])) return 'moon';
  if (has(name, ['light', 'holy', 'bless', 'seal', 'smite', 'nova', 'blast'])) return 'sunburst';
  if (has(name, ['mind', 'eye', 'gaze', 'intellect', 'focus'])) return 'eye';
  if (has(name, ['mark', 'paw', 'bear', 'cat', 'wild', 'aspect', 'beast'])) return 'paw';
  if (has(name, ['wing', 'hawk', 'swoop', 'eagle'])) return 'wing';
  if (has(name, ['leaf', 'wrath', 'thorn', 'nature', 'bloom'])) return 'leaf';
  if (has(name, ['drain', 'tap', 'siphon', 'leech', 'wave'])) return 'droplet';
  if (has(name, ['word', 'rune', 'sigil', 'totem'])) return 'sigil_rune';
  if (effectsJson.toLowerCase().includes('heal')) return 'cross';
  return 'sigil_rune';
}

function abilityFallback(id: string): IconRecipe | null {
  const a = ABILITIES[id];
  if (!a) return null;
  const style = SCHOOL_STYLE[a.school] ?? SCHOOL_STYLE.physical;
  const prim = abilityPrimitive(a.name.toLowerCase(), JSON.stringify(a.effects ?? []));
  const isHelpful = a.targetType === 'friendly' || !a.requiresTarget;
  return r(style.bg, style.pal, [prim], isHelpful ? ['glow'] : undefined);
}

function qualityFx(quality: string | undefined): FxName[] | undefined {
  if (quality === 'epic') return ['glow', 'sparkle'];
  if (quality === 'rare') return ['glow'];
  return undefined;
}

function trinketPrimitive(name: string): { p: PrimitiveName; pal: PaletteName } {
  if (has(name, ['skull', 'head'])) return { p: 'skull', pal: 'bone' };
  if (has(name, ['bone'])) return { p: 'bone', pal: 'bone' };
  if (has(name, ['pelt', 'hide', 'fur', 'scrap', 'bandana', 'cloth']))
    return { p: 'pelt', pal: 'earthBrown' };
  if (has(name, ['fang', 'tooth', 'tusk', 'claw', 'talon'])) return { p: 'fang', pal: 'bone' };
  if (has(name, ['silk', 'web'])) return { p: 'web', pal: 'silverWhite' };
  if (has(name, ['crate', 'supply', 'cargo', 'box', 'cask', 'barrel']))
    return { p: 'crate', pal: 'earthBrown' };
  if (has(name, ['candle', 'wax', 'tallow'])) return { p: 'candle', pal: 'gold' };
  if (has(name, ['sigil', 'rune', 'talisman', 'idol', 'totem', 'amulet', 'charm']))
    return { p: 'sigil_rune', pal: 'arcanePink' };
  if (has(name, ['essence', 'ghost', 'spirit', 'soul', 'ember']))
    return { p: 'flame', pal: 'silverWhite' };
  if (has(name, ['gem', 'jewel', 'crystal', 'shard', 'stone', 'ore']))
    return { p: 'gem', pal: 'arcanePink' };
  if (
    has(name, [
      'letter',
      'scroll',
      'note',
      'missive',
      'ledger',
      'map',
      'journal',
      'report',
      'orders',
      'plans',
    ])
  )
    return { p: 'scroll', pal: 'leather' };
  if (has(name, ['heart'])) return { p: 'heart', pal: 'blood' };
  if (has(name, ['eye'])) return { p: 'eye', pal: 'sky' };
  if (has(name, ['coin', 'gold', 'payment'])) return { p: 'coin', pal: 'gold' };
  if (has(name, ['vial', 'blood', 'sample', 'venom', 'extract']))
    return { p: 'potion', pal: 'venom' };
  if (has(name, ['scale', 'slime'])) return { p: 'droplet', pal: 'venom' };
  if (has(name, ['feather', 'wing'])) return { p: 'wing', pal: 'sky' };
  if (has(name, ['key'])) return { p: 'sigil_rune', pal: 'gold' };
  return { p: 'scroll', pal: 'leather' };
}

function itemFallback(id: string): IconRecipe | null {
  const it = ITEMS[id];
  if (!it) return null;
  const name = it.name.toLowerCase();
  const fx = qualityFx(it.quality);
  if (it.kind === 'weapon') {
    const prim: PrimitiveName =
      it.weapon?.dagger || has(name, ['dagger', 'dirk', 'knife', 'shiv', 'kris'])
        ? 'dagger'
        : has(name, ['staff', 'rod', 'cane', 'branch', 'spire'])
          ? 'staff'
          : has(name, ['mace', 'hammer', 'club', 'maul', 'morningstar', 'cudgel'])
            ? 'mace'
            : has(name, ['axe', 'hatchet', 'cleaver'])
              ? 'axe'
              : has(name, ['bow'])
                ? 'bow'
                : has(name, ['wand'])
                  ? 'bolt'
                  : 'sword';
    return r('steel', 'steel', [prim], fx);
  }
  if (it.kind === 'armor') {
    const isCloth = has(name, [
      'robe',
      'vestment',
      'garb',
      'quilted',
      'woven',
      'silk',
      'linen',
      'mantle',
    ]);
    const isMetal = has(name, ['chain', 'plate', 'mail', 'steel', 'iron', 'bronze']);
    const prim: PrimitiveName =
      it.slot === 'feet'
        ? 'boot'
        : it.slot === 'legs'
          ? 'trousers'
          : it.slot === 'helmet'
            ? 'helm'
            : it.slot === 'waist'
              ? 'belt'
              : it.slot === 'shoulder'
                ? 'pauldron'
                : it.slot === 'gloves'
                  ? 'gauntlet'
                  : has(name, ['shield', 'bulwark', 'aegis'])
                    ? 'shield'
                    : 'chestplate';
    const pal: PaletteName = isCloth ? 'cloth' : isMetal ? 'steel' : 'leather';
    return r(isCloth ? 'cloth' : isMetal ? 'steel' : 'leather', pal, [{ p: prim, pal }], fx);
  }
  if (it.kind === 'food') {
    const prim: PrimitiveName = has(name, ['bread', 'loaf', 'bun', 'cake', 'biscuit', 'pie'])
      ? 'bread'
      : 'meat';
    return r('food', prim === 'bread' ? 'gold' : 'ember', [prim]);
  }
  if (it.kind === 'drink') {
    const isFlask = has(name, ['potion', 'elixir', 'draught', 'brew', 'water']);
    return isFlask
      ? r('drink', 'sky', [{ p: 'potion', pal: 'sky' }])
      : r('drink', 'sky', ['waterskin']);
  }
  if (it.kind === 'tool') {
    const prim: PrimitiveName = has(name, ['pole', 'rod', 'staff']) ? 'staff' : 'mace';
    return r('wood', 'earthBrown', [prim], fx);
  }
  if (it.kind === 'bag') {
    const isCloth = has(name, ['linen', 'silk', 'woven', 'cloth', 'wool']);
    return r(isCloth ? 'cloth' : 'leather', isCloth ? 'cloth' : 'leather', ['sack'], fx);
  }
  const t = trinketPrimitive(name);
  return r(it.kind === 'quest' ? 'parchment' : 'junk', t.pal, [{ p: t.p, pal: t.pal }], fx);
}

// ---------------------------------------------------------------------------
// Compositor
// ---------------------------------------------------------------------------

const SPECK_COUNT = 40;

function getCanvas2d(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas context is unavailable');
  return ctx;
}

function compose(recipe: IconRecipe, seedKey: string, size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = getCanvas2d(canvas);
  ctx.scale(size / 100, size / 100);

  ctx.save();
  rrPath(ctx, 0.5, 0.5, 99, 99, 12);
  ctx.clip();

  // background
  const bgc = BACKGROUNDS[recipe.bg];
  ctx.fillStyle = rad(ctx, 35, 30, 85, [
    [0, bgc[0]],
    [0.55, bgc[1]],
    [1, bgc[2]],
  ]);
  ctx.fillRect(0, 0, 100, 100);
  // vignette
  const vg = ctx.createRadialGradient(50, 50, 55, 50, 50, 85);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vg;
  ctx.fillRect(0, 0, 100, 100);
  // seeded speck noise so it doesn't read as a flat CSS gradient
  const rnd = mulberry32(hashStr(seedKey));
  for (let i = 0; i < SPECK_COUNT; i++) {
    ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.06)';
    ctx.fillRect(2 + rnd() * 96, 2 + rnd() * 96, 1.4, 1.4);
  }

  ctx.translate(50, 50);
  const pal = PALETTES[recipe.pal];
  const fx = recipe.fx ?? [];
  if (fx.includes('glow')) FX.glow(ctx, pal);
  for (const pl of recipe.prims) {
    ctx.save();
    ctx.translate(pl.x ?? 0, pl.y ?? 0);
    if (pl.rot) ctx.rotate(pl.rot);
    if (pl.s) ctx.scale(pl.s, pl.s);
    if (pl.alpha) ctx.globalAlpha = pl.alpha;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 3;
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 2;
    PRIMITIVES[pl.p](ctx, PALETTES[pl.pal ?? recipe.pal]);
    ctx.restore();
  }
  for (const f of fx) {
    if (f !== 'glow') FX[f](ctx, pal);
  }
  ctx.restore();

  // bevel frame (baked in; quality border lives in CSS outside it)
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#000000';
  rrPath(ctx, 1, 1, 98, 98, 11);
  ctx.stroke();
  const eg = ctx.createLinearGradient(0, 0, 100, 100);
  eg.addColorStop(0, 'rgba(255,255,255,0.28)');
  eg.addColorStop(0.5, 'rgba(255,255,255,0.05)');
  eg.addColorStop(0.55, 'rgba(0,0,0,0.1)');
  eg.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = eg;
  rrPath(ctx, 2.4, 2.4, 95.2, 95.2, 10);
  ctx.stroke();
  ctx.lineWidth = 1;
  ctx.strokeStyle = withAlpha(bgc[0], 0.22);
  rrPath(ctx, 3.6, 3.6, 92.8, 92.8, 9);
  ctx.stroke();

  return canvas;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// classic-MMO item-name quality colors (shared by tooltips, bags, rewards)
export const QUALITY_COLOR: Record<string, string> = {
  poor: '#9d9d9d',
  common: '#ffffff',
  uncommon: '#1eff00',
  rare: '#0070dd',
  epic: '#a335ee',
  legendary: '#ff8000',
};

// ---------------------------------------------------------------------------
// Photographic weapon icons
//
// Obtainable weapons (loot / vendor / quest drops) use a rendered thumbnail of
// the KayKit weapon model instead of a procedural recipe — see
// scripts/render_weapon_icons.mjs, which writes public/ui/weapons/<model>.jpg.
// Several items intentionally share a model (the pack has fewer meshes than we
// have weapons); the flashier meshes are reserved for rare/epic items. The
// model is purely cosmetic — rarity colour still comes from item.quality (the
// CSS .q-* border), exactly like the procedural icons.
// ---------------------------------------------------------------------------

const WEAPON_ICON_DIR = '/ui/weapons';

// Item id -> weapon variant key. Shared with the 3D held model so the bag icon
// and the in-hand weapon always match (src/ui/weapon_variants.ts).
const ITEM_ICON_IMAGES = ITEM_WEAPON_VARIANTS;

/** Static URL of a weapon's rendered thumbnail, or null if it uses a recipe. */
function weaponIconUrl(id: string): string | null {
  const model = ITEM_ICON_IMAGES[id];
  return model ? `${WEAPON_ICON_DIR}/${model}.jpg` : null;
}

// Hand-picked image icons for class abilities, committed as 128px WebP under
// public/ui/skills/<class>/<id>.webp (each icon's provenance/license is recorded in the
// per-class mapping.json). WebP is the source of truth: the tree is WebP only, no PNGs.
// To add an icon, drop the art into public/ui/skills/<class>/ in any common raster format
// and run `npm run assets:skills` (scripts/convert_skill_icons_webp.mjs): it encodes each
// non-webp image to WebP (quality 82, alphaQuality 100, smartSubsample true, effort 6) and
// deletes the original. Then list its id below. Class folder is derived from the ability's
// own `class`, so adding a class is just listing its ability ids here. Abilities not listed
// fall through to the procedural ABILITY_RECIPES below. ABILITY_IMAGE_IDS and abilityImageUrl
// are exported for the gate in tests/skill_icons.test.ts.
const SKILL_ICON_DIR = '/ui/skills';
export const ABILITY_IMAGE_IDS = new Set<string>([
  // paladin (CraftPix premium "RPG Paladin skill icons" pack)
  'seal_of_righteousness',
  'holy_light',
  'devotion_aura',
  'judgement',
  'blessing_of_might',
  'divine_protection',
  'hammer_of_justice',
  'lay_on_hands',
  'flash_of_light',
  'exorcism',
  'consecration',
  'righteous_fury',
  'retribution_aura',
  // hunter (CraftPix premium "RPG Archer skill icons" pack). The archer pack is
  // arrows/bows/traps only — the beast/aspect-animal abilities (aspect_of_the_hawk,
  // aspect_of_the_monkey, tame_beast, dismiss_pet, revive_pet) have no fitting art
  // here and intentionally stay on their procedural recipes until a beast pack lands.
  'raptor_strike',
  'mongoose_bite',
  'arcane_shot',
  'serpent_sting',
  'concussive_shot',
  'aimed_shot',
  'rapid_fire',
  'wing_clip',
  'aspect_of_the_cheetah',
  // priest (CraftPix premium "RPG Priest skill icons" pack). The pack is all-holy —
  // the shadow spells (shadow_word_pain, mind_flay) have no dark art and stay procedural.
  'smite',
  'lesser_heal',
  'power_word_fortitude',
  'power_word_shield',
  'renew',
  'mind_blast',
  'heal',
  'flash_heal',
  // warlock (CraftPix premium "RPG Warlock skill icons" pack + "RPG Demon skill icons"
  // pack for the summons/life_tap/searing_pain that the warlock pack couldn't cover).
  'shadow_bolt',
  'demon_skin',
  'immolate',
  'corruption',
  'curse_of_agony',
  'drain_life',
  'fear',
  'shadowburn',
  'summon_imp',
  'summon_voidwalker',
  'summon_succubus',
  'summon_felhunter',
  'summon_felguard',
  'summon_infernal',
  'summon_doomguard',
  'life_tap',
  'searing_pain',
  // rogue (CraftPix premium "RPG Thief skill icons" pack). garrote/sap/expose_armor/blind
  // have no fitting art (no garrote-wire, blackjack, armor-shred, or eye-powder) — procedural.
  'sinister_strike',
  'eviscerate',
  'backstab',
  'gouge',
  'cheap_shot',
  'evasion',
  'slice_and_dice',
  'sprint',
  'crippling_poison',
  'kidney_shot',
  'ambush',
  'rupture',
  'vanish',
  'instant_poison',
  'adrenaline_rush',
  'deadly_poison',
  'stealth',
  // warrior (CraftPix premium "RPG Warrior" + "RPG Berserker" packs; rage/fury abilities
  // drew from berserker). taunt has no provoke art and stays procedural.
  'heroic_strike',
  'battle_shout',
  'commanding_shout',
  'charge',
  'rend',
  'thunder_clap',
  'hamstring',
  'bloodrage',
  'overpower',
  'execute',
  'slam',
  'cleave',
  'defensive_stance',
  'demoralizing_shout',
  'sunder_armor',
  'mortal_strike',
  'bloodthirst',
  'shield_slam',
  'whirlwind',
  'berserker_rage',
  // mage (CraftPix premium pyromancer/cryomancer/lightning-mage packs — fire/frost/arcane;
  // aeromancer unused, mage has no wind). conjure_food and polymorph have no fit (no
  // bread/food or sheep art) and stay procedural.
  'fireball',
  'frost_armor',
  'arcane_intellect',
  'frostbolt',
  'conjure_water',
  'fire_blast',
  'arcane_missiles',
  'frost_nova',
  'arcane_explosion',
  'scorch',
  'ice_barrier',
  'pyroblast',
  // druid (CraftPix premium "RPG Druid" pack). moonfire (no moon), bear_charge, pounce,
  // demoralizing_roar, hibernate (no sleep), insect_swarm have no fitting art — procedural.
  'wrath',
  'healing_touch',
  'mark_of_the_wild',
  'rejuvenation',
  'thorns',
  'entangling_roots',
  'bear_form',
  'maul',
  'growl',
  'cat_form',
  'prowl',
  'rake',
  'claw',
  'regrowth',
  'ferocious_bite',
  'barkskin',
  'swipe',
  'starfire',
  'travel_form',
  'enrage',
  'bash',
  'faerie_fire',
  'dash',
  'tigers_fury',
  'rip',
  // shaman (no dedicated pack — matched against the two generic CraftPix "100 RPG/skill
  // icon" packs + earth-magician for the earth abilities; aeromancer went unused). 11/11.
  'lightning_bolt',
  'rockbiter_weapon',
  'healing_wave',
  'earth_shock',
  'lightning_shield',
  'flame_shock',
  'flametongue_weapon',
  'frost_shock',
  'frostbrand_weapon',
  'ghost_wolf',
  'stormstrike',
  // cross-class fills from the two generic CraftPix "100 RPG/skill icon" packs — abilities
  // their own class pack couldn't cover but a generic icon fit. (warrior taunt completes warrior.)
  'aspect_of_the_hawk',
  'tame_beast',
  'dismiss_pet', // hunter
  'shadow_word_pain', // priest
  'sap',
  'expose_armor', // rogue
  'taunt', // warrior
  'moonfire',
  'demoralizing_roar',
  'insect_swarm', // druid
  // final bespoke fills from per-ability "_Missing_*" packs — completes every class.
  'aspect_of_the_monkey',
  'revive_pet', // hunter
  'mind_flay', // priest
  'garrote',
  'blind', // rogue
  'conjure_food',
  'polymorph', // mage
  'bear_charge',
  'hibernate',
  'pounce', // druid
]);

/** Static URL of an ability's image icon, or null if it uses a recipe. */
export function abilityImageUrl(id: string): string | null {
  if (!ABILITY_IMAGE_IDS.has(id)) return null;
  const cls = ABILITIES[id]?.class;
  return cls ? `${SKILL_ICON_DIR}/${cls}/${id}.webp` : null;
}

// Item ids with committed painted art under /ui/items/<id>.webp (curated from the CraftPix
// resource/consumable AND armor/equipment packs; provenance + license in
// public/ui/items/mapping.json). Served for kind 'item' (bags, tooltips, loot, vendor, the
// /wiki guide). Covers everything except weapons, which keep their rendered-model thumbnails
// via WEAPON_ICON_DIR; items not listed fall through to the procedural ITEM_RECIPES below.
// For armor the icon is purely cosmetic (rarity colour still comes from item.quality), and the
// flashier icons are reserved for higher-rarity pieces. WebP only, like the skill icons. Add
// art via `npm run assets:items`, then list the item id here. Guarded by tests/item_icons.test.ts.
const ITEM_ICON_DIR = '/ui/items';
export const ITEM_IMAGE_IDS = new Set<string>([
  // food
  'baked_bread',
  'brightwood_venison',
  'conjured_bread',
  'conjured_bread3',
  'fenbridge_rye',
  'glimmerfin_koi',
  'raw_bog_eel',
  'raw_frostgill_trout',
  'raw_marsh_pike',
  'raw_mirror_trout',
  'raw_river_perch',
  'raw_stonescale_carp',
  'roast_mountain_goat',
  'roasted_boar',
  'smoked_eel',
  'tough_jerky',
  'trail_hardtack',
  // drink
  'conjured_water',
  'conjured_water2',
  'conjured_water3',
  'glacier_melt',
  'marsh_mint_tea',
  'silvermist_cordial',
  'spring_water',
  // potion
  'healing_potion',
  'lesser_healing_potion',
  'lesser_mana_potion',
  'mana_potion',
  'minor_healing_potion',
  // elixir
  'elixir_of_the_bear',
  // junk
  'amber_hide',
  'bogiron_nugget',
  'bone_fragments',
  'chipped_tusk',
  'cracked_fetish',
  'cracked_ogre_tusk',
  'cracked_wyrm_scale',
  'deepfen_pearl',
  'emberwing_cinderscale',
  'frayed_prayer_beads',
  'inert_storm_shard',
  'linen_scrap',
  'moonpale_scale',
  'mudfin_scale',
  'ogre_toe_ring',
  'old_cragmaws_pelt',
  'pale_pearl',
  'soft_down',
  'stag_antler',
  'tangled_weed',
  'wolf_fang',
  // quest
  'bastion_ward_stone',
  'blessed_embers',
  'boar_hide',
  'crypt_keystone',
  'crypt_ritual_circle',
  'cult_cipher',
  'drowned_offering',
  'fen_muster_order',
  'ghostly_essence',
  'glowing_wax',
  'grave_high_priest_malric',
  'gravecaller_sigil',
  'gravewyrm_sigil',
  'greyjaw_fang',
  'grubjaw_tusk',
  'highwatch_summons',
  'kazzix_heartshard',
  'lost_caravan_goods',
  'mire_prowler_pelt',
  'moongate_rubbing',
  'morthen_grimoire',
  'palecoil_heartscale',
  'priests_sigil',
  'ridge_stalker_pelt',
  'ritual_phylactery',
  'royal_seal',
  'runed_bone_shard',
  'storm_core',
  'supply_crate',
  'the_codfather',
  'troll_fetish',
  'weathered_ledger_page',
  'webwood_silk',
  'widow_venom_sac',
  'wyrmcult_orders',
  // tool
  'alien_armor_plate',
  'amber_crimson_armor_plate',
  'amethyst_silver_armor_plate',
  'crimson_amber_armor_plate',
  'cyan_magenta_armor_plate',
  'event_skin_token',
  'forest_pink_armor_plate',
  'imperial_crimson_armor_plate',
  'imperial_gold_armor_plate',
  'ivory_copper_armor_plate',
  'magenta_cyan_armor_plate',
  'pink_forest_armor_plate',
  'simple_fishing_pole',
  'steel_orange_armor_plate',
  'vanguard_azure_armor_plate',
  // equipment (CraftPix premium armor/helmet/boot/glove/greave/belt/jewelry + equipment packs;
  // curated per slot with rarity allocated by icon richness). Weapons are excluded: they keep
  // their rendered-model thumbnails via WEAPON_ICON_DIR.
  // armor - chest
  'apprentice_robe',
  'bogiron_hauberk',
  'boneguard_breastplate',
  'boneplate_vest',
  'bramblehide_jerkin',
  'broodmother_silk_robe',
  'caravan_quilted_vest',
  'cryptstalker_jerkin',
  'deathlord_warplate',
  'drownedguard_breastplate',
  'eastbrook_chain_vest',
  'fenmist_robe',
  'footpad_jerkin',
  'gravewoven_raiment',
  'gravewyrm_scale_hauberk',
  'highwatch_breastplate',
  'hollowbone_hauberk',
  'marshcloth_robe',
  'militia_vest',
  'mirejaw_scale_vest',
  'moonshroud_breastplate',
  'moonshroud_robe',
  'necromancers_starshroud',
  'outrider_brigandine',
  'peakwool_robe',
  'recruit_tunic',
  'reedwoven_jerkin',
  'reliquary_cloth_chest',
  'reliquary_plate_chest',
  'revenant_silk_robe',
  'shadow_jerkin',
  'skullsmasher_warbelt',
  'stalkerhide_jerkin',
  'tanned_leather_jerkin',
  'tidescale_vest',
  'valespun_robe',
  'wanderers_chestguard',
  'woven_robe',
  'wyrmcult_grand_robe',
  'wyrmscale_jerkin',
  'wyrmshadow_harness',
  // armor - legs
  'cryptbone_greaves',
  'deathlord_legguards',
  'drowned_prayer_leggings',
  'eastbrook_wool_trousers',
  'eelscale_leggings',
  'emberwing_legguards',
  'greyjaw_pelt_cloak',
  'hollowbound_legguards',
  'knight_commanders_greaves',
  'korgaths_chainwraps',
  'necromancers_legwraps',
  'nhalias_funeral_wraps',
  'oathbound_greaves',
  'outrider_legguards',
  'pilgrims_leggings',
  'quilted_trousers',
  'reedwoven_trousers',
  'reliquary_legs',
  'stormshard_leggings',
  'tideguard_greaves',
  'tidewatchers_wraps',
  'trail_leggings',
  'trollhide_leggings',
  'windguard_leggings',
  'wyrmshadow_legguards',
  'ysols_pearl_greaves',
  // armor - feet
  'cragmaw_prowlboots',
  'cragwalker_boots',
  'deathlord_sabatons',
  'drogmar_warboots',
  'drowned_prayer_sandals',
  'drownstep_sabatons',
  'drownstep_slippers',
  'drownstep_treads',
  'eelscale_treads',
  'fenwalker_boots',
  'gravepath_treads',
  'gravewalker_softboots',
  'gravewyrm_sabatons',
  'gravewyrm_stalkers_treads',
  'greyjaw_hide_boots',
  'hobnail_boots',
  'marrowlord_boneboots',
  'marrowtread_boots',
  'marshstrider_boots',
  'milepost_boots',
  'moggers_stomper_boots',
  'necromancers_soulsteps',
  'oiled_boots',
  'outrider_sabatons',
  'ridgestalker_treads',
  'sableweb_slippers',
  'selthes_seastriders',
  'sextons_slippers',
  'tideguard_sabatons',
  'wyrmcult_soulsteps',
  'wyrmshadow_treads',
  // armor - helmet
  'acolytes_circlet',
  'boundstone_helm',
  'crownforged_dreadhelm',
  'cryptbone_helm',
  'deacon_reliquary_helm',
  'deathlords_dread_visage',
  'monarch_crown_helm',
  'nighttalon_crown',
  'reliquary_helm',
  'roadwardens_helm',
  'soulflame_cowl',
  'stormcallers_crown',
  'varric_shadow_cowl',
  'wayfarers_hood',
  // armor - gloves
  'crownforged_gauntlets',
  'gravewyrm_gauntlets',
  'mistveil_grips',
  'mossy_handwraps',
  'nighttalon_grips',
  'reliquary_gloves_rog',
  'roughspun_gloves',
  'soulflame_gloves',
  'stormcallers_handguards',
  'wyrmshadow_talongrips',
  // armor - waist
  'boundstone_girdle',
  'cragmaw_huntcord',
  'crownforged_girdle',
  'mistveil_cord',
  'nighttalon_waistband',
  'sableweb_cord',
  'silk_sash',
  'soulflame_cord',
  'stormcallers_waistguard',
  'sturdy_belt',
  // bags
  'linen_pouch',
  'wolfhide_satchel',
  // tools (gathering picks/axes/sickles + cosmetic armor-plate skin tokens)
  'copper_mining_pick',
  'felling_axe',
  'gathering_sickle',
  'handaxe',
  'iron_mining_pick',
  'ironbark_axe',
  'mithril_mining_pick',
  'orange_steel_armor_plate',
  'silverleaf_sickle',
  'vanguard_chrome_armor_plate',
  // junk
  'bandit_bandana',
  'briny_idol',
  'soggy_moccasin',
  // food
  'conjured_bread2',
  // quest
  'blessed_wax',
  'captains_crest',
  'grave_captain_voss',
  'grave_sir_aldren',
  'kings_signet',
  'ogre_war_totem',
  'sanctum_key_shard',
  'unknown_alien_weaponry',
]);

/** Static URL of an item's image icon, or null if it uses a recipe. */
export function itemImageUrl(id: string): string | null {
  return ITEM_IMAGE_IDS.has(id) ? `${ITEM_ICON_DIR}/${id}.webp` : null;
}

// Book of Deeds crest ids are shaped `deed_<deedId>` (deeds_view.ts deedCrestId). Those whose
// deed ships committed painted art (public/ui/deeds/<deedId>.webp, listed in DEED_IMAGE_IDS)
// resolve to that static WebP. Mirrors itemImageUrl. The `deed_cat_<category>` base crests and
// every non-deed crest id (class crests, talent crests) prefix-strip to something not in the set,
// so they return null and fall through to their procedural recipe: a missing image never breaks
// a consumer.
const DEED_ICON_DIR = '/ui/deeds';
const DEED_CREST_PREFIX = 'deed_';
/** Static URL of a deed crest's painted art, or null when the crest id has no committed image. */
export function deedImageUrl(crestId: string): string | null {
  if (!crestId.startsWith(DEED_CREST_PREFIX)) return null;
  const deedId = crestId.slice(DEED_CREST_PREFIX.length);
  return DEED_IMAGE_IDS.has(deedId) ? `${DEED_ICON_DIR}/${deedId}.webp` : null;
}

const urlCache = new Map<string, string>();
const warnedIds = new Set<string>();

function resolveRecipe(kind: IconKind, id: string): IconRecipe {
  let recipe: IconRecipe | null = null;
  if (kind === 'ability') {
    recipe = ABILITY_RECIPES[id] ?? abilityFallback(id);
  } else if (kind === 'item') {
    recipe = ITEM_RECIPES[id] ?? itemFallback(id);
  } else if (kind === 'crest') {
    recipe = CREST_RECIPES[id] ?? null;
  } else {
    // auras carry the ability id that applied them, or a generic aura_<kind>
    recipe = AURA_RECIPES[id] ?? ABILITY_RECIPES[id] ?? abilityFallback(id);
  }
  if (!recipe) {
    if (import.meta.env?.DEV && !warnedIds.has(id)) {
      warnedIds.add(id);
      console.warn(`[icons] no recipe or def for ${kind} id "${id}" — using fallback icon`);
    }
    return UNKNOWN_RECIPE;
  }
  return recipe;
}

// Introspection helpers (no canvas needed), used by tests/ability_icons.test.ts
// to assert every ability has a deliberate, distinct icon recipe.
export function abilityIconRecipe(id: string): IconRecipe {
  return resolveRecipe('ability', id);
}
export function hasExplicitAbilityIcon(id: string): boolean {
  return id in ABILITY_RECIPES;
}

const DEFAULT_ICON_SIZE = 96; // crisp at 46px buttons on 2x displays
const canvasCache = new Map<string, HTMLCanvasElement>();

// Returns the cached composited <canvas> for an icon (ability/item/aura/crest).
// Synchronous — safe to drawImage immediately (used for unit-frame portraits).
export function iconCanvas(
  kind: IconKind,
  id: string,
  size: number = DEFAULT_ICON_SIZE,
): HTMLCanvasElement {
  const key = `${kind}|${id}|${size}`;
  let canvas = canvasCache.get(key);
  if (!canvas) {
    canvas = compose(resolveRecipe(kind, id), key, size);
    canvasCache.set(key, canvas);
  }
  return canvas;
}

// Returns the icon URL for an ability/item/aura/crest id — a static image URL
// for weapons that have a rendered thumbnail, otherwise a cached procedural PNG
// data URL. Both forms work as an <img src> or CSS background-image.
export function iconDataUrl(kind: IconKind, id: string, size: number = DEFAULT_ICON_SIZE): string {
  if (kind === 'item') {
    const weapon = weaponIconUrl(id);
    if (weapon) return weapon;
    const img = itemImageUrl(id);
    if (img) return img;
  }
  // Abilities, and auras that carry a real ability id (a DoT/buff applied by that
  // ability), share the same image-based skill art. abilityImageUrl returns null
  // for generic aura_<kind> ids, so those still fall through to the procedural recipe.
  if (kind === 'ability' || kind === 'aura') {
    const img = abilityImageUrl(id);
    if (img) return img;
  }
  // Deed crests with committed painted art short-circuit to the static WebP. A URL-only path is
  // sufficient: deed crests are only ever drawn into the Book of Deeds window <img> tags (cards
  // and the recent strip) through this function, never through the synchronous iconCanvas path
  // (that is class-crest portraits only, unit_portrait_painter.ts), so no canvas is needed. Every
  // other crest id (class/talent crests, the deed_cat_* bases, bespoke procedural recipes) returns
  // null here and falls through to the composited canvas below.
  if (kind === 'crest') {
    const img = deedImageUrl(id);
    if (img) return img;
  }
  const key = `${kind}|${id}|${size}`;
  const cached = urlCache.get(key);
  if (cached) return cached;
  const url = iconCanvas(kind, id, size).toDataURL();
  urlCache.set(key, url);
  return url;
}

// ---------------------------------------------------------------------------
// Raid / target markers (issue #105)
//
// Eight classic symbols (indexed 0..7) drawn flat and bold on a transparent
// canvas — a dark outline behind each colored shape keeps them legible while
// floating above mobs in the bright overworld. Unlike ability icons these have
// no frame/background; contrast comes from the baked outline (+ a CSS shadow).
// ---------------------------------------------------------------------------

export const RAID_MARKER_NAMES = [
  'Star',
  'Circle',
  'Diamond',
  'Triangle',
  'Moon',
  'Square',
  'Cross',
  'Skull',
] as const;
export const RAID_MARKER_COUNT = RAID_MARKER_NAMES.length;
const RAID_MARKER_FILL = [
  '#ffe23a',
  '#ff8a2a',
  '#d24bff',
  '#37d72c',
  '#cfe6ff',
  '#23b5ff',
  '#ff3b30',
  '#f4f4f4',
];
const RAID_MARKER_OUTLINE = '#0d0d12';
const RAID_MARKER_PX = 64;
const raidMarkerCache = new Map<number, string>();

function raidStarPath(ctx: Ctx): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rr = i % 2 === 0 ? 42 : 17;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = Math.cos(a) * rr,
      y = Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function raidSkullPath(ctx: Ctx): void {
  ctx.beginPath();
  ctx.arc(0, -10, 30, Math.PI, 0, false); // cranium dome
  ctx.lineTo(30, 6);
  ctx.quadraticCurveTo(30, 20, 16, 23);
  ctx.lineTo(13, 35);
  ctx.quadraticCurveTo(0, 41, -13, 35); // chin
  ctx.lineTo(-16, 23);
  ctx.quadraticCurveTo(-30, 20, -30, 6);
  ctx.closePath();
}

// Outline a single closed path, then fill it — the centered stroke leaves a
// crisp dark border once the fill paints over its inner half.
function raidStrokeFill(ctx: Ctx, fill: string): void {
  ctx.lineJoin = 'round';
  ctx.lineWidth = 9;
  ctx.strokeStyle = RAID_MARKER_OUTLINE;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
}

function drawRaidMarker(ctx: Ctx, idx: number): void {
  const fill = RAID_MARKER_FILL[idx] ?? '#ffffff';
  switch (idx) {
    case 0: // star
      raidStarPath(ctx);
      raidStrokeFill(ctx, fill);
      break;
    case 1: // circle
      ctx.beginPath();
      ctx.arc(0, 0, 37, 0, TAU);
      raidStrokeFill(ctx, fill);
      break;
    case 2: // diamond
      ctx.beginPath();
      ctx.moveTo(0, -42);
      ctx.lineTo(38, 0);
      ctx.lineTo(0, 42);
      ctx.lineTo(-38, 0);
      ctx.closePath();
      raidStrokeFill(ctx, fill);
      break;
    case 3: // triangle
      ctx.beginPath();
      ctx.moveTo(0, -40);
      ctx.lineTo(38, 32);
      ctx.lineTo(-38, 32);
      ctx.closePath();
      raidStrokeFill(ctx, fill);
      break;
    case 4: {
      // moon — a dark crescent with a slightly inset colored one on top
      const crescent = (outerR: number, carveX: number, carveR: number): void => {
        ctx.beginPath();
        ctx.arc(-4, 0, outerR, 0, TAU, false);
        ctx.arc(carveX, 0, carveR, 0, TAU, true); // opposite winding carves a bite
      };
      crescent(40, 20, 40);
      ctx.fillStyle = RAID_MARKER_OUTLINE;
      ctx.fill();
      crescent(34, 23, 40);
      ctx.fillStyle = fill;
      ctx.fill();
      break;
    }
    case 5: // square
      ctx.beginPath();
      ctx.rect(-34, -34, 68, 68);
      raidStrokeFill(ctx, fill);
      break;
    case 6: // cross (X) — two round-capped bars, wide dark pass then colored pass
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(-28, -28);
      ctx.lineTo(28, 28);
      ctx.moveTo(28, -28);
      ctx.lineTo(-28, 28);
      ctx.lineWidth = 28;
      ctx.strokeStyle = RAID_MARKER_OUTLINE;
      ctx.stroke();
      ctx.lineWidth = 16;
      ctx.strokeStyle = fill;
      ctx.stroke();
      break;
    case 7: // skull
      raidSkullPath(ctx);
      raidStrokeFill(ctx, fill);
      ctx.fillStyle = RAID_MARKER_OUTLINE;
      ctx.beginPath();
      ctx.ellipse(-12, -7, 8, 9, 0, 0, TAU);
      ctx.fill(); // left eye
      ctx.beginPath();
      ctx.ellipse(12, -7, 8, 9, 0, 0, TAU);
      ctx.fill(); // right eye
      ctx.beginPath();
      ctx.moveTo(0, 3);
      ctx.lineTo(5, 14);
      ctx.lineTo(-5, 14);
      ctx.closePath();
      ctx.fill(); // nose
      break;
    default:
      ctx.beginPath();
      ctx.arc(0, 0, 36, 0, TAU);
      raidStrokeFill(ctx, fill);
  }
}

// Cached transparent-background PNG data URL for raid marker `idx` (0..7).
export function raidMarkerDataUrl(idx: number): string {
  const cached = raidMarkerCache.get(idx);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = RAID_MARKER_PX;
  canvas.height = RAID_MARKER_PX;
  const ctx = getCanvas2d(canvas);
  ctx.scale(RAID_MARKER_PX / 100, RAID_MARKER_PX / 100);
  ctx.translate(50, 50);
  drawRaidMarker(ctx, idx);
  const url = canvas.toDataURL();
  raidMarkerCache.set(idx, url);
  return url;
}
