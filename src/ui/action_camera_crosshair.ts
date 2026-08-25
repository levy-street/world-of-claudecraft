import { actionCameraScreenPoint } from './action_camera_anchor';

export interface ActionCameraCrosshair {
  setVisible(visible: boolean): void;
  dispose(): void;
}

/** Owns the optional action-camera crosshair and elides unchanged visibility writes. */
export function createActionCameraCrosshair(
  canvas: Pick<HTMLCanvasElement, 'getBoundingClientRect'>,
  doc: Document = document,
): ActionCameraCrosshair {
  const element = doc.createElement('div');
  element.id = 'action-camera-crosshair';
  element.setAttribute('aria-hidden', 'true');
  element.hidden = true;
  doc.body.appendChild(element);
  let shown = false;
  let lastLeft = '';
  let lastTop = '';
  return {
    setVisible(visible) {
      let effectiveVisible = visible;
      if (visible) {
        const point = actionCameraScreenPoint(canvas.getBoundingClientRect());
        if (!point) {
          effectiveVisible = false;
        } else {
          const left = `${point.x}px`;
          const top = `${point.y}px`;
          if (left !== lastLeft) {
            lastLeft = left;
            element.style.left = left;
          }
          if (top !== lastTop) {
            lastTop = top;
            element.style.top = top;
          }
        }
      }
      if (effectiveVisible !== shown) {
        shown = effectiveVisible;
        element.hidden = !effectiveVisible;
      }
    },
    dispose() {
      element.remove();
    },
  };
}
