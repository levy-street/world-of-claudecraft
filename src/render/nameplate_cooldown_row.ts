// Draws the enemy cooldown row ABOVE a hostile player's name: tile, artwork,
// group border, the active glow or the recharge swipe, the group badge, and the
// countdown, one icon per slot. A painter-side drawing helper the canvas surface
// calls with its own pen and caches (the nameplate_dot_row.ts shape, whose host
// interface it borrows), so nameplate_canvas.ts stays a compositor.
//
// The row's geometry and its slot records come from the pure
// nameplate_cooldowns_core.ts; nothing is decided here.
//
// Every state carries a cue that is not colour alone, so forced colors (which
// collapse every fill to the system palette) and colour-blind players lose
// nothing: the group badge's glyph (shield, up arrow, ring), a thicker border for
// an active buff, and the swipe for a recharging one.

import type { MajorCooldownGroup } from '../sim/major_cooldowns';
import {
  clampNameplateCooldownScale,
  NAMEPLATE_COOLDOWN_GAP,
  NAMEPLATE_COOLDOWN_GROUP_GAP,
  NAMEPLATE_COOLDOWN_SIZE,
  NAMEPLATE_COOLDOWN_TIMER_STEP,
  type NameplateCooldownsPlan,
  nameplateCooldownRowHeight,
  nameplateCooldownRowWidth,
} from './nameplate_cooldowns_core';
import { type NameplateDotRowHost, nameplateDotTimeFont } from './nameplate_dot_row';

/** Border and badge colour per group. Defensive blue and offensive red also
 *  differ in lightness, so they stay apart for a red/green colour-blind eye. */
export const NAMEPLATE_COOLDOWN_GROUP_TINTS: Readonly<Record<MajorCooldownGroup, string>> = {
  medallion: '#f2c84b',
  defensive: '#6fb6ff',
  offensive: '#d23a1e',
};
const GLOW_TINTS: Readonly<Record<MajorCooldownGroup, string>> = {
  medallion: 'rgba(242, 200, 75, 0.85)',
  defensive: 'rgba(111, 182, 255, 0.85)',
  offensive: 'rgba(224, 67, 42, 0.9)',
};
const BADGE_GLYPH_FILLS: Readonly<Record<MajorCooldownGroup, string>> = {
  medallion: '#2a1f00',
  defensive: '#0b1a2c',
  offensive: '#ffffff',
};
const TILE_FILL = '#0e1118';
const SWIPE_FILL = 'rgba(4, 6, 10, 0.66)';
// A spent cooldown reads dimmer than a live buff even where the swipe has
// cleared, the "not available" cue the mockup's desaturation carried, without a
// per-icon canvas filter (unsupported on WebKit, and costly per frame).
const SPENT_WASH = 'rgba(4, 6, 10, 0.22)';
const TILE_RADIUS = 2;
const TIME_ACTIVE_FILL = '#ffffff';
const TIME_SPENT_FILL = '#c4cad3';
// Back in under ten seconds: the dot row's amber, redundant with the number.
const TIME_SOON_FILL = '#ffcf40';

function drawBadgeGlyph(
  ctx: CanvasRenderingContext2D,
  group: MajorCooldownGroup,
  cx: number,
  cy: number,
  r: number,
  fill: string,
): void {
  ctx.beginPath();
  if (group === 'defensive') {
    // A shield: flat top, pointed foot.
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r * 0.85, cy - r * 0.6);
    ctx.lineTo(cx + r * 0.85, cy);
    ctx.quadraticCurveTo(cx + r * 0.8, cy + r * 0.75, cx, cy + r);
    ctx.quadraticCurveTo(cx - r * 0.8, cy + r * 0.75, cx - r * 0.85, cy);
    ctx.lineTo(cx - r * 0.85, cy - r * 0.6);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  } else if (group === 'offensive') {
    // An up arrow: power rising.
    ctx.moveTo(cx, cy - r);
    ctx.lineTo(cx + r * 0.9, cy + r * 0.1);
    ctx.lineTo(cx + r * 0.35, cy + r * 0.1);
    ctx.lineTo(cx + r * 0.35, cy + r);
    ctx.lineTo(cx - r * 0.35, cy + r);
    ctx.lineTo(cx - r * 0.35, cy + r * 0.1);
    ctx.lineTo(cx - r * 0.9, cy + r * 0.1);
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
  } else {
    // A ring: the medallion.
    ctx.arc(cx, cy, r * 0.7, 0, Math.PI * 2);
    ctx.lineWidth = r * 0.45;
    ctx.strokeStyle = fill;
    ctx.stroke();
  }
}

