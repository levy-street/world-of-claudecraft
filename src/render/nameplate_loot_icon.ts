/** Draw the tiny loot-ready affordance as a satchel and glint, never a currency
 *  character. The caller supplies system colors for forced-color mode. */
export function drawNameplateLootIcon(
  ctx: CanvasRenderingContext2D,
  centerX: number,
  centerY: number,
  fill: string,
  outline: string,
): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 1.5;
  ctx.fillStyle = fill;
  ctx.strokeStyle = outline;

  ctx.beginPath();
  ctx.moveTo(centerX - 6, centerY - 3);
  ctx.quadraticCurveTo(centerX - 8, centerY + 1, centerX - 5, centerY + 6);
  ctx.quadraticCurveTo(centerX, centerY + 8, centerX + 5, centerY + 6);
  ctx.quadraticCurveTo(centerX + 8, centerY + 1, centerX + 6, centerY - 3);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(centerX - 5, centerY - 3);
  ctx.quadraticCurveTo(centerX, centerY + 1, centerX + 5, centerY - 3);
  ctx.quadraticCurveTo(centerX + 3, centerY - 6, centerX, centerY - 6);
  ctx.quadraticCurveTo(centerX - 3, centerY - 6, centerX - 5, centerY - 3);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(centerX, centerY + 1, 1.25, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(centerX + 7, centerY - 7);
  ctx.lineTo(centerX + 7, centerY - 3);
  ctx.moveTo(centerX + 5, centerY - 5);
  ctx.lineTo(centerX + 9, centerY - 5);
  ctx.stroke();
  ctx.restore();
}
