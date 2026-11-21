// The raid atlas's landmarks, inked: every dressing piece of the field as its
// own glyph (raid_atlas_detail_core.ts RaidAtlasGlyph, by kind): columns,
// colossi, cut blocks, the derrick, crystals, statues, standing stones,
// cairns, wind shelters, braziers, vents, sunk blades, ice shelves, the
// wellspring, the Hearth's mouth, the altar-stone, fire seams, the cave mouth
// and the first flame's pool. Painted into the plate or a settled view only,
// never per frame; the palette comes in.

import {
  type RaidAtlasFloorDetail,
  type RaidAtlasGlyph,
  raidAtlasDrawsTier,
} from './raid_atlas_detail_core';
import {
  axes,
  boxPath,
  circle,
  fillStroke,
  local,
  type Pt,
  pen,
  polyline,
  shadowOffset,
  shadowPath,
} from './raid_atlas_ink';
import type { RaidAtlasPageTransform } from './raid_atlas_page_painter';
import { atlasHash01, type RaidAtlasColors } from './raid_atlas_palette_core';

type Ctx = CanvasRenderingContext2D;

/** A glyph smaller than this many device px across is left off (a speck). */
const MIN_GLYPH_PX = 3;

function drawColumn(
  ctx: Ctx,
  g: RaidAtlasGlyph,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  shadowPath(ctx, c, g.r * 2, () => circle(ctx, g.x, g.z, g.r));
  ctx.beginPath();
  circle(ctx, g.x, g.z, g.r);
  fillStroke(ctx, c.rock, 1, c.ink, pen(t, 1.6));
  ctx.beginPath();
  circle(ctx, g.x, g.z, g.r * 0.68);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = pen(t, 0.9);
  ctx.stroke();
  ctx.beginPath();
  circle(ctx, g.x + g.r * 0.22, g.z + g.r * 0.22, g.r * 0.34);
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = c.parchmentLight;
  ctx.fill();
}

function drawColossus(
  ctx: Ctx,
  g: RaidAtlasGlyph,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  // A kneeling giant seen from above, bowed toward the pit (its yaw): broad
  // shoulders, two arms reaching down to its knees, the bowed head.
  const r = g.r;
  const arms: readonly (readonly [Pt, Pt])[] = [
    [local(g, -0.72 * r, -0.12 * r), local(g, -0.46 * r, 0.62 * r)],
    [local(g, 0.72 * r, -0.12 * r), local(g, 0.46 * r, 0.62 * r)],
  ];
  const shoulders: readonly [Pt, Pt] = [
    local(g, -0.72 * r, -0.12 * r),
    local(g, 0.72 * r, -0.12 * r),
  ];
  const [ox, oz] = shadowOffset(r * 0.8);
  ctx.lineCap = 'round';
  // Arms first, then the broader shoulders over them; each a shadow pass, an
  // ink pass and the stone inside it.
  for (const [segs, w] of [
    [arms, 0.3 * r],
    [[shoulders], 0.55 * r],
  ] as const) {
    for (const pass of ['shadow', 'ink', 'stone'] as const) {
      const dx = pass === 'shadow' ? ox : 0;
      const dz = pass === 'shadow' ? oz : 0;
      ctx.beginPath();
      for (const [p0, p1] of segs) {
        ctx.moveTo(p0[0] + dx, p0[1] + dz);
        ctx.lineTo(p1[0] + dx, p1[1] + dz);
      }
      ctx.lineWidth = pass === 'ink' ? w + pen(t, 2.6) : w;
      ctx.strokeStyle = pass === 'shadow' ? c.abyss : pass === 'ink' ? c.ink : c.rock;
      ctx.globalAlpha = pass === 'shadow' ? 0.28 : 1;
      ctx.stroke();
    }
  }
  // Chisel hatching across the back.
  ctx.beginPath();
  for (let i = -3; i <= 3; i++) {
    const a = local(g, i * 0.2 * r, -0.32 * r);
    const b = local(g, i * 0.2 * r + 0.08 * r, 0.06 * r);
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  }
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = pen(t, 0.9);
  ctx.stroke();
  // The bowed head before the shoulders.
  ctx.beginPath();
  const [hx, hz] = local(g, 0, 0.22 * r);
  circle(ctx, hx, hz, 0.27 * r);
  fillStroke(ctx, c.rock, 1, c.ink, pen(t, 1.5));
  ctx.beginPath();
  circle(ctx, hx + 0.07 * r, hz + 0.07 * r, 0.11 * r);
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = c.parchmentLight;
  ctx.fill();
}

