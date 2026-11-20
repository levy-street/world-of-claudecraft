// The raid atlas's crafted glyphs, drawn as vector paths at screen size (so
// they stay crisp at every zoom and every pixel density): the gilded player
// arrow, the boss medallions, the map pins and their six icons, the portal and
// entrance marks, the raid's class dots, the compass rose and the ornate
// frame with its cartouche plate. Each takes a context already scaled to CSS
// px and the resolved palette; no literal colour, no state.

import { pinColorRole, type RaidAtlasColors } from './raid_atlas_palette_core';
import type { RaidAtlasPinColor, RaidAtlasPinIcon } from './raid_atlas_pins_core';
import type { RaidAtlasPoiKind } from './raid_atlas_plan_core';
import type { RaidAtlasBossState } from './raid_atlas_view';

const TAU = Math.PI * 2;

/**
 * The player's arrow: a gilded arrowhead in the classic style, its wings swept
 * back in a soft curve to a deep notched tail, split down a central ridge into
 * a lit facet and a shaded one (so it reads as raised metal), an engraved
 * inner bevel, a fine gold rim on a dark keyline (it reads on any parchment)
 * and a warm halo under it. `angle` is the screen rotation (0 points up,
 * clockwise positive); `size` its length. Pure vector: crisp at every zoom.
 */
export function drawPlayerArrow(
  ctx: CanvasRenderingContext2D,
  c: RaidAtlasColors,
  x: number,
  y: number,
  angle: number,
  size: number,
): void {
  const L = size;
  const tipY = -L * 0.56;
  const wingX = L * 0.42;
  const wingY = L * 0.4;
  const notchY = L * 0.14;
  // The head's outline (scaled by `k` about its heart, for the inner bevel).
  const heartY = L * 0.02;
  const outline = (k: number): void => {
    const py = (v: number) => heartY + (v - heartY) * k;
    ctx.beginPath();
    ctx.moveTo(0, py(tipY));
    ctx.quadraticCurveTo(wingX * 0.34 * k, py(-L * 0.06), wingX * k, py(wingY));
    ctx.quadraticCurveTo(wingX * 0.45 * k, py(L * 0.2), 0, py(notchY));
    ctx.quadraticCurveTo(-wingX * 0.45 * k, py(L * 0.2), -wingX * k, py(wingY));
    ctx.quadraticCurveTo(-wingX * 0.34 * k, py(-L * 0.06), 0, py(tipY));
    ctx.closePath();
  };
  const half = (side: 1 | -1): void => {
    ctx.beginPath();
    ctx.moveTo(0, tipY);
    ctx.quadraticCurveTo(side * wingX * 0.34, -L * 0.06, side * wingX, wingY);
    ctx.quadraticCurveTo(side * wingX * 0.45, L * 0.2, 0, notchY);
    ctx.closePath();
  };
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.lineJoin = 'round';
  // The halo: warm light pooled round the head.
  ctx.globalAlpha = 0.85;
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = L * 0.6;
  outline(1.08);
  ctx.fillStyle = c.glow;
  ctx.fill();
  // The keyline, with a soft drop shadow toward the bottom of the page.
  ctx.globalAlpha = 1;
  ctx.shadowColor = c.frameDark;
  ctx.shadowBlur = L * 0.2;
  ctx.shadowOffsetY = L * 0.05;
  outline(1);
  ctx.lineWidth = Math.max(2.6, L * 0.15);
  ctx.strokeStyle = c.frameDark;
  ctx.stroke();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  // Lit facet (left of the ridge) and shaded facet (right).
  const lit = ctx.createLinearGradient(-wingX, wingY, L * 0.05, tipY);
  lit.addColorStop(0, c.gold);
  lit.addColorStop(0.5, c.goldLight);
  lit.addColorStop(1, c.goldWhite);
  half(-1);
  ctx.fillStyle = lit;
  ctx.fill();
  const shade = ctx.createLinearGradient(wingX, wingY, 0, tipY);
  shade.addColorStop(0, c.goldDeep);
  shade.addColorStop(0.55, c.gold);
  shade.addColorStop(1, c.goldLight);
  half(1);
  ctx.fillStyle = shade;
  ctx.fill();
  // The engraved inner bevel.
  outline(0.6);
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = Math.max(0.7, L * 0.03);
  ctx.strokeStyle = c.goldDeep;
  ctx.stroke();
  ctx.globalAlpha = 0.5;
  ctx.translate(-L * 0.012, -L * 0.012);
  ctx.strokeStyle = c.goldWhite;
  ctx.stroke();
  ctx.translate(L * 0.012, L * 0.012);
  // The ridge catching the light.
  ctx.beginPath();
  ctx.moveTo(0, tipY + L * 0.05);
  ctx.lineTo(0, notchY - L * 0.01);
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = Math.max(0.7, L * 0.03);
  ctx.strokeStyle = c.goldWhite;
  ctx.stroke();
  // The fine gold rim inside the keyline.
  outline(1);
  ctx.globalAlpha = 1;
  ctx.lineWidth = Math.max(0.9, L * 0.04);
  ctx.strokeStyle = c.goldDeep;
  ctx.stroke();
  // A glint near the tip.
  const glint = ctx.createRadialGradient(
    -L * 0.05,
    tipY + L * 0.2,
    0,
    -L * 0.05,
    tipY + L * 0.2,
    L * 0.1,
  );
  glint.addColorStop(0, c.goldWhite);
  glint.addColorStop(1, c.goldLight);
  ctx.beginPath();
  ctx.arc(-L * 0.05, tipY + L * 0.2, Math.max(0.8, L * 0.05), 0, TAU);
  ctx.fillStyle = glint;
  ctx.globalAlpha = 0.95;
  ctx.fill();
  ctx.restore();
}

