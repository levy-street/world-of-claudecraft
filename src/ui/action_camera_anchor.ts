export const ACTION_CAMERA_AIM_HEIGHT_RATIO = 0.42;

export interface ActionCameraAnchorRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Shared screen anchor for the action-camera ray and its DOM crosshair. */
export function actionCameraScreenPoint(
  rect: ActionCameraAnchorRect,
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: rect.left + rect.width * 0.5,
    y: rect.top + rect.height * ACTION_CAMERA_AIM_HEIGHT_RATIO,
  };
}
