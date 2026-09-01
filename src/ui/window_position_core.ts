// Pure geometry for converting a managed window from visual viewport coordinates
// into explicit author-space left/top coordinates under the live #ui zoom.
// Hud owns the DOM writes and the dataset flag that opts positioned windows into
// later viewport resize and reopen re-clamping.

export const WINDOW_POSITION_MARGIN = 8;

export interface WindowPixelPositionInput {
  left: number;
  top: number;
  width: number;
  height: number;
  viewportWidth: number;
  viewportHeight: number;
  scale: number;
  margin?: number;
}

export interface WindowPixelPosition {
  left: number;
  top: number;
}

export function windowPixelPosition(input: WindowPixelPositionInput): WindowPixelPosition {
  const margin = input.margin ?? WINDOW_POSITION_MARGIN;
  const viewportWidth = input.viewportWidth / input.scale;
  const viewportHeight = input.viewportHeight / input.scale;
  const left = input.left / input.scale;
  const top = input.top / input.scale;
  const width = Math.min(input.width / input.scale, viewportWidth - margin * 2);
  const height = Math.min(input.height / input.scale, viewportHeight - margin * 2);
  const maxLeft = Math.max(margin, viewportWidth - width - margin);
  const maxTop = Math.max(margin, viewportHeight - height - margin);
  return {
    left: Math.max(margin, Math.min(maxLeft, left)),
    top: Math.max(margin, Math.min(maxTop, top)),
  };
}