/** A skull-and-horns crest (the boss sign), centred, `r` its half size. */
function crestPath(ctx: CanvasRenderingContext2D, r: number): void {
  // Horns.
  ctx.moveTo(-r * 0.55, -r * 0.2);
  ctx.quadraticCurveTo(-r * 0.95, -r * 0.55, -r * 0.78, -r * 0.98);
  ctx.quadraticCurveTo(-r * 0.62, -r * 0.6, -r * 0.3, -r * 0.48);
  ctx.closePath();
  ctx.moveTo(r * 0.55, -r * 0.2);
  ctx.quadraticCurveTo(r * 0.95, -r * 0.55, r * 0.78, -r * 0.98);
  ctx.quadraticCurveTo(r * 0.62, -r * 0.6, r * 0.3, -r * 0.48);
  ctx.closePath();
  // Skull dome and jaw.
  ctx.moveTo(-r * 0.56, r * 0.05);
  ctx.bezierCurveTo(-r * 0.62, -r * 0.62, r * 0.62, -r * 0.62, r * 0.56, r * 0.05);
  ctx.lineTo(r * 0.36, r * 0.32);
  ctx.lineTo(r * 0.3, r * 0.62);
  ctx.lineTo(-r * 0.3, r * 0.62);
  ctx.lineTo(-r * 0.36, r * 0.32);
  ctx.closePath();
}

/**
 * A boss medallion: a gilded ring round a crimson field with the crest. A
 * fighting boss burns brighter with a pulse ring; a defeated one is grey stone
 * with a struck-through crest.
 */