function drawBlock(
  ctx: Ctx,
  g: RaidAtlasGlyph,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
  ember: boolean,
): void {
  const hw = g.hw || g.r;
  const hd = g.hd || g.r;
  shadowPath(ctx, c, Math.max(hw, hd) * 1.6, () => boxPath(ctx, g, hw, hd));
  ctx.beginPath();
  boxPath(ctx, g, hw, hd);
  fillStroke(ctx, ember ? c.abyss : c.rock, ember ? 0.85 : 1, c.ink, pen(t, 1.4));
  if (ember) {
    ctx.fillStyle = c[g.tone];
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    for (let i = 0; i < 9; i++) {
      const [x, z] = local(
        g,
        (atlasHash01(i, Math.round(g.x)) - 0.5) * hw * 1.5,
        (atlasHash01(i, Math.round(g.z)) - 0.5) * hd * 1.5,
      );
      circle(ctx, x, z, 0.25 + atlasHash01(i, 7) * 0.35);
    }
    ctx.fill();
    return;
  }
  // A chisel line across the cut face.
  ctx.beginPath();
  const a = local(g, -hw * 0.6, -hd * 0.2);
  const b = local(g, hw * 0.5, hd * 0.45);
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = pen(t, 0.9);
  ctx.stroke();
}

function drawDerrick(
  ctx: Ctx,
  g: RaidAtlasGlyph,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  const r = g.r;
  const apex = local(g, 0, r * 1.2);
  ctx.beginPath();
  for (const side of [-1, 1]) {
    const foot = local(g, side * r, -r * 0.6);
    ctx.moveTo(foot[0], foot[1]);
    ctx.lineTo(apex[0], apex[1]);
  }
  const boomEnd = local(g, r * 1.6, r * 2.6);
  ctx.moveTo(apex[0], apex[1]);
  ctx.lineTo(boomEnd[0], boomEnd[1]);
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = pen(t, 1.5);
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.beginPath();
  circle(ctx, boomEnd[0], boomEnd[1], r * 0.18);
  ctx.fillStyle = c.ink;
  ctx.fill();
}

function drawCrystal(
  ctx: Ctx,
  g: RaidAtlasGlyph,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  // A druse: long faceted prisms fanning out of one bed, each with its ridge.
  const r = g.r;
  const seed = Math.round(g.x * 3 + g.z * 7);
  ctx.beginPath();
  circle(ctx, g.x, g.z, r * 0.55);
  ctx.globalAlpha = 0.75;
  ctx.fillStyle = c.abyss;
  ctx.fill();
  const shards = 5;
  const ridges: [Pt, Pt][] = [];
  ctx.beginPath();
  for (let i = 0; i < shards; i++) {
    const a = (i / shards) * Math.PI * 2 + atlasHash01(i, seed) * 0.7;
    const len = r * (0.75 + atlasHash01(i, seed + 1) * 0.45);
    const w = r * 0.27;
    const ux = Math.sin(a);
    const uz = Math.cos(a);
    const base: Pt = [g.x + ux * r * 0.12, g.z + uz * r * 0.12];
    const tip: Pt = [g.x + ux * len, g.z + uz * len];
    const sh: Pt = [g.x + ux * len * 0.72, g.z + uz * len * 0.72];
    polyline(
      ctx,
      [
        [base[0] - uz * w * 0.6, base[1] + ux * w * 0.6],
        [sh[0] - uz * w, sh[1] + ux * w],
        tip,
        [sh[0] + uz * w, sh[1] - ux * w],
        [base[0] + uz * w * 0.6, base[1] - ux * w * 0.6],
      ],
      true,
    );
    ridges.push([base, tip]);
  }
  fillStroke(ctx, c[g.tone], 0.92, c.ink, pen(t, 1.1));
  ctx.beginPath();
  for (const [a, b] of ridges) {
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  }
  ctx.globalAlpha = 0.65;
  ctx.strokeStyle = c.goldWhite;
  ctx.lineWidth = pen(t, 0.9);
  ctx.stroke();
}

