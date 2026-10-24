// Shared boat silhouette for zone and continent maps. Tokens come from the caller.
export function drawFerryPortMapMarker(
  ctx: CanvasRenderingContext2D,
  marker: { mx: number; my: number },
  size: number,
  fill: string,
  outline: string,
): void {
  const r = size / 2;
  const x = marker.mx;
  const y = marker.my;
  ctx.save();
  ctx.fillStyle = fill;
  ctx.strokeStyle = outline;
  ctx.lineWidth = Math.max(1, size / 10);
  ctx.lineJoin = 'round';
  // A broad hull below a triangular sail, legible without color or loaded art.
  ctx.beginPath();
  ctx.moveTo(x - r, y + r * 0.25);
  ctx.lineTo(x + r, y + r * 0.25);
  ctx.lineTo(x + r * 0.55, y + r * 0.85);
  ctx.lineTo(x - r * 0.55, y + r * 0.85);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x, y + r * 0.1);
  ctx.lineTo(x, y - r);
  ctx.lineTo(x + r * 0.8, y + r * 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}