export function drawBossMedallion(
  ctx: CanvasRenderingContext2D,
  c: RaidAtlasColors,
  x: number,
  y: number,
  r: number,
  state: RaidAtlasBossState,
): void {
  const dead = state === 'dead';
  ctx.save();
  ctx.translate(x, y);
  ctx.shadowColor = c.frameDark;
  ctx.shadowBlur = r * 0.5;
  ctx.shadowOffsetY = r * 0.12;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  const ring = ctx.createLinearGradient(0, -r, 0, r);
  ring.addColorStop(0, dead ? c.parchmentLight : c.goldLight);
  ring.addColorStop(0.5, dead ? c.dead : c.gold);
  ring.addColorStop(1, dead ? c.frameMid : c.goldDeep);
  ctx.fillStyle = ring;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = Math.max(1, r * 0.1);
  ctx.strokeStyle = c.frameDark;
  ctx.stroke();
  // The field.
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.74, 0, TAU);
  const field = ctx.createRadialGradient(-r * 0.2, -r * 0.25, r * 0.05, 0, 0, r * 0.78);
  field.addColorStop(0, dead ? c.dead : state === 'engaged' ? c.bossEngaged : c.boss);
  field.addColorStop(1, dead ? c.frameMid : c.frameDark);
  ctx.fillStyle = field;
  ctx.fill();
  ctx.lineWidth = Math.max(0.8, r * 0.06);
  ctx.strokeStyle = dead ? c.frameMid : c.goldDeep;
  ctx.stroke();
  // The crest.
  ctx.beginPath();
  crestPath(ctx, r * 0.62);
  ctx.fillStyle = dead ? c.parchmentDark : c.goldLight;
  ctx.fill();
  // Eye sockets.
  ctx.beginPath();
  ctx.arc(-r * 0.15, -r * 0.02, r * 0.1, 0, TAU);
  ctx.arc(r * 0.15, -r * 0.02, r * 0.1, 0, TAU);
  ctx.fillStyle = dead ? c.frameMid : c.boss;
  ctx.fill();
  if (dead) {
    ctx.beginPath();
    ctx.moveTo(-r * 0.62, -r * 0.62);
    ctx.lineTo(r * 0.62, r * 0.62);
    ctx.moveTo(r * 0.62, -r * 0.62);
    ctx.lineTo(-r * 0.62, r * 0.62);
    ctx.strokeStyle = c.frameDark;
    ctx.lineWidth = Math.max(1.6, r * 0.16);
    ctx.lineCap = 'round';
    ctx.stroke();
    ctx.strokeStyle = c.bossEngaged;
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.stroke();
  }
  ctx.restore();
}

/** A pulse ring round a fighting boss (`phase` 0..1 from the frame clock). */
export function drawEngagedPulse(
  ctx: CanvasRenderingContext2D,
  c: RaidAtlasColors,
  x: number,
  y: number,
  r: number,
  phase: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r * (1.1 + phase * 0.7), 0, TAU);
  ctx.strokeStyle = c.bossEngaged;
  ctx.globalAlpha = 0.8 * (1 - phase);
  ctx.lineWidth = Math.max(1.2, r * 0.14);
  ctx.stroke();
  ctx.restore();
}

/** One pin icon, centred, white on the pin head (`r` its half size). */
export function pinIconPath(
  ctx: CanvasRenderingContext2D,
  icon: RaidAtlasPinIcon,
  r: number,
): void {
  switch (icon) {
    case 'star': {
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const rr = i % 2 === 0 ? r : r * 0.45;
        if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
        else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath();
      break;
    }
    case 'flag': {
      ctx.moveTo(-r * 0.62, r);
      ctx.lineTo(-r * 0.62, -r);
      ctx.lineTo(r * 0.8, -r * 0.55);
      ctx.lineTo(-r * 0.4, -r * 0.08);
      ctx.lineTo(-r * 0.4, r);
      ctx.closePath();
      break;
    }
    case 'skull': {
      ctx.moveTo(-r * 0.8, -r * 0.05);
      ctx.bezierCurveTo(-r * 0.9, -r * 1.05, r * 0.9, -r * 1.05, r * 0.8, -r * 0.05);
      ctx.lineTo(r * 0.5, r * 0.35);
      ctx.lineTo(r * 0.45, r * 0.85);
      ctx.lineTo(-r * 0.45, r * 0.85);
      ctx.lineTo(-r * 0.5, r * 0.35);
      ctx.closePath();
      break;
    }
    case 'swords': {
      const blade = (s: number): void => {
        ctx.moveTo(s * r * 0.95, -r * 0.95);
        ctx.lineTo(s * r * 0.7, -r * 0.95);
        ctx.lineTo(-s * r * 0.55, r * 0.35);
        ctx.lineTo(-s * r * 0.35, r * 0.55);
        ctx.closePath();
        ctx.moveTo(-s * r * 0.85, r * 0.3);
        ctx.lineTo(-s * r * 0.3, r * 0.85);
        ctx.lineTo(-s * r * 0.2, r * 0.75);
        ctx.lineTo(-s * r * 0.75, r * 0.2);
        ctx.closePath();
      };
      blade(1);
      blade(-1);
      break;
    }
    case 'shield': {
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.85, -r * 0.62);
      ctx.quadraticCurveTo(r * 0.8, r * 0.55, 0, r);
      ctx.quadraticCurveTo(-r * 0.8, r * 0.55, -r * 0.85, -r * 0.62);
      ctx.closePath();
      break;
    }
    default: {
      ctx.moveTo(0, -r);
      ctx.lineTo(r * 0.75, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r * 0.75, 0);
      ctx.closePath();
      break;
    }
  }
}