function drawStatue(
  ctx: Ctx,
  g: RaidAtlasGlyph,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  const r = g.r;
  shadowPath(ctx, c, r * 1.6, () => boxPath(ctx, g, r, r));
  ctx.beginPath();
  boxPath(ctx, g, r, r);
  fillStroke(ctx, c.rock, 0.9, c.ink, pen(t, 1.4));
  // The rough figure on its plinth: shoulders and a head.
  ctx.beginPath();
  const pts: Pt[] = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    pts.push(local(g, Math.cos(a) * r * 0.7, Math.sin(a) * r * 0.42));
  }
  polyline(ctx, pts, true);
  const [hx, hz] = local(g, 0, r * 0.12);
  circle(ctx, hx, hz, r * 0.3);
  fillStroke(ctx, c.rock, 1, c.ink, pen(t, 1.1));
}

function drawStandingStone(
  ctx: Ctx,
  g: RaidAtlasGlyph,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  const r = Math.max(g.r, 1);
  const stone = () => {
    const pts: Pt[] = [];
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const j = 0.78 + atlasHash01(i, Math.round(g.x * 7 + g.z)) * 0.32;
      pts.push([g.x + Math.sin(a) * r * j, g.z + Math.cos(a) * r * j]);
    }
    polyline(ctx, pts, true);
  };
  shadowPath(ctx, c, r * 2.2, stone);
  ctx.beginPath();
  stone();
  fillStroke(ctx, c.rock, 1, c.ink, pen(t, 1.4));
  ctx.beginPath();
  circle(ctx, g.x + r * 0.15, g.z + r * 0.15, r * 0.42);
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = c[g.tone];
  ctx.fill();
}

function drawCairn(
  ctx: Ctx,
  g: RaidAtlasGlyph,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  const r = g.r;
  ctx.beginPath();
  for (const [s, a] of [
    [-0.45, -0.2],
    [0.42, -0.25],
    [0, 0.4],
  ] as const) {
    const [x, z] = local(g, s * r, a * r);
    circle(ctx, x, z, r * 0.42);
  }
  fillStroke(ctx, c.rock, 1, c.ink, pen(t, 1.1));
}

function drawShelter(
  ctx: Ctx,
  g: RaidAtlasGlyph,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  ctx.beginPath();
  boxPath(ctx, g, g.hw, g.hd);
  fillStroke(ctx, c.rock, 1, c.ink, pen(t, 1.4));
  // Masonry courses along the low wall.
  ctx.beginPath();
  const n = 3;
  for (let i = 1; i < n; i++) {
    const s = -g.hw + (2 * g.hw * i) / n;
    const a = local(g, s, -g.hd);
    const b = local(g, s, g.hd);
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
  }
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = pen(t, 0.9);
  ctx.stroke();
}

function flame(ctx: Ctx, x: number, z: number, s: number): void {
  // A teardrop pointing up the page (+z).
  ctx.moveTo(x, z + s);
  ctx.quadraticCurveTo(x + s * 0.75, z - s * 0.1, x, z - s * 0.55);
  ctx.quadraticCurveTo(x - s * 0.75, z - s * 0.1, x, z + s);
}

function drawBrazier(
  ctx: Ctx,
  g: RaidAtlasGlyph,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  const r = g.r;
  ctx.beginPath();
  circle(ctx, g.x, g.z, r);
  fillStroke(ctx, c.abyss, 0.85, c.ink, pen(t, 1.4));
  ctx.beginPath();
  flame(ctx, g.x, g.z, r * 0.85);
  ctx.globalAlpha = 1;
  ctx.fillStyle = c[g.tone];
  ctx.fill();
  ctx.beginPath();
  flame(ctx, g.x, g.z - r * 0.1, r * 0.42);
  ctx.fillStyle = c.goldWhite;
  ctx.fill();
}

function drawVent(
  ctx: Ctx,
  g: RaidAtlasGlyph,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  const r = g.r;
  ctx.beginPath();
  circle(ctx, g.x, g.z, r * 0.45);
  fillStroke(ctx, c.abyss, 0.6, c.ink, pen(t, 1));
  // Steam curling up the page.
  ctx.beginPath();
  for (const s of [-0.35, 0.35]) {
    const x = g.x + s * r;
    ctx.moveTo(x, g.z + r * 0.4);
    ctx.bezierCurveTo(x + r * 0.5, g.z + r * 0.9, x - r * 0.5, g.z + r * 1.4, x, g.z + r * 2);
  }
  ctx.globalAlpha = 0.7;
  ctx.strokeStyle = c[g.tone];
  ctx.lineWidth = pen(t, 1.1);
  ctx.lineCap = 'round';
  ctx.stroke();
}

