// Procedural Vale Cup nation flags (docs/prd/vale-cup.md): one CanvasTexture
// per banner nation, painted from the VC_NATIONS palette in src/sim/content/
// vale_cup.ts (single source: sim team tints, HUD flags, and these cloth
// textures can never drift). Bold flat-vector emblems sized to stay readable
// at 64px so the stadium flags read from across the pitch and on the Lambert
// low tier.
//
// This module deliberately owns ALL of its canvas code: src/render/textures.ts
// shares one module-local LCG whose generation ORDER is load-bearing, so flag
// art must never be added there (scout-verified gotcha). Everything here is
// deterministic closed-form drawing, no randomness at all.
import * as THREE from 'three';
import { VC_NATIONS, type VcNationDef } from '../sim/content/vale_cup';

export type VcEmblem = VcNationDef['emblem'];

export interface FlagPalette {
  /** flag field (background) color */
  field: number;
  /** accent color: border + emblem */
  accent: number;
  emblem: VcEmblem;
}

/** Pure palette resolve (no DOM): the away side plays the inverted palette. */
export function flagPalette(nationId: string, away = false): FlagPalette {
  const def = VC_NATIONS.find((n) => n.id === nationId) ?? VC_NATIONS[0];
  return {
    field: away ? def.secondary : def.primary,
    accent: away ? def.primary : def.secondary,
    emblem: def.emblem,
  };
}

/** Firework / bunting color pair for a nation (pure, test-safe). */
export function nationColors(nationId: string, away = false): [number, number] {
  const p = flagPalette(nationId, away);
  return [p.field, p.accent];
}

function css(hex: number, mixBlack = 0): string {
  const c = new THREE.Color(hex);
  if (mixBlack > 0) c.multiplyScalar(1 - mixBlack);
  return `#${c.getHexString()}`;
}

// ---------------------------------------------------------------------------
// Emblem glyphs. Each draws centered in a box (cx, cy, s) where s is the glyph
// half-extent; fill/stroke styles are set by the caller.
// ---------------------------------------------------------------------------

function drawWheat(g: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  // a tied sheaf: three fanned stalks with grain-head lozenges
  g.lineWidth = s * 0.14;
  g.lineCap = 'round';
  for (const lean of [-0.5, 0, 0.5]) {
    g.beginPath();
    g.moveTo(cx, cy + s * 0.9);
    g.quadraticCurveTo(cx + lean * s * 0.35, cy, cx + lean * s, cy - s * 0.55);
    g.stroke();
    // grain head: stacked lozenges along the stalk tip
    for (let i = 0; i < 3; i++) {
      const t = 0.55 + i * 0.16;
      const hx = cx + lean * s * t;
      const hy = cy - s * (t - 0.05);
      g.beginPath();
      g.ellipse(hx, hy, s * 0.13, s * 0.22, lean * 0.5, 0, Math.PI * 2);
      g.fill();
    }
  }
  // the tie
  g.beginPath();
  g.ellipse(cx, cy + s * 0.45, s * 0.3, s * 0.14, 0, 0, Math.PI * 2);
  g.fill();
}

function drawHeron(g: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  // standing heron: body drop, S-curve neck, dagger beak, stick legs
  g.beginPath();
  g.ellipse(cx - s * 0.1, cy + s * 0.25, s * 0.5, s * 0.34, -0.25, 0, Math.PI * 2);
  g.fill();
  g.lineWidth = s * 0.16;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(cx + s * 0.28, cy + s * 0.12);
  g.quadraticCurveTo(cx + s * 0.62, cy - s * 0.1, cx + s * 0.3, cy - s * 0.42);
  g.quadraticCurveTo(cx + s * 0.05, cy - s * 0.68, cx + s * 0.32, cy - s * 0.74);
  g.stroke();
  // head + beak
  g.beginPath();
  g.ellipse(cx + s * 0.34, cy - s * 0.74, s * 0.14, s * 0.11, 0, 0, Math.PI * 2);
  g.fill();
  g.beginPath();
  g.moveTo(cx + s * 0.44, cy - s * 0.78);
  g.lineTo(cx + s * 0.85, cy - s * 0.68);
  g.lineTo(cx + s * 0.44, cy - s * 0.66);
  g.closePath();
  g.fill();
  // legs
  g.lineWidth = s * 0.07;
  g.beginPath();
  g.moveTo(cx - s * 0.12, cy + s * 0.5);
  g.lineTo(cx - s * 0.12, cy + s * 0.95);
  g.moveTo(cx + s * 0.1, cy + s * 0.52);
  g.lineTo(cx + s * 0.16, cy + s * 0.95);
  g.stroke();
}