/** Extra marks an icon carries (the skull's eyes), drawn in the pin's colour. */
function pinIconDetail(ctx: CanvasRenderingContext2D, icon: RaidAtlasPinIcon, r: number): void {
  if (icon !== 'skull') return;
  ctx.beginPath();
  ctx.arc(-r * 0.32, -r * 0.18, r * 0.2, 0, TAU);
  ctx.arc(r * 0.32, -r * 0.18, r * 0.2, 0, TAU);
  ctx.fill();
}

/**
 * A map pin standing on its point (x, y): a coloured teardrop head with a
 * gilded rim and its icon, a needle, and a soft shadow on the parchment.
 * `selected` lifts it with a bright ring.
 */
export function drawPin(
  ctx: CanvasRenderingContext2D,
  c: RaidAtlasColors,
  x: number,
  y: number,
  size: number,
  icon: RaidAtlasPinIcon,
  color: RaidAtlasPinColor,
  selected: boolean,
): void {
  const head = size * 0.5;
  const hy = y - size * 1.05;
  const fill = c[pinColorRole(color)];
  ctx.save();
  // Ground shadow.
  ctx.beginPath();
  ctx.ellipse(x + size * 0.12, y, size * 0.32, size * 0.12, 0, 0, TAU);
  ctx.fillStyle = c.frameDark;
  ctx.globalAlpha = 0.35;
  ctx.fill();
  ctx.globalAlpha = 1;
  // The teardrop.
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(
    x - head * 0.35,
    hy + head * 0.9,
    x - head * 1.05,
    hy + head * 0.55,
    x - head,
    hy,
  );
  ctx.arc(x, hy, head, Math.PI, 0);
  ctx.bezierCurveTo(x + head * 1.05, hy + head * 0.55, x + head * 0.35, hy + head * 0.9, x, y);
  ctx.closePath();
  ctx.shadowColor = c.frameDark;
  ctx.shadowBlur = size * 0.25;
  ctx.shadowOffsetY = size * 0.06;
  const g = ctx.createRadialGradient(
    x - head * 0.35,
    hy - head * 0.4,
    head * 0.1,
    x,
    hy,
    head * 1.4,
  );
  g.addColorStop(0, c.goldWhite);
  g.addColorStop(0.25, fill);
  g.addColorStop(1, fill);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = Math.max(1.2, size * 0.08);
  ctx.strokeStyle = c.frameDark;
  ctx.stroke();
  ctx.lineWidth = Math.max(0.7, size * 0.035);
  ctx.strokeStyle = c.goldLight;
  ctx.globalAlpha = 0.85;
  ctx.stroke();
  ctx.globalAlpha = 1;
  // The icon on its head.
  ctx.save();
  ctx.translate(x, hy);
  ctx.beginPath();
  pinIconPath(ctx, icon, head * 0.58);
  ctx.fillStyle = color === 'white' ? c.frameDark : c.goldWhite;
  ctx.fill();
  ctx.lineWidth = Math.max(0.6, size * 0.03);
  ctx.strokeStyle = c.frameDark;
  ctx.globalAlpha = 0.6;
  ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = fill;
  pinIconDetail(ctx, icon, head * 0.58);
  ctx.restore();
  if (selected) {
    ctx.beginPath();
    ctx.arc(x, hy, head * 1.45, 0, TAU);
    ctx.strokeStyle = c.goldWhite;
    ctx.lineWidth = Math.max(1.5, size * 0.09);
    ctx.globalAlpha = 0.95;
    ctx.stroke();
  }
  ctx.restore();
}

