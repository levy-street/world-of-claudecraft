/** Draw the harvest-available affordance as a small skinning blade with a
 *  handle: a curved blade lobe, its spine, and a short angled grip. A different
 *  silhouette from the loot satchel (nameplate_loot_icon.ts), never a recolor
 *  of it, so the two read apart in grayscale and under forced colors. The
 *  caller supplies system colors for forced-color mode. */
export function drawNameplateHarvestIcon(
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

  // The blade lobe: a leaf-shaped curve sweeping up and to the right.
  ctx.beginPath();
  ctx.moveTo(centerX - 7, centerY + 4);
  ctx.quadraticCurveTo(centerX - 3, centerY - 7, centerX + 4, centerY - 3);
  ctx.quadraticCurveTo(centerX + 1, centerY + 2, centerX - 5, centerY + 5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  // The spine, a single stroke along the blade's back.
  ctx.beginPath();
  ctx.moveTo(centerX - 5, centerY + 3);
  ctx.lineTo(centerX + 2, centerY - 2);
  ctx.stroke();

  // The grip: a short thick bar continuing the blade's line down to the right.
  ctx.beginPath();
  ctx.lineWidth = 3;
  ctx.moveTo(centerX + 3, centerY);
  ctx.lineTo(centerX + 8, centerY + 6);
  ctx.stroke();
  ctx.restore();
}