function drawPeak(g: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  // a bold mountain with a snowcap notch
  g.beginPath();
  g.moveTo(cx - s, cy + s * 0.7);
  g.lineTo(cx - s * 0.15, cy - s * 0.75);
  g.lineTo(cx + s * 0.25, cy - s * 0.1);
  g.lineTo(cx + s * 0.55, cy - s * 0.45);
  g.lineTo(cx + s, cy + s * 0.7);
  g.closePath();
  g.fill();
}

function drawSwords(g: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  // two crossed straight swords
  g.lineCap = 'butt';
  for (const dir of [-1, 1]) {
    const bx = cx + dir * s * 0.75;
    const by = cy + s * 0.8;
    const tx = cx - dir * s * 0.6;
    const ty = cy - s * 0.85;
    // blade
    g.lineWidth = s * 0.17;
    g.beginPath();
    g.moveTo(bx - dir * s * 0.28, by - s * 0.34);
    g.lineTo(tx, ty);
    g.stroke();
    // crossguard
    g.lineWidth = s * 0.1;
    g.beginPath();
    g.moveTo(bx - dir * s * 0.5, by - s * 0.28);
    g.lineTo(bx - dir * s * 0.12, by - s * 0.62);
    g.stroke();
    // grip
    g.lineWidth = s * 0.12;
    g.beginPath();
    g.moveTo(bx - dir * s * 0.28, by - s * 0.34);
    g.lineTo(bx, by);
    g.stroke();
  }
}

function drawBell(g: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  g.beginPath();
  g.moveTo(cx - s * 0.62, cy + s * 0.42);
  g.quadraticCurveTo(cx - s * 0.6, cy - s * 0.05, cx - s * 0.34, cy - s * 0.42);
  g.quadraticCurveTo(cx, cy - s * 0.78, cx + s * 0.34, cy - s * 0.42);
  g.quadraticCurveTo(cx + s * 0.6, cy - s * 0.05, cx + s * 0.62, cy + s * 0.42);
  g.closePath();
  g.fill();
  // lip + clapper
  g.fillRect(cx - s * 0.74, cy + s * 0.42, s * 1.48, s * 0.16);
  g.beginPath();
  g.arc(cx, cy + s * 0.74, s * 0.14, 0, Math.PI * 2);
  g.fill();
  // crown loop
  g.lineWidth = s * 0.1;
  g.beginPath();
  g.arc(cx, cy - s * 0.72, s * 0.12, 0, Math.PI * 2);
  g.stroke();
}

function drawFist(g: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  // a blocky raised fist: palm slab, four knuckle blocks, thumb bar
  const r = s * 0.12;
  const rr = (x: number, y: number, w: number, h: number): void => {
    // manual rounded rect (matches the src/ui/player_card.ts helper style)
    const rad = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rad, y);
    g.arcTo(x + w, y, x + w, y + h, rad);
    g.arcTo(x + w, y + h, x, y + h, rad);
    g.arcTo(x, y + h, x, y, rad);
    g.arcTo(x, y, x + w, y, rad);
    g.closePath();
    g.fill();
  };
  rr(cx - s * 0.55, cy - s * 0.2, s * 1.1, s * 0.85); // palm
  for (let i = 0; i < 4; i++) {
    const w = s * 0.24;
    rr(cx - s * 0.55 + i * (w + s * 0.045), cy - s * 0.72, w, s * 0.56);
  }
  rr(cx - s * 0.72, cy + s * 0.02, s * 0.3, s * 0.5); // thumb
  // wrist cuff
  rr(cx - s * 0.42, cy + s * 0.66, s * 0.84, s * 0.26);
}