/** A portal, the entrance or an exit: a gilded ring round a swirl or a door. */
export function drawPoi(
  ctx: CanvasRenderingContext2D,
  c: RaidAtlasColors,
  kind: RaidAtlasPoiKind,
  x: number,
  y: number,
  r: number,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  ctx.fillStyle = c.frameDark;
  ctx.shadowColor = c.frameDark;
  ctx.shadowBlur = r * 0.5;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(1.2, r * 0.18);
  ctx.strokeStyle = c.gold;
  ctx.stroke();
  if (kind === 'entrance') {
    // An arched door.
    ctx.beginPath();
    ctx.moveTo(-r * 0.42, r * 0.5);
    ctx.lineTo(-r * 0.42, -r * 0.05);
    ctx.arc(0, -r * 0.05, r * 0.42, Math.PI, 0);
    ctx.lineTo(r * 0.42, r * 0.5);
    ctx.closePath();
    ctx.fillStyle = c.goldLight;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, r * 0.5);
    ctx.lineTo(0, -r * 0.3);
    ctx.strokeStyle = c.frameDark;
    ctx.lineWidth = Math.max(0.8, r * 0.1);
    ctx.stroke();
  } else {
    // A swirl.
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 0.8);
    g.addColorStop(0, c.goldWhite);
    g.addColorStop(1, kind === 'exit' ? c.veinBreath : c.portal);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.72, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const a = (i / 40) * Math.PI * 3.2;
      const rr = (i / 40) * r * 0.62;
      if (i === 0) ctx.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    ctx.strokeStyle = c.frameDark;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = Math.max(0.8, r * 0.1);
    ctx.stroke();
  }
  ctx.restore();
}

/** A raid member: a class-coloured jewel with a dark keyline (dead: a grey
 *  jewel with a cross). */
export function drawMember(
  ctx: CanvasRenderingContext2D,
  c: RaidAtlasColors,
  x: number,
  y: number,
  r: number,
  classColor: string,
  dead: boolean,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = dead ? c.dead : classColor;
  ctx.shadowColor = c.frameDark;
  ctx.shadowBlur = r * 0.6;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = Math.max(1.2, r * 0.32);
  ctx.strokeStyle = c.frameDark;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x - r * 0.3, y - r * 0.3, r * 0.35, 0, TAU);
  ctx.fillStyle = c.goldWhite;
  ctx.globalAlpha = dead ? 0.25 : 0.6;
  ctx.fill();
  if (dead) {
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.moveTo(x - r * 0.55, y - r * 0.55);
    ctx.lineTo(x + r * 0.55, y + r * 0.55);
    ctx.moveTo(x + r * 0.55, y - r * 0.55);
    ctx.lineTo(x - r * 0.55, y + r * 0.55);
    ctx.strokeStyle = c.frameDark;
    ctx.lineWidth = Math.max(1, r * 0.28);
    ctx.stroke();
  }
  ctx.restore();
}

/** The compass rose: an eight-point star in gold and ink, `r` its reach.
 *  Only north is lettered (the caller passes the localized letter). */