function drawBlade(
  ctx: Ctx,
  g: RaidAtlasGlyph,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  // A great sword sunk point first: hilt at the glyph's spot, the blade laid
  // along its yaw, a crossguard across.
  const len = g.r * 3.6;
  const w = g.r * 0.42;
  const blade = () => {
    polyline(
      ctx,
      [
        local(g, -w, 0),
        local(g, w, 0),
        local(g, w * 0.55, len * 0.82),
        local(g, 0, len),
        local(g, -w * 0.55, len * 0.82),
      ],
      true,
    );
  };
  shadowPath(ctx, c, g.r * 1.6, blade);
  ctx.beginPath();
  blade();
  fillStroke(ctx, c.parchmentLight, 1, c.ink, pen(t, 1.3));
  ctx.beginPath();
  blade();
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = c[g.tone];
  ctx.fill();
  ctx.beginPath();
  const m0 = local(g, 0, len * 0.06);
  const m1 = local(g, 0, len * 0.86);
  ctx.moveTo(m0[0], m0[1]);
  ctx.lineTo(m1[0], m1[1]);
  const q0 = local(g, -w * 2.3, 0);
  const q1 = local(g, w * 2.3, 0);
  ctx.moveTo(q0[0], q0[1]);
  ctx.lineTo(q1[0], q1[1]);
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = pen(t, 1.4);
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.beginPath();
  const [px, pz] = local(g, 0, -w * 1.6);
  circle(ctx, px, pz, w * 0.7);
  fillStroke(ctx, c.gold, 1, c.ink, pen(t, 1));
}

function drawIceShelf(
  ctx: Ctx,
  g: RaidAtlasGlyph,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  // Old ice heaped past the rim: three tilted slabs, each with its crack.
  const r = g.r;
  const slabs: readonly (readonly [number, number, number])[] = [
    [-0.45, -0.1, 0.62],
    [0.4, -0.25, 0.55],
    [0, 0.42, 0.5],
  ];
  for (const [ox, oz, s] of slabs) {
    const cx = local(g, ox * r, oz * r);
    const piece = { x: cx[0], z: cx[1], rot: g.rot + ox * 1.4 };
    const slab = () => {
      polyline(
        ctx,
        [
          local(piece, -r * s, -r * s * 0.3),
          local(piece, r * s * 0.6, -r * s * 0.5),
          local(piece, r * s, r * s * 0.35),
          local(piece, -r * s * 0.25, r * s * 0.55),
        ],
        true,
      );
    };
    shadowPath(ctx, c, r * s, slab);
    ctx.beginPath();
    slab();
    fillStroke(ctx, c.parchmentLight, 1, c.ink, pen(t, 1.2));
    ctx.beginPath();
    slab();
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = c[g.tone];
    ctx.fill();
    ctx.beginPath();
    const a = local(piece, -r * s * 0.5, -r * s * 0.05);
    const b = local(piece, r * s * 0.55, r * s * 0.1);
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.globalAlpha = 0.6;
    ctx.strokeStyle = c.ink;
    ctx.lineWidth = pen(t, 0.9);
    ctx.stroke();
  }
}

function drawWellspring(
  ctx: Ctx,
  g: RaidAtlasGlyph,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  const r = g.r;
  shadowPath(ctx, c, r * 1.4, () => circle(ctx, g.x, g.z, r));
  ctx.beginPath();
  circle(ctx, g.x, g.z, r);
  fillStroke(ctx, c.rock, 1, c.ink, pen(t, 1.6));
  ctx.beginPath();
  circle(ctx, g.x, g.z, r * 0.62);
  const glow = ctx.createRadialGradient(g.x, g.z, 0, g.x, g.z, r * 0.62);
  glow.addColorStop(0, c.goldWhite);
  glow.addColorStop(0.5, c.heartGlow);
  glow.addColorStop(1, c[g.tone]);
  ctx.globalAlpha = 1;
  ctx.fillStyle = glow;
  ctx.fill();
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = pen(t, 1);
  ctx.stroke();
}

