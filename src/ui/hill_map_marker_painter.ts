// Procedural map marker art shared by the zone map, the continent map and the
// minimap: the world-boss skull, the King of the Hill crown and the hourly
// skill event badge. All colors come from the owning map palette.
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

/** One full breath of the PvP markers' glow (the King of the Hill crown and the
 *  skill event badge). The map repaints on its own ~4 Hz band, so a slow
 *  period keeps the pulse readable rather than flickering. */
export const MAP_PVP_PULSE_PERIOD_MS = 1800;

/** The glow's breath at wall-clock `nowMs`, in [0, 1]. */
export function mapPvpPulse(nowMs: number): number {
  const phase = (nowMs % MAP_PVP_PULSE_PERIOD_MS) / MAP_PVP_PULSE_PERIOD_MS;
  return 0.5 - 0.5 * Math.cos(phase * Math.PI * 2);
}

let reducedMotionQuery: MediaQueryList | null | undefined;

/** The pulse to paint now: held still at mid-breath when the player asked the
 *  system for reduced motion. */
export function mapPvpPulseNow(): number {
  if (reducedMotionQuery === undefined) {
    reducedMotionQuery =
      typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  }
  return reducedMotionQuery?.matches ? 0.5 : mapPvpPulse(performance.now());
}

/** The pulsing halo behind a PvP marker: two soft discs whose size and
 *  opacity breathe with `pulse`. */
function drawPvpGlow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
  pulse: number,
): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.globalAlpha = 0.14 + 0.22 * pulse;
  ctx.beginPath();
  ctx.arc(x, y, radius * (1.55 + 0.45 * pulse), 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 0.22 + 0.3 * pulse;
  ctx.beginPath();
  ctx.arc(x, y, radius * (1.18 + 0.2 * pulse), 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** A three-pointed crown sized to a badge of `radius`, centred on (x, y). */
export function drawMapCrown(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  fill: string,
): void {
  const w = radius * 0.62;
  const base = y + radius * 0.34;
  const band = radius * 0.2;
  const rim = base - band;
  const tip = y - radius * 0.46;
  const valley = y - radius * 0.06;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(x - w, base);
  ctx.lineTo(x - w, rim);
  ctx.lineTo(x - w * 1.08, tip);
  ctx.lineTo(x - w * 0.45, valley);
  ctx.lineTo(x, tip - radius * 0.08);
  ctx.lineTo(x + w * 0.45, valley);
  ctx.lineTo(x + w * 1.08, tip);
  ctx.lineTo(x + w, rim);
  ctx.lineTo(x + w, base);
  ctx.closePath();
  ctx.fill();
}

/** The King of the Hill marker: a red crown on a dark badge inside a pulsing
 *  red glow (owner brief 2026-11-12, replacing the blue skull). A warning
 *  keeps its extra outer ring, so the phase never relies on color alone. */
export function drawHillMapMarker(
  ctx: CanvasRenderingContext2D,
  marker: { mx: number; my: number; phase: 'warning' | 'active' },
  radius: number,
  fill: string,
  outline: string,
  pulse = 0.5,
): void {
  ctx.save();
  drawPvpGlow(ctx, marker.mx, marker.my, radius, fill, pulse);
  ctx.strokeStyle = fill;
  ctx.fillStyle = outline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(marker.mx, marker.my, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  drawMapCrown(ctx, marker.mx, marker.my, radius, fill);
  if (marker.phase === 'warning') {
    ctx.strokeStyle = fill;
    ctx.beginPath();
    ctx.arc(marker.mx, marker.my, radius + 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}

const SKILL_EVENT_INNER_RATIO = 0.62;
const SKILL_EVENT_STAR_RATIO = 0.72;
const SKILL_EVENT_STAR_CORNER = 0.34;

/** The hourly skill event marker: the world quest emblem (a ring around a dark
 *  centre holding a four-point star) in red, inside the same pulsing glow as
 *  the hill. Before the start a warning ring circles it, as on the hill. */
export function drawSkillEventMapMarker(
  ctx: CanvasRenderingContext2D,
  marker: { mx: number; my: number; phase: 'warning' | 'running' },
  radius: number,
  fill: string,
  outline: string,
  pulse = 0.5,
): void {
  const { mx, my } = marker;
  ctx.save();
  drawPvpGlow(ctx, mx, my, radius, fill, pulse);
  ctx.fillStyle = fill;
  ctx.strokeStyle = outline;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(mx, my, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  const inner = radius * SKILL_EVENT_INNER_RATIO;
  ctx.fillStyle = outline;
  ctx.beginPath();
  ctx.arc(mx, my, inner, 0, Math.PI * 2);
  ctx.fill();
  const star = inner * SKILL_EVENT_STAR_RATIO;
  const c = star * SKILL_EVENT_STAR_CORNER;
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.moveTo(mx, my - star);
  ctx.lineTo(mx + c, my - c);
  ctx.lineTo(mx + star, my);
  ctx.lineTo(mx + c, my + c);
  ctx.lineTo(mx, my + star);
  ctx.lineTo(mx - c, my + c);
  ctx.lineTo(mx - star, my);
  ctx.lineTo(mx - c, my - c);
  ctx.closePath();
  ctx.fill();
  if (marker.phase === 'warning') {
    ctx.strokeStyle = fill;
    ctx.beginPath();
    ctx.arc(mx, my, radius + 3, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