export function drawCompassRose(
  ctx: CanvasRenderingContext2D,
  c: RaidAtlasColors,
  x: number,
  y: number,
  r: number,
  north: string,
  font: string,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.62, 0, TAU);
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = Math.max(0.8, r * 0.03);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.54, 0, TAU);
  ctx.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    const major = i % 2 === 0;
    const reach = major ? r : r * 0.6;
    const half = major ? r * 0.15 : r * 0.1;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.sin(a) * reach, -Math.cos(a) * reach);
      ctx.lineTo(
        Math.sin(a + (side * Math.PI) / 2) * half,
        -Math.cos(a + (side * Math.PI) / 2) * half,
      );
      ctx.closePath();
      ctx.fillStyle =
        side < 0 ? (major ? c.goldLight : c.parchmentLight) : major ? c.goldDeep : c.inkSoft;
      ctx.fill();
      ctx.lineWidth = Math.max(0.6, r * 0.02);
      ctx.strokeStyle = c.ink;
      ctx.stroke();
    }
  }
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.08, 0, TAU);
  ctx.fillStyle = c.gold;
  ctx.fill();
  ctx.stroke();
  ctx.font = font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.lineWidth = 3;
  ctx.strokeStyle = c.parchmentLight;
  ctx.strokeText(north, 0, -r * 1.02);
  ctx.fillStyle = c.ink;
  ctx.fillText(north, 0, -r * 1.02);
  ctx.restore();
}

/** One corner flourish of the frame (drawn at the top-left, rotated per corner). */
function cornerFlourish(ctx: CanvasRenderingContext2D, c: RaidAtlasColors, s: number): void {
  // A gilded quarter-rosette with a diamond stud.
  ctx.beginPath();
  ctx.moveTo(0, s * 1.6);
  ctx.quadraticCurveTo(0, 0, s * 1.6, 0);
  ctx.lineTo(s * 1.15, s * 0.3);
  ctx.quadraticCurveTo(s * 0.3, s * 0.3, s * 0.3, s * 1.15);
  ctx.closePath();
  const g = ctx.createLinearGradient(0, 0, s * 1.6, s * 1.6);
  g.addColorStop(0, c.goldWhite);
  g.addColorStop(0.5, c.gold);
  g.addColorStop(1, c.goldDeep);
  ctx.fillStyle = g;
  ctx.fill();
  ctx.lineWidth = 1;
  ctx.strokeStyle = c.frameDark;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(s * 0.62, s * 0.18);
  ctx.lineTo(s * 1.0, s * 0.62);
  ctx.lineTo(s * 0.62, s * 1.0);
  ctx.lineTo(s * 0.18, s * 0.62);
  ctx.closePath();
  ctx.fillStyle = c.boss;
  ctx.fill();
  ctx.strokeStyle = c.goldLight;
  ctx.stroke();
}

/** Burnt edges: the page darkens and browns toward the frame. Multiplies
 *  over an OPAQUE page (the page layer), so it tints rather than veils. */
export function drawBurntEdges(
  ctx: CanvasRenderingContext2D,
  c: RaidAtlasColors,
  side: number,
): void {
  ctx.save();
  const v = ctx.createRadialGradient(
    side / 2,
    side / 2,
    side * 0.3,
    side / 2,
    side / 2,
    side * 0.75,
  );
  v.addColorStop(0, c.parchmentLight);
  v.addColorStop(0.6, c.parchment);
  v.addColorStop(1, c.stain);
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, side, side);
  ctx.restore();
}

/**
 * The page's frame (screen space, `side` CSS px): a dark carved band, a double gilded fillet and four corner
 * flourishes. `band` is the dark band's width.
 */
export function drawFrame(
  ctx: CanvasRenderingContext2D,
  c: RaidAtlasColors,
  side: number,
  band: number,
): void {
  ctx.save();
  // Inner shadow under the band.
  ctx.shadowColor = c.frameDark;
  ctx.shadowBlur = band * 1.4;
  ctx.lineWidth = band;
  ctx.strokeStyle = c.frameDark;
  ctx.strokeRect(band / 2, band / 2, side - band, side - band);
  ctx.shadowBlur = 0;
  // The carved band.
  const g = ctx.createLinearGradient(0, 0, side, side);
  g.addColorStop(0, c.frameMid);
  g.addColorStop(0.5, c.frameDark);
  g.addColorStop(1, c.frameMid);
  ctx.strokeStyle = g;
  ctx.strokeRect(band / 2, band / 2, side - band, side - band);
  // The double gilded fillet.
  const fil = Math.max(1.2, band * 0.16);
  ctx.lineWidth = fil;
  ctx.strokeStyle = c.gold;
  ctx.strokeRect(fil / 2 + 0.5, fil / 2 + 0.5, side - fil - 1, side - fil - 1);
  ctx.strokeStyle = c.goldLight;
  ctx.strokeRect(band - fil / 2, band - fil / 2, side - band * 2 + fil, side - band * 2 + fil);
  ctx.lineWidth = Math.max(0.6, fil * 0.45);
  ctx.strokeStyle = c.goldDeep;
  ctx.strokeRect(band + fil, band + fil, side - (band + fil) * 2, side - (band + fil) * 2);
  // Corners.
  const s = band * 1.25;
  for (let k = 0; k < 4; k++) {
    ctx.save();
    ctx.translate(k === 1 || k === 2 ? side : 0, k >= 2 ? side : 0);
    ctx.rotate((k * Math.PI) / 2);
    ctx.translate(band * 0.15, band * 0.15);
    cornerFlourish(ctx, c, s);
    ctx.restore();
  }
  ctx.restore();
}