function drawHearthMouth(
  ctx: Ctx,
  g: RaidAtlasGlyph,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  // The Hearth's mouth in the wall: a half-round of fire opening toward the
  // arena (its yaw), the glow spilling out over the rock.
  const r = g.r * 0.62;
  const a0 = Math.atan2(axes(g.rot).rz, axes(g.rot).rx);
  const glow = ctx.createRadialGradient(g.x, g.z, 0, g.x, g.z, r * 1.6);
  glow.addColorStop(0, c.goldWhite);
  glow.addColorStop(0.35, c.heartGlow);
  glow.addColorStop(0.7, c[g.tone]);
  glow.addColorStop(1, c.parchment);
  ctx.beginPath();
  ctx.arc(g.x, g.z, r * 1.6, 0, Math.PI * 2);
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = glow;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(g.x + Math.cos(a0) * r, g.z + Math.sin(a0) * r);
  ctx.arc(g.x, g.z, r, a0, a0 + Math.PI, true);
  ctx.closePath();
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = glow;
  ctx.fill();
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = pen(t, 2);
  ctx.stroke();
  // The arch's voussoirs.
  ctx.beginPath();
  for (let i = 1; i < 9; i++) {
    const a = a0 - (Math.PI * i) / 9;
    ctx.moveTo(g.x + Math.cos(a) * r, g.z + Math.sin(a) * r);
    ctx.lineTo(g.x + Math.cos(a) * r * 1.22, g.z + Math.sin(a) * r * 1.22);
  }
  ctx.arc(g.x, g.z, r * 1.22, a0, a0 + Math.PI, true);
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = pen(t, 1.2);
  ctx.stroke();
}

function drawAnvil(
  ctx: Ctx,
  g: RaidAtlasGlyph,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  // The altar-stone that was the giant anvil, from above: a broad face, the
  // horn tapering away to one end, the heel squared at the other.
  const hw = g.hw;
  const hd = g.hd;
  const shape = () => {
    polyline(
      ctx,
      [
        local(g, -hw, -hd),
        local(g, hw, -hd),
        local(g, hw, -hd * 0.62),
        local(g, hw * 0.62, -hd * 0.5),
        local(g, hw * 0.62, hd * 0.12),
        local(g, hw, hd * 0.25),
        local(g, hw * 0.35, hd * 0.75),
        local(g, 0, hd),
        local(g, -hw * 0.35, hd * 0.75),
        local(g, -hw, hd * 0.25),
        local(g, -hw * 0.62, hd * 0.12),
        local(g, -hw * 0.62, -hd * 0.5),
        local(g, -hw, -hd * 0.62),
      ],
      true,
    );
  };
  shadowPath(ctx, c, Math.max(hw, hd), shape);
  ctx.beginPath();
  shape();
  fillStroke(ctx, c.abyss, 0.92, c.ink, pen(t, 1.8));
  // The struck face, lit, and the crystal crown at its north (+z) end.
  ctx.beginPath();
  boxPath(ctx, g, hw * 0.42, hd * 0.32);
  ctx.globalAlpha = 0.45;
  ctx.fillStyle = c.goldLight;
  ctx.fill();
  ctx.beginPath();
  const [cx, cz] = local(g, 0, hd * 0.55);
  circle(ctx, cx, cz, hw * 0.34);
  ctx.globalAlpha = 1;
  ctx.fillStyle = c.heartGlow;
  ctx.fill();
}

