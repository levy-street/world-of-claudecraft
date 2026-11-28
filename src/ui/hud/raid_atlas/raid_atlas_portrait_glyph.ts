// The boss portrait medallion: the boss's own face (a bust of its in-game
// model) set in a round gilded frame, the atlas's answer to a dungeon
// journal's map pin. Vector frame at screen size over the baked bust, so it
// stays crisp at every zoom and density.
//
//   standing   full colour on a deep crimson field, a gilded rim
//   fighting   the field burns brighter and the rim turns red (the live
//              layer adds the pulse ring, drawEngagedPulse)
//   defeated   grey stone on a grey field, dimmed, struck through in red
//
// A council (one encounter of two bodies) carries its partner as a smaller
// medallion overlapping the lead's lower right (RAID_ATLAS_PARTNER). Until a
// face has loaded the classic crest medallion stands in.

import { RAID_ATLAS_PARTNER } from './raid_atlas_boss_core';
import { drawBossMedallion } from './raid_atlas_glyph_painter';
import type { RaidAtlasColors } from './raid_atlas_palette_core';
import type { RaidAtlasFace } from './raid_atlas_portraits';
import type { RaidAtlasBossState } from './raid_atlas_view';

const TAU = Math.PI * 2;
/** The face's window inside the rim, as a share of the radius. */
const WINDOW = 0.8;

function drawOne(
  ctx: CanvasRenderingContext2D,
  c: RaidAtlasColors,
  x: number,
  y: number,
  r: number,
  state: RaidAtlasBossState,
  face: RaidAtlasFace | null,
): void {
  if (!face) {
    drawBossMedallion(ctx, c, x, y, r, state);
    return;
  }
  const dead = state === 'dead';
  const engaged = state === 'engaged';
  const w = r * WINDOW;
  ctx.save();
  ctx.translate(x, y);
  // The gilded rim, with a soft drop shadow onto the page.
  ctx.shadowColor = c.frameDark;
  ctx.shadowBlur = r * 0.5;
  ctx.shadowOffsetY = r * 0.12;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TAU);
  const ring = ctx.createLinearGradient(0, -r, 0, r);
  ring.addColorStop(0, dead ? c.parchmentLight : engaged ? c.goldWhite : c.goldLight);
  ring.addColorStop(0.5, dead ? c.dead : engaged ? c.bossEngaged : c.gold);
  ring.addColorStop(1, dead ? c.frameMid : c.goldDeep);
  ctx.fillStyle = ring;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.lineWidth = Math.max(1, r * 0.08);
  ctx.strokeStyle = c.frameDark;
  ctx.stroke();
  // The field behind the bust.
  ctx.beginPath();
  ctx.arc(0, 0, w, 0, TAU);
  const field = ctx.createRadialGradient(-w * 0.25, -w * 0.35, w * 0.05, 0, 0, w);
  field.addColorStop(0, dead ? c.dead : engaged ? c.bossEngaged : c.boss);
  field.addColorStop(1, c.frameDark);
  ctx.fillStyle = field;
  ctx.fill();
  // The face, clipped to the window.
  ctx.save();
  ctx.clip();
  if (dead) ctx.globalAlpha = 0.72;
  const s = w * 2.08;
  ctx.drawImage(dead ? face.grey(c.dead) : face.color, -s / 2, -s / 2, s, s);
  ctx.restore();
  // The window's bevel: a dark inner line and a lit upper arc.
  ctx.beginPath();
  ctx.arc(0, 0, w, 0, TAU);
  ctx.lineWidth = Math.max(0.8, r * 0.07);
  ctx.strokeStyle = dead ? c.frameMid : engaged ? c.boss : c.goldDeep;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(0, 0, r * 0.9, Math.PI * 1.15, Math.PI * 1.85);
  ctx.lineWidth = Math.max(0.6, r * 0.05);
  ctx.strokeStyle = dead ? c.parchmentLight : c.goldWhite;
  ctx.globalAlpha = 0.55;
  ctx.stroke();
  ctx.globalAlpha = 1;
  if (dead) {
    const k = w * 0.72;
    ctx.beginPath();
    ctx.moveTo(-k, -k);
    ctx.lineTo(k, k);
    ctx.moveTo(k, -k);
    ctx.lineTo(-k, k);
    ctx.lineCap = 'round';
    ctx.strokeStyle = c.frameDark;
    ctx.lineWidth = Math.max(1.6, r * 0.16);
    ctx.stroke();
    ctx.strokeStyle = c.bossEngaged;
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * A boss pin with its face: the lead's medallion of radius `r` at (x, y) and,
 * for a council, the partner's smaller one overlapping its lower right.
 * `faces[i]` is null until that bust has loaded.
 */
export function drawBossPortraitMedallion(
  ctx: CanvasRenderingContext2D,
  c: RaidAtlasColors,
  x: number,
  y: number,
  r: number,
  state: RaidAtlasBossState,
  lead: RaidAtlasFace | null,
  partner?: RaidAtlasFace | null,
): void {
  drawOne(ctx, c, x, y, r, state, lead);
  if (partner === undefined) return;
  drawOne(
    ctx,
    c,
    x + r * RAID_ATLAS_PARTNER.dx,
    y + r * RAID_ATLAS_PARTNER.dy,
    r * RAID_ATLAS_PARTNER.r,
    state,
    partner,
  );
}

/** The hovered or focused pin's halo: a warm gilded glow round its rim. */
export function drawBossHoverHalo(
  ctx: CanvasRenderingContext2D,
  c: RaidAtlasColors,
  x: number,
  y: number,
  r: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r * 1.12, 0, TAU);
  ctx.strokeStyle = c.goldLight;
  ctx.shadowColor = c.glow;
  ctx.shadowBlur = r * 0.9;
  ctx.lineWidth = Math.max(1.5, r * 0.14);
  ctx.stroke();
  ctx.restore();
}
