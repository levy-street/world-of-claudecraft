// Canvas drawing for three of the Style of Enemy Highlight cues
// (target_highlight_core.ts holds the flags and the edge-arrow placement math):
// the gold frame around a big target plate, the chevron over the target's
// head, and the arrow pinned to the screen edge while the target is off camera.
// Drawn on the nameplate surface (nameplate_canvas.ts), so they share its
// repaint gate and its forced-colors handling. Like every plate-drawing
// module, this file reads no graphics knob or FPS governor.

import { roundedRect } from './nameplate_paint_primitives';
import { TARGET_PLATE_EMPHASIS_SCALE } from './target_highlight_core';

const HOSTILE_FILL = '#e12c2c';
const HOSTILE_EDGE = '#2e0000';
const HOSTILE_GLOW = '#ff4a3a99';
const FRAME_GOLD = '#f2c84b';
const FRAME_GLOW = '#f2c84b88';
const LABEL_FONT = '700 12px Cinzel, Georgia, serif';

/** What the surface draws for the target outside its own plate this pass. */
export const TARGET_OVERLAY_NONE = 0;
/** A chevron over a target whose plate is not drawn (plates off, or past plate range). */
export const TARGET_OVERLAY_CHEVRON = 1;
/** The screen-edge arrow for a target that is off camera. */
export const TARGET_OVERLAY_ARROW = 2;

export interface TargetOverlay {
  kind: number;
  /** Chevron: its bottom tip. Arrow: its tip. CSS px. */
  x: number;
  y: number;
  /** Arrow direction in radians (screen space); unused by the chevron. */
  angle: number;
  /** Arrow caption (the distance); '' for the chevron. */
  label: string;
}

export function newTargetOverlay(): TargetOverlay {
  return { kind: TARGET_OVERLAY_NONE, x: 0, y: 0, angle: 0, label: '' };
}

/** Scale everything drawn after this about the plate anchor (the framed-plate cue). */
export function scalePlateAboutAnchor(
  ctx: CanvasRenderingContext2D,
  anchorX: number,
  anchorY: number,
): void {
  ctx.translate(anchorX, anchorY);
  ctx.scale(TARGET_PLATE_EMPHASIS_SCALE, TARGET_PLATE_EMPHASIS_SCALE);
  ctx.translate(-anchorX, -anchorY);
}

/** A gold frame around the plate block from the name row's top to the bars' bottom. */
export function drawTargetPlateFrame(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  top: number,
  bottom: number,
  contentWidth: number,
  forcedColors: boolean,
): void {
  const width = contentWidth + 14;
  ctx.save();
  if (!forcedColors) {
    ctx.shadowColor = FRAME_GLOW;
    ctx.shadowBlur = 6;
  }
  ctx.lineWidth = 2;
  ctx.strokeStyle = forcedColors ? 'Highlight' : FRAME_GOLD;
  roundedRect(ctx, centerX - width / 2, top - 3, width, bottom - top + 6, 4);
  ctx.stroke();
  ctx.restore();
}

/** A downward chevron whose bottom tip sits at (x, tipY). */
export function drawOverheadChevron(
  ctx: CanvasRenderingContext2D,
  x: number,
  tipY: number,
  forcedColors: boolean,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(x - 11, tipY - 14);
  ctx.lineTo(x, tipY - 7);
  ctx.lineTo(x + 11, tipY - 14);
  ctx.lineTo(x, tipY);
  ctx.closePath();
  if (!forcedColors) {
    ctx.shadowColor = HOSTILE_GLOW;
    ctx.shadowBlur = 8;
  }
  ctx.fillStyle = forcedColors ? 'Highlight' : HOSTILE_FILL;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = forcedColors ? 'CanvasText' : HOSTILE_EDGE;
  ctx.stroke();
  ctx.restore();
}

/** The off-camera arrow: a wedge pointing along `angle` with its distance
 *  caption set back toward the screen centre. */
export function drawTargetEdgeArrow(
  ctx: CanvasRenderingContext2D,
  overlay: TargetOverlay,
  forcedColors: boolean,
): void {
  ctx.save();
  ctx.translate(overlay.x, overlay.y);
  ctx.rotate(overlay.angle);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-24, -14);
  ctx.lineTo(-18, 0);
  ctx.lineTo(-24, 14);
  ctx.closePath();
  if (!forcedColors) {
    ctx.shadowColor = HOSTILE_GLOW;
    ctx.shadowBlur = 10;
  }
  ctx.fillStyle = forcedColors ? 'Highlight' : HOSTILE_FILL;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = forcedColors ? 'CanvasText' : HOSTILE_EDGE;
  ctx.stroke();
  ctx.restore();
  if (!overlay.label) return;
  const lx = overlay.x - Math.cos(overlay.angle) * 40;
  const ly = overlay.y - Math.sin(overlay.angle) * 40 + 4;
  ctx.save();
  ctx.font = LABEL_FONT;
  ctx.textAlign = 'center';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = forcedColors ? 'Canvas' : '#000';
  ctx.strokeText(overlay.label, lx, ly);
  ctx.fillStyle = forcedColors ? 'CanvasText' : '#fff';
  ctx.fillText(overlay.label, lx, ly);
  ctx.restore();
}