function drawFireSeam(
  ctx: Ctx,
  g: RaidAtlasGlyph,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  const len = g.r;
  const pts: Pt[] = [];
  const n = 7;
  for (let i = 0; i <= n; i++) {
    const f = i / n - 0.5;
    const j = (atlasHash01(i, Math.round(g.z)) - 0.5) * 1.4;
    pts.push(local(g, j, f * len * 2));
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  polyline(ctx, pts, false);
  ctx.strokeStyle = c.ink;
  ctx.globalAlpha = 0.8;
  ctx.lineWidth = 1.6 + pen(t, 1.6);
  ctx.stroke();
  ctx.strokeStyle = c[g.tone];
  ctx.globalAlpha = 1;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  ctx.strokeStyle = c.goldWhite;
  ctx.globalAlpha = 0.75;
  ctx.lineWidth = 0.5;
  ctx.stroke();
}

function drawCaveMouth(
  ctx: Ctx,
  g: RaidAtlasGlyph,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  const r = g.r;
  const a0 = Math.atan2(axes(g.rot).rz, axes(g.rot).rx);
  ctx.beginPath();
  ctx.moveTo(g.x + Math.cos(a0) * r, g.z + Math.sin(a0) * r);
  ctx.arc(g.x, g.z, r, a0, a0 + Math.PI, true);
  ctx.closePath();
  const dark = ctx.createRadialGradient(g.x, g.z, 0, g.x, g.z, r);
  dark.addColorStop(0, c.frameDark);
  dark.addColorStop(1, c.abyss);
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = dark;
  ctx.fill();
  ctx.strokeStyle = c.ink;
  ctx.globalAlpha = 0.9;
  ctx.lineWidth = pen(t, 1.8);
  ctx.stroke();
}

function drawFirePool(
  ctx: Ctx,
  g: RaidAtlasGlyph,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  const r = g.r;
  const glow = ctx.createRadialGradient(g.x, g.z, 0, g.x, g.z, r);
  glow.addColorStop(0, c.goldWhite);
  glow.addColorStop(0.4, c.glow);
  glow.addColorStop(0.75, c.heartGlow);
  glow.addColorStop(1, c[g.tone]);
  ctx.beginPath();
  circle(ctx, g.x, g.z, r);
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = glow;
  ctx.fill();
  ctx.strokeStyle = c.ink;
  ctx.lineWidth = pen(t, 2);
  ctx.stroke();
  // The lip's basalt stumps.
  ctx.beginPath();
  const n = 12;
  for (let i = 0; i < n; i++) {
    const a = ((i + atlasHash01(i, 401) * 0.4) / n) * Math.PI * 2;
    circle(ctx, g.x + Math.sin(a) * r, g.z + Math.cos(a) * r, 0.7 + atlasHash01(i, 409) * 0.5);
  }
  fillStroke(ctx, c.abyss, 0.95, c.ink, pen(t, 1));
  // Rings of heat welling out of its middle.
  ctx.beginPath();
  circle(ctx, g.x, g.z, r * 0.55);
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = c[g.tone];
  ctx.lineWidth = pen(t, 1.2);
  ctx.setLineDash([pen(t, 4), pen(t, 3)]);
  ctx.stroke();
  ctx.setLineDash([]);
}

/** Every room's landmarks, over its floor. */
export function paintDetailGlyphs(
  ctx: Ctx,
  detail: RaidAtlasFloorDetail,
  t: RaidAtlasPageTransform,
  c: RaidAtlasColors,
): void {
  ctx.save();
  ctx.lineJoin = 'round';
  for (const g of detail.glyphs) {
    if (!raidAtlasDrawsTier(g.tier, t.k)) continue;
    if (Math.max(g.r, g.hw, g.hd) * 2 * t.k < MIN_GLYPH_PX) continue;
    switch (g.kind) {
      case 'column':
        drawColumn(ctx, g, t, c);
        break;
      case 'colossus':
        drawColossus(ctx, g, t, c);
        break;
      case 'block':
        drawBlock(ctx, g, t, c, false);
        break;
      case 'emberRock':
        drawBlock(ctx, g, t, c, true);
        break;
      case 'derrick':
        drawDerrick(ctx, g, t, c);
        break;
      case 'crystal':
        drawCrystal(ctx, g, t, c);
        break;
      case 'statue':
        drawStatue(ctx, g, t, c);
        break;
      case 'standingStone':
        drawStandingStone(ctx, g, t, c);
        break;
      case 'cairn':
        drawCairn(ctx, g, t, c);
        break;
      case 'shelter':
        drawShelter(ctx, g, t, c);
        break;
      case 'brazier':
        drawBrazier(ctx, g, t, c);
        break;
      case 'vent':
        drawVent(ctx, g, t, c);
        break;
      case 'blade':
        drawBlade(ctx, g, t, c);
        break;
      case 'iceShelf':
        drawIceShelf(ctx, g, t, c);
        break;
      case 'wellspring':
        drawWellspring(ctx, g, t, c);
        break;
      case 'hearthMouth':
        drawHearthMouth(ctx, g, t, c);
        break;
      case 'anvil':
        drawAnvil(ctx, g, t, c);
        break;
      case 'fireSeam':
        drawFireSeam(ctx, g, t, c);
        break;
      case 'caveMouth':
        drawCaveMouth(ctx, g, t, c);
        break;
      case 'firePool':
        drawFirePool(ctx, g, t, c);
        break;
    }
    ctx.globalAlpha = 1;
    ctx.setLineDash([]);
  }
  ctx.restore();
}
