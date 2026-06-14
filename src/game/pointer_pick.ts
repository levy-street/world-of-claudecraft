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
}

export interface ClickPick {
  x: number;
  y: number;
  button: number;
}

export function clickPickFromMouseGesture(g: MousePickGesture): ClickPick | null {
  if (g.button !== g.downButton) return null;
  if (!g.releaseOnCanvas && !g.pointerLocked) return null;
  const pointerDrag = g.pointerLocked ? 0 : Math.abs(g.upX - g.downX) + Math.abs(g.upY - g.downY);
  const drag = Math.max(g.movementDrag, pointerDrag);
  if (drag > (g.dragThreshold ?? 5)) return null;
  return { x: g.downX, y: g.downY, button: g.button };
}