/**
 * Draw `plan`'s icons centred on `centerX`, with `bottomY` the top edge of the
 * name row the row sits on. Returns the height consumed (0 for an empty plan),
 * the same number nameplateCooldownRowHeight gives the anchor and emote walks.
 */
export function drawNameplateCooldownRow(
  ctx: CanvasRenderingContext2D,
  plan: NameplateCooldownsPlan,
  centerX: number,
  bottomY: number,
  host: NameplateDotRowHost,
): number {
  const height = nameplateCooldownRowHeight(plan);
  if (height === 0) return 0;
  const forced = host.forcedColors();
  const scale = clampNameplateCooldownScale(plan.scale);
  const size = NAMEPLATE_COOLDOWN_SIZE * scale;
  const gap = NAMEPLATE_COOLDOWN_GAP * scale;
  const groupGap = NAMEPLATE_COOLDOWN_GROUP_GAP * scale;
  const radius = TILE_RADIUS * scale;
  const topY = bottomY - height;
  let x = centerX - nameplateCooldownRowWidth(plan, scale) / 2;
  for (let i = 0; i < plan.count; i++) {
    const slot = plan.slots[i];
    if (i > 0 && slot.group !== plan.slots[i - 1].group) x += groupGap;
    const tint = NAMEPLATE_COOLDOWN_GROUP_TINTS[slot.group];

    // Tile, with the active glow cast from it (no glow under forced colors).
    ctx.save();
    if (slot.active && !forced) {
      ctx.shadowColor = GLOW_TINTS[slot.group];
      ctx.shadowBlur = 6 * scale;
    }
    host.roundedRect(ctx, x, topY, size, size, radius);
    ctx.fillStyle = forced ? 'Canvas' : TILE_FILL;
    ctx.fill();
    ctx.restore();

    if (slot.iconUrl) {
      ctx.save();
      host.roundedRect(ctx, x, topY, size, size, radius);
      ctx.clip();
      host.drawImage(slot.iconUrl, x, topY, size);
      ctx.restore();
    }

    // Recharging: dim the art, then darken the part of the cooldown still to
    // run, clockwise from twelve, so the dark wedge shrinks as it comes back.
    if (!slot.active) {
      ctx.save();
      host.roundedRect(ctx, x, topY, size, size, radius);
      ctx.clip();
      if (!forced) {
        // The clip's rounded-rect path is still current: fill it as the wash.
        ctx.fillStyle = SPENT_WASH;
        ctx.fill();
      }
      if (slot.fraction > 0) {
        const cx = x + size / 2;
        const cy = topY + size / 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, size, Math.PI * 1.5 - Math.PI * 2 * slot.fraction, Math.PI * 1.5);
        ctx.closePath();
        ctx.fillStyle = forced ? 'Canvas' : SWIPE_FILL;
        ctx.fill();
      }
      ctx.restore();
    }

    host.roundedRect(ctx, x + 0.5, topY + 0.5, size - 1, size - 1, radius);
    ctx.lineWidth = (slot.active ? 2.2 : 1.4) * scale;
    ctx.strokeStyle = forced ? 'CanvasText' : tint;
    ctx.stroke();

    // The group badge on the top-left corner: the non-colour group cue.
    const badgeR = 3.2 * scale;
    const bx = x + badgeR * 0.45;
    const by = topY + badgeR * 0.45;
    ctx.beginPath();
    ctx.arc(bx, by, badgeR, 0, Math.PI * 2);
    ctx.fillStyle = forced ? 'Canvas' : tint;
    ctx.fill();
    ctx.lineWidth = 0.8 * scale;
    ctx.strokeStyle = forced ? 'CanvasText' : '#000';
    ctx.stroke();
    drawBadgeGlyph(
      ctx,
      slot.group,
      bx,
      by,
      badgeR * 0.62,
      forced ? 'CanvasText' : BADGE_GLYPH_FILLS[slot.group],
    );

    if (slot.timeText) {
      host.drawText(
        ctx,
        slot.timeText,
        x + size / 2,
        topY + size + (NAMEPLATE_COOLDOWN_TIMER_STEP - 1) * scale,
        nameplateDotTimeFont(scale),
        slot.active ? TIME_ACTIVE_FILL : slot.unit === 'tenths' ? TIME_SOON_FILL : TIME_SPENT_FILL,
      );
    }
    x += size + gap;
  }
  return height;
}

// The plan surface the canvas composes, re-exported so the surface imports the
// whole row (draw, size, state) from this one module.
export {
  type NameplateCooldownsPlan,
  nameplateCooldownRowHeight,
  newNameplateCooldownsPlan,
} from './nameplate_cooldowns_core';