/**
 * The title cartouche: a gilded scroll plate at the top centre with the raid's
 * name and a second line (the floor and the progress). Returns its bottom y.
 */
export function drawCartouche(
  ctx: CanvasRenderingContext2D,
  c: RaidAtlasColors,
  side: number,
  top: number,
  title: string,
  subtitle: string,
  titleFont: string,
  subFont: string,
): number {
  ctx.save();
  ctx.font = titleFont;
  const tw = ctx.measureText(title).width;
  ctx.font = subFont;
  const sw = ctx.measureText(subtitle).width;
  const titlePx = Number.parseFloat(/([0-9.]+)px/.exec(titleFont)?.[1] ?? '16') || 16;
  const w = Math.min(side * 0.82, Math.max(tw, sw) + titlePx * 3.2);
  const h = titlePx * 2.55;
  const x = (side - w) / 2;
  const y = top;
  const curl = h * 0.32;
  // Scroll body with curled ends.
  ctx.beginPath();
  ctx.moveTo(x + curl, y);
  ctx.lineTo(x + w - curl, y);
  ctx.quadraticCurveTo(x + w, y + h * 0.5, x + w - curl, y + h);
  ctx.lineTo(x + curl, y + h);
  ctx.quadraticCurveTo(x, y + h * 0.5, x + curl, y);
  ctx.closePath();
  ctx.shadowColor = c.frameDark;
  ctx.shadowBlur = h * 0.4;
  ctx.shadowOffsetY = h * 0.08;
  const body = ctx.createLinearGradient(0, y, 0, y + h);
  body.addColorStop(0, c.frameMid);
  body.addColorStop(1, c.frameDark);
  ctx.fillStyle = body;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = Math.max(1.4, h * 0.05);
  ctx.strokeStyle = c.gold;
  ctx.stroke();
  ctx.lineWidth = Math.max(0.6, h * 0.02);
  ctx.strokeStyle = c.goldLight;
  ctx.beginPath();
  ctx.moveTo(x + curl + 4, y + 4);
  ctx.lineTo(x + w - curl - 4, y + 4);
  ctx.moveTo(x + curl + 4, y + h - 4);
  ctx.lineTo(x + w - curl - 4, y + h - 4);
  ctx.stroke();
  // Studs at each end.
  for (const sx of [x + curl * 0.95, x + w - curl * 0.95]) {
    ctx.beginPath();
    ctx.arc(sx, y + h / 2, h * 0.09, 0, TAU);
    ctx.fillStyle = c.goldLight;
    ctx.fill();
    ctx.strokeStyle = c.frameDark;
    ctx.stroke();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = titleFont;
  const tg = ctx.createLinearGradient(0, y + h * 0.15, 0, y + h * 0.55);
  tg.addColorStop(0, c.goldWhite);
  tg.addColorStop(1, c.gold);
  ctx.fillStyle = tg;
  ctx.fillText(title, side / 2, y + h * 0.52);
  ctx.font = subFont;
  ctx.fillStyle = c.parchment;
  ctx.globalAlpha = 0.92;
  ctx.fillText(subtitle, side / 2, y + h * 0.84);
  ctx.restore();
  return y + h;
}
