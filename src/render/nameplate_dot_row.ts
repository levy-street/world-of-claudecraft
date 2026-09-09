// Draws the player's own dot icons on an enemy nameplate: tile, artwork, cooldown
// swipe, school-tinted border and countdown, one icon per slot. A painter-side
// drawing helper the canvas surface calls, the drawNameplateLootIcon shape, so
// nameplate_canvas.ts stays a compositor rather than growing another method bank.
//
// The row's geometry and its slot records come from the pure
// nameplate_dots_core.ts; nothing is decided here.

import { isAuraExpiring } from '../ui/auras_view';
import type { TextSpriteStyle } from '../ui/text_sprite_cache';
import {
  clampNameplateDotScale,
  NAMEPLATE_DOT_GAP,
  NAMEPLATE_DOT_SIZE,
  NAMEPLATE_DOT_TIMER_STEP,
  type NameplateDotsPlan,
  nameplateDotRowWidth,
} from './nameplate_dots_core';

/** The dot-row countdown at 100%. Small, heavy and stroked so a one-decimal
 *  number stays readable against grass, stone or a lit VFX; the scale slider
 *  grows the px size with the icons (NAMEPLATE_DOT_TIME_PX). */
export const NAMEPLATE_DOT_TIME_STYLE: TextSpriteStyle = {
  font: '700 7px Arial, sans-serif',
  fill: '#eeeeee',
  stroke: '#000',
  lineWidth: 1.5,
};
/** The countdown's px size at 100%; the row scales it with everything else so a
 *  bigger icon never keeps a 7px number pinned under it. */
export const NAMEPLATE_DOT_TIME_PX = 7;

/** The countdown's font at `scale`. The sprite cache keys on this STRING, so a
 *  new size simply mints its own sprites instead of returning the old size's. */
export function nameplateDotTimeFont(scale: number): string {
  if (scale === 1) return NAMEPLATE_DOT_TIME_STYLE.font;
  return `700 ${Math.round(NAMEPLATE_DOT_TIME_PX * scale * 10) / 10}px Arial, sans-serif`;
}

// The countdown turns amber in an aura's final seconds, the one colour change in
// the row. It is REDUNDANT with the number itself shrinking toward zero, so a
// player who cannot separate the two colours loses nothing (and forced-colors
// collapses both to CanvasText, which is why the number is the real cue).
//
// It uses the SAME rule as every other aura surface (isAuraExpiring: the last ten
// seconds, but never before 30% of the duration has run down) rather than a flat
// threshold of its own. A flat four seconds meant a long dot blinked on the
// Target dots frame while its plate icon was still white, which is the same aura
// disagreeing with itself across two surfaces.
const TIME_EXPIRING_FILL = '#ffcf40';

// Magic-school tints for the icon border, byte-identical to the --color-debuff-*
// tokens the DOM aura strips use (src/styles/tokens.css), so one school reads the
// same on a nameplate, on the target frame and in the Target dots frame.
export const NAMEPLATE_DOT_SCHOOL_TINTS: Readonly<Record<string, string>> = {
  fire: '#e8722a',
  frost: '#4aa3df',
  arcane: '#3f8cff',
  shadow: '#9b59d0',
  nature: '#35a835',
  holy: '#d8b56b',
  physical: '#c0392b',
};
export const NAMEPLATE_DOT_SCHOOL_DEFAULT_TINT = '#c0392b';
const TILE_FILL = '#0e1118';
const SWIPE_FILL = 'rgba(4, 6, 10, 0.62)';
const TILE_RADIUS = 2;

/** What the row borrows from the canvas surface: its rounded-rect pen, its image
 *  cache, its text-sprite cache, and its forced-colors state. Injected rather
 *  than imported so this module owns no cache of its own. */
export interface NameplateDotRowHost {
  forcedColors(): boolean;
  roundedRect(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ): void;
  drawImage(url: string, x: number, y: number, size: number): void;
  /** `font` is the scaled countdown font (nameplateDotTimeFont); the host stamps
   *  it onto its own reused style before drawing. */
  drawText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    font: string,
    fill: string,
  ): void;
}

/**
 * Draw `plan`'s icons centred on `centerX`, with `topY` as the row's top edge in
 * plate units (the caller has already subtracted nameplateDotRowHeight).
 */
export function drawNameplateDotRow(
  ctx: CanvasRenderingContext2D,
  plan: NameplateDotsPlan,
  centerX: number,
  topY: number,
  host: NameplateDotRowHost,
): void {
  const forced = host.forcedColors();
  // ONE multiplier for the whole row: the icon edge, the gap, the countdown step
  // and its px size all scale together, so the row keeps its proportions at 300%
  // and the height the draw walks reserved still fits it exactly.
  const scale = clampNameplateDotScale(plan.scale);
  const size = NAMEPLATE_DOT_SIZE * scale;
  const gap = NAMEPLATE_DOT_GAP * scale;
  const radius = TILE_RADIUS * scale;
  let x = centerX - nameplateDotRowWidth(plan.count, scale) / 2;
  for (let i = 0; i < plan.count; i++) {
    const slot = plan.slots[i];
    host.roundedRect(ctx, x, topY, size, size, radius);
    ctx.fillStyle = forced ? 'Canvas' : TILE_FILL;
    ctx.fill();

    if (slot.iconUrl) {
      ctx.save();
      host.roundedRect(ctx, x, topY, size, size, radius);
      ctx.clip();
      host.drawImage(slot.iconUrl, x, topY, size);
      ctx.restore();
    }

    // Cooldown swipe: the SPENT part of the duration darkens clockwise from
    // twelve, so how much is left reads without parsing the number. Every term
    // here is the SCALED one: a raw-size clip or radius darkens only the
    // top-left of a grown icon, which is a wrong cue at every scale above 100%.
    if (slot.fraction < 1) {
      ctx.save();
      host.roundedRect(ctx, x, topY, size, size, radius);
      ctx.clip();
      const cx = x + size / 2;
      const cy = topY + size / 2;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, size, -Math.PI / 2 + Math.PI * 2 * slot.fraction, Math.PI * 1.5);
      ctx.closePath();
      ctx.fillStyle = forced ? 'Canvas' : SWIPE_FILL;
      ctx.fill();
      ctx.restore();
    }

    host.roundedRect(ctx, x + 0.5, topY + 0.5, size - 1, size - 1, radius);
    ctx.lineWidth = 1.4 * scale;
    ctx.strokeStyle = forced
      ? 'CanvasText'
      : (NAMEPLATE_DOT_SCHOOL_TINTS[slot.school] ?? NAMEPLATE_DOT_SCHOOL_DEFAULT_TINT);
    ctx.stroke();

    if (slot.timeText) {
      host.drawText(
        ctx,
        slot.timeText,
        x + size / 2,
        topY + size + (NAMEPLATE_DOT_TIMER_STEP - 1) * scale,
        nameplateDotTimeFont(scale),
        isAuraExpiring(slot.remaining, slot.duration)
          ? TIME_EXPIRING_FILL
          : NAMEPLATE_DOT_TIME_STYLE.fill,
      );
    }
    x += size + gap;
  }
}
