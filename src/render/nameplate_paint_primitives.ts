// Small stateless canvas-drawing helpers the nameplate surface composes: the
// rounded-rect pen every shape on the plate reuses, the combo-pip row, and
// the badge/image blit pair. Kept beside nameplate_dot_row.ts and
// nameplate_markers.ts rather than folded into nameplate_canvas.ts, which
// stays the compositor.

export interface NameplateBadge {
  url: string;
  size: number;
  circular?: boolean;
  border?: string;
  glow?: string;
}

export function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export function drawNameplateComboPips(
  ctx: CanvasRenderingContext2D,
  count: number,
  centerX: number,
  y: number,
  forcedColors: boolean,
): void {
  const total = 5 * 7 + 4 * 3;
  let x = centerX - total / 2;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.arc(x + 3.5, y + 3.5, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = forcedColors
      ? i < count
        ? 'Highlight'
        : 'Canvas'
      : i < count
        ? '#e8453a'
        : '#3a1010';
    ctx.fill();
    ctx.lineWidth = 1;
    ctx.strokeStyle = forcedColors ? 'CanvasText' : i < count ? '#5a0c08' : '#000';
    ctx.stroke();
    x += 10;
  }
}

export function drawNameplateImage(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  size: number,
  circular: boolean,
): void {
  if (!circular) {
    ctx.drawImage(image, x, y, size, size);
    return;
  }
  ctx.save();
  ctx.beginPath();
  ctx.arc(x + size / 2, y + size / 2, size / 2, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(image, x, y, size, size);
  ctx.restore();
}

/** `drawImage` mirrors the host's own url-keyed blit (`url, x, y, size`); the
 *  circular clip and border stroke stay this function's job, not the host's. */
export function drawNameplateBadge(
  ctx: CanvasRenderingContext2D,
  badge: NameplateBadge,
  x: number,
  y: number,
  drawImage: (url: string, x: number, y: number, size: number) => void,
  forcedColors: boolean,
): void {
  ctx.save();
  if (badge.glow) {
    ctx.shadowColor = badge.glow;
    ctx.shadowBlur = 5;
  }
  if (badge.circular) {
    ctx.beginPath();
    ctx.arc(x + badge.size / 2, y + badge.size / 2, badge.size / 2, 0, Math.PI * 2);
    ctx.clip();
  }
  drawImage(badge.url, x, y, badge.size);
  ctx.restore();
  if (badge.circular && badge.border) {
    ctx.beginPath();
    ctx.arc(x + badge.size / 2, y + badge.size / 2, badge.size / 2 - 0.75, 0, Math.PI * 2);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = forcedColors ? 'CanvasText' : badge.border;
    ctx.stroke();
  }
}