function drawCrescent(g: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  g.beginPath();
  g.arc(cx, cy, s * 0.8, 0, Math.PI * 2);
  g.fill();
  g.save();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath();
  g.arc(cx + s * 0.38, cy - s * 0.18, s * 0.66, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

function drawPick(g: CanvasRenderingContext2D, cx: number, cy: number, s: number): void {
  // pickaxe: curved head + straight haft
  g.lineCap = 'round';
  g.lineWidth = s * 0.2;
  g.beginPath();
  g.moveTo(cx - s * 0.85, cy - s * 0.1);
  g.quadraticCurveTo(cx, cy - s * 0.85, cx + s * 0.85, cy - s * 0.1);
  g.stroke();
  g.lineWidth = s * 0.16;
  g.beginPath();
  g.moveTo(cx, cy - s * 0.62);
  g.lineTo(cx, cy + s * 0.9);
  g.stroke();
}

const EMBLEM_DRAWERS: Record<
  VcEmblem,
  (g: CanvasRenderingContext2D, cx: number, cy: number, s: number) => void
> = {
  wheat: drawWheat,
  heron: drawHeron,
  peak: drawPeak,
  swords: drawSwords,
  bell: drawBell,
  fist: drawFist,
  crescent: drawCrescent,
  pick: drawPick,
};

// ---------------------------------------------------------------------------
// The flag texture. 192x128 (3:2), cached per (nation, away); textures are
// shared module-level resources and are never disposed by view churn.
// ---------------------------------------------------------------------------

const FLAG_W = 192;
const FLAG_H = 128;
const flagCache = new Map<string, THREE.CanvasTexture>();

function paintFlag(pal: FlagPalette): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = FLAG_W;
  canvas.height = FLAG_H;
  const g = canvas.getContext('2d')!;

  // field with a soft vertical shade so the cloth never reads as a flat sticker
  g.fillStyle = css(pal.field);
  g.fillRect(0, 0, FLAG_W, FLAG_H);
  const shade = g.createLinearGradient(0, 0, 0, FLAG_H);
  shade.addColorStop(0, 'rgba(255,255,255,0.10)');
  shade.addColorStop(0.55, 'rgba(0,0,0,0)');
  shade.addColorStop(1, 'rgba(0,0,0,0.16)');
  g.fillStyle = shade;
  g.fillRect(0, 0, FLAG_W, FLAG_H);

  // accent border + a hoist band so the two nation colors both read at range
  const bw = Math.round(FLAG_W * 0.04);
  g.fillStyle = css(pal.accent);
  g.fillRect(0, 0, FLAG_W, bw);
  g.fillRect(0, FLAG_H - bw, FLAG_W, bw);
  g.fillRect(0, 0, bw, FLAG_H);
  g.fillRect(FLAG_W - bw, 0, bw, FLAG_H);
  g.fillRect(bw, 0, bw * 1.6, FLAG_H); // hoist band

  // emblem: dark drop shape behind, accent glyph in front
  const cx = FLAG_W * 0.56;
  const cy = FLAG_H * 0.5;
  const s = FLAG_H * 0.32;
  const draw = EMBLEM_DRAWERS[pal.emblem];
  g.fillStyle = css(pal.field, 0.55);
  g.strokeStyle = css(pal.field, 0.55);
  draw(g, cx + s * 0.08, cy + s * 0.1, s);
  g.fillStyle = css(pal.accent);
  g.strokeStyle = css(pal.accent);
  draw(g, cx, cy, s);
  return canvas;
}

/** The (cached) cloth texture for a nation flag; `away` inverts the palette. */
export function flagTexture(nationId: string, away = false): THREE.CanvasTexture {
  const key = `${nationId}|${away ? 'a' : 'h'}`;
  const cached = flagCache.get(key);
  if (cached) return cached;
  const tex = new THREE.CanvasTexture(paintFlag(flagPalette(nationId, away)));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  flagCache.set(key, tex);
  return tex;
}
