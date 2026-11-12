// The skill event heart row drawn in place of a nameplate's health bar while
// the unit fights a heart event (src/sim/pvp/skill_events.ts): one small heart
// per hit point, full or spent, centred on the bar's line. Pure canvas draws,
// no state, no allocation per call.

import { SKILL_EVENT_HEARTS } from '../sim/pvp/skill_event_rules';

const HEART_SIZE = 10;

/** NameplateCanvasState.hearts sentinel: a heart fighter whose row is not
 *  drawn at all (neither hearts nor the health bar). */
export const NAMEPLATE_HEARTS_HIDDEN = -2;

/** The hearts value a plate paints: -1 for no heart fight (the health bar),
 *  NAMEPLATE_HEARTS_HIDDEN for your own plate on a touch screen (the player
 *  frame already shows your hearts, and the row over your head hides the
 *  fight), otherwise the hearts left. Targets and other fighters keep theirs. */
export function nameplateHeartsFor(
  eventHearts: number | undefined,
  isOwn: boolean,
  mobileTouch: boolean,
): number {
  if (eventHearts === undefined) return -1;
  return isOwn && mobileTouch ? NAMEPLATE_HEARTS_HIDDEN : eventHearts;
}
const HEART_GAP = 3;

/** Trace one heart of width `s` with its top centre at (cx, top). */
function traceHeart(ctx: CanvasRenderingContext2D, cx: number, top: number, s: number): void {
  const h = s * 0.92;
  ctx.beginPath();
  ctx.moveTo(cx, top + h);
  ctx.bezierCurveTo(
    cx - s * 0.62,
    top + h * 0.58,
    cx - s * 0.56,
    top - h * 0.05,
    cx,
    top + h * 0.26,
  );
  ctx.bezierCurveTo(cx + s * 0.56, top - h * 0.05, cx + s * 0.62, top + h * 0.58, cx, top + h);
  ctx.closePath();
}

/** Draw SKILL_EVENT_HEARTS hearts, `filled` of them full, centred on the
 *  health bar's line, whose top is `barY` (the bar is 4 px tall). */
export function drawNameplateHearts(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  barY: number,
  filled: number,
  forcedColors: boolean,
): void {
  const midY = barY + 2;
  const count = SKILL_EVENT_HEARTS;
  const total = count * HEART_SIZE + (count - 1) * HEART_GAP;
  let cx = centerX - total / 2 + HEART_SIZE / 2;
  const top = midY - HEART_SIZE / 2;
  ctx.lineWidth = 1;
  for (let i = 0; i < count; i++) {
    traceHeart(ctx, cx, top, HEART_SIZE);
    const full = i < filled;
    ctx.fillStyle = forcedColors ? (full ? 'Highlight' : 'Canvas') : full ? '#e8302a' : '#2a1517';
    ctx.fill();
    ctx.strokeStyle = forcedColors ? 'CanvasText' : full ? '#2a0c0c' : '#8a2a26';
    ctx.stroke();
    cx += HEART_SIZE + HEART_GAP;
  }
}
