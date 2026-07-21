export interface MousePickGesture {
  button: number;
  downButton: number;
  downX: number;
  downY: number;
  upX: number;
  upY: number;
  movementDrag: number;
  releaseOnCanvas: boolean;
  pointerLocked: boolean;
  dragThreshold?: number;
  pressDurationMs?: number;
  maxClickDurationMs?: number;
}

export const DEFAULT_CLICK_PICK_MAX_MS = 280;
export const DEFAULT_CLICK_PICK_DRAG_THRESHOLD = 18;

export interface ClickPick {
  x: number;
  y: number;
  button: number;
}

export function clickPickFromMouseGesture(g: MousePickGesture): ClickPick | null {
  if (g.button !== g.downButton) return null;
  if (!g.releaseOnCanvas && !g.pointerLocked) return null;
  const duration = Number.isFinite(g.pressDurationMs) ? Math.max(0, g.pressDurationMs ?? 0) : Number.POSITIVE_INFINITY;
  const maxClickDurationMs = g.maxClickDurationMs ?? DEFAULT_CLICK_PICK_MAX_MS;
  if (duration > maxClickDurationMs) return null;
  if (g.button === 2 && g.movementDrag > (g.dragThreshold ?? DEFAULT_CLICK_PICK_DRAG_THRESHOLD)) return null;
  return { x: g.downX, y: g.downY, button: g.button };
}
