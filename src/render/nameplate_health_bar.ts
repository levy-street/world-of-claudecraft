// A nameplate's ordinary health bar, moved out of NameplateCanvasSurface.drawHealth
// unchanged (the monolith ratchet), so the surface only chooses between this and
// the skill event heart row (nameplate_hearts.ts).

import type { NameplateCanvasState } from './nameplate_canvas';
import { roundedRect } from './nameplate_paint_primitives';
import { nameplateHealthBarWidth } from './nameplate_pick_core';

export function drawNameplateHealthBar(
  ctx: CanvasRenderingContext2D,
  state: NameplateCanvasState,
  centerX: number,
  y: number,
  forcedColors: boolean,
): void {
  const width = nameplateHealthBarWidth(state.frame === 'boss');
  const x = centerX - width / 2;
  if (state.threat) {
    ctx.save();
    ctx.shadowColor = forcedColors ? 'CanvasText' : '#c0392b';
    ctx.shadowBlur = 8;
    ctx.fillStyle = forcedColors ? 'Canvas' : '#2a0000';
    roundedRect(ctx, x, y, width, 4, 2);
    ctx.fill();
    ctx.restore();
  }
  roundedRect(ctx, x, y, width, 4, 2);
  ctx.fillStyle = forcedColors ? 'Canvas' : '#2a0000';
  ctx.fill();
  const fill = Math.max(0, Math.min(1, state.hpFill));
  if (fill > 0) {
    roundedRect(ctx, x, y, width * fill, 4, 2);
    ctx.fillStyle = forcedColors
      ? 'Highlight'
      : state.threat
        ? '#d93632'
        : state.myPet
          ? '#4080ff'
          : state.friendlyPet
            ? '#76b653'
            : state.hostile
              ? '#e12c2c'
              : '#2dab46';
    ctx.fill();
  }
  ctx.lineWidth = state.frame === 'boss' ? 2 : 1;
  ctx.strokeStyle = forcedColors
    ? 'CanvasText'
    : state.frame === 'boss'
      ? '#ff5555'
      : state.frame === 'elite'
        ? '#f2c84b'
        : state.currentTarget
          ? '#ffffffaa'
          : state.hostile
            ? '#2e0000'
            : '#00000088';
  roundedRect(ctx, x, y, width, 4, 2);
  ctx.stroke();
}
