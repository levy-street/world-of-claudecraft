// Shared procedural skull art; all colors come from the owning map palette.
const WORLD_BOSS_SKULL_CRANIUM_RATIO = 0.34;
const WORLD_BOSS_SKULL_JAW_HALF_RATIO = 0.22;
const WORLD_BOSS_SKULL_JAW_TOP_RATIO = 0.13;
const WORLD_BOSS_SKULL_JAW_HEIGHT_RATIO = 0.26;
const WORLD_BOSS_SKULL_EYE_RATIO = 0.085;

export function drawMapSkull(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill: string,
  socket: string,
): void {
  const craniumRadius = radius * WORLD_BOSS_SKULL_CRANIUM_RATIO;
  const jawHalf = radius * WORLD_BOSS_SKULL_JAW_HALF_RATIO;
  const jawTop = y + radius * WORLD_BOSS_SKULL_JAW_TOP_RATIO;
  const jawHeight = radius * WORLD_BOSS_SKULL_JAW_HEIGHT_RATIO;
  const eyeRadius = radius * WORLD_BOSS_SKULL_EYE_RATIO;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y - radius * 0.08, craniumRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - jawHalf, jawTop, jawHalf * 2, jawHeight);
  ctx.fillStyle = socket;
  ctx.beginPath();
  ctx.arc(x - craniumRadius * 0.42, y - radius * 0.08, eyeRadius, 0, Math.PI * 2);
  ctx.arc(x + craniumRadius * 0.42, y - radius * 0.08, eyeRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - eyeRadius * 0.35, jawTop, eyeRadius * 0.7, jawHeight);
}

export function drawHillMapMarker(
  ctx: CanvasRenderingContext2D,
  marker: { mx: number; my: number; phase: 'warning' | 'active' },
  radius: number,
  fill: string,
  outline: string,
): void {
  ctx.save();
  ctx.strokeStyle = outline;
  ctx.fillStyle = fill;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(marker.mx, marker.my, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  drawMapSkull(ctx, marker.mx, marker.my, radius * 1.7, outline, fill);
  // A warning has an extra outer ring, distinct without relying on color.
  if (marker.phase === 'warning') {
    ctx.strokeStyle = fill;
    ctx.beginPath();
    ctx.arc(marker.mx, marker.my, radius + 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
